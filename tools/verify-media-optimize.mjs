// 素材自动瘦身验证（隔离 userData、隐藏窗口）：
//   1. 启动记 [media] 素材瘦身已启用 + ffmpeg 路径
//   2. 4K 视频第一次播：先播原片（页面 currentSrc 是原文件），同时后台压制；等到 [media] 已瘦身 …，缓存目录出现 <key>.mp4，分辨率 1280x720
//   3. 同一视频第二次播：页面 currentSrc 指向 media-cache 副本；greenScreenState 里记的仍是原路径（时间盲盒 / 状态对比不受影响）
//   4. 360p 视频：标记跳过，不产生副本
//   5. 内存对比：同一窗口循环播 4K 原片 vs 瘦身副本 20 秒，页面进程私有内存
//   6. 关掉瘦身（mediaOptimize=false）后再播 4K：用原片
// 用法：node tools/verify-media-optimize.mjs   （先 npm run build；需要 ffmpeg/ffmpeg.exe 或 PATH 里的 ffmpeg 生成素材）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'media-optimize')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const run = promisify(execFile)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
async function check(name, fn) { try { const d = await fn(); results.push(true); console.log(`PASS ${name}${typeof d === 'string' && d ? '  ' + d : ''}`) } catch (e) { results.push(false); console.log(`FAIL ${name}  ${e?.message || e}`) } }
async function waitFor(fn, label, timeout = 15_000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await fn()) return } catch { /* 再等 */ } await sleep(300) } throw new Error('等超时：' + label) }
const FFMPEG = await fs.access(path.join(root, 'ffmpeg', 'ffmpeg.exe')).then(() => path.join(root, 'ffmpeg', 'ffmpeg.exe'), () => 'ffmpeg')
async function dims(file) { const { stderr } = await run(FFMPEG, ['-hide_banner', '-i', file], { windowsHide: true }).catch(e => e); const m = /Video:[^\n]*?\s(\d{2,5})x(\d{2,5})/.exec(stderr || ''); return m ? `${m[1]}x${m[2]}` : '?' }

await fs.mkdir(outputDir, { recursive: true })
const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const log = path.join(profile, 'logs', 'main.log')
const big = path.join(profile, 'big4k.mp4'), small = path.join(profile, 'small360.mp4')
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:d=4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', big], { windowsHide: true })
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', small], { windowsHide: true })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
await page.evaluate(async () => { await window.api.register('media_user', 'Fixture123!', '瘦身'); await window.api.login('media_user', 'Fixture123!'); await window.api.saveSettings({ guideSeen: true, autoLogin: false }); localStorage.setItem('zl-guide-seen', '1') })
const api = (fn, arg) => page.evaluate(fn, arg)
const readLog = () => fs.readFile(log, 'utf8').catch(() => '')
const pageSrc = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === '绿幕1'); return w ? w.webContents.executeJavaScript('(document.getElementById("v")||{}).currentSrc||""') : '' })
const pagePriv = () => app.evaluate(({ app, BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === '绿幕1'); const pid = w?.webContents.getOSProcessId(); const m = app.getAppMetrics().find(x => x.pid === pid); return Math.round((m?.memory?.privateBytes || 0) / 1024) })

await check('1. 启动：素材瘦身已启用，找到 ffmpeg', async () => { await waitFor(async () => /\[media\] 素材瘦身已启用/.test(await readLog()), 'media 行'); const m = (await readLog()).match(/\[media\] [^\n]*/)[0]; assert.ok(!/未找到/.test(m), m); return m.slice(8, 100) })
await api(() => window.api.greenScreenClose()); await sleep(200)
assert.equal((await api(() => window.api.greenScreenOpen('', 'video', '', 1))).ok, true); await sleep(1500)

let cacheFile = ''
await check('2. 4K 第一次播：先播原片，后台压出 720p 副本', async () => {
  const r = await api((v) => window.api.greenScreenOpen(v, 'video', '', 1, { loop: true }), big); assert.equal(r.ok, true, r.error)
  await waitFor(async () => /big4k\.mp4/.test(await pageSrc()), '原片开播')
  const src1 = await pageSrc(); assert.ok(!/media-cache/.test(src1), '第一次不该已经是副本：' + src1)
  await waitFor(async () => /\[media\] 已瘦身 big4k\.mp4/.test(await readLog()), '瘦身完成', 120_000)
  const files = (await fs.readdir(path.join(profile, 'media-cache'))).filter(f => f.endsWith('.mp4'))
  assert.equal(files.length, 1, files.join(','))
  cacheFile = path.join(profile, 'media-cache', files[0])
  const d = await dims(cacheFile); assert.equal(d, '1280x720', d)
  const line = (await readLog()).match(/\[media\] 已瘦身 [^\n]*/)[0]
  return line.slice(8, 120)
})
await check('3. 同一视频第二次播：页面用副本，状态里仍是原路径', async () => {
  await api(() => window.api.greenScreenOpen('', 'video', '', 1)); await sleep(500)
  const r = await api((v) => window.api.greenScreenOpen(v, 'video', '', 1, { loop: true }), big); assert.equal(r.ok, true, r.error)
  await waitFor(async () => /media-cache/.test(await pageSrc()), '副本开播')
  const st = await api(() => window.api.greenScreenState()); const slot = st.slots.find(s => s.slot === 1)
  assert.equal(slot.src, big, slot.src)
})
await check('4. 360p 视频：标记跳过、不产生副本', async () => {
  const r = await api((v) => window.api.greenScreenOpen(v, 'video', '', 1, { loop: true }), small); assert.equal(r.ok, true, r.error)
  await waitFor(async () => (await api(() => window.api.mediaOptimizeState())).skipped >= 1, '跳过标记', 30_000)
  const files = (await fs.readdir(path.join(profile, 'media-cache'))).filter(f => f.endsWith('.mp4'))
  assert.equal(files.length, 1)
  const s = await api(() => window.api.mediaOptimizeState()); return `done ${s.done} skipped ${s.skipped} cache ${s.cacheMb}MB`
})
await check('5. 内存对比：4K 原片 vs 720p 副本（同窗口循环播 20 秒，页面进程私有内存）', async () => {
  await api(() => window.api.saveSettings({ mediaOptimize: false }))
  await api((v) => window.api.greenScreenOpen(v, 'video', '', 1, { loop: true }), big); await sleep(20_000); const orig = await pagePriv()
  await api(() => window.api.saveSettings({ mediaOptimize: true }))
  await api((v) => window.api.greenScreenOpen(v, 'video', '', 1, { loop: true }), big); await sleep(20_000); const opt = await pagePriv()
  assert.ok(opt < orig * 0.5, `没省够：原片 ${orig}MB 副本 ${opt}MB`)
  return `原片 ${orig}MB → 副本 ${opt}MB（−${Math.round((1 - opt / orig) * 100)}%）`
})
await check('6. 关掉瘦身后再播 4K：用原片', async () => {
  await api(() => window.api.saveSettings({ mediaOptimize: false }))
  await api(() => window.api.greenScreenOpen('', 'video', '', 1)); await sleep(500)
  await api((v) => window.api.greenScreenOpen(v, 'video', '', 1, { loop: true }), big)
  await waitFor(async () => /big4k\.mp4/.test(await pageSrc()), '原片')
})
try { await app.evaluate(({ app }) => app.quit()) } catch { /* */ }
await sleep(1500)
const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS`)
process.exit(bad ? 1 : 0)
