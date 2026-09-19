// 主进程卡密平台授权集成验收（真实隐藏 Electron + 本测试私有的卡密平台服务 + 隔离 profile）：
//   无配置 → 旧账号系统原样可用、全部 IPC 通道仍在、非主窗口的请求被拒；
//   配置无效 → 明确报错、不回退旧服务器；
//   配置合法 → 登录错误 / 注册 / 记住密码隔离 / 未授权门禁 / 分产品授权 / 后台收回 / 换账号 / 平台掉线 / 退出。
// 卡密与密码只在本测试进程内存里，不打印、不落日志；不启动游戏、不连真实直播、不碰用户 profile。
// 房间这里只验「无扫码 proof 不能提交」与服务端绑定状态同步；扫码/核实/改绑全链见 test-card-room-main.mjs / test-card-room-ui.mjs。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.env.ZL_CARD_OUT_DIR || 'output/fable-formal-auth-build'
const output = path.join(root, 'output/playwright/card-provider')
const platformRoot = path.resolve(root, '../卡密系统')
await fs.mkdir(output, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))
await fs.access(path.join(platformRoot, 'app.py'))

const CARD = /ZL-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}/g
const mask = (text) => String(text).replace(CARD, 'ZL-****')
const checks = []
function check(name, value = true) {
  assert.ok(value, name)
  checks.push(name)
  console.log('PASS ' + name)
}
const wait = async (fn, label, ms = 10000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(label)
}

// ---- 私有卡密平台服务：数据在本测试目录，管理员密码 / 卡密只经管道进内存 ----
const serviceDir = path.join(output, 'service-' + Date.now())
await fs.mkdir(serviceDir, { recursive: true })
const bootstrapPy = `
import json, secrets, sys, threading
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(platformRoot)})
from app import create_app, create_admin
from core import PLATFORM
from flask import request, jsonify
from room_rules import RoomRules
from werkzeug.serving import make_server, WSGIRequestHandler
class Quiet(WSGIRequestHandler):
    def log(self, *a, **k): pass
data = Path(sys.argv[1]).resolve()
app = create_app({'DATA_DIR': data, 'IDENTITY_MODE': 'local', 'ADMIN_URL': '', 'TRUST_PROXY': False, 'COOKIE_SECURE': False, 'LEGACY_TOKEN_FILE': '', 'LEGACY_URL': ''})
admin_password = secrets.token_urlsafe(24)
create_admin(app, 'owner@example.test', admin_password)
store = app.extensions['store']
fixture_key = secrets.token_urlsafe(32)
@app.post('/__fixture__/bind')
def fixture_bind():
    if not secrets.compare_digest(request.headers.get('X-Fixture-Key', ''), fixture_key):
        return jsonify(ok=False), 403
    value = request.get_json()
    with store.transaction() as c:
        user = store.user(c, value['email'])
        quota = RoomRules(store).bind(c, user['id'], value['room'])
    return jsonify(ok=True, quota=quota)
cards = {}
with store.transaction() as c:
    owner = store.user(c, 'owner@example.test')['id']
    for key, (product, name, days, permanent) in {'platform': (PLATFORM, '娱乐助手周卡', 7, False), 'librarian': ('game:librarian', '图书管理员月卡', 30, False)}.items():
        sku = store.create_sku(c, owner, {'product_id': product, 'name': name, 'days': days, 'permanent': permanent, 'price_cents': 1})
        batch = store.mint(c, owner, {'sku_id': sku['id'], 'quantity': 3})
        rows = c.execute('SELECT code_cipher FROM cards WHERE batch_id=?', (batch['batch_id'],)).fetchall()
        c.execute("UPDATE cards SET state='allocated',exported_at=? WHERE batch_id=?", (store.now(), batch['batch_id']))
        cards[key] = [store.cipher.decrypt(r['code_cipher']).decode() for r in rows]
server = make_server('127.0.0.1', 0, app, threaded=True, request_handler=Quiet)
print(json.dumps({'origin': 'http://127.0.0.1:%d' % server.server_port, 'publicKey': app.extensions['signing'].public()['key'], 'cards': cards, 'fixtureKey': fixture_key, 'admin': {'email': 'owner@example.test', 'password': admin_password}}), flush=True)
t = threading.Thread(target=server.serve_forever, daemon=True); t.start()
try:
    sys.stdin.readline()
finally:
    server.shutdown(); server.server_close(); t.join(timeout=5)
`
await fs.writeFile(path.join(serviceDir, 'bootstrap.py'), bootstrapPy, 'utf8')
const service = spawn(process.env.ZL_TEST_PYTHON || 'python', [path.join(serviceDir, 'bootstrap.py'), path.join(serviceDir, 'data')], { cwd: serviceDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let serviceErr = ''
service.stderr.on('data', (d) => { serviceErr += d.toString() })
const platform = await new Promise((resolve, reject) => {
  let text = ''
  const timeout = setTimeout(() => reject(new Error('平台服务启动超时：' + serviceErr)), 30000)
  service.once('exit', () => { clearTimeout(timeout); reject(new Error('平台服务退出：' + serviceErr)) })
  service.stdout.on('data', (chunk) => {
    text += chunk.toString()
    if (text.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(text.split('\n')[0])) }
  })
})
let serviceAlive = true
service.on('exit', () => { serviceAlive = false })
const stopService = () => { if (serviceAlive) { try { service.stdin.end('\n') } catch { /* 已退出 */ } setTimeout(() => { if (serviceAlive) service.kill() }, 2000).unref() } }

// ---- 后台管理员操作（收回 / 直授）：node:http，不带 Origin ----
function httpJson(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(platform.origin + urlPath)
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = ''
      res.on('data', (d) => { text += d })
      res.on('end', () => { try { resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(text) }) } catch { resolve({ status: res.statusCode, headers: res.headers, json: null }) } })
    })
    req.on('error', reject)
    req.end(data)
  })
}
let admin = null
async function adminGrant(email, product, mode, extra = {}) {
  if (!admin) {
    const login = await httpJson('POST', '/api/v1/login', { email: platform.admin.email, password: platform.admin.password })
    assert.equal(login.status, 200, '管理员登录失败')
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('zl_license_session='))
    admin = { cookie, csrf: login.json.csrf }
  }
  const r = await httpJson('POST', '/api/admin/grants', { email, product_id: product, mode, reason: 'card-provider 验收', ...extra }, { Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf, 'Idempotency-Key': randomUUID() })
  assert.ok(r.json && r.json.ok, '后台授权操作失败：' + mask(JSON.stringify(r.json)))
}

