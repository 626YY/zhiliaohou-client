# -*- coding: utf-8 -*-
# B 站（哔哩哔哩）直播弹幕房间模块。
#
# 与 douyin_room.DouyinLiveRoom 相同的「鸭子接口」，connector.py 的 run_room 零改动即可驱动：
#   构造 BilibiliLiveRoom(room_id)；可赋值回调 on_gift/on_like/on_follow/on_badge/on_chat/on_member/
#   on_status/on_beat/on_living/on_anchor；run(stop_event) 阻塞直到断开；census_text() 诊断；
#   属性 _ended（直播真的结束）/_throttled（被限流，外层退避加长）。
#
# 连接方式：纯 WebSocket 直连 B 站弹幕广播服务（公开直播间免登录即可收弹幕/礼物/进场/点赞/上舰）。
#   协议 protover=2（zlib，Python 标准库自带），不走 brotli，避免 pyembed 缺依赖。
#   房间真实 id / 弹幕服务器 / token 走公开 HTTP 接口拿，失败回退默认广播服务器。
#
# ★只收不发、不改动直播间、不要登录态（匿名 buvid3 仅用于提高连通率）；观众头像 URL 交给上层下载，
#   本模块不落盘、不外传。事件文本格式与 douyin_room 对齐，connector.py 照原样打 [connector] 行。
import json
import struct
import threading
import time
import zlib

BILI_ROOM_VERSION = "2026-10-03"

try:
    import brotli  # 可选：protover=3 时用；没有也不影响（我们请求 protover=2）
    _HAS_BROTLI = True
except Exception:
    _HAS_BROTLI = False


def _get(url, timeout=8, headers=None):
    import requests
    h = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        "Referer": "https://live.bilibili.com/",
    }
    if headers:
        h.update(headers)
    r = requests.get(url, timeout=timeout, headers=h)
    r.raise_for_status()
    return r.json()


