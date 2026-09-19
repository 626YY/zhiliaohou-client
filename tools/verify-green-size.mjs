// 绿幕窗口尺寸 / 监听 / 停止视频 回归（真 Electron，独立 userData，不连直播）：
//   ① 绿幕页配的尺寸主进程记住：礼物/抽奖触发播放（不带尺寸）不再把窗口打回 640×360；关掉再开也按记住的建
//   ② 先开空窗口再让视频流进来，画面照样自动收边（以前空窗口那条路没挂尺寸监听）
//   ③ 「停止视频」只把规则/命令开出来的素材撤掉（窗口留着换回绿底）并清空排队，主播自己播的不动；页面点关闭清排队
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output/playwright/green-size')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as green from ${JSON.stringify(path.join(root, 'src/main/green-screen.ts'))}
export * as out from ${JSON.stringify(path.join(root, 'src/main/output-window.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.setAppPath(${JSON.stringify(root)});
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{ global.qa=require('./qa.cjs');
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)
await fs.mkdir(path.join(isolated, 'data'), { recursive: true })
await fs.writeFile(path.join(isolated, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, outputCaptureMode: 'green', videoDefaultSlot: 1 }))

// 竖屏素材（270×480 / 180×320）：窗口按画面比例收边后，尺寸有没有被打回一眼看得出（窗口尺寸别超过屏幕，会被系统夹住）
const portrait = path.join(isolated, '竖屏.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x223344:s=270x480:r=15', '-t', '20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', portrait], { windowsHide: true })
const small = path.join(isolated, '小竖屏.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x443322:s=180x320:r=15', '-t', '20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', small], { windowsHide: true })

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (ns, fn, args = []) => app.evaluate((_, { ns, fn, args }) => global.qa[ns][fn](...args), { ns, fn, args })
const sizeOf = (slot) => call('out', 'outputWindowSize', [`绿幕${slot}`])
const state = async () => { const s = await call('green', 'greenScreenState'); return { queued: s.queued, slots: s.slots.map(x => ({ slot: x.slot, open: x.open, src: path.basename(x.src || '') })) } }
const is = (size, w, h) => JSON.stringify(size) === JSON.stringify({ width: w, height: h })

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // ---- ① 绿幕页配的尺寸不被触发播放打回 ----
  check('绿幕页按 540×960 开 1 号空窗口', (await call('green', 'openGreenScreen', ['', 'video', '', 1, { width: 540, height: 960 }])).ok)
  await sleep(1200)
  check('窗口就是 540×960', is(await sizeOf(1), 540, 960), await sizeOf(1))
  check('礼物触发播放（不带尺寸）到 1 号', (await call('green', 'openGreenScreen', [portrait, 'video', '', 1, { loop: true }])).ok)
  await sleep(1800)
  check('播放后窗口仍是 540×960（不再打回 640×360）', is(await sizeOf(1), 540, 960), await sizeOf(1))
  await call('green', 'closeGreenScreen', [1])
  await sleep(800)
  check('主播关掉 1 号后窗口真没了', (await sizeOf(1)) === null)
  check('再开 1 号空窗口（不带尺寸）按记住的 540×960 建', (await call('green', 'openGreenScreen', ['', 'video', '', 1])).ok && await sleep(1200).then(async () => is(await sizeOf(1), 540, 960)), await sizeOf(1))
  check('主进程记住了尺寸（重启后也按它建窗口）', (await call('green', 'rememberGreenScreenSize', [2, 360, 640])) === true)
  const persisted = JSON.parse(await fs.readFile(path.join(isolated, 'data', 'green-screen-sizes.json'), 'utf8'))
  check('尺寸落盘', persisted['1']?.width === 540 && persisted['2']?.width === 360, persisted)
  check('从没开过的 2 号按记住的 360×640 建', (await call('green', 'openGreenScreen', ['', 'video', '', 2])).ok && await sleep(1200).then(async () => is(await sizeOf(2), 360, 640)), await sizeOf(2))

  // ---- ② 先开空窗口再让视频流进来：照样收边 ----
  check('3 号先按默认尺寸开一个空窗口', (await call('green', 'openGreenScreen', ['', 'video', '', 3])).ok)
  await sleep(1000)
  check('空窗口是默认 640×360', is(await sizeOf(3), 640, 360), await sizeOf(3))
  check('竖屏视频流进 3 号', (await call('green', 'openGreenScreen', [small, 'video', '', 3, { loop: true }])).ok)
  await sleep(1800)
  const fitted = await sizeOf(3)
  check('窗口收成画面比例（先空后播也收边）', fitted && fitted.height === 360 && fitted.width < 260, fitted)

  // ---- ③ 停止视频：只撤命令开的素材（窗口留着）+ 清排队；页面点关闭清排队 ----
  await call('green', 'closeGreenScreen', [])
  await sleep(800)
  for (const n of [1, 2, 3]) await call('green', 'openGreenScreen', ['', 'video', '', n])
  check('主播自己在 4 号播一条视频（绿幕页点播 = 直接开）', (await call('green', 'openGreenScreen', [small, 'video', '', 4, { loop: true, replace: true }])).ok)
  await sleep(800)
  for (let i = 0; i < 3; i++) check(`命令开的第 ${i + 1} 条（没指定窗口）落到开着的空闲窗口`, (await call('green', 'openGreenScreen', [portrait, 'video', '', 0, { loop: true, origin: 'command' }])).ok)
  await sleep(600)
  let now = await state()
  check('三条分别占了 1/2/3 号', now.slots.slice(0, 3).every(s => s.open && s.src), now)
  const fourth = await call('green', 'openGreenScreen', [portrait, 'video', '', 0, { loop: true, origin: 'command' }])
  check('第四条全忙进排队', fourth.ok && fourth.queued === true && (await state()).queued === 1, { fourth, state: await state() })
  const stopped = await call('green', 'stopCommandGreenScreens')
  await sleep(800)
  const after = await state()
  check('「停止视频」撤掉命令开的 3 条 + 清空排队；窗口留着（换回绿底）；主播自己开的 4 号还在播', stopped.stopped === 3 && after.queued === 0 && after.slots.slice(0, 3).every(s => s.open && !s.src) && after.slots[3].open && !!after.slots[3].src, after)
  for (let i = 0; i < 3; i++) await call('green', 'openGreenScreen', [portrait, 'video', '', 0, { loop: true, origin: 'command' }])
  await sleep(600)
  await call('green', 'openGreenScreen', [portrait, 'video', '', 0, { loop: true, origin: 'command' }])
  check('排队里有 1 条', (await state()).queued === 1, await state())
  await call('green', 'closeGreenScreen', [1, { clearQueue: true }])
  await sleep(600)
  now = await state()
  check('页面点关闭 1 号：窗口没了、排队清空，不会 50 毫秒后又冒出来', now.queued === 0 && now.slots[0].open === false, now)

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`green size regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
