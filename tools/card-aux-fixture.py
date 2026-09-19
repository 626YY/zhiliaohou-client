# 卡密模式辅助转发（通知 / 云配置 / 心跳 / 观众记录）端到端验收专用夹具：
#   - 起一个假「原邮箱服务」（../卡密系统/tests/fake_emailauth.py，本机自签 TLS）+ 一个明文 http 副本（给旧账号模式直连用）；
#   - 起一个完全隔离的本机卡密平台（../卡密系统/app.py:create_app，IDENTITY_MODE=existing 指向假服务，LEGACY_* 置空）：
#     绝不触碰真实旧后台 / 线上服务；数据目录由调用方指定，跑完可整目录删除；
#   - 控制面只经 stdin JSON：改假服务里的账号 / 通知 / 会话 / 故障开关、在平台上直接绑房、读加密会话表、扫描文件有没有泄露旧会话或密码。
#   本脚本不打印任何旧会话 / 密码；只回布尔结论。
# 用法：python tools/card-aux-fixture.py <卡密系统目录> <数据目录>
import json
import sqlite3
import sys
import threading
from pathlib import Path

platform_root = Path(sys.argv[1]).resolve()
data_dir = Path(sys.argv[2]).resolve()
data_dir.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(platform_root))
sys.path.insert(0, str(platform_root / 'tests'))

from app import create_app  # noqa: E402
from fake_emailauth import FIXED_CODE, FakeEmailAuth  # noqa: E402
from room_rules import RoomRules  # noqa: E402
from werkzeug.serving import WSGIRequestHandler, make_server  # noqa: E402


class Quiet(WSGIRequestHandler):
    def log(self, *args, **kwargs):
        pass


legacy = FakeEmailAuth(data_dir, tls=True)
legacy_http = FakeEmailAuth(data_dir, tls=False)
aux_token_file = data_dir / 'card_aux.token'
aux_token_file.write_text(legacy.card_aux_token, encoding='ascii')
app = create_app({
    'TESTING': True,
    'DATA_DIR': data_dir / 'platform',
    'IDENTITY_MODE': 'existing',
    'IDENTITY_URL': legacy.base,
    'IDENTITY_CA': str(legacy.ca),
    'ALLOW_EXISTING_REGISTRATION': True,
    'ADMIN_URL': '',
    'ADMIN_CA': '',
    'TRUST_PROXY': False,
    'COOKIE_SECURE': False,
    'LEGACY_TOKEN_FILE': '',
    'LEGACY_URL': '',
    'LEGACY_CA': '',
    'CARD_AUX_TOKEN_FILE': str(aux_token_file),
})
store = app.extensions['store']
server = make_server('127.0.0.1', 0, app, threaded=True, request_handler=Quiet)
print(json.dumps({
    'origin': 'http://127.0.0.1:%d' % server.server_port,
    'publicKey': app.extensions['signing'].public()['key'],
    'legacyHttpOrigin': legacy_http.base,
    'code': FIXED_CODE,
}), flush=True)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
passwords = set()


def secrets_known():
    tokens = set()
    for svc in (legacy, legacy_http):
        for acct in svc.accounts.values():
            tokens.update(acct['sessions'])
    return tokens | passwords


def leaks_in(raw):
    return [s for s in secrets_known() if s and s.encode('utf-8') in raw]


def handle(cmd):
    op = cmd.get('op')
    if op == 'legacy':
        svc = legacy_http if cmd.get('http') else legacy
        sub = cmd.get('cmd')
        if sub == 'add_account':
            passwords.add(cmd['password'])
            svc.add_account(cmd['email'], cmd['password'], int(cmd.get('licensed', 1)), cmd.get('binds') or ())
            return {'ok': True}
        if sub == 'push_notify':
            return {'ok': True, 'id': svc.push_notify(cmd['email'], cmd.get('text', ''), cmd.get('kind', 'grant'))}
        if sub == 'revoke':
            svc.revoke(cmd['email'])
            return {'ok': True}
        if sub == 'state':
            return {'ok': True, 'state': svc.state(cmd['email'])}
        if sub == 'calls':
            return {'ok': True, 'calls': svc.calls_for(cmd.get('path'))}
        if sub == 'reset_calls':
            svc.reset_calls()
            return {'ok': True}
        if sub == 'set':
            if 'down' in cmd:
                svc.down = bool(cmd['down'])
            if 'fail_live' in cmd:
                svc.fail_live = bool(cmd['fail_live'])
            if 'licensed' in cmd:
                svc.accounts[cmd['email']]['licensed'] = int(cmd['licensed'])
            return {'ok': True}
        if sub == 'room_events':
            return {'ok': True, 'events': svc.room_events(cmd['room'])}
        if sub == 'sessions':
            return {'ok': True, 'count': len(svc.session_tokens(cmd['email']))}
        return {'ok': False, 'error': 'unknown legacy cmd'}
    if op == 'platform_bind':
        with store.transaction() as c:
            user = store.user(c, cmd['email'])
            quota = RoomRules(store).bind(c, user['id'], cmd['room'])
        return {'ok': True, 'rooms': quota['rooms']}
    if op == 'platform_rooms':
        with store.transaction(False) as c:
            user = store.user(c, cmd['email'])
            return {'ok': True, 'rooms': RoomRules(store).state(c, user['id'])['rooms']}
    if op == 'identity_rows':
        db = data_dir / 'platform' / 'license.sqlite3'
        with sqlite3.connect(db) as c:
            rows = c.execute('SELECT session_cipher FROM identity_sessions').fetchall()
        known = secrets_known()
        decrypted = [store.cipher.decrypt(r[0].encode()).decode() for r in rows]
        raw = db.read_bytes()
        for extra in ('license.sqlite3-wal', 'license.sqlite3-shm'):
            p = data_dir / 'platform' / extra
            if p.exists():
                raw += p.read_bytes()
        return {'ok': True, 'count': len(rows), 'all_match_legacy': all(d in known for d in decrypted),
                'plaintext_in_db': bool(leaks_in(raw)), 'cipher_is_plain': any(r[0] in known for r in rows)}
    if op == 'scan':
        leaked = []
        for p in cmd.get('paths') or []:
            path = Path(p)
            if path.exists() and leaks_in(path.read_bytes()):
                leaked.append(p)
        if leaks_in(str(cmd.get('text') or '').encode('utf-8')):
            leaked.append('<text>')
        return {'ok': True, 'leaked': leaked, 'known': len(secrets_known())}
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
        except Exception as e:  # 夹具错误原样回给调用方（不含凭据）
            reply = {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
        print(json.dumps(reply, ensure_ascii=False), flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
    legacy.close()
    legacy_http.close()
