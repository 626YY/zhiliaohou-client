// 卡密模式 · 辅助能力（通知 / 云配置 / 心跳 / 观众记录）经卡密平台转接原邮箱服务 —— 端到端回归（2026-09-13）。
//   真实隐藏 Electron 构建 + 真实隔离卡密平台（../卡密系统 create_app，existing 模式）+ 假原邮箱服务（自签 TLS，tools/card-aux-fixture.py）。
//   不碰真实 userData / 线上服务 / 真实邮箱 / 真实直播。
//   覆盖：登录后旧会话只加密存在平台库（明文不落库 / 不进日志）；初始 watcher 在卡密模式下接通（通知轮询 / 心跳按登录账号立刻跑）；
//        通知列表 / 已读 / 全部已读；邮箱不符拒绝且不发请求；云配置来回完全相同；心跳主体只带白名单字段、邮箱由平台决定；
//        观众记录：平台未绑定 → 保留；旧服务故障 → 保留；恢复后固定服务入口重传成功、不依赖旧授权或修改旧绑定 → 注入字段被剥掉；
//        旧会话失效 → 可重登提示、不清卡密授权、不再反复请求；重登恢复；退出 → 加密会话随平台会话删除；换号隔离；旧账号模式直连路径不变。
//   用法：node tools/test-card-aux.mjs   （构建目录默认 output/fable-card-aux-build，可用 ZL_AUX_OUT_DIR 覆盖）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const platformRoot = path.resolve(root, '../卡密系统')
const outDir = process.env.ZL_AUX_OUT_DIR || 'output/fable-card-aux-build'
const out = path.join(root, 'output/playwright/card-aux')
await fs.mkdir(out, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))

const checks = []
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, label, ms = 20000) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(200) }
  throw new Error(label)
}
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const stable = (v) => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map((x) => JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(stable(v[k]))])) : v)

