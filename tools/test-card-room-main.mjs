// 卡密模式 · 直播间额度与扫码绑定（主进程接线）回归：真实隐藏 Electron 构建 + 本测试私有的假卡密平台 + 假抖音网页 / 回包。
//   - 平台：node http 服务，按 Tmp/live-data/rooms-contract.md 实现 rooms / bind / replace / unbind / 409 码 / Idempotency-Key /
//     mod-license room_not_bound；Ed25519 授权租约真签真验（主进程用 pin 的公钥验）。
//   - 抖音：扫码窗口所在的私有分区上挂 protocol 假页面；主进程 fetch 对 live.douyin.com 回假资料（其它域名放行原实现）。
//     「扫码」= 测试往该分区写一枚 sessionid cookie；不连真实直播、不替任何人扫码、不碰真实账号。
//   - 覆盖：无卡首绑 / 取消不消耗 / proof 一次性与账号绑定 / 名额不足 needCard 后补名额同 proof 重试 / 改绑计次与次数用尽 /
//     先扫码后补房号 / 房间令牌互不覆盖 / 未绑定不能连接 / 已绑定用存好的令牌连接 / 令牌失效重扫 / 扫码中停止 /
//     后台解绑运行中连接器被停 / 换号旧 proof 与 cookie 作废 / 平台未上 rooms 接口时登录不受影响 / mod-license 未绑定报清楚且不改 config。
//   用法：node tools/test-card-room-main.mjs   （默认构建目录 output/fable-room-main-build，可用 ZL_ROOM_OUT_DIR 覆盖）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign as cryptoSign } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.env.ZL_ROOM_OUT_DIR || 'output/fable-room-main-build'
const output = path.join(root, 'output/playwright/card-room-main')
await fs.mkdir(output, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))

const checks = []
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, label, ms = 12000) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(120) }
  throw new Error(label)
}
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

