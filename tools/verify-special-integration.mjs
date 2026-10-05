// 特色整蛊 × 娱乐助手送礼系统 · 端到端回归（隐藏的独立客户端实例，独立 userData，不碰正式配置，不抢前台）。
// 覆盖：
//   1. 0.3.63 测试版玩法自带的礼物触发 → 启动时迁成礼物规则（只迁一次）
//   2. 特色整蛊宫格：17 张卡片、真实美术经 zlspecial 协议加载
//   3. 详情页预览舞台：iframe 跑真实玩法代码，自动演示有活动
//   4. 详情页「添加联动」→ 存成礼物规则（动作 = 特色整蛊）
//   5. 模拟送礼 → 规则触发 → 玩法窗口自动打开并收到命令（带送礼人）
//   6. 礼物规则编辑器里「特色整蛊」单独一格 + 参数编辑；转盘等走的 entertainmentCommand 出口
//   7. 全部清屏 / 关闭全部；zlspecial 协议拒绝读素材目录外和非媒体文件
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
// 主进程里找某个玩法窗口（标题 = 玩法名），在它页面里跑一段 JS
const inSpecialWindow = (title, script) => app.evaluate(async ({ BrowserWindow }, a) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === a.title)
  if (!w) return { missing: true }
  return { value: await w.webContents.executeJavaScript(a.script) }
}, { title, script })

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

  // ---- 2. 宫格页 ----
  await api(() => { window.location.hash = '#/special' })
  await page.locator('[data-special-card]').first().waitFor({ timeout: 15_000 })
  assert.equal(await page.locator('[data-special-card]').count(), 17, '应有 17 张玩法卡片')
  await page.waitForTimeout(1200)
  const art = await api(() => [...document.querySelectorAll('[data-special-card] img')].filter((i) => i.src.startsWith('zlspecial:')).map((i) => ({ src: i.src, w: i.naturalWidth })))
  const broken = art.filter((a) => !a.w)
  assert.ok(art.length >= 13, `卡片主图太少：${art.length}`)
  assert.equal(broken.length, 0, `有卡片图没加载出来：${JSON.stringify(broken)}`)
  ok(`宫格 17 张卡片，${art.length} 张真实美术全部加载`)
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

  // ---- 5. 模拟送礼 → 自动开窗 + 收到命令 ----
  assert.equal((await api(() => window.api.specialState())).games.find((g) => g.id === 'catch_duck').open, false, '送礼前鸭子窗口不该开着')
  await api(() => window.api.connectorSimulate('礼物: 小心心 ×2  by 阿彪'))
  await until(() => api(() => window.api.specialState().then((s) => s.games.find((g) => g.id === 'catch_duck').open)), '抓鸭子窗口自动打开')
  await until(async () => (await inSpecialWindow('抓鸭子', 'window.__alive && window.__alive()')).value === true, '鸭子窗口收到命令开始动')
  const banner = await inSpecialWindow('抓鸭子', 'document.getElementById("btx") ? document.getElementById("btx").textContent : ""')
  ok(`模拟送礼「小心心×2 by 阿彪」→ 抓鸭子窗口自动打开并开始生成（横幅：${banner.value || '无'}）`)
  await api(() => window.api.connectorSimulate('礼物: 玫瑰 ×1  by 小美'))
  await until(async () => (await inSpecialWindow('锁链特效', 'window.__alive && window.__alive()')).value === true, '迁移的玫瑰规则触发锁链')
  ok('迁移来的「玫瑰」规则触发锁链特效窗口')

  // ---- 6. 礼物规则编辑器 + 通用出口 ----
  await api(() => { window.location.hash = '#/ent?tool=gift' })
  await page.getByText('小心心', { exact: false }).first().waitFor({ timeout: 10_000 })
  const labelShown = await api(() => document.body.innerText.includes('特色整蛊 抓鸭子 +3只 · 大鸭子'))
  assert.ok(labelShown, '礼物触发列表里应显示「特色整蛊 抓鸭子 +3只 · 大鸭子」')
  await capture('05-gift-rules')
  const r1 = await api(() => window.api.entertainmentCommand('special-play', 'fan_call|show|1'))
  assert.equal(r1.ok, true, r1.error)
  await until(() => api(() => window.api.specialState().then((s) => s.games.find((g) => g.id === 'fan_call').open)), '动作命令出口打开粉丝来电')
  const r2 = await api(() => window.api.entertainmentCommand('special-play', 'no_such|add|1'))
  assert.equal(r2.ok, false, '未知玩法应该报错')
  ok('动作命令出口（转盘/九宫格/时间盲盒共用）能触发特色整蛊，未知玩法会报错')

  // ---- 6b. 和整蛊器融合：整蛊遥控里的特色整蛊分组 / 礼物联动 / 模拟观众；礼物触发的「游戏整蛊」动作 ----
  await api(() => window.api.specialCloseAll())
  await until(() => api(() => window.api.specialState().then((s) => s.games.every((g) => !g.open))), '先全部关掉')
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
    await until(() => api(() => window.api.specialState().then((s) => s.games.find((g) => g.id === 'fan_call').open)), '整蛊遥控点特色整蛊打开窗口')
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
      await until(() => api(() => window.api.specialState().then((s) => s.games.find((g) => g.id === 'throw_poop').open)), '模拟观众送棒棒糖触发扔粑粑')
      ok('整蛊遥控「模拟观众」送棒棒糖 → 礼物触发规则 → 扔粑粑窗口自动打开')
    } else {
      console.log('SKIP 模拟观众：预设礼物里没有棒棒糖按钮')
    }
    await capture('06-remote')
  }
  // 礼物触发里的「游戏整蛊」动作：游戏没在跑 → 明确报错（不假装成功），参数和标签正确
  const gp = await api(() => window.api.entertainmentCommand('game-prank', '4wheel-challenge|flip|翻车'))
  assert.equal(gp.ok, false, '游戏没在跑时游戏整蛊不该报成功')
  ok(`礼物触发「游戏整蛊」动作：游戏未运行时报错「${gp.error}」`)

  // ---- 6c. 特色整蛊盲盒：自带三个、开一次、送礼开盒 ----
  const boxes = await api(() => window.api.specialBoxes())
  assert.deepEqual(boxes.map((b) => b.name), ['整蛊大礼包', '手忙脚乱盒', '锁链命运盒'], '自带三个盲盒')
  await api(() => window.api.specialCloseAll())
  const opened = await api(() => window.api.specialBoxTest('box-busy-hands'))
  assert.equal(opened.ok, true, opened.error)
  assert.equal(opened.opened.length, 2, '手忙脚乱盒每次开 2 个')
  await until(() => api(() => window.api.specialState().then((s) => s.games.filter((g) => g.open).length >= 1)), '开盒后对应玩法窗口打开')
  ok(`盲盒「手忙脚乱盒」开一次 → 开出 ${opened.opened.join('、')}`)
  await api(() => window.api.entertainmentRuleAdd({ id: '', name: '盲盒测试', group: '特色整蛊', giftName: '跑车', triggerType: 'gift', actionType: 'command', commandCmd: 'special-box', commandParam: 'box-chain-fate|锁链命运盒', times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true }))
  await api(() => window.api.specialCloseAll())
  await api(() => window.api.connectorSimulate('礼物: 跑车 ×1  by 阿彪'))
  await until(() => api(() => window.api.specialState().then((s) => s.games.find((g) => g.id === 'chain_challenge').open)), '送跑车开锁链命运盒')
  const announce = await (async () => {
    for (let i = 0; i < 40; i++) {
      const r = await inSpecialWindow('锁链特效', 'document.getElementById("btx") ? document.getElementById("btx").textContent : ""')
      if (r.value && r.value.includes('开出')) return r.value
      await page.waitForTimeout(150)
    }
    return ''
  })()
  assert.ok(announce.includes('锁链命运盒') && announce.includes('阿彪'), `开盒提示不对：${announce}`)
  ok(`送礼开盲盒：模拟「跑车 by 阿彪」→ 锁链命运盒 → 横幅「${announce}」`)

  // ---- 6d. 直播画面方向：竖屏一键统一，开着的窗口跟着变 ----
  await api(() => { window.location.hash = '#/special' })
  await page.locator('[data-special-card]').first().waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '竖屏 9:16', exact: true }).first().click()
  await until(() => api(() => window.api.specialState().then((s) => s.games.every((g) => g.config.height > g.config.width))), '全部玩法改成竖屏')
  const winSize = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === '锁链特效'); return w ? w.getSize() : null })
  assert.ok(winSize && winSize[1] > winSize[0], `开着的锁链窗口应变成竖的：${JSON.stringify(winSize)}`)
  await capture('07-portrait-grid')
  await page.getByRole('button', { name: '横屏 16:9', exact: true }).first().click()
  await until(() => api(() => window.api.specialState().then((s) => s.games.every((g) => g.config.width > g.config.height))), '改回横屏')
  ok(`直播画面方向：一键竖屏（开着的锁链窗口 ${winSize[0]}×${winSize[1]}），再改回横屏`)

  // ---- 7. 清屏 / 关闭 / 协议安全 ----
  for (const p of ['catch_duck|add|5', 'chain_challenge|add|3', 'fan_call|show|1']) await api((x) => window.api.entertainmentCommand('special-play', x), p)
  await until(async () => (await inSpecialWindow('抓鸭子', 'window.__alive && window.__alive()')).value === true, '清屏前鸭子在动')
  const cleared = await api(() => window.api.specialClearAll())
  assert.ok(cleared.cleared >= 3, `清屏应覆盖开着的窗口：${JSON.stringify(cleared)}`)
  await until(async () => (await inSpecialWindow('抓鸭子', 'window.__alive && window.__alive()')).value === false, '清屏后鸭子窗口空闲', 15_000)
  ok(`全部清屏（${cleared.cleared} 个窗口），鸭子窗口回到空闲`)
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
  assert.ok(closed.closed >= 3)
  await until(() => api(() => window.api.specialState().then((s) => s.games.every((g) => !g.open))), '全部关闭')
  ok('关闭全部窗口')

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
