// 进程模式 + 页面自动恢复验证（隔离 userData、隐藏窗口、不碰真游戏）：
//   1. 省内存模式（默认 processMode=lean）：主界面 + 绿幕 + 进场横幅全开后，页面进程（Tab）只有 1 个
//   2. 强杀绿幕页面进程 → 同一窗口自动重载：窗口句柄不变、标题不变、页面 URL 不变、不再 crashed、main.log 有 [recover]
//   3. 主窗口页面进程强杀 → 同样自动重载，句柄不变
//   4. 10 分钟内第 4 次崩溃不再自动救（防无限重载）
//   5. 稳定模式（processMode=stable）：Tab 进程数 = 窗口数
// 用法：node tools/verify-widget-recover.mjs   （先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'widget-recover')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const results = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function check(name, fn) { try { const d = await fn(); results.push(true); console.log(`PASS ${name}${typeof d === 'string' && d ? '  ' + d : ''}`) } catch (e) { results.push(false); console.log(`FAIL ${name}  ${e?.message || e}`) } }
async function waitFor(fn, label, timeout = 15_000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await fn()) return } catch { /* 再等 */ } await sleep(250) } throw new Error('等超时：' + label) }

async function launch(mode) {
  await fs.mkdir(outputDir, { recursive: true })
  const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  const entry = await writeHiddenElectronBootstrap(root, profile)
  const settingsPath = path.join(profile, 'data', 'settings.json')
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
  settings.processMode = mode
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  await page.evaluate(async () => { await window.api.register('recover_user', 'Fixture123!', '恢复'); await window.api.login('recover_user', 'Fixture123!'); await window.api.saveSettings({ guideSeen: true, autoLogin: false }); localStorage.setItem('zl-guide-seen', '1') })
  const log = path.join(profile, 'logs', 'main.log')
  return { app, page, log }
}
async function openWidgets(page) {
  await page.evaluate(() => window.api.greenScreenClose()); await sleep(200)
  const g = await page.evaluate(() => window.api.greenScreenOpen('', 'video', '', 1)); assert.equal(g.ok, true, '绿幕 1')
  await page.evaluate(() => window.api.entranceConfigure({ enabled: true, bannerStyle: 'gold', rules: [{ id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }] }))
  const e = await page.evaluate(() => window.api.entranceOpen()); assert.equal(e.ok, true, '进场')
  await sleep(2500)
}
// 崩溃后 Playwright 到主进程的求值偶尔挂死不回：所有主进程求值加 15 秒超时，别让整条流水线卡住
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('主进程求值超时：' + label)), ms))])
const snapshot = app => withTimeout(app.evaluate(({ app, BrowserWindow }) => ({
  tabs: app.getAppMetrics().filter(m => m.type === 'Tab').length,
  windows: BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => ({ title: w.getTitle(), hwnd: w.getNativeWindowHandle().toString('hex'), url: w.webContents.getURL().split('/').pop(), crashed: w.webContents.isCrashed(), pid: w.webContents.getOSProcessId() }))
})), 15_000, 'snapshot')
// 崩之前先等页面真的加载完（重载刚开始时渲染进程还在建，这时候强杀会被 Chromium 吞掉、没有事件）
const pageAlive = (app, title) => withTimeout(app.evaluate(({ BrowserWindow }, t) => { const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === t); if (!w || w.isDestroyed()) return false; const wc = w.webContents; if (wc.isCrashed() || wc.isLoading()) return false; return wc.executeJavaScript('1').then(() => true).catch(() => false) }, title), 15_000, 'pageAlive')
const crashWindow = async (app, title) => {
  await waitFor(() => pageAlive(app, title), '页面就绪再崩 ' + title, 20_000)
  await withTimeout(app.evaluate(({ BrowserWindow }, t) => { const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === t); if (!w) throw new Error('no window ' + t); w.webContents.forcefullyCrashRenderer() }, title), 15_000, 'crash')
}
async function quit(app) { try { await app.evaluate(({ app }) => app.quit()) } catch { /* 已退出 */ } await sleep(1500) }