// ---- 隐藏 Electron ----
const electronExe = path.join(root, 'node_modules/electron/dist/electron.exe')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
async function launch(providerConfig) {
  const profile = await fs.mkdtemp(path.join(output, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { outDir })
  // 即使将来误把旧直接绑定入口加回测试，也不能访问真实扫码页面或外部浏览器。
  const guarded = await fs.readFile(entry, 'utf8')
  const marker = '  global.__zhiliaoHiddenTest = '
  assert.equal(guarded.split(marker).length, 2, '隐藏测试引导位置不唯一')
  await fs.writeFile(entry, guarded.replace(marker, `
  global.__cardProviderExternalAttempts = 0;
  const loadURL = NativeWindow.prototype.loadURL;
  NativeWindow.prototype.loadURL = function(url, ...args) {
    const parsed = new URL(url);
    if (/^https?:$/.test(parsed.protocol) && (parsed.hostname === 'douyin.com' || parsed.hostname.endsWith('.douyin.com'))) {
      global.__cardProviderExternalAttempts++;
      return Promise.reject(new Error('本测试禁止打开真实抖音扫码页面'));
    }
    return loadURL.call(this, url, ...args);
  };
  facade.shell = { ...electron.shell, openExternal: async () => {
    global.__cardProviderExternalAttempts++;
    throw new Error('本测试禁止打开外部浏览器');
  } };
${marker}`), 'utf8')
  if (providerConfig !== undefined) await fs.writeFile(path.join(profile, 'license-provider.json'), typeof providerConfig === 'string' ? providerConfig : JSON.stringify(providerConfig), 'utf8')
  const app = await electron.launch({ executablePath: electronExe, args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push(mask(e.message)))
  await page.waitForFunction(() => !!window.api?.cardState)
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须使用本次隔离 profile')
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
  return { app, page, profile, api, errors }
}
const timeCfg = { enable: true, initial: 300, autoHide: false, showNegative: false, title: '授权验收', addGift: '', subGift: '', gifts: [], blindBoxEvents: [], startHotkey: { enabled: false, func: '', key: '' }, endHotkey: { enabled: false, func: '', key: '' } }
const isDenied = (r, product) => r && r.ok === false && r.code === 'license_required' && (!product || r.product === product)
const exists = (p) => fs.access(p).then(() => true, () => false)

// 全部 invoke 通道（从 preload 源码抓）→ 主进程必须都有 handler
const preloadSrc = await fs.readFile(path.join(root, 'src/preload/index.ts'), 'utf8')
const typesSrc = await fs.readFile(path.join(root, 'src/shared/types.ts'), 'utf8')
const ipcMap = Object.fromEntries([...typesSrc.matchAll(/^\s+(\w+): '([^']+)'/gm)].map((m) => [m[1], m[2]]))
const invokeKeys = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\(Ipc\.(\w+)/g)].map((m) => m[1]))]
const invokeChannels = invokeKeys.map((k) => ipcMap[k]).filter(Boolean)
assert.ok(invokeChannels.length > 150 && invokeChannels.includes('card:state'), 'preload 通道解析异常')

