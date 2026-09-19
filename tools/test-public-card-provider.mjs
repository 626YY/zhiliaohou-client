// 正式公网卡密平台接入 + 旧账号兼容 回归（2026-09-13）。全部在临时 profile 里跑，不碰真实 userData / 素材 / 游戏目录 / 线上服务。
//   单元（esbuild 打包 card-provider.ts，node 直接跑）：
//     基地址规则（https 子路径 / 本机 http / 拒绝明文公网、账号密码、参数、锚点、编码、`..`、空段）、baseUrl 别名、
//     migrateLegacyCredentials 只对 resources+官方地址放行、identityMode 校验、legacyLocalAccountsOnly 判定、读取顺序。
//   集成（真实隐藏 Electron 构建 + 本测试私有的 HTTPS 假平台（测试 CA，只在测试引导里放行）+ 假旧身份服务 + 假抖音）：
//     S1 无配置 → 旧账号系统原样；
//     S2 显式 https://127.0.0.1/card（existing）：分区证书校验已注册且生产 pin 未降级、接口带 /card 前缀、
//        验证码注册（页面真操作）/ 错误码 / 找回密码直接登录、旧邮箱身份由服务端验密码并迁移权益与房间；
//     S3 同配置但引导不放行测试证书 → TLS 拒绝（证明校验没关）；
//     S4 本机 local 平台 → 免验证码注册、不发验证码、找回不支持；
//     S5 平台 /api/v1/config 读不到 → 保守按需要验证码；
//     S6 打包默认（app.isPackaged + resources 桩，官方 host:port 经测试 CONNECT 代理隧道到假平台）：显式本机配置优先 /
//        旧邮箱凭据 DPAPI 迁移且不覆盖新记录、不迁本地账号、旧文件字节不变 / 昵称头像复制、users.json 不动 /
//        自动登录沿用 / 主动连接后只改轮椅 LiveRoomId、其余配置逐值保留、未绑定不改；
//     S7 只有旧本地账号 → legacyHold 保持旧系统、登录页给切换入口、切换后重启进平台。
//   用法：node tools/test-public-card-provider.mjs   （构建目录默认 output/fable-public-client-build，可用 ZL_PUBLIC_OUT_DIR 覆盖）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import Module, { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { X509Certificate, createHash, generateKeyPairSync, randomBytes, randomUUID, sign as cryptoSign } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { build as esbuild } from 'esbuild'
import bcrypt from 'bcryptjs'
import { prepareIsolatedGameProfile } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.env.ZL_PUBLIC_OUT_DIR || 'output/fable-public-client-build'
const output = path.join(root, 'output/playwright/public-card-provider')
await fs.mkdir(output, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))
const work = await fs.mkdtemp(path.join(output, 'run-'))

const OFFICIAL = 'https://47.251.93.171:8770/card'
const OFFICIAL_HOST = '47.251.93.171'
const serverTlsSrc = await fs.readFile(path.join(root, 'src/main/server-tls.ts'), 'utf8')
const PROD_PIN_B64 = /PIN_B64 = '([^']+)'/.exec(serverTlsSrc)[1]
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const checks = []
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, label, ms = 15000) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(120) }
  throw new Error(label)
}
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
const originKey = (origin) => createHash('sha256').update(origin).digest('hex').slice(0, 12)
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const exists = (p) => fs.access(p).then(() => true, () => false)
const stable = (v) => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map((x) => JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(stable(v[k]))])) : v)

