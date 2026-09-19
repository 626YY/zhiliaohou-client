// 轮椅整蛊器「首次安装」真机验收（会动本机真实游戏目录，跑完保持已安装状态；游戏由 C:/kbshot/zl_mute_proc.py 只压进程音量）：
//   1. 客户端卸载轮椅整蛊器（Inno 卸载器静默）→ 游戏目录里 Mods/WheelLive.dll 消失
//   2. 客户端安装（从 OSS 下载 1.0.0.10 安装包 → 静默装进游戏目录 → 免检模式下换上随包 1.0.0.12 组件 + 免检标记）
//   3. main.log 里 [mods] 留痕：开始 / 目标目录 / 结果
//   4. 起游戏（静音）：MelonLoader 日志出现 WheelLive v1.0.0.12、mode=card locked=False；记录首次启动到 mod 加载的耗时（首启要生成 Il2Cpp 程序集）
//   5. 客户端健康自检（modHealth）：文件检查通过
// 用法：node tools/verify-wheellive-fresh-install.mjs   （先 npm run build；游戏必须没在跑；下载约 214MB）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'wheellive-fresh-install')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const GAME_DIR = 'F:\\SteamLibrary\\steamapps\\common\\4WheelChallenge'
const EXE = path.join(GAME_DIR, '4Wheel Challenge.exe')
const MODS = path.join(GAME_DIR, 'Mods')
const ML_LOG = path.join(GAME_DIR, 'MelonLoader', 'Latest.log')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
async function check(name, fn) { try { const d = await fn(); results.push(true); console.log(`PASS ${name}${typeof d === 'string' && d ? '  ' + d : ''}`) } catch (e) { results.push(false); console.log(`FAIL ${name}  ${e?.message || e}`) } }
async function waitFor(fn, label, timeout = 15_000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await fn()) return } catch { /* 再等 */ } await sleep(500) } throw new Error('等超时：' + label) }
const exists = p => fs.access(p).then(() => true, () => false)
const ps = c => execFileSync('powershell', ['-NoProfile', '-Command', c], { encoding: 'utf8' }).trim()
const gameRunning = () => ps("@(Get-Process '4Wheel Challenge' -ErrorAction SilentlyContinue).Count") !== '0'

if (gameRunning()) { console.log('游戏正在运行，拒绝执行'); process.exit(3) }
await fs.mkdir(outputDir, { recursive: true })
const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({ assetGuideSeen: true, guideSeen: true, currentGameId: '4wheel-challenge', gamePaths: { '4wheel-challenge': EXE }, gamePath: EXE, gameExeName: '4Wheel Challenge.exe' }, null, 2))
const log = path.join(profile, 'logs', 'main.log')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
await page.evaluate(async () => { await window.api.register('fresh_user', 'Fixture123!', '首装'); await window.api.login('fresh_user', 'Fixture123!'); await window.api.saveSettings({ guideSeen: true, autoLogin: false }); localStorage.setItem('zl-guide-seen', '1') })
const api = (fn, arg) => page.evaluate(fn, arg)
const readLog = () => fs.readFile(log, 'utf8').catch(() => '')

