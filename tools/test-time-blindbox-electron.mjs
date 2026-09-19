// 真 Electron 主进程+原生隐藏窗口；用户配置、游戏和系统输入完全隔离。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/time-blindbox')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
await build({ stdin: { contents: `export * from './src/main/time-widget'; export { openGreenScreen, greenScreenState, closeGreenScreen } from './src/main/green-screen'; export { openEffectsWindow, closeEffectsWindow, effectsFireChecked } from './src/main/effects-widget';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(profile, 'runtime.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
await fs.writeFile(path.join(profile, 'main.cjs'), `
const electron=require('electron'),{app,BrowserWindow:NativeWindow}=electron;
app.setPath('userData',__dirname);app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
global.qa={calls:[],events:[],constructors:[]};
for(const method of ['show','showInactive','focus','restore','maximize','moveTop'])NativeWindow.prototype[method]=function(){global.qa.calls.push({id:this.id,method})};
app.focus=()=>{};electron.dialog.showErrorBox=(title,message)=>process.stderr.write(title+': '+message+'\\n');
const HiddenWindow=new Proxy(NativeWindow,{construct(Target,args){const requested=args[0]||{},win=Reflect.construct(Target,[{...requested,show:false,focusable:false}],Target);global.qa.constructors.push({id:win.id,title:requested.title});for(const event of ['show','focus'])win.on(event,()=>global.qa.events.push(event));return win;}});
const Module=require('node:module'),original=Module._load,facade={...electron,BrowserWindow:HiddenWindow};
Module._load=function(request){return request==='electron'?facade:original.apply(this,arguments)};
app.whenReady().then(async()=>{global.qa.api=require('./runtime.cjs');global.qa.actions=[];
global.qa.api.setTimeBlindBoxActionHandler(async(event,current,checkOnly)=>{if(!current())return {ok:false,error:'cancelled'};if(event.actionParam==='reject')return {ok:false,error:'测试事件不可用'};if(checkOnly&&event.actionParam==='hang')return new Promise(resolve=>{global.qa.releaseHang=resolve});if(!checkOnly&&event.action==='effect')global.qa.actions.push({id:event.id,at:Date.now()});return {ok:true}});
const control=new HiddenWindow({title:'time-blindbox-test-control',webPreferences:{backgroundThrottling:false}});await control.loadURL('about:blank');});
`)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [path.join(profile, 'main.cjs')], cwd: root, env })
const checks = [], errors = [], evidence = { profile, limitations: ['Hidden native windows and renderer media only; not a Douyin capture test.', 'Optional game/effect executor is a test callback; no real game is contacted.'] }
const test = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
const call = (name, ...args) => app.evaluate((_, { name, args }) => global.qa.api[name](...args), { name, args })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(query, message, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await query(); if (value) return value; await sleep(35) } throw new Error(message) }
const state = () => call('timeWidgetState')
async function idle() { return until(async () => { const s = await state(); return !s.activeEvent && !s.queueLength && s.lastResult?.phase !== 'running' ? s : false }, 'queue did not settle') }
const event = (id, value = 3, extra = {}) => ({ id, name: id, op: 'multiply', value, action: 'none', ...extra })
async function reset(events, gifts = [{ name: '鲜花', mode: 'blindbox', blindBoxEventIds: events.map(e => e.id), op: '加减', seconds: 7 }], initial = 100) {
  await call('closeTimeWidget'); await idle(); await call('timeWidgetLogClear')
  // 每个场景独立建立「主播已打开默认采集窗口」前提，前一个场景可能已主动关窗。
  if (!(await call('greenScreenState')).slots[3].open) {
    const opened = await call('openGreenScreen', '', 'video', '', 4)
    assert.ok(opened.ok, opened.error)
  }
  const reply = await call('openTimeWidget', { initial, enable: true, clockSpeed: 60000, addGift: '', subGift: '', gifts, blindBoxEvents: events, autoHide: false, showNegative: false, startHotkey: { enabled: false }, endHotkey: { enabled: false } })
  assert.ok(reply.ok, reply.error)
  await until(() => app.windows().find(w => !w.isClosed() && w.url().endsWith('/time-widget.html')), 'time output missing')
  await app.windows().find(w => !w.isClosed() && w.url().endsWith('/time-widget.html')).waitForLoadState()
}
try {
  const control = await app.firstWindow()
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  const video = path.join(profile, '时间视频 # & 中文.webm')
  const bytes = await control.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90
    const ctx = canvas.getContext('2d'), stream = canvas.captureStream(20), chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    recorder.ondataavailable = event => chunks.push(event.data)
    const done = new Promise(resolve => { recorder.onstop = resolve })
    let frame = 0
    const draw = () => { ctx.fillStyle = 'lime'; ctx.fillRect(0, 0, 160, 90); ctx.fillStyle = 'orange'; ctx.fillRect((frame++ * 3) % 120, 25, 40, 40) }
    draw(); recorder.start(); const tick = setInterval(draw, 50)
    await new Promise(resolve => setTimeout(resolve, 1000)); clearInterval(tick); recorder.stop(); await done; stream.getTracks().forEach(t => t.stop())
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
  })
  await fs.writeFile(video, Buffer.from(bytes))
  const sound = path.join(profile, '时间音效 # & 中文.wav'), pcmLength = 6400
  const wav = Buffer.alloc(44 + pcmLength); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcmLength, 40)
  await fs.writeFile(sound, wav)
  const corrupt = path.join(profile, '损坏素材.webm'); await fs.writeFile(corrupt, 'not a video')
  test('all files and native windows use isolated profile', await app.evaluate(({ app }, expected) => app.getPath('userData') === expected, profile))

  await reset([event('×3')])
  assert.ok((await call('timeWidgetTestGift', '鲜花')).ok)
  const multiplied = await idle()
  test('gift routes to one library result and multiplies once', multiplied.remaining === 300 && multiplied.lastResult.eventName === '×3' && (await call('timeWidgetLog')).length === 1)
  test('unmatched gift returns real failure', !(await call('timeWidgetTestGift', '未绑定')).ok)
  await call('timeWidgetUpdate', { enable: false })
  test('disabled timer does not pretend gift test succeeded', !(await call('timeWidgetTestGift', '鲜花')).ok)

  await reset([event('×0', 0)])
  await call('timeWidgetTestEvent', '×0'); test('specified event test accepts zero multiplication', (await idle()).remaining === 0)
  await reset([event('小数', 1.5)])
  await call('timeWidgetTestEvent', '小数'); test('specified event test preserves decimal factor', (await idle()).remaining === 150)
  await reset([event('除零', 0, { op: 'divide' })])
  test('invalid event rejects before queue or time changes', !(await call('timeWidgetTestEvent', '除零')).ok && (await state()).remaining === 100)
  await reset([event('有效')], [{ name: '鲜花', mode: 'blindbox', blindBoxEventIds: [], op: '加减', seconds: 7 }])
  test('empty pool never falls back to legacy seconds', !(await call('timeWidgetTestGift', '鲜花')).ok && (await state()).remaining === 100)

  await reset([event('未开采集窗口', 2, { video })])
  await call('closeGreenScreen', 4)
  await call('timeWidgetTestEvent', '未开采集窗口')
  const noWindow = await idle()
  test('missing capture window stays closed while time settles with a clear video warning',
    noWindow.remaining === 200 && !((await call('greenScreenState')).slots[3].open) && /窗口没打开/.test(noWindow.lastResult.error || ''))

  // 2026-09-11 用户实测：「本窗口忙时去别的窗口」开着、指定的 4 号没开、只开着 1 号 → 盲盒视频要去 1 号播（以前写死指定窗口，直接不播）
  await reset([event('去别的窗口', 2, { video, videoSeconds: 0.3 })])
  await call('closeGreenScreen', 4)
  assert.ok((await call('openGreenScreen', '', 'video', '', 1)).ok)
  await call('timeWidgetTestEvent', '去别的窗口')
  const overflowed = await until(async () => { const s = await call('greenScreenState'); return s.slots[0].src ? s : false }, 'blind box video never reached slot 1')
  test('blind box video goes to another open window when its own window is closed', overflowed.slots[0].src === video && !overflowed.slots[3].open)
  const overflowDone = await idle()
  test('overflowed blind box settles time without a video warning', overflowDone.remaining === 200 && !overflowDone.lastResult.error)
  await until(async () => !(await call('greenScreenState')).slots[0].src, 'overflowed video never released')
  test('overflowed video is released and the borrowed window stays open as a source', (await call('greenScreenState')).slots[0].open)
  // 开关关掉：只在自己的窗口播，1 号开着也不去，记录里说清原因
  await reset([event('只在自己窗口', 2, { video, videoSeconds: 0.3 })])
  await call('timeWidgetUpdate', { boxVideoOverflow: false })
  await call('closeGreenScreen', 4)
  await call('timeWidgetTestEvent', '只在自己窗口')
  const stayed = await idle()
  test('blind box video stays home when overflow is off',
    stayed.remaining === 200 && !(await call('greenScreenState')).slots[0].src && /只在自己的窗口/.test(stayed.lastResult.error || ''))
  await call('timeWidgetUpdate', { boxVideoOverflow: true })
  await call('closeGreenScreen', 1)

  const mediaEvent = event('组合', 3, { video, videoSeconds: 0.2, sound, soundVolume: 0, action: 'effect', actionParam: 'rain' })
  await reset([mediaEvent])
  await call('handleTimeWidgetGift', '鲜花', 3, '', '连击观众')
  const playing = await until(async () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '绿幕4')
    if (!w) return null
    return w.webContents.executeJavaScript(`(()=>{const e=window.__timeBlindBoxMedia;return e?.status==='playing'?{id:e.id,time:e.video.currentTime}:null})()`).then(v => v && ({ ...v, handle: w.getNativeWindowHandle().toString('hex') }))
  }), 'video did not actually play')
  const audio = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '倒计时')
    return w.webContents.executeJavaScript(`Object.values(window.__zlManagedSounds||{}).map(e=>({status:e.status,currentTime:e.audio.currentTime,volume:e.audio.volume}))`)
  })
  test('actual video and audio start with configured zero volume', audio.some(a => a.status === 'playing' && a.volume === 0))
  const second = await until(async () => app.evaluate(({ BrowserWindow }, first) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '绿幕4'); if (!w) return null
    return w.webContents.executeJavaScript(`(()=>{const e=window.__timeBlindBoxMedia;return e?.status==='playing'?{id:e.id,time:e.video.currentTime}:null})()`).then(v => v && v.id !== first ? { ...v, handle: w.getNativeWindowHandle().toString('hex') } : null)
  }, playing.id), 'second video did not play')
  test('successive queued videos retain the same native HWND', playing.handle === second.handle)
  const combined = await idle(), logs = await call('timeWidgetLog')
  const actions = await app.evaluate(() => global.qa.actions)
  test('three gifts produce three serial media and action results', combined.remaining === 2700 && logs.length === 3 && logs.every(l => !l.error) && actions.length === 3)
  test('last result describes actual arithmetic and completed phase', combined.lastResult.before === 900 && combined.lastResult.after === 2700 && combined.lastResult.phase === 'completed')
  evidence.media = { playing, second, audio, actions, logs }

  await reset([event('快照', 2, { video, videoSeconds: 0.3 })])
  await call('handleTimeWidgetGift', '鲜花', 2)
  await until(async () => (await state()).remaining === 200, 'first snapshot did not apply')
  await call('timeWidgetUpdate', { blindBoxEvents: [event('快照', 9)] })
  test('in-flight batch survives library edits with its original snapshot', (await idle()).remaining === 400)
  await call('timeWidgetTestGift', '鲜花')
  test('following gift uses the updated library', (await idle()).remaining === 3600)

  const image = path.join(profile, '手动素材.svg')
  await fs.writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>')
  // 主播自己在绿幕页点播 = 直接开/顶掉（replace），不走排队模型
  await call('openGreenScreen', image, 'image', '独立一号', 1, { replace: true })
  await reset([event('被替换', 2, { video })])
  await call('timeWidgetTestEvent', '被替换')
  await until(async () => (await state()).remaining === 200, 'replacement test did not start')
  await call('openGreenScreen', image, 'image', '用户替换内容', 4, { replace: true })
  const replaced = await idle(), kept = await call('greenScreenState')
  test('manual replacement is reported and its new output is preserved', replaced.lastResult.phase === 'error' && kept.slots[3].open && kept.slots[3].text === '用户替换内容')
  await call('timeWidgetCancelQueue')
  test('cancel preserves unrelated slot one and replaced slot four', (await call('greenScreenState')).slots.filter(s => s.open).length === 2)
  await call('closeGreenScreen', 1); await call('closeGreenScreen', 4)
  // 开哪个才有哪个：主播关了 4 号窗口就真没了，后面还要验「取消时撤掉自己的素材」，先替主播再开一个 4 号空窗口
  assert.ok((await call('openGreenScreen', '', 'video', '', 4)).ok)

  await reset([event('取消', 2, { video, videoSeconds: 0, sound, soundVolume: 0 })])
  await call('handleTimeWidgetGift', '鲜花', 3)
  await until(async () => (await state()).remaining === 200, 'cancellable event did not start')
  const cancelled = await call('timeWidgetCancelQueue'); const afterCancel = await idle()
  test('cancel clears queued gifts and preserves already applied time', cancelled.cancelled === 3 && afterCancel.remaining === 200 && afterCancel.lastResult.phase === 'cancelled')
  // 取消：自己那份素材撤掉、窗口留着换回绿底（它是主播开的采集来源）
  const slot4 = (await call('greenScreenState')).slots[3]
  const cancelledAudio = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '倒计时')
    return w.webContents.executeJavaScript(`Object.values(window.__zlManagedSounds||{}).every(e=>e.audio.paused)`)
  })
  test('cancel clears only owned slot four (window stays, media removed) and stops owned audio', slot4.open && !slot4.src && cancelledAudio)

  await reset([event('旧任务', 9, { action: 'effect', actionParam: 'hang' }), event('新任务', 2)])
  await call('timeWidgetTestEvent', '旧任务')
  await until(() => app.evaluate(() => typeof global.qa.releaseHang === 'function'), 'hanging preflight did not start')
  await call('timeWidgetCancelQueue')
  await call('timeWidgetTestEvent', '新任务')
  await until(async () => (await state()).lastResult?.phase === 'completed' && (await state()).remaining === 200, 'new task blocked behind cancelled preparation', 1500)
  test('cancel immediately frees execution even if old preparation is pending')
  await app.evaluate(() => global.qa.releaseHang({ ok: true }))
  await sleep(120)
  test('late completion of cancelled preparation cannot overwrite new result', (await state()).remaining === 200 && (await state()).lastResult.eventId === '新任务')

  await reset([event('坏视频', 2, { video: corrupt })])
  await call('timeWidgetTestEvent', '坏视频'); const badVideo = await idle()
  test('corrupt video returns real decode failure without applying time', badVideo.remaining === 100 && badVideo.lastResult.phase === 'error' && /视频/.test(badVideo.lastResult.error))
  await reset([event('坏音效', 2, { sound: corrupt })])
  await call('timeWidgetTestEvent', '坏音效'); const badSound = await idle()
  test('corrupt audio returns real decode failure without applying time', badSound.remaining === 100 && badSound.lastResult.phase === 'error' && /音效/.test(badSound.lastResult.error))
  await reset([event('事件失败', 2, { action: 'effect', actionParam: 'reject' })])
  await call('timeWidgetTestEvent', '事件失败'); const rejected = await idle()
  test('failed event preflight prevents media and arithmetic', rejected.remaining === 100 && rejected.lastResult.error === '测试事件不可用')

  await reset([], [{ name: '旧礼物', op: '加减', seconds: 7 }])
  await call('handleTimeWidgetGift', '旧礼物', 3)
  test('legacy direct gifts keep their prior behavior', (await state()).remaining === 121)
  const timerPage = app.windows().find(w => !w.isClosed() && w.url().endsWith('/time-widget.html'))
  await call('timeWidgetUpdate', { theme: 'paper' })
  await timerPage.waitForFunction(() => document.body.dataset.theme === 'paper')
  test('paper skin removes dark outline from time, title and gift text', await timerPage.evaluate(() => [...document.querySelectorAll('#title,#time,.gift-name,.gift-effect')].every(el => getComputedStyle(el).textShadow === 'none')))
  await call('timeWidgetUpdate', { theme: 'theatre' })
  await timerPage.waitForFunction(() => document.body.dataset.theme === 'theatre')
  test('switching to other skins restores their original outline', await timerPage.evaluate(() => getComputedStyle(document.querySelector('#title')).textShadow !== 'none'))

  const effectCancelled = await app.evaluate(async () => {
    global.qa.api.openEffectsWindow({ autoPlay: false }); let current = true
    const pending = global.qa.api.effectsFireChecked('rain', '取消动画', () => current)
    current = false
    return pending
  })
  test('checked effect aborts first-load playback after cancellation', !effectCancelled.ok && effectCancelled.error.includes('取消'))
  const effectPage = await until(() => app.windows().find(w => !w.isClosed() && w.url().endsWith('/effects-widget.html')), 'effect window not ready')
  test('cancelled effect produced no visual objects', await effectPage.evaluate(() => document.querySelectorAll('.gift,.frag,.car,.spark').length === 0))
  const effectStarted = await app.evaluate(() => global.qa.api.effectsFireChecked('rain', '实际动画', () => true))
  assert.ok(effectStarted.ok, effectStarted.error)
  await effectPage.waitForFunction(() => document.querySelectorAll('.gift').length > 0)
  test('checked effect awaits actual renderer invocation and visual objects')
  await call('closeEffectsWindow')
  await reset([event('关闭', 2, { video })])
  await call('handleTimeWidgetGift', '鲜花', 2); await call('closeTimeWidget'); await idle()
  // 关掉时间插件 = 盲盒取消：自己那份素材撤掉（窗口是主播开的，留着）
  await until(async () => !(await call('greenScreenState')).slots[3].src, 'cancelled preparation left its media in the window', 2000)
  const closedSlot = (await call('greenScreenState')).slots[3]
  test('close cancels pending gifts and media while keeping the opened capture window', !(await state()).open && !(await state()).queueLength && closedSlot.open && !closedSlot.src)
  test('all native show and focus events remained absent', await app.evaluate(({ BrowserWindow }) => global.qa.events.length === 0 && BrowserWindow.getAllWindows().every(w => !w.isVisible() && !w.isFocused())))
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, errors, ...evidence }, null, 2))
  console.log(`Time blind box Electron regression: ${checks.length}/${checks.length} PASS`)
  console.log('Evidence: ' + path.join(profile, 'results.json'))
} catch (error) {
  await fs.writeFile(path.join(profile, 'failure.json'), JSON.stringify({ checks, errors, state: await state().catch(() => null), green: await call('greenScreenState').catch(() => null), log: await call('timeWidgetLog').catch(() => null), error: error.stack }, null, 2))
  throw error
} finally { await app.close() }
