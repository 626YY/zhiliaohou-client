# -*- coding: utf-8 -*-
"""
douyin_room.py —— WheelLive 的抖音直播间弹幕/礼物真实抓取模块。

connector.py --room <直播间号> 会 import 本模块的 DouyinLiveRoom，把礼物/点赞回调回去。
连接链路参考 saermart/DouyinLiveWebFetcher（网页版 wss），做了以下取舍让它能塞进一个文件、少依赖：
  · protobuf 不用 betterproto/protoc，手写最小 varint 解码，只抽「礼物名/连送数/点赞增量/下播」——更抗字段漂移。
  · wss 的 signature(X-Bogus) 抖音用混淆 JS 生成，纯 Python 算不出：用 py_mini_racer 跑同目录 sign.js。
    没装 mini_racer 或缺 sign.js → 诚实报错退出，绝不假装连上。

★★两个必须知道的现实(2026)：
  1. wss 签名要 `pip install py_mini_racer`（自带 V8，不用另装 Node）+ 同目录 sign.js(485KB，随包发)。
  2. ★礼物(gift)自 2026-04 起抖音只推给「已登录 cookie」，游客身份收不到礼物消息(点赞/弹幕/进场照收)。
     要接礼物 → 在本文件同目录放一个 douyin_cookie.txt，内容是你登录 live.douyin.com 后浏览器里的整条 Cookie。
     （F12→Network→随便点一个 live.douyin.com 请求→Request Headers→复制 cookie: 后面那一整行，粘进去存好。）
     没放 cookie 也能连，只是礼物触发会一直不响——这是平台限制，不是 bug。

许可：连接手法参考的 DouyinLiveWebFetcher 为 AGPL/Apache「仅供学习」，本文件为薄封装同类实现，仅供本地自用。
"""
import os, re, gzip, json, time, random, string, hashlib, threading, html
from urllib.parse import urlparse

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")

_HERE = os.path.dirname(os.path.abspath(__file__))
# ★版本标记：知了猴客户端 connector.ts 启动连接器前用它判断游戏目录里的副本是否过旧，旧了就备份后换成客户端自带的。
#   改本文件必须同步更新这个日期（2026-09-06 抖音改版当晚，图书馆目录里 8 月的旧副本「连上」的是空房，礼物点赞一个收不到）。
DOUYIN_ROOM_VERSION = "2026-09-13"


def _hdr_safe(s):
    """HTTP 头只接受 latin-1；cookie 值若含中文/emoji 会让 requests/websocket 抛 UnicodeEncodeError。
    按「浏览器实际上线的字节」处理：先 utf-8 编成字节、再按 latin-1 解成 str，发送方编回 latin-1 就是原始 UTF-8 字节，
    和浏览器发的完全一致——不丢 cookie、不报错。纯 ASCII 时是幂等的，无副作用。"""
    if not s:
        return s
    try:
        return s.encode("utf-8").decode("latin-1")
    except Exception:
        return s


# ---------------- 最小 protobuf varint 解码/编码（无第三方依赖） ----------------
def _read_varint(b, i):
    shift = val = 0
    while i < len(b):
        x = b[i]; i += 1
        val |= (x & 0x7F) << shift
        if not (x & 0x80):
            return val, i
        shift += 7
    return val, i


def _iter_fields(buf):
    """遍历一段 protobuf：yield (field_num, wire_type, value)。value 对 wt=0 是int，wt=2 是bytes。"""
    i, n = 0, len(buf)
    while i < n:
        key, i = _read_varint(buf, i)
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _read_varint(buf, i)
        elif wt == 2:
            ln, i = _read_varint(buf, i)
            v = buf[i:i + ln]; i += ln
        elif wt == 5:
            v = buf[i:i + 4]; i += 4
        elif wt == 1:
            v = buf[i:i + 8]; i += 8
        else:
            return
        yield fn, wt, v


