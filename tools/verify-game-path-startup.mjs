// 「游戏路径认错自动纠正」在主进程启动时也跑一次（隔壁 0.3.17 只在游戏库页挂载时纠）：
// 隔离隐藏客户端，settings 里故意把 DON'T SCREAM 记成根目录启动器、轮椅记成不存在的假路径 → 启动后不打开任何页面，直接读设置，
// 应已被纠正成 Shipping exe / 真实 4Wheel Challenge.exe。用法：node tools/verify-game-path-startup.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const DS_ROOT = "F:\\SteamLibrary\\steamapps\\common\\DON'T SCREAM"
const DS_SHIP = path.join(DS_ROOT, 'DontScream', 'Binaries', 'Win64', 'DontScream-Win64-Shipping.exe')
const DS_LAUNCHER = ['Dont_Scream.exe', 'DontScream.exe'].map((n) => path.join(DS_ROOT, n)).find((p) => fsSync.existsSync(p))
const WHEEL_REAL = 'F:\\SteamLibrary\\steamapps\\common\\4WheelChallenge\\4Wheel Challenge.exe'
assert.ok(fsSync.existsSync(DS_SHIP) && DS_LAUNCHER && fsSync.existsSync(WHEEL_REAL), '本机缺游戏')
const out = path.join(root, 'output/playwright/game-path-startup'); await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
// 此测试只读真实游戏路径；自动修复另由 verify-mod-health 的临时游戏目录验证。
// 在隔离实例中跳过该定时回调，避免路径探测回归顺带改动真实游戏文件。
const bootstrap = await fs.readFile(entry, 'utf8')
await fs.writeFile(entry, `
const nativeSetTimeout = global.setTimeout;
global.__pathTestSkippedRepair = 0;
global.setTimeout = (callback, delay, ...args) => {
  if (String(callback).replace(/\\s/g, '') === '()=>{voidautoRepairAtStartup();}') {
    global.__pathTestSkippedRepair++;
    return nativeSetTimeout(() => {}, 0);
  }
  return nativeSetTimeout(callback, delay, ...args);
};
` + bootstrap)
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
const fake = 'C:\\Temp\\zl-startup-fixture\\4WheelChallenge.exe'
await fs.writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({
  currentGameId: 'dontscream',
  gamePaths: { dontscream: DS_LAUNCHER, '4wheel-challenge': fake },
  gamePath: fake, gameExeName: '4WheelChallenge.exe'
}))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
let failure
try {
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.api?.getSettings)
  // Steam 库异步探测完成后才登记修复回调；等待真实状态，避免把慢机器误判成隔离失败。
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.__pathTestSkippedRepair)); i++) {
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.equal(await app.evaluate(() => global.__pathTestSkippedRepair), 1, '路径验收必须隔离自动修复')
  const s = (await page.evaluate(() => window.api.getSettings())).settings
  const ds = s.gamePaths?.dontscream || '', wl = s.gamePaths?.['4wheel-challenge'] || ''
  console.log('启动后 settings: dontscream =', ds, '| 4wheel =', wl)
  assert.equal(path.normalize(ds).toLowerCase(), path.normalize(DS_SHIP).toLowerCase(), 'DS 启动时没被纠正到 Shipping exe')
  console.log('PASS 启动时：DON\'T SCREAM 根目录启动器 → Shipping exe')
  assert.equal(path.normalize(wl).toLowerCase(), path.normalize(WHEEL_REAL).toLowerCase(), '轮椅假路径启动时没被纠正到真实 exe')
  console.log('PASS 启动时：轮椅不存在的假路径 → 扫 Steam 库纠正到真实 exe')
  const st = await page.evaluate(() => window.api.gameState())
  console.log('PASS 进程判定按纠正后的 exe 名', JSON.stringify(st))
} catch (e) { failure = e; console.log('FAIL ' + (e?.stack || e)) }
finally { await app.close().catch(() => {}) }
if (failure) process.exit(1)
console.log('全部通过 3 项')