await check('前置：客户端认出真实游戏路径，整蛊器当前已安装', async () => {
  const l = await api(() => window.api.listMods())
  assert.ok(l.installed?.wheellive || (await exists(path.join(MODS, 'WheelLive.dll'))), JSON.stringify(Object.keys(l.installed || {})))
  return `Mods/WheelLive.dll ${await exists(path.join(MODS, 'WheelLive.dll')) ? '存在' : '不存在'}`
})
await check('1. 卸载：Inno 卸载器静默跑完，Mods/WheelLive.dll 消失', async () => {
  const r = await api(() => window.api.uninstallMod('wheellive'))
  assert.equal(r.ok, true, r.error)
  await waitFor(async () => !(await exists(path.join(MODS, 'WheelLive.dll'))), 'DLL 消失', 60_000)
  await waitFor(async () => /\[mods\] 卸载 wheellive 成功/.test(await readLog()), '卸载留痕')
  await sleep(2000)
})
let installMs = 0
await check('2. 安装：下载安装包 → 静默装进游戏目录 → 免检组件 1.0.0.12 + 免检标记', async () => {
  const t0 = Date.now()
  const r = await api(() => window.api.installMod('wheellive'))
  installMs = Date.now() - t0
  assert.equal(r.ok, true, r.error)
  assert.ok(await exists(path.join(MODS, 'WheelLive.dll')), 'DLL 没装上')
  assert.ok(await exists(path.join(MODS, 'WheelLive', 'connector.py')), 'connector.py 没装上')
  assert.ok(await exists(path.join(MODS, 'WheelLive', 'douyin_room.py')), 'douyin_room.py 没装上')
  assert.ok(await exists(path.join(GAME_DIR, 'version.dll')), 'MelonLoader 没装上')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'output', 'local-card-mod', 'manifest.json'), 'utf8'))
  const { createHash } = await import('node:crypto')
  assert.equal(createHash('sha256').update(await fs.readFile(path.join(MODS, 'WheelLive.dll'))).digest('hex'), manifest.sha256, 'DLL 不是随包的 1.0.0.12 组件')
  const marker = JSON.parse(await fs.readFile(path.join(MODS, 'WheelLive', 'local-card-license.json'), 'utf8'))
  assert.equal(marker.free, true, JSON.stringify(marker))
  return `耗时 ${Math.round(installMs / 1000)} 秒`
})
await check('3. main.log 有 [mods] 安装留痕（开始 / 目标目录 / 成功）', async () => {
  const text = await readLog()
  assert.match(text, /\[mods\] 安装 wheellive 开始/); assert.match(text, /\[mods\] wheellive [\d.]+ 目标目录 /); assert.match(text, /\[mods\] 安装 wheellive 成功/)
})
await check('5. 客户端健康自检：文件检查通过', async () => {
  const h = await api(() => window.api.modHealth('4wheel-challenge'))
  assert.ok(h && (h.ok === true || h.status === 'ok' || (Array.isArray(h.issues) && h.issues.length === 0)), JSON.stringify(h).slice(0, 300))
})
// 4. 起游戏：静音只压游戏进程；等 MelonLoader 日志
let game = null, muter = null
await check('4. 首次启动：MelonLoader 加载 WheelLive v1.0.0.12，mode=card locked=False', async () => {
  // MelonLoader 每次启动重写 Latest.log；先把旧的挪走，只认这次新生成的日志（否则会把上一场的行当成本场）
  await fs.rename(ML_LOG, ML_LOG.replace('Latest.log', 'Latest.prev-' + Date.now() + '.log')).catch(() => {})
  muter = spawn('python', ['C:/kbshot/zl_mute_proc.py', '4Wheel', '--watch', '420'], { stdio: 'ignore', windowsHide: true })
  const t0 = Date.now()
  game = spawn(EXE, [], { cwd: GAME_DIR, detached: true, stdio: 'ignore' })
  let text = ''
  await waitFor(async () => { text = (await fs.readFile(ML_LOG, 'utf8').catch(() => '')); return /WheelLive v1\.0\.0\.12/.test(text) && /卡密: mode=card locked=(True|False)/.test(text) }, 'mod 加载', 360_000)
  const m = /卡密: mode=card locked=(True|False)[^\n]*/.exec(text)
  assert.ok(m && m[1] === 'False', m ? m[0] : '没有卡密行')
  const gen = /Il2CppAssemblyGenerator/.test(text.slice(0, 4000)) ? '（含首启生成 Il2Cpp 程序集）' : ''
  return `从起游戏到 mod 加载 ${Math.round((Date.now() - t0) / 1000)} 秒${gen}；${m[0].slice(0, 80)}`
})
ps("Get-Process '4Wheel Challenge' -ErrorAction SilentlyContinue | Stop-Process -Force")
try { muter?.kill() } catch { /* */ }
try { await app.evaluate(({ app }) => app.quit()) } catch { /* */ }
await sleep(1500)
const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS  日志 ${log}`)
process.exit(bad ? 1 : 0)
