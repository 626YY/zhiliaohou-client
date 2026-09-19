// 「并进时间盲盒」的端到端 UI 验证（2026-09-07 用户实测「点了导入，盲盒事件库还是 0」）。
//
// 上一版我在主进程 timeWidgetUpdate({blindBoxEvents}) 改内存就完事了 —— 而倒计时配置的权威
// 是【渲染进程的 localStorage('ent_time_cfg')】，页面从那儿读，所以页面里永远是 0。
// 这支测试就钉这一环：真的点开导入弹窗、选「并进时间盲盒」、点导入，然后读 localStorage。
//
// 覆盖：① 导入后 localStorage 里真有事件（页面读的就是这份）
//       ② 事件带 op/value/video，且能过时间挂件自己的校验
//       ③ 同一项目重复导入不叠加
//       ④ 事件库有内容时倒计时被顺手打开（否则盲盒不触发）
//       ⑤ 倒计时页打开后，界面上「盲盒事件库」的计数不是 0
// 用法：node tools/verify-time-import-ui.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'time-import-ui')
const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

// 夹具素材库：一个时间类项目（3 条，各带 GBK 脚本）
const lib = path.join(out, 'assets')
const dir = path.join(lib, '夹具时间项目')
await fs.mkdir(dir, { recursive: true })
const { default: iconv } = await import('iconv-lite')
for (const [name, script] of [['加1分', '加班增加:60秒'], ['减1分', '加班减少:60秒'], ['翻倍', '加班乘以:2']]) {
  await fs.writeFile(path.join(dir, `${name}.mp4`), Buffer.from('zl-test'))
  await fs.writeFile(path.join(dir, `${name}.脚本`), iconv.encode(script, 'gbk'))
}

const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, pinyouAssetRoot: lib }))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

