"""仅测试：平台备份副本 + 同一发行公钥，测试数据不回写原平台。"""
import json
import secrets
import shutil
import sys
import threading
from pathlib import Path

platform, data, backup = map(Path, sys.argv[1:4])
sys.path.insert(0, str(platform))
from app import create_app, create_admin
from werkzeug.serving import make_server, WSGIRequestHandler

data.mkdir(parents=True, exist_ok=False)
for name in ('license.sqlite3', 'storage.key', 'signing.key', 'mod-signing.key'):
    shutil.copy2(backup / name, data / name)
app = create_app({'DATA_DIR': data, 'IDENTITY_MODE': 'local', 'LEGACY_TOKEN_FILE': '', 'LEGACY_URL': ''})
admin_email = secrets.token_hex(8) + '@broker-owner.test'
create_admin(app, admin_email, secrets.token_urlsafe(24))
store = app.extensions['store']
codes = {}
with store.transaction() as c:
    actor = store.user(c, admin_email)['id']
    for name, product in [('platform', 'platform:assistant'), ('wheel', 'game:4wheel-challenge')]:
        sku = store.create_sku(c, actor, {'product_id': product, 'name': '临时验收', 'days': 7, 'permanent': False, 'price_cents': 1})
        batch = store.mint(c, actor, {'sku_id': sku['id'], 'quantity': 1})
        row = c.execute('SELECT code_cipher FROM cards WHERE batch_id=?', (batch['batch_id'],)).fetchone()
        codes[name] = store.cipher.decrypt(row['code_cipher']).decode()

class Quiet(WSGIRequestHandler):
    def log(self, *a, **kw):
        pass

server = make_server('127.0.0.1', 0, app, threaded=True, request_handler=Quiet)
print(json.dumps({'origin': 'http://127.0.0.1:' + str(server.server_port), 'publicKey': app.extensions['signing'].public()['key'], 'modKey': app.extensions['mod_signing'].public(), 'codes': codes}), flush=True)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    for line in sys.stdin:
        request = json.loads(line)
        if request['op'] == 'stop':
            break
        if request['op'] == 'bind':
            from room_rules import RoomRules
            with store.transaction() as c:
                RoomRules(store).bind(c, store.user(c, request['email'])['id'], request['room'])
            print(json.dumps({'ok': True}), flush=True)
        if request['op'] == 'grant':
            with store.transaction() as c:
                store.grant(c, actor, {'email': request['email'], 'product_id': request['product'], 'mode': request['mode'], 'reason': '隔离联调'})
            print(json.dumps({'ok': True}), flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join(5)
