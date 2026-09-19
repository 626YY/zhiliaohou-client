// 动作命令那条路（礼物规则用的）也要吃「绿幕抠图」：entertainmentCommand(cmd, param, { chroma })
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output/playwright/chroma-command')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as ent from ${JSON.stringify(path.join(root, 'src/main/entertainment.ts'))}
export * as green from ${JSON.stringify(path.join(root, 'src/main/green-screen.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.setAppPath(${JSON.stringify(root)});
// 和 app-setup 一致：不锁 sRGB 的话显示器色彩配置会把采集到的绿改掉，颜色断言就不准了
app.commandLine.appendSwitch('force-color-profile','srgb');
app.whenReady().then(async()=>{ global.qa=require('./qa.cjs');
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)
await fs.mkdir(path.join(isolated, 'data'), { recursive: true })
await fs.writeFile(path.join(isolated, 'data', 'settings.json'), JSON.stringify({
  guideSeen: true, outputCaptureMode: 'green', videoQueue: true, videoPoolSlots: 2,
  chromaKey: { enabled: false, color: '#00ff00', similarity: 40, smoothness: 12, spill: 30 }
}))

const video = path.join(isolated, '绿幕素材.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=320x180:r=15',
  '-vf', 'drawbox=x=110:y=50:w=100:h=80:color=red@1.0:t=fill', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video], { windowsHide: true })

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (ns, fn, args = []) => app.evaluate((_, { ns, fn, args }) => global.qa[ns][fn](...args), { ns, fn, args })
const sample = (title) => app.evaluate(async ({ BrowserWindow }, title) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
  if (!win) return null
  const image = await win.webContents.capturePage()
  const size = image.getSize(); const bmp = image.toBitmap()
  const at = (x, y) => { const i = (y * size.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i], bmp[i + 3]] }
  return { size, corner: at(Math.floor(size.width * 0.1), Math.floor(size.height * 0.12)), center: at(Math.floor(size.width / 2), Math.floor(size.height / 2)) }
}, title)

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // 不带 chroma：绿背景原样
  // 0.3.43 起「播放视频」默认走绿幕排队模型，要测视频窗口得明确写「|视频」
  assert.equal((await call('ent', 'entertainmentCommand', ['video-play', `${video}|0|视频`])).ok, true)
  await sleep(2200)
  const plain = await sample('视频')
  check('动作命令不带抠图时绿背景原样', plain && plain.corner[1] > 150, plain)

  // 带 chroma：绿背景被扣掉，露出窗口绿底（绿幕采集模式）
  assert.equal((await call('ent', 'entertainmentCommand', ['video-play', `${video}|0|视频`, { chroma: true }])).ok, true)
  await sleep(2500)
  // 先手动开一次，验证脚本本身在这个窗口里能不能干活（排除是「脚本没注入」还是「业务没调」）
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '视频')
    return win.webContents.executeJavaScript(`window.__zlChromaSet({enabled:true,color:'#00ff00',similarity:40,smoothness:12,spill:30})`)
  })
  await sleep(1500)
  const manual = await sample('视频')
  check('手动调 __zlChromaSet 能抠（脚本本身没问题）', manual && manual.corner[1] >= 240 && manual.corner[0] <= 12, manual)

  const keyed = await sample('视频')
  const state = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '视频')
    return win.webContents.executeJavaScript(`(() => ({ chroma: window.__zlChromaState ? window.__zlChromaState() : null,
      hasScript: typeof window.__zlChromaSet === 'function',
      videoVisibility: getComputedStyle(document.getElementById('v')).visibility,
      canvas: !!document.getElementById('zl-chroma'), bodyBg: getComputedStyle(document.body).backgroundColor }))()`)
  })
  check('动作命令带 chroma 时绿背景被扣掉（画面只剩主体）', keyed && keyed.corner[1] >= 240 && keyed.corner[0] <= 12 && keyed.center[0] > 150, { keyed, state })

  // project-random 那条路也要带上（用同一份素材当项目目录）
  const project = path.join(isolated, '项目A')
  await fs.mkdir(project, { recursive: true })
  await fs.copyFile(video, path.join(project, '随机播放.mp4'))
  // 开哪个才有哪个：项目视频只播到主播开着的绿幕窗口，先替主播开一个 1 号空窗口
  assert.equal((await call('green', 'openGreenScreen', ['', 'video', '', 1])).ok, true)
  await sleep(600)
  assert.equal((await call('ent', 'entertainmentCommand', ['project-random', project, { chroma: true }])).ok, true)
  await sleep(2600)
  const slot = await call('green', 'greenScreenState')
  const opened = slot.slots.find(s => s.open)
  check('项目方式也按 chroma 播（开在绿幕窗口里）', !!opened, slot.slots.map(s => ({ slot: s.slot, open: s.open })))
  const projectShot = await sample(`绿幕${opened?.slot || 1}`)
  check('项目方式播出来的画面也扣掉了绿背景', projectShot && projectShot.corner[1] >= 240 && projectShot.corner[0] <= 12 && projectShot.center[0] > 150, projectShot)

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`chroma command regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
