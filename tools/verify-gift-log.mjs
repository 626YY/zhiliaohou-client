// 端到端：隔离隐藏客户端走真实 IPC 验「礼物记录」（谁送了什么）主进程记账
//   2026-09-07 用户：「客户端里面也要有礼物记录的」。以前按人的账只有管理后台有。
//   ① 三种连接器输出格式都记：主连接器 / 薄连接器 / 桥协议；最近的在前
//   ② 抖币：事件自带的「N 分/个」优先，没带的查内置礼物表补
//   ③ 送礼榜按人聚合、按抖币从高到低
//   ④ 噪声行不记
//   ⑤ limit 生效
//   ⑥ 重启客户端记录还在（主进程落盘，页面关着也照样记）
//   ⑦ 清空后归零
//   ⑧ 模拟事件造的礼物带 sim 标记（模拟模式在跑 / 行首「模拟礼物:」两种来源），真礼物不标
// 用法：node tools/verify-gift-log.mjs   （不需要网络）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/gift-log')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
const modDir = path.join(path.dirname(settings.gamePaths['4wheel-challenge']), 'Mods', 'WheelLive')
await fs.mkdir(modDir, { recursive: true })
await fs.writeFile(path.join(modDir, 'connector.py'), 'import sys, time\nprint("stub", flush=True)\nwhile True: time.sleep(1)\n', 'utf8')
await fs.writeFile(path.join(modDir, 'bridge.txt'), '', 'utf8')
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const pass = (name, detail = '') => { checks.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' | ' + detail : '')) }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const launch = () => electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000
})