// ================= 假卡密平台（本进程 node http；状态可被测试直接改，模拟后台操作）=================
const ed = generateKeyPairSync('ed25519')
const publicKey = ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url')
const PRODUCTS = ['platform:assistant', 'game:librarian', 'game:dontscream', 'game:4wheel-challenge']
const platform = {
  users: new Map(), // email → user
  sessions: new Map(), // token → { userId, csrf }
  idem: new Map(),
  roomsEnabled: true,
  log: []
}
const findUser = (id) => [...platform.users.values()].find((u) => u.id === id)
const quotaOf = (u) => {
  const rooms = u.slots.filter((s) => s.room !== null).map((s) => s.room)
  return { capacity: u.capacity, changes_left: u.changes_left, changes_used: u.changes_used, available: u.capacity - rooms.length, rooms, bindings: u.slots.filter((s) => s.room !== null).map((s) => ({ slot: s.slot, room: s.room })), empty_slots: u.slots.filter((s) => s.room === null).map((s) => ({ slot: s.slot, last_room: s.last_room })) }
}
class Problem extends Error { constructor(message, status = 400, code = '') { super(message); this.status = status; this.code = code } }
const roomValue = (v) => { const r = String(v ?? '').trim(); if (!/^[0-9A-Za-z_-]{1,64}$/.test(r)) throw new Problem('直播间号格式不正确'); return r }
const consumeChange = (u) => { if (u.changes_left <= 0) throw new Problem('改绑次数已用完，请使用改绑卡补满 3 次后再改绑', 409, 'room_change_card_required'); u.changes_left--; u.changes_used++ }
function roomBind(u, raw) {
  const room = roomValue(raw)
  if (u.slots.some((s) => s.room === room)) return quotaOf(u)
  let slot = u.slots.find((s) => s.room === null && s.last_room === room)
  let changed = false
  if (!slot && u.slots.length < u.capacity) {
    u.slots.push({ slot: Math.max(0, ...u.slots.map((s) => s.slot)) + 1, room, last_room: room })
  } else {
    slot = slot || u.slots.find((s) => s.room === null)
    if (!slot) throw new Problem('直播间名额已用完，请使用名额卡增加 1 个名额；也可以改绑已有直播间', 409, 'room_slot_card_required')
    changed = !!(slot.last_room && slot.last_room !== room)
    if (changed) consumeChange(u)
    slot.room = room; slot.last_room = room
  }
  u.binds++
  return quotaOf(u)
}
function roomReplace(u, oldRaw, newRaw) {
  const old = roomValue(oldRaw), next = roomValue(newRaw)
  const row = u.slots.find((s) => s.room === old)
  if (!row) throw new Problem('原绑定已变化，请刷新后重试', 409, 'room_binding_changed')
  if (old === next) return quotaOf(u)
  if (u.slots.some((s) => s.room === next)) throw new Problem('这个直播间已绑定，不需要再次改绑', 409, 'room_already_bound')
  consumeChange(u)
  row.room = next; row.last_room = next
  u.replaces++
  return quotaOf(u)
}
function roomUnbind(u, raw) {
  const room = roomValue(raw)
  for (const s of u.slots) if (s.room === room) s.room = null
  return quotaOf(u)
}
const rightsOf = (u) => PRODUCTS.map((id) => ({ id, name: id, kind: id.startsWith('game:') ? 'game' : 'platform', status: u.rights.has(id) ? 'active' : 'none', permanent: u.rights.has(id), expires_at: null, allowed: u.rights.has(id), reasons: u.rights.has(id) ? [] : ['no_entitlement'] }))
function signLease(claims) {
  const h = b64u({ alg: 'EdDSA', typ: 'JWT' }), p = b64u(claims)
  return h + '.' + p + '.' + cryptoSign(null, Buffer.from(h + '.' + p), ed.privateKey).toString('base64url')
}
const server = http.createServer((req, res) => {
  let text = ''
  req.on('data', (d) => { text += d })
  req.on('end', () => {
    const reply = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const body = text ? JSON.parse(text) : {}
      const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]))
      const session = platform.sessions.get(cookies.zl_license_session || '')
      const user = session ? findUser(session.userId) : null
      platform.log.push({ path: url.pathname, user: user?.email })
      if (url.pathname === '/health') return reply(200, { ok: true, service: 'zhiliao-license' })
      // 2026-09-13 起客户端先读平台元信息决定注册要不要验证码；读不到一律按「要」。本机平台 = local，免验证码
      if (url.pathname === '/api/v1/config') return reply(200, { ok: true, identity_mode: 'local', registration: true, registration_requires_code: false })
      if (url.pathname === '/api/v1/register' || url.pathname === '/api/v1/login') {
        const email = String(body.email || '').toLowerCase(), password = String(body.password || '')
        let u = platform.users.get(email)
        if (url.pathname === '/api/v1/register') {
          if (u) throw new Problem('邮箱已注册', 409)
          u = { id: randomUUID(), email, password, rights: new Set(), capacity: 1, changes_left: 3, changes_used: 0, slots: [], binds: 0, replaces: 0 }
          platform.users.set(email, u)
        } else if (!u || u.password !== password) return reply(401, { ok: false, error: '账号或密码不正确，或账号已停用', code: 'invalid_login' })
        const token = randomBytes(24).toString('hex'), csrf = randomBytes(16).toString('hex')
        platform.sessions.set(token, { userId: u.id, csrf })
        return reply(200, { ok: true, csrf, user: { id: u.id, email: u.email } }, { 'Set-Cookie': `zl_license_session=${token}; Path=/; HttpOnly` })
      }
      if (!user) return reply(401, { ok: false, error: '未登录', code: 'unauthorized' })
      if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) return reply(403, { ok: false, error: 'CSRF 校验失败', code: 'csrf' })
      if (url.pathname === '/api/v1/logout') { platform.sessions.delete(cookies.zl_license_session); return reply(200, { ok: true }) }
      if (url.pathname === '/api/v1/me') return reply(200, { ok: true, csrf: session.csrf, user: { id: user.id, email: user.email, role: 'user' }, rights: rightsOf(user), ...(platform.roomsEnabled ? { room_quota: quotaOf(user) } : {}) })
      if (url.pathname === '/api/v1/authorize') {
        const item = rightsOf(user).find((r) => r.id === body.product_id)
        if (!item) throw new Problem('产品不存在', 404)
        if (!item.allowed) return reply(403, { ok: false, allowed: false, reasons: item.reasons })
        const now = Math.floor(Date.now() / 1000)
        return reply(200, { ok: true, allowed: true, lease: signLease({ iss: 'zhiliao-license', aud: 'zhiliao-client', sub: user.id, product_id: body.product_id, device: createHash('sha256').update(String(body.device_id)).digest('hex'), iat: now, exp: now + 120, nonce: body.nonce }), expires_at: now + 120 })
      }
      if (url.pathname === '/api/v1/mod-license') {
        if (!user.slots.some((s) => s.room === String(body.room))) return reply(409, { ok: false, error: '直播间未绑定到当前账号', code: 'room_not_bound' })
        return reply(403, { ok: false, allowed: false, reasons: ['fixture_no_rsa'] })
      }
      if (!platform.roomsEnabled && url.pathname.startsWith('/api/v1/rooms')) return reply(404, { ok: false, error: '接口不存在', code: 'not_found' })
      if (url.pathname === '/api/v1/rooms' && req.method === 'GET') return reply(200, { ok: true, room_quota: quotaOf(user) })
      const m = /^\/api\/v1\/rooms\/(bind|replace|unbind)$/.exec(url.pathname)
      if (m && req.method === 'POST') {
        const key = req.headers['idempotency-key']
        if (!key) throw new Problem('缺少 Idempotency-Key', 400, 'idempotency_required')
        const idemKey = user.id + '|' + m[1] + '|' + key
        if (platform.idem.has(idemKey)) { const saved = platform.idem.get(idemKey); return reply(saved.status, saved.body) }
        const snapshot = JSON.stringify({ capacity: user.capacity, changes_left: user.changes_left, changes_used: user.changes_used, slots: user.slots, binds: user.binds, replaces: user.replaces })
        try {
          const quota = m[1] === 'bind' ? roomBind(user, body.room) : m[1] === 'replace' ? roomReplace(user, body.previous, body.room) : roomUnbind(user, body.room)
          platform.idem.set(idemKey, { status: 200, body: { ok: true, room_quota: quota } })
          return reply(200, { ok: true, room_quota: quota })
        } catch (e) {
          Object.assign(user, JSON.parse(snapshot)) // 失败回滚（模拟事务）
          throw e
        }
      }
      throw new Problem('接口不存在', 404, 'not_found')
    } catch (e) {
      const status = e instanceof Problem ? e.status : 500
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message, code: e.code || '' }))
    }
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port

