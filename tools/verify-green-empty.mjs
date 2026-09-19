// 空绿幕窗口回归：没选素材也能开（给直播伴侣留采集源），而且不占用自动排队的池子。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/green-empty')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as green from ${JSON.stringify(path.join(root, 'src/main/green-screen.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.setAppPath(${JSON.stringify(root)});
app.commandLine.appendSwitch('force-color-profile','srgb');
app.whenReady().then(async()=>{ global.qa=require('./qa.cjs');
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)
await fs.mkdir(path.join(isolated, 'data'), { recursive: true })
// 绿幕采集 + 排队池只有 1 个窗口
await fs.writeFile(path.join(isolated, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, outputCaptureMode: 'green', videoQueue: true, videoPoolSlots: 1 }))

const video = path.join(isolated, '素材.mp4')
await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=320x180:r=15', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video])

async function exec(cmd, args) {
  const { promisify } = await import('node:util')
  const { execFile } = await import('node:child_process')
  return promisify(execFile)(cmd, args, { windowsHide: true })
}

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (fn, args = []) => app.evaluate((_, { fn, args }) => global.qa.green[fn](...args), { fn, args })
const slots = async () => (await call('greenScreenState')).slots.map(s => ({ slot: s.slot, open: s.open, src: s.src }))
const corner = (title) => app.evaluate(async ({ BrowserWindow }, title) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
  if (!win) return null
  const image = await win.webContents.capturePage()
  const size = image.getSize(); const bmp = image.toBitmap()
  const i = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4
  return { size, pixel: [bmp[i + 2], bmp[i + 1], bmp[i], bmp[i + 3]] }
}, title)

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // 1) 没选素材也能开（以前直接报「未选择绿幕素材」）
  const empty = await call('openGreenScreen', ['', 'video', '', 1])
  await sleep(1500)
  check('没选素材也能打开绿幕窗口（不再报「未选择」）', empty.ok === true, empty)
  const state = await slots()
  check('窗口状态是「开着」的，直播伴侣里能列出来', state[0].open === true && state[0].src === '', state)
  const shot = await corner('绿幕1')
  check('空窗口铺的是能抠掉的绿底', shot && shot.pixel[0] <= 12 && shot.pixel[1] >= 240 && shot.pixel[2] <= 12, shot)

  // 2) 空窗口不占用排队池：池子只有 1 个，视频照样能进来
  const play = await call('openGreenScreen', [video, 'video', '素材来了', 0, { loop: true }])
  await sleep(1800)
  const after = await slots()
  check('空窗口不算占用，视频照样排进这个池子窗口', play.ok === true && after[0].open === true && after[0].src === video, { play, after })

  // 3) 透明底模式下绿幕窗口也必须是绿底（直播伴侣不支持窗口透明，透明=黑）
  await fs.writeFile(path.join(isolated, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, outputCaptureMode: 'transparent', videoQueue: false }))
  await call('closeGreenScreen', [])
  await sleep(900)
  const again = await call('openGreenScreen', ['', 'video', '', 2])
  await sleep(1500)
  const shot2 = await corner('绿幕2')
  check('透明底模式下绿幕窗口依然是绿底（伴侣才采得到）', again.ok === true && shot2 && shot2.pixel[0] <= 12 && shot2.pixel[1] >= 240 && shot2.pixel[2] <= 12, shot2)

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`green empty regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
