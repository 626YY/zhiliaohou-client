// 特色整蛊详情页「麦克风测试」端到端：隐藏启动真实构建的客户端（独立 userData，不碰正式配置，不抢前台、静音），
// 用 Chromium 的假麦克风循环播放一段真实的「啪」（素材 caterpillar/slap.wav，峰值 −4 dB，垫着 −55 dB 底噪），
//   1. 声控拍蚊子详情页：「开始测试」后音量条在动、认出拍手（带一次灭几只）；「停止测试」后测试页关掉
//   2. 符咒封印详情页：听的是喊声，音量条在动；拍手的音量够不着默认阈值 240，不算喊
//   3. 手势拍蚊子默认是鼠标挥拍，不显示麦克风测试
// 用法：npx electron-vite build --outDir output/special-build && node tools/verify-mic-test-ui.mjs [--out=output/special-build]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outArg = process.argv.find((a) => a.startsWith('--out='))
const outDir = outArg ? outArg.slice(6) : 'output/special-build'
const output = path.join(root, 'output', 'playwright', 'mic-test-ui')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const userDataDir = await fs.mkdtemp(path.join(output, 'userdata-'))

// 假麦克风的声音文件：1.2 秒安静 + 每 0.9 秒一下「啪」×8（Chromium 循环播放）。
// 路径用纯英文（中文路径会让 Chromium 的假设备静默失败）
const SR = 48000
async function slapTrack() {
  const buf = await fs.readFile(path.join(root, 'assets/special-games/caterpillar/slap.wav'))
  let off = 12, fmt = null, data = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) }
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size)
    off += 8 + size + (size & 1)
  }
  assert.ok(fmt && data && fmt.bits === 16, '素材 wav 不是 16 位 PCM')
  const n = data.length / 2 / fmt.ch, src = new Float32Array(n)
  for (let i = 0; i < n; i++) src[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768
  // 换到 48 kHz（线性插值）并归一到峰值 −4 dB
  const m = Math.round(n * SR / fmt.rate), slap = new Float32Array(m)
  for (let j = 0; j < m; j++) { const x = j * fmt.rate / SR, i = Math.floor(x), f = x - i; slap[j] = i + 1 < n ? src[i] + (src[i + 1] - src[i]) * f : src[n - 1] }
  let pk = 0; for (const v of slap) pk = Math.max(pk, Math.abs(v))
  for (let j = 0; j < m; j++) slap[j] = slap[j] / pk * Math.pow(10, -4 / 20)
  const total = Math.round(SR * (1.2 + 8 * 0.9)), out = new Float32Array(total)
  let seed = 3
  for (let i = 0; i < total; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[i] = (seed / 0x7fffffff * 2 - 1) * 0.0031 }
  for (let k = 0; k < 8; k++) { const at = Math.round(SR * (1.2 + k * 0.9)); for (let j = 0; j < m && at + j < total; j++) out[at + j] += slap[j] }
  const wav = Buffer.alloc(44 + total * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(total * 2, 40)
  for (let i = 0; i < total; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2)
  const dir = 'C:\\kbshot\\zl-mictest'
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'slaps.wav')
  await fs.writeFile(file, wav)
  return file
}
const fakeWav = await slapTrack()

