// 保留真实主窗口采集保护和软件渲染，从 Chromium 提交的画面读取连续帧。
// 仅创建临时测试配置；不改用户实例，不关闭保护，也不依赖会被保护拦截的桌面截图。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
import { launchNativeElectron } from './native-electron-session.mjs'

const root = path.resolve(import.meta.dirname, '..'), run = promisify(execFile)
const packaged = process.argv.includes('--packaged')
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
const resources = path.join(root, `release/v${version}/win-unpacked/resources`), archive = path.join(resources, 'app.asar')
const output = path.join(root, 'output/playwright/login-native' + (packaged ? '-packaged' : ''))
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { visible: true, outDir: packaged ? path.join(archive, 'out') : 'out' })
let bootstrap = await fs.readFile(entry, 'utf8')
bootstrap = bootstrap.replace('const NativeWindow = electron.BrowserWindow;', "const NativeWindow = electron.BrowserWindow;global.__captureElectron=electron;global.__loginTestCrypto=require('node:crypto');global.__loginTestFs=require('node:fs/promises');")
if (packaged) bootstrap = bootstrap.replace(`electron.app.setAppPath(${JSON.stringify(root)});`, `electron.app.setAppPath(${JSON.stringify(archive)});Object.defineProperty(electron.app,'isPackaged',{get:()=>true});Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});`)
await fs.writeFile(entry, bootstrap)
const app = await launchNativeElectron(path.join(root, 'node_modules/electron/dist/electron.exe'), entry, profile, root)
const checks = []
const pass = (name, detail) => { checks.push({ name, detail }); console.log('PASS ' + name + ' | ' + JSON.stringify(detail)) }
try {
  let page
  for (let i = 0; i < 120; i++) {
    page = (await app.windows()).find(p => p.url().includes('/renderer/index.html'))
    if (page && await page.evaluate(() => !!document.querySelector('.cicada-body'))) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(page, '登录窗口没有出现')
  const win = await app.browserWindow(page), pid = await app.evaluate(() => process.pid)
  assert.equal(await app.evaluate(({ app }) => app.getGPUFeatureStatus().gpu_compositing), 'disabled_software')
  // 这一个临时测试窗口保持可见，避免 Codex/远程桌面切前台后触发 Chromium 遮挡节流。
  // 不写入任何设置，关闭测试实例即结束；产品默认仍不置顶。
  await win.evaluate(w => { w.setAlwaysOnTop(true); w.show(); w.focus() })
  const hwnd = await win.evaluate(w => w.getNativeWindowHandle().readBigUInt64LE().toString())
  const affinity = async () => {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/read-window-capture-affinity.ps1'), '-WindowHandle', hwnd, '-ExpectedProcessId', String(pid)], { windowsHide: true, timeout: 15000 })
    return JSON.parse(stdout)
  }
  const firstAffinity = await affinity()
  assert.equal(firstAffinity.affinity, 17)
  pass('原生主窗口保持软件渲染和采集保护', firstAffinity)

  for (const phase of ['visible', 'restore']) {
    if (phase === 'restore') {
      await win.evaluate(w => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('测试窗口最小化超时')), 5000)
        w.once('minimize', () => { clearTimeout(timer); resolve() })
        w.minimize()
      }))
      await win.evaluate(w => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('测试窗口还原超时')), 5000)
        w.once('restore', () => { clearTimeout(timer); resolve() })
        w.restore()
      }))
      await win.evaluate(w => w.focus())
    }
    const sample = await win.evaluate(async (w, { output, phase }) => {
      const { createHash } = global.__loginTestCrypto
      const fs = global.__loginTestFs
      const start = Date.now(), frames = [], intervals = []
      let count = 0, previous
      const hash = image => createHash('md5').update(image.toPNG()).digest('hex')
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(async () => {
            w.webContents.endFrameSubscription()
            try {
              for (const frame of frames) await fs.writeFile(frame.file, frame.png)
              intervals.sort((a, b) => a - b)
              resolve({ duration: Date.now() - start, frames: count, fps: count * 1000 / (Date.now() - start), p95: intervals[Math.floor(intervals.length * .95)] ?? null, max: intervals.at(-1) ?? null, images: frames.map(({ png, ...frame }) => frame) })
            } catch (error) { reject(error) }
          }, 4800)
          w.webContents.beginFrameSubscription(false, image => {
            try {
              const now = Date.now()
              count++
              if (previous !== undefined) intervals.push(now - previous)
              previous = now
              if (frames.length < 6 && now - start >= frames.length * 700) {
                const size = image.getSize()
                const rect = (x, y, width, height) => ({ x: Math.round(x * size.width), y: Math.round(y * size.height), width: Math.round(width * size.width), height: Math.round(height * size.height) })
                frames.push({ at: now - start, size, md5: hash(image), cicada: hash(image.crop(rect(.66, .28, .23, .57))), background: hash(image.crop(rect(.22, .03, .5, .17))), file: output + '/' + phase + '-' + frames.length + '.png', png: image.toPNG() })
              }
            } catch (error) { clearTimeout(timer); w.webContents.endFrameSubscription(); reject(error) }
          })
        })
      } finally { if (!w.isDestroyed()) w.webContents.endFrameSubscription() }
    }, { output: output.replaceAll('\\', '/'), phase })
    sample.window = await win.evaluate(w => ({ visible: w.isVisible(), minimized: w.isMinimized(), focused: w.isFocused(), bounds: w.getBounds(), testTopmost: w.isAlwaysOnTop() }))
    sample.document = await page.evaluate(() => ({ visibility: document.visibilityState, animations: document.getAnimations().map(a => ({ name: a.animationName, state: a.playState })) }))
    await fs.writeFile(path.join(output, phase + '.json'), JSON.stringify(sample, null, 2))
    assert.ok(sample.images.length >= 4, '原生窗口没有持续提交画面：' + JSON.stringify({ count: sample.frames, window: sample.window, document: sample.document }))
    for (const key of ['md5', 'cicada', 'background']) assert.ok(new Set(sample.images.map(f => f[key])).size >= 3, key + ' 原生截图重复/画面冻结')
    assert.equal((await affinity()).affinity, 17)
    pass(phase + '：原生蝉与背景画面连续变化，还原后继续播放', sample)
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ version, checks }, null, 2))
  console.log(`LOGIN NATIVE ${checks.length}/${checks.length} PASS`)
} finally { await app.close() }
