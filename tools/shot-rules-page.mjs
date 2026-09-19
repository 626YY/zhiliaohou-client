// 给礼物触发页拍张真实截图：确认「项目规则的开关做了俩」是哪两个（2026-09-08 用户反馈）。
// 用真实客户端窗口（不是隐藏窗口），导入两个夹具项目后截图。
// 用法：node tools/shot-rules-page.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'shot-rules')
await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

// 夹具素材库：两个项目，各 2 个条目
const lib = path.join(out, 'assets')
const { default: iconv } = await import('iconv-lite')
for (const [name, items] of [['甲项目', ['甲一', '甲二']], ['乙项目', ['乙一', '乙二']]]) {
  const dir = path.join(lib, name)
  await fs.mkdir(dir, { recursive: true })
  for (const item of items) {
    await fs.writeFile(path.join(dir, `${item}.mp4`), Buffer.from('zl-test'))
    await fs.writeFile(path.join(dir, `${item}.脚本`), iconv.encode('加班增加:60秒', 'gbk'))
  }
}

const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, pinyouAssetRoot: lib }))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 40_000
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {})
await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 40_000 })
await page.evaluate(async () => {
  await window.api.register('entertainment_regression', 'Fixture123!', '娱乐助手回归')
  await window.api.login('entertainment_regression', 'Fixture123!')
  await window.api.saveSettings({ guideSeen: true, autoLogin: false })
  localStorage.setItem('zl-guide-seen', '1')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 25_000 })
await page.evaluate(() => { window.location.hash = '#/ent' })
await page.waitForTimeout(900)
for (let i = 0; i < 4; i++) {
  if (await page.getByRole('button', { name: /导入项目$/ }).count()) break
  const card = page.getByText('礼物触发', { exact: true }).first()
  if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(1000) }
}
// 导入两个项目（按条目建规则）
await page.getByRole('button', { name: /导入项目$/ }).click()
await page.getByText('导入方式').waitFor({ timeout: 10_000 })
await page.getByRole('button', { name: '每个视频一条规则' }).click()
await page.getByRole('button', { name: /^导入 \d+ 条规则$/ }).click()
await page.waitForTimeout(2500)
// 给一条绑上礼物，好看清「已绑」和「未绑」两种样子
await page.evaluate(async () => {
  const list = await window.api.entertainmentRulesList()
  if (list[0]) await window.api.entertainmentRuleUpdate({ ...list[0], giftName: '小心心' })
})
await page.waitForTimeout(1200)
const file = path.join(out, 'rules-page.png')
await page.screenshot({ path: file, fullPage: true })
console.log('截图：' + file)
// 顺手把一行里的控件顺序打出来（截图看不清时用）
const row = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.rounded-lg.border')].filter((el) => el.querySelector('input[list], input[placeholder="填礼物名"]'))
  const first = rows[0]
  if (!first) return '没找到规则行'
  const bits = [...first.querySelectorAll('span,button,input,div')]
    .filter((el) => el.children.length === 0 || el.tagName === 'BUTTON' || el.tagName === 'INPUT')
    .map((el) => `${el.tagName}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''}:${(el.textContent || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').trim().slice(0, 14)}`)
  return bits.join(' | ')
})
console.log('一行里的控件：' + row)
const header = await page.evaluate(() => {
  const el = document.querySelector('[aria-label^="项目 "]')
  if (!el) return '没找到项目标题行'
  return [...el.querySelectorAll('span,button')].map((x) => `${x.tagName}${x.getAttribute('role') ? '[' + x.getAttribute('role') + ']' : ''}:${(x.textContent || x.getAttribute('aria-label') || '').trim().slice(0, 14)}`).join(' | ')
})
console.log('项目标题行控件：' + header)
await app.close().catch(() => {})
