// 特色整蛊 × 娱乐助手送礼系统 · 端到端回归（隐藏的独立客户端实例，独立 userData，不碰正式配置，不抢前台）。
// 覆盖：
//   1. 0.3.63 测试版玩法自带的礼物触发 → 启动时迁成礼物规则（只迁一次）；各玩法的窗口尺寸合成一个窗口设置
//   2. 特色整蛊宫格：17 张卡片、真实美术经 zlspecial 协议加载；顶上一条「直播窗口」
//   3. 详情页预览舞台：iframe 跑真实玩法代码，自动演示有活动
//   4. 详情页「添加联动」→ 存成礼物规则（动作 = 特色整蛊）
//   5. 模拟送礼 → 规则触发 → 唯一的「特色整蛊」窗口自动打开，几个玩法在同一个窗口里各自动
//   6. 礼物规则编辑器里「特色整蛊」单独一格 + 参数编辑；转盘等走的 entertainmentCommand 出口；整蛊遥控融合
//   6c. 盲盒（照时间插件）：默认事件库（每个玩法几档固定数量）、给礼物勾奖池、送礼按奖池抽、逐条开奖（锣 + 大字 + 随包配音）、
//       改勾选即存、删事件从奖池摘掉、开奖设置夹紧、设置页试听拿得到随包配音
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
  assert.equal(skinImgs.length, 5, `锁链皮肤应是 5 套（原版素材皮肤已下线）：${JSON.stringify(skinImgs)}`)
  assert.equal(skinImgs.filter((w) => w > 0).length, 5, `皮肤缩略图应 5 张都加载：${JSON.stringify(skinImgs)}`)
  await capture('02b-chain-skins')
  ok('锁链皮肤选择器 5 张缩略图全部加载')
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
  // 礼物直接触发的也和盲盒一样敲锣、出大字、念（2026-10-07 用户：「肯定是默认念的，除了打电话」，不再有开关）
  let directRv = null
  for (let i = 0; i < 60 && !directRv?.current?.text; i++) { directRv = (await inSpecialWindow('window.__revealState && window.__revealState()')).value; if (!directRv?.current?.text) await page.waitForTimeout(100) }
  assert.ok(/鸭/.test(directRv?.current?.text || ''), '礼物直接触发的抓鸭子应该敲锣出大字：' + JSON.stringify(directRv))
  await until(async () => (await inSpecialWindow("window.__alive && window.__alive('catch_duck')")).value === true, '窗口里的鸭子收到命令开始动')
  ok(`模拟送礼「小心心×2 by 阿彪」→「特色整蛊」窗口自动打开，敲锣开出「${directRv.current.text}」，鸭子开始生成（横幅：${await bannerText() || '无'}）`)
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
  await until(async () => { const s = (await inSpecialWindow('window.__revealState && window.__revealState()')).value; return !!s && !s.current && s.pending === 0 }, '前面的开奖播完', 20_000)
  const r1 = await api(() => window.api.entertainmentCommand('special-play', 'fan_call|show|1'))
  assert.equal(r1.ok, true, r1.error)
  await until(async () => (await loadedGames()).includes('fan_call'), '动作命令出口打开粉丝来电')
  const callRv = (await inSpecialWindow('window.__revealState && window.__revealState()')).value
  assert.ok(!callRv?.current && !callRv?.pending, '来电自己会响铃，不该敲锣开奖：' + JSON.stringify(callRv))
  ok('粉丝来电直接打进来：不敲锣、不出开奖大字（来电自己会响铃）')
  const r2 = await api(() => window.api.entertainmentCommand('special-play', 'no_such|add|1'))
  assert.equal(r2.ok, false, '未知玩法应该报错')
  ok('动作命令出口（转盘/九宫格/时间盲盒共用）能触发特色整蛊，未知玩法会报错')

  // ---- 6a. 礼物联动「触发一次」：走真礼物同一条路（敲锣开奖 + 鸭子生成）----
  await api(() => { window.location.hash = '#/special?tool=catch_duck' })
  const fireBtn = page.getByRole('button', { name: /^触发一次/ }).first()
  await fireBtn.waitFor({ timeout: 10_000 })
  await until(async () => { const s = (await inSpecialWindow('window.__revealState && window.__revealState()')).value; return !!s && !s.current && s.pending === 0 }, '前面的开奖播完', 20_000)
  await fireBtn.click()
  let fireRv = null
  for (let i = 0; i < 60 && !fireRv?.current?.text; i++) { fireRv = (await inSpecialWindow('window.__revealState && window.__revealState()')).value; if (!fireRv?.current?.text) await page.waitForTimeout(100) }
  assert.ok(/鸭/.test(fireRv?.current?.text || ''), '「触发一次」应该和真礼物一样敲锣开奖：' + JSON.stringify(fireRv))
  ok(`礼物联动「触发一次」→ 敲锣开出「${fireRv.current.text}」（和真礼物同一条路）`)
  await capture('06a-link-fire')

  // ---- 6b. 整蛊遥控只管游戏（2026-10-07 用户：「游戏是游戏的，整蛊台是整蛊台的，不应该混淆」）：
  //      没有特色整蛊分组 / 盲盒 / 下拉选项；模拟观众送的礼物照样触发整蛊台的礼物规则（和真礼物一样）----
  await api(() => window.api.specialCloseAll())
  await until(async () => !(await windowOpen()), '先关掉特色整蛊窗口')
  await api(() => { window.location.hash = '#/remote' })
  await page.getByText('整蛊遥控', { exact: true }).first().waitFor({ timeout: 15_000 })
  const gated = await page.getByText('礼物联动', { exact: true }).count() === 0
  if (gated) {
    console.log('SKIP 整蛊遥控：测试账号没有游戏授权，看不到遥控页（只验礼物触发侧）')
  } else {
    const remoteText = await api(() => document.body.innerText)
    assert.ok(!/特色整蛊|盲盒抽一次|叠在直播画面上/.test(remoteText), '整蛊遥控页不该出现特色整蛊')
    assert.equal(await page.getByRole('button', { name: '粉丝来电', exact: true }).count(), 0, '不该有特色整蛊玩法按钮')
    assert.equal(await page.locator('option[value="specialbox"], option[value^="special:"]').count(), 0, '礼物联动下拉不该有特色整蛊')
    ok('整蛊遥控只管游戏：没有特色整蛊分组、盲盒按钮和下拉选项')
    const sim = page.locator('section', { has: page.locator('h3', { hasText: '模拟观众' }) }).getByRole('button', { name: '小心心', exact: true })
    if (await sim.count()) {
      assert.equal(await sim.isDisabled(), false, '模拟观众在没开游戏时也应能点')
      await sim.click()
      await until(async () => (await windowOpen()) && (await loadedGames()).includes('catch_duck'), '模拟观众送小心心触发整蛊台的抓鸭子')
      ok('整蛊遥控「模拟观众」送小心心 → 整蛊台的礼物触发（抓鸭子）照样响应')
    } else {
      console.log('SKIP 模拟观众：预设礼物里没有小心心按钮')
    }
    await capture('06-remote')
  }
  // 礼物触发里的「游戏整蛊」动作：游戏没在跑 → 明确报错（不假装成功），参数和标签正确
  const gp = await api(() => window.api.entertainmentCommand('game-prank', '4wheel-challenge|flip|翻车'))
  assert.equal(gp.ok, false, '游戏没在跑时游戏整蛊不该报成功')
  ok(`礼物触发「游戏整蛊」动作：游戏未运行时报错「${gp.error}」`)

  // ---- 6c. 特色整蛊盲盒（照时间插件）：事件库 → 给礼物勾奖池 → 送礼按奖池抽 ----
  const events = await api(() => window.api.specialBoxEvents())
  assert.ok(events.length >= 90 && events.every((e) => e.id.startsWith('sbe-v-')), `第一次用应放进默认事件库：${events.length}`)
  const gamesInLib = new Set(events.map((e) => e.param.split('|')[0]))
  assert.equal(gamesInLib.size, 17, `默认事件库应覆盖 17 个玩法：${[...gamesInLib]}`)
  ok(`默认事件库 ${events.length} 个事件，覆盖 17 个玩法（固定数量，开出来念得出来）`)
  await api(() => { window.location.hash = '#/special' })
  await page.locator('[data-testid="special-boxes"]').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '添加盲盒礼物' }).click()
  const boxDialog = page.getByRole('dialog')
  await boxDialog.waitFor()
  await api(() => document.querySelectorAll('[role="dialog"] input[list]').forEach((i) => i.removeAttribute('list')))
  await boxDialog.getByPlaceholder('如：小心心 / 人气票 / 玫瑰').fill('嘉年华')
  await boxDialog.getByText(`抽奖事件 · 已选 ${events.length} 项`).waitFor({ timeout: 5000 })
  // 全勾着的组默认收着（组头写「锁链特效 38/38」），点开再挑具体哪一档
  assert.equal(await boxDialog.locator('[role="checkbox"]').count(), 0, '全选时各组应先收着')
  await boxDialog.getByRole('button', { name: '清空选择' }).click()
  await boxDialog.getByRole('button', { name: '展开 抓鸭子', exact: true }).click()
  await boxDialog.getByRole('button', { name: '展开 锁链特效', exact: true }).click()
  await boxDialog.getByRole('checkbox', { name: '抽奖事件 抓鸭子 +5只', exact: true }).click()
  await boxDialog.getByRole('checkbox', { name: '抽奖事件 锁链特效 +5环', exact: true }).click()
  await boxDialog.getByLabel('盲盒名字').fill('嘉年华盲盒')
  await page.waitForTimeout(700)
  await capture('06c-box-modal')
  await boxDialog.getByRole('button', { name: '添加联动' }).click()
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.some((r) => r.giftName === '嘉年华' && r.commandCmd === 'special-box'))), '盲盒礼物落盘')
  const boxRule = (await api(() => window.api.entertainmentRulesList())).find((r) => r.giftName === '嘉年华')
  assert.equal(boxRule.commandParam, 'sbe-v-catch_duck-add-5,sbe-v-chain_challenge-add-5|嘉年华盲盒')
  ok('添加盲盒礼物：嘉年华 → 奖池默认全勾，改成只勾「鸭子 +5」「锁链 +5」，名字「嘉年华盲盒」')

  await api(() => window.api.specialCloseAll())
  await until(async () => !(await windowOpen()), '先关掉窗口')
  await api(() => window.api.connectorSimulate('礼物: 嘉年华 ×3  by 阿彪'))
  await until(() => windowOpen(), '送嘉年华开窗')
  let announce = ''
  for (let i = 0; i < 40 && !announce.includes('开出'); i++) { announce = await bannerText(); if (!announce.includes('开出')) await page.waitForTimeout(150) }
  assert.ok(announce.includes('阿彪的「嘉年华盲盒」×3 开出'), `开盒提示不对：${announce}`)
  // 逐条开奖：第一条正在开（锣 + 大字），配音是随包带的（不用联网现念）
  let rv = null
  for (let i = 0; i < 40 && !rv?.current; i++) { rv = (await inSpecialWindow('window.__revealState && window.__revealState()')).value; if (!rv?.current) await page.waitForTimeout(100) }
  assert.ok(rv?.current && /^(鸭子|锁链)\+5$/.test(rv.current.text), `开奖画面不对：${JSON.stringify(rv)}`)
  assert.equal(rv.current.voiced, true, `默认事件开奖应带随包配音：${JSON.stringify(rv)}`)
  const firstText = rv.current.text
  await until(async () => (await inSpecialWindow('window.__revealState().pending')).value === 0, '三条开奖逐条播完', 20_000)
  const got = await loadedGames()
  assert.ok(got.length >= 1 && got.every((g) => g === 'catch_duck' || g === 'chain_challenge'), `只该从奖池里的两个事件抽：${got}`)
  ok(`模拟送「嘉年华×3 by 阿彪」→ 一次抽 3 份、逐条开奖（第一条「${firstText}」带配音），只开出奖池里的（${got.join('、')}）：「${announce}」`)

  // 开奖设置：存得上、越界夹紧；设置页试听拿得到随包的锣和配音
  const cfg1 = await api(() => window.api.specialRevealConfigure({ rate: -10, gapMs: 999999, position: 'nowhere' }))
  assert.equal(cfg1.reveal.rate, -10)
  assert.equal(cfg1.reveal.gapMs, 3000, `锣后停顿应夹到上限：${cfg1.reveal.gapMs}`)
  assert.equal(cfg1.reveal.position, 'top', `认不出的位置回默认：${cfg1.reveal.position}`)
  const live = (await inSpecialWindow('window.__revealConfig && (window.__revealConfig({}), true)')).value
  assert.equal(live, true)
  await api(() => window.api.specialRevealConfigure({ rate: 0, gapMs: 565 }))
  const pv = await api(() => window.api.specialVoicePreview({ param: 'chain_challenge|add|5' }))
  assert.ok(pv.ok && pv.line === '锁链加5' && pv.text === '锁链+5', `试听：${JSON.stringify(pv)}`)
  assert.ok(pv.voiceUrl.startsWith('zlspecial://app/assets/box_voice/') && pv.gongUrl.endsWith('box_voice/gong.mp3'), `试听地址：${JSON.stringify(pv)}`)
  const fetched = await api(async (u) => { const r = await fetch(u.v); const g = await fetch(u.g); return [r.status, (await r.arrayBuffer()).byteLength, g.status] }, { v: pv.voiceUrl, g: pv.gongUrl })
  assert.ok(fetched[0] === 200 && fetched[1] > 2000 && fetched[2] === 200, `试听文件读不到：${fetched}`)
  const silent = await api(() => window.api.specialVoicePreview({ param: 'fan_call|show|1' }))
  assert.ok(silent.ok && silent.line === '' && silent.text === '粉丝来电', `没数量的不念：${JSON.stringify(silent)}`)
  ok(`开奖设置：语速 -10% 存上、锣后停顿夹到 3000 毫秒、乱写的位置回默认；试听「${pv.line}」读的是随包配音（${fetched[1]} 字节），粉丝来电只敲锣不念`)

  const row = page.locator(`[data-box-rule="${boxRule.id}"]`)
  await row.waitFor({ timeout: 10_000 })
  await row.getByRole('checkbox', { name: '抽奖事件 锁链特效 +5环', exact: true }).click()
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.find((r) => r.giftName === '嘉年华')?.commandParam === 'sbe-v-catch_duck-add-5|嘉年华盲盒')), '盲盒礼物行里去勾即存')
  await row.getByRole('button', { name: '抽一次' }).click()
  let drawn = ''
  for (let i = 0; i < 40 && !drawn.includes('主播的「嘉年华盲盒」开出：抓鸭子'); i++) { drawn = await bannerText(); await page.waitForTimeout(150) }
  assert.ok(drawn.includes('主播的「嘉年华盲盒」开出：抓鸭子'), `抽一次的提示不对：${drawn}`)
  await capture('06d-box-section')
  ok(`盲盒礼物行里直接去勾「锁链」→ 自动存进礼物规则；「抽一次」只开出鸭子：「${drawn}」`)

  // 在「抓鸭子」这一组里点「加一档」：加在抓鸭子里，新的那条直接展开
  await page.locator('[data-testid="special-box-events"] button[aria-expanded]').first().click()
  await page.getByRole('button', { name: '在 抓鸭子 里加一档', exact: true }).click()
  await until(() => api((n) => window.api.specialBoxEvents().then((l) => l.length === n), events.length + 1), '新事件落盘')
  const lib = page.locator('[data-testid="special-box-events"]')
  const del = lib.locator('[data-box-event="sbe-v-catch_duck-add-5"]').getByRole('button', { name: /删除事件/ })
  await del.click()
  await del.click()
  await until(() => api(() => window.api.specialBoxEvents().then((l) => !l.some((e) => e.id === 'sbe-v-catch_duck-add-5'))), '删掉的事件落盘')
  await until(() => api(() => window.api.entertainmentRulesList().then((l) => l.find((r) => r.giftName === '嘉年华')?.commandParam === '|嘉年华盲盒')), '删掉的事件从奖池里摘掉')
  const added = (await api(() => window.api.specialBoxEvents())).at(-1)
  assert.ok(added.param.startsWith('catch_duck|'), `「加一档」应加在抓鸭子里：${added.param}`)
  ok('事件库：在「抓鸭子」组里「加一档」就加在抓鸭子里、即存；删掉「抓鸭子 +5」后，嘉年华的奖池里也跟着摘掉')

  // ---- 6c'. 导入开奖视频（照时间盲盒：一段视频一个事件）：文件名里的数就是数量 ----
  {
    const { execFileSync } = await import('node:child_process')
    const vdir = path.join(output, 'duck-videos')
    await fs.mkdir(vdir, { recursive: true })
    const mk = (name) => {
      const f = path.join(vdir, name)
      execFileSync(path.join(root, 'ffmpeg', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x7FFF00:s=320x240:d=1:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f])
      return f
    }
    const f10 = mk('抓10只-创作淘宝店路师傅的特效铺.mp4')
    const f11 = mk('抓11只-创作淘宝店路师傅的特效铺(2).mp4')
    const imp = await api((files) => window.api.specialBoxImportVideos('catch_duck', files), [f10, f11])
    assert.equal(imp.ok, true, imp.error)
    assert.equal(imp.attached, 1, `「抓10只」应挂到已有的「鸭子 +10」：${JSON.stringify(imp)}`)
    assert.equal(imp.added, 1, `「抓11只」应新建一档：${JSON.stringify(imp)}`)
    const ten = imp.events.find((e) => e.id === 'sbe-v-catch_duck-add-10')
    const eleven = imp.events.find((e) => e.video === f11)
    assert.equal(ten.video, f10)
    assert.ok(eleven && eleven.param === 'catch_duck|add|11' && eleven.name === '抓11只', `新建的事件不对：${JSON.stringify(eleven)}`)
    const again = await api((files) => window.api.specialBoxImportVideos('catch_duck', files), [f10])
    assert.equal(again.attached + again.added, 0, '同一段视频不该重复导入')
    const tr = await api(() => window.api.specialBoxEventTest('sbe-v-catch_duck-add-10'))
    assert.equal(tr.ok, true, tr.error)
    let vst = null
    for (let i = 0; i < 40 && !vst?.current?.video; i++) { vst = (await inSpecialWindow('window.__revealState && window.__revealState()')).value; if (!vst?.current?.video) await page.waitForTimeout(100) }
    assert.ok(vst?.current?.video, `开到挂了视频的事件，窗口里应放视频：${JSON.stringify(vst)}`)
    ok(`导入开奖视频：「抓10只」挂到已有的「鸭子 +10」、「抓11只」新建一档（名字取视频名），同一段不重复导；开到它时窗口里放视频`)
  }

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
      beats: await st('zlspecial://app/assets/tug_of_war/cake.png')
    }
  })
  assert.notEqual(sec.winini, 200, `不该读到 win.ini：${JSON.stringify(sec)}`)
  assert.notEqual(sec.escape, 200, `不该跳出素材目录：${JSON.stringify(sec)}`)
  assert.equal(sec.beats, 200, `素材目录里的图片应能读：${JSON.stringify(sec)}`)
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
