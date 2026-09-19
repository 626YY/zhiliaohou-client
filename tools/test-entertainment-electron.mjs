// 娱乐助手 Electron 回归：真起一个 Electron 实例（独立 userData），按主播真实用法走一遍。
// 覆盖：内置礼物图与 catalog 一致性（含道具/组合装过滤）、透明图「整蛊竖列」批量填写→出图落盘、
//       倒计时 7 种时间格式与真实走秒、礼物动画/大哥进场/整蛊排队/积分心愿/飘屏/键盘显示/保护主播 的主进程链路。
// 用法：npm run test:entertainment
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'entertainment-regression')
let userDataDir
const hidden = process.argv.includes('--hidden')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const errors = []

function attachErrors(page) {
  // 带上窗口 URL：挂件窗口有十来个，不然出错只知道「某个页面」
  const where = () => page.url().split('/').pop()
  page.on('pageerror', (error) => errors.push(`[${where()}] ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const loc = message.location()
      errors.push(`[${where()}] console: ${message.text()}${loc?.url ? ` @ ${loc.url}` : ''}`)
    }
  })
}

// 把 shared/giftFilter.ts 原样编译进来：断言用的过滤规则必须和客户端跑的是同一份
async function loadGiftFilter() {
  const esbuild = await import('esbuild')
  const source = await fs.readFile(path.join(root, 'src', 'shared', 'giftFilter.ts'), 'utf8')
  const { code } = await esbuild.transform(source, { loader: 'ts', format: 'esm' })
  const tmp = path.join(outputDir, 'giftFilter.mjs')
  await fs.writeFile(tmp, code)
  return import(pathToFileURL(tmp).href)
}

async function waitForApiState(page, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    // contextBridge 返回的跨上下文 Promise 不能作为页面轮询的真值；在 Node 侧等待 IPC 结果。
    if (await page.evaluate(predicate)) return
    await page.waitForTimeout(100)
  }
  throw new Error(`等待主进程状态超时：${predicate}`)
}

async function ensureTestSession(page) {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  const result = await page.evaluate(async () => {
    const username = 'entertainment_regression'
    const password = 'Fixture123!'
    await window.api.register(username, password, '娱乐助手回归')
    const login = await window.api.login(username, password)
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    // 首次使用向导看的是这两处任一：设置落盘 + 本地标记都打上，重载后绝不会掉进向导页
    localStorage.setItem('zl-guide-seen', '1')
    return login
  })
  assert.equal(result.ok, true, result.error || '本地测试账号登录失败')
  await waitForApiState(page, () => window.api.getSettings().then((r) => (r.settings ?? r).guideSeen === true))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 15_000 })
}

function widgetConfig(initial, overrides = {}) {
  return {
    on: false,
    enable: false,
    title: '格式回归',
    initial,
    clockSpeed: 1000,
    addGift: '请吃鸡',
    addSeconds: 60,
    subGift: '棒棒糖',
    subSeconds: 30,
    autoHide: false,
    showGift: true,
    showNegative: initial < 0,
    showSeconds: false,
    zeroText: '时间到',
    bgImage: '',
    theme: '1',
    titleColor: '#ffffff',
    timeColor: '#ffffff',
    startHotkey: { enabled: false, func: '无', key: '' },
    endHotkey: { enabled: false, func: '无', key: '' },
    posX: 200,
    posY: 30,
    ...overrides
  }
}

function findWindow(app, mainPage, urlPart) {
  return app.windows().find((page) => page !== mainPage && page.url().includes(urlPart))
}

async function waitWindow(app, mainPage, urlPart, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = findWindow(app, mainPage, urlPart)
    if (found) {
      await found.waitForLoadState('domcontentloaded').catch(() => {})
      return found
    }
    await mainPage.waitForTimeout(150)
  }
  throw new Error(`挂件窗口没出现：${urlPart}`)
}

async function openTimeCase(app, mainPage, initial, expected, overrides = {}) {
  await mainPage.evaluate(() => window.api.timeWidgetClose())
  await waitForApiState(mainPage, () => window.api.timeWidgetState().then((state) => !state.open))
  await mainPage.waitForTimeout(100)
  const result = await mainPage.evaluate((cfg) => window.api.timeWidgetOpen(cfg), widgetConfig(initial, overrides))
  assert.equal(result.ok, true, result.error || `倒计时窗口打开失败：${initial}`)
  await waitForApiState(mainPage, () => window.api.timeWidgetState().then((state) => state.open))
  const widget = await waitWindow(app, mainPage, 'time-widget')
  attachErrors(widget)
  await widget.locator('#time').waitFor({ timeout: 10_000 })
  await widget.waitForFunction((text) => document.querySelector('#time')?.textContent === text, expected)
  assert.equal(await widget.locator('#time').textContent(), expected)
  // 设置页预览必须和挂件一字不差：两边曾各写一套格式化，预览显示 00:05:00 而挂件显示 05:00，
  // 主播照预览调好的排版一上播就变样。现在共用 shared/countdownTime，这条断言防止再分家。
  // 预览靠主进程推的挂件状态更新（每秒一拍），挂件窗口先到、设置页后到，读太快会拿到上一个用例的数字；
  // 等最多 3 秒让预览追上，再一字不差地比。
  const readPreview = () => mainPage
    .getByTestId('time-preview-value')
    .textContent()
    .then(text => text?.trim() ?? '')
    .catch(() => null)
  let preview = await readPreview()
  for (let i = 0; i < 20 && preview !== null && preview !== expected; i++) {
    await mainPage.waitForTimeout(150)
    preview = await readPreview()
  }
  // 带 overrides 的用例（显示负数 / 直接显示秒数）只经 IPC 推给挂件，设置页自己的开关没跟着改，
  // 两边本来就该不同，跳过；不带 overrides 的用例两边配置一致，必须一字不差。
  if (preview !== null && preview !== '' && initial >= 0 && Object.keys(overrides).length === 0) {
    assert.equal(preview, expected, `倒计时预览「${preview}」和挂件「${expected}」对不上`)
  }
  return widget
}

// 用 keybd_event 注入一个无副作用的键（F13），验证键盘钩子真收到了
function injectF13() {
  const ps = "Add-Type -Namespace W -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';" +
    '[W.K]::keybd_event(124,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120; [W.K]::keybd_event(124,0,2,[UIntPtr]::Zero)'
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30_000 })
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  userDataDir = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  const { isRealGift } = await loadGiftFilter()
  // 可见回归也不能被同机启动的真实游戏切走页面；隐藏回归由 bootstrap 准备相同隔离。
  if (!hidden) await prepareIsolatedGameProfile(root, userDataDir)
  const entry = hidden ? await writeHiddenElectronBootstrap(root, userDataDir) : '.'
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: electronPath,
    args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: root,
    env,
    timeout: 30_000
  })
  app.on('window', attachErrors)
  const page = await app.firstWindow()
  attachErrors(page)

  async function capture(target, options) {
    if (!hidden) return target.screenshot(options)
    // 隐藏且调整过大小的窗口不保证产生 Playwright 所等的帧；由 Electron 捕获当前视口。
    const win = await app.browserWindow(target)
    const png = await win.evaluate(async (window) => Array.from((await window.webContents.capturePage(undefined, {
      stayHidden: true, stayAwake: true
    })).toPNG()))
    await fs.writeFile(options.path, Buffer.from(png))
  }

  const api = (fn, arg) => page.evaluate(fn, arg)

  try {
    await ensureTestSession(page)

    // ---- 1. 内置礼物图与 catalog 一致（道具/组合装被过滤、同名图变体保留、官方 id/价格透传）----
    const inventory = await api(() => window.api.entertainmentListGiftImages())
    const builtIn = inventory.filter((item) => item.source === 'builtin')
    const catalog = JSON.parse(await fs.readFile(path.join(root, 'gift-assets', 'douyin', 'catalog.json'), 'utf8'))
    assert.equal(catalog.schema, 2, '当前抖音礼物 catalog 未导入')
    assert.equal(catalog.currentSource?.uniqueGiftIdCount, 1276, '当前礼物 ID 清单不完整')
    const giftDir = path.join(root, 'gift-assets', 'douyin')
    const expected = []
    for (const image of catalog.images) {
      const file = path.join(giftDir, image.file)
      const exists = await fs.access(file).then(() => true, () => false)
      if (exists && isRealGift(image.name)) expected.push(`${image.name} ${file.toLocaleLowerCase()}`)
    }
    assert.equal(builtIn.length, new Set(expected).size, `客户端内置图记录数与「catalog ∩ 磁盘 ∩ 真礼物」不一致：${builtIn.length} vs ${new Set(expected).size}`)
    assert.ok(builtIn.every((item) => isRealGift(item.name)), '内置清单里混进了道具/组合装')
    assert.ok(builtIn.every((item) => item.canonical || item.variant > 0), '变体标记不一致')
    assert.ok(builtIn.some((item) => item.variant > 0), '同名礼物图变体没有保留在主进程清单里')
    const currentGift = builtIn.find((item) => item.name === '助力票' && item.current)
    assert.equal(currentGift?.giftId, '15977', '官方礼物 ID 没有透传到客户端')
    assert.equal(currentGift?.diamondCount, 1, '官方礼物价格没有透传到客户端')

    // ---- 2. 透明图：整蛊竖列批量填写 → 制作礼物菜单 → PNG 落盘 ----
    const materialKey = /const MATERIAL_KEY = '([^']+)'/.exec(await fs.readFile(path.join(root, 'src', 'renderer', 'src', 'pages', 'EntertainmentTransparent.tsx'), 'utf8'))?.[1]
    assert.ok(materialKey, '找不到素材目录存储键')
    const menuDir = path.join(outputDir, 'menus')
    await fs.mkdir(menuDir, { recursive: true })
    await api(({ key, dir }) => localStorage.setItem(key, JSON.stringify({ fontDir: '', imageDir: '', outputDir: dir })), { key: materialKey, dir: menuDir })
    await page.getByRole('link', { name: '娱乐助手', exact: true }).click()
    await page.getByRole('button', { name: /透明图合成/ }).click()
    await page.getByText('制作礼物菜单', { exact: true }).first().waitFor({ timeout: 15_000 })
    const bulk = page.locator('textarea').filter({ hasText: '' }).nth(await page.locator('textarea').evaluateAll((areas) => areas.findIndex((a) => (a.placeholder || '').includes('小心心'))))
    await bulk.fill('小心心 = 屏幕反转\n玫瑰 = 手抖三秒\n棒棒糖 = 强制干杯')
    await page.getByRole('button', { name: /生成列表（覆盖）/ }).click()
    await page.getByText('屏幕反转').first().waitFor({ timeout: 5000 }).catch(() => {})
    await page.getByRole('button', { name: '制作礼物菜单', exact: true }).click()
    await page.waitForFunction(() => {
      const node = document.querySelector('canvas')
      if (!node) return false
      const data = node.getContext('2d')?.getImageData(0, 0, node.width, node.height).data
      if (!data) return false
      let visible = 0
      for (let index = 3; index < data.length; index += 400) if (data[index] > 0) visible++
      return visible > 20
    }, null, { timeout: 15_000 })
    let menuFile = null
    for (let i = 0; i < 40 && !menuFile; i++) {
      const files = (await fs.readdir(menuDir)).filter((f) => f.startsWith('礼物菜单_') && f.endsWith('.png'))
      if (files.length) menuFile = path.join(menuDir, files[0])
      else await page.waitForTimeout(250)
    }
    assert.ok(menuFile, '礼物菜单 PNG 没有落到合成图片目录')
    assert.ok((await fs.stat(menuFile)).size > 1024, '礼物菜单 PNG 太小，疑似空图')
    await capture(page, { path: path.join(outputDir, 'transparent-gift-menu.png'), fullPage: true })

    // ---- 3. 倒计时：时间格式边界 + 真实走秒 ----
    await page.getByRole('button', { name: /返回功能列表/ }).first().click()
    await page.getByRole('button', { name: /时间插件/ }).click()
    await page.getByRole('button', { name: '时间盲盒与更多设置', exact: true }).click()
    await page.getByText('时间插件 · 倒计时', { exact: true }).waitFor()
    await openTimeCase(app, page, 59, '00:59')
    await openTimeCase(app, page, 300, '05:00')
    await openTimeCase(app, page, 3600, '01:00:00')
    // 带天数时小时不省略（08-19 定稿格式：天/时:分:秒，两位补零）
    await openTimeCase(app, page, 86_700, '1天00:05:00')
    await openTimeCase(app, page, 90_000, '1天01:00:00')
    await openTimeCase(app, page, -59, '-00:59')
    const widget = await openTimeCase(app, page, 3661, '3661', { showSeconds: true })
    // 08-18 起礼物栏是「配几个显示几个」的格子（.gift-cell），收到配置里的礼物对应格子闪一下（.hit）
    await widget.waitForFunction(() => document.querySelectorAll('.gift-cell[data-gift]').length >= 2, null, { timeout: 10_000 })
    await page.evaluate(() => window.api.timeWidgetShowGift('请吃鸡', ''))
    await widget.waitForFunction(() => Boolean(document.querySelector('.gift-cell.hit')), null, { timeout: 10_000 })
    assert.ok(await widget.evaluate(() => Array.from(document.querySelectorAll('.gift-cell img')).some((img) => img.naturalWidth > 0)), '礼物栏格子没有加载出礼物图')
    await capture(widget, { path: path.join(outputDir, 'time-widget.png') })
    await page.evaluate(() => window.api.timeWidgetClose())
    const running = await page.evaluate(async (cfg) => {
      await window.api.timeWidgetOpen(cfg)
      await new Promise((resolve) => setTimeout(resolve, 1250))
      return await window.api.timeWidgetState()
    }, widgetConfig(3, { enable: true, showNegative: false }))
    assert.ok(running.remaining <= 2 && running.remaining >= 1, `倒计时未按真实经过时间走秒：${running.remaining}`)
    await page.evaluate(() => window.api.timeWidgetClose())

    // ---- 4. 礼物动画窗口：5 种特效 + 礼物→特效规则自动播放 ----
    await api(() => window.api.effectsConfigure({ autoPlay: true, defaultEffect: 'parabola', rules: [{ gift: '火箭', effect: 'bomb' }], background: 'green' }))
    assert.equal((await api(() => window.api.effectsOpen())).ok, true, '礼物动画窗口打开失败')
    const effects = await waitWindow(app, page, 'effects-widget')
    attachErrors(effects)
    for (const kind of ['parabola', 'bomb', 'car', 'firework', 'rain']) {
      assert.equal((await api((k) => window.api.effectsFire(k, '小心心', 3, '回归观众'), kind)).ok, true, `特效 ${kind} 触发失败`)
    }
    await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×2  by 阿彪'))
    await effects.waitForFunction(() => document.querySelectorAll('.gift, .frag, .car, .final').length > 0, null, { timeout: 5000 })
    // 连击角标：同一人再连送两次 → ×6
    await api(() => window.api.effectsConfigure({ comboSeconds: 5 }))
    await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×2  by 阿彪'))
    await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×2  by 阿彪'))
    await effects.waitForFunction(() => document.getElementById('combo')?.classList.contains('on') && document.getElementById('combo')?.textContent?.includes('6'), null, { timeout: 5000 })
    await page.waitForTimeout(600)
    await capture(effects, { path: path.join(outputDir, 'effects-widget.png') })
    // 礼物图清单缓存：连续查 10 次平均要远小于一次全量扫描
    const perTake = await api(async () => {
      await window.api.entertainmentListGiftImages()
      const t0 = performance.now()
      for (let i = 0; i < 10; i++) await window.api.entertainmentListGiftImages()
      return (performance.now() - t0) / 10
    })
    assert.ok(perTake < 40, `礼物图清单没有命中缓存：平均 ${perTake.toFixed(0)}ms`)

    // ---- 5. 大哥进场：规则匹配 + 横幅 + 去重 ----
    await api(() => window.api.entranceConfigure({ enabled: true, bannerStyle: 'gold', rules: [
      { id: 'vip', enabled: true, match: 'contains', name: '大哥', text: '大哥 {name} 驾到', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 600 },
      { id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
    ] }))
    assert.equal((await api(() => window.api.entranceOpen())).ok, true, '进场横幅窗口打开失败')
    const banner = await waitWindow(app, page, 'entrance-widget')
    attachErrors(banner)
    await api(() => window.api.connectorSimulate('进场: 榜一大哥'))
    await banner.waitForFunction(() => document.querySelector('.banner')?.textContent?.includes('榜一大哥'), null, { timeout: 5000 })
    await api(() => window.api.connectorSimulate('进场: 榜一大哥'))
    await api(() => window.api.connectorSimulate('进场: 路人甲'))
    await page.waitForTimeout(300)
    const entrance = await api(() => window.api.entranceState())
    assert.equal(entrance.recent[0]?.name, '路人甲')
    assert.equal(entrance.recent[0]?.rule, '任何人')
    assert.equal(entrance.recent.filter((r) => r.name === '榜一大哥').length, 1, '同一大哥 600 秒内应只迎一次（去重）')
    await capture(banner, { path: path.join(outputDir, 'entrance-banner.png') })

    // ---- 6. 整蛊排队：规则入队 + 展示窗口 + 清空 + 保护期间拒收 ----
    const rule = await api(() => window.api.entertainmentRuleAdd({ id: '', giftName: '小心心', actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '1', enabled: true, queueMode: 'normal', multiply: true }))
    assert.equal(rule.ok, true)
    assert.equal((await api(() => window.api.queueOpen())).ok, true, '排队窗口打开失败')
    const queue = await waitWindow(app, page, 'queue-widget')
    attachErrors(queue)
    await api(() => window.api.connectorSimulate('礼物: 小心心 ×8  by 阿彪'))
    const snap = await api(() => window.api.queueState().then((s) => s.snapshot))
    assert.ok(snap.running && snap.pending.length >= 4, `礼物 ×8 应进入执行队列：${JSON.stringify(snap)}`)
    // 先验队列操作，再截屏；截图耗时不应决定待执行队列是否已经自然耗尽。
    const { beforeSkip, skipped, afterSkip } = await api(async () => {
      const beforeSkip = (await window.api.queueState()).snapshot.pending.length
      const skipped = await window.api.queueSkip(2)
      const afterSkip = (await window.api.queueState()).snapshot.pending.length
      return { beforeSkip, skipped, afterSkip }
    })
    assert.ok(skipped.skipped === 2 && beforeSkip - afterSkip >= 1, `跳过下一条没生效：${beforeSkip} → ${afterSkip}`)
    await queue.waitForFunction(() => document.querySelectorAll('#list .row').length > 0, null, { timeout: 3000 })
    await capture(queue, { path: path.join(outputDir, 'queue-widget.png') })
    await api(() => window.api.queueClear())
    await api(() => window.api.entertainmentRulesPause(true))
    await api(() => window.api.connectorSimulate('礼物: 小心心 ×3  by 阿彪'))
    await page.waitForTimeout(200)
    const paused = await api(() => window.api.queueState().then((s) => s.snapshot))
    assert.equal(paused.pending.length, 0, '拒收礼物期间不该入队')
    await api(() => window.api.entertainmentRulesPause(false))

    // ---- 7. 积分条 + 心愿 A/B：主进程计一次、页面开着也不重复 ----
    await api(() => window.api.progressConfigure({ title: '礼物积分', target: 100, autoAdd: true, scoreMode: 'table', defaultScore: 1, giftScores: [{ gift: '火箭', score: 10 }], milestones: [{ score: 15, note: '十五分' }], resetOnTarget: false }))
    await api(() => window.api.progressReset())
    assert.equal((await api(() => window.api.progressOpen())).ok, true)
    await page.getByRole('button', { name: /返回功能列表/ }).first().click()
    await page.getByRole('button', { name: /积分心愿/ }).click()
    await page.getByText('礼物积分进度条').first().waitFor()
    await api(() => window.api.connectorSimulate('礼物: 火箭 ×1  by 球球'))
    await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×6  by 小美吖'))
    await page.waitForTimeout(400)
    const progress = await api(() => window.api.progressState())
    assert.equal(progress.score, 16, `积分表计分：火箭 10 + 玫瑰 6×1 = 16，实际 ${progress.score}`)
    assert.ok(progress.reached.includes(15), '里程碑 15 应已触发')
    await api(() => window.api.wishConfigure({ showB: true, autoAdd: true, groups: [{ title: '心愿 A', wishes: [{ gift: '玫瑰', target: 10, count: 0 }] }, { title: '心愿 B', wishes: [{ gift: '火箭', target: 1, count: 0 }] }] }))
    await api(() => window.api.wishReset())
    assert.equal((await api(() => window.api.wishOpen())).ok, true)
    const wishWin = await waitWindow(app, page, 'wish-widget')
    await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×4  by 老王头'))
    await api(() => window.api.connectorSimulate('礼物: 火箭 ×1  by 球球'))
    await page.waitForTimeout(400)
    const wish = await api(() => window.api.wishState())
    assert.equal(wish.config.groups[0].wishes[0].count, 4)
    assert.equal(wish.config.groups[1].wishes[0].done, true)
    await wishWin.waitForFunction(() => document.querySelectorAll('.vote-box').length === 2, null, { timeout: 3000 })
    await capture(wishWin, { path: path.join(outputDir, 'wish-widget.png') })

    // ---- 8. 飘屏：一条事件只出一条消息（页面开着也不重复）----
    await page.getByRole('button', { name: /返回功能列表/ }).first().click()
    await page.getByRole('button', { name: /飘屏/ }).click()
    await api(() => window.api.marqueeOpen({ giftOn: true, chatOn: true, gifts: [], chatKeywords: '', style: 'neon', fontSize: 24, position: 'top-right' }))
    const marquee = await waitWindow(app, page, 'marquee-widget')
    await marquee.waitForFunction(() => document.body.className === 'neon' && document.getElementById('list')?.className.includes('right'), null, { timeout: 5000 })
    await api(() => window.api.marqueeConfigure({ style: 'pill' }))
    await marquee.waitForFunction(() => document.body.className === 'pill', null, { timeout: 5000 })
    await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×2  by 小美吖'))
    await api(() => window.api.connectorSimulate('弹幕: 阿彪 666'))
    await marquee.waitForFunction(() => document.querySelectorAll('.msg').length >= 2, null, { timeout: 3000 })
    await page.waitForTimeout(300)
    assert.equal(await marquee.evaluate(() => document.querySelectorAll('.msg').length), 2, '飘屏消息重复')

    // ---- 9. 键盘显示：钩子起停 + 真收到注入按键 ----
    await api(() => window.api.keyboardConfigure({ style: 'cartoon', background: 'green' }))
    const kb = await api(() => window.api.keyboardOpen())
    assert.equal(kb.ok, true, kb.error)
    const kbWin = await waitWindow(app, page, 'keyboard-widget')
    await waitForApiState(page, () => window.api.keyboardState().then((s) => s.hook.running), 15_000)
    await page.waitForTimeout(2500)
    if (hidden) console.log('SKIP hidden mode: physical F13 injection; keyboard window/hook lifecycle still checked')
    else {
      injectF13()
      await kbWin.waitForFunction(() => Array.from(document.querySelectorAll('.bubble')).some((b) => b.textContent === 'F13'), null, { timeout: 5000 })
    }
    await capture(kbWin, { path: path.join(outputDir, 'keyboard-widget.png') })
    await api(() => window.api.keyboardClose())
    await waitForApiState(page, () => window.api.keyboardState().then((s) => !s.hook.running))

    // ---- 9.5 公告：全部来自更新源，客户端不再自带内容（2026-09-07 用户定调「只我在后台发公告」）----
    // 原来这里断言必须有内置公告 n4 兜底。内置公告是和服务器公告【合并显示】的，于是服务器那份
    // 删干净了、主播还是能看到客户端里那 4 条 7~9 月初的宣传稿，所以 builtinNews 已清空。
    // 现在的契约：拉不到就是空列表（公告页有「暂无公告」空态），有内容则按日期倒序。
    const news = await api(() => window.api.listNews())
    assert.ok(Array.isArray(news), '公告接口应始终返回数组')
    assert.ok(news.every((n) => n.id && n.title), `公告条目要有 id 和标题：${JSON.stringify(news.slice(0, 2))}`)
    assert.ok(news.every((n, i) => i === 0 || (news[i - 1].date || '') >= (n.date || '')), '公告没按日期倒序')

    // ---- 9.6 环境自检：每项有 id/标签/结论，非 ok 项都带处理提示，磁盘/数据目录/礼物图在测试机上必须 ok ----
    const check = await api(() => window.api.selfCheck())
    assert.ok(check && check.items.length >= 10 && check.items.every((i) => i.id && i.label && i.detail), '自检项不完整')
    assert.ok(check.items.filter((i) => i.level !== 'ok').every((i) => i.hint), '自检非 ok 项缺处理提示')
    for (const id of ['disk', 'data', 'gifts']) assert.equal(check.items.find((i) => i.id === id)?.level, 'ok', `自检 ${id} 项不正常`)

    // ---- 10. 保护计时牌 ----
    assert.equal((await api(() => window.api.protectWidgetOpen(Date.now()))).ok, true)
    const protect = await waitWindow(app, page, 'protect-widget')
    await protect.waitForFunction(() => document.querySelector('#t')?.textContent?.length >= 5, null, { timeout: 3000 })
    await api(() => window.api.protectWidgetClose())

    assert.deepEqual(errors, [], `Electron 页面错误：${errors.join(' | ')}`)
    if (hidden) assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => !win.isVisible() && !win.isFocused())), true, '隐藏测试不得显示窗口或获取焦点')
    console.log(`Electron 回归通过：${builtIn.length} 张内置礼物图、礼物菜单出图落盘、7 个时间格式边界与真实走秒、礼物动画/进场/排队/积分心愿/飘屏/键盘显示/保护计时/环境自检 主进程链路均正常`)
  } catch (error) {
    console.error('UI failure location:', page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 1600))
    await capture(page, { path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {})
    if (errors.length) console.error('页面错误：', errors.slice(0, 8).join(' | '))
    throw error
  } finally {
    await page.evaluate(() => Promise.allSettled([
      window.api.timeWidgetClose(), window.api.effectsClose(), window.api.entranceClose(), window.api.queueClose(),
      window.api.progressClose(), window.api.wishClose(), window.api.marqueeClose(), window.api.keyboardClose(), window.api.protectWidgetClose()
    ])).catch(() => {})
    await app.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
