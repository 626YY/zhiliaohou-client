// 完整当前构建：真实登录/路由/React/preload/IPC；独立配置，隐藏窗口，不连接游戏。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output/playwright/lottery-app')
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env })
const checks = [], errors = []
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function until(query, message) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await query()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(message)
}
const page = await app.firstWindow()
app.on('window', w => w.on('pageerror', e => errors.push(e.message)))
page.on('pageerror', e => errors.push(e.message))
async function shot(target, name) {
  const native = await app.browserWindow(target)
  const size = await native.evaluate(win => win.getContentSize())
  // 隐藏窗口可能仍缓存上一个合成帧；轻微调整本测试窗口促使已更新的 React DOM 重新绘制。
  await native.evaluate((win, dimensions) => win.setContentSize(dimensions[0] + 1, dimensions[1]), size)
  await target.waitForFunction(width => innerWidth === width, size[0] + 1)
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await target.waitForTimeout(150)
  try {
    const png = await native.evaluate(async win => Array.from((await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
    await fs.writeFile(path.join(out, name), Buffer.from(png))
  } finally { await native.evaluate((win, dimensions) => win.setContentSize(...dimensions), size) }
}
async function output(kind) {
  const suffix = `lottery-${kind}.html`
  for (let i = 0; i < 50; i++) {
    const win = app.windows().find(w => w.url().includes(suffix))
    if (win) { await win.waitForLoadState('domcontentloaded'); return win }
    await page.waitForTimeout(100)
  }
  throw new Error('Missing output ' + suffix)
}
try {
  await page.waitForFunction(() => !!window.api?.login)
  const nativeInventory = await app.evaluate(({ BrowserWindow, BaseWindow }) => ({ browser: BrowserWindow.getAllWindows().length, base: BaseWindow.getAllWindows().length }))
  assert.ok(nativeInventory.browser > 0, JSON.stringify(nativeInventory))
  const logged = await page.evaluate(async () => {
    await window.api.register('lottery_app_regression', 'Fixture123!', '抽奖回归')
    const result = await window.api.login('lottery_app_regression', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, gamePath: '', autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('ent-wheel-items', JSON.stringify([{ name: '清零计时', color: '#d6a74c', action: 'countdown-clear' }]))
    localStorage.setItem('ent-wheel-trigger', JSON.stringify({ autoSpin: true, triggerGift: '玫瑰' }))
    localStorage.setItem('ent-nine-cells', JSON.stringify(Array.from({ length: 9 }, (_, i) => i === 4 ? '开始' : '增加七秒')))
    localStorage.setItem('ent-nine-actions', JSON.stringify(Array.from({ length: 9 }, () => ({ action: 'countdown-adjust', actionParam: '7' }))))
    return result
  })
  assert.equal(logged.ok, true, logged.error)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '娱乐助手', exact: true }).click()
  await page.getByRole('button', { name: /转盘抽奖/ }).click()
  await page.getByText('转盘奖项', { exact: true }).waitFor()
  check('完整应用仅一套转盘操作区', await page.getByRole('button', { name: '转起来', exact: true }).count() === 1 && await page.getByRole('button', { name: '转盘窗口', exact: true }).count() === 1)
  // 保存反馈：主播要看得见「设置成功没」
  const saveState = page.getByTestId('lottery-save-state')
  await saveState.waitFor()
  check('转盘页有保存状态灯和保存按钮', await page.getByRole('button', { name: '保存', exact: true }).count() === 1)
  await page.getByRole('switch', { name: '中心图跟着触发礼物走' }).click()
  await page.waitForFunction(() => /^已保存 \d{2}:\d{2}:\d{2}$/.test(document.querySelector('[data-testid="lottery-save-state"]')?.textContent?.trim() || ''))
  check('改动后状态灯显示「已保存 时:分:秒」', /^已保存 \d{2}:\d{2}:\d{2}$/.test((await saveState.textContent()).trim()))
  check('关掉「中心图跟着触发礼物走」写进了本地配置', (await page.evaluate(() => JSON.parse(localStorage.getItem('ent-wheel-trigger') || '{}'))).centerGift === false)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '已保存', exact: true }).waitFor({ timeout: 5000 })
  check('点保存按钮给「已保存」确认提示')
  await page.getByRole('switch', { name: '中心图跟着触发礼物走' }).click()
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('ent-wheel-trigger') || '{}')).centerGift === true)
  check('再打开开关又存回 true（开关即时生效）')
  check('奖项动作区有「视频铺在抽奖窗口里播」开关且默认开', await page.getByRole('switch', { name: '抽中的视频铺在抽奖窗口里播' }).getAttribute('aria-checked') === 'true')
  const premiumAsset = path.join(root, 'out/renderer/entertainment-assets/wheel-premium-bg.png')
  check('构建保留昨夜原高级素材', createHash('sha256').update(await fs.readFile(premiumAsset)).digest('hex') === 'c17337b0f50d1b940ebeeb55cd373baadf1b7317fe33d0beb8641ea29ad7ee77')
  await page.waitForFunction(async () => {
    const preview = document.querySelector('.lottery-premium-preview')
    if (!preview) return false
    const url = getComputedStyle(preview).backgroundImage.match(/^url\(["']?(.+?)["']?\)$/)?.[1]
    if (!url) return false
    const image = new Image(); image.src = url
    try { await image.decode(); return image.naturalWidth === 1024 } catch { return false }
  })
  check('完整页面高级背景实际解码成功')
  const timerOpen = await page.evaluate(() => window.api.timeWidgetOpen({ initial: 100, enable: false }))
  assert.equal(timerOpen.ok, true, timerOpen.error)
  assert.equal((await page.evaluate(() => window.api.timeWidgetState())).remaining, 100, '计时测试先从100秒开始')
  await page.getByRole('button', { name: '转盘窗口', exact: true }).click()
  const lucky = await output('lucky')
  check('唯一窗口为升级幸运转盘', await (await app.browserWindow(lucky)).evaluate(w => w.getTitle()) === '幸运转盘')
  const legacy = await page.evaluate(() => window.api.lotteryOpen('wheel', [{ name: '清零计时', color: '#d6a74c', action: 'countdown-clear' }]))
  check('旧规则接口复用唯一升级窗口', legacy.ok && app.windows().filter(w => /lottery-(wheel|lucky)\.html/.test(w.url())).length === 1)
  await lucky.waitForFunction(() => !!document.querySelector('#wheel'))
  await lucky.waitForFunction(async () => {
    const url = getComputedStyle(document.querySelector('#stage')).backgroundImage.match(/^url\(["']?(.+?)["']?\)$/)?.[1]
    if (!url?.includes('wheel-premium-bg.png')) return false
    const image = new Image(); image.src = url
    try { await image.decode(); return image.naturalWidth === 1024 } catch { return false }
  })
  check('采集页面原高级背景实际解码成功')
  await page.getByRole('button', { name: '转起来', exact: true }).click()
  await until(() => page.evaluate(async () => ['result', 'error'].includes((await window.api.lotteryState()).draws?.wheel?.phase)), '等待转盘实际结果超时')
  await until(() => page.evaluate(async () => (await window.api.timeWidgetState()).remaining === 0), '中奖未清零计时')
  const result = await page.evaluate(() => window.api.lotteryState())
  assert.equal(result.draws.wheel.phase, 'result', JSON.stringify(result.draws.wheel))
  check('完整应用按钮经真实IPC执行中奖动作', result.draws.wheel.item.name === '清零计时')
  await page.getByText('抽中：清零计时', { exact: true }).first().waitFor({ timeout: 5000 })
  await lucky.waitForFunction(() => document.querySelector('#result')?.textContent.includes('清零计时'))
  await shot(page, 'single-premium-page.png'); await shot(lucky, 'premium-output.png')
  await page.evaluate(() => window.api.timeWidgetClose())
  await page.evaluate(() => window.api.timeWidgetOpen({ initial: 100, enable: false }))
  await page.evaluate(() => window.api.connectorSimulate('礼物: 玫瑰 ×1  by 测试观众'))
  await until(() => page.evaluate(async () => (await window.api.timeWidgetState()).remaining === 0), '礼物抽奖未清零计时')
  check('礼物触发复用同一套中奖动作')
  await page.getByRole('button', { name: /返回功能列表/ }).first().click()
  await page.getByRole('button', { name: /九宫格转盘/ }).click()
  await page.getByTestId('lottery-save-state').waitFor()
  await page.waitForFunction(() => !(document.querySelector('[data-testid="lottery-save-state"]')?.textContent || '').includes('保存中'))
  check('九宫格页也有保存状态灯和保存按钮', /^(已保存|改完自动保存)/.test((await page.getByTestId('lottery-save-state').textContent()).trim()) && await page.getByRole('button', { name: '保存', exact: true }).count() === 1, (await page.getByTestId('lottery-save-state').textContent()).trim())
  await page.getByRole('button', { name: '九宫格窗口', exact: true }).click()
  const nine = await output('nine')
  await page.getByRole('button', { name: '转起来', exact: true }).click()
  await until(() => page.evaluate(async () => (await window.api.timeWidgetState()).remaining === 7), '九宫格中奖未增加七秒')
  check('九宫格完整页面执行整秒中奖事件')
  await page.getByText('抽中：增加七秒', { exact: true }).first().waitFor({ timeout: 5000 })
  await shot(page, 'upgraded-nine-page.png'); await shot(nine, 'upgraded-nine-output.png')
  check('全部测试窗口隐藏且没有焦点', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible() && !w.isFocused())))
  assert.deepEqual(errors, [])
  const build = path.join(root, 'out/main/index.js')
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ checks, errors, profile, build,
    buildModified: (await fs.stat(build)).mtime.toISOString(), buildSha256: createHash('sha256').update(await fs.readFile(build)).digest('hex')
  }, null, 2))
  console.log(`Full application lottery regression: ${checks.length}/${checks.length} PASS`)
} catch (e) {
  console.error('Lottery failure:', page.url(), await page.evaluate(async () => ({ lottery: await window.api.lotteryState(), timer: await window.api.timeWidgetState() })).catch(() => ({})))
  await shot(page, 'failure.png').catch(() => {})
  throw e
} finally { await app.close() }
