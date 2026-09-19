// datalist 崩溃到底影响谁：只影响我新加的行内输入框，还是【弹窗里那个一直都在的礼物名输入框】也崩？
// 后者意味着线上 0.3.22～0.3.30 主播在「编辑规则」里打礼物名就可能整个客户端闪退——那是 P0。
// 这次用真实按键（keyboard.type，和主播打字最接近）+ 真正显示出来的窗口。
// 用法：node tools/probe-datalist-crash.mjs modal|inline
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const mode = process.argv[2] || 'modal'
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'probe-datalist-' + mode)
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
// 真正显示窗口（不是 setOpacity 那种半可见）
await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show() })
await page.waitForTimeout(500)
await page.evaluate(() => { window.location.hash = '#/ent' })
await page.waitForTimeout(800)
for (let i = 0; i < 4; i++) {
  if (await page.getByRole('button', { name: '导入品游项目' }).count()) break
  const card = page.getByText('礼物触发', { exact: true }).first()
  if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(900) }
}

let target
if (mode === 'modal') {
  // 打开「编辑规则」弹窗，用它那个一直都在的礼物名输入框
  await page.getByRole('button', { name: /新增规则/ }).click()
  await page.getByPlaceholder('如：火箭 / 小心心').waitFor({ timeout: 15_000 })
  target = page.getByPlaceholder('如：火箭 / 小心心')
} else {
  target = page.getByLabel('规则 甲一 的礼物名')
  await target.waitFor({ timeout: 15_000 })
}
console.log(`模式=${mode}  list=${await target.getAttribute('list').catch(() => '?')}`)

let result = 'OK'
try {
  await target.click()
  await page.waitForTimeout(300)
  // 真实按键，一个字一个字敲
  for (const ch of '小心心') {
    await page.keyboard.type(ch, { delay: 120 })
    await page.waitForTimeout(200)
  }
  console.log('敲完框里：', await target.inputValue())
} catch (e) {
  result = 'CRASH: ' + e.message.split('\n')[0]
}
console.log(`结论[${mode}] ${result}  进程退出码=${exitCode ?? '还活着'}`)
await app.close().catch(() => {})