// ================= 夹具：假原邮箱服务 + 隔离卡密平台 =================
const serviceDir = path.join(out, 'service-' + Date.now())
await fs.mkdir(serviceDir, { recursive: true })
const service = spawn(process.env.ZL_TEST_PYTHON || 'python', [path.join(root, 'tools/card-aux-fixture.py'), platformRoot, serviceDir], { cwd: serviceDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let serviceErr = ''
service.stderr.on('data', (d) => { serviceErr += d.toString() })
let alive = true
service.on('exit', () => { alive = false })
const lineQueue = [], waiters = []
let buffer = ''
service.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 1)
    if (!line) continue
    if (waiters.length) waiters.shift()(line); else lineQueue.push(line)
  }
})
const nextLine = (ms = 30000) => new Promise((resolve, reject) => {
  if (lineQueue.length) return resolve(lineQueue.shift())
  const t = setTimeout(() => reject(new Error('夹具无响应：' + serviceErr.slice(-400))), ms)
  waiters.push((line) => { clearTimeout(t); resolve(line) })
})
const platform = JSON.parse(await nextLine(60000))
assert.ok(platform.origin.startsWith('http://127.0.0.1:') && platform.publicKey && platform.legacyHttpOrigin, '夹具启动异常')
async function fixture(cmd) {
  assert.ok(alive, '夹具服务已退出')
  service.stdin.write(JSON.stringify(cmd) + '\n')
  const reply = JSON.parse(await nextLine())
  assert.ok(reply.ok, `夹具命令失败 ${cmd.op}/${cmd.cmd || ''}: ${reply.error}`)
  return reply
}
const legacy = (cmd, extra = {}) => fixture({ op: 'legacy', cmd, ...extra })
const stopService = () => {
  if (!alive) return
  try { service.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n') } catch { /* 已退出 */ }
  setTimeout(() => { if (alive) service.kill() }, 3000).unref()
}

// ================= 隐藏 Electron =================
const electronExe = path.join(root, 'node_modules/electron/dist/electron.exe')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json' }
delete env.ELECTRON_RUN_AS_NODE
const SERVER_URL = platform.legacyHttpOrigin
async function launch({ provider, pending = [] }) {
  const profile = await fs.mkdtemp(path.join(out, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir })
  const settingsFile = path.join(profile, 'data/settings.json')
  await fs.writeFile(settingsFile, JSON.stringify({ ...(await readJson(settingsFile)), guideSeen: true, autoLogin: false, serverUrl: SERVER_URL }))
  if (provider) await fs.writeFile(path.join(profile, 'license-provider.json'), JSON.stringify({ provider: 'card', origin: platform.origin, publicKey: platform.publicKey, identityMode: 'existing' }), 'utf8')
  if (pending.length) await fs.writeFile(path.join(profile, 'data/live-report-pending.json'), JSON.stringify(pending))
  const app = await electron.launch({ executablePath: electronExe, args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForFunction(() => !!window.api?.cardState)
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须使用本次隔离 profile')
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
  return { app, page, profile, api, errors }
}

const stamp = Date.now()
const L1 = { email: `aux-l1-${stamp}@example.test`, password: 'Old1-' + randomUUID().slice(0, 12) }
const L2 = { email: `aux-l2-${stamp}@example.test`, password: 'Old2-' + randomUUID().slice(0, 12) }
const ROOM = '577117602', ROOM2 = '123456789'
const event = (i, extra = {}) => ({ id: `evt-${stamp}-${String(i).padStart(4, '0')}`, ts: Math.floor(Date.now() / 1000) - i, type: 'gift', nick: '观众' + i, gift: '小心心', count: 1, coins: 1, ...extra })
const pendingRows = [
  ...[1, 2].map((i) => ({ email: L1.email, server: SERVER_URL, room: ROOM, game: 'librarian', event: event(i) })),
  { email: L1.email, server: SERVER_URL, room: ROOM, game: 'librarian', event: event(3, { cookie: 'sessionid=abc', token: 'tok', user: 'WINDOWS\\someone' }) },
  { email: L2.email, server: SERVER_URL, room: ROOM2, game: 'librarian', event: event(4) }
]
const EVENT_KEYS = ['id', 'ts', 'type', 'nick', 'gift', 'count', 'coins']
const callsAfter = async (pathName, fromIndex = 0) => (await legacy('calls', { path: pathName })).calls.slice(fromIndex)

let failure
try {
  await legacy('add_account', { email: L1.email, password: L1.password, licensed: 1 })
  await legacy('add_account', { email: L2.email, password: L2.password, licensed: 1 })

  // ================= 卡密模式 =================
  const { app, profile, api, errors } = await launch({ provider: true, pending: pendingRows })
  const pendingFile = path.join(profile, 'data/live-report-pending.json')
  try {
    const st0 = await api('cardState')
    check('平台已连接（existing 模式、需验证码）、未登录', st0.ok === true && st0.enabled && st0.identityMode === 'existing' && !st0.user)
    await sleep(1500)
    check('未登录时没有任何心跳 / 通知 / 观众记录请求到旧服务', (await callsAfter('/api/email/heartbeat')).length === 0 && (await callsAfter('/api/email/notify')).length === 0 && (await callsAfter('/api/card/live-events')).length === 0)

    // ---- 登录：旧身份服务验密码，平台加密保存旧会话 ----
    const login = await api('emailLogin', L1.email, L1.password)
    check('旧邮箱账号登录成功（旧身份服务验的密码）', login.ok === true && login.user?.email === L1.email)
    const rows1 = await fixture({ op: 'identity_rows' })
    check('平台库里只有 1 枚加密的旧会话：能解出旧服务真实签发的会话、库文件里没有明文会话 / 密码', rows1.count === 1 && rows1.all_match_legacy && !rows1.plaintext_in_db && !rows1.cipher_is_plain)

    // ---- 初始 watcher：登录后立刻按卡密账号跑通知轮询与心跳（不是等 30/60 秒）----
    const hb = await until(async () => (await callsAfter('/api/email/heartbeat')).find((c) => c.body.email === L1.email), '登录后 20 秒内没有心跳到旧服务')
    check('心跳：邮箱由平台按登录账号给定、带有效旧会话、主体只有白名单字段、未绑定房间报空', hb.body.session_valid === true && hb.body.has_session === true && hb.body.room === '' && [0, 1].includes(hb.body.connector) && [0, 1].includes(hb.body.game) && Object.keys(hb.body).every((k) => ['email', 'room', 'connector', 'game', 'session_valid', 'has_session'].includes(k)))
    const firstList = await until(async () => (await callsAfter('/api/email/notify')).find((c) => c.body.email === L1.email && c.body.op === 'list'), '登录后 20 秒内通知轮询没有到旧服务')
    check('通知轮询：登录后立刻拉了一次（基线），邮箱按登录账号、带有效旧会话', firstList.body.session_valid === true)

    // ---- 通知中心：列表 / 已读 / 全部已读 / 邮箱不符 ----
    const nid = (await legacy('push_notify', { email: L1.email, text: '授权已续期', kind: 'grant' })).id
    await legacy('push_notify', { email: L2.email, text: '别人的通知', kind: 'grant' })
    const list = await api('emailNotifyList', L1.email)
    check('通知列表：只拿到本账号的通知，字段按旧接口原样', list.ok === true && list.list.length === 1 && list.list[0].id === nid && list.list[0].text === '授权已续期' && list.list[0].read === 0)
    const before = (await callsAfter('/api/email/notify')).length
    const wrong = await api('emailNotifyList', L2.email)
    check('通知列表：邮箱不是当前账号 → 拒绝且不发请求', wrong.ok === false && /当前登录账号/.test(wrong.error) && (await callsAfter('/api/email/notify')).length === before)
    await api('emailNotifyRead', L1.email, nid)
    check('通知已读：旧服务里该条 read=1', (await legacy('state', { email: L1.email })).state.notifs[0].read === 1)
    await legacy('push_notify', { email: L1.email, text: '第二条' })
    await api('emailNotifyReadAll', L1.email)
    check('全部已读：旧服务里全部 read=1', (await legacy('state', { email: L1.email })).state.notifs.every((n) => n.read === 1))
    check('通知请求从没带过别人的邮箱', (await callsAfter('/api/email/notify')).every((c) => c.body.email === L1.email))

    // ---- 云配置：来回完全相同 ----
    const config = { 礼物: [{ 名: '小心心', 权重: 1.5, 启用: true, 备注: null }], nested: { deep: { list: [1, 2, { s: 'ü 中文 ✓' }] } }, empty: {}, n: 0, neg: -3 }
    const load0 = await api('emailConfigLoad', L1.email)
    check('云配置：没备份时 has=false', load0.ok === true && load0.has === false)
    const save = await api('emailConfigSave', L1.email, config)
    const load1 = await api('emailConfigLoad', L1.email)
    check('云配置：备份 → 恢复，数据逐字相同；旧服务按登录账号存', save.ok === true && load1.ok === true && load1.has === true && stable(load1.data) === stable(config) && stable((await legacy('state', { email: L1.email })).state.config) === stable(config))
    check('云配置：邮箱不符拒绝', (await api('emailConfigSave', L2.email, config)).ok === false && (await api('emailConfigLoad', L2.email)).ok === false)

    // ---- 观众记录：平台未绑定 → 保留；旧服务故障 → 保留；恢复 → 自动补绑定 → 重传 → 注入字段剥掉 ----
    await sleep(1500)
    check('观众记录：直播间未在平台绑定 → 平台拒绝、旧服务没收到、本机记录全部保留', (await callsAfter('/api/card/live-events')).length === 0 && (await readJson(pendingFile)).length === 4)
    await fixture({ op: 'platform_bind', email: L1.email, room: ROOM })
    await legacy('set', { fail_live: true })
    await until(async () => (await callsAfter('/api/card/live-events')).length >= 1, '平台绑定后 20 秒内没有观众记录到旧服务')
    await sleep(800)
    check('观众记录：旧服务 503 → 记录保留待重试、旧会话不被清', (await readJson(pendingFile)).length === 4 && (await fixture({ op: 'identity_rows' })).count === 1)
    await legacy('set', { fail_live: false })
    await legacy('set', { email: L1.email, licensed: 0 })
    const events = await until(async () => { const r = (await legacy('room_events', { room: ROOM })).events; return r.length === 3 ? r : null }, '旧服务恢复后 25 秒内观众记录没有传齐', 25000)
    check('观众记录：旧授权失效、新平台授权有效仍重传成功；3 条全到，旧绑定未改变', (await callsAfter('/api/email/bind')).length === 0 && (await legacy('state', { email: L1.email })).state.binds.length === 0 && events.every((e) => e.email === L1.email))
    check('观众记录：每条只有七个字段，seed 里的 cookie / token / Windows 用户名没有上传', events.every((e) => Object.keys(e).filter((k) => k !== 'email').sort().join() === [...EVENT_KEYS].sort().join()))
    check('观众记录：确认后从本机队列删除，别的账号的记录原样保留', (await readJson(pendingFile)).length === 1 && (await readJson(pendingFile))[0].email === L2.email)
    check('旧服务的绑定记录没有反向进平台名额（平台仍只有主动绑的那一个）', (await fixture({ op: 'platform_rooms', email: L1.email })).rooms.join() === ROOM)

    // ---- 旧会话失效：可重登提示、不动卡密授权、不再反复请求；重登恢复 ----
    await legacy('revoke', { email: L1.email })
    const stale = await api('emailNotifyList', L1.email)
    check('旧会话失效 → 明确的重新登录提示（不是 401、不假装成功）', stale.ok === false && /重新登录/.test(stale.error))
    const st1 = await api('cardState')
    check('旧会话失效不清卡密授权：平台会话仍在、账号仍是本人', st1.ok === true && st1.user?.email === L1.email && (await api('session'))?.email === L1.email)
    const n0 = (await callsAfter('/api/email/notify')).length
    await api('emailNotifyList', L1.email); await api('emailConfigLoad', L1.email)
    check('旧会话失效后同一次登录内不再向旧服务发请求（不拿记住的密码悄悄重登）', (await callsAfter('/api/email/notify')).length === n0 && (await callsAfter('/api/email/config_get')).length === 2 && (await callsAfter('/api/email/login')).filter((c) => c.body.email === L1.email).length === 1)
    check('平台库里失效的旧会话已删除', (await fixture({ op: 'identity_rows' })).count === 0)
    const relogin = await api('emailLogin', L1.email, L1.password)
    check('重新登录 → 新旧会话、通知恢复', relogin.ok === true && (await api('emailNotifyList', L1.email)).ok === true && (await fixture({ op: 'identity_rows' })).count === 1)

    // ---- 退出：加密会话随平台会话删除；换号隔离 ----
    await api('logout')
    check('退出后平台库里没有旧会话、辅助入口报未登录', (await fixture({ op: 'identity_rows' })).count === 0 && (await api('emailNotifyList', L1.email)).ok === false)
    await legacy('reset_calls')
    const login2 = await api('emailLogin', L2.email, L2.password)
    const list2 = await api('emailNotifyList', L2.email)
    check('换号：L2 登录后只看到 L2 的通知', login2.ok === true && list2.ok === true && list2.list.length === 1 && list2.list[0].text === '别人的通知')
    await until(async () => (await callsAfter('/api/email/heartbeat')).length >= 1, '换号后 20 秒内没有心跳')
    const calls = (await legacy('calls')).calls.filter((c) => !['/api/email/login', '/api/email/license'].includes(c.path))
    check('换号后所有辅助请求都是 L2 的邮箱，没有一条带 L1', calls.length > 0 && calls.every((c) => c.body.email === L2.email))
    check('L2 的记录（房间未在平台绑定）仍保留在本机，没有替 L1 传', (await readJson(pendingFile)).length === 1 && (await callsAfter('/api/card/live-events')).length === 0)
    await api('logout')
    check('卡密模式页面无报错', errors.length === 0 && JSON.stringify(errors))
    // ---- 泄露扫描 ----
    const scan = await fixture({ op: 'scan', paths: [path.join(profile, 'logs/main.log'), pendingFile, path.join(profile, 'data/card_users.json'), path.join(profile, 'data/settings.json')], text: serviceErr })
    check('客户端日志 / 本机记录 / 夹具输出里没有任何旧会话或密码明文', scan.leaked.length === 0 && scan.known >= 4 && JSON.stringify(scan))
  } finally { await app.close() }

  // ================= 旧账号模式（无 provider）：直连路径不变 =================
  {
    const { app, api, errors } = await launch({ provider: false })
    try {
      check('旧模式：cardState enabled=false', (await api('cardState')).enabled === false)
      const email = `direct-${stamp}@example.test`, password = 'Direct-' + randomUUID().slice(0, 10)
      const reg = await api('emailRegister', email, platform.code, password, '直连')
      check('旧模式：验证码注册直连旧服务', reg.ok === true && (await api('session'))?.email === email)
      await legacy('push_notify', { email, text: '直连通知', http: true })
      const list = await api('emailNotifyList', email)
      const direct = (await legacy('calls', { path: '/api/email/notify', http: true })).calls
      check('旧模式：通知直连旧服务、自带旧会话，没有经过平台', list.ok === true && list.list.length === 1 && direct.length >= 1 && direct.at(-1).body.session_valid === true && direct.at(-1).body.email === email)
      const cfg = { a: [1, '二', { c: null }] }
      check('旧模式：云配置直连来回相同', (await api('emailConfigSave', email, cfg)).ok === true && stable((await api('emailConfigLoad', email)).data) === stable(cfg))
      check('旧模式页面无报错', errors.length === 0)
    } finally { await app.close() }
  }
} catch (e) {
  failure = e
} finally {
  stopService()
}
await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify({ outDir, checks, failure: failure ? String(failure.stack || failure) : null, scope: 'hidden Electron real build + real isolated card platform (existing mode) + fake legacy emailauth over self-signed TLS; no real service, account, email or live room' }, null, 2))
if (failure) { console.error('FAIL ' + (failure.stack || failure)); process.exit(1) }
console.log(`CARD-AUX ${checks.length}/${checks.length} PASS; outDir=${outDir}`)
