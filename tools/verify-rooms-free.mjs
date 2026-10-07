// 免检模式（license-policy enforce=false，0.3.60 随包默认）· 直播间绑定「没有任何封锁」验证：
//   真实隐藏 Electron 构建（默认 out/，可用 ZL_ROOM_OUT_DIR 覆盖）+ 本测试私有的假卡密平台（复用 test-card-room-main 的夹具）。
//   覆盖：cardRooms 回 free 名额且不问平台 / verify 不开扫码窗口 / 绑 6 个远超平台 1 个名额 / 改绑 5 次远超平台 3 次 /
//         不带 proof 也能绑 / 解绑本机直接生效 / 旧入口 bindRoomWithLicense 直接绑上 / 房号格式仍校验 /
//         老用户：本机一个都没有时拿回平台上记着的绑定、本机已有的绑定不被平台覆盖 / 平台 rooms 接口挂了登录照常 /
//         平台上没绑的房间也能启动连接器（只扫码取抖音登录态）/ 界面名额显示「不限」/
//         绑定 / 解绑顺手报给平台（后台看得到），平台不收也不影响本机。
//   用法：npm run build && node tools/verify-rooms-free.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign as cryptoSign } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.env.ZL_ROOM_OUT_DIR || 'out'
const output = path.join(root, 'output/playwright/rooms-free')
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

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json', ZL_CARD_ROOMS_RECHECK_MS: '2500' }
delete env.ZL_LICENSE_ENFORCE // 走随包默认：build/license-policy.json enforce=false
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

