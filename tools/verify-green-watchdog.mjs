// 绿幕视频看门狗验收：人为制造三种「停住」，看主进程能不能自己把队伍疏通
//   ① playbackRate=0（推两下也没用）→ 6 秒后撤掉；② pause（推一下就醒）→ 正常播完；③ 跳到末尾却没 ended 事件 → 2 秒后撤掉
// 用法：node tools/verify-green-watchdog.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'green-watchdog')
const run = promisify(execFile)
await fs.mkdir(outputDir, { recursive: true })
const userDataDir = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const video = path.join(userDataDir, '看门狗.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=15:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', video], { windowsHide: true })
const entry = await writeHiddenElectronBootstrap(root, userDataDir)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
const page = await app.firstWindow()
const api = (fn, arg) => page.evaluate(fn, arg)
const checks = []
const pass = (name) => { checks.push(name); console.log('PASS ' + name) }
async function greenPage() {
  for (let i = 0; i < 100; i++) {
    for (const w of app.windows()) { try { if ((await w.evaluate(() => location.href)).includes('green-1.html') && await w.evaluate(() => document.querySelector('video')?.currentTime > 0.2)) return w } catch {} }
    await page.waitForTimeout(50)
  }
  throw new Error('绿幕 1 视频没播起来')
}
async function until(fn, message, timeout = 15_000) { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn(); if (v) return v; await page.waitForTimeout(100) } throw new Error(message) }
const state = () => api(() => window.api.greenScreenState())
try {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  assert.equal((await api(() => window.api.greenScreenOpen('', 'video', '', 1))).ok, true)
  // ① 冻住（playbackRate=0）：推两下也没用 → 6 秒左右撤掉，排队的接上
  // 页面接口一律是「顶掉」，排队模型要走动作命令（origin=command）
  const play = () => api((v) => window.api.entertainmentCommand('video-play', v), video)
  assert.equal((await play()).ok, true)
  assert.equal((await play()).ok, true)
  assert.equal((await state()).queued, 1, '第二条该排队')
  let w = await greenPage(); await w.evaluate(() => { const v = document.querySelector('video'); v.playbackRate = 0 })
  const t0 = Date.now()
  await until(async () => (await state()).rescued >= 1, '冻住的视频没被撤掉')
  const spent = Date.now() - t0
  const s1 = await state()
  assert.ok(s1.nudged >= 2, `撤掉前该推过两下：${JSON.stringify(s1)}`)
  assert.ok(spent >= 5000 && spent <= 12_000, `撤掉时机不对：${spent}ms`)
  pass(`冻住的视频推两下无效后 ${Math.round(spent / 1000)} 秒撤掉，排队的接上`)
  await until(async () => (await state()).slots[0].src && (await state()).queued === 0, '排队的第二条没接上')
  // ② 暂停：推一下就醒，正常播完（rescued 不变）
  w = await greenPage(); await w.evaluate(() => document.querySelector('video').pause())
  await until(async () => (await state()).nudged >= 3, '暂停的视频没被推')
  await until(async () => !(await state()).slots[0].src, '推醒后没正常播完', 12_000)
  const s2 = await state()
  assert.equal(s2.rescued, 1, `暂停的视频不该被撤掉：${JSON.stringify(s2)}`)
  pass('暂停的视频推一下就醒，正常播完回绿底')
  // ③ 跳到末尾但没有 ended 事件（页面先把 ended 监听拆掉）→ 看门狗 2 秒后撤掉
  assert.equal((await play()).ok, true)
  w = await greenPage()
  // 把页面往主进程报「播完」的通道堵死（标题写不进去），再跳到末尾：ended 事件到了但主进程收不到
  await w.evaluate(() => { Object.defineProperty(document, 'title', { configurable: true, set() {}, get() { return 'blocked' } }); const v = document.querySelector('video'); v.currentTime = v.duration })
  const t1 = Date.now()
  await until(async () => (await state()).rescued >= 2, '跳到末尾的视频没被撤掉', 10_000)
  pass(`到末尾却没报播完的视频 ${((Date.now() - t1) / 1000).toFixed(1)} 秒后撤掉`)
  console.log(`SUMMARY ${checks.length}/3 PASS`)
} finally { await app.close().catch(() => {}) }