// ============================================================ 单元：card-provider.ts ============================================================
{
  const unitDir = path.join(work, 'unit')
  await fs.mkdir(path.join(unitDir, 'data'), { recursive: true })
  // electron 桩：内存对象，测试可改 isPackaged；产品模块每次重新 require（缓存清掉）拿到同一个桩
  const electronStub = { app: { isPackaged: false, getPath: () => unitDir }, session: { defaultSession: { setCertificateVerifyProc() {} } } }
  const originalLoad = Module._load
  Module._load = function (request, ...rest) { return request === 'electron' ? electronStub : originalLoad.call(this, request, ...rest) }
  const bundle = path.join(unitDir, 'card-provider.cjs')
  await esbuild({ entryPoints: [path.join(root, 'src/main/card-provider.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, external: ['electron'], logLevel: 'silent' })
  const require = createRequire(import.meta.url)
  const fresh = () => { delete require.cache[bundle]; return { mod: require(bundle), electron: electronStub } }
  const { mod } = fresh()
  const ok = (input, expected) => assert.equal(mod.normalizeCardBaseUrl(input), expected, '应接受 ' + input)
  const bad = (input, why) => assert.throws(() => mod.normalizeCardBaseUrl(input), why + '：' + input)
  ok(OFFICIAL, OFFICIAL); ok(OFFICIAL + '/', OFFICIAL); ok('HTTPS://47.251.93.171:8770/card', OFFICIAL)
  ok('http://127.0.0.1:5000', 'http://127.0.0.1:5000'); ok('http://127.0.0.1:5000/', 'http://127.0.0.1:5000'); ok('https://127.0.0.1:5001/sub/path/', 'https://127.0.0.1:5001/sub/path')
  ok('https://example.com/a.b-c_d', 'https://example.com/a.b-c_d')
  check('基地址：官方 https 子路径 / 本机 http(s) / 尾斜杠归一 / 大小写协议 全部接受', true)
  bad('http://47.251.93.171:8770/card', '明文公网'); bad('http://localhost:5000', '非 127.0.0.1 的 http'); bad('http://[::1]:5000', 'IPv6 明文')
  bad('https://u:p@47.251.93.171:8770/card', '账号密码'); bad('https://47.251.93.171:8770/card?x=1', '查询串'); bad('https://47.251.93.171:8770/card#f', '锚点')
  bad('https://47.251.93.171:8770/card/../admin', '..'); bad('https://47.251.93.171:8770/card/.', '.'); bad('https://47.251.93.171:8770//card', '空段'); bad('https://47.251.93.171:8770/card//api', '空段')
  bad('https://47.251.93.171:8770/c%61rd', '编码'); bad('https://47.251.93.171:8770/card\\x', '反斜杠'); bad('https://47.251.93.171:8770/card x', '空白'); bad('ftp://47.251.93.171/card', '协议'); bad('', '空'); bad(undefined, '缺失')
  check('基地址：明文公网 / 账号密码 / 参数 / 锚点 / 路径穿越 / 空段 / 编码 / 反斜杠 / 非 http(s) 全部拒绝', true)
  const pk = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url')
  const p1 = mod.parseCardProviderConfig(JSON.stringify({ provider: 'card', baseUrl: OFFICIAL, publicKey: pk, identityMode: 'existing', migrateLegacyCredentials: true }), 'resources')
  check('解析：baseUrl 别名 + resources + 官方地址 → official 且允许迁移', p1.enabled && !p1.error && p1.origin === OFFICIAL && p1.official === true && p1.migrateLegacyCredentials === true && p1.identityMode === 'existing' && p1.source === 'resources')
  const p2 = mod.parseCardProviderConfig(JSON.stringify({ provider: 'card', origin: OFFICIAL, publicKey: pk, migrateLegacyCredentials: true }), 'userData')
  check('解析：显式 userData 文件即使写了 migrateLegacyCredentials 也不放行', p2.enabled && !p2.error && p2.official === true && p2.migrateLegacyCredentials === false && p2.identityMode === undefined)
  const p3 = mod.parseCardProviderConfig(JSON.stringify({ provider: 'card', baseUrl: 'https://other.example/card', publicKey: pk, migrateLegacyCredentials: true }), 'resources')
  check('解析：resources 文件但不是官方地址 → 不放行迁移、official=false', p3.enabled && !p3.error && p3.official === false && p3.migrateLegacyCredentials === false)
  check('解析：identityMode 非法 / origin 与 baseUrl 不一致 / 明文公网 都报配置无效', /identityMode/.test(mod.parseCardProviderConfig(JSON.stringify({ provider: 'card', origin: OFFICIAL, publicKey: pk, identityMode: 'cloud' })).error) && /不一致/.test(mod.parseCardProviderConfig(JSON.stringify({ provider: 'card', origin: OFFICIAL, baseUrl: 'https://127.0.0.1/x', publicKey: pk })).error) && /https/.test(mod.parseCardProviderConfig(JSON.stringify({ provider: 'card', origin: 'http://47.251.93.171:8770/card', publicKey: pk })).error))
  const users = path.join(unitDir, 'data/users.json'), creds = path.join(unitDir, 'data/creds.json')
  const local = { id: 'u1', username: 'legacy_user', passwordHash: 'x', nickname: '本地', avatar: '', createdAt: 1, lastLoginAt: 1 }
  const emailUser = { id: 'u2', username: 'old@example.test', passwordHash: 'x', nickname: '老主播', avatar: '', createdAt: 1, lastLoginAt: 2, email: 'old@example.test' }
  const rm = async (p) => fs.rm(p, { force: true })
  await rm(users); await rm(creds)
  check('legacyLocalAccountsOnly：没有 users.json → false（新装机进平台）', fresh().mod.legacyLocalAccountsOnly() === false)
  await fs.writeFile(users, JSON.stringify([local]))
  check('legacyLocalAccountsOnly：只有本地账号 → true', fresh().mod.legacyLocalAccountsOnly() === true)
  await fs.writeFile(users, JSON.stringify([local, emailUser]))
  check('legacyLocalAccountsOnly：本地 + 邮箱账号 → false', fresh().mod.legacyLocalAccountsOnly() === false)
  await fs.writeFile(users, JSON.stringify([{ ...local, id: 'u3', username: 'someone@example.test' }]))
  check('legacyLocalAccountsOnly：用户名本身是邮箱（老记录没 email 字段）→ false', fresh().mod.legacyLocalAccountsOnly() === false)
  await fs.writeFile(users, JSON.stringify([local]))
  await fs.writeFile(creds, JSON.stringify({ last: 'x@example.test', map: { 'x@example.test': 'p:' + Buffer.from('pw').toString('base64') } }))
  check('legacyLocalAccountsOnly：本地账号 + 记住密码里有邮箱 → false', fresh().mod.legacyLocalAccountsOnly() === false)
  await rm(users); await rm(creds)
  // 读取顺序：显式 > resources 默认（仅 isPackaged）> legacy
  const resDir = path.join(unitDir, 'resources'); await fs.mkdir(resDir, { recursive: true })
  await fs.writeFile(path.join(resDir, 'license-provider.json'), JSON.stringify({ provider: 'card', baseUrl: OFFICIAL, publicKey: pk, identityMode: 'existing', migrateLegacyCredentials: true }))
  const savedRes = process.resourcesPath
  try {
    process.resourcesPath = resDir
    check('读取顺序：未打包时不读 resources 默认 → legacy', fresh().mod.loadCardProviderConfig().enabled === false)
    const f = fresh(); f.electron.app.isPackaged = true
    const c = f.mod.loadCardProviderConfig()
    check('读取顺序：打包后读 resources 默认（source=resources，官方，允许迁移）', c.enabled && c.source === 'resources' && c.official && c.migrateLegacyCredentials)
    await fs.writeFile(path.join(unitDir, 'license-provider.json'), JSON.stringify({ provider: 'card', origin: 'http://127.0.0.1:5000', publicKey: pk }))
    const g = fresh(); g.electron.app.isPackaged = true
    const c2 = g.mod.loadCardProviderConfig()
    check('读取顺序：userData 显式文件优先于 resources 默认', c2.enabled && c2.source === 'userData' && c2.origin === 'http://127.0.0.1:5000' && !c2.official)
    await rm(path.join(unitDir, 'license-provider.json'))
    await fs.writeFile(users, JSON.stringify([local]))
    const h = fresh(); h.electron.app.isPackaged = true
    const c3 = h.mod.loadCardProviderConfig()
    check('读取顺序：resources 默认 + 只有旧本地账号 → legacyHold（不启用、可切换）', c3.enabled === false && c3.legacyHold === 'local-accounts' && c3.defaultAvailable === true)
    const adopt = h.mod.adoptDefaultCardProvider()
    const i = fresh(); i.electron.app.isPackaged = true
    check('adoptDefault：把默认文件原样写成显式文件，重载后进平台（source=userData，迁移不再放行）', adopt.ok && adopt.restart && (await fs.readFile(path.join(unitDir, 'license-provider.json'), 'utf8')) === (await fs.readFile(path.join(resDir, 'license-provider.json'), 'utf8')) && i.mod.loadCardProviderConfig().source === 'userData' && i.mod.loadCardProviderConfig().migrateLegacyCredentials === false)
    check('adoptDefault：已有显式文件时拒绝', h.mod.adoptDefaultCardProvider().ok === false)
    await rm(path.join(unitDir, 'license-provider.json')); await rm(users)
  } finally {
    process.resourcesPath = savedRes
    Module._load = originalLoad
  }
}

// ============================================================ 测试 CA / 假平台 ============================================================
const tlsDir = path.join(work, 'tls'); await fs.mkdir(tlsDir, { recursive: true })
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tlsDir, 'key.pem'), '-out', path.join(tlsDir, 'cert.pem'), '-days', '2', '-subj', '/CN=zhiliao-public-card-test', '-addext', `subjectAltName=IP:127.0.0.1,IP:${OFFICIAL_HOST}`], { stdio: 'ignore' })
const certPem = await fs.readFile(path.join(tlsDir, 'cert.pem'), 'utf8')
const keyPem = await fs.readFile(path.join(tlsDir, 'key.pem'), 'utf8')
const TEST_FP = 'sha256/' + createHash('sha256').update(new X509Certificate(certPem).raw).digest('base64')
check('测试证书指纹不等于生产 pin（证明后面通过的连接不是靠生产 pin）', TEST_FP !== 'sha256/' + PROD_PIN_B64)

const ed = generateKeyPairSync('ed25519')
const publicKey = ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url')
const PRODUCTS = ['platform:assistant', 'game:librarian', 'game:dontscream', 'game:4wheel-challenge']
class Problem extends Error { constructor(message, status = 400, code = '') { super(message); this.status = status; this.code = code } }
const modManifest = await readJson(path.join(root, 'output/local-card-mod/manifest.json'))

/** 假卡密平台：basePath 下才有接口；existing 模式下未注册账号由「旧身份服务」验密码并迁移权益 / 房间 */
function createPlatform({ basePath, identity }) {
  const state = {
    basePath, identity, configMode: 'ok', users: new Map(), sessions: new Map(), codes: new Map(), legacy: new Map(), log: [], sentCodes: [], unknownPaths: []
  }
  const findUser = (id) => [...state.users.values()].find((u) => u.id === id)
  const rightsOf = (u) => PRODUCTS.map((id) => ({ id, name: id, kind: id.startsWith('game:') ? 'game' : 'platform', status: u.rights.has(id) ? 'active' : 'none', permanent: u.rights.has(id), expires_at: null, allowed: u.rights.has(id), reasons: u.rights.has(id) ? [] : ['no_entitlement'] }))
  const quotaOf = (u) => ({ capacity: Math.max(1, u.rooms.length), changes_left: 3, changes_used: 0, available: Math.max(0, Math.max(1, u.rooms.length) - u.rooms.length), rooms: [...u.rooms], bindings: u.rooms.map((room, i) => ({ slot: i + 1, room })) })
  const signLease = (claims) => { const h = b64u({ alg: 'EdDSA', typ: 'JWT' }), p = b64u(claims); return h + '.' + p + '.' + cryptoSign(null, Buffer.from(h + '.' + p), ed.privateKey).toString('base64url') }
  const newUser = (email, password, extra = {}) => { const u = { id: randomUUID(), email, password, rights: new Set(extra.rights || []), rooms: [...(extra.rooms || [])], migrated: !!extra.migrated }; state.users.set(email, u); return u }
  const sessionFor = (u, res) => {
    const token = randomBytes(24).toString('hex'), csrf = randomBytes(16).toString('hex')
    state.sessions.set(token, { userId: u.id, csrf })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `zl_license_session=${token}; Path=${basePath || '/'}; HttpOnly; Secure; SameSite=Strict` })
    res.end(JSON.stringify({ ok: true, csrf, user: { id: u.id, email: u.email, role: 'user' } }))
  }
  const requireCode = (email, code) => {
    if (state.identity !== 'existing') return
    const expected = state.codes.get(email)
    if (!expected || String(code || '') !== expected) throw new Problem('验证码不正确或已过期', 400, 'invalid_code')
    state.codes.delete(email)
  }
  const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
    let text = ''
    req.on('data', (d) => { text += d })
    req.on('end', () => {
      const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
      try {
        const url = new URL(req.url, 'https://127.0.0.1')
        state.log.push({ method: req.method, path: url.pathname })
        if (!url.pathname.startsWith(basePath + '/')) { state.unknownPaths.push(url.pathname); throw new Problem('接口不存在（前缀不对）', 404, 'wrong_prefix') }
        const p = url.pathname.slice(basePath.length)
        const body = text ? JSON.parse(text) : {}
        const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]))
        const session = state.sessions.get(cookies.zl_license_session || '')
        const user = session ? findUser(session.userId) : null
        const email = String(body.email || '').trim().toLowerCase()
        if (p === '/health') return reply(200, { ok: true, service: 'zhiliao-license', version: 1 })
        if (p === '/api/v1/config') {
          if (state.configMode === 'error') return reply(500, { ok: false, error: '内部错误' })
          if (state.configMode === 'missing') return reply(404, { ok: false, error: '接口不存在', code: 'not_found' })
          return reply(200, { ok: true, identity_mode: state.identity, registration: true, registration_requires_code: state.identity === 'existing' })
        }
        if (p === '/api/v1/send-code') {
          if (!EMAIL_RE.test(email)) throw new Problem('邮箱格式不正确', 400, 'invalid_email')
          if (state.identity !== 'existing') throw new Problem('本机模式不发验证码', 409, 'code_not_required')
          const code = String(100000 + state.sentCodes.length * 7919 % 900000)
          state.codes.set(email, code); state.sentCodes.push({ email, code })
          return reply(200, { ok: true, cooldown: 60 })
        }
        if (p === '/api/v1/register') {
          if (!EMAIL_RE.test(email)) throw new Problem('邮箱格式不正确', 400, 'invalid_email')
          if (String(body.password || '').length < 6) throw new Problem('密码至少 6 位', 400, 'weak_password')
          requireCode(email, body.code)
          if (state.users.has(email) || (state.identity === 'existing' && state.legacy.has(email))) throw new Problem('该邮箱已注册，请直接登录', 409, 'email_taken')
          return sessionFor(newUser(email, String(body.password)), res)
        }
        if (p === '/api/v1/login') {
          let u = state.users.get(email)
          if (!u && state.identity === 'existing' && state.legacy.has(email)) {
            // 旧邮箱身份服务真正验密码：通过才建号并迁移权益 / 房间（客户端只给邮箱密码，什么都不自报）
            const old = state.legacy.get(email)
            if (old.password !== String(body.password || '')) return reply(401, { ok: false, error: '账号或密码不正确，或账号已停用', code: 'invalid_login' })
            u = newUser(email, old.password, { rights: old.rights, rooms: old.rooms, migrated: true })
          } else if (!u || u.password !== String(body.password || '')) return reply(401, { ok: false, error: '账号或密码不正确，或账号已停用', code: 'invalid_login' })
          return sessionFor(u, res)
        }
        if (p === '/api/v1/reset-password') {
          if (state.identity !== 'existing') throw new Problem('本机模式不支持自助找回密码', 409, 'reset_unsupported')
          if (String(body.password || '').length < 6) throw new Problem('密码至少 6 位', 400, 'weak_password')
          requireCode(email, body.code)
          let u = state.users.get(email)
          if (!u && state.legacy.has(email)) { const old = state.legacy.get(email); u = newUser(email, old.password, { rights: old.rights, rooms: old.rooms, migrated: true }) }
          if (!u) throw new Problem('该邮箱尚未注册', 404, 'not_found')
          u.password = String(body.password)
          if (state.legacy.has(email)) state.legacy.get(email).password = u.password
          return sessionFor(u, res)
        }
        if (!user) return reply(401, { ok: false, error: '未登录', code: 'unauthorized' })
        if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) return reply(403, { ok: false, error: 'CSRF 校验失败', code: 'csrf' })
        // 登录后辅助 watcher 会立即轮询；这里只提供固定协议，完整辅助行为由 test-card-aux.mjs 验证。
        // 仍先经过上面的 basePath / 会话 / CSRF 检查，未知操作继续进入 unknownPaths。
        const compat = /^\/api\/v1\/compat\/(notify|heartbeat|config-save|config-get|live-events)$/.exec(p)
        if (compat && req.method === 'POST') {
          if (state.identity !== 'existing') throw new Problem('本机平台未接入原邮箱服务', 409, 'identity_not_linked')
          if (compat[1] === 'notify') return reply(200, { ok: true, result: { ok: 1, list: [] } })
          if (compat[1] === 'config-get') return reply(200, { ok: true, result: { ok: 1, has: 0 } })
          if (compat[1] === 'live-events') return reply(503, { ok: false, error: '本夹具不接收观众记录', code: 'identity_unavailable' })
          return reply(200, { ok: true, result: { ok: 1 } })
        }
        if (p === '/api/v1/logout') { state.sessions.delete(cookies.zl_license_session); return reply(200, { ok: true }) }
        if (p === '/api/v1/me') return reply(200, { ok: true, csrf: session.csrf, user: { id: user.id, email: user.email, role: 'user' }, rights: rightsOf(user), room_quota: quotaOf(user) })
        if (p === '/api/v1/authorize') {
          const item = rightsOf(user).find((r) => r.id === body.product_id)
          if (!item) throw new Problem('产品不存在', 404)
          if (!item.allowed) return reply(403, { ok: false, allowed: false, reasons: item.reasons })
          const now = Math.floor(Date.now() / 1000)
          return reply(200, { ok: true, allowed: true, lease: signLease({ iss: 'zhiliao-license', aud: 'zhiliao-client', sub: user.id, product_id: body.product_id, device: createHash('sha256').update(String(body.device_id)).digest('hex'), iat: now, exp: now + 120, nonce: body.nonce }), expires_at: now + 120 })
        }
        if (p === '/api/v1/mod-license') {
          if (!user.rooms.includes(String(body.room))) return reply(409, { ok: false, error: '直播间未绑定到当前账号', code: 'room_not_bound' })
          return reply(403, { ok: false, allowed: false, reasons: ['fixture_no_rsa'] })
        }
        if (p === '/api/v1/rooms' && req.method === 'GET') return reply(200, { ok: true, room_quota: quotaOf(user) })
        const m = /^\/api\/v1\/rooms\/(bind|replace|unbind)$/.exec(p)
        if (m && req.method === 'POST') {
          if (!req.headers['idempotency-key']) throw new Problem('缺少 Idempotency-Key', 400, 'idempotency_required')
          const room = String(body.room || '')
          if (m[1] === 'bind' && !user.rooms.includes(room)) { if (user.rooms.length >= Math.max(1, user.rooms.length)) throw new Problem('直播间名额已用完', 409, 'room_slot_card_required'); user.rooms.push(room) }
          if (m[1] === 'replace') { const i = user.rooms.indexOf(String(body.previous || '')); if (i < 0) throw new Problem('原绑定已变化', 409, 'room_binding_changed'); user.rooms[i] = room }
          if (m[1] === 'unbind') user.rooms = user.rooms.filter((r) => r !== room)
          return reply(200, { ok: true, room_quota: quotaOf(user) })
        }
        state.unknownPaths.push(url.pathname)
        throw new Problem('接口不存在', 404, 'not_found')
      } catch (e) {
        const status = e instanceof Problem ? e.status : 500
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message, code: e.code || '' }))
      }
    })
  })
  return { state, server, listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(() => r())) }
}

