// 视频排队回归（用户 2026-09-10 定版语义）：
//   · 只在开着的绿幕窗口里排：一个都没开 → 这条不播、明说；没开的窗口绝不播；
//   · 每项指定的窗口是最优先窗口，没指定的先去设置里的「默认播放窗口」；
//   · 每项一个「本窗口忙时去别的窗口」开关（默认开）：开着忙了去别的开着的空闲窗口，关着只在自己窗口排；
//   · 视频播完窗口留着换回绿底（它是主播开的采集来源），排队的接上；主播关窗口才真没了；
//   · replace=true 是「直接顶掉」的老语义（时间盲盒/进场/绿幕页自己点播）。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output/playwright/video-pool')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as green from ${JSON.stringify(path.join(root, 'src/main/green-screen.ts'))}
export * as settings from ${JSON.stringify(path.join(root, 'src/main/settings.ts'))}
export * as out from ${JSON.stringify(path.join(root, 'src/main/output-window.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.setAppPath(${JSON.stringify(root)});
app.whenReady().then(async()=>{ global.qa=require('./qa.cjs');
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)
await fs.mkdir(path.join(isolated, 'data'), { recursive: true })
await fs.writeFile(path.join(isolated, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, videoDefaultSlot: 1 }))

const video = path.join(isolated, '素材.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=320x180:r=15', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video], { windowsHide: true })

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (fn, args = []) => app.evaluate((_, { fn, args }) => global.qa.green[fn](...args), { fn, args })
const setSetting = (patch) => app.evaluate((_, patch) => global.qa.settings.saveSettings(patch), patch)
const slots = async () => { const s = await call('greenScreenState'); return Object.assign(s.slots.map(x => ({ slot: x.slot, open: x.open, text: x.text })), { queued: s.queued }) }
const waitFor = async (pred) => { for (let i = 0; i < 60; i++) { const s = await slots(); if (pred(s)) return s; await sleep(200) } return slots() }
const exists = (title) => app.evaluate((_, title) => global.qa.out.captureWindowExists(title), title)

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // ---- 一个窗口都没开：不播、明说 ----
  const none = await call('openGreenScreen', [video, 'video', '第零条', 0, { loop: true, origin: 'command' }])
  check('一个绿幕窗口都没开时，视频不播并明说原因（不会凭空开窗口）', none.ok === false && /没有打开的绿幕窗口/.test(none.error || '') && !(await exists('绿幕1')), none)

  // ---- 主播开了 1 号 → 没指定窗口的去默认窗口 1 号；忙了排队，不去没开的 2 号 ----
  await call('openGreenScreen', ['', 'video', '', 1])
  await sleep(800)
  const first = await call('openGreenScreen', [video, 'video', '第一条', 0, { loop: true, origin: 'command' }])
  await sleep(1400)
  const second = await call('openGreenScreen', [video, 'video', '第二条', 0, { loop: true, origin: 'command' }])
  await sleep(600)
  let now = await slots()
  check('主播开了 1 号后，没指定窗口的第一条播到默认窗口 1 号', first.ok === true && now[0].open && now[0].text === '第一条', { first, now })
  check('1 号忙、别的窗口没开：第二条排队，不分到没开的 2 号', second.ok === true && second.queued === true && !now[1].open && now.queued === 1, { second, now })

  // ---- 主播开了 2 号空窗口 → 排队的第二条立刻上 2 号 ----
  await call('openGreenScreen', ['', 'video', '', 2])
  const onTwo = await waitFor((s) => s[1].open && s[1].text === '第二条')
  check('主播开了 2 号空窗口后，排队的第二条立刻上到 2 号', onTwo[1].open === true && onTwo[1].text === '第二条', onTwo)

  // ---- 两个都忙 → 第三条排队；1 号播完（换回绿底、窗口留着）→ 第三条接上 1 号 ----
  const third = await call('openGreenScreen', [video, 'video', '第三条', 0, { loop: true, origin: 'command' }])
  await sleep(800)
  now = await slots()
  check('两个都忙时第三条排队（3/4 号没开不算数）', third.ok === true && third.queued === true && !now[2].open && !now[3].open, { third, now })
  await call('blankGreenScreen', [1])
  const freed = await waitFor((s) => s[0].open && s[0].text === '第三条')
  check('1 号播完后窗口留着（不消失），排队的第三条立刻接上 1 号', freed[0].open === true && freed[0].text === '第三条' && (await exists('绿幕1')), freed)

  // ---- 指定窗口 = 最优先窗口；开着「去别的窗口」时它没开/忙了就去别的开着的窗口 ----
  const explicit = await call('openGreenScreen', [video, 'video', '指定三号', 3, { loop: true, origin: 'command' }])
  await sleep(600)
  now = await slots()
  check('指定了没开的 3 号（允许去别的窗口）：1/2 都忙就先排队', explicit.ok === true && explicit.queued === true && !now[2].open, { explicit, now })
  await call('blankGreenScreen', [2])
  const spilled = await waitFor((s) => s[1].text === '指定三号')
  check('2 号空出来后，指定 3 号的素材去了开着的 2 号（3 号没开）', spilled[1].open && spilled[1].text === '指定三号', spilled)

  // ---- 「只在自己窗口」：3 号没开就不播；开了就只在 3 号排，别的窗口空出来也不去 ----
  const fixedNone = await call('openGreenScreen', [video, 'video', '固定三号', 3, { loop: true, overflow: false, origin: 'command' }])
  check('只在自己窗口 + 3 号没开：不播、明说', fixedNone.ok === false && /3 号窗口没打开/.test(fixedNone.error || ''), fixedNone)
  await call('openGreenScreen', ['', 'video', '', 3])
  await sleep(600)
  const fixedA = await call('openGreenScreen', [video, 'video', '固定三号A', 3, { loop: true, overflow: false, origin: 'command' }])
  await sleep(1200)
  const fixedB = await call('openGreenScreen', [video, 'video', '固定三号B', 3, { loop: true, overflow: false, origin: 'command' }])
  await sleep(600)
  now = await slots()
  check('3 号开了：固定 3 号的 A 上 3 号，B 排队', fixedA.ok && !fixedA.queued && now[2].text === '固定三号A' && fixedB.queued === true, { fixedA, fixedB, now })
  await call('blankGreenScreen', [1])
  await sleep(900)
  now = await slots()
  check('1 号空出来，固定 3 号的 B 不去 1 号，继续等 3 号', now[0].text === '' && now.queued >= 1, now)
  await call('blankGreenScreen', [3])
  const landed = await waitFor((s) => s[2].text === '固定三号B')
  check('3 号空出来后 B 接上 3 号', landed[2].text === '固定三号B', landed)

  // ---- 默认窗口改 2 号后没指定窗口的先去 2 号；主播关掉窗口就真没了，不再算开着 ----
  await call('blankGreenScreen', [2])
  await setSetting({ videoDefaultSlot: 2 })
  const prefer = await call('openGreenScreen', [video, 'video', '默认优先', 0, { loop: true, origin: 'command' }])
  await sleep(1200)
  now = await slots()
  check('默认窗口改成 2 号后，新素材优先去 2 号（1 号空着也不去）', prefer.ok === true && !prefer.queued && now[1].text === '默认优先' && now[0].text === '', { prefer, now })
  await call('closeGreenScreen', [2, { clearQueue: true }])
  await sleep(800)
  check('主播关掉 2 号：窗口真没了（开哪个才有哪个）', !(await exists('绿幕2')) && !(await slots())[1].open)
  const spill = await call('openGreenScreen', [video, 'video', '默认没开', 0, { loop: true, origin: 'command' }])
  await sleep(1200)
  now = await slots()
  check('默认窗口（2 号）没开时，去别的开着的空闲窗口（1 号）', spill.ok === true && now[0].text === '默认没开', { spill, now })

  // ---- replace：直接顶掉（盲盒 / 进场 / 绿幕页自己点播的老语义） ----
  const replaced = await call('openGreenScreen', [video, 'video', '顶掉', 1, { loop: true, replace: true }])
  await sleep(1200)
  now = await slots()
  check('replace=true 时直接顶掉 1 号正在播的', replaced.ok === true && !replaced.queued && now[0].text === '顶掉', { replaced, now })

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`video pool regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
