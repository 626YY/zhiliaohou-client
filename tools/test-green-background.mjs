// 真 Electron 聚焦回归：独立 profile，只加载绿幕模块；本实例的展示/聚焦方法记录后不执行。
// 验证隐藏后台视频解码，不代表直播伴侣采集或原生窗口被遮挡的实测结果。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output', 'playwright', 'green-background')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
// 这支验的是「关掉挂件后留着采集来源」下待机画面是抠得掉的绿：0.3.43 起默认关掉就真关掉，这里显式打开该开关
await fs.mkdir(path.join(isolated, 'data'), { recursive: true })
await fs.writeFile(path.join(isolated, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, keepClosedSources: true }))
await build({ entryPoints: [path.join(root, 'src/main/green-screen.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'green-screen.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `
const electron = require('electron');
const { app, BrowserWindow: NativeWindow } = electron;
app.setPath('userData', __dirname);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 仅本测试固定 sRGB，避免显示器 ICC/HDR 把截图原始字节变成另一色域后误判。
app.commandLine.appendSwitch('force-color-profile', 'srgb');
global.qa = { constructors: [], calls: [], nativeEvents: [] };
global.qa.writeCapture = (file, png) => require('node:fs').writeFileSync(file, png);
// 只影响本测试进程；不启动正式客户端、不读用户配置、不使用系统鼠标或键盘。
for (const method of ['show', 'showInactive', 'focus', 'restore', 'maximize', 'moveTop']) {
  NativeWindow.prototype[method] = function () { global.qa.calls.push({ id: this.id, method }); };
}
app.focus = () => {};
electron.dialog.showErrorBox = (title, content) => process.stderr.write(title + ': ' + content + '\\n');
const originalSetAlwaysOnTop = NativeWindow.prototype.setAlwaysOnTop;
NativeWindow.prototype.setAlwaysOnTop = function (...args) {
  global.qa.calls.push({ id: this.id, method: 'setAlwaysOnTop', args });
  return originalSetAlwaysOnTop.apply(this, args);
};
const HiddenWindow = new Proxy(NativeWindow, {
  construct(Target, args) {
    const requested = args[0] || {};
    const win = Reflect.construct(Target, [{ ...requested, show: false, focusable: false }], Target);
    global.qa.constructors.push({ id: win.id, requested });
    for (const event of ['show', 'focus']) win.on(event, () => global.qa.nativeEvents.push({ id: win.id, event }));
    return win;
  }
});
const Module = require('node:module'), originalLoad = Module._load;
const facade = { ...electron, BrowserWindow: HiddenWindow };
Module._load = function (request) { return request === 'electron' ? facade : originalLoad.apply(this, arguments); };
app.whenReady().then(async () => {
  global.qa.green = require('./green-screen.cjs');
  const control = new HiddenWindow({ show: false, title: 'green-background-test-control', webPreferences: { backgroundThrottling: false } });
  global.qa.controlId = control.id;
  await control.loadURL('about:blank');
}).catch(error => { process.stderr.write(String(error.stack || error)); app.exit(1); });
`)
const fixture = path.join(isolated, '素材 # & 中文.svg')
// 素材自身不画背景：实际输出像素必须由正式绿幕页面补绿，不能靠测试素材遮住缺陷。
await fs.writeFile(fixture, '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><circle cx="160" cy="90" r="45" fill="orange"/></svg>')
const portraitFixture = path.join(isolated, '透明竖图 # & 中文.svg')
await fs.writeFile(portraitFixture, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240"><rect x="30" y="60" width="60" height="120" fill="orange"/></svg>')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = [], errors = [], evidence = { userData: isolated, colorProfile: 'srgb (isolated test process only)', limitations: ['Native show/focus calls are recorded but suppressed in this test process.', 'Hidden renderer playback and source pixels are tested; live companion capture and native occlusion are not tested.'] }
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS ' + name) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const call = (fn, args = []) => app.evaluate((_, { fn, args }) => global.qa.green[fn](...args), { fn, args })
const closeAndWait = slot => app.evaluate(async ({ BrowserWindow }, slot) => {
  const activeTitles = global.qa.green.greenScreenState().slots.filter(s => s.open && (slot == null || s.slot === slot)).map(s => '绿幕' + s.slot)
  const closing = BrowserWindow.getAllWindows().filter(win => activeTitles.includes(win.getTitle()))
  const closed = closing.map(win => new Promise(resolve => win.webContents.once('did-finish-load', resolve)))
  global.qa.green.closeGreenScreen(slot)
  await Promise.all(closed)
}, slot)
const state = id => app.evaluate(({ BrowserWindow }, id) => {
  const w = BrowserWindow.fromId(id)
  return w ? { id: w.id, bounds: w.getBounds(), handle: w.getNativeWindowHandle().toString('hex'), alwaysOnTop: w.isAlwaysOnTop(), backgroundColor: w.getBackgroundColor(), visible: w.isVisible(), focused: w.isFocused(), throttled: w.webContents.getBackgroundThrottling(), calls: global.qa.calls.filter(c => c.id === id) } : null
}, id)
const capturePixels = (id, name, points) => app.evaluate(async ({ BrowserWindow }, { id, file, points }) => {
  const win = BrowserWindow.fromId(id)
  const before = { visible: win.isVisible(), focused: win.isFocused() }
  const capture = await win.webContents.capturePage(undefined, { stayHidden: true })
  if (capture.isEmpty()) throw new Error('Hidden source capture returned an empty image; native capture remains unverified')
  const size = capture.getSize(), bitmap = capture.toBitmap()
  const samples = points.map(({ name, x, y }) => {
    const px = Math.min(size.width - 1, Math.floor(x * size.width))
    const py = Math.min(size.height - 1, Math.floor(y * size.height))
    const offset = (py * size.width + px) * 4
    // NativeImage bitmap is BGRA on this Windows test platform.
    return { name, x: px, y: py, rgba: [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset], bitmap[offset + 3]] }
  })
  global.qa.writeCapture(file, capture.toPNG())
  return { file, size, samples, before, after: { visible: win.isVisible(), focused: win.isFocused() } }
}, { id, file: path.join(isolated, name + '.png'), points })
const isGreen = ({ rgba: [r, g, b, a] }) => r <= 2 && g >= 253 && b <= 2 && a === 255
const isOrange = ({ rgba: [r, g, b, a] }) => r >= 250 && g >= 160 && g <= 170 && b <= 2 && a === 255
const pageFor = async suffix => {
  for (let i = 0; i < 100; i++) {
    const page = app.windows().find(page => page.url().endsWith(suffix))
    if (page) { await page.waitForLoadState(); return page }
    await sleep(50)
  }
  throw new Error('Missing output page: ' + suffix)
}
try {
  const control = await app.firstWindow()
  const controlId = await app.evaluate(() => global.qa.controlId)
  check('isolated test profile is active', await app.evaluate(({ app }, expected) => app.getPath('userData') === expected, isolated))
  const encoded = await control.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
    const ctx = canvas.getContext('2d'), stream = canvas.captureStream(20), chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    const done = new Promise(resolve => { recorder.onstop = resolve })
    recorder.ondataavailable = event => chunks.push(event.data)
    let frame = 0
    const draw = () => { ctx.fillStyle = 'lime'; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = 'orange'; ctx.fillRect((frame++ * 5) % 280, 60, 40, 60) }
    draw(); recorder.start()
    const timer = setInterval(draw, 50)
    await new Promise(resolve => setTimeout(resolve, 2500))
    recorder.stop(); clearInterval(timer); await done; stream.getTracks().forEach(track => track.stop())
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))
  })
  const videoFile = path.join(isolated, '后台视频 # & 中文.webm')
  await fs.writeFile(videoFile, Buffer.from(encoded))
  check('new green output opens', (await call('openGreenScreen', [fixture, 'image', '首次素材', 1])).ok)
  const green = await pageFor('green-1.html')
  await green.waitForFunction(() => document.querySelector('img')?.naturalWidth === 320)
  const created = await app.evaluate(() => global.qa.constructors.find(item => item.requested.title === '绿幕1'))
  const first = await state(created.id)
  evidence.first = first
  check('creation requests show:false and alwaysOnTop:false', created.requested.show === false && created.requested.alwaysOnTop === false)
  check('production green window requests native opaque chroma-green background', created.requested.transparent === false && created.requested.backgroundColor?.toLowerCase() === '#00ff00')
  const pageBackground = await green.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor }))
  evidence.pageBackground = pageBackground
  check('native and both page backgrounds use the same chroma green', ['#00ff00', '#ff00ff00'].includes(first.backgroundColor.toLowerCase()) && pageBackground.html === 'rgb(0, 255, 0)' && pageBackground.body === 'rgb(0, 255, 0)')
  check('native green window starts non-topmost', first.alwaysOnTop === false)
  check('creation calls showInactive exactly once', first.calls.filter(call => call.method === 'showInactive').length === 1)
  await green.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  evidence.transparentImage = await capturePixels(created.id, 'transparent-image-green-background', [
    { name: 'transparent-top-left', x: 0.1, y: 0.1 },
    { name: 'transparent-right', x: 0.9, y: 0.5 },
    { name: 'orange-content', x: 0.5, y: 0.5 }
  ])
  check('transparent image regions render opaque green while colored content remains', evidence.transparentImage.samples.slice(0, 2).every(isGreen) && isOrange(evidence.transparentImage.samples[2]))
  check('portrait image replacement opens', (await call('openGreenScreen', [portraitFixture, 'image', '', 1])).ok)
  await green.waitForFunction(() => document.querySelector('img')?.naturalWidth === 120 && document.querySelector('img')?.naturalHeight === 240)
  await green.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  evidence.portraitImage = await capturePixels(created.id, 'portrait-letterbox-green-background', [
    { name: 'left-letterbox', x: 0.1, y: 0.5 },
    { name: 'right-letterbox', x: 0.9, y: 0.5 },
    { name: 'transparent-region-inside-portrait', x: 0.5, y: 0.1 },
    { name: 'orange-content', x: 0.5, y: 0.5 }
  ])
  check('portrait letterboxing and transparent image area render green without losing content', evidence.portraitImage.samples.slice(0, 3).every(isGreen) && isOrange(evidence.portraitImage.samples[3]))
  check('source pixel captures never show or focus their output', [evidence.transparentImage, evidence.portraitImage].every(capture => [capture.before, capture.after].every(sample => !sample.visible && !sample.focused)))
  const afterPortrait = await state(created.id)
  // 0.3.41 起竖图会把窗口收成画面比例（原来两侧那片绿边不再采进直播）；句柄和位置仍然不动。
  check('portrait replacement keeps the native handle and position while trimming the window to the picture',
    afterPortrait.handle === first.handle && afterPortrait.bounds.x === first.bounds.x && afterPortrait.bounds.y === first.bounds.y
    && afterPortrait.bounds.height === first.bounds.height && afterPortrait.bounds.width === Math.round(first.bounds.height * 120 / 240))
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setBounds({ x: 310, y: 190, width: 530, height: 310 }), created.id)
  const placed = await state(created.id)
  check('same-slot video replacement opens', (await call('openGreenScreen', [videoFile, 'video', '后台播放', 1, { loop: true }])).ok)
  await green.waitForFunction(() => document.querySelector('video')?.videoWidth === 320 && document.querySelector('.label')?.textContent === '后台播放')
  const replaced = await state(created.id)
  evidence.replaced = replaced
  check('replacement keeps the native handle and position, trimmed to the video ratio',
    replaced.handle === placed.handle && replaced.bounds.x === placed.bounds.x && replaced.bounds.y === placed.bounds.y
    && replaced.bounds.width === placed.bounds.width && replaced.bounds.height === Math.round(placed.bounds.width * 180 / 320))
  // 换素材不置顶。抬不抬层级看 verify-standby-park：那里的窗口是真显示的，
  // 这个测试进程里 show 被打桩，窗口从来没真正可见过，复用时必然补一次 show。
  check('replacement stays non-topmost', replaced.alwaysOnTop === false)
  check('output renderer disables background throttling', replaced.throttled === false)
  const sampleVideo = () => green.evaluate(() => {
    const v = document.querySelector('video')
    return { time: v.currentTime, decodedFrames: v.getVideoPlaybackQuality().totalVideoFrames, paused: v.paused, visibility: document.visibilityState }
  })
  const before = await sampleVideo()
  await sleep(900)
  const after = await sampleVideo()
  evidence.playback = { before, after, decodedFrameDelta: after.decodedFrames - before.decodedFrames }
  console.log('EVIDENCE playback ' + JSON.stringify(evidence.playback))
  check('hidden background video keeps decoding frames', !after.paused && after.decodedFrames - before.decodedFrames >= 8 && after.time !== before.time)
  check('test output remains hidden and unfocused', (await state(created.id)).visible === false && (await state(created.id)).focused === false)
  await call('openGreenScreen', [fixture, 'image', '独立槽位', 2])
  await pageFor('green-2.html')
  await closeAndWait(1)
  const afterClose = await call('greenScreenState')
  // 0.3.41 起待机画面用抠得掉的绿：黑色会被直播伴侣原样采进画面，糊一块黑在直播上。
  check('closing one slot leaves its source on chroma green and preserves the other slot', !afterClose.slots[0].open && afterClose.slots[1].open && (await state(controlId)) !== null && (await state(created.id)).backgroundColor.toLowerCase() === '#00ff00')
  await closeAndWait()
  const windowsAfterClose = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id))
  evidence.windowsAfterClose = windowsAfterClose
  check('closing all outputs keeps stable capture sources with no active media', windowsAfterClose.includes(controlId) && windowsAfterClose.includes(created.id) && !(await call('greenScreenState')).open)
  check('no native show/focus event or renderer JavaScript error', (await app.evaluate(() => global.qa.nativeEvents)).length === 0 && errors.length === 0)
  console.log('green background regression passed: ' + results.length + ' checks')
} catch (error) {
  evidence.failure = String(error.stack || error)
  throw error
} finally {
  await fs.writeFile(path.join(isolated, 'results.json'), JSON.stringify({ results, errors, ...evidence }, null, 2))
  console.log('EVIDENCE ' + path.join(isolated, 'results.json'))
  await app.close()
}