const A = { email: `free-a-${Date.now()}@example.test`, password: 'Fixture-' + randomUUID().slice(0, 10) }
const mainLog = () => fs.readFile(path.join(profile, 'logs', 'main.log'), 'utf8').catch(() => '')
const roomsWrites = () => platform.log.filter((l) => /^\/api\/v1\/rooms\/(bind|replace|unbind)$/.test(l.path)).length
const roomsReads = () => platform.log.filter((l) => l.path === '/api/v1/rooms').length
const rooms = async () => { const r = await api('cardRooms'); assert.ok(r.ok, 'cardRooms: ' + r.error); return r.quota }
let failure
try {
  await page.evaluate(() => { window.__synced = []; window.api.onRoomsSynced((p) => window.__synced.push(p)) })
  await until(async () => /\[license\] 授权检查：已暂停/.test(await mainLog()), '日志没有「授权检查：已暂停」')
  check('前提：本次启动授权检查已暂停（随包默认免检）', true)
  check('未登录：cardRooms 仍要求先登录账号（这是身份，不是授权）', (await api('cardRooms')).code === 'not_logged_in')

  // ---- 老用户：平台上还记着的绑定 → 登录后并入本机；平台 rooms 挂了登录照常 ----
  platform.roomsEnabled = false
  const reg = await api('emailRegister', A.email, '', A.password, '')
  check('平台 rooms 接口不可用：注册登录照常、绑定列表为空', reg.ok === true && reg.user.boundRooms.length === 0)
  platform.roomsEnabled = true
  const u = serverUser(A.email)
  u.slots.push({ slot: 1, room: '5001', last_room: '5001' }) // 模拟老用户在平台上原有的绑定
  await api('logout')
  const login = await api('emailLogin', A.email, A.password)
  check('登录不等平台：立刻返回', login.ok === true)
  await until(async () => (await rooms()).rooms.includes('5001'), '平台上原有的 5001 没并进本机列表')
  check('老用户：平台上原有的绑定 5001 登录后并入本机列表', true)
  const q0 = await rooms()
  check('cardRooms：free=true、可添加 / 改绑次数都是放行的大数、bindings 与 rooms 对应 ' + JSON.stringify({ capacity: q0.capacity, changes_left: q0.changes_left, available: q0.available }),
    q0.free === true && q0.available >= 100 && q0.changes_left >= 100 && q0.bindings.length === q0.rooms.length && q0.bindings[0].room === '5001')
  const reads0 = roomsReads()
  for (let i = 0; i < 5; i++) await rooms()
  check('cardRooms 连续 5 次不再向平台发请求（登录时那一次合并除外）', roomsReads() === reads0)

  // ---- verify：不扫码、不查抖音 ----
  check('房号格式仍校验（这不是封锁）', (await api('cardRoomVerify', '房号')).code === 'invalid_room' && (await api('cardRoomVerify', 'https://example.com/123')).code === 'invalid_room')
  const v0 = await api('cardRoomVerify')
  check('verify() 不带房号：立即回 needRoom + proof，不开扫码窗口 ' + JSON.stringify(v0), v0.ok === true && v0.needRoom === true && typeof v0.proof === 'string' && (await scanCount()) === 0)
  const v1 = await api('cardRoomVerify', '1001', v0.proof)
  check('verify(room, proof)：立即通过，复用 proof，不开扫码窗口', v1.ok === true && v1.room === '1001' && v1.proof === v0.proof && (await scanCount()) === 0)
  const v2 = await api('cardRoomVerify', 'https://live.douyin.com/1002?enter_from_merge=web_share_link')
  check('verify(链接) 不带 proof：立即通过、解析出房号、不开扫码窗口', v2.ok === true && v2.room === '1002' && typeof v2.proof === 'string' && (await scanCount()) === 0)
  check('抖音网页零访问（没有拿 cookie 去查资料）', (await qa(() => global.__zlRoom.fetchLog.length)) === 0)

  // ---- 绑定：远超平台 1 个名额 ----
  const c1 = await api('cardRoomCommit', { action: 'bind', room: '1001', proof: v1.proof })
  check('commit bind 1001：成功、列表含 5001 + 1001、quota.free ' + JSON.stringify(c1.boundRooms), c1.ok === true && c1.boundRooms.includes('5001') && c1.boundRooms.includes('1001') && c1.quota?.free === true)
  const c2 = await api('cardRoomCommit', { action: 'bind', room: '1002', proof: v2.proof })
  check('commit bind 1002：成功', c2.ok === true && c2.boundRooms.includes('1002'))
  for (const r of ['1003', '1004', '1005', '1006']) {
    const c = await api('cardRoomCommit', { action: 'bind', room: r })
    check(`不带 proof 直接 bind ${r}：成功、不要卡`, c.ok === true && !c.needCard && c.boundRooms.includes(r))
  }
  const q1 = await rooms()
  check('共绑 7 个直播间（平台名额只有 1 个）', q1.rooms.length === 7 && q1.available >= 100)
  const again = await api('cardRoomCommit', { action: 'bind', room: '1003' })
  check('重复绑已绑的房间：成功且不重复', again.ok === true && again.boundRooms.filter((r) => r === '1003').length === 1)

  // ---- 改绑：远超平台 3 次 ----
  let prev = '1003'
  for (const next of ['2001', '2002', '2003', '2004', '2005']) {
    const c = await api('cardRoomCommit', { action: 'replace', room: next, previous: prev })
    check(`replace ${prev} → ${next}：成功、旧的移除新的加入`, c.ok === true && !c.boundRooms.includes(prev) && c.boundRooms.includes(next))
    prev = next
  }
  check('replace 新旧相同：明确回 room_same（不是封锁，是没意义）', (await api('cardRoomCommit', { action: 'replace', room: '2005', previous: '2005' })).code === 'room_same')
  const q2 = await rooms()
  check('改绑 5 次后仍是 7 个直播间、改绑次数没有被扣', q2.rooms.length === 7 && q2.changes_left >= 100 && q2.rooms.includes('2005'))

  // ---- 解绑：只改本机 ----
  const un = await api('unbindRoom', '1001')
  check('unbindRoom 1001：成功、列表移除', un.ok === true && !un.boundRooms.includes('1001') && !(await rooms()).rooms.includes('1001'))
  const reb = await api('bindRoomWithLicense', '1001')
  check('旧入口 bindRoomWithLicense 1001：直接绑回、不扫码、不要授权 ' + JSON.stringify(reb), reb.ok === true && reb.boundRooms.includes('1001') && !reb.needApply && (await scanCount()) === 0)
  const old2 = await api('bindRoom', '3001')
  check('旧入口 bindRoom 3001：直接绑上', old2.ok === true && old2.boundRooms.includes('3001'))
  check('界面收到 RoomsSynced 广播（列表实时刷新）', (await page.evaluate(() => window.__synced.length)) >= 5)

  // ---- 绑定 / 解绑顺手报给平台（2026-10-07 起：后台要看得到主播用哪些直播间）；平台不收也不影响本机；本机绑定不被平台覆盖 ----
  await sleep(1500)
  check('绑定 / 解绑顺手报给了平台；这个假平台只给 1 个名额、不收也不影响本机（平台仍只记着 5001）', roomsWrites() > 0 && u.replaces === 0 && u.slots.filter((x) => x.room !== null).length === 1 && u.slots[0].room === '5001')
  await api('logout')
  await api('emailLogin', A.email, A.password)
  await sleep(1500)
  const q3 = await rooms()
  check('重新登录后：本机 8 个绑定原样保留（平台只记着 5001，不覆盖本机）' + JSON.stringify(q3.rooms), q3.rooms.length === 8 && q3.rooms.includes('5001') && q3.rooms.includes('2005') && q3.rooms.includes('3001'))
  // 平台上后来解绑了 5001（后台操作）：免检下本机不受影响、连接器也不会被停
  roomUnbind(u, '5001')
  await api('logout'); await api('emailLogin', A.email, A.password); await sleep(1500)
  check('平台后台解绑 5001 后重新登录：本机仍保留 5001（免检不以平台为准）', (await rooms()).rooms.includes('5001'))

  // ---- 连接器：平台上没绑的房间也能连（只扫码取抖音登录态，那是连直播间用的） ----
  u.rights.clear()
  await api('setGameCurrent', 'librarian')
  const readsBeforeConnect = roomsReads()
  await begin('connectorStart', '2005', false)
  await scanWith('sess-free-2005')
  const started = await result(20000)
  await until(async () => (await api('connectorState')).running, '连接器没有启动')
  check('连接平台上没绑的 2005：不报「尚未绑定」、扫码取登录态后启动 ' + JSON.stringify(started), started.ok === true && (await scanCount()) === 1 && /sessionid=sess-free-2005/.test(await cookieFile(libDir)))
  await until(async () => (await api('connectorLog')).some((l) => /TEST_CONNECTOR_COOKIE=.*sess-free-2005/.test(l.text)), 'python 连接器没读到 2005 的登录态')
  check('日志：授权检查已暂停，不向平台核对直播间绑定', (await api('connectorLog')).some((l) => /不向平台核对直播间绑定/.test(l.text)))
  await sleep(6000)
  check('运行 6 秒（复核周期 2.5 秒）：连接器没有被后台复核停掉、平台 rooms 零请求 ' + JSON.stringify({ running: (await api('connectorState')).running, reads: roomsReads() - readsBeforeConnect }), (await api('connectorState')).running === true && roomsReads() === readsBeforeConnect)
  await api('connectorStop')
  await until(async () => (await api('connectorState')).running === false, '连接器没停')
  const un2 = await api('unbindRoom', '2005')
  check('解绑刚连过的 2005：成功（连接器已停，不影响）', un2.ok === true)

  // ---- 界面：名额显示「不限」 ----
  // 前面都是走 window.api 登录，页面自己的登录状态还停在登录面板：刷新后按界面登录一次再进连接器页
  await page.evaluate(async () => { await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true }); localStorage.setItem('zl-guide-seen', '1') })
  await page.reload()
  await page.waitForFunction(() => !!window.api?.cardRooms)
  await page.waitForTimeout(800)
  if (await page.locator('[data-testid="login-panel"]').count()) {
    await page.getByPlaceholder('邮箱 / 用户名').fill(A.email)
    await page.getByPlaceholder('密码').fill(A.password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
  }
  await page.evaluate(() => { location.hash = '/connector' })
  await page.waitForTimeout(800)
  const roomQuota = page.getByTestId('room-quota').first()
  if (await roomQuota.count() === 0) {
    // 已有绑定时入口是「绑定 / 管理直播间」，没绑定时是「绑定直播间」
    const manage = page.getByTestId('connector-manage-btn')
    if (await manage.count()) await manage.click(); else await page.getByTestId('connector-bind-btn').click()
    await page.waitForTimeout(600)
  }
  await until(async () => (await page.getByTestId('room-quota').first().count()) > 0 && /不限/.test(await page.getByTestId('room-quota').first().textContent()), '界面没显示「不限」', 15000)
  const text = await page.getByTestId('room-quota').first().textContent()
  check('界面：名额行显示「数量不限 · 改绑不限」、不出现 /999 ' + JSON.stringify(text), /数量不限/.test(text) && /改绑不限/.test(text) && !/999/.test(text) && !/剩余改绑/.test(text))
  const manager = page.getByTestId('room-manager').first()
  const managerText = await manager.textContent()
  check('界面：免检下没有「先扫码」按钮、名额卡 / 改绑卡入口和扫码提示', (await manager.getByTestId('room-scan-btn').count()) === 0 && (await manager.getByTestId('room-slot-card-btn').count()) === 0 && !/名额卡|改绑卡|会打开浏览器/.test(managerText) && /都不限/.test(managerText))
  await page.screenshot({ path: path.join(output, 'rooms-free-ui.png') }).catch(() => {})
  check('界面：免检下顶栏没有「卡密授权」入口、娱乐助手没有卡密状态条', (await page.getByTestId('card-access-button').count()) === 0 && (await page.getByTestId('entertainment-card-bar').count()) === 0 && !/卡密/.test(await page.locator('body').textContent()))
  await page.evaluate(() => { location.hash = '/settings' }); await page.waitForTimeout(800)
  check('界面：免检下设置页没有卡密授权区 / 激活表单，标题是「账号与直播间绑定」', (await page.getByTestId('account-card-access').count()) === 0 && (await page.getByTestId('card-redeem-form').count()) === 0 && (await page.getByText('账号与直播间绑定', { exact: true }).count()) === 1 && !/卡密/.test(await page.locator('body').textContent()))
  check('页面无 JS 错误', pageErrors.length === 0)
} catch (e) {
  failure = e
} finally {
  try { await app.evaluate(({ app }) => app.quit()) } catch { /* 已退出 */ }
  await sleep(1000)
  server.close()
}
if (failure) { console.log('FAIL ' + (failure?.message || failure)); process.exit(1) }
console.log(`ROOMS-FREE ${checks.length}/${checks.length} PASS`)