// ---------- 省内存模式 ----------
{
  const { app, page, log } = await launch('lean')
  await openWidgets(page)
  const before = await snapshot(app)
  const green = before.windows.find(w => /绿幕/.test(w.title)), banner = before.windows.find(w => /entrance-widget/.test(w.url)), main = before.windows.find(w => /index\.html/.test(w.url))
  await check('lean：主界面 + 绿幕 + 进场共 3 个窗口，页面进程只有 1 个', async () => {
    assert.ok(green && banner && main, JSON.stringify(before.windows))
    assert.equal(before.tabs, 1, `Tab 进程 ${before.tabs}`)
    assert.equal(new Set(before.windows.map(w => w.pid)).size, 1)
    return `窗口 ${before.windows.length}，Tab 进程 ${before.tabs}`
  })
  await crashWindow(app, green.title)
  await check('lean：强杀绿幕页面进程 → 自动重载，句柄 / 标题 / URL 不变，页面活着', async () => {
    await waitFor(async () => /\[recover\] 窗口「.*」页面进程 (crashed|killed|abnormal-exit)/.test(await fs.readFile(log, 'utf8')), '[recover] 行')
    await waitFor(async () => { const s = await snapshot(app); const g = s.windows.find(w => w.hwnd === green.hwnd); return g && !g.crashed && /green/.test(g.url) }, '绿幕页面恢复')
    const after = await snapshot(app)
    const g = after.windows.find(w => w.hwnd === green.hwnd)
    assert.ok(g, '句柄变了'); assert.equal(g.title, green.title); assert.equal(g.url, green.url); assert.equal(g.crashed, false)
    return `hwnd ${green.hwnd} 不变`
  })
  await check('lean：同进程的进场横幅与主界面也一起恢复（句柄不变、页面活着）', async () => {
    await waitFor(async () => { const s = await snapshot(app); return s.windows.every(w => !w.crashed) }, '全部恢复')
    const after = await snapshot(app)
    for (const w of [banner, main]) { const x = after.windows.find(y => y.hwnd === w.hwnd); assert.ok(x, '句柄变了 ' + w.title); assert.equal(x.crashed, false) }
    // Playwright 原来那个 page 句柄跟着崩溃的渲染进程作废了（Target crashed），改从主进程里问主窗口页面是否重新活了
    await waitFor(() => withTimeout(app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => /index\.html/.test(x.webContents.getURL())); return w ? w.webContents.executeJavaScript('!!window.api && !!document.querySelector("#root")').catch(() => false) : false }), 15_000, 'main-alive'), '主界面重新渲染')
  })
  await check('lean：10 分钟内第 4 次崩溃不再自动救', async () => {
    // 第 1 次在上一项已经救过；再崩 2 次都该救回来，第 4 次不救
    for (let i = 0; i < 2; i++) { await crashWindow(app, green.title); await waitFor(async () => { const s = await snapshot(app); const g = s.windows.find(w => w.hwnd === green.hwnd); return g && !g.crashed }, `第 ${i + 2} 次恢复`, 20_000); await sleep(800) }
    const before = ((await fs.readFile(log, 'utf8')).match(/render-process-gone/g) || []).length
    await crashWindow(app, green.title)
    await waitFor(async () => ((await fs.readFile(log, 'utf8')).match(/render-process-gone/g) || []).length > before, '第 4 次崩溃事件', 10_000)
    await sleep(1500)
    const text = await fs.readFile(log, 'utf8')
    assert.match(text, /不再自动救/)
    const g = (await snapshot(app)).windows.find(w => w.hwnd === green.hwnd)
    assert.ok(g && g.crashed, '第 4 次不该再救')
  })
  await check('lean：反复崩溃后自动把进程模式切回 stable（兼容自适应，下次启动生效）', async () => {
    const text = await fs.readFile(log, 'utf8'); assert.match(text, /已自动把「进程模式」切回每窗口独立进程/)
    const settings = JSON.parse(await fs.readFile(path.join(path.dirname(log), '..', 'data', 'settings.json'), 'utf8'))
    assert.equal(settings.processMode, 'stable')
  })
  await quit(app)
}

// ---------- 稳定模式 ----------
{
  const { app, page } = await launch('stable')
  await openWidgets(page)
  await check('stable：每个窗口独立页面进程（Tab 进程数 = 窗口数）', async () => { const s = await snapshot(app); assert.equal(s.tabs, s.windows.length, JSON.stringify(s)); return `窗口 ${s.windows.length}，Tab 进程 ${s.tabs}` })
  await quit(app)
}

const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS`)
process.exit(bad ? 1 : 0)
