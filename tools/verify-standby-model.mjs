// 采集窗口「开哪个才有哪个」回归（用户 2026-09-10 定版；取代 verify-standby-park）：
//   · 启动时不再摆一排待机窗口；老存档（没有 used 字段）一律不恢复；
//   · 开挂件时窗口出现在主播上次摆的位置；关挂件 = 窗口真没了（默认）；
//   · 「关掉挂件后留着采集来源」开着时：关掉的挂件原地留一块绿底（不停到屏幕外），重启只恢复开过的窗口；
//   · 短窗口名迁移、名称风格切换、画面收边、不抢层级照旧。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output', 'playwright', 'standby-model')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as out from ${JSON.stringify(path.join(root, 'src/main/output-window.ts'))}
export * as effects from ${JSON.stringify(path.join(root, 'src/main/effects-widget.ts'))}
export * as settings from ${JSON.stringify(path.join(root, 'src/main/settings.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
// 存档用 0.3.40 的老标题、没有 used 字段：升级后位置要记住，但启动时不能凭空冒出窗口
await fs.mkdir(path.join(isolated, 'data'), { recursive: true })
await fs.writeFile(path.join(isolated, 'data', 'capture-windows.json'), JSON.stringify([
  { title: '知了猴礼物动画', x: 300, y: 200, width: 640, height: 360, background: true, resizable: true, focusable: true, hasShadow: true, minWidth: 64, minHeight: 64 },
  { title: '知了猴倒计时', x: 500, y: 400, width: 252, height: 150, background: true, resizable: false, focusable: true, hasShadow: false, minWidth: 64, minHeight: 64 }
]))
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow,screen}=require('electron'); app.setPath('userData',__dirname);
app.whenReady().then(async()=>{ const qa=require('./qa.cjs'); global.qa={out:qa.out,effects:qa.effects,settings:qa.settings,screen};
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank');
  await global.qa.out.restoreCaptureOutputWindows(); global.qa.ready=true });`)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const call = (kind, fn, args = []) => app.evaluate((_, { kind, fn, args }) => global.qa[kind][fn](...args), { kind, fn, args })
const state = title => app.evaluate(({ BrowserWindow }, title) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
  if (!win) return null
  return { bounds: win.getBounds(), visible: win.isVisible(), url: win.webContents.getURL().slice(0, 40) }
}, title)
const titles = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getTitle()).filter(Boolean))
const saved = async () => JSON.parse(await fs.readFile(path.join(isolated, 'data', 'capture-windows.json'), 'utf-8'))
const applySetting = async (patch, fn) => { await call('settings', 'saveSettings', [patch]); if (fn) await call('out', fn) }

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // ---- 启动：老存档一律不恢复，桌面上什么都没有 ----
  const boot = await titles()
  check('启动时不摆任何待机窗口（老存档没有 used，一律当没开过）', !boot.includes('礼物动画') && !boot.includes('知了猴礼物动画') && !boot.includes('倒计时'), boot)

  // ---- 开挂件：窗口出现在主播上次摆的位置（老标题迁成短名） ----
  check('开启礼物动画挂件', (await call('effects', 'openEffectsWindow', [{ background: 'green', width: 640, height: 360 }])).ok !== false)
  await sleep(600)
  const opened = await state('礼物动画')
  check('窗口用的是短名「礼物动画」', !!opened && !(await state('知了猴礼物动画')))
  check('窗口出现在主播上次摆的位置、上次的尺寸', opened.bounds.x === 300 && opened.bounds.y === 200 && opened.bounds.width === 640 && opened.bounds.height === 360, opened.bounds)
  await sleep(400)
  const afterOpen = await saved()
  const row = afterOpen.find(r => r.title === '礼物动画')
  check('存档标题换成短名、记下「开过」', !!row && row.used === true && !afterOpen.some(r => r.title === '知了猴礼物动画'), afterOpen)
  check('没开过的倒计时在存档里仍然没有 used', afterOpen.find(r => r.title === '倒计时')?.used !== true, afterOpen)

  // ---- 关挂件 = 窗口真没了（默认） ----
  await call('effects', 'closeEffectsWindow')
  await sleep(600)
  check('关掉挂件后窗口真没了（开哪个才有哪个）', !(await state('礼物动画')) && !(await titles()).includes('礼物动画'), await titles())
  check('关掉后存档仍留着位置和 used', (await saved()).find(r => r.title === '礼物动画')?.x === 300, await saved())

  // ---- 「留着采集来源」开着：关掉的挂件原地留绿底，不停到屏幕外 ----
  await applySetting({ keepClosedSources: true })
  check('再开礼物动画', (await call('effects', 'openEffectsWindow', [{ background: 'green', width: 640, height: 360 }])).ok !== false)
  await sleep(600)
  await call('effects', 'closeEffectsWindow')
  await sleep(600)
  const kept = await state('礼物动画')
  check('留着采集来源时：关掉的窗口原地留着（不停到屏幕外）、可见、显示待机绿页', !!kept && kept.visible && kept.bounds.x === 300 && kept.bounds.y === 200 && kept.url.startsWith('data:text/html'), kept)
  const region = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '礼物动画')
    return win.webContents.executeJavaScript('getComputedStyle(document.body).webkitAppRegion')
  })
  check('待机绿页整页可拖', region === 'drag')

  // ---- 重启恢复：只恢复开过的（used），没开过的不出现 ----
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.getTitle() === '礼物动画') w.destroy() })
  await sleep(300)
  await call('out', 'restoreCaptureOutputWindows')
  await sleep(800)
  const restoredTitles = await titles()
  check('留着采集来源 + 重启：开过的礼物动画恢复出来', restoredTitles.includes('礼物动画'), restoredTitles)
  check('没开过的倒计时不恢复', !restoredTitles.includes('倒计时'), restoredTitles)
  check('恢复出来的窗口在主播摆的位置', (await state('礼物动画'))?.bounds.x === 300)

  // ---- 名称风格切换 ----
  await applySetting({ outputTitleStyle: 'legacy' }, 'applyOutputTitleStyle')
  await sleep(200)
  check('切回旧名称立刻改窗口标题', !!(await state('知了猴礼物动画')))
  await applySetting({ outputTitleStyle: 'short' }, 'applyOutputTitleStyle')
  await sleep(200)
  check('切回短名称立刻生效', !!(await state('礼物动画')))

  // ---- 收边 / 层级（照旧） ----
  await call('effects', 'openEffectsWindow', [{ background: 'green', width: 640, height: 360 }])
  await sleep(500)
  const fit = (media, base) => app.evaluate(({ BrowserWindow }, { media, base }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '礼物动画')
    const out = global.qa.out
    if (base) win.setSize(base[0], base[1])
    out.fitOutputWindowToMedia(win, media[0], media[1])
    return win.getSize()
  }, { media, base })
  check('竖屏素材把窗口收成画面比例', JSON.stringify(await fit([1080, 1920], [640, 360])) === JSON.stringify([203, 360]))
  check('再播横屏素材按原基准还原，不会越收越小', JSON.stringify(await fit([1920, 1080], null)) === JSON.stringify([640, 360]))
  await applySetting({ outputFitMedia: false })
  check('关掉自动收边后窗口尺寸不动', JSON.stringify(await fit([1080, 1920], [640, 360])) === JSON.stringify([640, 360]))
  await applySetting({ outputFitMedia: true })
  const raised = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '礼物动画')
    let shown = 0
    const original = win.showInactive.bind(win)
    win.showInactive = (...args) => { shown++; return original(...args) }
    global.qa.out.showOutputWindow(win)
    win.showInactive = original
    return shown
  })
  check('窗口已经显示着时，播放不再抬到最前', await raised() === 0)
  await applySetting({ outputRaiseOnOpen: true })
  check('打开「播放时窗口跳到最前」后照旧抬前', await raised() === 1)
  await applySetting({ outputRaiseOnOpen: false })

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`standby model regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
