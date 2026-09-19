import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/capture-renderer')
await fs.mkdir(output, { recursive: true })
const run = promisify(execFile), results = []
for (const mode of ['gpu', 'software']) {
  const profile = await fs.mkdtemp(path.join(output, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile)
  const settingsFile = path.join(profile, 'data/settings.json')
  const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'))
  await fs.writeFile(settingsFile, JSON.stringify({ ...settings, hardwareAcceleration: mode === 'gpu' }))
  let bootstrap = await fs.readFile(entry, 'utf8')
  bootstrap = bootstrap.replace('const NativeWindow = electron.BrowserWindow;', `
    const NativeWindow = electron.BrowserWindow;
    const nativeShow = NativeWindow.prototype.showInactive;
    global.__showCaptureFixture = w => nativeShow.call(w);
  `)
  await fs.writeFile(entry, bootstrap)
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, '--user-data-dir=' + profile], cwd: root, env })
  const result = { mode, captures: [], performance: [] }
  try {
    const mainPid = await app.evaluate(() => process.pid), page = await app.firstWindow()
    await page.waitForFunction(() => !!window.api?.timeWidgetOpen)
    const api = (name, ...args) => page.evaluate(([name, args]) => window.api[name](...args), [name, args])
    assert.equal((await api('timeWidgetOpen', { initial: 180, enable: false, showSeconds: true, showGift: false, theme: 'paper', startHotkey: { enabled: false, func: '无', key: '' }, endHotkey: { enabled: false, func: '无', key: '' } })).ok, true)
    let target
    for (let i = 0; i < 80 && !target; i++) { target = app.windows().find(p => p.url().includes('time-widget')); if (!target) await page.waitForTimeout(100) }
    assert.ok(target)
    await target.waitForFunction(() => document.getElementById('time')?.textContent === '180')
    const win = await app.browserWindow(target)
    await win.evaluate(w => { w.setPosition(50, 50); global.__showCaptureFixture(w) })
    await target.waitForTimeout(500)
    const handle = await win.evaluate(w => w.getNativeWindowHandle().readBigUInt64LE().toString())
    result.gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus())
    assert.equal(result.gpu.gpu_compositing, mode === 'software' ? 'disabled_software' : 'enabled', '保存的渲染选项必须在启动时生效')
    async function capture(label, method) {
      const file = path.join(output, `${mode}-${label}-${method}.png`)
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/capture-native-window.ps1'), '-WindowHandle', handle, '-ExpectedProcessId', String(mainPid), '-Path', file, '-Method', method], { windowsHide: true, timeout: 15000 })
      const stats = await app.evaluate(({ nativeImage }, file) => {
        const im = nativeImage.createFromPath(file), b = im.toBitmap()
        let black = 0, green = 0, content = 0
        for (let i = 0; i < b.length; i += 4) {
          if (b[i] < 5 && b[i + 1] < 5 && b[i + 2] < 5) black++
          else if (b[i] < 8 && b[i + 1] > 247 && b[i + 2] < 8) green++
          else content++
        }
        const n = b.length / 4
        return { ...im.getSize(), black: black / n, green: green / n, content: content / n }
      }, file)
      const captured = { label, method, ...stats, md5: createHash('md5').update(await fs.readFile(file)).digest('hex'), file }
      result.captures.push(captured)
      if (mode === 'software') assert.ok(captured.content > .5 && captured.green > .01, '软件合成必须采到挂件及绿底')
      console.log(JSON.stringify({ mode, ...captured }))
    }
    await capture('visible', 'bitblt')
    await capture('visible', 'print')
    const cover = await app.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({ x: 50, y: 50, width: 400, height: 300, frame: false, show: false, focusable: false, skipTaskbar: true, backgroundColor: '#ff00ff' })
      await w.loadURL('data:text/html,<html style="background:magenta">OCCLUDER</html>')
      global.__showCaptureFixture(w)
      return w.id
    })
    await target.waitForTimeout(300)
    await capture('occluded', 'bitblt')
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), cover)
    async function measure(target, label) {
      await app.evaluate(({ app }) => app.getAppMetrics())
      const frame = await target.evaluate(() => new Promise(resolve => {
        const intervals = []; let start, previous
        function tick(t) {
          start ??= t
          if (previous !== undefined) intervals.push(t - previous)
          previous = t
          if (t - start < 3000) requestAnimationFrame(tick)
          else { intervals.sort((a, b) => a - b); resolve({ fps: intervals.length * 1000 / (t - start), p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1) }) }
        }
        requestAnimationFrame(tick)
      }))
      const cpu = await app.evaluate(({ app }) => app.getAppMetrics().reduce((n, p) => n + p.cpu.percentCPUUsage, 0))
      assert.ok(frame.fps >= 30, label + ' 帧率不足 ' + frame.fps)
      result.performance.push({ label, ...frame, cpu })
    }
    for (const theme of ['paper', 'aurora']) {
      await api('timeWidgetUpdate', { theme })
      await target.waitForTimeout(300)
      result.performance.push({ theme, animationCount: await target.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length) })
      if (theme === 'aurora') { await capture('motion-1', 'bitblt'); await target.waitForTimeout(700); await capture('motion-2', 'bitblt') }
      await measure(target, '倒计时 ' + theme)
    }
    if (mode === 'software') assert.notEqual(result.captures.at(-1).md5, result.captures.at(-2).md5, '关闭 GPU 后流光仍应持续绘制')
    await api('timeWidgetUpdate', { enable: true, clockSpeed: 1000 })
    await target.waitForFunction(() => document.getElementById('time')?.textContent === '179')
    await api('timeWidgetClose')
    await api('register', 'render_qa', 'Fixture123!', '渲染测试')
    assert.equal((await api('login', 'render_qa', 'Fixture123!')).ok, true)
    await api('saveSettings', { guideSeen: true })
    await page.evaluate(() => { localStorage.setItem('zl-guide-seen', '1'); localStorage.setItem('zl-theme', 'amethyst') })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.querySelector('main'))
    const mainWindow = await app.browserWindow(page)
    await mainWindow.evaluate(w => { w.setBounds({x:60,y:350,width:1024,height:700}); global.__showCaptureFixture(w) })
    await page.evaluate(() => { location.hash = '/ent' })
    await page.waitForFunction(() => document.getAnimations().some(a => a.playState === 'running'))
    await measure(page, '客户端紫晶流光 1024x700')
    await api('entranceConfigure', { enabled: true, bannerSeconds: 8, bannerWidth: 640, bannerHeight: 180, rules: [{ id:'render', enabled:true, match:'any', text:'欢迎 {name}', dedupeSeconds:0 }] })
    await api('entranceOpen')
    let entrance
    for (let i = 0; i < 80 && !entrance; i++) { entrance = app.windows().find(p => p.url().includes('entrance-widget')); if (!entrance) await page.waitForTimeout(100) }
    assert.ok(entrance)
    const entranceWindow = await app.browserWindow(entrance)
    await entranceWindow.evaluate(w => { w.setPosition(50,50); global.__showCaptureFixture(w) })
    for (const effect of ['royal', 'phoenix', 'festival']) {
      await api('entranceConfigure', { bannerStyle: effect })
      assert.equal((await api('entranceTest', '知了猴大哥')).ok, true)
      await entrance.waitForFunction(effect => document.querySelector('.arrival')?.dataset.entranceEffect === effect, effect)
      await measure(entrance, '进场 ' + effect)
    }
    await api('entranceClose')
    console.log(JSON.stringify({ mode, gpu: result.gpu, performance: result.performance }))
  } catch (error) { result.error = String(error.stack || error); console.error(result.error) }
  finally { await app.close(); results.push(result); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2)) }
}
assert.ok(results.every(r => !r.error), '渲染对照失败，见 results.json')
console.log('渲染与动效对照 2/2 PASS')
