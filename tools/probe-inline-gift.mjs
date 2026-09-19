// 定位「往行内礼物名输入框里 fill 就把隐藏窗口带走」的原因（2026-09-08）。
// 假设 A：输入框挂着 datalist（146 个候选），聚焦时 Chromium 要弹原生候选框，隐藏窗口里出事。
// 假设 B：渲染进程崩了（窗口销毁 → window-all-closed → 整个 app 退出）。
// 办法：把主进程侧的 render-process-gone / child-process-gone / 窗口销毁都挂上钩子打日志，
//       再分别用 evaluate 直接改 value（不聚焦）和 fill（要聚焦）两种方式试。
// 用法：node tools/probe-inline-gift.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'probe-inline-gift')
await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({ guideSeen: true }))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000
})
app.process().on('exit', (code, signal) => console.log(`!! electron 进程退出 code=${code} signal=${signal}`))

// 主进程侧钩子：谁死了、怎么死的
await app.evaluate(({ app: a, BrowserWindow }) => {
  a.on('render-process-gone', (_e, wc, details) => console.log('MAIN render-process-gone ' + JSON.stringify(details)))
  a.on('child-process-gone', (_e, details) => console.log('MAIN child-process-gone ' + JSON.stringify(details)))
  a.on('window-all-closed', () => console.log('MAIN window-all-closed'))
  for (const w of BrowserWindow.getAllWindows()) {
    w.on('closed', () => console.log('MAIN window closed id=' + w.id))
  }
})
app.on('console', (m) => console.log('[主进程 console] ' + m.text()))

const page = await app.firstWindow()
page.on('crash', () => console.log('!! page crash'))
page.on('pageerror', (e) => console.log('!! pageerror ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('[页面 error] ' + m.text().slice(0, 200)) })

await page.waitForFunction(() => Boolean(window.api?.login))
await page.evaluate(async () => {
  await window.api.register('entertainment_regression', 'Fixture123!', '娱乐助手回归')
  await window.api.login('entertainment_regression', 'Fixture123!')
  await window.api.saveSettings({ guideSeen: true, autoLogin: false })
  localStorage.setItem('zl-guide-seen', '1')
  await window.api.entertainmentRuleAdd({
    id: '', name: '甲一', giftName: '', group: '甲项目', enabled: false, triggerType: 'gift',
    actionType: 'command', commandCmd: 'video-play', commandParam: 'C:/x/甲一.mp4|0'
  })
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 20_000 })
await page.evaluate(() => { window.location.hash = '#/ent' })
await page.waitForTimeout(800)
for (let i = 0; i < 4; i++) {
  if (await page.getByRole('button', { name: '导入品游项目' }).count()) break
  const card = page.getByText('礼物触发', { exact: true }).first()
  if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(900) }
}
const box = page.getByLabel('规则 甲一 的礼物名')
console.log('输入框在不在：', await box.count())
console.log('它的 list 属性：', await box.getAttribute('list').catch(() => '读不到'))

// ---- 试法 1：不聚焦，直接用原生 setter 改 value + 派发 input（React 也认）----
try {
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="规则 甲一 的礼物名"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, '小心心')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(500)
  console.log('试法1（不聚焦改值）OK，框里现在是：', await box.inputValue())
} catch (e) {
  console.log('试法1 失败：', e.message.split('\n')[0])
}

// ---- 试法 2：focus（会不会就是聚焦触发 datalist 弹窗）----
try {
  await box.focus()
  await page.waitForTimeout(800)
  console.log('试法2（focus）OK，activeElement=', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
} catch (e) {
  console.log('试法2 失败：', e.message.split('\n')[0])
}

// ---- 试法 3：fill ----
try {
  await box.fill('棒棒糖')
  await page.waitForTimeout(800)
  console.log('试法3（fill）OK，框里：', await box.inputValue())
} catch (e) {
  console.log('试法3 失败：', e.message.split('\n')[0])
}

// ---- 试法 4：按回车 ----
try {
  await box.press('Enter')
  await page.waitForTimeout(1200)
  console.log('试法4（回车）OK')
} catch (e) {
  console.log('试法4 失败：', e.message.split('\n')[0])
}

console.log('还活着的窗口：', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch((e) => '读不到 ' + e.message.split('\n')[0]))
await app.close().catch(() => {})
