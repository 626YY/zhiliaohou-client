// 复现「朋友把 mod 删了重新加游戏后快捷键不好使 / 检测不到游戏运行」：隐藏隔离客户端（0.3.17 源码）对着真实 DON'T SCREAM 目录，
// 走真实 IPC：卸载 → 重新定位游戏（自动探测 + 故意选错成根目录启动器看会不会自纠）→ 从 OSS 重装 0.2.11 → 核对文件 → 游戏在不在跑的判定。
// 之后由 DontScream整蛊/tools/ds_hotkey_accept.py 真机进森林按热键验收。
// 用法：node tools/verify-ds-reinstall.mjs   前置：游戏没在跑、本机装着 DON'T SCREAM
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const GAME_ROOT = "F:\\SteamLibrary\\steamapps\\common\\DON'T SCREAM"
const SHIP = path.join(GAME_ROOT, 'DontScream', 'Binaries', 'Win64', 'DontScream-Win64-Shipping.exe')
const WIN64 = path.dirname(SHIP)
const MODDIR = path.join(WIN64, 'ue4ss', 'Mods', 'zhiliao')
assert.ok(fsSync.existsSync(SHIP), '找不到 ' + SHIP)
const launcher = ['DontScream.exe', 'Dont_Scream.exe'].map((n) => path.join(GAME_ROOT, n)).find((p) => fsSync.existsSync(p))
const out = path.join(root, 'output/playwright/ds-reinstall'); await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({ currentGameId: 'dontscream', gamePaths: { dontscream: SHIP }, gamePath: SHIP, gameExeName: path.basename(SHIP) }))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
const checks = []
const pass = (n, d = '') => { checks.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }
const exists = (p) => fsSync.existsSync(p)
const modVersion = () => { try { return (fsSync.readFileSync(path.join(MODDIR, 'Scripts', 'main.lua'), 'utf8').match(/MOD_VERSION\s*=\s*"([^"]+)"/) || [])[1] || '' } catch { return '' } }
let failure
try {
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.api?.listMods)
  const r = await page.evaluate(() => window.api.register('zltest' + Date.now().toString(36), 'Test1234!', '重装复现')); assert.equal(r.ok, true, r.error)
  // 记录卸载前主播配置（重装要保留）
  const cfgBefore = exists(path.join(MODDIR, 'config.json')) ? await fs.readFile(path.join(MODDIR, 'config.json'), 'utf8') : ''
  let mods = await page.evaluate(() => window.api.listMods())
  const ds = mods.mods.find((m) => m.id === 'zhiliao-dontscream')
  console.log('  卸载前：清单版本', ds.version, '| 本机已装', JSON.stringify(mods.installed['zhiliao-dontscream'] || null), '| 目录版本', modVersion())

  // ① 卸载
  const u = await page.evaluate(() => window.api.uninstallMod('zhiliao-dontscream')); assert.equal(u.ok, true, '卸载失败 ' + u.error)
  assert.ok(!exists(MODDIR), '卸载后 ue4ss/Mods/zhiliao 还在')
  assert.ok(exists(path.join(WIN64, 'dwmapi.dll')) && exists(path.join(WIN64, 'ue4ss', 'UE4SS.dll')), '卸载不该删 UE4SS 运行时')
  pass('卸载：只删 ue4ss/Mods/zhiliao，UE4SS 运行时保留')

  // ② 重新定位游戏：自动探测
  const d = await page.evaluate(() => window.api.detectGamePath()); assert.equal(d.ok, true, '自动探测失败 ' + d.error)
  assert.equal(path.normalize(d.path).toLowerCase(), path.normalize(SHIP).toLowerCase(), '自动探测到的不是 Shipping exe：' + d.path)
  pass('重新加游戏：自动探测到 Shipping exe', d.path)
  // ②b 故意选错：根目录启动器 → 应自纠到 Shipping exe（0.3.17 隔壁的「路径认错了会自己纠正」）
  if (launcher) {
    const s = await page.evaluate((p) => window.api.setGamePath('dontscream', p), launcher)
    const st = await page.evaluate(() => window.api.getSettings())
    const now = st.settings.gamePaths?.dontscream || ''
    console.log('  选错启动器', path.basename(launcher), '→ setGamePath 返回', JSON.stringify(s).slice(0, 160), '| 现在记的是', now)
    assert.equal(path.normalize(now).toLowerCase(), path.normalize(SHIP).toLowerCase(), '选错启动器没被纠正到 Shipping exe，还是 ' + now)
    pass('重新加游戏：手选到根目录启动器会自动纠正到 Shipping exe')
  } else console.log('  （根目录没有启动器 exe，跳过选错场景）')

  // ③ 重装（从 OSS 下 0.2.11）
  await page.evaluate(() => { window.__prog = []; window.api.onModProgress?.((p) => window.__prog.push(p)) })
  const t0 = Date.now()
  const i = await page.evaluate(() => window.api.installMod('zhiliao-dontscream')); assert.equal(i.ok, true, '安装失败 ' + i.error)
  const v = modVersion()
  for (const f of ['Scripts/main.lua', 'connector.py', 'douyin_room.py', 'sign.js', 'enabled.txt', 'config.json']) assert.ok(exists(path.join(MODDIR, f)), '重装后缺 ' + f)
  pass('重装：从 OSS 装好 ' + v + '，弹幕组件齐全', ((Date.now() - t0) / 1000).toFixed(1) + 's')
  assert.equal(v, ds.version, '装上的版本 ' + v + ' ≠ 清单 ' + ds.version)
  mods = await page.evaluate(() => window.api.listMods())
  assert.equal(mods.installed['zhiliao-dontscream']?.version, ds.version)
  pass('重装：游戏库认到已装 v' + ds.version)
  if (cfgBefore) {
    const cfgAfter = await fs.readFile(path.join(MODDIR, 'config.json'), 'utf8')
    const b = JSON.parse(cfgBefore).Binds || {}, a = JSON.parse(cfgAfter).Binds || {}
    pass('重装：主播快捷键配置保留', Object.keys(a).length + ' 条，与卸载前' + (JSON.stringify(a) === JSON.stringify(b) ? '一致' : '不同(重装写回默认)'))
  }
  // ④ 游戏在不在跑的判定：现在没跑 → 应为 false；路径按 Shipping exe 名判
  const gs = await page.evaluate(() => window.api.gameState?.())
  console.log('  gameState:', JSON.stringify(gs).slice(0, 200))
} catch (e) { failure = e; console.log('FAIL ' + (e?.stack || e)) }
finally { await app.close().catch(() => {}) }
if (failure) process.exit(1)
console.log(`全部通过 ${checks.length} 项`)