/**
 * 测试用 CONNECT 代理：只把「官方 host:port」的 TLS 隧道接到本测试的假平台端口，其它目标一律 403 —— 客户端拨的仍是
 * https://47.251.93.171:8770，TLS 端到端到假平台（测试证书由引导层放行）。host-resolver-rules 对 IP 字面量主机不生效，所以用代理。
 */
function createOfficialTunnel(targetPort) {
  const log = []
  const srv = http.createServer((_req, res) => { res.writeHead(403); res.end() })
  srv.on('connect', (req, clientSocket, head) => {
    log.push(req.url)
    if (req.url !== `${OFFICIAL_HOST}:8770`) { clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head && head.length) upstream.write(head)
      upstream.pipe(clientSocket); clientSocket.pipe(upstream)
    })
    upstream.on('error', () => clientSocket.destroy()); clientSocket.on('error', () => upstream.destroy())
  })
  return { log, listen: () => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port))), close: () => new Promise((r) => srv.close(() => r())) }
}

// ============================================================ 隐藏 Electron 引导 ============================================================
const electronExe = path.join(root, 'node_modules/electron/dist/electron.exe')
const loginHtml = '<html><meta charset="utf-8"><h1>扫码登录（自动化测试页面）</h1><button onclick="this.outerHTML=\'<p>扫码登录</p>\'">登录</button></html>'
/**
 * options：packaged（app.isPackaged=true + process.resourcesPath=resourcesDir 桩）、allowTestCert（引导层对测试证书放行；
 * 产品的校验过程照常记录并可被直接调用核对）、proxyPort（CONNECT 代理端口，把官方 host:port 隧道到假平台）、douyin（假抖音页面 / 回包）。
 */
