// 特色整蛊 × 娱乐助手送礼系统 · 端到端回归（隐藏的独立客户端实例，独立 userData，不碰正式配置，不抢前台）。
// 覆盖：
//   1. 0.3.63 测试版玩法自带的礼物触发 → 启动时迁成礼物规则（只迁一次）；各玩法的窗口尺寸合成一个窗口设置
//   2. 特色整蛊宫格：17 张卡片、真实美术经 zlspecial 协议加载；顶上一条「直播窗口」
//   3. 详情页预览舞台：iframe 跑真实玩法代码，自动演示有活动
//   4. 详情页「添加联动」→ 存成礼物规则（动作 = 特色整蛊）
//   5. 模拟送礼 → 规则触发 → 唯一的「特色整蛊」窗口自动打开，几个玩法在同一个窗口里各自动
//   6. 礼物规则编辑器里「特色整蛊」单独一格 + 参数编辑；转盘等走的 entertainmentCommand 出口；整蛊遥控融合
//   6c. 盲盒（照时间插件）：事件库、给礼物勾奖池、送礼按奖池抽、改勾选即存、删事件从奖池摘掉
//   7. 全部清屏 / 关闭窗口；zlspecial 协议拒绝读素材目录外和非媒体文件
// 用法：npx electron-vite build --outDir output/special-build && node tools/verify-special-integration.mjs [--out=output/special-build]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outArg = process.argv.find((a) => a.startsWith('--out='))
const outDir = outArg ? outArg.slice(6) : 'output/special-build'
const output = path.join(root, 'output', 'playwright', 'special-integration')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const userDataDir = await fs.mkdtemp(path.join(output, 'userdata-'))

// 旧版玩法自带的触发配置：锁链绑「玫瑰」每份 4 环；鸭子开着但没填礼物（任意礼物，迁不了）
await fs.mkdir(path.join(userDataDir, 'data'), { recursive: true })
await fs.writeFile(path.join(userDataDir, 'data', 'special-gameplay.json'), JSON.stringify({
  games: {
    chain_challenge: { enabled: true, triggerGift: '玫瑰', triggerCount: 4, background: 'green', width: 1280, height: 720, speed: 1, countCap: 0, params: {} },
    catch_duck: { enabled: true, triggerGift: '', triggerCount: 5, params: {} }
  }
}))

const entry = await writeHiddenElectronBootstrap(root, userDataDir, { outDir })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const errors = []
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox', '--mute-audio'],
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
  // 隐藏窗口不保证有新帧：连着让它重画两次再拍，免得拍到页面切换前的旧画面
  for (let i = 0; i < 2; i++) {
    await win.evaluate((w) => w.webContents.invalidate())
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.waitForTimeout(250)
  }
  const png = await win.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png))
}
async function until(fn, what, timeout = 10_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await page.waitForTimeout(150)
  }
  throw new Error('等待超时：' + what)
}
// 主进程里找「特色整蛊」窗口（全部玩法共用这一个），在它页面里跑一段 JS
const SPECIAL_TITLE = '特色整蛊'
const inSpecialWindow = (script) => app.evaluate(async ({ BrowserWindow }, a) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === a.title)
  if (!w) return { missing: true }
  return { value: await w.webContents.executeJavaScript(a.script) }
}, { title: SPECIAL_TITLE, script })
const windowOpen = () => api(() => window.api.specialState().then((s) => s.window.open))
const loadedGames = async () => (await inSpecialWindow('window.__loaded ? window.__loaded() : []')).value || []
const bannerText = async () => (await inSpecialWindow('document.getElementById("btx") ? document.getElementById("btx").textContent : ""')).value || ''