class BilibiliLiveRoom(object):
    # 16 字节包头：总长(uint32) 头长(uint16) 协议(uint16) 操作(uint32) 序号(uint32)
    _HEADER = struct.Struct(">IHHII")
    OP_HEARTBEAT = 2
    OP_HEARTBEAT_REPLY = 3
    OP_MESSAGE = 5
    OP_AUTH = 7
    OP_AUTH_REPLY = 8

    def __init__(self, room_id, cookie=None,
                 on_gift=None, on_like=None, on_status=None, on_beat=None,
                 on_follow=None, on_badge=None, on_living=None, on_chat=None,
                 on_member=None, on_anchor=None):
        self.short_id = str(room_id).strip()
        self.room_id = None        # 真实长房号
        self.uid = 0               # 主播 uid
        self.on_gift = on_gift or (lambda *a, **k: None)
        self.on_like = on_like or (lambda *a, **k: None)
        self.on_status = on_status or (lambda *a, **k: None)
        self.on_beat = on_beat or (lambda *a, **k: None)
        self.on_follow = on_follow or (lambda *a, **k: None)
        self.on_badge = on_badge or (lambda *a, **k: None)
        self.on_living = on_living or (lambda *a, **k: None)
        self.on_chat = on_chat or (lambda *a, **k: None)
        self.on_member = on_member or (lambda *a, **k: None)
        self.on_anchor = on_anchor or (lambda *a, **k: None)
        self._ws = None
        self._ended = False
        self._throttled = False
        self._living_announced = False
        self._buvid = ""
        # 诊断计数（不含房号/昵称，只有方法名与计数）
        self._diag = {"frames": 0, "cmds": 0, "gift": 0, "chat": 0, "member": 0, "like": 0,
                      "follow": 0, "guard": 0, "err": ""}

    # —— 握手：拿真实房号 / 主播 / 弹幕服务器 + token ——
    def _anon_buvid(self):
        try:
            data = _get("https://api.bilibili.com/x/frontend/finger/spi")
            self._buvid = (data.get("data") or {}).get("b_3", "") or ""
        except Exception:
            self._buvid = ""

    def _resolve_room(self):
        # 短号 → 真实房号 + 主播 uid
        data = _get("https://api.live.bilibili.com/room/v1/Room/room_init?id=%s" % self.short_id)
        d = data.get("data") or {}
        self.room_id = d.get("room_id") or int(self.short_id)
        self.uid = d.get("uid") or 0
        live_status = d.get("live_status", 1)
        if d.get("is_locked"):
            raise RuntimeError("直播间被封禁")
        if live_status != 1:
            # 未开播也允许连接（随时开播就有事件）；记一条状态
            self.on_status("B站直播间当前未开播，已连上弹幕服务，开播后自动开始")
        # 主播昵称
        try:
            info = _get("https://api.live.bilibili.com/live_user/v1/Master/info?uid=%s" % self.uid)
            name = (((info.get("data") or {}).get("info") or {}).get("uname")) or ""
            face = (((info.get("data") or {}).get("info") or {}).get("face")) or ""
            if name:
                self.on_anchor(name, face)
        except Exception:
            pass

    def _danmu_server(self):
        host = "broadcastlv.chat.bilibili.com"
        wss_port = 443
        token = ""
        try:
            hdr = {}
            if self._buvid:
                hdr["Cookie"] = "buvid3=%s" % self._buvid
            data = _get("https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=%s&type=0" % self.room_id,
                        headers=hdr)
            d = data.get("data") or {}
            token = d.get("token") or ""
            hosts = d.get("host_list") or []
            if hosts:
                host = hosts[0].get("host") or host
                wss_port = hosts[0].get("wss_port") or 443
        except Exception as e:
            self._diag["err"] = "getDanmuInfo:" + type(e).__name__
        return host, wss_port, token

    def _auth_packet(self, token):
        body = json.dumps({
            "uid": 0, "roomid": int(self.room_id), "protover": 2,
            "platform": "web", "type": 2, "key": token,
        }, separators=(",", ":")).encode("utf-8")
        return self._HEADER.pack(self._HEADER.size + len(body), self._HEADER.size, 1, self.OP_AUTH, 1) + body

    def _heartbeat_packet(self):
        body = b"[object Object]"
        return self._HEADER.pack(self._HEADER.size + len(body), self._HEADER.size, 1, self.OP_HEARTBEAT, 1) + body

    # —— 收包解码：一个 TCP 帧里可能叠多个包；protover 2=zlib、3=brotli、0=原始 ——
    def _iter_json(self, data):
        off = 0
        n = len(data)
        while off + self._HEADER.size <= n:
            plen, hlen, pver, op, _seq = self._HEADER.unpack_from(data, off)
            if plen <= 0 or off + plen > n:
                break
            body = data[off + hlen: off + plen]
            off += plen
            if op == self.OP_MESSAGE:
                if pver == 2:
                    try:
                        for j in self._iter_json(zlib.decompress(body)):
                            yield j
                    except Exception:
                        pass
                    continue
                if pver == 3:
                    if _HAS_BROTLI:
                        try:
                            for j in self._iter_json(brotli.decompress(body)):
                                yield j
                        except Exception:
                            pass
                    continue
                try:
                    yield json.loads(body.decode("utf-8", "ignore"))
                except Exception:
                    pass
            elif op == self.OP_HEARTBEAT_REPLY:
                # 人气值，忽略内容，只当作一次心跳
                yield {"cmd": "_POPULARITY"}

    def _dispatch(self, msg):
        if not isinstance(msg, dict):
            return
        cmd = msg.get("cmd") or ""
        self._diag["cmds"] += 1
        # 收到任何真实命令即视为「在直播」
        if cmd and cmd != "_POPULARITY" and not self._living_announced:
            self._living_announced = True
            try:
                self.on_living()
            except Exception:
                pass
        if cmd.startswith("DANMU_MSG"):
            info = msg.get("info") or []
            try:
                text = info[1]
                user = info[2]
                nick = user[1] if len(user) > 1 else "?"
            except Exception:
                return
            self._diag["chat"] += 1
            self.on_chat(nick, text, None)
        elif cmd == "SEND_GIFT":
            d = msg.get("data") or {}
            name = d.get("giftName") or d.get("gift_name") or "礼物"
            num = int(d.get("num") or 1)
            nick = d.get("uname") or ""
            face = d.get("face") or None
            # price 单位「瓜子」(金瓜子=付费)，银瓜子(免费礼物 coin_type=silver)记 0 分
            coins = None
            if (d.get("coin_type") or "gold") == "gold":
                try:
                    coins = int(d.get("price") or 0)
                except Exception:
                    coins = None
            self._diag["gift"] += 1
            self.on_gift(name, num, nick, face, coins, None)
        elif cmd == "COMBO_SEND":
            d = msg.get("data") or {}
            name = d.get("gift_name") or "礼物"
            num = int(d.get("combo_num") or d.get("total_num") or 1)
            nick = d.get("uname") or ""
            self._diag["gift"] += 1
            self.on_gift(name, num, nick, None, None, None)
        elif cmd == "GUARD_BUY":
            d = msg.get("data") or {}
            name = d.get("gift_name") or "上舰"
            num = int(d.get("num") or 1)
            nick = d.get("username") or ""
            self._diag["guard"] += 1
            self.on_gift(name, num, nick, None, None, None)
        elif cmd == "INTERACT_WORD" or cmd == "INTERACT_WORD_V2":
            d = msg.get("data") or {}
            nick = d.get("uname") or ""
            mtype = d.get("msg_type") or 1
            if mtype == 2:  # 关注
                self._diag["follow"] += 1
                self.on_follow(nick)
            else:            # 1=进场 3=分享 都算互动进场
                self._diag["member"] += 1
                self.on_member(nick, None)
        elif cmd.startswith("LIKE_INFO_V3_CLICK"):
            d = msg.get("data") or {}
            nick = d.get("uname") or ""
            self._diag["like"] += 1
            self.on_like(1, nick)
        elif cmd in ("PREPARING", "CLOSE", "ROOM_BLOCK_MSG"):
            self._ended = True

    def census_text(self):
        d = self._diag
        return ("普查[B站] frames=%d cmds=%d gift=%d chat=%d member=%d like=%d follow=%d guard=%d err=%s"
                % (d["frames"], d["cmds"], d["gift"], d["chat"], d["member"], d["like"], d["follow"], d["guard"], d["err"] or "-"))

    def _heartbeat_loop(self, ws, stop):
        while not stop.is_set():
            try:
                ws.send(self._heartbeat_packet(), opcode=0x2)  # binary
            except Exception:
                return
            # 30 秒一次，可被 stop 提前打断
            for _ in range(30):
                if stop.is_set():
                    return
                time.sleep(1)

    def run(self, stop):
        import websocket  # websocket-client
        try:
            self._anon_buvid()
            self._resolve_room()
        except Exception as e:
            self.on_status("连不上 B 站直播间：取房间信息失败(%s)" % type(e).__name__)
            self._diag["err"] = "resolve:" + type(e).__name__
            return
        host, wss_port, token = self._danmu_server()
        url = "wss://%s:%d/sub" % (host, int(wss_port))
        try:
            ws = websocket.create_connection(
                url, timeout=30,
                header=["User-Agent: Mozilla/5.0", "Origin: https://live.bilibili.com"])
        except Exception as e:
            self.on_status("连不上 B 站弹幕服务：%s" % type(e).__name__)
            self._diag["err"] = "ws:" + type(e).__name__
            self._throttled = True
            return
        self._ws = ws
        try:
            ws.send(self._auth_packet(token), opcode=0x2)
        except Exception as e:
            self.on_status("B 站弹幕握手失败：%s" % type(e).__name__)
            try:
                ws.close()
            except Exception:
                pass
            return
        hb = threading.Thread(target=self._heartbeat_loop, args=(ws, stop), daemon=True)
        hb.start()
        self.on_status("已连接直播间")
        ws.settimeout(35)
        while not stop.is_set() and not self._ended:
            try:
                data = ws.recv()
            except Exception:
                break
            if not data:
                break
            if isinstance(data, str):
                data = data.encode("utf-8", "ignore")
            self._diag["frames"] += 1
            try:
                self.on_beat()
            except Exception:
                pass
            for msg in self._iter_json(data):
                try:
                    self._dispatch(msg)
                except Exception as e:
                    self._diag["err"] = "dispatch:" + type(e).__name__
        try:
            ws.close()
        except Exception:
            pass
