// 时间插件两条新功能回归：
//   ① 送礼滚动条：开着时挂件下面多一条，谁（带头像）送了什么、抽到多少时间；关掉就收回去
//   ② 盲盒视频播到哪个窗口（以前写死 4 号绿幕，主播没采那个窗口就以为「视频没播」）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output/playwright/time-ticker')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))

const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as time from ${JSON.stringify(path.join(root, 'src/main/time-widget.ts'))}
export * as green from ${JSON.stringify(path.join(root, 'src/main/green-screen.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })

const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.setAppPath(${JSON.stringify(root)});
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{ const qa=require('./qa.cjs'); global.qa=qa;
  qa.time.setTimeBlindBoxActionHandler(async()=>({ok:true}));
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)

const videoFile = path.join(isolated, '盲盒素材.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x224466:s=320x180:r=15', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', videoFile], { windowsHide: true })
// 头像夹具（1x1 红点 PNG）
const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value, details) => { assert.ok(value, name + (details ? ' | ' + JSON.stringify(details) : '')); results.push(name); console.log('PASS ' + name + (details ? ' | ' + JSON.stringify(details) : '')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (ns, fn, args = []) => app.evaluate((_, { ns, fn, args }) => global.qa[ns][fn](...args), { ns, fn, args })
const timerWindow = () => app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '倒计时')
  if (!win) return null
  const state = await win.webContents.executeJavaScript(`(() => {
    const ticker = document.getElementById('ticker')
    const rows = ticker ? [...ticker.querySelectorAll('.tk')].map(row => ({
      text: row.textContent, hasAvatar: !!row.querySelector('img')
    })) : []
    return { height: innerHeight, hasTicker: !!ticker, rows }
  })()`)
  return { ...state, size: win.getSize() }
})

const baseCfg = {
  on: true, enable: true, title: '抽奖倒计时', initial: 600, theme: 'sunset', autoHide: false,
  giftTicker: true, boxVideoSlot: 4,
  startHotkey: { enabled: false, func: '无', key: '' }, endHotkey: { enabled: false, func: '无', key: '' },
  gifts: [{ name: '棒棒糖', mode: 'direct', op: '加减', seconds: 30 }]
}

let failure
try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // ---- ① 送礼滚动条 ----
  check('打开挂件（开滚动条）', (await call('time', 'openTimeWidget', [baseCfg])).ok)
  await sleep(2000)
  const opened = await timerWindow()
  check('开着滚动条时挂件下面有一条', opened?.hasTicker === true, opened)
  const heightWithTicker = opened.size[1]

  check('送一个礼物', (await call('time', 'handleTimeWidgetGift', ['棒棒糖', 1, '', '阿彪', 'test', avatar])).ok)
  await sleep(700)
  const after = await timerWindow()
  check('滚动条上出现这一条：昵称 + 时间变化 + 头像', after.rows.length === 1 && /阿彪/.test(after.rows[0].text) && /\+30秒/.test(after.rows[0].text) && after.rows[0].hasAvatar === true, after.rows)

  await call('time', 'handleTimeWidgetGift', ['棒棒糖', 2, '', '小明', 'test', ''])
  await sleep(700)
  const two = await timerWindow()
  check('再来一条礼物追加在后面（昵称不同）', two.rows.length === 2 && /小明/.test(two.rows[1].text) && /\+1分/.test(two.rows[1].text), two.rows)

  // ---- 时间按人话显示：满 60 秒进分、满 60 分进小时 ----
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, gifts: [{ name: '棒棒糖', mode: 'direct', op: '加减', seconds: 600 }] }])
  await sleep(900)
  await call('time', 'handleTimeWidgetGift', ['棒棒糖', 1, '', '大老板', 'test', ''])
  await sleep(800)
  const minute = await timerWindow()
  check('加 600 秒显示成「+10分」而不是「+600 秒」', minute.rows.at(-1) && /\+10分/.test(minute.rows.at(-1).text), minute.rows.at(-1))
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, gifts: [{ name: '棒棒糖', mode: 'direct', op: '加减', seconds: 3900 }] }])
  await sleep(900)
  await call('time', 'handleTimeWidgetGift', ['棒棒糖', 1, '', '大老板', 'test', ''])
  await sleep(800)
  const hour = await timerWindow()
  check('加 3900 秒显示成「+1小时5分」', hour.rows.at(-1) && /\+1小时5分/.test(hour.rows.at(-1).text), hour.rows.at(-1))

  // ---- 滚动条平时藏着，送礼才冒出来，停几秒自动收回 ----
  const tickerVisible = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '倒计时')
    return win ? win.webContents.executeJavaScript(`(() => { const t = document.getElementById('ticker'); return t ? { on: t.classList.contains('on'), opacity: getComputedStyle(t).opacity, height: innerHeight } : null })()`) : null
  })
  check('送礼后滚动条亮出来', (await tickerVisible())?.on === true, await tickerVisible())
  let hid = null
  for (let i = 0; i < 60; i++) {
    hid = await tickerVisible()
    if (hid && hid.on === false) break
    await sleep(300)
  }
  check('停几秒没有新记录自动收回去（窗口高度不变，倒计时不跳）', hid?.on === false && hid?.height === 180, hid)
  await sleep(600)
  check('淡出动画结束后完全透明', Number((await tickerVisible())?.opacity) < 0.1, await tickerVisible())
  await call('time', 'handleTimeWidgetGift', ['棒棒糖', 1, '', '又来了', 'test', ''])
  await sleep(800)
  check('再来礼物又亮出来', (await tickerVisible())?.on === true, await tickerVisible())

  // ---- 关掉开关：滚动条收回去，窗口同步变矮 ----
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, giftTicker: false }])
  await sleep(1200)
  const off = await timerWindow()
  check('关掉开关后滚动条消失', off?.hasTicker === false, off)
  check('窗口跟着变矮（收回去那一条的高度）', off.size[1] < heightWithTicker, { before: heightWithTicker, after: off.size[1] })

  // ---- ② 盲盒视频播到指定窗口 ----
  const event = { id: 'box-1', name: '盲盒奖', op: 'add', value: 60, value2: null, video: videoFile, videoSeconds: 0.4, sound: '', soundVolume: 0, action: 'none', actionParam: '' }
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, giftTicker: false, boxVideoSlot: 2, blindBoxEvents: [event], gifts: [{ name: '棒棒糖', mode: 'blindbox', blindBoxEventIds: ['box-1'], op: '加减', seconds: 0 }] }])
  await sleep(800)
  // 开哪个才有哪个：盲盒视频只播到主播开着的绿幕窗口，先替主播开 2 号空窗口
  await call('green', 'openGreenScreen', ['', 'video', '', 2])
  await sleep(500)
  const boxReply = await call('time', 'timeWidgetTestEvent', ['box-1'])
  check('抽盲盒（事件里带视频）', boxReply.ok === true, boxReply)
  let slotState
  for (let i = 0; i < 100; i++) {
    slotState = await call('green', 'greenScreenState')
    if (slotState.slots.find(s => s.slot === 2)?.open) break
    await sleep(100)
  }
  const slot2 = slotState.slots.find(s => s.slot === 2)
  const slot4 = slotState.slots.find(s => s.slot === 4)
  check('盲盒视频播到了设置的 2 号绿幕（不是写死的 4 号）', slot2?.open === true && slot4?.open === false, slotState.slots.map(s => ({ slot: s.slot, open: s.open })))

  // ---- 盲盒事件用长视频、播放秒数留空（0）时：播完就结束，不能一直循环、时间不能记成 0 ----
  const longVideo = path.join(isolated, '长视频.mp4')
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x224466:s=320x180:r=15', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', longVideo], { windowsHide: true })
  const longEvent = { id: 'box-2', name: '长视频奖', op: 'add', value: 600, value2: null, video: longVideo, videoSeconds: 0, sound: '', soundVolume: 0, action: 'none', actionParam: '' }
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, giftTicker: false, boxVideoSlot: 1, blindBoxEvents: [longEvent], gifts: [{ name: '棒棒糖', mode: 'blindbox', blindBoxEventIds: ['box-2'], op: '加减', seconds: 0 }] }])
  await sleep(800)
  await call('green', 'openGreenScreen', ['', 'video', '', 1])
  await sleep(500)
  const before = (await call('time', 'timeWidgetState')).remaining
  await call('time', 'timeWidgetTestEvent', ['box-2'])
  let boxState
  for (let i = 0; i < 60; i++) {
    boxState = await call('time', 'timeWidgetState')
    if (boxState.lastResult?.phase === 'completed' || boxState.lastResult?.phase === 'error') break
    await sleep(500)
  }
  const logRows = await call('time', 'timeWidgetLog')
  check('长视频盲盒正常完成（不是一直循环 / 不报「已被其他素材替换」）', boxState.lastResult?.phase === 'completed' && !boxState.lastResult?.error, { phase: boxState.lastResult?.phase, error: boxState.lastResult?.error })
  check('这一轮的时间变化按事件数值记账（不是 0）', logRows[0]?.delta === 600, logRows[0])
  // 播完素材撤掉、窗口留着（它是主播开的采集来源，直播伴侣的来源不能跟着没了）
  const doneSlot = (await call('green', 'greenScreenState')).slots.find(s => s.slot === 1)
  check('播完把素材撤掉换回绿底，绿幕窗口本身留着', doneSlot?.open === true && doneSlot?.src === '', doneSlot)

  // ---- ③ 紧凑送礼记录：无标题或汇总面板，单行明细随倒计时换色 ----
  // 先把倒计时切回一套确定的皮肤/配色，再开记录窗口对拍
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, giftTicker: false, theme: 'sunset', titleColor: '#ffb58f', giftNameColor: '#fff1e7', addColor: '#ffb58f', subColor: '#dfb8be', cellBg: '#332031', cellBorder: '#a3747e', logTitle: '今晚抽时间', logRows: 10 }])
  await sleep(800)
  check('打开抽时间记录窗口', (await call('time', 'timeLogOpen')).ok === true)
  await sleep(1800)
  // 留两张截图当证据（记录窗口 / 倒计时），肉眼核对是不是一家人
  const shoot = async (title, file) => {
    const png = await app.evaluate(async ({ BrowserWindow }, title) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
      return win ? (await win.webContents.capturePage()).toPNG().toString('base64') : ''
    }, title)
    if (png) await fs.writeFile(path.join(output, file), Buffer.from(png, 'base64'))
  }
  await shoot('抽时间记录', 'log-window-sunset.png')
  await shoot('倒计时', 'timer-sunset.png')
  const readWidget = (title) => app.evaluate(async ({ BrowserWindow }, title) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
    if (!win) return null
    const state = await win.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('#log-panel .gift-cell:not(.lg-empty)')].map(r => ({ text: r.textContent, hasAvatar: !!r.querySelector('.gift-icon img') }))
      const head = document.getElementById('head'), frame = document.getElementById('frame'), name = document.querySelector('.gift-name')
      return { rows, hasHead: !!head, frameSrc: frame ? frame.getAttribute('src') : '', theme: document.body.dataset.theme,
        title: document.getElementById('title')?.textContent || '', summary: document.getElementById('time')?.textContent || '',
        panelWidth: document.getElementById('panel')?.getBoundingClientRect().width, nameColor: name ? getComputedStyle(name).color : '',
        empty: !!document.querySelector('.lg-empty') }
    })()`)
    return { ...state, size: win.getSize() }
  }, title)
  const logWin = await readWidget('抽时间记录')
  const timerNow = await readWidget('倒计时')
  check('记录窗口不再显示装饰面板', logWin !== null && logWin.hasHead === false && !logWin.frameSrc, { theme: logWin?.theme, hasHead: logWin?.hasHead })
  check('记录窗口和倒计时一样宽（同一套面板宽度 × 缩放）', logWin.size[0] === timerNow.size[0], { log: logWin.size, timer: timerNow.size })
  check('旧标题设置不再占用画面', logWin.title === '', logWin.title)
  check('窗口只有记录行，没有今日汇总和额外留白', logWin.summary === '' && logWin.size[1] === logWin.rows.length * 28, { summary: logWin.summary, size: logWin.size, rows: logWin.rows.length })
  check('记录窗口列出刚才那几条（带昵称、礼物、时间变化）', logWin.rows.length >= 2 && logWin.rows.some(r => /阿彪/.test(r.text) && /\+30秒/.test(r.text)), logWin?.rows)
  check('记录条数不超过设置的条数', logWin.rows.length <= 10, logWin.rows.length)
  check('记录窗口的条目带头像', logWin.rows.some(r => r.hasAvatar === true))
  check('昵称用的是礼物名颜色（跟礼物栏同一套配色）', logWin.nameColor === 'rgb(255, 241, 231)', logWin.nameColor)
  // 只显示最近几条：条数改成 3，窗口跟着变矮
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, giftTicker: false, theme: 'sunset', logTitle: '今晚抽时间', logRows: 3 }])
  await sleep(900)
  const logThree = await readWidget('抽时间记录')
  check('条数改成 3 后只剩最近 3 条、窗口变矮', logThree.rows.length === 3 && logThree.size[1] < logWin.size[1], { rows: logThree.rows.length, before: logWin.size, after: logThree.size })
  // 换皮肤：两个窗口一起变
  await call('time', 'timeWidgetUpdate', [{ ...baseCfg, giftTicker: false, theme: 'arcade', logTitle: '今晚抽时间', logRows: 10 }])
  await sleep(900)
  await shoot('抽时间记录', 'log-window-arcade.png')
  await shoot('倒计时', 'timer-arcade.png')
  const logArcade = await readWidget('抽时间记录')
  const timerArcade = await readWidget('倒计时')
  check('倒计时换成像素街机后，记录跟随换肤且仍为紧凑列表', logArcade.theme === timerArcade.theme && logArcade.theme === 'arcade' && !logArcade.hasHead && !logArcade.frameSrc, { theme: logArcade.theme, hasHead: logArcade.hasHead })
  // 记录落盘：重开客户端今天的名单不丢
  await sleep(1200)
  const persisted = JSON.parse(await fs.readFile(path.join(isolated, 'data', 'time-gift-log.json'), 'utf8'))
  check('抽时间记录已落盘（重开客户端不丢）', Array.isArray(persisted) && persisted.some(r => r.sender === '阿彪' && r.delta === 30), persisted.length)
  check('关掉记录窗口', (await call('time', 'timeLogClose')).ok === true)
  await sleep(900)
  // 关掉的采集窗口会变成待机绿页（0.3.41 起「关掉挂件后留着采集来源」），所以判状态而不是判窗口在不在
  check('关掉后记录窗口状态是关的，窗口只剩待机页', (await call('time', 'timeLogState')).open === false
    && await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '抽时间记录')
      return !win || win.webContents.getURL().startsWith('data:text/html')
    }))

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`time ticker regression passed: ${results.length} checks`)
} catch (error) {
  failure = error
  console.error(error.stack || error)
} finally {
  await app.close().catch(() => {})
}
if (failure) throw failure