try {
  // ---- 登录本地测试账号 ----
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 20_000 })
  const login = await api(async () => {
    await window.api.register('special_regression', 'Fixture123!', '特色整蛊回归')
    const r = await window.api.login('special_regression', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('zl_configuration_level', 'advanced')
    return r
  })
  assert.equal(login.ok, true, login.error || '本地测试账号登录失败')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 20_000 })
  await page.setViewportSize?.({ width: 1440, height: 1000 }).catch(() => {})
  const mainWin = await app.browserWindow(page)
  await mainWin.evaluate((w) => w.setContentSize(1440, 1000))

  // ---- 1. 旧触发迁移 ----
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.some((r) => r.commandCmd === 'special-play'))), '迁移出的规则')
  const migrated = (await api(() => window.api.entertainmentRulesList())).filter((r) => r.commandCmd === 'special-play')
  assert.equal(migrated.length, 1, `应只迁 1 条（任意礼物的那条迁不了）：${JSON.stringify(migrated)}`)
  assert.equal(migrated[0].giftName, '玫瑰')
  assert.equal(migrated[0].commandParam, 'chain_challenge|add|4')
  assert.equal(migrated[0].queueMode, 'instant')
  assert.equal(migrated[0].group, '特色整蛊')
  ok('旧版玩法触发 → 礼物规则（玫瑰 → 锁链 +4，即时执行）')
  const st0 = await api(() => window.api.specialState())
  assert.deepEqual({ w: st0.window.width, h: st0.window.height, bg: st0.window.background, auto: st0.window.autoOpen, open: st0.window.open }, { w: 1280, h: 720, bg: 'green', auto: true, open: false }, `窗口设置没从旧配置合过来：${JSON.stringify(st0.window)}`)
  ok('旧版各玩法的窗口尺寸/底色 → 合成一个「特色整蛊」窗口设置（1280×720 绿幕）')

  // ---- 2. 宫格页 ----
  await api(() => { window.location.hash = '#/special' })
  await page.locator('[data-special-card]').first().waitFor({ timeout: 15_000 })
  assert.equal(await page.locator('[data-special-card]').count(), 17, '应有 17 张玩法卡片')
  await page.waitForTimeout(1200)
  const art = await api(() => [...document.querySelectorAll('[data-special-card] img')].filter((i) => i.src.startsWith('zlspecial:')).map((i) => ({ src: i.src, w: i.naturalWidth })))
  const broken = art.filter((a) => !a.w)
  assert.ok(art.length >= 13, `卡片主图太少：${art.length}`)
  assert.equal(broken.length, 0, `有卡片图没加载出来：${JSON.stringify(broken)}`)
  assert.equal(await page.locator('[data-testid="special-window-bar"]').count(), 1, '宫格页顶上应有一条「直播窗口」')
  ok(`宫格 17 张卡片，${art.length} 张真实美术全部加载，顶上一条「直播窗口」`)
  await capture('01-grid')

  // ---- 3. 详情页预览 ----
  await page.locator('[data-special-card="catch_duck"]').click()
  await page.getByText('怎么玩', { exact: true }).waitFor()
  await until(async () => page.frames().some((f) => f.url().startsWith('zlspecial://app/preview/catch_duck')), '预览 iframe')
  const frame = page.frames().find((f) => f.url().startsWith('zlspecial://app/preview/catch_duck'))
  await frame.waitForFunction(() => typeof window.__alive === 'function', null, { timeout: 10_000 })
  await until(() => frame.evaluate(() => window.__alive()), '预览自动演示有活动', 8000)
  await page.waitForTimeout(1500)
  const ink = await frame.evaluate(() => {
    const cv = document.getElementById('cv'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 16) n++; return n
  })
  assert.ok(ink > 200, `预览画布没画东西（墨量 ${ink}）`)
  ok(`详情页预览舞台跑真实玩法代码（墨量 ${ink}）`)
  await capture('02-detail-duck')

  // ---- 3b. 自动演示不叠加：锁链挂上后等着点，画面没空，就不该再「送」一次 ----
  await api(() => { window.location.hash = '#/special?tool=chain_challenge' })
  await until(async () => page.frames().some((f) => f.url().startsWith('zlspecial://app/preview/chain_challenge')), '锁链预览 iframe')
  const chainFrame = page.frames().find((f) => f.url().startsWith('zlspecial://app/preview/chain_challenge'))
  await chainFrame.waitForFunction(() => typeof window.__alive === 'function', null, { timeout: 10_000 })
  // 先等页面加载时的第一次演示放完（那一次是应该的），再开始数后面有没有重复
  await page.waitForTimeout(2500)
  await chainFrame.evaluate(() => { window.__applies = 0; window.addEventListener('message', (e) => { if (e.data && e.data.type === 'apply') window.__applies++ }) })
  await page.waitForTimeout(7000)
  const reapplied = await chainFrame.evaluate(() => window.__applies)
  assert.equal(reapplied, 0, `锁链挂着时自动演示又发了 ${reapplied} 次（会一直往上叠）`)
  const badge = await page.getByText('预览 · 不上直播').count()
  assert.ok(badge > 0, '预览舞台应标明「预览 · 不上直播」')
  ok('预览自动演示：锁链挂着等点时 7 秒内不再叠加，舞台标明「预览 · 不上直播」')
  // 皮肤选择器（带缩略图）：滚到设置区拍一张
  await page.getByRole('radiogroup', { name: '锁链皮肤' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const skinImgs = await api(() => [...document.querySelectorAll('[role="radiogroup"][aria-label="锁链皮肤"] img')].map((i) => i.naturalWidth))
  assert.equal(skinImgs.filter((w) => w > 0).length, 8, `皮肤缩略图应 8 张都加载：${JSON.stringify(skinImgs)}`)
  await capture('02b-chain-skins')
  ok('锁链皮肤选择器 8 张缩略图全部加载')
  await api(() => { window.location.hash = '#/special?tool=catch_duck' })
  await page.getByText('怎么玩', { exact: true }).waitFor()

  // ---- 4. 页面里添加联动 ----
  await page.getByRole('button', { name: '添加联动' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  // 隐藏测试窗口里 datalist 建议浮层一弹出 Electron 就崩（tools/probe-datalist-crash.mjs；真实可见窗口不受影响），先摘掉 list
  await api(() => document.querySelectorAll('[role="dialog"] input[list]').forEach((i) => i.removeAttribute('list')))
  await dialog.getByPlaceholder('如：小心心 / 人气票 / 玫瑰').fill('小心心')
  // 基础模式下操作/大小收在「更多选项」里；测试账号是高级模式，直接可见。数量默认随机范围，先切固定
  await dialog.getByRole('button', { name: '固定数量', exact: true }).click()
  await dialog.getByLabel('特色整蛊数量', { exact: true }).fill('3')
  await dialog.getByLabel('特色整蛊大小').selectOption('big')
  await page.waitForTimeout(700) // 等弹窗淡入动画走完再截图
  await capture('03-link-modal')
  await dialog.getByRole('button', { name: '添加联动' }).click()
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.some((r) => r.giftName === '小心心' && r.commandCmd === 'special-play'))), '联动规则落盘')
  const link = (await api(() => window.api.entertainmentRulesList())).find((r) => r.giftName === '小心心')
  assert.equal(link.commandParam, 'catch_duck|add|3|size=big')
  assert.equal(link.queueMode, 'instant')
  await page.getByText('→ +3只 · 大鸭子').waitFor({ timeout: 5000 })
  ok('详情页添加联动 → 礼物规则 catch_duck|add|3|size=big，列表显示「+3只 · 大鸭子」')
  await capture('04-detail-linked')

  // ---- 5. 模拟送礼 → 自动开「特色整蛊」窗口 + 收到命令；第二个玩法进同一个窗口 ----
  assert.equal(await windowOpen(), false, '送礼前特色整蛊窗口不该开着')
  await api(() => window.api.connectorSimulate('礼物: 小心心 ×2  by 阿彪'))
  await until(() => windowOpen(), '特色整蛊窗口自动打开')
  await until(async () => (await inSpecialWindow("window.__alive && window.__alive('catch_duck')")).value === true, '窗口里的鸭子收到命令开始动')
  ok(`模拟送礼「小心心×2 by 阿彪」→「特色整蛊」窗口自动打开，鸭子开始生成（横幅：${await bannerText() || '无'}）`)
  await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×1  by 小美'))
  await until(async () => (await inSpecialWindow("window.__alive && window.__alive('chain_challenge')")).value === true, '迁移的玫瑰规则触发锁链')
  const specialWins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.getTitle() !== '知了猴整蛊台').map((w) => w.getTitle()))
  assert.deepEqual(specialWins.filter((t) => t === SPECIAL_TITLE).length, 1, `应该只有一个特色整蛊窗口：${JSON.stringify(specialWins)}`)
  assert.ok(!specialWins.some((t) => t === '抓鸭子' || t === '锁链特效'), `不该再有单个玩法的窗口：${JSON.stringify(specialWins)}`)
  assert.deepEqual(await loadedGames(), ['catch_duck', 'chain_challenge'])
  ok('迁移来的「玫瑰」规则触发锁链：鸭子和锁链在同一个「特色整蛊」窗口里（不再一个玩法一个窗口）')

  // ---- 6. 礼物规则编辑器 + 通用出口 ----
  await api(() => { window.location.hash = '#/ent?tool=gift' })
  await page.getByText('小心心', { exact: false }).first().waitFor({ timeout: 10_000 })
  const labelShown = await api(() => document.body.innerText.includes('特色整蛊 抓鸭子 +3只 · 大鸭子'))
  assert.ok(labelShown, '礼物触发列表里应显示「特色整蛊 抓鸭子 +3只 · 大鸭子」')
  await capture('05-gift-rules')
  const r1 = await api(() => window.api.entertainmentCommand('special-play', 'fan_call|show|1'))
  assert.equal(r1.ok, true, r1.error)
  await until(async () => (await loadedGames()).includes('fan_call'), '动作命令出口打开粉丝来电')
  const r2 = await api(() => window.api.entertainmentCommand('special-play', 'no_such|add|1'))
  assert.equal(r2.ok, false, '未知玩法应该报错')
  ok('动作命令出口（转盘/九宫格/时间盲盒共用）能触发特色整蛊，未知玩法会报错')

  // ---- 6b. 和整蛊器融合：整蛊遥控里的特色整蛊分组 / 礼物联动 / 模拟观众；礼物触发的「游戏整蛊」动作 ----
  await api(() => window.api.specialCloseAll())
  await until(async () => !(await windowOpen()), '先关掉特色整蛊窗口')
  await api(() => { window.location.hash = '#/remote' })
  await page.getByText('整蛊遥控', { exact: true }).first().waitFor({ timeout: 15_000 })
  const gated = await page.getByText('礼物联动', { exact: true }).count() === 0
  if (gated) {
    console.log('SKIP 整蛊遥控：测试账号没有游戏授权，看不到遥控页（只验礼物触发侧）')
  } else {
    // 特色整蛊分组：不开游戏也能点
    const specialBtn = page.getByRole('button', { name: '粉丝来电', exact: true })
    await specialBtn.waitFor({ timeout: 10_000 })
    assert.equal(await specialBtn.isDisabled(), false, '没开游戏时特色整蛊按钮也应能点')
    await specialBtn.click()
    await until(async () => (await windowOpen()) && (await loadedGames()).includes('fan_call'), '整蛊遥控点特色整蛊打开窗口')
    ok('整蛊遥控「特色整蛊」分组：没开游戏也能一键触发')
    // 礼物联动：选「特色整蛊（画面）」里的玩法 → 立即存成礼物触发规则
    await api(() => document.querySelectorAll('input[list]').forEach((i) => i.removeAttribute('list')))
    await page.getByPlaceholder('礼物名（如 保时捷）').fill('棒棒糖')
    await page.locator('select').filter({ has: page.locator('option[value="special:throw_poop"]') }).first().selectOption('special:throw_poop')
    await page.getByRole('button', { name: '绑定', exact: true }).click()
    await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.some((r) => r.giftName === '棒棒糖' && r.commandParam === 'throw_poop|add|5'))), '整蛊遥控绑特色整蛊落成礼物规则')
    await page.getByText('扔粑粑', { exact: true }).first().waitFor({ timeout: 5000 })
    ok('整蛊遥控礼物联动里绑「扔粑粑 ← 棒棒糖」→ 礼物触发规则，立即生效')
    // 模拟观众：没开游戏也能点，客户端的礼物触发同时响应
    const simBtn = page.getByRole('button', { name: /棒棒糖/ }).first()
    if (await simBtn.count()) {
      assert.equal(await simBtn.isDisabled(), false, '模拟观众在没开游戏时也应能点')
      await simBtn.click()
      await until(async () => (await loadedGames()).includes('throw_poop'), '模拟观众送棒棒糖触发扔粑粑')
      ok('整蛊遥控「模拟观众」送棒棒糖 → 礼物触发规则 → 扔粑粑进了特色整蛊窗口')
    } else {
      console.log('SKIP 模拟观众：预设礼物里没有棒棒糖按钮')
    }
    await capture('06-remote')
  }
  // 礼物触发里的「游戏整蛊」动作：游戏没在跑 → 明确报错（不假装成功），参数和标签正确
  const gp = await api(() => window.api.entertainmentCommand('game-prank', '4wheel-challenge|flip|翻车'))
  assert.equal(gp.ok, false, '游戏没在跑时游戏整蛊不该报成功')
  ok(`礼物触发「游戏整蛊」动作：游戏未运行时报错「${gp.error}」`)

  // ---- 6c. 特色整蛊盲盒（照时间插件）：事件库 → 给礼物勾奖池 → 送礼按奖池抽 ----
  const events = await api(() => window.api.specialBoxEvents())
  assert.equal(events.length, 17, `第一次用应放进每个玩法一个默认事件：${events.length}`)
  await api(() => { window.location.hash = '#/special' })
  await page.locator('[data-testid="special-boxes"]').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '添加盲盒礼物' }).click()
  const boxDialog = page.getByRole('dialog')
  await boxDialog.waitFor()
  await api(() => document.querySelectorAll('[role="dialog"] input[list]').forEach((i) => i.removeAttribute('list')))
  await boxDialog.getByPlaceholder('如：小心心 / 人气票 / 玫瑰').fill('嘉年华')
  await until(async () => (await boxDialog.locator('[role="checkbox"][aria-checked="true"]').count()) === 17, '奖池默认勾上全部事件')
  await boxDialog.getByRole('button', { name: '清空选择' }).click()
  await boxDialog.getByRole('checkbox', { name: /抽奖事件 抓鸭子/ }).click()
  await boxDialog.getByRole('checkbox', { name: /抽奖事件 锁链特效/ }).click()
  await boxDialog.getByLabel('盲盒名字').fill('嘉年华盲盒')
  await page.waitForTimeout(700)
  await capture('06c-box-modal')
  await boxDialog.getByRole('button', { name: '添加联动' }).click()
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.some((r) => r.giftName === '嘉年华' && r.commandCmd === 'special-box'))), '盲盒礼物落盘')
  const boxRule = (await api(() => window.api.entertainmentRulesList())).find((r) => r.giftName === '嘉年华')
  assert.equal(boxRule.commandParam, 'sbe-default-catch_duck,sbe-default-chain_challenge|嘉年华盲盒')
  ok('添加盲盒礼物：嘉年华 → 奖池默认全勾，改成只勾「抓鸭子」「锁链」，名字「嘉年华盲盒」')

  await api(() => window.api.specialCloseAll())
  await until(async () => !(await windowOpen()), '先关掉窗口')
  await api(() => window.api.connectorSimulate('礼物: 嘉年华 ×3  by 阿彪'))
  await until(() => windowOpen(), '送嘉年华开窗')
  let announce = ''
  for (let i = 0; i < 40 && !announce.includes('开出'); i++) { announce = await bannerText(); if (!announce.includes('开出')) await page.waitForTimeout(150) }
  assert.ok(announce.includes('阿彪的「嘉年华盲盒」×3 开出'), `开盒提示不对：${announce}`)
  const got = await loadedGames()
  assert.ok(got.length >= 1 && got.every((g) => g === 'catch_duck' || g === 'chain_challenge'), `只该从奖池里的两个事件抽：${got}`)
  ok(`模拟送「嘉年华×3 by 阿彪」→ 一次抽 3 份、只开出奖池里的（${got.join('、')}）：「${announce}」`)

  const row = page.locator(`[data-box-rule="${boxRule.id}"]`)
  await row.waitFor({ timeout: 10_000 })
  await row.getByRole('checkbox', { name: /抽奖事件 锁链特效/ }).click()
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.find((r) => r.giftName === '嘉年华')?.commandParam === 'sbe-default-catch_duck|嘉年华盲盒')), '盲盒礼物行里去勾即存')
  await row.getByRole('button', { name: '抽一次' }).click()
  let drawn = ''
  for (let i = 0; i < 40 && !drawn.includes('主播的「嘉年华盲盒」开出：抓鸭子'); i++) { drawn = await bannerText(); await page.waitForTimeout(150) }
  assert.ok(drawn.includes('主播的「嘉年华盲盒」开出：抓鸭子'), `抽一次的提示不对：${drawn}`)
  await capture('06d-box-section')
  ok(`盲盒礼物行里直接去勾「锁链」→ 自动存进礼物规则；「抽一次」只开出鸭子：「${drawn}」`)

  await page.getByRole('button', { name: '添加事件' }).click()
  await until(() => api(() => window.api.specialBoxEvents().then((l) => l.length === 18)), '新事件落盘')
  const lib = page.locator('[data-testid="special-box-events"]')
  const del = lib.locator('[data-box-event="sbe-default-catch_duck"]').getByRole('button', { name: /删除事件/ })
  await del.click()
  await del.click()
  await until(() => api(() => window.api.specialBoxEvents().then((l) => !l.some((e) => e.id === 'sbe-default-catch_duck'))), '删掉的事件落盘')
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.find((r) => r.giftName === '嘉年华')?.commandParam === '|嘉年华盲盒')), '删掉的事件从奖池里摘掉')
  ok('事件库：添加事件即存；删掉「抓鸭子」事件后，嘉年华的奖池里也跟着摘掉')

  // ---- 6d. 直播画面方向：窗口条上一键竖屏，开着的窗口跟着变 ----
  await page.getByRole('button', { name: '竖屏 9:16', exact: true }).first().click()
  await until(() => api(() => window.api.specialState().then((s) => s.window.height > s.window.width)), '窗口改成竖屏')
  const winSize = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === '特色整蛊'); return w ? w.getSize() : null })
  assert.ok(winSize && winSize[1] > winSize[0], `开着的特色整蛊窗口应变成竖的：${JSON.stringify(winSize)}`)
  await capture('07-portrait-grid')
  await page.getByRole('button', { name: '横屏 16:9', exact: true }).first().click()
  await until(() => api(() => window.api.specialState().then((s) => s.window.width > s.window.height)), '改回横屏')
  ok(`直播画面方向：窗口条一键竖屏（开着的窗口 ${winSize[0]}×${winSize[1]}），再改回横屏`)

  // ---- 7. 清屏 / 关闭 / 协议安全 ----
  for (const p of ['catch_duck|add|5', 'chain_challenge|add|3', 'fan_call|show|1']) await api((x) => window.api.entertainmentCommand('special-play', x), p)
  await until(async () => (await inSpecialWindow("window.__alive && window.__alive('catch_duck')")).value === true, '清屏前鸭子在动')
  const cleared = await api(() => window.api.specialClearAll())
  assert.ok(cleared.cleared >= 3, `清屏应覆盖窗口里用过的玩法：${JSON.stringify(cleared)}`)
  await until(async () => (await inSpecialWindow('window.__alive && window.__alive()')).value === false, '清屏后整个窗口空闲', 15_000)
  ok(`全部清屏（${cleared.cleared} 个玩法），窗口回到空闲`)
  const sec = await api(async () => {
    const st = async (u) => { try { return (await fetch(u)).status } catch { return 'err' } }
    return {
      winini: await st('zlspecial://app/file/C%3A/Windows/win.ini'),
      escape: await st('zlspecial://app/assets/..%2F..%2Fpackage.json'),
      beats: await st('zlspecial://app/assets/music_ball/default_beats.json')
    }
  })
  assert.notEqual(sec.winini, 200, `不该读到 win.ini：${JSON.stringify(sec)}`)
  assert.notEqual(sec.escape, 200, `不该跳出素材目录：${JSON.stringify(sec)}`)
  assert.equal(sec.beats, 200, `素材目录里的节拍数据应能读：${JSON.stringify(sec)}`)
  ok(`zlspecial 协议：非媒体文件 ${sec.winini}、越界 ${sec.escape}、素材 ${sec.beats}`)
  const closed = await api(() => window.api.specialCloseAll())
  assert.equal(closed.closed, 1)
  await until(async () => !(await windowOpen()), '关闭窗口')
  ok('关闭特色整蛊窗口')

  // 不抢前台
  const focus = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => ({ t: w.getTitle(), v: w.isVisible(), f: w.isFocused() })))
  assert.ok(focus.every((w) => !w.v && !w.f), `测试窗口不得可见或聚焦：${JSON.stringify(focus)}`)
  ok('全程窗口不可见、不聚焦')
} catch (e) {
  console.log('FAIL ' + (e && e.message))
  await capture('99-fail').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}

const real = errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND.*avatar/i.test(e))
if (real.length) {
  console.log('\n页面错误：')
  for (const e of real) console.log('  ' + e)
}
console.log(`\nSPECIAL INTEGRATION: ${passed} PASS${process.exitCode ? '，有失败' : ''}${real.length ? `，页面错误 ${real.length}` : ''}`)
if (real.length) process.exitCode = 1
