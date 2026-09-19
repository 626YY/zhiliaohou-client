# -*- coding: utf-8 -*-
"""诊断上传的真服务器闭环验证：传上去 → 我这边按编号查得回来。

不闭环的话，主播点了上传、我却捞不到，功能等于没做。
这里模仿客户端的分片格式打一份带记号的假报告，再用管理令牌按编号取回来拼齐。

用法：python tools/verify-diag-upload-live.py
"""
import io
import json
import os
import random
import ssl
import string
import sys
import time
import urllib.request

BASE = "https://47.251.93.171:8770"
TOKEN_FILE = r"C:\wheellive\server\.wl_token_local.txt"

res = []


def ck(n, ok, d=""):
    res.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + n + (("  -- " + str(d)[:220]) if d else ""))


def post(url, obj):
    # 服务器是自签证书（指纹钉在客户端里）；这个脚本只做连通性验证，跳过链校验
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    body = json.dumps(obj).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return r.status, r.read().decode("utf-8", "replace")


def get(url, token):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"X-Admin-Token": token})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def main() -> int:
    token = io.open(TOKEN_FILE, encoding="utf-8").read().strip()
    ck("拿到管理令牌", bool(token))

    code = "%s-%s" % (time.strftime("%m%d"), "".join(random.choices(string.ascii_uppercase + string.digits, k=4)))
    marker = "ZLDIAGTEST-" + code
    # 客户端的分片格式：tag=diag，msg 带编号和「第x/y片」，stack 是报告正文
    parts = [marker + " 第一片正文" + "x" * 100, "第二片正文" + "y" * 100]
    entries = [
        {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": "diag",
         "msg": "诊断 %s dontscream 第%d/%d片" % (code, i + 1, len(parts)), "stack": s}
        for i, s in enumerate(parts)
    ]
    st, body = post(BASE + "/api/error", {"v": "0.3.25", "e": entries})
    ck("真服务器收下了上传（POST /api/error）", st == 200 and '"ok":1' in body.replace(" ", ""), "%s %s" % (st, body[:60]))

    time.sleep(1)
    data = get(BASE + "/api/errors?n=200", token)
    got = [e for e in data.get("errors", []) if code in str(e.get("msg", ""))]
    ck("按编号查得回来", len(got) == len(parts), "找到 %d 片（应有 %d）" % (len(got), len(parts)))
    if got:
        got.sort(key=lambda e: e["msg"])
        joined = "".join(e.get("stack", "") for e in got)
        ck("拼起来就是原报告（没被截断）", marker in joined and joined.endswith("y" * 100),
           "长度 %d" % len(joined))
        ck("版本号也记下来了", any(e.get("v") == "0.3.25" for e in got), [e.get("v") for e in got])
        ck("标签是 diag（能和普通报错分开筛）", all(e.get("tag") == "diag" for e in got))

    print("\n%d/%d 通过" % (sum(res), len(res)))
    print("（这条测试记录留在服务器 errors.jsonl 里，编号 %s，5MB 滚动会自然淘汰）" % code)
    return 0 if all(res) else 1


if __name__ == "__main__":
    sys.exit(main())
