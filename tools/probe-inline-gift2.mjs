// 接着 probe-inline-gift：确认崩溃到底是不是 datalist 引起的，以及【窗口可见时会不会崩】。
// 后者决定这功能能不能上线——真机上主播是在可见窗口里打字的。
// 用法：node tools/probe-inline-gift2.mjs nolist|shown|hidden
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const mode = process.argv[2] || 'hidden'
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'probe-inline-gift2-' + mode)
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
let exitCode = null
app.process().on('exit', (code) => { exitCode = code })
const page = await app.firstWindow()
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

if (mode === 'shown') {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setOpacity(0.01) // 别真糊在用户屏幕上，但让它是「可见」窗口
    w.showInactive()
  })
  await page.waitForTimeout(600)
}
if (mode === 'nolist') {
  await page.evaluate(() => {
    document.querySelector('[aria-label="规则 甲一 的礼物名"]')?.removeAttribute('list')
  })
}

const box = page.getByLabel('规则 甲一 的礼物名')
console.log(`模式=${mode}  list 属性=${await box.getAttribute('list').catch(() => '?')}`)
let result = 'OK'
try {
  await box.fill('小心心')
  await page.waitForTimeout(600)
  console.log('fill 之后框里：', await box.inputValue())
  await box.press('Enter')
  await page.waitForTimeout(1200)
} catch (e) {
  result = 'CRASH: ' + e.message.split('\n')[0]
}
console.log(`结论[${mode}] ${result}  进程退出码=${exitCode ?? '还活着'}`)
await app.close().catch(() => {})