let failure
try {
  // ================= 一、无配置：旧账号系统原样 =================
  {
    const { app, page, profile, api, errors } = await launch(undefined)
    try {
      const st = await api('cardState')
      check('无配置：cardState 回 enabled=false', st.ok === true && st.enabled === false && !st.error)
      const reg = await api('register', 'legacy_user', 'Fixture123!', '旧账号')
      const login = await api('login', 'legacy_user', 'Fixture123!')
      check('无配置：本地账号注册 / 登录走旧实现', reg.ok && login.ok && (await api('session'))?.username === 'legacy_user')
      const opened = await api('timeWidgetOpen', timeCfg)
      check('无配置：开输出窗口不需要卡密', opened.ok === true && (await api('timeWidgetState')).open === true)
      await api('timeWidgetClose')
      check('无配置：cardRedeem 明确回未启用', (await api('cardRedeem', 'ZL-0000')).enabled === false)
      const missing = await app.evaluate(({ ipcMain }, channels) => {
        const handlers = ipcMain._invokeHandlers
        if (!(handlers instanceof Map)) return ['<无法读取 ipcMain 注册表>']
        return channels.filter((c) => !handlers.has(c))
      }, invokeChannels)
      check(`原始 IPC 全部已注册（${invokeChannels.length} 个 invoke 通道，含 card:*）`, missing.length === 0 && JSON.stringify(missing))
      const foreign = await app.evaluate(async ({ BrowserWindow }, preload) => {
        const w = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false } })
        await w.loadURL('about:blank')
        const r = await w.webContents.executeJavaScript('window.api.timeWidgetState()')
        w.destroy()
        return r
      }, path.join(root, outDir, 'preload/index.js'))
      check('非主窗口发来的 IPC 被拒绝', foreign && foreign.ok === false && /不接受此窗口/.test(foreign.error))
      check('无配置：页面无报错', errors.length === 0)
      check('无配置：旧账号文件在、没有卡密账号文件', (await exists(path.join(profile, 'data/users.json'))) && !(await exists(path.join(profile, 'data/card_users.json'))))
    } finally { await app.close() }
  }

  // ================= 二、配置无效：明确报错、不回退旧服务器 =================
  {
    // 2026-09-13 起非本机 https 地址合法（交给系统 CA / 官方 pin），「配置无效」改用明文公网地址来触发
    const { app, profile, api } = await launch({ provider: 'card', origin: 'http://evil.example/', publicKey: platform.publicKey })
    try {
      const st = await api('cardState')
      check('配置无效：cardState 回 enabled=true + 明确错误', st.ok === false && st.enabled === true && /授权来源配置/.test(st.error))
      const login = await api('emailLogin', 'someone@example.test', 'not-sent-anywhere')
      check('配置无效：登录直接报配置错误，不回退旧服务器', login.ok === false && /授权来源配置/.test(login.error) && (await api('session')) === null)
      const opened = await api('timeWidgetOpen', timeCfg)
      check('配置无效：使用类动作被拦（不是「去激活」提示）', opened.ok === false && !opened.code && /授权来源配置/.test(opened.error) && (await api('timeWidgetState')).open === false)
      check('配置无效：没有落任何旧账号 / 密码文件', !(await exists(path.join(profile, 'data/users.json'))) && !(await exists(path.join(profile, 'data/creds.json'))))
    } finally { await app.close() }
  }

  // ================= 三、配置合法：真正走卡密平台 =================
  {
    const first = `card-a-${Date.now()}@example.test`
    const second = `card-b-${Date.now()}@example.test`
    const password = 'Fixture-' + randomUUID().slice(0, 12)
    const { app, page, profile, api, errors } = await launch({ provider: 'card', origin: platform.origin, publicKey: platform.publicKey })
    try {
      // 预埋一份旧服务器的「记住密码」：卡密模式绝不能读出它
      await fs.mkdir(path.join(profile, 'data'), { recursive: true })
      const legacyCreds = JSON.stringify({ last: 'legacy@example.test', map: { 'legacy@example.test': 'p:' + Buffer.from('legacy-secret').toString('base64') } })
      await fs.writeFile(path.join(profile, 'data/creds.json'), legacyCreds)
      await page.evaluate(() => { window.__lic = []; window.api.onCardLicenseRequired((p) => window.__lic.push(p)) })

      const st0 = await api('cardState')
      check('合法配置：cardState enabled=true、未登录、origin 正确', st0.ok && st0.enabled && st0.origin === platform.origin && !st0.user)
      check('合法配置：不会读出旧服务器记住的密码', (await api('credLoad')).last === null && (await api('credUser', 'legacy@example.test')).password === null)
      const bad = await api('emailLogin', first, 'wrong-password')
      check('登录错误：报「账号或密码不正确」、不恢复任何会话', bad.ok === false && /账号或密码/.test(bad.error) && (await api('session')) === null)
      const reg = await api('emailRegister', first, '', password, '')
      check('注册：走平台注册并登录', reg.ok === true && reg.user?.email === first && (await api('session'))?.email === first)
      const st1 = await api('cardState')
      check('登录后 rights 四项全未授权', st1.user?.email === first && st1.rights?.length === 4 && st1.rights.every((r) => !r.allowed))
      await api('credSave', first, password)
      const cardCredFiles = (await fs.readdir(path.join(profile, 'data'))).filter((f) => /^creds-card-/.test(f))
      check('记住密码：写进卡密专用文件，旧 creds.json 原样', cardCredFiles.length === 1 && (await fs.readFile(path.join(profile, 'data/creds.json'), 'utf8')) === legacyCreds && (await api('credLoad')).last?.username === first)

      // 未授权门禁
      const denied = await api('timeWidgetOpen', timeCfg)
      check('未授权：开窗口被拦 license_required(platform:assistant) 且主窗口收到提示', isDenied(denied, 'platform:assistant') && (await page.evaluate(() => window.__lic)).includes('platform:assistant') && (await api('timeWidgetState')).open === false)
      check('未授权：模拟触发 / 命令也被拦', isDenied(await api('connectorSimulate', '礼物: 小心心 ×1  by 测试'), 'platform:assistant') && isDenied(await api('entertainmentCommand', 'countdown-clear'), 'platform:assistant'))
      const reads = await Promise.all([api('readConfig'), api('entertainmentRulesList'), api('getSettings'), api('timeWidgetClose'), api('greenScreenClose'), api('listMods'), api('timeWidgetState'), api('lotteryState')])
      check('未授权：读取 / 配置 / 关闭类通道不误拦', reads.every((r) => !(r && r.code === 'license_required')))
      check('卡密模式：旧邮箱授权 / 购买 / 申请入口全部明确不接旧服务器，本机平台不发验证码', (await api('emailBuyContact')) === '' && (await api('emailGameApply', first, 'librarian')).ok === false && (await api('submitRoomApply', 'r1')).ok === false && (await api('emailSendCode', first)).code === 'code_not_required')
      const lic0 = await api('emailGetLicense', first)
      check('emailGetLicense 按平台权益翻译（未授权）', lic0.ok === true && lic0.licensed === 0 && Object.keys(lic0.games || {}).length === 0 && lic0.rooms === undefined)
      const room = '577117602'
      const bindDenied = await api('cardRoomCommit', { action: 'bind', room })
      check('未扫码：提交绑定返回 proof_invalid，不开启扫码、不写绑定', bindDenied.ok === false && bindDenied.code === 'proof_invalid' && (await api('cardRooms')).quota.rooms.length === 0)

      // 兑换
      const badCard = await api('cardRedeem', 'ZL-0000-0000-0000-0000-0000-0000-0000-0000')
      check('错误卡密：有原因、不授权', badCard.ok === false && /卡密无效/.test(badCard.error) && (await api('cardState')).rights.every((r) => !r.allowed))
      const afterPlatform = await api('cardRedeem', platform.cards.platform[0])
      const platformRight = afterPlatform.rights?.find((r) => r.id === 'platform:assistant')
      check('兑换娱乐助手卡：rights 里娱乐助手 allowed', afterPlatform.ok && platformRight?.allowed === true && !platformRight.permanent)
      const opened = await api('timeWidgetOpen', timeCfg)
      check('有娱乐助手卡：开窗口成功', opened.ok === true && (await api('timeWidgetState')).open === true)
      const lic1 = await api('emailGetLicense', first)
      check('emailGetLicense 翻译（已授权娱乐助手）', lic1.licensed === 1 && lic1.expire !== '')
      // 分产品：当前游戏 4wheel-challenge 没卡
      check('分产品：游戏启动 / 连接器 / 参数写入 / 整蛊命令都要对应游戏卡', isDenied(await api('launchGame'), 'game:4wheel-challenge') && isDenied(await api('connectorStart', '12345', false), 'game:4wheel-challenge') && isDenied(await api('saveConfig', {}), 'game:4wheel-challenge') && isDenied(await api('liveCmd', 'noop'), 'game:4wheel-challenge'))
      check('分产品：mod 安装按 mod 所属游戏门禁', isDenied(await api('installMod', 'wheellive'), 'game:4wheel-challenge'))
      const afterGame = await api('cardRedeem', platform.cards.librarian[0])
      check('兑换图书管理员卡：该游戏 allowed，轮椅仍不允许', afterGame.rights.find((r) => r.id === 'game:librarian').allowed === true && afterGame.rights.find((r) => r.id === 'game:4wheel-challenge').allowed === false)
      await api('setGameCurrent', 'librarian')
      const cmd = await api('liveCmd', 'noop')
      const cfg = await api('saveConfig', {})
      check('切到已授权游戏：门禁放行，落到原实现（游戏没在跑 / 找不到 config.json）', !isDenied(cmd) && cmd.ok === false && /游戏未在运行|bridge/.test(cmd.error) && !isDenied(cfg) && cfg.ok === false && /config\.json/.test(cfg.error))
      check('切回未授权游戏：再次被拦', (await api('setGameCurrent', '4wheel-challenge')) && isDenied(await api('liveCmd', 'noop'), 'game:4wheel-challenge'))
      const noProof = await api('cardRoomCommit', { action: 'bind', room, proof: 'invalid-fixture-proof' })
      check('有卡也不能绕过扫码：伪造 proof 返回 proof_invalid、名额未扣', noProof.ok === false && noProof.code === 'proof_invalid' && (await api('cardRooms')).quota.available === 1)
      const seeded = await httpJson('POST', '/__fixture__/bind', { email: first, room }, { 'X-Fixture-Key': platform.fixtureKey })
      assert.equal(seeded.json?.ok, true, '独立服务房间夹具准备失败')
      const bound = await api('cardRooms')
      check('服务端已有绑定：真实 room_quota 同步到本地账号，容量 / 次数 / 空位保持一致', bound.ok === true && bound.quota.rooms.includes(room) && (await api('session')).boundRooms.includes(room) && bound.quota.capacity === 1 && bound.quota.changes_left === 3 && bound.quota.available === 0 && Array.isArray(bound.quota.empty_slots))

      // 后台收回 → 持续复核关掉输出
      await adminGrant(first, 'platform:assistant', 'revoke')
      await wait(async () => (await api('timeWidgetState')).open === false, '后台收回后 8 秒内输出窗口没有关闭', 8000)
      const stRevoked = await api('cardState')
      check('后台收回娱乐助手：复核关掉输出窗口、四项全不允许、再开被拦', stRevoked.rights.every((r) => !r.allowed) && isDenied(await api('timeWidgetOpen', timeCfg), 'platform:assistant'))
      await adminGrant(first, 'platform:assistant', 'permanent')
      check('后台直授永久：立刻能再开', (await api('timeWidgetOpen', timeCfg)).ok === true && (await api('timeWidgetState')).open === true)

      // 换账号：输出关、身份换、房间隔离
      const reg2 = await api('emailRegister', second, '', password, '')
      check('换账号：登录新账号即关输出、会话换成新账号、房间不串', reg2.ok === true && (await api('session')).email === second && (await api('timeWidgetState')).open === false && (await api('session')).boundRooms.length === 0)
      check('账号列表只含卡密账号', (await api('listAccounts')).map((a) => a.email).sort().join() === [first, second].sort().join())
      check('新账号无卡：开窗口被拦', isDenied(await api('timeWidgetOpen', timeCfg), 'platform:assistant'))
      const back = await api('emailLogin', first, password)
      check('切回原账号：平台绑定的直播间还在', back.ok === true && back.user.boundRooms.includes(room))

      // 平台掉线：复核失败 → 关输出；状态明确报错
      check('掉线前：永久授权账号能开窗口', (await api('timeWidgetOpen', timeCfg)).ok === true)
      service.kill()
      await wait(() => !serviceAlive, '平台服务未退出', 5000)
      await wait(async () => (await api('timeWidgetState')).open === false, '平台掉线后 8 秒内输出窗口没有关闭', 8000)
      const stDown = await api('cardState')
      check('平台掉线：输出已关、cardState 明确失败、再开被拦', stDown.ok === false && stDown.enabled === true && !!stDown.error && isDenied(await api('timeWidgetOpen', timeCfg)))
      const out = await api('logout')
      check('退出：会话清空', out.ok === true && (await api('session')) === null)
      check('卡密模式：从未写旧账号文件；卡密账号文件已建', !(await exists(path.join(profile, 'data/users.json'))) && (await exists(path.join(profile, 'data/card_users.json'))))
      const log = await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8').catch(() => '')
      check('日志不含卡密 / 密码', !CARD.test(log) && !log.includes(password))
      CARD.lastIndex = 0
      check('合法配置：页面无报错', errors.length === 0 && JSON.stringify(errors))
      check('整个基础授权验收没有尝试打开真实抖音扫码或外部浏览器', (await app.evaluate(() => global.__cardProviderExternalAttempts)) === 0)
    } finally { await app.close() }
  }
  console.log(`CARD PROVIDER PASS ${checks.length}/${checks.length}`)
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ outDir, checks, scope: 'hidden Electron + private license service; legacy untouched; card mode login/register/redeem/gates/revoke/switch/offline' }, null, 2))
} catch (error) {
  failure = error
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ checks, error: mask(error.stack || error.message) }, null, 2))
} finally {
  stopService()
}
if (failure) {
  console.error('FAIL ' + mask(failure.message))
  process.exit(1)
}