// 轮椅 mod 公钥 pin（只做格式 / 指纹自洽；本测试的 mod-license 走 room_not_bound，不会走到验签）
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = rsa.publicKey.export({ format: 'jwk' })
const keyXml = `<RSAKeyValue><Modulus>${Buffer.from(jwk.n, 'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(jwk.e, 'base64url').toString('base64')}</Exponent></RSAKeyValue>`
const fingerprint = createHash('sha256').update(keyXml, 'utf8').digest('hex')

// ================= 隔离 profile + 隐藏 Electron（自带引导：假抖音页面 / 假 fetch / 记录扫码窗口）=================
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
const libDir = path.join(path.dirname(settings.gamePaths.librarian), 'ue4ss/Mods/DarkMage')
const wheelDir = path.join(path.dirname(settings.gamePaths['4wheel-challenge']), 'Mods/WheelLive')
await fs.mkdir(libDir, { recursive: true })
await fs.mkdir(wheelDir, { recursive: true })
await fs.writeFile(path.join(libDir, 'bridge.txt'), '')
await fs.writeFile(path.join(libDir, 'connector.py'), `import pathlib, sys, time
here = pathlib.Path(__file__).parent
print('[connector] TEST_CONNECTOR_COOKIE=' + (here / 'douyin_cookie.txt').read_text(encoding='utf-8').strip(), flush=True)
while True:
    time.sleep(1)
`)
const wheelConfig = JSON.stringify({ LiveRoomId: '999', CustomBoxes: [{ Name: '保留原盲盒', GiftName: '小心心' }], VideoQueue: 0 })
await fs.writeFile(path.join(wheelDir, 'config.json'), wheelConfig)
await fs.writeFile(path.join(profile, 'license-provider.json'), JSON.stringify({ provider: 'card', origin, publicKey, modPublicKeys: { 'game:4wheel-challenge': { keyXml, fingerprint } } }))
const loginHtml = '<html><meta charset="utf-8"><h1>扫码登录（自动化测试页面）</h1><button onclick="this.outerHTML=\'<p>扫码登录</p>\'">登录</button></html>'
const entry = path.join(profile, 'room-bootstrap.cjs')
await fs.writeFile(entry, `
const electron = require('electron');
const { app, BrowserWindow: NativeWindow, session } = electron;
app.setPath('userData', ${JSON.stringify(profile)}); app.setAppPath(${JSON.stringify(root)});
electron.dialog.showErrorBox = (t, c) => process.stderr.write(t + ': ' + c + '\\n');
electron.dialog.showMessageBox = async () => ({ response: -1, checkboxChecked: false });
electron.dialog.showMessageBoxSync = () => -1;
electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
for (const m of ['show', 'showInactive', 'focus', 'restore', 'maximize', 'moveTop']) NativeWindow.prototype[m] = function () {};
app.focus = () => {};
const qa = global.__zlRoom = { windows: [], scans: [], requests: [], expired: new Set(), offline: new Set(), fetchLog: [] };
const HiddenWindow = new Proxy(NativeWindow, { construct(Target, args) {
  const opts = args[0] || {};
  qa.windows.push({ title: opts.title || '', preload: !!opts.webPreferences?.preload, nodeIntegration: !!opts.webPreferences?.nodeIntegration, sandbox: opts.webPreferences?.sandbox === true, contextIsolation: opts.webPreferences?.contextIsolation === true, hasSession: !!opts.webPreferences?.session });
  return Reflect.construct(Target, [{ ...opts, show: false, focusable: false, webPreferences: { ...(opts.webPreferences || {}), backgroundThrottling: false, paintWhenInitiallyHidden: true } }], Target);
}});
const realFromPartition = session.fromPartition.bind(session);
const sessionFacade = new Proxy(session, { get(target, key) {
  if (key === 'fromPartition') return (name, opts) => {
    const ses = realFromPartition(name, opts);
    if (String(name).startsWith('card-room-scan-') && !qa.scans.some((s) => s.ses === ses)) {
      ses.protocol.handle('https', () => new Response(${JSON.stringify(loginHtml)}, { headers: { 'Content-Type': 'text/html' } }));
      qa.scans.push({ name, ses });
    }
    return ses;
  };
  return Reflect.get(target, key);
}});
const Module = require('node:module'), originalLoad = Module._load;
const facade = { ...electron, BrowserWindow: HiddenWindow, session: sessionFacade };
Module._load = function (request) { return request === 'electron' ? facade : originalLoad.apply(this, arguments); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('https://live.douyin.com/')) return realFetch(url, init);
  const headers = init?.headers || {};
  const cookie = headers.cookie || headers.Cookie || '';
  const sid = (/sessionid=([^;]+)/.exec(cookie) || [])[1] || '';
  const p = u.slice('https://live.douyin.com/'.length);
  qa.fetchLog.push({ path: p, sid });
  if (p.startsWith('webcast/')) return new Response('{}', { status: 404 });
  if (sid && qa.expired.has(sid)) return new Response('defaultHeaderUserInfo: {"isLogin":false}');
  if (p === '') {
    if (!sid) return new Response('', { headers: { 'set-cookie': 'ttwid=fixture-visitor; Path=/; Secure' } });
    return new Response('defaultHeaderUserInfo: {"isLogin":true,"realName":"扫码账号","avatarUrl":"https://example.invalid/me.png"}');
  }
  const room = p.split('?')[0];
  if (!sid) return new Response('', { status: 401 });
  if (qa.offline.has(room)) return new Response('defaultHeaderUserInfo: {"isLogin":true,"realName":"扫码账号","avatarUrl":"https://example.invalid/me.png"}');
  return new Response('<div data-anchor-info="{&quot;nickname&quot;:&quot;主播' + room + '&quot;,&quot;avatar&quot;:&quot;https://example.invalid/a.png&quot;}"></div>');
};
global.__zhiliaoHiddenTest = true;
require(${JSON.stringify(path.resolve(root, outDir, 'main/index.js'))});
`, 'utf8')

