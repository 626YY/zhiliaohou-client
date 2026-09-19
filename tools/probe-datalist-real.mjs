// 最后一问：datalist 崩溃是【真实客户端的问题】，还是只是测试用的隐藏窗口引导脚本的问题？
// 前面几支探针都走 writeHiddenElectronBootstrap（窗口 show:false 后再 show），
// 这支直接起【正常的客户端】（就是主播用的那套窗口），再用真实按键敲礼物名。
//   崩 → 线上 0.3.22～0.3.30 主播在礼物动画/计数挑战/编辑规则里打礼物名就可能闪退，是 P0
//   不崩 → 只是测试环境的坑，功能本身没事，e2e 换个输入方式即可
// 用法：node tools/probe-datalist-real.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'probe-datalist-real')
await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 40_000
})
let exitCode = null
app.process().on('exit', (code) => { exitCode = code })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 40_000 })
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
await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 25_000 })
await page.evaluate(() => { window.location.hash = '#/ent' })
await page.waitForTimeout(1000)
for (let i = 0; i < 4; i++) {
  if (await page.getByRole('button', { name: '导入品游项目' }).count()) break
  const card = page.getByText('礼物触发', { exact: true }).first()
  if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(1000) }
}

const results = []
// ① 行内输入框（本轮新加）
try {
  const box = page.getByLabel('规则 甲一 的礼物名')
  await box.waitFor({ timeout: 15_000 })
  await box.click()
  await page.keyboard.type('小心心', { delay: 120 })
  await page.waitForTimeout(800)
  results.push(`行内输入框：OK（框里=${await box.inputValue()}）`)
} catch (e) {
  results.push('行内输入框：CRASH ' + e.message.split('\n')[0])
}
// ② 弹窗里那个一直都在的礼物名输入框（线上已有的）
try {
  await page.getByRole('button', { name: /新增规则/ }).click()
  const box = page.getByPlaceholder('如：火箭 / 小心心')
  await box.waitFor({ timeout: 15_000 })
  await box.click()
  await page.keyboard.type('火箭', { delay: 120 })
  await page.waitForTimeout(800)
  results.push(`弹窗礼物名：OK（框里=${await box.inputValue()}）`)
} catch (e) {
  results.push('弹窗礼物名：CRASH ' + e.message.split('\n')[0])
}
for (const r of results) console.log('  ' + r)
console.log('进程退出码=' + (exitCode ?? '还活着'))
await app.close().catch(() => {})
