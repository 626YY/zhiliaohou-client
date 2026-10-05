# -*- coding: utf-8 -*-
# B 站房间模块离线解析验收：构造合成的 B 站弹幕包（含 zlib 压缩批包），
# 喂进 BilibiliLiveRoom 的解码/派发，断言各类事件被正确映射（不连网、不碰真实直播间）。
# 用 pyembed python 跑：  知了猴客户端/pyembed/python.exe tools/test-bilibili-room.py
import os
import sys
import json
import zlib
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "connector-assets"))

from bilibili_room import BilibiliLiveRoom  # noqa

HEADER = struct.Struct(">IHHII")


def pack(body, op, pver):
    return HEADER.pack(HEADER.size + len(body), HEADER.size, pver, op, 1) + body


def cmd_packet(obj):
    return pack(json.dumps(obj).encode("utf-8"), 5, 0)  # op=5 message, protover=0 原始


def batch_zlib(objs):
    inner = b"".join(cmd_packet(o) for o in objs)
    return pack(zlib.compress(inner), 5, 2)  # op=5 message, protover=2 zlib 批包


events = []
room = BilibiliLiveRoom(
    "123",
    on_gift=lambda name, cnt, sender=None, avatar=None, coins=None, gift_img=None: events.append(("gift", name, cnt, sender, coins)),
    on_chat=lambda nick, content, avatar=None: events.append(("chat", nick, content)),
    on_member=lambda nick, avatar=None: events.append(("member", nick)),
    on_follow=lambda nick=None: events.append(("follow", nick)),
    on_like=lambda delta, nick=None: events.append(("like", delta, nick)),
    on_living=lambda: events.append(("living",)),
)

cmds = [
    {"cmd": "DANMU_MSG", "info": ["x", "你好主播", [66, "弹幕君", 0, 0], [], [], []]},
    {"cmd": "SEND_GIFT", "data": {"giftName": "小心心", "num": 3, "uname": "土豪甲", "face": "http://x/a.jpg", "coin_type": "gold", "price": 100}},
    {"cmd": "SEND_GIFT", "data": {"giftName": "辣条", "num": 10, "uname": "白嫖乙", "coin_type": "silver", "price": 100}},
    {"cmd": "GUARD_BUY", "data": {"gift_name": "舰长", "num": 1, "username": "舰长丙"}},
    {"cmd": "INTERACT_WORD", "data": {"uname": "路人丁", "msg_type": 1}},
    {"cmd": "INTERACT_WORD", "data": {"uname": "新粉戊", "msg_type": 2}},
    {"cmd": "LIKE_INFO_V3_CLICK", "data": {"uname": "点赞己"}},
]

# 先走一遍压缩批包解码（验证 _iter_json 的 zlib + 嵌套拆包）
decoded = list(room._iter_json(batch_zlib(cmds)))
assert len(decoded) == len(cmds), "zlib 批包解码数量不符: %d != %d" % (len(decoded), len(cmds))
for m in decoded:
    room._dispatch(m)

# 下播包
for m in room._iter_json(cmd_packet({"cmd": "PREPARING"})):
    room._dispatch(m)

checks = 0


def need(cond, msg):
    global checks
    assert cond, "FAIL: " + msg
    checks += 1
    print("PASS " + msg)


need(("living",) in events, "首条命令触发 on_living")
need(("chat", "弹幕君", "你好主播") in events, "DANMU_MSG → 弹幕(昵称+内容)")
need(("gift", "小心心", 3, "土豪甲", 100) in events, "SEND_GIFT 金瓜子 → 礼物带分值")
need(("gift", "辣条", 10, "白嫖乙", None) in events, "SEND_GIFT 银瓜子(免费) → 礼物分值为空")
need(("gift", "舰长", 1, "舰长丙", None) in events, "GUARD_BUY 上舰 → 礼物")
need(("member", "路人丁") in events, "INTERACT_WORD msg_type=1 → 进场")
need(("follow", "新粉戊") in events, "INTERACT_WORD msg_type=2 → 关注")
need(("like", 1, "点赞己") in events, "LIKE_INFO_V3_CLICK → 点赞")
need(room._ended is True, "PREPARING → _ended 置位(触发外层停重连)")

# 诊断计数
cen = room.census_text()
need("gift=2" in cen and "guard=1" in cen and "chat=1" in cen and "member=1" in cen and "follow=1" in cen and "like=1" in cen, "census 计数正确: " + cen)

# 原始(未压缩 protover=0)也能解
raw = list(room._iter_json(cmd_packet({"cmd": "DANMU_MSG", "info": ["x", "原始包", [1, "直连君"], []]})))
need(len(raw) == 1 and raw[0].get("cmd") == "DANMU_MSG", "protover=0 原始包也能解码")

print("\nBILIBILI ROOM: %d/%d PASS" % (checks, checks))