let app = await launch()
let failure
try {
  let page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.giftLogState && !!window.api?.connectorSimulate)
  const send = async (line) => {
    const r = await page.evaluate((t) => window.api.connectorSimulate(t), line)
    assert.equal(r.ok, true, `${line} → ${r.error ?? ''}`)
  }
  const state = (limit) => page.evaluate((n) => window.api.giftLogState(n), limit)

  assert.equal((await state()).kept, 0, '新档案的礼物记录应该是空的')

  // ① 三种格式各记一条（顺序=发送顺序，读出来最近的在前）
  await send('[connector] 礼物: 小心心 x3  by 阿彪 5 分/个')
  await sleep(120)
  await send('[darkmage-connector] gift 甜甜圈 x2 by 小王')
  await sleep(120)
  await send('gift 玫瑰 1 | 榜一大哥')
  await sleep(400)
  const s1 = await state()
  assert.equal(s1.kept, 3, `三种格式都该记一条，实际 ${s1.kept}`)
  assert.deepEqual(s1.rows.map((r) => r.gift), ['玫瑰', '甜甜圈', '小心心'], '最近的在前')
  assert.deepEqual(s1.rows.map((r) => r.sender), ['榜一大哥', '小王', '阿彪'], '送礼人对得上')
  assert.deepEqual(s1.rows.map((r) => r.count), [1, 2, 3], '个数对得上')
  assert.equal(s1.total, 6, `礼物总个数应为 1+2+3，实际 ${s1.total}`)
  pass('三种连接器格式都记进礼物记录', `${s1.rows.map((r) => `${r.sender}/${r.gift}×${r.count}`).join('，')}`)

  // ② 抖币：自带「5 分/个」的按 5×3=15；没带的查内置礼物表（甜甜圈/玫瑰都有单价）
  const xin = s1.rows.find((r) => r.gift === '小心心')
  assert.equal(xin.coins, 15, `事件自带 5 分/个 应算 5×3=15，实际 ${xin.coins}`)
  const rose = s1.rows.find((r) => r.gift === '玫瑰')
  const donut = s1.rows.find((r) => r.gift === '甜甜圈')
  assert.ok(rose.coins > 0 && donut.coins > 0, `没带单价的应查内置礼物表补：玫瑰 ${rose.coins}、甜甜圈 ${donut.coins}`)
  assert.equal(s1.totalCoins, s1.rows.reduce((sum, r) => sum + r.coins, 0), '总抖币 = 各条之和')
  pass('抖币自带优先、缺失查内置礼物表', `小心心 ${xin.coins}、甜甜圈 ${donut.coins}、玫瑰 ${rose.coins}`)

  // ③ 送礼榜：同一人多次要合并，按抖币从高到低
  await send('[connector] 礼物: 小心心 x1  by 阿彪 5 分/个')
  await sleep(400)
  const s2 = await state()
  const abiao = s2.senders.find((x) => x.sender === '阿彪')
  assert.equal(abiao.gifts, 4, `阿彪应合并成 3+1=4 个，实际 ${abiao.gifts}`)
  assert.equal(abiao.coins, 20, `阿彪应合并成 15+5=20 抖币，实际 ${abiao.coins}`)
  const coins = s2.senders.map((x) => x.coins)
  assert.deepEqual(coins, [...coins].sort((a, b) => b - a), `送礼榜要按抖币从高到低：${JSON.stringify(s2.senders)}`)
  pass('送礼榜按人合并并按抖币排序', s2.senders.map((x) => `${x.sender || '未知'}=${x.coins}`).join('，'))

  // ④ 噪声行不记
  for (const noise of ['[connector] 正在连接直播间…', '[connector] 点赞: 12', '[connector] 关注 by 阿彪', '[darkmage-connector] status: 已连接直播间'])
    await send(noise)
  await sleep(400)
  assert.equal((await state()).kept, 4, '点赞/关注/状态/普通日志都不该进礼物记录')
  pass('噪声与非礼物事件不记')

  // ⑤ limit 生效
  assert.equal((await state(2)).rows.length, 2, 'limit=2 只给最近两条')
  assert.equal((await state(2)).kept, 4, 'kept 仍是全部条数')
  pass('limit 只截明细不改总数')

  // ⑥ 重启客户端记录还在
  await sleep(1200) // 写盘是攒 0.8 秒的，等它落盘
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.giftLogState)
  const s3 = await page.evaluate(() => window.api.giftLogState())
  assert.equal(s3.kept, 4, `重启后记录应还在，实际 ${s3.kept}`)
  assert.deepEqual(s3.rows.map((r) => r.gift), ['小心心', '玫瑰', '甜甜圈', '小心心'], '重启后顺序和内容不变')
  assert.equal(s3.senders.find((x) => x.sender === '阿彪').coins, 20, '重启后送礼榜也在')
  pass('重启客户端记录还在', `${s3.kept} 条、${s3.totalCoins} 抖币`)

  // ⑦ 清空
  const cleared = await page.evaluate(() => window.api.giftLogClear())
  assert.equal(cleared.cleared, 4, `清空应报清掉 4 条，实际 ${cleared.cleared}`)
  const s4 = await page.evaluate(() => window.api.giftLogState())
  assert.equal(s4.kept, 0)
  assert.equal(s4.senders.length, 0, '送礼榜跟着清零')
  assert.equal(s4.totalCoins, 0)
  pass('清空后归零')

  // ⑧ 模拟标记：模拟模式连接器在跑时的礼物、以及「模拟礼物:」前缀的行，都要标成模拟
  assert.equal((await page.evaluate(() => window.api.connectorStart('', true))).ok, true)
  await sleep(800)
  await send('[connector] 礼物: 小心心 x1  by 测试 1 分/个')
  await sleep(400)
  const s5 = await page.evaluate(() => window.api.giftLogState())
  assert.equal(s5.rows[0].sim, true, '模拟模式在跑时收到的礼物要标模拟')
  await page.evaluate(() => window.api.connectorStop())
  await sleep(400)
  await send('[connector] 模拟礼物: 玫瑰 x1  by 测试')
  await sleep(400)
  const s6 = await page.evaluate(() => window.api.giftLogState())
  assert.equal(s6.rows[0].sim, true, '「模拟礼物:」前缀的行也要标模拟')
  await send('gift 甜甜圈 1 | 阿彪')
  await sleep(400)
  const s7 = await page.evaluate(() => window.api.giftLogState())
  assert.equal(s7.rows[0].sim, undefined, '真礼物不该被标模拟')
  pass('模拟礼物标记（模拟模式 + 模拟前缀），真礼物不标')
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure, profile, modDir }, null, 2))
  await app.close()
  console.log(`SUMMARY ${checks.length}/8 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