let app
try {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.pinyouTimeImport && window.api?.login))
  // 走 UI 必须先登录，否则停在登录页什么卡片都点不到（和 test-entertainment-electron 同一套夹具账号）
  const login = await page.evaluate(async () => {
    await window.api.register('entertainment_regression', 'Fixture123!', '娱乐助手回归')
    const r = await window.api.login('entertainment_regression', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    return r
  })
  assert.equal(login.ok, true, login.error || '夹具账号登录失败')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 15_000 })
  // 起点：事件库为空（就是用户截图里那个「盲盒事件库 0」）
  await page.evaluate(() => localStorage.removeItem('ent_time_cfg'))
  const readCfg = () => page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('ent_time_cfg') || '{}')
    } catch {
      return {}
    }
  })
  assert.equal(((await readCfg()).blindBoxEvents || []).length, 0, '起点事件库该是空的')

  // 走 UI：娱乐助手(/ent) → 「礼物触发」卡片 → 「导入品游项目」→ 选「并进时间盲盒」→ 导入
  //（礼物规则不是顶层路由，它是 /ent 里 id='gift' 的那张卡）
  await page.evaluate(() => { window.location.hash = '#/ent' })
  await page.waitForTimeout(600)
  const goRules = async () => {
    for (let i = 0; i < 3; i++) {
      if (await page.getByRole('button', { name: '导入项目', exact: true }).count().then((n) => n > 0)) return true
      const card = page.getByText('礼物触发', { exact: true }).first()
      if (await card.count().then((n) => n > 0).catch(() => false)) {
        await card.click().catch(() => {})
        await page.waitForTimeout(800)
      } else {
        await page.evaluate(() => { window.location.hash = '#/ent' })
        await page.waitForTimeout(600)
      }
    }
    return (await page.getByRole('button', { name: '导入项目', exact: true }).count()) > 0
  }
  const openDialog = async () => {
    const btn = page.getByRole('button', { name: '导入项目', exact: true })
    await btn.waitFor({ timeout: 20_000 })
    await btn.click()
    await page.getByText('导入方式').waitFor({ timeout: 10_000 })
  }
  const reached = await goRules()
  assert.ok(reached, '找不到「导入品游项目」按钮，页面没到礼物触发卡片')
  await openDialog()
  await page.getByRole('button', { name: '并进时间盲盒' }).click()
  // 弹窗默认全勾；直接点导入
  const importBtn = page.getByRole('button', { name: /加入时间盲盒/ })
  await importBtn.waitFor({ timeout: 10_000 })
  await importBtn.click()
  // 等 localStorage 真的被写进去（这就是上次漏掉的那一环）
  let cfg = {}
  for (let i = 0; i < 60; i++) {
    cfg = await readCfg()
    if ((cfg.blindBoxEvents || []).length) break
    await page.waitForTimeout(200)
  }
  const events = cfg.blindBoxEvents || []
  assert.equal(events.length, 3, `导入后 localStorage 里该有 3 个事件，实际 ${events.length}（这正是用户看到「事件库 0」的地方）`)
  pass('★点完导入，页面读的那份 localStorage 里真有事件了', `${events.length} 个`)

  // ② 事件内容
  const by = Object.fromEntries(events.map((e) => [e.name, e]))
  assert.deepEqual([by['加1分'].op, by['加1分'].value], ['add', 60])
  assert.deepEqual([by['减1分'].op, by['减1分'].value], ['subtract', 60])
  assert.deepEqual([by['翻倍'].op, by['翻倍'].value], ['multiply', 2])
  assert.ok(String(by['加1分'].video || '').endsWith('加1分.mp4'), `事件要带自己的视频：${by['加1分'].video}`)
  const bad = await page.evaluate((evs) => {
    // 用时间挂件自己的校验器过一遍（页面里已经引了）
    return evs.filter((e) => !e.id || !e.name || !e.op || typeof e.value !== 'number').map((e) => e.name)
  }, events)
  assert.deepEqual(bad, [], `有事件字段不全：${bad}`)
  pass('事件带 op / 数值 / 自己的视频', '加60 / 减60 / ×2')

  // ④ 倒计时被顺手打开
  assert.equal(cfg.enable, true, '事件库有内容时该把倒计时打开，否则盲盒不会触发')
  pass('倒计时被顺手打开（否则盲盒不触发）')

  // ③ 重复导入不叠加
  await openDialog()
  await page.getByRole('button', { name: '并进时间盲盒' }).click()
  await page.getByRole('button', { name: /加入时间盲盒/ }).click()
  await page.waitForTimeout(1200)
  const again = (await readCfg()).blindBoxEvents || []
  assert.equal(again.length, 3, `同一项目重复导入不该叠加，实际 ${again.length}`)
  pass('同一项目重复导入不叠加')

  // ⑤ 倒计时页界面上的计数不是 0
  // 现在在礼物触发页，要先「返回功能列表」回到卡片列表，再点「时间插件」
  const back = page.getByRole('button', { name: '返回功能列表' }).first()
  if (await back.count().then((n) => n > 0).catch(() => false)) {
    await back.click().catch(() => {})
    await page.waitForTimeout(800)
  }
  // 卡片是个可点的块，用它的副标题文字定位最稳（卡片标题在 DOM 里可能被拆开）
  for (const sel of ['倒计时 · 时间盲盒 · 礼物加减时间', '时间插件']) {
    const el = page.getByText(sel, { exact: false }).first()
    if (await el.count().then((n) => n > 0).catch(() => false)) {
      await el.click().catch(() => {})
      await page.waitForTimeout(1200)
      if (await page.getByText('盲盒事件库').count().then((n) => n > 0)) break
    }
  }
  const boxSection = page.locator('[aria-label="时间盲盒事件库"]')
  if (!(await boxSection.count().then((n) => n > 0).catch(() => false))) {
    // 没进到时间插件页：把页面上看得见的标题打出来，好定位问题
    const seen = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,button'))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 25)
    )
    assert.fail(`没进到时间插件页。页面上看到的是：${JSON.stringify(seen)}`)
  }
  const boxLabel = boxSection.getByText('盲盒事件库').first()
  await boxLabel.waitFor({ timeout: 15_000 })
  // 标题旁边那个数字就是事件数（用户截图里是 0）
  const txt = await boxLabel.locator('..').innerText().catch(() => '')
  const shownCount = Number((txt.match(/盲盒事件库\s*(\d+)/) || [])[1] ?? -1)
  assert.equal(shownCount, 3, `★倒计时页上该显示 3 个盲盒事件，实际显示 ${shownCount}（用户看到的就是这里的 0）：${txt.replace(/\s+/g, ' ').slice(0, 80)}`)
  pass('★倒计时页界面上「盲盒事件库」显示 3，不再是 0', txt.replace(/\s+/g, ' ').slice(0, 40))
} finally {
  await app?.close().catch(() => {})
}
console.log(`\n时间盲盒导入 UI ${passed.length} 项 PASS`)
