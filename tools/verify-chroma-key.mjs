// 内置绿幕抠图回归：带绿背景的视频在窗口里被扣成透明（透明底模式下窗口本身就是透明源）。
// 判据是窗口真实像素的 alpha：绿背景处 alpha=0，画面主体（红块）alpha=255。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output/playwright/chroma-key')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { visible: true })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE

// 绿底 + 中间一个红方块：绿的地方要扣掉，红的地方要留着
const fixture = path.join(profile, '绿幕素材.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=320x180:r=15',
  '-vf', 'drawbox=x=110:y=50:w=100:h=80:color=red@1.0:t=fill', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', fixture], { windowsHide: true })

const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const api = (page, name, ...args) => page.evaluate(([name, args]) => window.api[name](...args), [name, args])

/** 窗口真实像素：绿背景处 / 红方块处的 RGBA + 透明像素占比 */
const sample = async (title) => app.evaluate(async ({ BrowserWindow }, title) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
  if (!win) return null
  const image = await win.webContents.capturePage()
  const size = image.getSize(); const bmp = image.toBitmap()
  const at = (x, y) => { const i = (y * size.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i], bmp[i + 3]] }
  let transparent = 0
  for (let i = 3; i < bmp.length; i += 4) if (bmp[i] === 0) transparent++
  const cx = Math.floor(size.width / 2), cy = Math.floor(size.height / 2)
  return { size, corner: at(Math.floor(size.width * 0.1), Math.floor(size.height * 0.12)), center: at(cx, cy),
    transparentRatio: +(transparent / (bmp.length / 4)).toFixed(3) }
}, title)

const chromaState = async (title) => app.evaluate(({ BrowserWindow }, title) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
  return win ? win.webContents.executeJavaScript('window.__zlChromaState ? window.__zlChromaState() : null') : null
}, title)

let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.getSettings)
  await api(page, 'register', 'chroma_qa', 'Fixture123!', '抠图回归')
  await api(page, 'login', 'chroma_qa', 'Fixture123!')
  await api(page, 'saveSettings', { guideSeen: true, outputCaptureMode: 'transparent', outputFitMedia: false, chromaKey: { enabled: false, color: '#00ff00', similarity: 40, smoothness: 12, spill: 30 } })

  // ---- 1. 不开抠图：绿背景原样留着 ----
  assert.equal((await api(page, 'videoWidgetOpen', { path: fixture, loop: true, muted: true, volume: 0, topMost: false, width: 320, height: 180, bgColor: '#000000' })).ok, true)
  await sleep(2200)
  const plain = await sample('视频')
  check('不开抠图时，绿背景原样在画面上（不透明）', plain && plain.corner[3] === 255 && plain.corner[1] > 150, plain)

  // ---- 2. 开抠图：绿背景 alpha=0，红方块保留 ----
  assert.equal((await api(page, 'videoWidgetOpen', { path: fixture, loop: true, muted: true, volume: 0, topMost: false, width: 320, height: 180, bgColor: '#000000', chroma: true })).ok, true)
  await sleep(2500)
  const keyed = await sample('视频')
  check('开抠图后绿背景被扣成透明（alpha=0）', keyed && keyed.corner[3] === 0, keyed)
  check('画面主体（红方块）保留且不透明', keyed && keyed.center[3] === 255 && keyed.center[0] > 150 && keyed.center[1] < 120, keyed)
  check('抠掉的面积接近背景比例（大于 30%）', keyed && keyed.transparentRatio > 0.3, { ratio: keyed?.transparentRatio })
  const state = await chromaState('视频')
  check('页面里抠图脚本处于开启状态', state?.enabled === true && state?.canvas === true, state)

  // ---- 3. 关掉抠图：绿背景回来（复用同一个窗口） ----
  assert.equal((await api(page, 'videoWidgetOpen', { path: fixture, loop: true, muted: true, volume: 0, topMost: false, width: 320, height: 180, bgColor: '#000000' })).ok, true)
  await sleep(2200)
  const off = await sample('视频')
  check('关掉抠图后绿背景恢复不透明', off && off.corner[3] === 255 && off.corner[1] > 150, off)
  check('关掉抠图后画布不再显示', (await chromaState('视频'))?.enabled === false)

  // ---- 4. 绿幕窗口同一条链路（项目素材播到绿幕窗口） ----
  // 绿幕窗口 0.3.42 起始终是绿底（直播伴侣不支持窗口透明），所以扣掉的地方露绿底、不是透明
  assert.equal((await api(page, 'greenScreenOpen', fixture, 'video', '抠图回归', 1, { loop: true, chroma: true })).ok, true)
  await sleep(2500)
  const green = await sample('绿幕1')
  check('绿幕窗口里的项目素材同样被扣掉（露出能抠的绿底）', green && green.corner[0] <= 12 && green.corner[1] >= 240 && green.corner[2] <= 12 && green.center[0] > 150, green)

  // ---- 5. 改抠图颜色（改成红色 → 红方块被扣掉、绿背景留下，证明参数真的生效） ----
  await api(page, 'saveSettings', { chromaKey: { enabled: false, color: '#ff0000', similarity: 40, smoothness: 12, spill: 30 } })
  assert.equal((await api(page, 'greenScreenOpen', fixture, 'video', '参数回归', 1, { loop: true, chroma: true })).ok, true)
  await sleep(2500)
  const keyedRed = await sample('绿幕1')
  check('把抠图颜色改成红色后，红方块被扣掉、绿背景留下（参数真的生效）', keyedRed && keyedRed.corner[1] >= 240 && keyedRed.corner[0] <= 12 && keyedRed.center[0] <= 12 && keyedRed.center[1] >= 240, keyedRed)

  // ---- 6. 绿幕采集模式：扣掉的地方露出窗口绿底（直播伴侣的绿幕抠像再把它去掉） ----
  // 底色是建窗口时定死的，换模式要先关掉重开（设置页也是这么提示的）
  assert.equal((await api(page, 'greenScreenClose')).ok, true)
  await api(page, 'saveSettings', { outputCaptureMode: 'green', chromaKey: { enabled: false, color: '#00ff00', similarity: 40, smoothness: 12, spill: 30 } })
  await sleep(1200)
  assert.equal((await api(page, 'greenScreenOpen', fixture, 'video', '绿底模式', 1, { loop: true, chroma: true })).ok, true)
  await sleep(2500)
  const greenMode = await sample('绿幕1')
  check('绿幕采集模式下，抠掉的地方露出窗口绿底（不是黑、不是透明）', greenMode && greenMode.corner[0] <= 12 && greenMode.corner[1] >= 240 && greenMode.corner[2] <= 12 && greenMode.center[0] > 150, greenMode)

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: profile }, null, 2))
  console.log(`chroma key regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
