// 真机 · 直播间真实连接验收：用本机正式资料的「副本」（账号 / 离线凭证 / 直播间令牌），在隔离 userData 里起隐藏客户端（静音），
// 连接本机账号绑定的真实直播间，看连接器能不能真的连上并收到直播间事件。只读取正式资料，不改它；副本里礼物规则清空、
// 不开任何挂件，所以不会往游戏发整蛊、不会出声音。要求主播此刻正在开播。
//   用法：node tools/verify-live-connect.mjs [房间号]   （先 npm run build；默认取正式资料里绑定的第一个直播间）
//   环境：ZL_LIVE_PROFILE 指定正式资料目录（默认 %APPDATA%/zhiliao-client）；ZL_LIVE_SECONDS 观察秒数（默认 75）
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const real = process.env.ZL_LIVE_PROFILE || path.join(process.env.APPDATA || '', 'zhiliao-client')
const outputDir = path.join(root, 'output', 'playwright', 'live-connect')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const WATCH_SECONDS = Math.max(20, Number(process.env.ZL_LIVE_SECONDS) || 75)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`) }

await fs.mkdir(outputDir, { recursive: true })
const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
// 整份资料复制（safeStorage 在 Windows 上的密钥存在 Local State 里，只拷 data/ 解不开凭证与直播间令牌）；缓存 / 日志不拷
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'logs', 'Crashpad', 'DevToolsActivePort', 'downloads', 'media-cache'])
await fs.cp(real, profile, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) || src === real })
// 不带礼物规则 / 弹幕转发 / 上次直播现场：这次只验「能不能连上」，不往游戏发任何东西
await fs.writeFile(path.join(profile, 'data', 'entertainment_rules.json'), '[]')
for (const f of ['danmaku_forward.json', 'live-session.json', 'live-report-pending.json', 'run-state.json']) await fs.rm(path.join(profile, 'data', f), { force: true })
await fs.copyFile(path.join(root, 'build', 'license-provider.json'), path.join(profile, 'license-provider.json'))
const settings = JSON.parse(await fs.readFile(path.join(profile, 'data', 'settings.json'), 'utf8'))
Object.assign(settings, { guideSeen: true, assetGuideSeen: true, autoLogin: true, currentGame: '4wheel-challenge', timeLogWindow: false, memoryGuard: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify(settings, null, 2))
const cardUsers = JSON.parse(await fs.readFile(path.join(profile, 'data', 'card_users.json'), 'utf8'))
const room = process.argv[2] || cardUsers[0]?.boundRooms?.[0] || ''
console.log(`正式资料：${real}\n账号：${cardUsers[0]?.email}  直播间：${room}  观察 ${WATCH_SECONDS} 秒`)
if (!room) { console.log('FAIL 没有可测的直播间号'); process.exit(1) }

const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE; delete env.ZL_LICENSE_ENFORCE
// --mute-audio：整个测试实例静音（主播在用 MIDI 弹琴，不能出声）
const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox', '--mute-audio'], cwd: root, env, timeout: 60_000 })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.connectorStart), null, { timeout: 30_000 })
const api = (fn, arg) => page.evaluate(fn, arg)
const mainLog = () => fs.readFile(path.join(profile, 'logs', 'main.log'), 'utf8').catch(() => '')

// 登录态：正式资料带着离线凭证 / 自动登录
let session = null
for (let i = 0; i < 40 && !session; i++) { session = await api(() => window.api.session()); if (!session) await sleep(500) }
check('账号自动登录（正式资料副本）', !!session, session ? `${session.email || session.id}  绑定 ${JSON.stringify(session.boundRooms)}` : (await mainLog()).split('\n').filter(l => /\[card\]/.test(l)).slice(-3).join(' | '))
const st = await api(() => window.api.cardState())
check('授权免检快照（free）', st.free === true, `enabled=${st.enabled} ok=${st.ok} offline=${st.offline}`)
const q = await api(() => window.api.cardRooms())
check('直播间列表（免检、本机）', q.ok === true && q.quota?.rooms?.includes(room), JSON.stringify(q.quota?.rooms))

// 连接
await api(() => window.api.setGameCurrent('4wheel-challenge'))
const t0 = Date.now()
let seen = 0
const dump = async () => {
  const log = await api(() => window.api.connectorLog())
  const fresh = log.slice(seen); seen = log.length
  for (const l of fresh) console.log(`  [${l.level}] ${String(l.text).slice(0, 160)}`)
  return log
}
const startP = api((r) => window.api.connectorStart(r, false), room)
let started = null
startP.then(r => { started = r })
let running = false, scanNeeded = false
while (Date.now() - t0 < 60_000) {
  const log = await dump()
  const cs = await api(() => window.api.connectorState())
  if (log.some(l => /扫码|重新登录/.test(l.text) && /打开抖音网页|需要重新扫码/.test(l.text))) { scanNeeded = true; break }
  if (cs.running) { running = true; break }
  if (started && started.ok === false) break
  await sleep(1500)
}
check('连接器启动（用本机保存的抖音登录态，不扫码）', running && !scanNeeded, started ? JSON.stringify(started) : scanNeeded ? '保存的登录态已失效，需要主播重新扫码' : '')
if (running) {
  const stop = Date.now() + WATCH_SECONDS * 1000
  while (Date.now() < stop) { await dump(); await sleep(3000) }
  const log = await api(() => window.api.connectorLog())
  const cs = await api(() => window.api.connectorState())
  const text = log.map(l => l.text).join('\n')
  const connected = /已连接|连接成功|进入直播间|房间信息|在线|观众|弹幕|点赞|礼物|进场|来了/.test(text)
  const errors = log.filter(l => l.level === 'error').map(l => l.text)
  check(`观察 ${WATCH_SECONDS} 秒：连接器仍在运行`, cs.running === true, `roomId=${cs.roomId}`)
  check('收到直播间数据（连接 / 弹幕 / 点赞 / 进场 / 礼物任一）', connected, `事件行 ${log.filter(l => ['gift', 'like', 'follow'].includes(l.level)).length} 条，错误 ${errors.length} 条${errors.length ? '：' + errors.slice(0, 2).join(' | ').slice(0, 200) : ''}`)
  await api(() => window.api.connectorStop())
  await sleep(1500)
}
const cardLines = (await mainLog()).split('\n').filter(l => /\[card\]|\[license\]|\[connector\]/.test(l)).slice(-6)
console.log('主日志：\n' + cardLines.map(l => '  ' + l.slice(0, 180)).join('\n'))
try { await app.evaluate(({ app }) => app.quit()) } catch { /* */ }
await sleep(1000)
const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS  (userData 副本：${profile})`)
process.exit(bad ? 1 : 0)
