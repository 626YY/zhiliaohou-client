// 常驻播放页肉眼检查：真显示绿幕 1 号窗口，依次「播视频 + 文字叠加」「播图片」「播带绿背景的视频 + 抠图」「播完回绿底」，
// 每一步截图到 output/playwright/green-player-shots/，并核对：窗口句柄全程不变、页面 URL 全程是 green-player-1.html（没有整页导航）、
// 主进程收到播放 / 播完事件、看门狗无误报。
// 用法：node tools/shot-green-player.mjs   （先 npm run build；会在屏幕上出现一个绿幕窗口约 40 秒）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'green-player-shots')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const run = promisify(execFile)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
async function check(name, fn) { try { const d = await fn(); results.push(true); console.log(`PASS ${name}${typeof d === 'string' && d ? '  ' + d : ''}`) } catch (e) { results.push(false); console.log(`FAIL ${name}  ${e?.message || e}`) } }
async function waitFor(fn, label, timeout = 15_000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await fn()) return } catch { /* 再等 */ } await sleep(200) } throw new Error('等超时：' + label) }

await fs.mkdir(outputDir, { recursive: true })
const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { visible: true })
// 素材：蓝底 3 秒视频（文字叠加用）、绿底带红方块的 3 秒视频（抠图用：绿被扣掉露出窗口绿底，红方块留下）、一张 png
const blue = path.join(profile, 'blue.mp4'), greenBox = path.join(profile, 'greenbox.mp4'), png = path.join(profile, 'pic.png')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=25:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue], { windowsHide: true })
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x12f512:s=640x360:r=25:d=3', '-vf', 'drawbox=x=220:y=100:w=200:h=160:color=red:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', greenBox], { windowsHide: true })
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=400x300:d=1', '-frames:v', '1', png], { windowsHide: true })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
await page.evaluate(async () => { await window.api.register('shot_user', 'Fixture123!', '截图'); await window.api.login('shot_user', 'Fixture123!'); await window.api.saveSettings({ guideSeen: true, autoLogin: false }); localStorage.setItem('zl-guide-seen', '1') })
const api = (fn, arg) => page.evaluate(fn, arg)
const green = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === '绿幕1'); if (!w) return null; return { hwnd: w.getNativeWindowHandle().toString('hex'), url: w.webContents.getURL().split('/').pop(), title: w.getTitle() } })
const shot = async (name) => { const png = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === '绿幕1'); const img = await w.webContents.capturePage(); return Array.from(img.toPNG()) }); const file = path.join(outputDir, name); await fs.writeFile(file, Buffer.from(png)); return file }
const state = () => api(() => window.api.greenScreenState())

await api(() => window.api.greenScreenClose()); await sleep(200)
assert.equal((await api(() => window.api.greenScreenOpen('', 'video', '', 1))).ok, true)
await sleep(2500)
const first = await green()
await check('空窗口：播放页已加载（green-player-1.html），纯绿底', async () => { assert.match(first.url, /green-player-1\.html/); await shot('0-blank.png'); return `hwnd ${first.hwnd}` })

await check('播蓝色视频 + 文字叠加：主进程收到播放中，截图有文字', async () => {
  const r = await api((v) => window.api.greenScreenOpen(v, 'video', '测试文字叠加', 1, { loop: false }), blue); assert.equal(r.ok, true, r.error)
  await waitFor(async () => (await state()).slots.find(s => s.slot === 1)?.src, '槽位有素材')
  await sleep(1200); await shot('1-video-text.png')
  const g = await green(); assert.equal(g.hwnd, first.hwnd, '句柄变了'); assert.match(g.url, /green-player-1\.html/, '发生了整页导航')
})
await check('播完自动回绿底（播完事件经 document.title 送达）', async () => {
  await waitFor(async () => !(await state()).slots.find(s => s.slot === 1)?.src, '回绿底', 12_000)
  await sleep(500); await shot('2-after-ended.png')
  const g = await green(); assert.equal(g.hwnd, first.hwnd); assert.match(g.url, /green-player-1\.html/)
})
await check('播图片：橙色图片显示，句柄不变', async () => {
  const r = await api((p) => window.api.greenScreenOpen(p, 'image', '', 1, { maxSeconds: 2 }), png); assert.equal(r.ok, true, r.error)
  await sleep(800); await shot('3-image.png')
  await waitFor(async () => !(await state()).slots.find(s => s.slot === 1)?.src, '到秒数撤掉', 8000)
  const g = await green(); assert.equal(g.hwnd, first.hwnd)
})
await check('播绿底红方块视频 + 抠图：绿被扣掉（露出窗口绿底）、红方块留下', async () => {
  const r = await api((v) => window.api.greenScreenOpen(v, 'video', '', 1, { loop: false, chroma: true }), greenBox); assert.equal(r.ok, true, r.error)
  await sleep(1500); const file = await shot('4-chroma.png')
  // 抠图画布启用、原视频隐藏；视频自带的绿是 0x12f512，抠掉后露出的是窗口绿 0x00ff00 —— 角落像素必须是窗口绿
  const dom = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === '绿幕1'); return w.webContents.executeJavaScript('(()=>{const c=document.querySelector("canvas"),v=document.getElementById("v");return {canvas:c?c.style.display:"none",video:v?v.style.visibility:""}})()') })
  assert.equal(dom.canvas, 'block', JSON.stringify(dom)); assert.equal(dom.video, 'hidden', JSON.stringify(dom))
  const px = (await run('python', ['-c', `from PIL import Image;im=Image.open(r'${file}').convert('RGB');print(*im.getpixel((20,20)),*im.getpixel((320,180)))`])).stdout.trim().split(/\s+/).map(Number)
  assert.deepEqual(px.slice(0, 3), [0, 255, 0], '角落不是窗口绿（抠图没生效）：' + px.join(','))
  assert.ok(px[3] > 200 && px[4] < 60, '中央红方块不在：' + px.join(','))
  await waitFor(async () => !(await state()).slots.find(s => s.slot === 1)?.src, '播完', 12_000)
  const g = await green(); assert.equal(g.hwnd, first.hwnd); assert.match(g.url, /green-player-1\.html/)
  return `角落 ${px.slice(0,3).join(',')} 中央 ${px.slice(3).join(',')}`
})
await check('连播 5 条互相顶替后仍是同一页面、无看门狗误报', async () => {
  for (let i = 0; i < 5; i++) { await api((v) => window.api.greenScreenOpen(v, 'video', '第' + Date.now() % 1000, 1, { loop: false }), blue); await sleep(300) }
  await sleep(1000); await shot('5-rapid.png')
  const st = await state(); const g = await green()
  assert.equal(g.hwnd, first.hwnd); assert.match(g.url, /green-player-1\.html/)
  assert.equal(st.rescued || 0, 0, '看门狗撤过素材')
  await waitFor(async () => !(await state()).slots.find(s => s.slot === 1)?.src, '最后一条播完', 12_000)
})
const log = await fs.readFile(path.join(profile, 'logs', 'main.log'), 'utf8').catch(() => '')
await check('main.log 无异常 / 警告', async () => { const bad = log.split('\n').filter(l => /\[(uncaughtException|unhandledRejection|render-process-gone|page-error|warning)\]/.test(l)); assert.equal(bad.length, 0, bad.join(' | ').slice(0, 300)) })
try { await app.evaluate(({ app }) => app.quit()) } catch { /* */ }
await sleep(1500)
const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS  截图在 ${outputDir}`)
process.exit(bad ? 1 : 0)