async function launch({ profile, providerConfig, packaged = false, resourcesDir = '', allowTestCert = true, proxyPort = 0, douyin = false, isolate = true }) {
  if (isolate) await prepareIsolatedGameProfile(root, profile)
  // 临时 profile：跳过新手引导页（登录后直接进主界面），其它设置保持隔离夹具给的
  const settingsFile = path.join(profile, 'data/settings.json')
  if (await exists(settingsFile)) await fs.writeFile(settingsFile, JSON.stringify({ ...(await readJson(settingsFile)), guideSeen: true }))
  if (providerConfig !== undefined) await fs.writeFile(path.join(profile, 'license-provider.json'), typeof providerConfig === 'string' ? providerConfig : JSON.stringify(providerConfig), 'utf8')
  const entry = path.join(profile, 'public-bootstrap.cjs')
  await fs.writeFile(entry, `
const electron = require('electron');
const { app: realApp, BrowserWindow: NativeWindow, session } = electron;
realApp.setPath('userData', ${JSON.stringify(profile)}); realApp.setAppPath(${JSON.stringify(root)});
${proxyPort ? `realApp.commandLine.appendSwitch('proxy-server', '127.0.0.1:${proxyPort}');` : ''}
${packaged ? `Object.defineProperty(process, 'resourcesPath', { value: ${JSON.stringify(resourcesDir)}, configurable: true, writable: true });` : ''}
electron.dialog.showErrorBox = (t, c) => process.stderr.write(t + ': ' + c + '\\n');
electron.dialog.showMessageBox = async () => ({ response: -1, checkboxChecked: false });
electron.dialog.showMessageBoxSync = () => -1;
electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
for (const m of ['show', 'showInactive', 'focus', 'restore', 'maximize', 'moveTop']) NativeWindow.prototype[m] = function () {};
realApp.focus = () => {};
const qa = global.__zlPub = { pins: {}, verifyCalls: [], windows: [], scans: [], expired: new Set(), fetchLog: [] };
const app = ${packaged ? 'new Proxy(realApp, { get(t, k) { if (k === "isPackaged") return true; const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; } })' : 'realApp'};
const HiddenWindow = new Proxy(NativeWindow, { construct(Target, args) {
  const opts = args[0] || {};
  qa.windows.push({ title: opts.title || '' });
  return Reflect.construct(Target, [{ ...opts, show: false, focusable: false, webPreferences: { ...(opts.webPreferences || {}), backgroundThrottling: false, paintWhenInitiallyHidden: true } }], Target);
}});
const realFromPartition = session.fromPartition.bind(session);
const sessionFacade = new Proxy(session, { get(target, key) {
  if (key === 'fromPartition') return (name, opts) => {
    const ses = realFromPartition(name, opts);
    if (String(name).startsWith('card-license-') && !ses.__zlPatched) {
      ses.__zlPatched = true;
      ${proxyPort ? `void ses.setProxy({ proxyRules: '127.0.0.1:${proxyPort}' }).catch(() => {});` : ''}
      const orig = ses.setCertificateVerifyProc.bind(ses);
      ses.setCertificateVerifyProc = (proc) => {
        qa.pins[name] = proc;
        orig((req, cb) => {
          qa.verifyCalls.push({ hostname: req.hostname, fingerprint: req.certificate && req.certificate.fingerprint });
          if (${allowTestCert ? 'true' : 'false'} && req.certificate && req.certificate.fingerprint === ${JSON.stringify(TEST_FP)}) return cb(0);
          return proc(req, cb);
        });
      };
    }
    if (${douyin ? 'true' : 'false'} && String(name).startsWith('card-room-scan-') && !qa.scans.some((s) => s.ses === ses)) {
      ses.protocol.handle('https', () => new Response(${JSON.stringify(loginHtml)}, { headers: { 'Content-Type': 'text/html' } }));
      qa.scans.push({ name, ses });
    }
    return ses;
  };
  return Reflect.get(target, key);
}});
const Module = require('node:module'), originalLoad = Module._load;
const facade = { ...electron, app, BrowserWindow: HiddenWindow, session: sessionFacade };
Module._load = function (request) { return request === 'electron' ? facade : originalLoad.apply(this, arguments); };
${douyin ? `
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
  return new Response('<div data-anchor-info="{&quot;nickname&quot;:&quot;主播' + room + '&quot;,&quot;avatar&quot;:&quot;https://example.invalid/a.png&quot;}"></div>');
};` : ''}
global.__zhiliaoHiddenTest = true;
require(${JSON.stringify(path.resolve(root, outDir, 'main/index.js'))});
`, 'utf8')
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: electronExe, args: [entry, `--user-data-dir=${profile}`, ...(proxyPort ? [`--proxy-server=127.0.0.1:${proxyPort}`] : [])], cwd: root, env, timeout: 60000 })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForFunction(() => !!window.api?.cardState && !!window.api?.cardAdoptDefault)
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须使用本次隔离 profile')
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
  const qa = (fn, arg) => app.evaluate(fn, arg)
  return { app, page, api, qa, errors }
}
const newProfile = () => fs.mkdtemp(path.join(output, 'session-'))
/** 直接调用产品注册到分区上的证书校验过程（不经网络），核对 pin 语义 */
const verifyWith = (qa, req) => qa(({}, req) => new Promise((resolve) => { const name = Object.keys(global.__zlPub.pins).find((n) => n.startsWith('card-license-')); if (!name) return resolve('no-pin'); global.__zlPub.pins[name](req, (v) => resolve(v)) }), req)

