// 转盘奖品视频「播完」信号不丢：视频很短、后面还有带延迟的附加动作时，「播完了」会在附加动作跑完之前到——
// 以前那时候还没人登记等待，信号丢了，抽奖流程干等 5 分钟超时，整条队列卡住。现在先登记再播，下一轮几秒内就开。
// 顺带验：附加动作里选「触发九宫格」能真的联动（以前一律回「不支持的中奖动作」）。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output', 'playwright', 'lottery-stage-race')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as lottery from ${JSON.stringify(path.join(root, 'src/main/lottery-widget.ts'))}
export * as ent from ${JSON.stringify(path.join(root, 'src/main/entertainment.ts'))}
export * as green from ${JSON.stringify(path.join(root, 'src/main/green-screen.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.setAppPath(${JSON.stringify(root)});
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{ const qa=require('./qa.cjs'); global.qa=qa;
  // 真实链路：奖项动作命令 → entertainmentCommand（视频没指定窗口时被转盘接管）
  qa.lottery.setLotteryActionHandler(async (item) => {
    if (item.action !== 'command') return { ok: true };
    const param = String(item.actionParam || ''); const cut = param.indexOf('|');
    const cmd = cut < 0 ? param : param.slice(0, cut); const rest = cut < 0 ? undefined : param.slice(cut + 1);
    return qa.ent.entertainmentCommand(cmd, rest);
  });
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)
await fs.mkdir(path.join(isolated, 'data'), { recursive: true })
await fs.writeFile(path.join(isolated, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, outputCaptureMode: 'green' }))
// 0.6 秒的短视频：播完的信号一定早于 2.5 秒后才跑的附加动作
const shortVideo = path.join(isolated, 'short.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xff2d55:s=160x90:r=15', '-t', '0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', shortVideo], { windowsHide: true })

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (ns, fn, args = []) => app.evaluate((_, { ns, fn, args }) => global.qa[ns][fn](...args), { ns, fn, args })
const draw = async (kind) => (await call('lottery', 'lotteryState')).draws?.[kind]
const ITEMS = ['大礼物', '再来一次', '谢谢参与', '盲盒'].map((name, i) => ({ name, color: i % 2 ? '#8d3b58' : '#f2e3e8' }))

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // 每个奖项：主动作播 0.6 秒的视频（被转盘接管），附加动作 2.5 秒后再跑一个命令
  const items = ITEMS.map((item) => ({ ...item, action: 'command', actionParam: 'video-play|' + shortVideo, actions: [{ action: 'command', actionParam: 'countdown-clear', delayMs: 2500 }] }))
  check('写入转盘配置（短视频 + 延迟附加动作）', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, stageVideo: true, sound: { mode: 'off', volume: 0 } }, items])).ok)
  check('打开幸运转盘', (await call('lottery', 'openWheelWindow', [items])).ok)
  await sleep(2500)
  const first = await call('lottery', 'lotterySpin', ['wheel'])
  const second = await call('lottery', 'lotterySpin', ['wheel'])
  check('连点两次：第二次排队', first.ok && second.ok && second.queued === 1, { first, second })
  const firstId = (await draw('wheel'))?.id
  // 第一轮：4.2 秒转 + 0.6 秒视频 + 2.5 秒附加动作 ≈ 7.5 秒；第二轮必须在 15 秒内开转（卡住的话要等 300 秒）
  const started = Date.now()
  let next
  while (Date.now() - started < 15_000) {
    const now = await draw('wheel')
    if (now && now.id !== firstId && now.phase === 'started') { next = now; break }
    await sleep(200)
  }
  check('短视频播完信号没丢：第二轮几秒内就开转，不用等 5 分钟超时', !!next, { waitedMs: Date.now() - started, last: await draw('wheel') })
  check('视频没有另开绿幕窗口（被转盘接管）', !(await call('green', 'greenScreenState')).open)

  // 附加动作「触发九宫格」：以前走动作命令一律回「不支持的中奖动作」
  await sleep(9000)
  const nineItems = Array.from({ length: 8 }, (_, i) => ({ name: `格${i + 1}`, color: '#446688' }))
  check('打开九宫格', (await call('lottery', 'configureLottery', ['nine', { autoSpin: false, triggerGift: '', idleHide: false, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, nineItems])).ok && (await call('lottery', 'openNineGridWindow', [nineItems])).ok)
  await sleep(2000)
  const chained = ITEMS.map((item) => ({ ...item, action: 'none', actions: [{ action: 'nine-spin', actionParam: '', delayMs: 0 }] }))
  check('转盘奖项的附加动作 = 触发九宫格', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, stageVideo: true, sound: { mode: 'off', volume: 0 } }, chained])).ok)
  const before = (await draw('nine'))?.id
  check('转盘转起来', (await call('lottery', 'lotterySpin', ['wheel'])).ok)
  let nine
  const t0 = Date.now()
  while (Date.now() - t0 < 12_000) {
    const now = await draw('nine')
    if (now && now.id !== before && (now.phase === 'started' || now.phase === 'result')) { nine = now; break }
    await sleep(200)
  }
  check('转盘抽完后九宫格跟着转了（附加动作联动生效）', !!nine, { waitedMs: Date.now() - t0, wheel: (await draw('wheel'))?.phase })
  const wheelNow = await draw('wheel')
  check('转盘这轮没有报「中奖动作执行失败」', wheelNow?.phase !== 'error', wheelNow?.phase)

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`lottery stage race regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