const entry = await writeHiddenElectronBootstrap(root, userDataDir, { outDir })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const errors = []
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox', '--mute-audio',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fakeWav}`],
  cwd: root,
  env,
  timeout: 40_000
})
const watch = (p) => {
  const where = () => p.url().split('/').pop()
  p.on('pageerror', (e) => errors.push(`[${where()}] ${e.message}`))
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${where()}] console: ${m.text()}`) })
}
app.on('window', watch)
const page = await app.firstWindow()
watch(page)
const api = (fn, arg) => page.evaluate(fn, arg)
let passed = 0
const ok = (msg) => { passed++; console.log('PASS ' + msg) }

async function capture(name) {
  const win = await app.browserWindow(page)
  for (let i = 0; i < 2; i++) {
    await win.evaluate((w) => w.webContents.invalidate())
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.waitForTimeout(250)
  }
  const png = await win.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png))
}
async function until(fn, what, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await page.waitForTimeout(200)
  }
  throw new Error('等待超时：' + what)
}
const box = () => page.locator('[data-mictest]')
const readMeter = () => page.evaluate(() => {
  const el = document.querySelector('[data-mictest]')
  if (!el) return null
  const t = el.textContent || ''
  const num = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null }
  return { now: num(/现在\s*(\d+)/), peak: num(/最近最响\s*(\d+)/), hits: (t.match(/✓ 认出/g) || []).length, text: t.slice(0, 400), frames: document.querySelectorAll('iframe[src*="mictest"]').length }
})

try {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 20_000 })
  const login = await api(async () => {
    await window.api.register('mictest_regression', 'Fixture123!', '麦克风测试回归')
    const r = await window.api.login('mictest_regression', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('zl_configuration_level', 'advanced')
    return r
  })
  assert.equal(login.ok, true, login.error || '本地测试账号登录失败')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 20_000 })
  const mainWin = await app.browserWindow(page)
  await mainWin.evaluate((w) => w.setContentSize(1440, 1000))

  // ---- 1. 声控拍蚊子 ----
  await api(() => { window.location.hash = '#/special?tool=mosquito' })
  await box().waitFor({ timeout: 15_000 })
  assert.equal((await readMeter()).frames, 0, '没点开始前不该开测试页（麦克风）')
  await box().getByRole('button', { name: '开始测试' }).click()
  await until(async () => ((await readMeter())?.peak ?? 0) > 100, '音量条动起来')
  await until(async () => ((await readMeter())?.hits ?? 0) >= 2, '认出拍手', 20_000)
  const m = await readMeter()
  assert.match(m.text, /一次灭 \d+ 只/, `认出拍手应带一次灭几只：${m.text}`)
  await box().scrollIntoViewIfNeeded()
  await capture('01-mosquito-mictest')
  ok(`声控拍蚊子：开始测试后音量条在动（最近最响 ${m.peak}），认出拍手 ${m.hits} 次`)
  await box().getByRole('button', { name: '停止测试' }).click()
  await until(async () => (await readMeter()).frames === 0, '停止后测试页关掉')
  ok('停止测试：测试页关掉（麦克风释放）')

  // ---- 2. 符咒封印：听喊声 ----
  await api(() => { window.location.hash = '#/special?tool=talisman_seal' })
  await until(async () => (await page.locator('[data-mictest="shout"]').count()) > 0, '符咒的麦克风测试')
  await box().getByRole('button', { name: '开始测试' }).click()
  await until(async () => ((await readMeter())?.peak ?? 0) > 100, '音量条动起来')
  await page.waitForTimeout(3000)
  const t = await readMeter()
  assert.equal(t.hits, 0, `拍手的音量（约 ${t.peak}）够不着默认阈值 240，不该算喊：${t.text}`)
  assert.match(t.text, /阈值 240/, '应该画出阈值线 240')
  await box().scrollIntoViewIfNeeded()
  await capture('02-talisman-mictest')
  ok(`符咒封印：音量条在动（最近最响 ${t.peak}），没到默认阈值 240 不算喊`)
  await box().getByRole('button', { name: '停止测试' }).click()

  // ---- 3. 手势拍蚊子：默认鼠标挥拍，不显示 ----
  await api(() => { window.location.hash = '#/special?tool=big_mosquito' })
  await page.getByText('玩法设置').first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(500)
  assert.equal(await box().count(), 0, '鼠标挥拍模式不该显示麦克风测试')
  ok('手势拍蚊子：默认鼠标挥拍，不显示麦克风测试')

  const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && (w.isVisible() || w.isFocused())).length)
  assert.equal(shown, 0, '测试全程窗口不可见、不聚焦')
  ok('全程窗口不可见、不聚焦')
} catch (e) {
  console.log('FAIL ' + (e && e.message))
  process.exitCode = 1
  await capture('fail').catch(() => {})
} finally {
  await app.close().catch(() => {})
}
if (errors.length) { console.log('\n页面错误：'); for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e) }
console.log(`\nMIC TEST UI: ${passed} PASS${process.exitCode ? '，有失败' : ''}${errors.length ? `，页面错误 ${errors.length}` : ''}  截图：${output}`)
if (errors.length) process.exitCode = 1
