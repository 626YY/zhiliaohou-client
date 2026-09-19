// 复现用户「连直播间不好使」：拷一份本机正式 profile（settings/users/creds）到隔离目录，隐藏实例里走真实链路：
// 登录 → 绑定直播间（bindRoomWithLicense）→ 启动连接器（connectorStart，含抖音登录检查）→ 收 40 秒连接器日志 → 停止 → 解绑。
// 用法：node tools/verify-connect-flow.mjs <直播间号>
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
const room = process.argv[2]; if (!room) throw new Error('要直播间号')
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output/playwright/connect-flow'); await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const src = path.join(process.env.APPDATA, 'zhiliao-client', 'data')
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
for (const f of ['settings.json', 'users.json', 'creds.json']) await fs.copyFile(path.join(src, f), path.join(profile, 'data', f))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const redact = (s) => String(s).replace(/(cookie|sessionid|passwd|password)[^\s,;]*/gi, '$1=<略>')
try {
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.api?.connectorStart)
  let s = await page.evaluate(() => window.api.session())
  if (!s) {
    // 正式账号的记住密码用 safeStorage 加密，隔离实例解不开；注册一个一次性本地账号走同一条绑定/连接链路（写在隔离副本里，不碰正式数据）
    const r = await page.evaluate(() => window.api.register('zltest' + Date.now().toString(36), 'Test1234!', '连接复现'))
    console.log('注册一次性本地账号:', JSON.stringify({ ok: r.ok, error: r.error }))
    s = await page.evaluate(() => window.api.session())
  }
  console.log('会话:', JSON.stringify(s && { email: s.email, rooms: s.boundRooms }))
  const b = await page.evaluate((room) => window.api.bindRoomWithLicense(room), room)
  console.log('绑定:', JSON.stringify(b))
  await page.evaluate(() => { window.__log = []; window.api.onConnectorEvent((e) => window.__log.push(e)) })
  const st = await page.evaluate((room) => window.api.connectorStart(room, false), room)
  console.log('启动:', JSON.stringify(st))
  await sleep(40000)
  const log = await page.evaluate(() => window.__log)
  for (const e of log) console.log('  [' + (e.level || e.type || '') + '] ' + redact(e.text || e.message || JSON.stringify(e)).slice(0, 220))
  const state = await page.evaluate(() => window.api.connectorState()); console.log('状态:', JSON.stringify(state))
  await page.evaluate(() => window.api.connectorStop())
  const ub = await page.evaluate((room) => window.api.unbindRoom(room), room); console.log('解绑:', JSON.stringify(ub))
} finally { await app.close().catch(() => {}) }
