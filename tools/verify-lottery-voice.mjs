// 抽奖「中奖语音」真机回归（九宫格 + 转盘）：
//   1. 语音真的在挂件窗口里出声 —— Windows 默认输出设备的会话峰值 > 0，不只是 muted=false；
//   2. 默认「语音播完再执行动作」—— 动作的触发时间必须晚于语音结束；
//   3. 关掉「播完再执行」时语音和动作并行；
//   4. 语音放完，输出峰值归零；
//   5. 出声的是挂件窗口，不是主界面。
// 隐藏窗口 + 独立 userData，不碰用户正在用的客户端。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output', 'playwright', 'lottery-voice')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))

const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as lottery from ${JSON.stringify(path.join(root, 'src/main/lottery-widget.ts'))}
export * as out from ${JSON.stringify(path.join(root, 'src/main/output-window.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })

const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.setAppPath(${JSON.stringify(root)});
// 没有用户手势也要能自动出声（产品里是礼物触发，同样没有点击）
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{ const qa=require('./qa.cjs'); global.qa=qa;
  // 记录中奖动作什么时候被调用，用来验证「语音播完才执行」
  global.actionCalls=[];
  qa.lottery.setLotteryActionHandler(async (item)=>{ global.actionCalls.push({at:Date.now(),action:item.action,param:String(item.actionParam||'')}); return {ok:true} });
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)

// 3 秒 660Hz 纯音，音量不低也不炸 —— 留够时间量音量（PowerShell 起进程有时要两三秒）
const voiceFile = path.join(isolated, '中奖语音.wav')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '4.5', '-af', 'volume=0.6', '-c:a', 'pcm_s16le', '-y', voiceFile], { windowsHide: true })

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })

const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (ns, fn, args = []) => app.evaluate((_, { ns, fn, args }) => global.qa[ns][fn](...args), { ns, fn, args })
const ITEMS = Array.from({ length: 8 }, (_, i) => ({
  name: `奖项${i + 1}`, color: i % 2 ? '#8d3b58' : '#f2e3e8',
  voice: voiceFile, voiceWait: true, action: 'command', actionParam: 'count-add|5'
}))

const nineWindow = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '九宫格')
  return win ? { id: win.id, audible: win.webContents.isCurrentlyAudible() } : null
})
const nineState = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '九宫格')
  if (!win) return null
  return win.webContents.executeJavaScript(`(() => ({ playing: !!voiceAudio && !voiceAudio.paused, time: voiceAudio ? voiceAudio.currentTime : 0, src: voiceAudio ? voiceAudio.src : '', voiceFile: document.getElementById('prize')?.src || '' }))()`)
})
const audibleTitles = () => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().filter(w => w.webContents.isCurrentlyAudible()).map(w => w.getTitle()))
const actions = () => app.evaluate(() => global.actionCalls || [])
const resetActions = () => app.evaluate(() => { global.actionCalls = [] })
/** 等中奖动作被执行（不用固定 sleep，机器慢的时候也不会误判） */
async function waitActions(count, timeout = 15_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const list = await actions()
    if (list.length >= count) return list
    await sleep(100)
  }
  return actions()
}