// 本测试验的是平台额度契约：强制打开授权检查（随包默认 enforce=false 的免检行为由 tools/verify-rooms-free.mjs 单独验）
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json', ZL_CARD_ROOMS_RECHECK_MS: '2500', ZL_CARD_RECHECK_MS: '2500', ZL_LICENSE_ENFORCE: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
const page = await app.firstWindow()
page.setDefaultTimeout(20000)
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.waitForFunction(() => !!window.api?.cardRoomVerify)
assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须使用本次隔离 profile')
const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
// 异步操作（会开扫码窗口）：先发起，之后再取结果
const begin = (method, ...args) => page.evaluate(({ method, args }) => { window.__pending = null; window.api[method](...args).then((r) => { window.__pending = r }) }, { method, args })
const result = (ms = 15000) => until(() => page.evaluate(() => window.__pending), '操作没有完成', ms)
const qa = (fn, arg) => app.evaluate(fn, arg)
const scanCount = () => qa(() => global.__zlRoom.windows.filter((w) => w.title.startsWith('抖音扫码')).length)
const lastScanWindow = () => qa(() => global.__zlRoom.windows.filter((w) => w.title.startsWith('抖音扫码')).at(-1))
const scanPage = () => until(() => app.windows().find((w) => w.url().startsWith('https://live.douyin.com/')), '扫码窗口没有打开')
/** 「扫码」：往最新的扫码分区写一枚 sessionid（假登录态），主进程会像真扫码一样收到 cookie 变化 */
const scanWith = async (value) => {
  await scanPage()
  await qa(async (_, value) => {
    const s = global.__zlRoom.scans.at(-1)
    await s.ses.cookies.set({ url: 'https://douyin.com/', domain: '.douyin.com', name: 'sessionid', value, secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 86400 })
  }, value)
}
const closeScanWindow = () => qa(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('抖音扫码')); if (w) w.close(); return !!w })
const serverUser = (email) => platform.users.get(email)
const cookieFile = (dir) => fs.readFile(path.join(dir, 'douyin_cookie.txt'), 'utf8').catch(() => '')
const tokenFile = async () => { const files = (await fs.readdir(path.join(profile, 'data'))).filter((f) => /^room-tokens-card-/.test(f)); return files.length ? await fs.readFile(path.join(profile, 'data', files[0]), 'utf8') : '' }

