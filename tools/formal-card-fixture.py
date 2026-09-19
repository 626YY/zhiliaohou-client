# 正式客户端卡密端到端验收专用：起一个完全隔离的本机卡密平台（../卡密系统/app.py:create_app）。
#   - TESTING + IDENTITY_MODE=local + LEGACY_TOKEN_FILE/LEGACY_URL 置空：绝不触碰真实旧后台 / 线上服务；
#   - 数据目录由调用方指定（output/playwright/formal-card-e2e/service-*），跑完可整目录删除；
#   - 制卡 / 收回 / 直授 / 指定到期 只经 stdin JSON 命令直接走 Store（夹具控制面），不开管理后台、不走 HTTP 管理口；
#   - 卡密与公钥只在启动时通过 stdout 一行 JSON 交给调用方（进内存），本脚本不写日志、不打印卡密。
# 用法：python tools/formal-card-fixture.py <卡密系统目录> <数据目录> [端口]
#   端口：给了就固定监听（0 / 不给 = 随机）。数据目录里已有 license.sqlite3 时按「平台重启」复用（不再建管理员、不再制卡，
#   cards 回空对象），e2e 用它演「平台挂了又起来」。
#   stdin 每行一个命令：{"op":"grant","email":..,"product":..,"mode":"revoke|permanent|extend|set_expiry",...}
#                     {"op":"rights","email":..} / {"op":"now"} / {"op":"shutdown"}
#                     {"op":"mirror","email":..,"machine":<机器码原文>} → 离线凭证镜像包（offline_lease.build_bundle，同 lease_mirror.py）
import json
import sys
import threading
from pathlib import Path

platform_root = Path(sys.argv[1]).resolve()
data_dir = Path(sys.argv[2]).resolve()
port = int(sys.argv[3]) if len(sys.argv) > 3 else 0
reuse = (data_dir / 'license.sqlite3').exists()
sys.path.insert(0, str(platform_root))

import secrets  # noqa: E402

from app import create_admin, create_app  # noqa: E402
from core import PLATFORM  # noqa: E402
from werkzeug.serving import WSGIRequestHandler, make_server  # noqa: E402


class Quiet(WSGIRequestHandler):
    def log(self, *args, **kwargs):  # 不往 stderr 刷访问日志（里面会有 URL，不含卡密，但也没必要）
        pass


app = create_app({
    'TESTING': True,
    'DATA_DIR': data_dir,
    'IDENTITY_MODE': 'local',
    'ADMIN_URL': '',
    'ADMIN_CA': '',
    'TRUST_PROXY': False,
    'COOKIE_SECURE': False,
    'LEGACY_TOKEN_FILE': '',
    'LEGACY_URL': '',
    'LEGACY_CA': '',
})
store = app.extensions['store']
# 制卡批次 / 审计要一个真实的管理员账号做 actor；密码随机生成后即丢弃，不输出、不用于登录
if not reuse:
    create_admin(app, 'fixture-admin@example.test', secrets.token_urlsafe(24))
with store.transaction(False) as c:
    ACTOR = store.user(c, 'fixture-admin@example.test')['id']

# 制卡：娱乐助手周卡 ×3、图书管理员月卡 ×3（都标成已导出，和真实发放状态一致）
cards = {}
with store.transaction() as c:
  if not reuse:
    for key, (product, name, days) in {
        'platform': (PLATFORM, '娱乐助手周卡', 7),
        'librarian': ('game:librarian', '图书管理员月卡', 30),
    }.items():
        sku = store.create_sku(c, ACTOR, {'product_id': product, 'name': name, 'days': days, 'permanent': False, 'price_cents': 1})
        batch = store.mint(c, ACTOR, {'sku_id': sku['id'], 'quantity': 3})
        rows = c.execute('SELECT code_cipher FROM cards WHERE batch_id=? ORDER BY id', (batch['batch_id'],)).fetchall()
        c.execute("UPDATE cards SET state='allocated',exported_at=? WHERE batch_id=?", (store.now(), batch['batch_id']))
        cards[key] = [store.cipher.decrypt(r['code_cipher']).decode() for r in rows]

server = make_server('127.0.0.1', port, app, threaded=True, request_handler=Quiet)
print(json.dumps({
    'origin': 'http://127.0.0.1:%d' % server.server_port,
    'publicKey': app.extensions['signing'].public()['key'],
    'cards': cards,
}), flush=True)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()


def handle(cmd):
    op = cmd.get('op')
    if op == 'bind':
        from room_rules import RoomRules
        with store.transaction() as c:
            user = store.user(c, cmd.get('email'))
            return {'ok': True, 'room_quota': RoomRules(store).bind(c, user['id'], cmd['room'])}
    if op == 'now':
        return {'ok': True, 'now': store.now()}
    if op == 'mirror':
        import offline_lease
        with store.transaction(False) as c:
            user = store.user(c, cmd.get('email'))
            rights = store.rights(c, user['id'])['rights']
            hours = offline_lease.hours_value(store.setting(c, offline_lease.SETTING, ''))
        digest = offline_lease.machine_hash(cmd['machine'])
        bundle = offline_lease.build_bundle(app.extensions['signing'], {'id': user['id'], 'email': user['email']}, rights, digest, hours, store.now())
        return {'ok': True, 'key': offline_lease.mirror_key(user['email'], digest), 'bundle': bundle}
    if op == 'rights':
        with store.transaction(False) as c:
            user = store.user(c, cmd.get('email'))
            return {'ok': True, **store.rights(c, user['id'])}
    if op == 'grant':
        body = {'email': cmd.get('email'), 'product_id': cmd.get('product'), 'mode': cmd.get('mode'), 'reason': 'e2e fixture'}
        for k in ('days', 'expires_at'):
            if k in cmd:
                body[k] = cmd[k]
        with store.transaction() as c:
            result = store.grant(c, ACTOR, body)
        return {'ok': True, **result}
    return {'ok': False, 'error': 'unknown op: %s' % op}


try:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except ValueError:
            print(json.dumps({'ok': False, 'error': 'bad json'}), flush=True)
            continue
        if cmd.get('op') == 'shutdown':
            print(json.dumps({'ok': True}), flush=True)
            break
        try:
            reply = handle(cmd)
        except Exception as e:  # 夹具错误原样回给调用方（不含卡密）
            reply = {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
        print(json.dumps(reply), flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