async function measure(ms = 1200) {
  const pids = await app.evaluate(({ app }) => [process.pid, ...app.getAppMetrics().map(m => m.pid)].filter(Boolean))
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/measure-test-audio.ps1'), '-ProcessIds', [...new Set(pids)].join(','), '-Milliseconds', String(ms)], { windowsHide: true, timeout: 25_000 })
  return JSON.parse(stdout)
}
/** 等挂件窗口开始出声，返回开始时间；没等到就返回 0 */
async function waitAudible(timeout = 12_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const state = await nineWindow()
    if (state?.audible) return Date.now()
    await sleep(50)
  }
  return 0
}

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  check('配置九宫格：每个奖项都配中奖语音 + 动作', (await call('lottery', 'configureLottery', ['nine', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, ITEMS])).ok)
  // 语音字段必须真的存进配置（白名单重建漏字段就会静默丢掉，抽中永远不播）
  const saved = JSON.parse(await fs.readFile(path.join(isolated, 'lottery-config.json'), 'utf8'))
  check('语音路径和「播完再执行」都存进了配置', saved.nine?.items?.every(i => i.voice === voiceFile && i.voiceWait === true), saved.nine?.items?.[0])

  check('打开九宫格窗口', (await call('lottery', 'openNineGridWindow', [ITEMS])).ok)
  await sleep(2500)
  check('窗口开着时没有声音（空闲）', (await measure(700)).Peak === 0)

  // ---- 第一轮：默认等语音播完再执行动作 ----
  await resetActions()
  check('触发一轮抽奖', (await call('lottery', 'lotterySpin', ['nine'])).ok)
  const voiceStart = await waitAudible()
  check('抽中后挂件窗口真的出声了（Chromium 可听状态）', voiceStart > 0)
  const during = await nineState()
  check('出声的是配置的那段中奖语音，正在播', during?.playing === true && during?.src.startsWith('file://') && decodeURIComponent(during.src).endsWith('中奖语音.wav'), during)
  check('出声的只有九宫格挂件窗口（声音出在挂件里，直播伴侣才采得到）', JSON.stringify(await audibleTitles()) === JSON.stringify(['九宫格']), await audibleTitles())
  // ★判定要放在量音量之前：measure 要起 PowerShell 并现编译 C#，慢的时候三四秒才回来，
  //   放到后面会把「语音早就播完、动作已经跑了」当成失败（第一版就是这么偶发红的）
  check('语音播放中还没有执行中奖动作（默认等语音播完）', (await actions()).length === 0)
  const peak = await measure(1200)
  check('Windows 默认输出设备上测到真实音量峰值', peak.Sessions > 0 && peak.Peak > 0.0001, peak)
  const afterVoice = await waitActions(1)
  check('语音播完后才执行中奖动作', afterVoice.length === 1 && afterVoice[0].param === 'count-add|5', afterVoice)
  check('动作确实在语音之后（间隔 ≥ 3.5 秒，语音本身 4.5 秒）', afterVoice[0].at - voiceStart >= 3500, { gap: afterVoice[0].at - voiceStart })
  await sleep(1200)
  check('语音结束后输出峰值归零', (await measure(800)).Peak === 0)
  await sleep(1500)

  // ---- 第二轮：关掉「播完再执行」，语音和动作并行 ----
  const parallel = ITEMS.map(i => ({ ...i, voiceWait: false }))
  check('关掉「语音播完再执行动作」', (await call('lottery', 'configureLottery', ['nine', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, parallel])).ok)
  await sleep(600)
  await resetActions()
  check('再触发一轮', (await call('lottery', 'lotterySpin', ['nine'])).ok)
  const voiceStart2 = await waitAudible()
  check('第二轮语音照样出声', voiceStart2 > 0)
  const early = await waitActions(1, 4000)
  check('关掉等待后，语音还在播就已经执行动作', early.length === 1 && early[0].at - voiceStart2 < 900, { gap: early[0] ? early[0].at - voiceStart2 : -1 })
  await sleep(4000)

  // ---- 第三轮：转盘（lucky）也走同一套语音 ----
  const wheelItems = ITEMS.slice(0, 4)
  check('转盘配同一套语音', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, wheelItems])).ok)
  check('打开幸运转盘', (await call('lottery', 'openWheelWindow', [wheelItems])).ok)
  await sleep(2200)
  await resetActions()
  await call('lottery', 'lotterySpin', ['wheel'])
  const wheelUntil = Date.now() + 12_000
  let wheelAudible = false
  while (Date.now() < wheelUntil) {
    const state = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '幸运转盘')
      return win ? win.webContents.isCurrentlyAudible() : null
    })
    if (state) { wheelAudible = true; break }
    await sleep(50)
  }
  check('转盘窗口里的中奖语音也真的出声', wheelAudible)
  const wheelPeak = await measure(1000)
  check('转盘语音在 Windows 输出设备上同样测到峰值', wheelPeak.Peak > 0.0001, wheelPeak)
  check('转盘这一轮也执行了中奖动作', (await waitActions(1)).length === 1)

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`lottery voice regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
