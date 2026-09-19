// 完整构建集成回归：真实 React 页面 → preload/IPC → 计时、媒体与礼物动画。
// 只用独立 profile 和隐藏窗口；没有模拟业务 API，不连接直播间或游戏。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/time-blindbox-app')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
const evidence = {
  profile, checks, errors,
  limitations: [
    'All application windows are hidden by the test bootstrap; this is not a Douyin capture or desktop-focus test.',
    'UI clicks call the real built preload and IPC handlers. No mocked time, media or effect executor is used.',
    'Gift trigger uses the real test-gift IPC entry; no live room, real gifts or game is contacted.',
    'Audio is a silent PCM WAV: actual decoding, configured volume, playback progress and cleanup are checked; speaker sound is not assessed.',
    'Effect observation records and delegates the original renderer __fire function without replacing its behavior.',
    'The gift-name datalist field is filled using DOM input/change events because native suggestions close the renderer in a hidden, non-focusable Electron window; this test does not assess that native popup.'
  ]
}
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
const lifecycle = []
evidence.lifecycle = lifecycle
app.process().on('exit', (code, signal) => lifecycle.push({ event: 'process-exit', code, signal, ts: Date.now() }))
app.process().stdout.on('data', chunk => lifecycle.push({ event: 'stdout', text: chunk.toString(), ts: Date.now() }))
app.process().stderr.on('data', chunk => lifecycle.push({ event: 'stderr', text: chunk.toString(), ts: Date.now() }))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const pass = name => { checks.push(name); console.log('PASS ' + name) }
async function until(query, description, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await query(); if (result) return result; await sleep(60) }
  throw new Error('等待超时：' + description)
}
async function windowAt(urlPart) {
  const page = await until(() => app.windows().find(page => !page.isClosed() && page.url().includes(urlPart)), urlPart)
  await page.waitForLoadState('domcontentloaded')
  return page
}
async function capture(page, name) {
  const win = await app.browserWindow(page)
  const bytes = await win.evaluate(async window => Array.from((await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  await fs.writeFile(path.join(profile, name), Buffer.from(bytes))
}
const watched = new WeakSet()
function watch(page) {
  if (watched.has(page)) return
  watched.add(page)
  page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }))
  page.on('close', () => lifecycle.push({ event: 'page-close', url: page.url(), ts: Date.now() }))
}
app.on('window', watch)
try {
  // 在未来的真实礼物动画页面中记录实际入口调用；setter 委托原函数，动画逻辑照常执行。
  await app.context().addInitScript(() => {
    window.__qaEffectCalls = []
    let actualFire
    Object.defineProperty(window, '__fire', {
      configurable: true,
      get: () => actualFire,
      set: handler => {
        actualFire = typeof handler === 'function' ? function (...args) {
          window.__qaEffectCalls.push({ kind: args[0], name: args[1], count: args[3], ts: Date.now() })
          return handler.apply(this, args)
        } : handler
      }
    })
  })
  const page = await app.firstWindow()
  watch(page)
  await app.evaluate(({ app, ipcMain, BrowserWindow }) => {
    const record = message => console.log('[time-app-qa] ' + message)
    ipcMain.on('window:close', () => record('window:close IPC received'))
    app.on('before-quit', () => record('before-quit'))
    app.on('window-all-closed', () => record('window-all-closed'))
    for (const window of BrowserWindow.getAllWindows()) window.on('close', () => record('native close ' + window.id))
  })
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15000 })
  assert.equal(await app.evaluate(({ app }, expected) => app.getPath('userData') === expected, profile), true)
  const login = await page.evaluate(async () => {
    const username = 'time_blindbox_app_test', password = 'Fixture123!'
    await window.api.register(username, password, '时间盲盒集成回归')
    const result = await window.api.login(username, password)
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    // 本测试验证完整编辑器；基础模式（00995fb 起默认）把事件库折在「已有设置」里，这里按高级模式展开
    localStorage.setItem('zl_configuration_level', 'advanced')
    localStorage.setItem('ent_time_cfg', JSON.stringify({ initial: 100, clockSpeed: 60000, title: '时间盲盒实测', gifts: [], addGift: '', subGift: '', enable: true, giftColumns: 1 }))
    return result
  })
  assert.equal(login.ok, true, login.error)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '游戏库', exact: true }).waitFor()
  pass('完整客户端在独立 profile 使用本地测试账号启动')

  // 带空格、中文和URL特殊字符的实际媒体文件全部放在测试 profile。
  const video = path.join(profile, '时间 ×3 # &.webm')
  const sound = path.join(profile, '时间 音效 # &.wav')
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
    const context = canvas.getContext('2d'), stream = canvas.captureStream(20), chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    recorder.ondataavailable = event => chunks.push(event.data)
    const stopped = new Promise(resolve => { recorder.onstop = resolve })
    let frame = 0
    const draw = () => { context.fillStyle = '#00ff00'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#ff9238'; context.beginPath(); context.arc(35 + (frame++ * 5) % 250, 90, 25, 0, Math.PI * 2); context.fill() }
    draw(); recorder.start(); const tick = setInterval(draw, 50)
    await new Promise(resolve => setTimeout(resolve, 4200))
    clearInterval(tick); recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop())
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
  })
  await fs.writeFile(video, Buffer.from(videoBytes))
  const sampleRate = 8000, dataSize = sampleRate * 2 * 5
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataSize, 40)
  await fs.writeFile(sound, wav)

  await page.getByRole('link', { name: '娱乐助手', exact: true }).click()
  await page.getByRole('button', { name: /^时间插件/ }).click()
  const library = page.getByRole('region', { name: '时间盲盒事件库', exact: true })
  await library.waitFor()
  // 0.3.49：事件库说明只说事件设置，不提「今晚」/「项目开关」（用户截图指出的文案）
  assert.equal((await library.locator('h3 + p').first().textContent()).trim(), '为每个事件设置时间、视频、音效和整蛊动作。')
  assert.doesNotMatch(await library.textContent(), /今晚|项目开关/)
  pass('事件库说明只写「为每个事件设置时间、视频、音效和整蛊动作。」')
  await library.getByRole('button', { name: '添加事件', exact: true }).click()
  await library.getByLabel('事件名称', { exact: true }).last().fill('三倍时间实测')
  await library.getByRole('button', { name: '乘时间', exact: true }).click()
  await library.getByLabel('事件数值', { exact: true }).last().fill('3')
  await library.getByLabel('事件视频路径', { exact: true }).last().fill(video)
  await library.getByLabel('事件视频秒数', { exact: true }).fill('0')
  await library.getByLabel('事件音效路径', { exact: true }).fill(sound)
  await library.getByLabel('事件音效音量', { exact: true }).fill('37')
  await library.getByLabel('附加事件类型', { exact: true }).selectOption('effect')
  await library.getByLabel('事件礼物动画', { exact: true }).selectOption('firework')
  await page.getByRole('button', { name: '添加礼物', exact: true }).click()
  // 隐藏/non-focusable 的 Electron 原生 datalist 弹层会断开 renderer；只避免弹层，React onChange 仍真实执行。
  await page.getByLabel('礼物 1 名称', { exact: true }).evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, '鲜花')
  await page.getByLabel('礼物 1 触发方式', { exact: true }).selectOption('blindbox')
  await page.getByTestId('time-blindbox-pool').getByRole('checkbox', { name: '抽奖事件 三倍时间实测', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByPlaceholder('方案名', { exact: true }).fill('实测方案')
  await page.getByRole('button', { name: '保存方案', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')))
  assert.equal(saved.blindBoxEvents.length, 1)
  assert.deepEqual(saved.gifts[0].blindBoxEventIds, [saved.blindBoxEvents[0].id])
  assert.equal(saved.blindBoxEvents[0].value, 3)
  assert.equal(saved.blindBoxEvents[0].videoSeconds, 0)
  assert.equal(saved.blindBoxEvents[0].soundVolume, 37)
  pass('真实页面添加 ×3 事件、多媒体、烟花动画并绑定鲜花奖池和方案')

  const opened = await page.evaluate(config => window.api.timeWidgetOpen(config), saved)
  // 开哪个才有哪个：盲盒视频只播到主播开着的绿幕窗口，先替主播把 4 号空窗口开出来
  assert.equal((await page.evaluate(() => window.api.greenScreenOpen('', 'video', '', 4))).ok, true)
  assert.equal(opened.ok, true, opened.error)
  const timer = await windowAt('/time-widget.html')
  watch(timer)
  await timer.waitForFunction(() => document.querySelector('#time')?.textContent === '01:40')
  assert.equal((await page.evaluate(() => window.api.timeWidgetState())).remaining, 100)
  await page.getByRole('button', { name: '测试礼物 鲜花', exact: true }).click()
  const running = await until(async () => {
    const state = await page.evaluate(() => window.api.timeWidgetState())
    if (state.lastResult?.phase === 'error') throw new Error(state.lastResult.error)
    return state.remaining === 300 && state.lastResult?.phase === 'running' ? state : false
  }, '真实礼物盲盒 ×3')
  const green = await windowAt('/green-player-4.html')
  watch(green)
  const effects = await windowAt('/effects-widget.html')
  watch(effects)
  const mediaBefore = await green.evaluate(() => {
    const entry = window.__timeBlindBoxMedia, v = entry.video
    return { status: entry.status, currentTime: v.currentTime, frames: v.getVideoPlaybackQuality().totalVideoFrames, readyState: v.readyState, width: v.videoWidth, height: v.videoHeight, paused: v.paused }
  })
  const audioBefore = await timer.evaluate(() => Object.values(window.__zlManagedSounds || {}).map(entry => ({ status: entry.status, currentTime: entry.audio.currentTime, volume: entry.audio.volume, paused: entry.audio.paused, readyState: entry.audio.readyState })))
  assert.equal(mediaBefore.status, 'playing')
  assert.equal(mediaBefore.width, 320)
  assert.equal(mediaBefore.height, 180)
  assert.equal(mediaBefore.paused, false)
  assert.ok(audioBefore.some(entry => entry.status === 'playing' && entry.volume === 0.37 && !entry.paused && entry.readyState >= 2))
  await until(async () => green.evaluate(first => {
    const v = window.__timeBlindBoxMedia?.video
    return !!v && v.currentTime > first.currentTime + 0.15 && v.getVideoPlaybackQuality().totalVideoFrames > first.frames
  }, mediaBefore), '视频时间与解码帧推进')
  const audioAfter = await timer.evaluate(() => Object.values(window.__zlManagedSounds || {}).map(entry => ({ status: entry.status, currentTime: entry.audio.currentTime, volume: entry.audio.volume })))
  assert.ok(audioAfter.some(entry => entry.currentTime > audioBefore[0].currentTime))
  await effects.waitForFunction(() => window.__qaEffectCalls?.length === 1 && document.querySelectorAll('.gift,.spark,.final').length > 0)
  const fireCalls = await effects.evaluate(() => window.__qaEffectCalls)
  assert.deepEqual(fireCalls.map(call => [call.kind, call.name, call.count]), [['firework', '三倍时间实测', 1]])
  evidence.running = running
  evidence.media = { video: mediaBefore, audioBefore, audioAfter, fireCalls }
  await capture(green, 'real-video-playing.png')
  await capture(timer, 'real-time-300.png')
  // 捕获隐藏窗口会唤醒一次绘制；再取一帧检查真实动画的位置更新，不改动 requestAnimationFrame。
  await capture(effects, 'real-firework-warmup.png')
  await sleep(120)
  await capture(effects, 'real-firework.png')
  evidence.media.effectNodes = await effects.evaluate(() => [...document.querySelectorAll('.gift,.spark,.final')].slice(0, 60).map(node => {
    const rect = node.getBoundingClientRect()
    return { kind: node.className, x: rect.x, y: rect.y, width: rect.width, height: rect.height, transform: getComputedStyle(node).transform }
  }))
  pass('页面抽一次经真实 IPC：100→300，视频解码、音效推进，真实烟花入口只执行一次')

  const completed = await until(async () => {
    const state = await page.evaluate(() => window.api.timeWidgetState())
    if (state.lastResult?.phase === 'error') throw new Error(state.lastResult.error)
    return !state.activeEvent && !state.queueLength && state.lastResult?.phase === 'completed' ? state : false
  }, '视频和音效自然播完')
  assert.equal(completed.remaining, 300)
  assert.equal(await timer.evaluate(() => Object.keys(window.__zlManagedSounds || {}).length), 0)
  const greenState = await page.evaluate(() => window.api.greenScreenState())
  // 播完素材撤掉、窗口留着换回绿底（它是主播开的采集来源）
  const slot4 = greenState.slots.find(slot => slot.slot === 4)
  assert.equal(slot4.open && slot4.src === '', true)
  const logs = await page.evaluate(() => window.api.timeWidgetLog())
  assert.equal(logs.length, 1)
  assert.deepEqual([logs[0].name, logs[0].eventName, logs[0].delta, logs[0].remaining, logs[0].source], ['鲜花', '三倍时间实测', 200, 300, 'test'])
  assert.equal(logs[0].error, undefined)
  assert.equal((await effects.evaluate(() => window.__qaEffectCalls)).length, 1)
  evidence.completed = completed
  evidence.logs = logs
  pass('0秒配置等媒体自然结束，音频/绿幕清理完成，只有一条成功记录')

  const themes = []
  for (const theme of ['arena', 'theatre', 'arcade', 'paper', 'abyss']) {
    await page.getByLabel('时间皮肤', { exact: true }).selectOption(theme)
    await timer.waitForFunction(id => document.body.dataset.theme === id && document.querySelector('#time')?.textContent === '05:00', theme)
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')))
    assert.equal(stored.theme, theme)
    await capture(timer, `real-time-${theme}.png`)
    const skin = await timer.evaluate(() => ({ title: document.querySelector('#title')?.textContent, time: document.querySelector('#time')?.textContent, image: document.querySelector('img')?.getAttribute('src'), shadows: [...document.querySelectorAll('#title,#time,.gift-name,.gift-effect')].map(node => getComputedStyle(node).textShadow) }))
    if (theme === 'paper') assert.deepEqual([...new Set(skin.shadows)], ['none'])
    themes.push({ id: theme, ...skin })
  }
  assert.equal(new Set(themes.map(theme => theme.image)).size, 5)
  evidence.themes = themes.map(({ image, ...theme }) => ({ ...theme, imageLength: image?.length }))
  pass('实际 Select 切换5套皮肤，每套真实时间窗口已隐藏截图，计时保持300秒')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '娱乐助手', exact: true }).click()
  await page.getByRole('button', { name: /^时间插件/ }).click()
  await library.waitFor()
  assert.equal(await page.getByLabel('时间皮肤', { exact: true }).inputValue(), 'abyss')
  assert.equal(await page.getByLabel('礼物 1 触发方式', { exact: true }).inputValue(), 'blindbox')
  assert.equal(await page.getByTestId('time-blindbox-pool').getByRole('checkbox', { checked: true }).count(), 1)
  await library.getByRole('button', { name: '编辑事件 三倍时间实测', exact: true }).click()
  assert.equal(await library.getByLabel('事件视频路径', { exact: true }).inputValue(), video)
  assert.equal(await library.getByLabel('事件音效音量', { exact: true }).inputValue(), '37')
  await page.getByRole('combobox').filter({ has: page.locator('option[value="实测方案"]') }).selectOption('实测方案')
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')))
  assert.equal(restored.blindBoxEvents[0].value, 3)
  assert.equal(restored.blindBoxEvents[0].sound, sound)
  assert.equal(restored.blindBoxEvents[0].actionParam, 'firework')
  assert.deepEqual(restored.gifts[0].blindBoxEventIds, [saved.blindBoxEvents[0].id])
  assert.equal((await page.evaluate(() => window.api.timeWidgetState())).remaining, 300)
  await capture(page, 'real-client-restored.png')
  pass('真实页面重载与方案加载保持事件、多媒体、奖池和运行中的时间')

  evidence.windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, title: window.getTitle(), visible: window.isVisible(), focused: window.isFocused() })))
  assert.ok(evidence.windows.every(window => !window.visible && !window.focused))
  assert.deepEqual(errors, [])
  pass('所有原生窗口持续隐藏，页面无未处理异常')
  await page.evaluate(async () => { await window.api.timeWidgetClose(); await window.api.effectsClose(); await window.api.greenScreenClose() })
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify(evidence, null, 2))
  console.log(`time blindbox full app passed: ${checks.length} checks (built app, real preload + IPC + media + effect)`)
  console.log(profile)
} catch (error) {
  evidence.failure = String(error.stack || error)
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify(evidence, null, 2))
  throw error
} finally { await app.close() }
