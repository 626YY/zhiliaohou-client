// 真机 · 没装任何游戏整蛊 mod 时客户端自己连直播间（2026-10-08 用户要把游戏 mod 全部下架：「要确认软件自己连直播间也好使」）。
// 用本机正式资料的「副本」（账号 / 离线凭证 / 抖音登录），把游戏路径全部指到空的假 exe（没有 Mods 目录 = 没装 mod），
// 在隔离 userData 里起隐藏、静音的客户端，看客户端自带的连接器能不能连上直播间、事件能不能进客户端：
//   · B 站：挑一个正在播的公开热门直播间（免登录、匿名），观察弹幕 / 进场 / 礼物事件；
//   · 抖音：用账号绑定的直播间和本机保存的抖音登录态（不扫码）；主播此刻没开播时只验到「连接器起来、查到房间状态」。
// 只读正式资料，不改它；副本里礼物规则清空、不开挂件，不往任何游戏发东西；真实游戏目录一个文件都不碰。
//   用法：node tools/verify-live-connect-standalone.mjs [抖音房间号] [B站房间号]   （先 npm run build）
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const real = process.env.ZL_LIVE_PROFILE || path.join(process.env.APPDATA || '', 'zhiliao-client')
const outputDir = path.join(root, 'output', 'playwright', 'live-connect-standalone')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const WATCH_SECONDS = Math.max(20, Number(process.env.ZL_LIVE_SECONDS) || 45)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`) }

async function liveBiliRoom() {
  if (process.argv[3] === 'none') return ''   // 只测抖音
  if (process.argv[3]) return process.argv[3]
  try {
    const r = await fetch('https://api.live.bilibili.com/room/v3/area/getRoomList?platform=web&parent_area_id=2&area_id=0&sort_type=online&page=1&page_size=5', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) })
    const j = await r.json()
    return String(j?.data?.list?.[0]?.roomid || '')
  } catch { return '' }
}

await fs.mkdir(outputDir, { recursive: true })
const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'logs', 'Crashpad', 'DevToolsActivePort', 'downloads', 'media-cache', 'connector'])
await fs.cp(real, profile, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) || src === real })
await fs.writeFile(path.join(profile, 'data', 'entertainment_rules.json'), '[]')
for (const f of ['danmaku_forward.json', 'live-session.json', 'live-report-pending.json', 'run-state.json']) await fs.rm(path.join(profile, 'data', f), { force: true })
await fs.copyFile(path.join(root, 'build', 'license-provider.json'), path.join(profile, 'license-provider.json'))
// 游戏全部指到空的假 exe：exe 旁边没有 Mods\WheelLive / ue4ss\Mods\… = 这台电脑没装任何游戏整蛊 mod
const fixtures = await fs.mkdtemp(path.join(profile, 'no-game-'))
const gamePaths = {}
for (const id of ['4wheel-challenge', 'dontscream', 'librarian']) {
  gamePaths[id] = path.join(fixtures, `${id}.exe`)
  await fs.writeFile(gamePaths[id], '')
}
const settings = JSON.parse(await fs.readFile(path.join(profile, 'data', 'settings.json'), 'utf8'))
Object.assign(settings, { guideSeen: true, assetGuideSeen: true, autoLogin: true, currentGameId: '4wheel-challenge', gamePath: gamePaths['4wheel-challenge'], gamePaths, connectorPath: '', timeLogWindow: false, memoryGuard: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify(settings, null, 2))
const cardUsers = JSON.parse(await fs.readFile(path.join(profile, 'data', 'card_users.json'), 'utf8'))
const douyinRoom = process.argv[2] || cardUsers[0]?.boundRooms?.[0] || ''
const biliRoom = await liveBiliRoom()
console.log(`正式资料：${real}\n抖音直播间：${douyinRoom || '（无）'}  B 站公开直播间：${biliRoom || '（没找到）'}  每场观察 ${WATCH_SECONDS} 秒`)

const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE; delete env.ZL_LICENSE_ENFORCE
const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox', '--mute-audio'], cwd: root, env, timeout: 60_000 })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.connectorStart), null, { timeout: 30_000 })
const api = (fn, arg) => page.evaluate(fn, arg)

let session = null
for (let i = 0; i < 40 && !session; i++) { session = await api(() => window.api.session()); if (!session) await sleep(500) }
check('账号自动登录（正式资料副本）', !!session, session ? `${session.email || session.id}` : '')

const own = path.join(profile, 'connector')
let seen = 0
const dump = async (quiet = false) => {
  const log = await api(() => window.api.connectorLog())
  const fresh = log.slice(seen); seen = log.length
  if (!quiet) for (const l of fresh) console.log(`  [${l.level}] ${String(l.text).slice(0, 150)}`)
  return log
}

async function session1(label, room, platform) {
  console.log(`\n== ${label}：${room}`)
  const from = seen
  const t0 = Date.now()
  let started = null
  api(([r, p]) => window.api.connectorStart(r, false, p), [room, platform]).then(r => { started = r })
  let running = false, scan = false
  while (Date.now() - t0 < 60_000) {
    const log = await dump()
    const cs = await api(() => window.api.connectorState())
    if (log.slice(from).some(l => /打开抖音网页|需要重新扫码/.test(l.text))) { scan = true; break }
    if (cs.running) { running = true; break }
    if (started && started.ok === false) break
    await sleep(1500)
  }
  const lines = (await api(() => window.api.connectorLog())).slice(from)
  check(`${label}：用客户端自带的连接器（没装游戏整蛊 mod）`, lines.some(l => /没装游戏整蛊器，用客户端自带的连接器/.test(l.text)))
  check(`${label}：连接器启动`, running && !scan, started && started.ok === false ? JSON.stringify(started) : scan ? '保存的抖音登录已失效，需要扫码' : '')
  if (!running) return
  const stop = Date.now() + WATCH_SECONDS * 1000
  while (Date.now() < stop) { await dump(); await sleep(3000) }
  const all = (await api(() => window.api.connectorLog())).slice(from)
  const cs = await api(() => window.api.connectorState())
  const text = all.map(l => l.text).join('\n')
  // 真事件：普查行（「普查[B站] frames=0 …」）只是连接器的计数汇报，不算；普查里计数大于 0 才算收到了东西
  const census = all.filter(l => /普查/.test(l.text))
  const countedFrames = census.some(l => /frames=[1-9]/.test(l.text))
  const events = all.filter(l => !/普查/.test(l.text) && (['gift', 'like', 'follow'].includes(l.level) || /弹幕|进场|来了|点赞|送出|关注/.test(l.text)))
  check(`${label}：观察 ${WATCH_SECONDS} 秒连接器仍在运行`, cs.running === true || /直播已结束|未开播|已下播/.test(text), `running=${cs.running}`)
  // B 站匿名连接收不收得到数据取决于 B 站接口（和有没有装 mod 无关），只报告、不算门槛
  if (platform === 'bilibili') console.log(`${countedFrames || events.length ? 'INFO' : 'WARN'} ${label}：收到的数据帧 ${countedFrames ? '>0' : '0'}、事件 ${events.length} 条（B 站匿名连接的老问题，不计入结果）`)
  else {
    const status = (all.filter(l => /状态|已连接|直播已结束|未开播|房间/.test(l.text)).pop() || {}).text || ''
    check(`${label}：连上直播间或拿到房间状态`, /已连接|直播已结束|未开播|已下播|房间/.test(text), String(status).slice(0, 120))
    if (/已连接/.test(text)) console.log(`  （主播正在开播：事件 ${events.length} 条）`)
  }
  await api(() => window.api.connectorStop())
  await sleep(2000)
}

if (biliRoom) await session1('B 站公开直播间', biliRoom, 'bilibili')
if (douyinRoom) await session1('抖音直播间', douyinRoom, 'douyin')
check('连接器文件放在客户端自己的目录', existsSync(path.join(own, 'connector.py')) && existsSync(path.join(own, 'bilibili_room.py')) && existsSync(path.join(own, 'douyin_room.py')) && existsSync(path.join(own, 'sign.js')), own)
check('事件桥写在客户端自己的目录', existsSync(path.join(own, 'bridge.txt')))
if (douyinRoom) {
  check('抖音登录态写进客户端自己的连接器目录', existsSync(path.join(own, 'douyin_cookie.txt')))
}
check('假游戏目录里没有被写进任何东西（没装 mod 就不碰游戏）', (await fs.readdir(fixtures)).length === 3)

try { await app.evaluate(({ app }) => app.quit()) } catch { /* */ }
await sleep(1000)
const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS  (userData 副本：${profile})`)
process.exit(bad ? 1 : 0)