def _encode_varint(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        out.append(b | (0x80 if v else 0))
        if not v:
            return bytes(out)


def _mstoken(n=182):
    alpha = string.ascii_letters + string.digits + "-_"
    return "".join(random.choice(alpha) for _ in range(n))


class DouyinLiveRoom:
    def __init__(self, room_id, cookie=None,
                 on_gift=None, on_like=None, on_status=None, on_beat=None,
                 on_follow=None, on_badge=None, on_living=None,
                 on_chat=None, on_member=None,
                 sign_js_path=None):
        self.live_id = str(room_id).strip()   # 外部给的其实是 web_rid(短房号)
        self.room_id = None                    # 内部长 ID，稍后从 HTML 抠
        self.cookie = cookie or self._load_cookie_file()
        self.on_gift = on_gift or (lambda name, cnt, sender=None, avatar=None, coins=None: None)
        self.on_like = on_like or (lambda delta: None)
        self.on_status = on_status or (lambda text: None)
        self.on_beat = on_beat or (lambda: None)
        self.on_living = on_living or (lambda: None)   # 确认在直播(收到第一条业务消息) → 外部开始计时
        # 弹幕 / 进场：2026-09-13 起多带一个 avatar(头像 URL，抽不到=None)。老回调只收 (nick[, content]) 的照样能用——
        #   _dispatch 先按新签名调，TypeError 再退回老签名；进场/弹幕消息的 user 子消息本来就带 avatar_thumb，
        #   以前只对礼物抽头像，所以只进场不送礼的观众在客户端「大哥进场」名单里永远没头像。
        self.on_chat = on_chat or (lambda nick, content, avatar=None: None)   # 弹幕
        self.on_member = on_member or (lambda nick, avatar=None: None)        # 进场
        self.on_follow = on_follow or (lambda sender=None: None)   # 关注 → 攒盲盒
        self.on_badge = on_badge or (lambda sender=None: None)     # 灯牌/粉丝团 → 攒盲盒
        self.on_anchor = (lambda name, avatar=None: None)          # 认出主播本人(房主)昵称+头像 → mod 播报用真名真头像
        self.sign_js_path = sign_js_path or os.path.join(_HERE, "sign.js")
        self._ws = None
        self._stop = None
        self._ttwid = None
        self._did = str(random.randint(7000000000000000000, 7999999999999999999))
        self._throttled = False        # 被抖音限流(too many rooms)标记，外层据此退避重连
        self._ended = False            # 收到「直播已结束」控制消息 → 别再自动重连(不然会连一个已下播的间)
        # ★★2026-09-07 实锤的坑：这个标记以前只在 _on_message 里读写、从没在这里初始化，
        #   于是每帧走到 `if msgs and not self._living_announced:` 都抛 AttributeError，
        #   被 _on_message 外层的 except 整帧吞掉 → 一条消息都派发不出去（礼物/点赞/弹幕/进场全丢）。
        #   现场：ack 发了 8 次、_dispatch 调用 0 次、事件普查全空。加过滤器之前先把它初始化好。
        self._living_announced = False
        self._seen_ids = set()         # 已处理过的消息 msgId(去重：抖音 im/fetch 会重叠下发同一条→防一个礼物触发两次)
        self._seen_q = []              # msgId 环形队列，限制去重表大小
        self._gift_lock = threading.RLock()  # 连击计算、回调和提交必须保持同一顺序，失败才能重试
        self._gift_fired = {}          # 礼物连击去重：group_id → 已触发到第几连击(只补触发新增的那几次)
        self._gift_ended = {}          # group_id → 是否已经收到 repeatEnd；结束后的下一帧可视为新连击
        self._gift_end_msg = {}        # group_id → 已提交的终帧 msgId；只有明确同一消息才跳过终帧重投
        self._gift_seen_at = {}        # group_id → 最近一帧时间；旧连击没收到 repeatEnd 时也能从重置计数恢复
        self._gift_q = []              # group_id 顺序表；真实连击绝不因本地队列满而忘掉旧记录

        # ★★事件普查(2026-07-16 加，为查用户报的「关注盲盒和灯牌盲盒现在是触发不了的」)：
        #   这个 bug 我【在本机复现不了】—— 关注/灯牌事件只有真直播间才会推过来，而那是用户的房间。
        #   mod 侧我已经实测过是好的（bridge 打 follow/badge → `BOX(关注攒1) -> t_blast` 正常开盒放整蛊），
        #   所以断点必在「抖音推没推 / 我们认没认出来」这一段。既然复现不了，就【上仪器】，别猜个修法蒙。
        #   这份普查专门回答三个问题（用户下次一开播，答案自己就跳出来）：
        #     ① SocialMessage 到底来没来？ count=0 → 抖音压根没推(订阅/协议问题)，跟 action 判据无关
        #     ② 来了的话 action 都是些什么值？我们只认 action==1，这是【注释里的假设，从没验过】
        #     ③ MemberMessage 来了多少、其中几个被 _member_has_badge 认成灯牌？(全是 0 → 灯牌判据太严)
        self._census = {}          # method → 收到多少条
        self._social_actions = {}  # SocialMessage 的 action 值 → 出现次数
        self._member_badge = [0, 0]  # [认成灯牌的, 没认成的]
        self._av_stat = [0, 0]     # 礼物头像URL [抠到的, 没抠到的] ——7-20 真直播整场 Gift=201 头像零下载才发现判据失效，从此普查里带上健康度
        self._fired = {}           # 真正回调出去的次数：follow/badge
        self._diag_err = {}        # 回调/抠昵称抛的异常 → 次数(★老代码 except: pass 全吞了，等于瞎)
        self.on_diag = (lambda text: None)   # 外层(connector)接走，定期打印

    # 同目录 douyin_cookie.txt（可选）→ 登录态 cookie，用来收礼物
    def _load_cookie_file(self):
        p = os.path.join(_HERE, "douyin_cookie.txt")
        try:
            if os.path.isfile(p):
                txt = open(p, encoding="utf-8-sig").read().strip()
                # 允许带前缀 "cookie:" 或 "Cookie:"
                txt = re.sub(r"^\s*cookie\s*:\s*", "", txt, flags=re.I).strip()
                return txt or None
        except Exception:
            pass
        return None

    # ---------------- 签名（唯一必须过 JS 的一步） ----------------
    def _signature(self, wss_url):
        try:
            from py_mini_racer import MiniRacer
        except Exception:
            self.on_status("连不上：缺 py_mini_racer（wss 签名要用）。请运行: pip install py_mini_racer")
            return None
        if not os.path.isfile(self.sign_js_path):
            self.on_status("连不上：缺签名脚本 sign.js（应与 douyin_room.py 同目录）")
            return None
        try:
            fields = ("live_id,aid,version_code,webcast_sdk_version,room_id,sub_room_id,"
                      "sub_channel_id,did_rule,user_unique_id,device_platform,device_type,ac,identity").split(",")
            q = {}
            for p in urlparse(wss_url).query.split("&"):
                if "=" in p:
                    k, v = p.split("=", 1); q[k] = v
            param = ",".join("%s=%s" % (k, q.get(k, "")) for k in fields)
            md5 = hashlib.md5(param.encode()).hexdigest()
            ctx = MiniRacer()
            ctx.eval(open(self.sign_js_path, encoding="utf-8").read())
            return ctx.call("get_sign", md5)
        except Exception as e:
            self.on_status("签名失败(%s)：sign.js 版本可能与抖音协议不匹配" % e.__class__.__name__)
            return None

    def _fetch_ttwid(self, sess):
        r = sess.get("https://live.douyin.com/", headers={"User-Agent": UA}, timeout=10)
        r.raise_for_status()
        return r.cookies.get("ttwid")

    def _fetch_room_id(self, sess):
        """
        把 web_rid(短房号) 换成内部长 room_id。
        ★2026 抖音改版：对「游客」的网页已把内部 room_id 抹成 $undefined，且 enter 接口要 a_bogus 签名——
          本签名器(sign.js)只有 X-Bogus 没有 a_bogus，所以游客身份现在拿不到 room_id。
          唯一稳的办法是用「主播自己的登录 Cookie」抓页面(登录态网页会内联完整 roomInfo)——
          反正收礼物本来也需要这份 Cookie，一次性放好 douyin_cookie.txt 即可。
        """
        url = "https://live.douyin.com/" + self.live_id
        if self.cookie:
            cookie_hdr = self.cookie
            if "ttwid=" not in cookie_hdr and self._ttwid:
                cookie_hdr = "ttwid=%s; %s" % (self._ttwid, cookie_hdr)
        else:
            cookie_hdr = "ttwid=%s; msToken=%s; __ac_nonce=0123407cc00a9e438deb4" % (self._ttwid, _mstoken())
        headers = {"User-Agent": UA, "referer": "https://live.douyin.com/", "cookie": _hdr_safe(cookie_hdr)}
        saw_undefined = False
        for attempt in range(1, 4):
            try:
                r = sess.get(url, headers=headers, timeout=10)
                t = r.text
                # 登录态页面里 roomId 是真数字；再兜底找 roomInfo 里的长 id_str
                # ★2026-09-06 抖音又改版：roomId 变成 JS 数字（超过 2^53、末几位精度已丢：7682429761746292000≠真 id），
                #   真 id 在 roomIdStr（字符串）。roomIdStr 优先；旧的字符串 roomId 写法保留兼容；绝不用数字型 roomId。
                for pat in (r'roomIdStr\\":\\"(\d+)\\"', r'"roomIdStr":"(\d+)"',
                            r'roomId\\":\\"(\d+)\\"', r'"roomId":"(\d+)"',
                            r'roomInfo\\":\{\\"[^}]*?\\"id_str\\":\\"(\d{15,})\\"',
                            r'\\"id_str\\":\\"(\d{17,})\\"'):
                    m = re.search(pat, t)
                    if m and m.group(1).isdigit() and len(m.group(1)) >= 15:
                        try:
                            self._emit_anchor(t)   # 顺手认主播本人(房主)昵称+头像；抽不到不碍事
                        except Exception:
                            pass
                        return m.group(1)
                if 'roomId\\":\\"$undefined' in t or '"roomId":"$undefined"' in t:
                    saw_undefined = True
                if "直播已结束" in t or ("live_status" in t and "\"status\":4" in t):
                    self.on_status("这个直播间没在开播（或已结束）——先开播再点连接。")
                    self._ended = True
                    return None
            except Exception as e:
                self.on_status("抓直播间页出错(第%d次,%s)，重试…" % (attempt, e.__class__.__name__))
            time.sleep(1.0)
        # 抠不到：分情况给「能照做」的提示
        if not self.cookie:
            self.on_status("连不上：抖音现在不让「游客」拿房间号。请放你自己的登录Cookie(douyin_cookie.txt，"
                           "收礼物也要它)——F12→Network→点一个live.douyin.com请求→复制Cookie整行。")
        elif saw_undefined:
            self.on_status("有Cookie但没解析到房间号：多半是Cookie过期/不完整。重登抖音、复制最新的整条Cookie再试。")
        else:
            self.on_status("room_id 解析失败：直播间号可能不对，或抖音又改版了。核对直播间号(网页 live.douyin.com/后面那串)。")
        return None

    # 从房间页 HTML 里抽「主播本人(owner)」的昵称+头像 URL，喂给 on_anchor——mod 侧播报/榜单用真名真头像。
    #   页面里 roomInfo 是「转义 JSON 内联在 JS 字符串里」(\" 形式)，owner 块里第一个 nickname 就是主播昵称，
    #   avatar_thumb 的 url_list 第一条就是头像(斜杠常被转义成 /)。抽不到就静默放弃(mod 回落"主播"两字)。
    def _emit_anchor(self, t):
        nick = None
        avatar = None
        # ① 新版抖音房间页把主播身份放在 data-anchor-info 属性里(HTML实体编码小JSON:{"nickname","avatar","id_str"})——最稳,名+头像一把抓。
        m = re.search(r'data-anchor-info="(\{[^"]*?\})"', t)
        if m:
            try:
                obj = json.loads(html.unescape(m.group(1)))
                nick = obj.get("nickname")
                avatar = obj.get("avatar") or obj.get("avatarUrl") or None
            except Exception:
                nick = None
        # ② 兜底:页内 anchorInfo 块(实体编码)。
        if not nick or nick in ("", "$undefined"):
            m = re.search(r'anchorInfo&quot;:\{&quot;nickname&quot;:&quot;(.*?)&quot;', t)
            if m:
                nick = html.unescape(m.group(1))
        # ③ 老版兜底:roomInfo 的 owner 块(旧结构,现已不出现,保留防回退)。
        if not nick or nick in ("", "$undefined"):
            i = t.find('owner\\"')
            if i < 0:
                i = t.find('"owner"')
            if i >= 0:
                win = t[i:i + 6000]
                m = re.search(r'nickname\\{0,2}":\\{0,2}"(.*?)\\{0,2}"', win)
                if m:
                    raw = m.group(1)
                    try:
                        nick = json.loads('"' + raw.replace('"', '\\"') + '"')
                    except Exception:
                        nick = raw
                    if not avatar:
                        m2 = re.search(r'(https:[^"\\\s]*?(?:aweme-avatar|avatar)[^"\\\s]*)', win.replace("\\u002F", "/").replace("\\/", "/"))
                        if m2:
                            avatar = m2.group(1)
        if not nick or nick.strip() in ("", "$undefined"):
            return
        try:
            self.on_anchor(nick.strip(), avatar)
        except Exception:
            pass

    def _build_wss(self, room_id):
        return (
            "wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/?app_name=douyin_web"
            "&version_code=180800&webcast_sdk_version=1.0.14-beta.0"
            "&update_version_code=1.0.14-beta.0&compress=gzip&device_platform=web&cookie_enabled=true"
            "&screen_width=1536&screen_height=864&browser_language=zh-CN&browser_platform=Win32"
            "&browser_name=Mozilla&browser_version=5.0"
            "&browser_online=true&tz_name=Asia/Shanghai"
            "&cursor=d-1_u-1_fh-7392091211001140287_t-1721106114633_r-1"
            "&internal_ext=internal_src:dim|wss_push_room_id:%s|wss_push_did:%s"
            "|first_req_ms:1721106114541|fetch_time:1721106114633|seq:1|wss_info:0-1721106114633-0-0"
            "|wrds_v:7392094459690748497"
            "&host=https://live.douyin.com&aid=6383&live_id=1&did_rule=3&endpoint=live_pc&support_wrds=1"
            "&user_unique_id=%s&im_path=/webcast/im/fetch/&identity=audience"
            "&need_persist_msg_count=15&insert_task_id=&live_reason=&room_id=%s&heartbeatDuration=0"
            % (room_id, self._did, self._did, room_id)
        )

    # ---------------- WebSocket 回调 ----------------
    def _on_open(self, ws):
        self.on_status("已连接直播间")
        self.on_beat()

        def hb():
            HB = bytes([0x3A, 0x02, 0x68, 0x62])   # PushFrame(payloadType='hb')
            import websocket
            while self._stop is not None and not self._stop.is_set():
                try:
                    ws.send(HB, websocket.ABNF.OPCODE_PING)
                    self.on_beat()
                except Exception:
                    break
                self._stop.wait(5.0)
        threading.Thread(target=hb, daemon=True).start()

    def _on_message(self, ws, raw):
        try:
            if isinstance(raw, str):
                raw = raw.encode("utf-8", "ignore")
            log_id, payload = 0, None
            for fn, wt, v in _iter_fields(raw):
                if fn == 2 and wt == 0:
                    log_id = v
                elif fn == 8 and wt == 2:
                    payload = v
            if payload is None:
                return
            try:
                body = gzip.decompress(payload)
            except Exception:
                body = payload   # compress=gzip 理论上必压，兜底不压情况

            msgs, internal_ext, need_ack = [], b"", False
            for fn, wt, v in _iter_fields(body):
                if fn == 1 and wt == 2:
                    msgs.append(v)
                elif fn == 5 and wt == 2:
                    internal_ext = v
                elif fn == 9 and wt == 0:
                    need_ack = bool(v)

            if need_ack:
                self._send_ack(ws, log_id, internal_ext)

            if msgs and not self._living_announced:
                # 收到第一条真实业务消息(非心跳/ack) → 直播间确实在直播
                self._living_announced = True
                try:
                    self.on_living()
                except Exception:
                    pass

            for m in msgs:
                method, mp = None, b""
                for fn, wt, v in _iter_fields(m):
                    if fn == 1 and wt == 2:
                        method = v.decode("utf-8", "ignore")
                    elif fn == 2 and wt == 2:
                        mp = v
                # ★去重：抖音服务器在 im/fetch 里会把同一条消息在相邻批次里重复下发(ack 有延迟时尤甚)，
                #   不去重就会「一个礼物触发两次」(用户反馈)。用消息 Common.msgId 去重，处理过的直接跳过。
                mid = self._msg_id(mp)
                if mid is not None:
                    if mid in self._seen_ids:
                        continue
                # 只有事件已经被回调成功接收后才提交 msgId。桥/连接器临时失败时，
                # 同一消息重投仍能进入回调，不会被“已看过”这层提前吞掉。
                handled = self._dispatch(method, mp, mid)
                if mid is not None and handled is not False:
                    self._seen_ids.add(mid)
                    self._seen_q.append(mid)
                    if len(self._seen_q) > 4000:
                        old = self._seen_q.pop(0)
                        self._seen_ids.discard(old)
        except Exception as e:
            # 单帧解析失败不能拖垮连接，但★绝不能再静默：上面那个 _living_announced 的 AttributeError
            # 就是被这行 `pass` 藏了两天（连着的、帧也在收，就是一条都不派发）。记进普查，看得见才修得动。
            k = "on_message/" + e.__class__.__name__
            self._diag_err[k] = self._diag_err.get(k, 0) + 1

    @staticmethod
    def _msg_id(mp):
        # 从消息 payload 里抠 Common.msgId：Common 在 field1，msgId 是 Common 的 field2(varint)。抠不到返回 None(那就不去重)。
        try:
            for fn, wt, v in _iter_fields(mp):
                if fn == 1 and wt == 2:
                    for cfn, cwt, cv in _iter_fields(v):
                        if cfn == 2 and cwt == 0:
                            return cv
                    return None
        except Exception:
            pass
        return None

    # 触发一次关注/灯牌回调，并把「真触发了」和「抠昵称/回调抛异常」都记进普查。
    #   ★老代码是 `try: self.on_follow(self._nick_from(mp, 2))` / `except Exception: pass` ——
    #     `_nick_from` 一抛，这次关注就【静默消失，一个字都不留】。今晚我自己的测试脚本刚被同一类
    #     「静默失败」坑了三次(见 tests/abtest.sh 顶部)，不能让连接器继续这么干。异常照样不许拖垮连接，
    #     但必须留痕：吞掉是可以的，装作没发生过不行。
    def _fire(self, kind, cb, mp, nick_field):
        try:
            cb(self._nick_from(mp, nick_field))
            self._fired[kind] = self._fired.get(kind, 0) + 1
        except Exception as e:
            # ★只留异常【类型名】，绝不留 repr(e)/str(e)：异常消息里可能裹着观众昵称/原始 protobuf 字节，
            #   而这份普查是要随错误回传上服务器的 —— 红线是「错误回传不含观众数据」。类型名足够定位了。
            k = "%s:%s" % (kind, type(e).__name__)
            self._diag_err[k] = self._diag_err.get(k, 0) + 1

    # 事件普查快照：连接器定期打印 + 塞进错误回传，让「关注/灯牌盲盒触发不了」这类【本机复现不了】的 bug
    # 能靠用户一次真开播就定位。读法：
    #   · Social=0            → 抖音压根没推关注消息，跟 action 判据无关，去查订阅/协议
    #   · Social>0 但 action 里没有 1 → 「action==1 才是关注」这个假设错了，看真实值是几
    #   · Member 大量、badge 认出 0    → 灯牌判据(_member_has_badge)太严
    #   · fired 有数但 mod 没反应       → 断点在 bridge/mod 侧(但 mod 侧 2026-07-16 已实测是好的)
    def census_text(self):
        try:
            top = sorted(self._census.items(), key=lambda kv: -kv[1])[:8]
            s = "事件普查｜" + " ".join("%s=%d" % (k.replace("Webcast", "").replace("Message", ""), v) for k, v in top)
            s += "｜Social.action=" + (str(self._social_actions) if self._social_actions else "无")
            s += "｜Member带灯牌/不带=%d/%d" % (self._member_badge[0], self._member_badge[1])
            s += "｜礼物头像=命中%d/未中%d" % (self._av_stat[0], self._av_stat[1])
            s += "｜真触发=" + (str(self._fired) if self._fired else "无")
            if self._diag_err:
                s += "｜★异常=" + str(self._diag_err)
            return s
        except Exception as e:
            return "事件普查生成失败: %r" % e

    def _dispatch(self, method, mp, msg_id=None):
        if not method:
            return True
        self._census[method] = self._census.get(method, 0) + 1
        if method == "WebcastGiftMessage":
            # GiftMessage 关键字段(参考 DouyinLiveWebFetcher 的 proto)：
            #   5=repeatCount 6=comboCount 7=user 9=repeatEnd 11=groupId 15=gift(name 在其 field16)
            name, combo, repeat, sender, group_id, avatar = None, 0, 0, None, 0, None
            repeat_end = False
            coins = None      # 这个礼物值多少抖币(GiftStruct.diamondCount)；None=这帧压根没这个字段(≠免费礼物的 0)
            for fn, wt, v in _iter_fields(mp):
                if fn == 5 and wt == 0:
                    repeat = v
                elif fn == 6 and wt == 0:
                    combo = v
                elif fn == 9 and wt == 0:
                    repeat_end = bool(v)
                elif fn == 7 and wt == 2:
                    # user 子消息：昵称一般在 field3(nickName)。先精确抽 field3；抽不到再在子消息里找一个"像昵称"的字符串兜底
                    #   (2~30 字符、能 UTF-8 解码、不是纯数字ID)——尽量让观众榜能归到人；实在没有就不带(不影响整蛊触发)。
                    fallback = None
                    for ufn, uwt, uv in _iter_fields(v):
                        if uwt != 2:
                            continue
                        try: s = uv.decode("utf-8").strip()
                        except Exception: continue
                        if ufn == 3 and s:
                            sender = s
                            break
                        if fallback is None and 2 <= len(s) <= 30 and not s.isdigit() and s.isprintable():
                            fallback = s
                    if not sender and fallback:
                        sender = fallback
                    if avatar is None:
                        avatar = self._avatar_in_user(v)   # 送礼人头像URL(avatar_thumb.url_list)→连接器后台下载
                elif fn == 11 and wt == 0:
                    group_id = v
                elif fn == 15 and wt == 2:
                    # gift 子消息(GiftStruct)：16=name，★12=diamondCount(这个礼物的抖币单价)。
                    #   字段号出处：本文件参照的 saermart/DouyinLiveWebFetcher 的 douyin.proto —— `uint32 diamondCount = 12`。
                    #   ★为什么要它：观众榜的「送礼分数」以前是主播自己在菜单里给每个礼物填分(嘉年华填几分随他)，
                    #     等于榜单能自己刷。改成直接用抖音下发的抖币 → 分数=平台权威口径，主播碰不了，跨直播间也可比。
                    #   ★coins 分三态：None=没这字段(退回旧的每礼1分，别让整个分数榜哑掉)；0=真免费礼物(不计分)；>0=真抖币。
                    for gfn, gwt, gv in _iter_fields(v):
                        if gfn == 16 and gwt == 2:
                            name = gv.decode("utf-8", "ignore")
                        elif gfn == 12 and gwt == 0:
                            coins = gv if 0 <= gv <= 1000000 else None   # 上界兜底：协议漂移抽到别的字段时别把天文数字灌进榜
                    # ★礼物图 URL(icon 字段)：在礼物子消息里递归找 douyinpic 图床 URL、排除头像(-avt-/avatar)，
                    #   抠到就交给连接器下载到 礼物图/抖音/<礼物名>.png，供客户端透明图/贴纸/动画/时间插件用。
                    gift_img = None
                    _gurls = []
                    DouyinLiveRoom._collect_urls(v, 0, _gurls)
                    for s in _gurls:
                        if ("-avt-" in s) or ("avatar" in s) or ("/emoji/" in s):
                            continue
                        if ("douyinpic" in s) or ("byteimg" in s) or ("pstatp" in s):
                            gift_img = s
                            break
                    if gift_img and gift_img.startswith("//"):
                        gift_img = "https:" + gift_img
            if not name:
                return True
            # 头像抓取健康度计数(有送礼人才有头像可言；进普查随错误回传，下次直播一眼看出判据活没活)
            if sender:
                self._av_stat[0 if avatar else 1] += 1

            # ★连击去重(修"一个礼物触发两次")：抖音把「一次送礼(连击)」分多帧下发——连击数递增、末帧 repeatEnd=1，
            #   每帧 Common.msgId 都不同 → msgId 去重挡不住。同一次连击 group_id 相同，按 group_id 记「已触发到第几连击」，
            #   只补触发「新增的那几次」(delta)。单送一次也是这条路：第2帧 delta=0 直接跳过 → 只触发一次。
            #   关键边界：同一 group 的旧连击结束/中断后，下一笔可能又从 1 开始。旧版只存最大值，
            #   例如 50 箭被网络打断后下一笔 1..N 永远小于 50，于是整笔被静默吞掉。
            #   group_id 抠不到(=0)时退回「每帧照发」的旧行为(不会漏发/静默)，此时仍有上游 msgId 去重兜底重复下发。
            total = combo if combo else 1
            if repeat and repeat > total:
                total = repeat
            fire_n = total
            # 计算、回调、提交放在同一把锁里：另一个抓取线程不能在回调失败前把同一连击
            # 当成已处理。最关键的是 `_gift_fired` 只能在 fired_ok 后更新。
            with self._gift_lock:
                key = None
                now = time.monotonic()
                known = False
                prev = 0
                ended = False
                restart = False
                if group_id:
                    key = "%d:%s" % (group_id, name)     # 加名字防 group_id 万一跨礼物撞号
                    known = key in self._gift_fired
                    prev = self._gift_fired.get(key, 0)
                    ended = self._gift_ended.get(key, False)
                    last_seen = self._gift_seen_at.get(key, 0.0)

                    # repeatEnd 是分界，但只有明确相同的 msgId 才能判定是同一终帧重投。
                    # msgId 缺失或不同都按新一轮处理，避免「旧50结束后新1」被终帧规则吞掉。
                    if known:
                        # ★★2026-09-07 真机实锤：抖音的 repeatEnd 终帧在首帧约 3 秒后才到，
                        #   底下那条「同连击数 + 超 3 秒 ⇒ 新一笔」的启发式会把终帧判成新连击，
                        #   prev 清零后整笔连击数再发一遍 → 用户点 1 个 + 连击 3 个，游戏里放了 8 次。
                        #   终帧只负责收尾：它报的连击数不超过已发数时，一律不放、只锁存状态。
                        #   （终帧报得比已发的多 = 中间帧丢了，那就往下走 delta 只补差额。）
                        if repeat_end and total <= prev:
                            self._gift_ended[key] = True
                            self._gift_end_msg[key] = msg_id
                            self._gift_seen_at[key] = now
                            return True
                        if ended:
                            restart = True
                        elif total < prev:
                            restart = True
                        elif total == prev and now - last_seen > 3.0:
                            restart = True

                    if restart:
                        prev = 0
                    fire_n = total - prev
                    if fire_n <= 0:
                        # 常见的中间帧重投没有新增连击；终帧状态仍要锁存，供下一笔复用 group。
                        if repeat_end:
                            self._gift_ended[key] = True
                            self._gift_end_msg[key] = msg_id
                        self._gift_seen_at[key] = now
                        return True
                # 不截断真实连击数：x99、x500 以及更高的连送必须原样交给可恢复的 mod 队列。
                # int() 本身仍会在协议损坏时抛异常，由外层按本条派发失败处理，不伪造一个数量。
                fire_n = max(1, int(fire_n))

                # 回调签名从长到短逐个试：新的收 coins，老的收不了就退一格。
                #   回调返回 False 表示桥没有接收/落盘成功，不能推进去重状态；None 继续视为旧版成功。
                #   回调内部抛出的异常也不推进状态，下一帧可重试。
                fired_ok = False
                for a in ((name, fire_n, sender or None, avatar or None, coins, gift_img),
                          (name, fire_n, sender or None, avatar or None, coins),
                          (name, fire_n, sender or None, avatar or None),
                          (name, fire_n, sender or None),
                          (name, fire_n)):
                    try:
                        result = self.on_gift(*a)
                        if result is False:
                            self._diag_err["gift:回调拒绝"] = self._diag_err.get("gift:回调拒绝", 0) + 1
                            break
                        fired_ok = True
                        break
                    except TypeError as e:
                        # 只有"参数个数对不上"才降级重试；回调体内自己抛的 TypeError 不该重发
                        if "positional argument" not in str(e) and "argument" not in str(e):
                            self._diag_err["gift:TypeError"] = self._diag_err.get("gift:TypeError", 0) + 1
                            break
                        continue
                    except Exception as e:
                        k = "gift:%s" % type(e).__name__
                        self._diag_err[k] = self._diag_err.get(k, 0) + 1
                        break
                if not fired_ok:
                    # 派发失败时不提交 group/count；相同消息或下一帧增量可以再次尝试。
                    self._diag_err["gift:派发失败"] = self._diag_err.get("gift:派发失败", 0) + 1
                    return False

                if key:
                    # ★只在首次成功提交时入队：队列 = 去重的「连击个数」而非「帧数」。
                    if not known:
                        self._gift_q.append(key)
                    self._gift_fired[key] = total
                    self._gift_ended[key] = bool(repeat_end)
                    self._gift_end_msg[key] = msg_id if repeat_end else None
                    self._gift_seen_at[key] = now
                self._fired["gift"] = self._fired.get("gift", 0) + fire_n
                return True
        elif method == "WebcastLikeMessage":
            # LikeMessage: 2=count 5=user(点赞人)。先扫全字段拿 count，再抠昵称，一次性回调。
            cnt = None
            for fn, wt, v in _iter_fields(mp):
                if fn == 2 and wt == 0: cnt = int(v)
            if cnt is not None:
                nick = self._nick_from(mp, 5)
                try: self.on_like(cnt, nick)
                except TypeError:
                    try: self.on_like(cnt)
                    except Exception: pass
                except Exception: pass
            return
        elif method == "WebcastSocialMessage":
            # 关注/分享：SocialMessage{ common=1, user=2, action=3 }。
            #   ★7-18 真直播普查实锤: Social.action={None: 2} ——现网 SocialMessage 压根不带
            #   field3,老判据 action==1 永假,关注从上线起一次都没触发过。改成「无 action 也算关注」。
            #   取舍:若分享消息也是无 action 的 Social,会被误当关注——关注奖励很轻,误触可接受;
            #   普查继续记 action 分布,哪天 Social 数远超合理关注数再回来加判据。
            action = None
            for fn, wt, v in _iter_fields(mp):
                if fn == 3 and wt == 0:
                    action = v
            self._social_actions[action] = self._social_actions.get(action, 0) + 1
            if action == 1 or action is None:
                self._fire("follow", self.on_follow, mp, 2)
            return
        elif method == "WebcastFansclubMessage":
            # 粉丝团(灯牌)升级/加入/点亮——最干净的「灯牌」信号。user 一般在 field4。
            self._fire("badge", self.on_badge, mp, 4)
            return
        elif method == "WebcastChatMessage":
            # 弹幕：ChatMessage{ common=1, user=2, content=3 }。content 是 field3 的 utf-8 文本。
            content = None
            for fn, wt, v in _iter_fields(mp):
                if fn == 3 and wt == 2:
                    try:
                        # 压成一行：弹幕里的换行会让 stdout 多出一行伪造的「礼物: …」事件（连接器再压一次，双保险）
                        content = " ".join(v.decode("utf-8", "ignore").split())
                    except Exception:
                        content = None
                    break
            if content:
                nick, avatar = self._user_from(mp, 2)
                self._call_with_avatar("chat", self.on_chat, (nick, content), avatar)
            return
        elif method == "WebcastMemberMessage":
            # 进场：普通观众也回调（AI 语音「欢迎XX」用），带灯牌的仍算灯牌事件。
            #   2026-09-13 起把 user.avatar_thumb 一并交给回调：客户端「大哥进场」名单/横幅给只进场不送礼的观众配头像。
            m_nick, m_avatar = self._user_from(mp, 2)
            if m_nick:
                self._call_with_avatar("member", self.on_member, (m_nick,), m_avatar)
            if self._member_has_badge(mp):
                self._member_badge[0] += 1
                self._fire("badge", self.on_badge, mp, 2)
            else:
                self._member_badge[1] += 1
            return
        elif method == "WebcastControlMessage":
            for fn, wt, v in _iter_fields(mp):
                if fn == 2 and wt == 0 and v == 3:
                    self._ended = True
                    self.on_status("直播已结束")
                    try: self._ws.close()
                    except Exception: pass

    # 从一条消息里取「用户昵称 + 头像 URL」：user 子消息在 user_field；昵称=_nick_in_user，头像=_avatar_in_user(抽不到 None)。
    #   进场/弹幕用它——抖音的 MemberMessage/ChatMessage 的 user 子消息和礼物一样带 avatar_thumb.url_list，
    #   以前只在礼物里抽，进场观众的头像其实一直就在帧里没人要。
    def _user_from(self, mp, user_field):
        try:
            for fn, wt, v in _iter_fields(mp):
                if fn == user_field and wt == 2:
                    nick = self._nick_in_user(v)
                    nick = " ".join(str(nick).split()) if nick else nick
                    avatar = None
                    try:
                        avatar = self._avatar_in_user(v)
                    except Exception:
                        avatar = None
                    return nick, avatar
        except Exception:
            pass
        return None, None

    def _call_with_avatar(self, kind, cb, args, avatar):
        """先按新签名 cb(*args, avatar) 调；老回调(不收 avatar)抛 TypeError 就退回 cb(*args)。
           回调内部的异常同 _fire：不拖垮连接，但记进 _diag_err(只留类型名)，绝不静默吞掉。"""
        try:
            try:
                cb(*(args + (avatar,)))
            except TypeError:
                cb(*args)
        except Exception as e:
            k = "%s:%s" % (kind, type(e).__name__)
            self._diag_err[k] = self._diag_err.get(k, 0) + 1

    # 从一条消息里取「用户昵称」：user 子消息在 user_field，昵称一般是 user.field3(nickName)。
    def _nick_from(self, mp, user_field):
        try:
            for fn, wt, v in _iter_fields(mp):
                if fn == user_field and wt == 2:
                    nick = self._nick_in_user(v)
                    # 昵称压成一行（同弹幕，防换行伪造事件行）
                    return " ".join(str(nick).split()) if nick else nick
        except Exception:
            pass
        return None

    @staticmethod
    def _nick_in_user(user):
        fallback = None
        try:
            for ufn, uwt, uv in _iter_fields(user):
                if uwt != 2:
                    continue
                try: s = uv.decode("utf-8").strip()
                except Exception: continue
                if ufn == 3 and s:
                    return s
                if fallback is None and 2 <= len(s) <= 30 and not s.isdigit() and s.isprintable():
                    fallback = s
        except Exception:
            pass
        return fallback

    @staticmethod
    def _avatar_in_user(user, depth=0):
        # 从 user 子消息里递归找头像 URL。
        #   ★用 protobuf 逐字段解析(每段自带长度→边界精确),不能像正则扫整段那样把后续字节吞进 URL。
        #   ★判据两级(7-20 真直播 Gift=201 头像零下载的教训:抖音头像迁到 tos-cn-avt-xxx 桶,
        #     URL 里再无 "avatar" 字样,老判据 "avatar" in s 整场沉默):
        #     高置信=URL 含 avatar 或 -avt-；候补=图床域名(douyinpic/byteimg/pstatp)的首条。
        #   协议相对 "//p3-..." 补 https:。抠不到=None(mod 端回落首字色块)。
        #   深度封顶4、只在礼物到来时跑一次,零性能负担、抗字段漂移。
        urls = []
        DouyinLiveRoom._collect_urls(user, 0, urls)
        best = None
        for s in urls:
            if ("avatar" in s) or ("-avt-" in s):
                best = s
                break
        if best is None:
            for s in urls:
                if ("douyinpic" in s) or ("byteimg" in s) or ("pstatp" in s):
                    best = s
                    break
        if best and best.startswith("//"):
            best = "https:" + best
        return best

    @staticmethod
    def _collect_urls(node, depth, out):
        # 收集 user 子树里所有像 URL 的串(含协议相对 // 开头)。误收无害——上层还有关键词筛选;
        # 封顶 12 条防怪消息。能 decode 成 URL 的不再当嵌套消息递归(URL 不会是子消息)。
        if depth > 4 or len(out) >= 12:
            return
        try:
            for fn, wt, v in _iter_fields(node):
                if wt != 2:
                    continue
                try: s = v.decode("utf-8")
                except Exception: s = None
                if s and (s.startswith("http") or s.startswith("//")):
                    out.append(s)
                    continue
                DouyinLiveRoom._collect_urls(v, depth + 1, out)
        except Exception:
            pass

    # 进场的观众是否「带粉丝团灯牌」：MemberMessage.user=field2 里找 FansClub.data{ clubName(1,str)+level(2,varint>=1) }。
    #   够特征化(同一子消息里既有名字串又有小等级数)才认，尽量不误把普通游客当灯牌。抠不到=False(那次进场不触发)。
    def _member_has_badge(self, mp):
        try:
            for fn, wt, v in _iter_fields(mp):
                if fn == 2 and wt == 2:
                    return self._scan_fansclub_level(v, 0)
        except Exception:
            pass
        return False

    def _scan_fansclub_level(self, buf, depth):
        if depth > 4:
            return False
        try:
            for fn, wt, v in _iter_fields(buf):
                if wt != 2:
                    continue
                has_name = False; lvl = 0
                try:
                    for cfn, cwt, cv in _iter_fields(v):
                        if cfn == 1 and cwt == 2:
                            try:
                                if cv.decode("utf-8").strip():
                                    has_name = True
                            except Exception:
                                pass
                        elif cfn == 2 and cwt == 0:
                            lvl = cv
                except Exception:
                    pass
                if has_name and 1 <= lvl <= 300:
                    return True
                if self._scan_fansclub_level(v, depth + 1):
                    return True
        except Exception:
            pass
        return False

    def _send_ack(self, ws, log_id, internal_ext):
        try:
            import websocket
            buf = bytearray()
            if log_id:
                buf += bytes([0x10]) + _encode_varint(log_id)         # field2 logId
            buf += bytes([0x3A, 0x03]) + b"ack"                        # field7 payloadType="ack"
            buf += bytes([0x42]) + _encode_varint(len(internal_ext)) + internal_ext  # field8 payload
            ws.send(bytes(buf), websocket.ABNF.OPCODE_BINARY)
        except Exception:
            pass

    def _on_error(self, ws, err):
        s = str(err)
        # 抖音限流：短时间内开太多房间连接 → 握手返回 "too many rooms"(status 411)。这是临时节流，退避重连即可，
        #   别把整坨握手头 dump 给主播吓人。标记一下，run() 里据此退避重连。
        if "too many rooms" in s or "'handshake-status': '411'" in s or "status 411" in s.lower():
            self._throttled = True
            self.on_status("抖音限流(连太频繁)：稍等自动重连；若一直连不上，等两三分钟再点连接。")
        else:
            self.on_status("连接出错：%s" % (s[:120]))

    def _on_close(self, ws, *a):
        pass

    # ---------------- 主入口 ----------------
    def run(self, stop_event):
        self._stop = stop_event
        try:
            import requests
            import websocket
        except Exception as e:
            self.on_status("连不上：缺依赖(%s)。请运行: pip install requests websocket-client" % e.__class__.__name__)
            return False

        if self.cookie is None:
            self.on_status("提示：未放 douyin_cookie.txt，游客身份收不到「礼物」(点赞/弹幕正常)。详见 douyin_room.py 顶部说明。")

        sess = requests.Session()
        try:
            self._ttwid = self._fetch_ttwid(sess)
        except Exception as e:
            self.on_status("获取 ttwid 失败(%s)：网络/被墙/抖音改版" % e.__class__.__name__)
            return False
        if not self._ttwid:
            self.on_status("获取 ttwid 失败：抖音没下发设备票据")
            return False

        self.room_id = self._fetch_room_id(sess)
        if not self.room_id:
            return False   # _fetch_room_id 内部已 on_status

        wss = self._build_wss(self.room_id)
        sig = self._signature(wss)
        if not sig:
            return False   # _signature 内部已 on_status
        wss += "&signature=" + sig

        cookie_header = self.cookie if self.cookie else ("ttwid=" + self._ttwid)
        self._ws = websocket.WebSocketApp(
            wss,
            header={"cookie": _hdr_safe(cookie_header), "user-agent": UA},
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )

        t = threading.Thread(target=lambda: self._ws.run_forever(ping_interval=0), daemon=True)
        t.start()
        try:
            while not stop_event.is_set() and t.is_alive():
                stop_event.wait(0.5)
        finally:
            try: self._ws.close()
            except Exception: pass
        return True
