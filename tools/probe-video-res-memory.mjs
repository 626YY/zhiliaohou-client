// 素材分辨率对内存的影响：同一个绿幕窗口（640×360）分别循环播 640×360 / 1920×1080 / 3840×2160 的视频，
// 各稳定 20 秒后读该窗口页面进程 + GPU 进程的私有内存。差距大 = 值得把礼物素材预压制到窗口分辨率。
// 用法：node tools/probe-video-res-memory.mjs   （先 npm run build；需要本机 ffmpeg 生成素材）
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'video-res-memory')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const run = promisify(execFile)
const sleep = ms => new Promise(r => setTimeout(r, ms))

await fs.mkdir(outputDir, { recursive: true })
const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
// --render balanced|compatible|hardware：渲染模式（hardware = 全交给显卡，Chromium 才会走硬件解码）；--visible 让窗口真显示（隐藏窗口可能不走硬解）
const argv = process.argv.slice(2)
const renderIdx = argv.indexOf('--render')
if (renderIdx >= 0) { const sp = path.join(profile, 'data', 'settings.json'); const st = JSON.parse(await fs.readFile(sp, 'utf8')); st.renderMode = argv[renderIdx + 1]; await fs.writeFile(sp, JSON.stringify(st, null, 2)); console.log('渲染模式：' + argv[renderIdx + 1]) }
const sizes = [[640, 360], [1920, 1080], [3840, 2160]]
const files = {}
for (const [w, h] of sizes) {
  const f = path.join(profile, `v${w}x${h}.mp4`)
  // 有内容的画面（噪点 + 移动方块），别让编码器把它压成几乎静止的纯色
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=30:duration=8`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', f], { windowsHide: true })
  files[`${w}x${h}`] = f
}
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
await page.evaluate(async () => { await window.api.register('res_user', 'Fixture123!', '分辨率'); await window.api.login('res_user', 'Fixture123!'); await window.api.saveSettings({ guideSeen: true, autoLogin: false }); localStorage.setItem('zl-guide-seen', '1') })
const api = (fn, arg) => page.evaluate(fn, arg)
await api(() => window.api.greenScreenClose()); await sleep(200)
await api(() => window.api.greenScreenOpen('', 'video', '', 1)); await sleep(2000)
const measure = () => app.evaluate(({ app, BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === '绿幕1'); const pid = w?.webContents.getOSProcessId()
  const metrics = app.getAppMetrics()
  const page = metrics.find(m => m.pid === pid), gpu = metrics.find(m => m.type === 'GPU')
  return { pagePrivMb: Math.round((page?.memory?.privateBytes || 0) / 1024), pageWsMb: Math.round((page?.memory?.workingSetSize || 0) / 1024), gpuPrivMb: Math.round((gpu?.memory?.privateBytes || 0) / 1024), pageCpu: Math.round(page?.cpu?.percentCPUUsage || 0), gpuCpu: Math.round(gpu?.cpu?.percentCPUUsage || 0) }
})
console.log('空绿底：', JSON.stringify(await measure()))
for (const key of Object.keys(files)) {
  await api((f) => window.api.greenScreenOpen(f, 'video', '', 1, { loop: true }), files[key])
  await sleep(20_000)
  await measure(); await sleep(3000)
  const m = await measure()
  console.log(`${key.padEnd(9)} 循环播 20 秒：页面进程私有 ${m.pagePrivMb}MB（工作集 ${m.pageWsMb}MB） GPU 进程私有 ${m.gpuPrivMb}MB  CPU 页面 ${m.pageCpu}% / GPU ${m.gpuCpu}%`)
  await api(() => window.api.greenScreenOpen('', 'video', '', 1)); await sleep(3000)
}
try { await app.evaluate(({ app }) => app.quit()) } catch { /* */ }
