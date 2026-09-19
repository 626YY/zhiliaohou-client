// 独立 profile；仅短暂展示本测试自己的窗口，用真实 Win32 采集检查空白及遮挡。
// 不打开/控制直播伴侣，不修改现有客户端或主播场景。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/capture-background')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const bootstrap = await fs.readFile(entry, 'utf8')
assert.ok(bootstrap.includes('const NativeWindow = electron.BrowserWindow;'))
await fs.writeFile(entry, bootstrap.replace('const NativeWindow = electron.BrowserWindow;', `
  const NativeWindow = electron.BrowserWindow;
  const nativeShow = NativeWindow.prototype.showInactive;
  global.__showCaptureFixture = (win) => nativeShow.call(win);
`))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, '--user-data-dir=' + profile], cwd: root, env })
const mainPid = await app.evaluate(() => process.pid)
const checks = [], shots = [], errors = []
app.on('window', target => target.on('pageerror', error => errors.push(error.message)))
const pass = (name, detail) => { checks.push({ name, detail }); console.log('PASS ' + name + (detail ? ' | ' + JSON.stringify(detail) : '')) }
const page = await app.firstWindow()
const api = (name, ...args) => page.evaluate(([name, args]) => window.api[name](...args), [name, args])
const ready = (target, fn, arg) => target.waitForFunction(fn, arg, { polling: 50, timeout: 8000 })
const run = promisify(execFile)
// 活跃皮肤的柔光与视频编码可产生几个色阶的偏差；空闲帧仍要求整帧精确纯绿。
const assertGreen = (shot, label) => assert.ok(shot.corner[0] <= 8 && shot.corner[1] >= 247 && shot.corner[2] <= 8, label + ': ' + JSON.stringify(shot.corner))
async function targetFor(part) {
  for (let i = 0; i < 80; i++) {
    const target = app.windows().find(p => p !== page && p.url().includes(part))
    if (target) { await target.waitForLoadState('domcontentloaded'); return target }
    await page.waitForTimeout(100)
  }
  throw Error('Missing output: ' + part)
}
async function nativeCapture(target, name, method = 'bitblt') {
  const window = await app.browserWindow(target)
  const handle = await window.evaluate(w => w.getNativeWindowHandle().readBigUInt64LE().toString())
  const file = path.join(output, name + '.png')
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/capture-native-window.ps1'), '-WindowHandle', handle, '-ExpectedProcessId', String(mainPid), '-Path', file, '-Method', method], { windowsHide: true, timeout: 15000 })
  const result = await app.evaluate(({ nativeImage }, file) => {
    const image = nativeImage.createFromPath(file), bytes = image.toBitmap(), size = image.getSize()
    let green = 0
    for (let i = 0; i < bytes.length; i += 4) if (bytes[i] === 0 && bytes[i + 1] === 255 && bytes[i + 2] === 0) green++
    return { ...size, green: green / (bytes.length / 4), corner: [...bytes.subarray(0, 4)] }
  }, file)
  shots.push({ name, method, ...result, md5: createHash('md5').update(await fs.readFile(file)).digest('hex') })
  return result
}
async function showFixture(target) {
  const win = await app.browserWindow(target)
  await win.evaluate(w => { w.setPosition(60, 60); global.__showCaptureFixture(w) })
  await target.waitForTimeout(350)
  return win
}
let failure
try {
  await ready(page, () => !!window.api?.getSettings)
  assert.equal((await api('getSettings')).settings.outputCaptureMode, 'green')
  assert.equal((await api('getSettings')).settings.hardwareAcceleration, false)
  assert.equal((await app.evaluate(({ app }) => app.getGPUFeatureStatus())).gpu_compositing, 'disabled_software')
  pass('Windows 默认软件合成，兼容传统窗口捕获')
  // 用带圆角的皮肤：0.3.42 起倒计时窗口贴着画面走（原来上 9px、下 3px 的透明条会让采集出现黑边/绿带），
  // 所以只有圆角这种设计上的透明区才会露绿底。纸白皮肤是直角，窗口里已经没有透明区了。
  const cfg = { initial: 30, enable: false, showSeconds: true, showGift: false, autoHide: true, theme: 'sunset', startHotkey: { enabled: false, func: '无', key: '' }, endHotkey: { enabled: false, func: '无', key: '' } }
  assert.equal((await api('timeWidgetOpen', cfg)).ok, true)
  const time = await targetFor('time-widget')
  await ready(time, () => document.getElementById('time')?.textContent === '30')
  const timeWindow = await showFixture(time)
  for (const method of ['bitblt', 'print']) {
    const captured = await nativeCapture(time, 'countdown-' + method, method)
    assertGreen(captured, method + ' 透明角未变成绿底')
  }
  pass('默认绿幕：倒计时真实 BitBlt / PrintWindow 均采到内容及绿底')

  const cover = await app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ x: 60, y: 60, width: 400, height: 300, frame: false, show: false, focusable: false, skipTaskbar: true, backgroundColor: '#ff00ff' })
    await w.loadURL('data:text/html,<html style="background:magenta"><body>OCCLUDER</body></html>')
    global.__showCaptureFixture(w)
    return w.id
  })
  await page.waitForTimeout(350)
  const occluded = await nativeCapture(time, 'countdown-occluded')
  assertGreen(occluded, '遮挡采集')
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), cover)
  pass('被其他窗口遮挡时 BitBlt 仍只采到挂件及绿底')

  const identity = await timeWindow.evaluate(w => w.id)
  await api('timeWidgetAdjust', -30)
  await ready(time, () => document.body.style.visibility === 'hidden')
  assert.equal(await timeWindow.evaluate(w => w.isVisible()), true)
  const idle = await nativeCapture(time, 'countdown-zero')
  assert.equal(idle.green, 1)
  await api('timeWidgetAdjust', 12)
  await ready(time, () => document.body.style.visibility === 'visible' && document.getElementById('time')?.textContent === '12')
  assert.equal(await timeWindow.evaluate(w => w.id), identity)
  await nativeCapture(time, 'countdown-resumed')
  await api('timeWidgetClose')
  pass('归零自动隐藏保留同一窗口且采集为纯绿；再次加时恢复内容')

  await api('entranceConfigure', { bannerSeconds: 1, bannerWidth: 400, bannerHeight: 120, bannerStyle: 'royal', rules: [{ id: 'capture', enabled: true, match: 'any', name: '', text: '欢迎{name}', dedupeSeconds: 0 }] })
  await api('entranceOpen')
  const entrance = await targetFor('entrance-widget')
  await showFixture(entrance)
  assert.equal((await nativeCapture(entrance, 'entrance-idle')).green, 1)
  assert.equal((await api('entranceTest', '采集验收')).ok, true)
  await ready(entrance, () => document.querySelector('.arrival-name')?.textContent === '采集验收')
  await entrance.waitForTimeout(500)
  await nativeCapture(entrance, 'entrance-active')
  await ready(entrance, () => !document.querySelector('.arrival'))
  assert.equal((await nativeCapture(entrance, 'entrance-ended')).green, 1)
  await api('entranceClose')
  pass('进场空闲、特效播放、结束清空均有独立原生采集画面，空闲为纯绿')

  const counter = { mode: 'counter', initial: 42, clockOn: false, gifts: [], giftShow: false, showLock: true, title: '采集验收', bgTransparent: true }
  const cases = [
    ['challengeOpen', [{ ...counter, slot: 'challenge' }], 'challenge-widget-challenge', 'challengeClose', []],
    ['challengeOpen', [{ ...counter, slot: 'overtime' }], 'challenge-widget-overtime', 'challengeClose', []],
    ['effectsOpen', [{ background: 'transparent', width: 320, height: 240 }], 'effects-widget', 'effectsClose', []],
    ['queueOpen', [{ background: 'transparent' }], 'queue-widget', 'queueClose', []],
    ['keyboardOpen', [{ background: 'transparent' }], 'keyboard-widget', 'keyboardClose', []],
    ['marqueeOpen', [{}], 'marquee-widget', 'marqueeClose', []],
    ['protectWidgetOpen', [Date.now()], 'protect-widget', 'protectWidgetClose', []]
  ]
  for (const [open, args, part, close, closeArgs] of cases) {
    assert.equal((await api(open, ...args)).ok, true, part)
    const target = await targetFor(part), win = await showFixture(target)
    assert.equal((await win.evaluate(w => w.getBackgroundColor())).toLowerCase(), '#00ff00', part)
    assert.equal(await target.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(0, 255, 0)', part)
    assertGreen(await nativeCapture(target, part), part)
    await api(close, ...closeArgs)
  }
  pass('另七类透明输出逐个实测，计数器/加班器/礼物动画/排队/键盘/飘屏/保护计时均保持绿底')

  const icon = path.join(root, 'build/icon.png')
  for (const slot of [1, 2, 3, 4]) {
    assert.equal((await api('greenScreenOpen', icon, 'image', '', slot)).ok, true)
    const target = await targetFor('green-player-' + slot + '.html')
    await ready(target, () => document.querySelector('img')?.naturalWidth > 0)
    const win = await showFixture(target), id = await win.evaluate(w => w.id)
    assertGreen(await nativeCapture(target, 'green-' + slot), '绿幕 ' + slot)
    assert.equal((await api('greenScreenOpen', icon + '.missing', 'image', '', slot)).ok, false)
    assert.equal(await win.evaluate(w => w.id), id)
    await api('greenScreenClose', slot)
  }
  const items = [{ name: '奖品一', weight: 1 }, { name: '奖品二', weight: 1 }]
  const opaqueCases = [
    ['progressOpen', [], 'progress-widget', 'progressClose', []],
    ['wishOpen', [], 'wish-widget', 'wishClose', []],
    ['lotteryOpen', ['wheel', items], 'lottery-lucky', 'lotteryClose', ['wheel']],
    ['lotteryOpen', ['nine', items], 'lottery-nine', 'lotteryClose', ['nine']]
  ]
  for (const [open, args, part, close, closeArgs] of opaqueCases) {
    assert.equal((await api(open, ...args)).ok, true)
    const target = await targetFor(part)
    await showFixture(target)
    const shot = await nativeCapture(target, part)
    assert.ok(shot.green > 0.01, part + ' 丢失绿幕留白')
    await api(close, ...closeArgs)
  }
  pass('四个绿幕槽位、积分、心愿、转盘、九宫格原有采集底色正常；失效素材不会替换当前窗口')

  const videoBytes = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180
    const ctx = c.getContext('2d'), stream = c.captureStream(20), chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    recorder.ondataavailable = event => chunks.push(event.data)
    const done = new Promise(resolve => { recorder.onstop = resolve })
    let n = 0
    const tick = () => { ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = '#ff8800'; ctx.fillRect(30 + n++ % 50, 50, 60, 60) }
    tick(); recorder.start()
    const timer = setInterval(tick, 50)
    await new Promise(resolve => setTimeout(resolve, 1200))
    recorder.stop(); clearInterval(timer); await done; stream.getTracks().forEach(track => track.stop())
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
  })
  const video = path.join(profile, 'capture-fixture.webm')
  await fs.writeFile(video, Buffer.from(videoBytes))
  for (const slot of ['main', 'vip']) {
    assert.equal((await api('videoWidgetOpen', { path: video, slot, loop: true, muted: true, bgColor: '#00ff00', width: 400, height: 300 })).ok, true)
    const target = await targetFor('video-widget-' + slot)
    await ready(target, () => document.querySelector('video')?.videoWidth === 320)
    const win = await showFixture(target), id = await win.evaluate(w => w.id)
    assertGreen(await nativeCapture(target, 'video-' + slot), '视频 ' + slot)
    const firstFrame = shots.at(-1).md5
    // 采集 helper 的启动耗时可能刚好跨过一轮短视频，不能把同一播放相位当卡帧。
    // 最多取三个不同间隔的样本，仍必须有真实不同的原生采集帧。
    for (const [attempt, delay] of [173, 337, 521].entries()) {
      await target.waitForTimeout(delay)
      await nativeCapture(target, 'video-' + slot + '-next-' + attempt)
      if (shots.at(-1).md5 !== firstFrame) break
    }
    assert.notEqual(shots.at(-1).md5, firstFrame, slot + ' 视频采集卡帧')
    assert.equal((await api('videoWidgetOpen', { path: video + '.missing', slot })).ok, false)
    assert.equal(await win.evaluate(w => w.id), id)
    await api('videoWidgetClose', slot)
  }
  pass('主视频及 VIP 真实解码和采集帧变化正常，留白为绿底，失效替换保留当前来源')

  await api('register', 'capture_qa', 'Fixture123!', '采集验收')
  assert.equal((await api('login', 'capture_qa', 'Fixture123!')).ok, true)
  await api('saveSettings', { guideSeen: true })
  await page.evaluate(() => localStorage.setItem('zl-guide-seen', '1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(() => { location.hash = '/settings' })
  const select = page.getByLabel('挂件采集模式')
  await select.selectOption('transparent')
  await page.getByRole('button', { name: '保存设置', exact: true }).dispatchEvent('click')
  assert.equal((await api('getSettings')).settings.outputCaptureMode, 'transparent')
  await api('timeWidgetOpen', cfg)
  const transparent = await targetFor('time-widget')
  const transparentWindow = await app.browserWindow(transparent)
  assert.equal(await transparentWindow.evaluate(async w => (await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toBitmap()[3]), 0)
  await api('timeWidgetClose')
  await select.selectOption('green')
  await page.getByRole('button', { name: '保存设置', exact: true }).dispatchEvent('click')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await ready(page, () => document.querySelector('[aria-label="挂件采集模式"]')?.value === 'green')
  pass('设置控件往返保存，透明选项保留真实 alpha，绿幕模式重载后仍保持')
  assert.deepEqual(errors, [])
} catch (error) { failure = error; console.error(error) }
finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, shots, error: failure?.message }, null, 2))
  await app.close().catch(() => {})
}
console.log(`采集背景回归 ${checks.length}/9 PASS`)
if (failure) process.exitCode = 1