const A = { email: `room-a-${Date.now()}@example.test`, password: 'Fixture-' + randomUUID().slice(0, 10) }
const B = { email: `room-b-${Date.now()}@example.test`, password: 'Fixture-' + randomUUID().slice(0, 10) }
let failure
try {
  await page.evaluate(() => { window.__synced = []; window.api.onRoomsSynced((p) => window.__synced.push(p)) })
  // ---- 未登录 / 平台还没上 rooms 接口 ----
  check('未登录：cardRooms 明确回 not_logged_in', (await api('cardRooms')).code === 'not_logged_in')
  check('未登录：cardRoomVerify 不开扫码窗口', (await api('cardRoomVerify', '1001')).code === 'not_logged_in' && (await scanCount()) === 0)
  platform.roomsEnabled = false
  const reg = await api('emailRegister', A.email, '', A.password, '')
  check('平台暂无 rooms 接口：注册登录不受影响、绑定列表为空', reg.ok === true && reg.user.boundRooms.length === 0 && (await api('cardRooms')).ok === false)
  platform.roomsEnabled = true
  const q0 = await api('cardRooms')
  check('cardRooms：默认 1 个名额、3 次改绑、无绑定', q0.ok && q0.quota.capacity === 1 && q0.quota.changes_left === 3 && q0.quota.available === 1 && q0.quota.rooms.length === 0)
  check('cardState 带 roomQuota（平台 me.room_quota 映射）', (await api('cardState')).roomQuota?.capacity === 1)
  check('A 没有任何卡（首绑不需要娱乐助手卡）', (await api('cardState')).rights.every((r) => !r.allowed))

  // ---- 扫码窗口本身：独立、无 preload / node、取消不消耗 ----
  check('无效房号 / 非抖音链接：不开窗口就拒绝', (await api('cardRoomVerify', 'https://example.com/123')).code === 'invalid_room' && (await api('cardRoomVerify', '房号')).code === 'invalid_room' && (await scanCount()) === 0)
  check('带空格 / 超过 64 位房号：扫码前拒绝，与平台和 Mod 一致（带字母的房号是合法的）', (await api('cardRoomVerify', 'ab c')).code === 'invalid_room' && (await api('cardRoomVerify', '1'.repeat(65))).code === 'invalid_room' && (await scanCount()) === 0)
  await begin('cardRoomVerify', '1001')
  const scan1 = await scanPage()
  const w1 = await lastScanWindow()
  check('verify 打开独立扫码窗口：私有分区、无 preload、无 node、sandbox、页面拿不到客户端接口', w1.hasSession && !w1.preload && !w1.nodeIntegration && w1.sandbox && w1.contextIsolation && (await scan1.evaluate(() => typeof window.api + typeof window.require)) === 'undefinedundefined' && (await qa(() => global.__zlRoom.scans.at(-1).name)).startsWith('card-room-scan-'))
  await scan1.getByText('扫码登录', { exact: true }).waitFor()
  check('扫码页自动点开「登录」露出二维码入口', true)
  check('取消扫码：关窗口 → 明确回 scan_cancelled', (await closeScanWindow()) && (await (async () => { await closeScanWindow(); return result() })()).code === 'scan_cancelled')
  check('取消不消耗：平台无绑定、无令牌文件', serverUser(A.email).binds === 0 && serverUser(A.email).slots.length === 0 && (await tokenFile()) === '')
  await begin('cardRoomVerify', '1001')
  await scanPage()
  await api('cancelRoomApply')
  const cancelledFromUi = await result()
  check('向导取消接口自动关掉扫码窗口、结果作废、不落账', !cancelledFromUi.ok && ['session_changed', 'scan_cancelled'].includes(cancelledFromUi.code) && !(await closeScanWindow()) && serverUser(A.email).binds === 0)

  // ---- 房号在先：扫码 → 核实 → 提交 ----
  await begin('cardRoomVerify', 'https://live.douyin.com/1001?enter_from=test')
  await scanWith('sess-A-1001')
  const v1 = await result()
  check('扫码后核实房间 1001：回 proof + 昵称（用刚扫到的 cookie 请求）', v1.ok && v1.room === '1001' && v1.nickname === '主播1001' && typeof v1.proof === 'string' && (await qa(() => global.__zlRoom.fetchLog.some((f) => f.path.startsWith('1001') && f.sid === 'sess-A-1001'))))
  check('扫码分区在拿到 cookie 后已清空（登录态只留在主进程 proof 里）', (await qa(async () => (await global.__zlRoom.scans.at(-1).ses.cookies.get({ url: 'https://live.douyin.com/' })).some((c) => c.name === 'sessionid'))) === false)
  check('commit：伪造 proof / 房号与 proof 不符 都被拒', (await api('cardRoomCommit', { action: 'bind', room: '1001', proof: 'not-a-proof' })).code === 'proof_invalid' && (await api('cardRoomCommit', { action: 'bind', room: '1002', proof: v1.proof })).code === 'proof_invalid' && serverUser(A.email).binds === 0)
  const c1 = await api('cardRoomCommit', { action: 'bind', room: '1001', proof: v1.proof })
  check('commit bind 1001：平台扣名额、回 boundRooms 与 quota', c1.ok && c1.boundRooms.join() === '1001' && c1.quota.available === 0 && serverUser(A.email).binds === 1)
  check('本机 session.boundRooms 同步、RoomsSynced 已广播', (await api('session')).boundRooms.join() === '1001' && (await page.evaluate(() => window.__synced.some((p) => p.boundRooms.includes('1001')))))
  const tf1 = await tokenFile()
  check('令牌 safeStorage 加密落盘：文件里没有明文 cookie', tf1.includes('"1001"') && !tf1.includes('sess-A-1001'))
  check('同一 proof 不能再次 commit（一次性）', (await api('cardRoomCommit', { action: 'bind', room: '1001', proof: v1.proof })).code === 'proof_invalid' && serverUser(A.email).binds === 1)

  // ---- 名额不足 → needCard → 补名额后同一 proof 重试 ----
  await begin('cardRoomVerify', '1002')
  await scanWith('sess-A-1002')
  const v2 = await result()
  const c2 = await api('cardRoomCommit', { action: 'bind', room: '1002', proof: v2.proof })
  check('第 2 个房间：平台 409 room_slot_card_required → needCard=room_slot，不消耗', v2.ok && c2.ok === false && c2.needCard === 'room_slot' && c2.code === 'room_slot_card_required' && serverUser(A.email).slots.length === 1 && (await api('session')).boundRooms.join() === '1001')
  serverUser(A.email).capacity = 2 // 模拟兑换名额卡
  const c2b = await api('cardRoomCommit', { action: 'bind', room: '1002', proof: v2.proof })
  check('补名额后同一 proof 重试成功（不用重扫）', c2b.ok && c2b.boundRooms.join() === '1001,1002' && c2b.quota.capacity === 2)
  check('两个房间令牌各自保存', (await tokenFile()).includes('"1002"') && (await tokenFile()).includes('"1001"'))

  // ---- 改绑：计次；次数用尽 needCard=room_change ----
  await begin('cardRoomVerify', '1003')
  await scanWith('sess-A-1003')
  const v3 = await result()
  const r3 = await api('cardRoomCommit', { action: 'replace', room: '1003', previous: '1002', proof: v3.proof })
  check('改绑 1002→1003：计 1 次、列表更新', r3.ok && r3.boundRooms.join() === '1001,1003' && r3.quota.changes_left === 2 && r3.quota.changes_used === 1 && serverUser(A.email).replaces === 1)
  check('改绑后旧房间令牌移除、新房间令牌保存、1001 不受影响', !(await tokenFile()).includes('"1002"') && (await tokenFile()).includes('"1003"') && (await tokenFile()).includes('"1001"'))
  serverUser(A.email).changes_left = 0
  await begin('cardRoomVerify', '1004')
  await scanWith('sess-A-1004')
  const v4 = await result()
  const r4 = await api('cardRoomCommit', { action: 'replace', room: '1004', previous: '1003', proof: v4.proof })
  check('改绑次数用尽：409 room_change_card_required → needCard=room_change，列表不变', r4.ok === false && r4.needCard === 'room_change' && (await api('cardRooms')).quota.rooms.join() === '1001,1003')
  check('同一 proof 重试改成 previous=1001 也被拒（proof 只对 1004 有效但服务端仍无次数）', (await api('cardRoomCommit', { action: 'replace', room: '1004', previous: '1001', proof: v4.proof })).needCard === 'room_change' && serverUser(A.email).slots.filter((s) => s.room).length === 2)
  serverUser(A.email).changes_left = 3

  // ---- 先扫码后补房号 ----
  const before = await scanCount()
  await begin('cardRoomVerify')
  await scanWith('sess-A-first')
  const v5 = await result()
  check('先扫码：不猜房号，回 needRoom=true + proof + 登录账号昵称', v5.ok && v5.needRoom === true && v5.proof && v5.nickname === '扫码账号' && !v5.room)
  const v5b = await api('cardRoomVerify', '1001', v5.proof)
  check('再 verify(room, proof)：复用同一次扫码，没有再开窗口', v5b.ok && v5b.room === '1001' && v5b.proof === v5.proof && (await scanCount()) === before + 1)
  check('verify(room, proof) 换一个房号再核实也不用重扫', (await api('cardRoomVerify', '1005', v5.proof)).ok && (await scanCount()) === before + 1)
  const stale = v5.proof // 留着：换号后必须失效

  // ---- 连接器：未绑定不能连；已绑定用存好的令牌；令牌互不覆盖 ----
  serverUser(A.email).rights.add('platform:assistant'); serverUser(A.email).rights.add('game:librarian')
  await api('setGameCurrent', 'librarian')
  const scansBeforeConnect = await scanCount()
  const notBound = await api('connectorStart', '1005', false)
  check('连接未绑定房间：明确报「尚未绑定」、不开扫码窗口、连接器未启动 ' + JSON.stringify(notBound), notBound.ok === false && /尚未绑定/.test(notBound.error) && (await scanCount()) === scansBeforeConnect && (await api('connectorState')).running === false)
  const started = await api('connectorStart', '1001', false)
  await until(async () => (await api('connectorState')).running, '连接器没有启动')
  check('连接已绑定房间 1001：用存好的令牌，不再扫码；cookie 按旧格式写进 mod 目录', started.ok && (await scanCount()) === scansBeforeConnect && /sessionid=sess-A-1001/.test(await cookieFile(libDir)))
  await until(async () => (await api('connectorLog')).some((l) => /TEST_CONNECTOR_COOKIE=.*sess-A-1001/.test(l.text)), 'python 连接器没读到 1001 的登录态')
  check('真实 python 连接器读到的是 1001 的登录态', true)
  // 后台解绑 → 复核停掉连接器
  roomUnbind(serverUser(A.email), '1001')
  await until(async () => (await api('connectorState')).running === false, '后台解绑后连接器没有停', 15000)
  check('后台解绑运行中的房间：复核时连接器被停、本机列表同步、日志说明原因', (await api('session')).boundRooms.join() === '1003' && (await api('connectorLog')).some((l) => /已在后台解绑/.test(l.text)))
  check('解绑不关别的输出（不是授权失败）：cardState 仍正常', (await api('cardState')).ok === true)
  // 1003 的令牌是另一份，不被 1001 覆盖
  await api('connectorStart', '1003', false)
  await until(async () => (await api('connectorState')).running, '1003 连接器没有启动')
  check('连接 1003：写入的是 1003 自己的令牌（房间令牌互不覆盖）', /sessionid=sess-A-1003(;|$)/.test(await cookieFile(libDir)) && (await scanCount()) === scansBeforeConnect)
  await api('connectorStop')
  await until(async () => !(await api('connectorState')).running, '连接器没有停止')
  // 令牌失效 → 重扫后继续
  await qa(() => { global.__zlRoom.expired.add('sess-A-1003') })
  await begin('connectorStart', '1003', false)
  await scanWith('sess-A-1003-renewed')
  const renewed = await result()
  await until(async () => (await api('connectorState')).running, '重扫后连接器没有启动')
  check('存好的令牌失效：自动扫码换新，连接继续、新令牌写入', renewed.ok && (await scanCount()) === scansBeforeConnect + 1 && /sess-A-1003-renewed/.test(await cookieFile(libDir)))
  await api('connectorStop')
  await until(async () => !(await api('connectorState')).running, '连接器没有停止')
  // 扫码中停止连接：不启动、不落盘
  await qa(() => { global.__zlRoom.expired.add('sess-A-1003-renewed') })
  await begin('connectorStart', '1003', false)
  await scanPage()
  await api('connectorStop')
  const cancelled = await result()
  check('扫码中停止连接：明确取消、连接器未启动', cancelled.ok === false && /取消/.test(cancelled.error) && (await api('connectorState')).running === false && (await api('connectorState')).connecting === false)

  // ---- 兼容入口：unbindRoom / bindRoomWithLicense 也走平台与扫码 ----
  const un = await api('unbindRoom', '1003')
  check('兼容入口 unbindRoom：走平台解绑（不计次）、令牌删除', un.ok && un.boundRooms.length === 0 && serverUser(A.email).slots.every((s) => s.room === null) && !(await tokenFile()).includes('"1003"') && serverUser(A.email).changes_used === 1)
  await begin('bindRoomWithLicense', '1003')
  await scanPage()
  check('兼容入口 bindRoomWithLicense：不能跳过扫码（打开了扫码窗口）', (await scanCount()) === scansBeforeConnect + 3)
  await scanWith('sess-A-1003-rebind')
  const rb = await result()
  check('兼容入口绑定成功：平台落账、boundRooms 回传', rb.ok && rb.boundRooms.join() === '1003' && serverUser(A.email).slots.some((s) => s.room === '1003'))
  check('syncEmailRooms 兼容入口回平台列表', (await api('syncEmailRooms')).boundRooms.join() === '1003')

  // ---- 换号：扫码窗口关、旧 proof / cookie 作废，新账号拿不到旧登录态 ----
  await begin('cardRoomVerify', '1006')
  await scanPage()
  const regB = await api('emailRegister', B.email, '', B.password, '')
  const interrupted = await result()
  check('扫码进行中换号：扫码窗口被关、结果明确失败、不落任何东西', regB.ok && interrupted.ok === false && ['scan_cancelled', 'session_changed'].includes(interrupted.code) && serverUser(B.email).binds === 0)
  check('新账号 B：绑定列表为空、A 留下的 proof 作废', (await api('session')).boundRooms.length === 0 && (await api('cardRoomCommit', { action: 'bind', room: '1005', proof: stale })).code === 'proof_invalid' && (await api('cardRoomVerify', '1005', stale)).code === 'proof_invalid')
  serverUser(B.email).rights.add('platform:assistant'); serverUser(B.email).rights.add('game:librarian')
  const bNotBound = await api('connectorStart', '1003', false)
  check('B 连 A 的房间 1003：平台说未绑定，拒绝且不用 A 的令牌', bNotBound.ok === false && /尚未绑定/.test(bNotBound.error))
  await begin('cardRoomVerify', '2001')
  await scanWith('sess-B-2001')
  const vb = await result()
  const cb = await api('cardRoomCommit', { action: 'bind', room: '2001', proof: vb.proof })
  await api('connectorStart', '2001', false)
  await until(async () => (await api('connectorState')).running, 'B 的连接器没有启动')
  check('B 绑定并连接 2001：写入的是 B 自己扫的登录态，不是 A 的', cb.ok && /sessionid=sess-B-2001/.test(await cookieFile(libDir)) && !/sess-A/.test(await cookieFile(libDir)))
  await api('connectorStop')
  await until(async () => !(await api('connectorState')).running, '连接器没有停止')
  check('A 的房间令牌仍在（换号不清别人的）', (await tokenFile()).includes('"1003"') && (await tokenFile()).includes('"2001"'))

  // ---- mod-license：房间未绑定报清楚，不改游戏 config ----
  serverUser(B.email).rights.add('game:4wheel-challenge')
  await api('setGameCurrent', '4wheel-challenge')
  await api('emailLogin', B.email, B.password) // 重新登录触发轮椅授权准备（prepareCardMod → renewCardModLease）
  const leaseFile = await until(async () => { const t = await fs.readFile(path.join(wheelDir, 'local-card-license.json'), 'utf8').catch(() => ''); return /直播间未绑定/.test(t) ? t : null }, '轮椅租约文件没有写入未绑定原因')
  check('mod-license 房间 999 未绑定：平台 room_not_bound → 本机租约文件写明「直播间未绑定」', /直播间未绑定到当前账号/.test(leaseFile) && JSON.parse(leaseFile).lease === '')
  check('未绑定时游戏 config.json 逐字不变（LiveRoomId / 盲盒 / 视频参数不动）', (await fs.readFile(path.join(wheelDir, 'config.json'), 'utf8')) === wheelConfig)
  const log = await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8').catch(() => '')
  check('主进程日志写明轮椅授权准备失败原因', /尚未绑定到当前卡密账号/.test(log))

  // ---- 退出：无扣费、无残留 ----
  const out = await api('logout')
  // A：bind 1001、bind 1002（补名额后）、compat 重绑 1003 = 3 次 bind；replace 1 次；改绑计次 1（重绑同一 last_room 不计）。B：bind 2001。
  const tally = { aBinds: serverUser(A.email).binds, aReplaces: serverUser(A.email).replaces, aChanges: serverUser(A.email).changes_used, bBinds: serverUser(B.email).binds, bChanges: serverUser(B.email).changes_used }
  check('退出：会话清空、平台上 A/B 的落账与计次与预期一致（取消 / 失败从未扣费） ' + JSON.stringify(tally), out.ok && (await api('session')) === null && tally.aBinds === 3 && tally.aReplaces === 1 && tally.aChanges === 1 && tally.bBinds === 1 && tally.bChanges === 0)
  check('日志 / 令牌文件不含明文 cookie', !/sess-[AB]-/.test(log) && !/sess-[AB]-/.test(await tokenFile()))
  check('页面无报错', pageErrors.length === 0 && JSON.stringify(pageErrors))
  console.log(`CARD ROOM MAIN PASS ${checks.length}/${checks.length}`)
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ outDir, checks, scope: 'hidden Electron real build + fake license platform (rooms contract) + fake Douyin page/responses; no real scan, no real live room, no real account' }, null, 2))
} catch (error) {
  failure = error
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ checks, error: error.stack || error.message }, null, 2))
} finally {
  try { await api('connectorStop') } catch { /* 已关闭 */ }
  await app.close().catch(() => {})
  server.close()
}
if (failure) { console.error('FAIL ' + failure.message); process.exit(1) }