// ============================================================ S1 无配置 ============================================================
let failure
const platforms = []
try {
  {
    const profile = await newProfile()
    const { app, api, errors } = await launch({ profile })
    try {
      const st = await api('cardState')
      check('S1 无配置：cardState enabled=false、无 legacyHold', st.ok === true && st.enabled === false && !st.legacyHold)
      const reg = await api('register', 'legacy_user', 'Fixture123!', '旧账号')
      check('S1 无配置：旧本地账号注册 / 登录原样可用', reg.ok && (await api('login', 'legacy_user', 'Fixture123!')).ok && (await api('session'))?.username === 'legacy_user')
      check('S1 无配置：cardAdoptDefault 明确说没有默认配置', (await api('cardAdoptDefault')).ok === false)
      check('S1 无配置：页面无报错', errors.length === 0)
    } finally { await app.close() }
  }

  // ============================================================ S2 显式 https://127.0.0.1/card（existing）============================================================
  const pub = createPlatform({ basePath: '/card', identity: 'existing' })
  platforms.push(pub)
  const pubPort = await pub.listen()
  const pubBase = `https://127.0.0.1:${pubPort}/card`
  const legacyEmail = `old-${Date.now()}@example.test`, legacyPassword = 'Old-' + randomUUID().slice(0, 10)
  pub.state.legacy.set(legacyEmail, { password: legacyPassword, rights: ['platform:assistant', 'game:4wheel-challenge'], rooms: ['577117602'] })
  {
    const profile = await newProfile()
    const { app, page, api, qa, errors } = await launch({ profile, providerConfig: { provider: 'card', baseUrl: pubBase, publicKey, identityMode: 'existing' } })
    try {
      const st0 = await api('cardState')
      check('S2 cardState：连上（经测试证书放行）、origin 含 /card、source=userData、identityMode=existing、需要验证码', st0.ok === true && st0.enabled && st0.origin === pubBase && st0.source === 'userData' && st0.identityMode === 'existing' && st0.registrationRequiresCode === true && !st0.user)
      check('S2 接口全部带 /card 前缀（health / config），没有丢前缀的请求', pub.state.log.some((l) => l.path === '/card/health') && pub.state.log.some((l) => l.path === '/card/api/v1/config') && pub.state.unknownPaths.length === 0)
      const pinName = await qa(() => Object.keys(global.__zlPub.pins).find((n) => n.startsWith('card-license-')) || '')
      check('S2 平台会话分区（card-license-*）上注册了证书校验过程', pinName.startsWith('card-license-'))
      check('S2 产品校验过程：官方主机 + 生产指纹 → 0（通过）', (await verifyWith(qa, { hostname: OFFICIAL_HOST, certificate: { fingerprint: 'sha256/' + PROD_PIN_B64 } })) === 0)
      check('S2 产品校验过程：官方主机 + 测试证书 → -2（拒绝，生产 pin 未降级）', (await verifyWith(qa, { hostname: OFFICIAL_HOST, certificate: { fingerprint: TEST_FP } })) === -2)
      check('S2 产品校验过程：其它主机（127.0.0.1 / OSS）→ -3（交给系统 CA，不信任任意证书）', (await verifyWith(qa, { hostname: '127.0.0.1', certificate: { fingerprint: TEST_FP } })) === -3 && (await verifyWith(qa, { hostname: 'zhiliaohou.oss-cn-beijing.aliyuncs.com', certificate: { fingerprint: TEST_FP } })) === -3)
      check('S2 真实连接走的是分区校验（校验过程被调用、主机 127.0.0.1、测试证书）', (await qa(() => global.__zlPub.verifyCalls.some((c) => c.hostname === '127.0.0.1'))))

      // ---- 登录页（真实页面）：existing 模式恢复验证码注册 / 找回密码表单 ----
      const modeBar = page.getByTestId('login-panel')
      await modeBar.waitFor()
      check('S2 登录页保持原表单，后台仍识别 existing 与验证码要求', (await page.getByTestId('card-login-mode').count()) === 0 && !/已连接|授权服务/.test(await modeBar.textContent()) && (await modeBar.getAttribute('data-requires-code')) === '1' && (await modeBar.getAttribute('data-identity')) === 'existing')
      await page.getByRole('button', { name: '忘记密码，无法登录？' }).click()
      check('S2 登录页：找回密码是验证码表单，不是「不支持自助重置」提示', (await page.getByPlaceholder('邮箱验证码').count()) === 1 && (await page.getByTestId('card-reset-help').count()) === 0 && (await page.getByRole('button', { name: '重置密码' }).count()) === 1)
      await page.getByRole('button', { name: '← 返回登录' }).click()
      await page.getByRole('button', { name: '没有账号？创建账号' }).click()
      const uiEmail = `ui-${Date.now()}@example.test`, uiPassword = 'Ui-' + randomUUID().slice(0, 10)
      await page.getByPlaceholder('邮箱号').fill(uiEmail)
      await page.getByPlaceholder('密码（至少 6 位）').fill(uiPassword)
      await page.getByPlaceholder('确认密码').fill(uiPassword)
      await page.getByRole('button', { name: '注册' }).click()
      await until(() => page.getByText('请填写邮箱收到的验证码').count(), '没填验证码时没有提示')
      check('S2 注册页：没填验证码不发请求、提示填验证码', !pub.state.log.some((l) => l.path === '/card/api/v1/register'))
      await page.getByRole('button', { name: '发送验证码' }).click()
      await until(() => pub.state.sentCodes.some((c) => c.email === uiEmail), '页面点「发送验证码」后平台没收到 send-code')
      await until(() => page.getByRole('button', { name: /后可重发/ }).count(), '发送验证码后按钮没有进入倒计时')
      check('S2 注册页：发送验证码走 /card/api/v1/send-code，按钮进入倒计时', pub.state.log.some((l) => l.path === '/card/api/v1/send-code'))
      await page.getByPlaceholder('邮箱验证码').fill('000000')
      await page.getByPlaceholder('昵称（留空用邮箱名）').fill('页面注册')
      await page.getByRole('button', { name: '注册' }).click()
      await until(() => page.getByText('验证码不正确或已过期').count(), '错误验证码没有提示')
      check('S2 注册页：错误验证码 → 平台 invalid_code 原因显示在页面、未建号', !pub.state.users.has(uiEmail) && (await api('session')) === null)
      await page.getByPlaceholder('邮箱验证码').fill(pub.state.sentCodes.find((c) => c.email === uiEmail).code)
      await page.getByRole('button', { name: '注册' }).click()
      await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor({ timeout: 20000 })
      const s1 = await api('session')
      check('S2 注册页：正确验证码 → 建号并登录进主界面，昵称按页面填写', pub.state.users.has(uiEmail) && s1?.email === uiEmail && s1.nickname === '页面注册')
      check('S2 注册 / 登录只用 /card 前缀接口', pub.state.unknownPaths.length === 0 && pub.state.log.every((l) => l.path.startsWith('/card/')))

      // ---- 找回密码（API）：无验证码不发请求；错码 invalid_code；正确 → 直接登录 ----
      await api('logout')
      const r0 = await api('emailReset', uiEmail, '', 'New-' + uiPassword)
      check('S2 找回：没验证码 → code_required、不发请求', r0.ok === false && r0.code === 'code_required' && !pub.state.log.some((l) => l.path === '/card/api/v1/reset-password'))
      const r1 = await api('emailReset', uiEmail, '999999', 'New-' + uiPassword)
      check('S2 找回：错验证码 → 平台 invalid_code 透传', r1.ok === false && r1.code === 'invalid_code')
      check('S2 找回：发验证码', (await api('emailSendCode', uiEmail)).ok === true)
      const r2 = await api('emailReset', uiEmail, pub.state.sentCodes.filter((c) => c.email === uiEmail).at(-1).code, 'New-' + uiPassword)
      check('S2 找回：正确验证码 + 新密码 → 平台直接建立会话，返回已登录账号', r2.ok === true && r2.user?.email === uiEmail && (await api('session'))?.email === uiEmail)
      await api('logout')
      check('S2 找回后：旧密码登录失败（invalid_login）、新密码登录成功', (await api('emailLogin', uiEmail, uiPassword)).code === 'invalid_login' && (await api('emailLogin', uiEmail, 'New-' + uiPassword)).ok === true)
      check('S2 已注册邮箱再注册 → email_taken', (await api('emailSendCode', uiEmail)).ok && (await api('emailRegister', uiEmail, pub.state.sentCodes.at(-1).code, 'xxxxxxx', '')).code === 'email_taken')

      // ---- 旧邮箱身份：平台通过旧服务验密码并迁移权益 / 房间；客户端不自报 ----
      const bad = await api('emailLogin', legacyEmail, 'wrong-' + legacyPassword)
      check('S2 旧邮箱账号错密码 → 401 invalid_login（旧身份服务验的）', bad.ok === false && bad.code === 'invalid_login' && !pub.state.users.has(legacyEmail))
      const mig = await api('emailLogin', legacyEmail, legacyPassword)
      const stMig = await api('cardState')
      check('S2 旧邮箱账号正确密码 → 服务端迁移建号，权益 / 房间来自旧服务', mig.ok === true && pub.state.users.get(legacyEmail)?.migrated === true && stMig.rights.find((r) => r.id === 'platform:assistant').allowed === true && stMig.roomQuota?.rooms.join() === '577117602' && mig.user.boundRooms.join() === '577117602')
      check('S2 客户端没有向平台发过任何授权 / 名额自报请求', !pub.state.log.some((l) => /grant|admin|quota/.test(l.path)) && pub.state.unknownPaths.length === 0)
      check('S2 注册凭 email_taken 抢占旧邮箱账号被拒（旧身份已存在）', (await api('emailSendCode', legacyEmail)).ok && (await api('emailRegister', legacyEmail, pub.state.sentCodes.at(-1).code, 'hijack-pass', '')).code === 'email_taken')
      check('S2 页面无报错', errors.length === 0 && JSON.stringify(errors))
    } finally { await app.close() }
  }

  // ============================================================ S3 不放行测试证书：TLS 校验必须拒绝 ============================================================
  {
    const profile = await newProfile()
    const before = pub.state.log.length
    const { app, api, qa } = await launch({ profile, providerConfig: { provider: 'card', baseUrl: pubBase, publicKey, identityMode: 'existing' }, allowTestCert: false })
    try {
      const st = await api('cardState')
      check('S3 测试 CA 不放行：连接被 TLS 校验拒绝（cardState 明确失败）、平台没收到请求、保守按需要验证码', st.ok === false && st.enabled === true && !!st.error && pub.state.log.length === before && st.registrationRequiresCode === true)
      check('S3 校验过程被调用且回落到系统校验（产品没有放行测试证书）', (await qa(() => global.__zlPub.verifyCalls.length > 0)) && (await verifyWith(qa, { hostname: '127.0.0.1', certificate: { fingerprint: TEST_FP } })) === -3)
      check('S3 注册 / 找回都不会绕过验证码', (await api('emailRegister', 'x@example.test', '', 'password1', '')).code === 'code_required' && (await api('emailReset', 'x@example.test', '', 'password1')).code === 'code_required')
    } finally { await app.close() }
  }

  // ============================================================ S4 本机 local 平台 ============================================================
  const loc = createPlatform({ basePath: '/lic', identity: 'local' })
  platforms.push(loc)
  const locBase = `https://127.0.0.1:${await loc.listen()}/lic`
  {
    const profile = await newProfile()
    const { app, page, api, errors } = await launch({ profile, providerConfig: { provider: 'card', origin: locBase, publicKey } })
    try {
      const st = await api('cardState')
      check('S4 local：identityMode=local、不需要验证码', st.ok && st.identityMode === 'local' && st.registrationRequiresCode === false)
      const bar = page.getByTestId('login-panel'); await bar.waitFor()
      check('S4 登录页不显示平台文案，本机注册仍免验证码', !/卡密平台|已连接/.test(await bar.textContent()) && (await bar.getAttribute('data-requires-code')) === '0')
      await page.getByRole('button', { name: '没有账号？创建账号' }).click()
      check('S4 注册页：没有验证码输入框', (await page.getByPlaceholder('邮箱验证码').count()) === 0)
      await page.getByRole('button', { name: '← 返回登录' }).click()
      await page.getByRole('button', { name: '忘记密码，无法登录？' }).click()
      check('S4 找回：显示「联系管理员」提示（只在本机模式）', (await page.getByTestId('card-reset-help').count()) === 1)
      const email = `local-${Date.now()}@example.test`
      check('S4 local：免验证码注册成功', (await api('emailRegister', email, '', 'password1', '本机')).ok === true && (await api('session'))?.nickname === '本机')
      check('S4 local：发验证码明确说不需要（code_not_required）、找回明确不支持', (await api('emailSendCode', email)).code === 'code_not_required' && (await api('emailReset', email, '', 'password2')).code === 'reset_unsupported')
      check('S4 接口带 /lic 前缀', loc.state.unknownPaths.length === 0 && loc.state.log.every((l) => l.path.startsWith('/lic/')))
      check('S4 页面无报错', errors.length === 0)
    } finally { await app.close() }
  }

  // ============================================================ S5 平台元信息读不到 → 保守 ============================================================
  {
    pub.state.configMode = 'error'
    const profile = await newProfile()
    const { app, api } = await launch({ profile, providerConfig: { provider: 'card', baseUrl: pubBase, publicKey } })
    try {
      const st = await api('cardState')
      check('S5 /api/v1/config 500 且文件没写 identityMode：连接正常但保守按需要验证码', st.ok === true && st.identityMode === undefined && st.registrationRequiresCode === true)
      check('S5 无验证码注册 / 找回都被挡（code_required），不发请求', (await api('emailRegister', 'y@example.test', '', 'password1', '')).code === 'code_required' && (await api('emailReset', 'y@example.test', '', 'password1')).code === 'code_required' && !pub.state.log.slice(-4).some((l) => /register|reset/.test(l.path)))
    } finally { await app.close(); pub.state.configMode = 'ok' }
  }

  // ============================================================ S6 打包默认（resources 桩 + 官方地址映射到假平台）============================================================
  const off = createPlatform({ basePath: '/card', identity: 'existing' })
  platforms.push(off)
  const offPort = await off.listen()
  const tunnel = createOfficialTunnel(offPort)
  platforms.push(tunnel)
  const proxyPort = await tunnel.listen()
  const resourcesDir = path.join(work, 'resources-stub'); await fs.mkdir(resourcesDir, { recursive: true })
  for (const [name, target] of [['mods-catalog', path.join(root, 'mods-catalog')], ['connector-assets', path.join(root, 'connector-assets')], ['gift-assets', path.join(root, 'gift-assets')], ['emoji72', path.join(root, 'assets/emoji72')], ['local-card-mod', path.join(root, 'output/local-card-mod')]]) {
    if (await exists(target)) await fs.symlink(target, path.join(resourcesDir, name), 'junction')
  }
  const defaultConfig = JSON.stringify({ provider: 'card', baseUrl: OFFICIAL, publicKey, identityMode: 'existing', migrateLegacyCredentials: true, modPublicKeys: { 'game:4wheel-challenge': { fingerprint: modManifest.fingerprint } } })
  await fs.writeFile(path.join(resourcesDir, 'license-provider.json'), defaultConfig)
  const oldEmail = `old-${Date.now()}@example.test`, oldPassword = 'Old-' + randomUUID().slice(0, 10)
  off.state.legacy.set(oldEmail, { password: oldPassword, rights: ['platform:assistant', 'game:4wheel-challenge'], rooms: ['222'] })
  const cardCredFile = 'creds-card-' + originKey(OFFICIAL) + '.json'
  const p64 = (s) => 'p:' + Buffer.from(s, 'utf8').toString('base64')
  const legacyUsersJson = JSON.stringify([
    { id: 'legacy-local', username: 'legacy_user', passwordHash: '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz012345', nickname: '本地账号', avatar: '', createdAt: 1, lastLoginAt: 1 },
    { id: 'legacy-mail', username: oldEmail, passwordHash: '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz012345', nickname: '老主播', avatar: 'https://example.invalid/old.png', email: oldEmail, createdAt: 2, lastLoginAt: 5, boundRooms: ['222'] }
  ], null, 2)
  const legacyCredsJson = JSON.stringify({ last: oldEmail, map: { [oldEmail]: p64(oldPassword), legacy_user: p64('local-secret') } })
  const wheelConfigBefore = { LiveRoomId: '111', CustomBoxes: [{ Name: '保留原盲盒', GiftName: '小心心', Videos: ['a.mp4'] }], VideoQueue: 0, Nested: { keep: true, list: [1, 2, 3] }, Note: '中文 保留' }

  // S6a：显式本机配置优先于 resources 默认（同一 profile 里两份都在）
  {
    const profile = await newProfile()
    const { app, api } = await launch({ profile, providerConfig: { provider: 'card', origin: locBase, publicKey }, packaged: true, resourcesDir, proxyPort })
    try {
      const st = await api('cardState')
      check('S6a 显式 userData 配置优先于 resources 默认：source=userData、origin 是本机地址', st.ok && st.source === 'userData' && st.origin === locBase && st.identityMode === 'local')
      check('S6a 非官方来源不迁移旧凭据（没有迁移标记 / 平台凭据文件）', !(await exists(path.join(profile, 'data/card-cred-migration.json'))) && !(await exists(path.join(profile, 'data', cardCredFile))))
    } finally { await app.close() }
  }

  // S6b：无显式配置 → resources 默认 + 官方地址；已有邮箱账号；迁移凭据不覆盖新记录；昵称头像复制；轮椅房号只在连接时改
  {
    const profile = await newProfile()
    const settings = await prepareIsolatedGameProfile(root, profile)
    await fs.writeFile(path.join(profile, 'data/users.json'), legacyUsersJson)
    await fs.writeFile(path.join(profile, 'data/creds.json'), legacyCredsJson)
    // 平台凭据库里已有一条别的账号：迁移不能覆盖它，「上次登录」也保留它
    const keptEmail = 'kept@example.test'
    await fs.writeFile(path.join(profile, 'data', cardCredFile), JSON.stringify({ last: keptEmail, map: { [keptEmail]: p64('kept-secret') } }))
    const wheelExe = settings.gamePaths['4wheel-challenge']
    const wheelDir = path.join(path.dirname(wheelExe), 'Mods', 'WheelLive')
    await fs.mkdir(wheelDir, { recursive: true })
    await fs.copyFile(path.join(root, 'output/local-card-mod/WheelLive.dll'), path.join(path.dirname(wheelExe), 'Mods', 'WheelLive.dll'))
    await fs.writeFile(path.join(wheelDir, 'config.json'), JSON.stringify(wheelConfigBefore, null, 2))
    await fs.writeFile(path.join(wheelDir, 'bridge.txt'), '')
    await fs.writeFile(path.join(wheelDir, 'connector.py'), 'import time\nwhile True:\n    time.sleep(1)\n')
    const { app, page, api, qa, errors } = await launch({ profile, packaged: true, resourcesDir, proxyPort, douyin: true, isolate: false })
    try {
      const st = await api('cardState')
      check('S6b resources 默认：source=resources、origin=官方地址（含 /card）、existing、需要验证码', st.ok === true && st.source === 'resources' && st.origin === OFFICIAL && st.identityMode === 'existing' && st.registrationRequiresCode === true)
      check('S6b 客户端拨的是官方 47.251.93.171:8770（隧道记录）、经分区校验、假平台收到 /card/health', tunnel.log.includes(`${OFFICIAL_HOST}:8770`) && (await qa((_, fp) => global.__zlPub.verifyCalls.some((c) => c.hostname === '47.251.93.171' && c.fingerprint === fp), TEST_FP)) && off.state.log.some((l) => l.path === '/card/health'))
      check('S6b 产品校验过程对官方主机 + 测试证书仍 -2（放行只在测试引导层）', (await verifyWith(qa, { hostname: OFFICIAL_HOST, certificate: { fingerprint: TEST_FP } })) === -2)
      // 迁移
      const cardCreds = await readJson(path.join(profile, 'data', cardCredFile))
      check('S6b 旧邮箱凭据迁到平台凭据库并重新加密（v1: safeStorage），本地账号 legacy_user 不迁', typeof cardCreds.map[oldEmail] === 'string' && cardCreds.map[oldEmail].startsWith('v1:') && !('legacy_user' in cardCreds.map))
      check('S6b 已有平台凭据不覆盖、「上次登录」保留原有的', cardCreds.map[keptEmail] === p64('kept-secret') && cardCreds.last === keptEmail)
      check('S6b 旧 creds.json / users.json 字节不变', (await fs.readFile(path.join(profile, 'data/creds.json'), 'utf8')) === legacyCredsJson && (await fs.readFile(path.join(profile, 'data/users.json'), 'utf8')) === legacyUsersJson)
      check('S6b 迁移标记已写（按平台地址一次）', (await readJson(path.join(profile, 'data/card-cred-migration.json'))).done[OFFICIAL]?.count === 1)
      check('S6b 迁移后的密码能解出来给登录页用', (await api('credUser', oldEmail)).password === oldPassword && (await api('credUser', 'legacy_user')).password === null)
      const accounts = await api('listAccounts')
      check('S6b 登录页账号列表：列出旧邮箱账号（只读 legacy: 记录），不列本地账号', accounts.some((a) => a.username === oldEmail && a.id.startsWith('legacy:') && a.nickname === '老主播') && !accounts.some((a) => a.username === 'legacy_user'))
      check('S6b 旧邮箱账号记录不能从这里删（users.json 不动）', (await api('deleteAccount', accounts.find((a) => a.username === oldEmail).id)).ok === false && (await fs.readFile(path.join(profile, 'data/users.json'), 'utf8')) === legacyUsersJson)
      // 登录页真实可见：旧邮箱账号在下拉里
      const bar6 = page.getByTestId('login-panel'); await bar6.waitFor()
      check('S6b 正式来源也保持原登录表单、注册仍需验证码', !/已连接|授权服务/.test(await bar6.textContent()) && (await bar6.getAttribute('data-requires-code')) === '1')
      await page.getByRole('button', { name: '选择已保存的账号' }).click()
      check('S6b 登录页下拉能看到旧邮箱账号（昵称 + 邮箱）', (await page.getByText('老主播', { exact: true }).count()) >= 1 && (await page.getByText(oldEmail).count()) >= 1)
      // 关闭下拉：点全屏遮罩（它在按钮之上）
      await page.locator('div.fixed.inset-0.z-10').click({ position: { x: 10, y: 200 } })
      // 登录：旧身份服务验密码 → 建号迁移；本地记录复制昵称 / 头像
      const login = await api('emailLogin', oldEmail, oldPassword)
      const cardUsers = await readJson(path.join(profile, 'data/card_users.json'))
      check('S6b 旧邮箱 + 旧密码登录成功（旧身份服务验的）、权益 / 房间 222 来自服务端迁移', login.ok === true && login.user.boundRooms.join() === '222' && off.state.users.get(oldEmail)?.migrated === true)
      check('S6b 首次平台登录复制了旧本地昵称 / 头像，users.json 仍不动', cardUsers.find((u) => u.email === oldEmail)?.nickname === '老主播' && cardUsers.find((u) => u.email === oldEmail)?.avatar === 'https://example.invalid/old.png' && (await fs.readFile(path.join(profile, 'data/users.json'), 'utf8')) === legacyUsersJson)
      check('S6b 登录后账号列表里旧记录被平台记录取代（不重复）', (await api('listAccounts')).filter((a) => a.username === oldEmail).length === 1 && !(await api('listAccounts')).some((a) => a.id.startsWith('legacy:') && a.username === oldEmail))
      // 轮椅房号：静默读取 / 登录不改
      await api('setGameCurrent', '4wheel-challenge')
      await api('readConfig'); await api('cardState'); await api('cardRooms')
      check('S6b 登录 / 读取页面 / 读名额都不改轮椅 config.json', stable(await readJson(path.join(wheelDir, 'config.json'))) === stable(wheelConfigBefore))
      const notBound = await api('connectorStart', '111', false)
      check('S6b 连接未绑定房间 111：room_not_bound 明确拒绝、config 不动', notBound.ok === false && /尚未绑定/.test(notBound.error) && stable(await readJson(path.join(wheelDir, 'config.json'))) === stable(wheelConfigBefore))
      // 主动连接已绑定的 222：扫码（假抖音）→ 平台确认绑定 → 只改 LiveRoomId
      await page.evaluate(() => { window.__pending = null; window.api.connectorStart('222', false).then((r) => { window.__pending = r }) })
      await until(() => app.windows().find((w) => w.url().startsWith('https://live.douyin.com/')), '扫码窗口没有打开')
      await qa(async () => { const s = global.__zlPub.scans.at(-1); await s.ses.cookies.set({ url: 'https://douyin.com/', domain: '.douyin.com', name: 'sessionid', value: 'sess-old-222', secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 86400 }) })
      await until(() => page.evaluate(() => window.__pending), '连接操作没有完成', 30000)
      const after = await readJson(path.join(wheelDir, 'config.json'))
      const { LiveRoomId: _a, ...restAfter } = after
      const { LiveRoomId: _b, ...restBefore } = wheelConfigBefore
      check('S6b 主播明确连接 222 且平台确认绑定后：LiveRoomId 111→222，其余配置逐值保留', after.LiveRoomId === '222' && stable(restAfter) === stable(restBefore))
      check('S6b 连接器日志说明了房号更新', (await api('connectorLog')).some((l) => /111 更新为 222/.test(l.text)))
      await api('connectorStop')
      check('S6b 页面无报错', errors.length === 0 && JSON.stringify(errors))
    } finally { await app.close() }

    // S6c：重启（同 profile）—— 迁移不重复、主播删掉的记住密码不被复活
    {
      // 主播在上一轮之后删掉了旧邮箱的记住密码（模拟）：第二次启动不能再从 creds.json 复活
      const cur = await readJson(path.join(profile, 'data', cardCredFile))
      delete cur.map[oldEmail]; cur.last = ''
      await fs.writeFile(path.join(profile, 'data', cardCredFile), JSON.stringify(cur))
      const { app, api } = await launch({ profile, packaged: true, resourcesDir, proxyPort, isolate: false })
      try {
        await api('cardState')
        const again = await readJson(path.join(profile, 'data', cardCredFile))
        check('S6c 重启：迁移只做一次，删掉的记住密码不会复活', !(oldEmail in again.map) && again.last === '')
      } finally { await app.close() }
    }
  }

  // S6d：新库为空 + 旧库上次登录是邮箱 → 迁移后「上次登录」沿用它；autoLogin 打开时启动即自动登录
  {
    const profile = await newProfile()
    await prepareIsolatedGameProfile(root, profile)
    const s = await readJson(path.join(profile, 'data/settings.json'))
    await fs.writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({ ...s, rememberMe: true, autoLogin: true }))
    await fs.writeFile(path.join(profile, 'data/users.json'), legacyUsersJson)
    await fs.writeFile(path.join(profile, 'data/creds.json'), legacyCredsJson)
    const { app, api, page } = await launch({ profile, packaged: true, resourcesDir, proxyPort, isolate: false })
    try {
      const last = await api('credLoad')
      check('S6d 新库为空：「上次登录」沿用旧库记住的邮箱', last.last?.username === oldEmail && last.last?.password === oldPassword)
      await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor({ timeout: 20000 })
      check('S6d 自动登录沿用：启动后页面已用迁移的凭据登录进主界面', (await api('session'))?.email === oldEmail)
    } finally { await app.close() }
  }

  // S6e：旧库只有本地账号的记住密码（没有邮箱）且没有邮箱账号 → 这是 S7 的 legacyHold；这里验「本地 + 只有邮箱 creds」也进平台且不迁本地
  {
    const profile = await newProfile()
    await prepareIsolatedGameProfile(root, profile)
    await fs.writeFile(path.join(profile, 'data/users.json'), JSON.stringify([{ id: 'legacy-local', username: 'legacy_user', passwordHash: 'x', nickname: '本地账号', avatar: '', createdAt: 1, lastLoginAt: 1 }]))
    await fs.writeFile(path.join(profile, 'data/creds.json'), JSON.stringify({ last: 'legacy_user', map: { legacy_user: p64('local-secret'), [oldEmail]: p64(oldPassword) } }))
    const { app, api } = await launch({ profile, packaged: true, resourcesDir, proxyPort, isolate: false })
    try {
      const st = await api('cardState')
      const cc = await readJson(path.join(profile, 'data', cardCredFile))
      check('S6e 本地账号 + 记住过邮箱密码：进平台；只迁邮箱、上次登录（本地账号）不沿用', st.enabled === true && st.source === 'resources' && (oldEmail in cc.map) && !('legacy_user' in cc.map) && !cc.last)
    } finally { await app.close() }
  }

  // ============================================================ S7 只有旧本地账号 → legacyHold → 切换 ============================================================
  {
    const profile = await newProfile()
    await prepareIsolatedGameProfile(root, profile)
    // 老主播：只有旧版本地用户名账号（真实 bcrypt 哈希，旧登录路径要比对）
    await fs.writeFile(path.join(profile, 'data/users.json'), JSON.stringify([{ id: 'legacy-local', username: 'legacy_user', passwordHash: bcrypt.hashSync('Fixture123!', 10), nickname: '旧账号', avatar: '', createdAt: 1, lastLoginAt: 1 }]))
    const healthBefore = off.state.log.length
    const { app: app2, page: page2, api: api2, errors: errors2 } = await launch({ profile, packaged: true, resourcesDir, proxyPort, isolate: false })
    let adopted
    try {
      const st = await api2('cardState')
      check('S7 只有旧本地账号：cardState enabled=false + legacyHold=local-accounts + defaultAvailable', st.ok && st.enabled === false && st.legacyHold === 'local-accounts' && st.defaultAvailable === true)
      check('S7 假平台没收到任何请求（没启用就不连）、没建平台凭据文件', off.state.log.length === healthBefore && !(await exists(path.join(profile, 'data', cardCredFile))))
      const hold = page2.getByTestId('card-legacy-hold'); await hold.waitFor()
      check('S7 登录页：说明保留旧账号 + 给切换按钮', /保留着旧版本地账号/.test(await hold.textContent()) && (await hold.getByRole('button', { name: /切换到新账号系统/ }).count()) === 1)
      check('S7 旧本地账号照常登录、账号列表照旧', (await api2('login', 'legacy_user', 'Fixture123!')).ok === true && (await api2('listAccounts')).some((a) => a.username === 'legacy_user'))
      await hold.getByRole('button', { name: /切换到新账号系统/ }).click()
      await until(() => exists(path.join(profile, 'license-provider.json')), '切换后没有写显式配置')
      adopted = await fs.readFile(path.join(profile, 'license-provider.json'), 'utf8')
      await until(() => hold.getByText('已切换，重新打开客户端后生效').count(), '切换后没有提示重启')
      check('S7 切换：默认配置原样写成显式配置、页面提示重启生效、旧账号仍在', adopted === defaultConfig && (await api2('listAccounts')).some((a) => a.username === 'legacy_user'))
      check('S7 页面无报错', errors2.length === 0 && JSON.stringify(errors2))
    } finally { await app2.close() }
    const { app: app3, api: api3 } = await launch({ profile, packaged: true, resourcesDir, proxyPort, isolate: false })
    try {
      const st = await api3('cardState')
      check('S7 重启后：进平台（source=userData，显式）、旧 users.json 仍在、显式文件不放行迁移（无迁移标记）', st.ok === true && st.enabled === true && st.source === 'userData' && st.origin === OFFICIAL && (await exists(path.join(profile, 'data/users.json'))) && !(await exists(path.join(profile, 'data/card-cred-migration.json'))))
    } finally { await app3.close() }
  }

  console.log(`PUBLIC CARD PROVIDER PASS ${checks.length}/${checks.length}`)
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ outDir, checks, scope: 'unit(card-provider) + hidden Electron; private HTTPS fake platform with test CA (allowed only in test bootstrap); fake legacy identity; fake douyin; official host:port tunneled through a test-only CONNECT proxy; production pin asserted unchanged' }, null, 2))
} catch (error) {
  failure = error
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ checks, error: error.stack || error.message }, null, 2))
} finally {
  for (const p of platforms) await p.close().catch(() => {})
  // resources 桩里是指向真实目录的 junction：跑完必须只删链接本身（留着的话以后有人 rm -rf output/playwright 会连真实目录一起删）
  const stub = path.join(work, 'resources-stub')
  if (fsSync.existsSync(stub)) for (const name of fsSync.readdirSync(stub)) { const p = path.join(stub, name); if (fsSync.lstatSync(p).isSymbolicLink()) fsSync.unlinkSync(p) }
}
if (failure) {
  console.error('FAIL ' + failure.message)
  process.exit(1)
}
