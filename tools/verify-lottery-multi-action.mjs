// 转盘/九宫格奖项的多动作与「动作命令」万能出口（2026-09-07 用户：
// 「转盘和九宫格的动作没有那哪个＋号」「礼物触发应该包含所有能触发的东西，现在还是缺失的」）。
//
// 奖项原来用的是另一套只有 9 种动作的 LotteryAction，且一个奖项只能配一个动作。
// 现在加了 'command' 万能出口（把礼物规则那 30 多个动作命令整套接过来）和 actions[] 附加动作。
// 转盘 / 九宫格 / 时间盲盒共用同一个执行器，所以这一处验过，三处都通。
//
// 覆盖：① 万能命令出口真能调到动作命令（加班器数值变化为证）
//       ② 一个奖项的多个动作按顺序都执行（加班 + 计数各自变化）
//       ③ 附加动作的延迟真的等了
//       ④ 只有一个奖项时抽奖必中它（断言才有确定性）
//       ⑤ 加班加减 / 计时加减 打到各自的挂件（两个都开着时原来会串台）
// 用法：node tools/verify-lottery-multi-action.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'lottery-multi')
const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({ guideSeen: true }))
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
  await page.waitForFunction(() => Boolean(window.api?.lotteryOpen && window.api?.challengeOpen))

  // 加班器 + 计数器都开起来：它们的数值就是「动作真的执行了」的证据
  await page.evaluate(() => window.api.challengeOpen({ slot: 'overtime', mode: 'counter', value: 0 }))
  await page.evaluate(() => window.api.challengeOpen({ slot: 'challenge', mode: 'counter', value: 0 }))
  const overtime = () => page.evaluate(() => window.api.challengeState('overtime').then((s) => s.value ?? 0))
  const counter = () => page.evaluate(() => window.api.challengeState('challenge').then((s) => s.value ?? 0))
  const waitValue = async (read, from, ms = 8000) => {
    const t0 = Date.now()
    let v = from
    while (v === from && Date.now() - t0 < ms) {
      await page.waitForTimeout(120)
      v = await read()
    }
    return v
  }

  // ---- ① 万能命令出口：奖项主动作 = 动作命令「加班加减 +30」----
  // 只放一个奖项 → 必中它，断言才有确定性
  await page.evaluate(() => window.api.lotteryOpen('wheel', [
    { name: '唯一奖', color: '#e8622c', action: 'command', actionParam: 'overtime-adjust|30' }
  ]))
  let before = await overtime()
  let r = await page.evaluate(() => window.api.lotterySpin('wheel'))
  assert.equal(r.ok, true, `抽奖应成功：${JSON.stringify(r)}`)
  let after = await waitValue(overtime, before)
  assert.equal(after - before, 30, `万能命令出口该让加班器 +30，实际 ${before} → ${after}`)
  pass('奖项动作能用「动作命令」（30 多个命令整套接过来）', `加班器 ${before} → ${after}`)

  // ---- ②③ 多动作 + 延迟：主动作 +30，附加动作等 0.6 秒再 +7 ----
  await page.evaluate(() => window.api.lotteryOpen('wheel', [
    {
      name: '连招奖',
      color: '#e8622c',
      action: 'command',
      actionParam: 'overtime-adjust|30',
      actions: [{ action: 'command', actionParam: 'overtime-adjust|7', delayMs: 600 }]
    }
  ]))
  before = await overtime()
  const t0 = Date.now()
  r = await page.evaluate(() => window.api.lotterySpin('wheel'))
  assert.equal(r.ok, true)
  // 先等到主动作落地（+30），再等附加动作（+7）
  const mid = await waitValue(overtime, before)
  assert.equal(mid - before, 30, `主动作该先 +30，实际 ${before} → ${mid}`)
  const end = await waitValue(overtime, mid)
  assert.equal(end - mid, 7, `附加动作该再 +7，实际 ${mid} → ${end}`)
  const elapsed = Date.now() - t0
  assert.ok(elapsed >= 600, `附加动作的 0.6 秒延迟没等，只用了 ${elapsed}ms`)
  pass('一个奖项多个动作按顺序执行，附加动作的延迟真的等了', `${before} → ${mid} → ${end}，用时 ${elapsed}ms`)

  // ---- ② 不同类型混搭：视频（路径不存在会失败）之后的动作照样跑 ----
  await page.evaluate(() => window.api.lotteryOpen('wheel', [
    {
      name: '混搭奖',
      color: '#e8622c',
      action: 'video',
      actionParam: 'Z:\\不存在的视频.mp4',
      actions: [{ action: 'command', actionParam: 'overtime-adjust|5', delayMs: 0 }]
    }
  ]))
  before = await overtime()
  await page.evaluate(() => window.api.lotterySpin('wheel'))
  after = await waitValue(overtime, before)
  assert.equal(after - before, 5, `主动作失败也不该吞掉后面的动作，实际 ${before} → ${after}`)
  pass('主动作失败（视频路径不存在）不影响后面的动作')

  // ---- ④ 九宫格同样生效（共用一个执行器）----
  await page.evaluate(() => window.api.lotteryOpen('nine', [
    { name: '九宫唯一', color: '#e8622c', action: 'command', actionParam: 'overtime-adjust|11' }
  ]))
  before = await overtime()
  r = await page.evaluate(() => window.api.lotterySpin('nine'))
  assert.equal(r.ok, true, `九宫格抽奖应成功：${JSON.stringify(r)}`)
  after = await waitValue(overtime, before)
  assert.equal(after - before, 11, `九宫格也该走同一套动作，实际 ${before} → ${after}`)
  pass('九宫格奖项同样支持（和转盘、时间盲盒共用执行器）')

  // ---- ⑤ 加班加减 / 计时加减 不串台（两个挂件都开着）----
  const ot0 = await overtime()
  const ct0 = await counter()
  await page.evaluate(() => window.api.entertainmentCommand('overtime-adjust', '13'))
  await page.evaluate(() => window.api.entertainmentCommand('count-adjust', '4'))
  const ot1 = await waitValue(overtime, ot0)
  const ct1 = await waitValue(counter, ct0)
  assert.equal(ot1 - ot0, 13, `加班加减该只打加班器：${ot0} → ${ot1}`)
  assert.equal(ct1 - ct0, 4, `计时加减该只打计数挑战：${ct0} → ${ct1}`)
  pass('加班加减 / 计时加减 各打各的挂件（原来两个都开着会串台）', `加班 +13、计数 +4`)

  // 收尾：开过的窗口都关掉。残留窗口会让紧接着启动的下一支测试起不来（打包链里就这么挂过一次）
  await page.evaluate(() => window.api.lotteryClose('wheel'))
  await page.evaluate(() => window.api.lotteryClose('nine'))
  await page.evaluate(() => window.api.challengeClose('overtime'))
  await page.evaluate(() => window.api.challengeClose('challenge'))
} finally {
  await app?.close().catch(() => {})
}
console.log(`\n转盘多动作 ${passed.length}/5 PASS`)
