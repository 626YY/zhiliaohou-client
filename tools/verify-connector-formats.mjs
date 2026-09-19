// 端到端：隔离隐藏客户端走真实 IPC 验「三款连接器各自的真实输出格式，娱乐助手（互动工具）的礼物规则都能触发」
//   用户 2026-09-07 的疑问：「我会怀疑娱乐助手里面的功能，是否可以触发」。
//   风险点不在规则引擎，而在「连接器打出来的那行字，客户端认不认」——三款连接器输出格式并不一样：
//     主连接器 connector.py（轮椅 / DON'T SCREAM）  「[connector] 礼物: 小心心 x3  by 阿彪 1 分/个」
//     薄连接器（图书管理员 DarkMage）              「[darkmage-connector] gift 小心心 x3 by 阿彪」
//   两种都必须走到同一路解析 → 礼物规则入执行队列 + 本场统计记账。老实现只认中文那种，
//   接薄连接器的游戏送礼物什么都不触发（工作笔记 2026-09-03 已修过一次，这里把它锁死）。
//   ★connectorSimulate 走的就是连接器 stdout 的同一条 push() 通路，所以这里验的是真实链路，不是旁路。
// 用法：node tools/verify-connector-formats.mjs   （不需要网络，不开挂件窗口）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/connector-formats')
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
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000
})
let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.connectorSimulate && !!window.api?.entertainmentRuleAdd && !!window.api?.queueState)
  const send = async (line) => {
    const r = await page.evaluate((t) => window.api.connectorSimulate(t), line)
    assert.equal(r.ok, true, `${line} → ${r.error ?? ''}`)
  }
  const queued = () => page.evaluate(() => window.api.queueState().then((s) => s.snapshot.pending.length + (s.snapshot.running ? 1 : 0)))
  // 执行队列排得很快（默认执行间隔小），固定 sleep 之后读瞬时值会读到 0/1 —— 轮询取峰值，只关心「有没有进队」
  const peakQueued = async (ms = 2500) => {
    let peak = 0
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      peak = Math.max(peak, await queued())
      if (peak > 0 && (await queued()) === 0) break
      await sleep(60)
    }
    return peak
  }
  const stats = () => page.evaluate(() => window.api.liveStats())

  // 礼物规则：小心心 → 倒计时 +1 秒（无副作用的动作命令，和现有娱乐回归同一条）
  const added = await page.evaluate(() => window.api.entertainmentRuleAdd({
    id: '', giftName: '小心心', actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '1',
    enabled: true, queueMode: 'normal', multiply: true
  }))
  assert.equal(added.ok, true, added.error)
  // 本场统计要开张才记账（连接器在跑），模拟模式即可
  assert.equal((await page.evaluate(() => window.api.connectorStart('', true))).ok, true)
  await sleep(1000)
  await page.evaluate(() => window.api.queueClear())

  // ① 主连接器格式（轮椅 / DON'T SCREAM）：礼物规则入队 ×3
  await send('[connector] 礼物: 小心心 x3  by 阿彪 1 分/个')
  const n1 = await peakQueued()
  assert.ok(n1 >= 1, `主连接器格式的礼物应入执行队列，队列峰值 ${n1}`)
  pass('主连接器格式触发礼物规则', `队列峰值 ${n1}`)
  await page.evaluate(() => window.api.queueClear())

  // ② 薄连接器格式（图书管理员 / DON'T SCREAM 薄连接器）：同一条规则也要触发
  await sleep(200)
  await send('[darkmage-connector] gift 小心心 x3 by 阿彪')
  const n2 = await peakQueued()
  assert.ok(n2 >= 1, `薄连接器格式的礼物应入执行队列，队列峰值 ${n2}（这就是「送了礼物娱乐助手没反应」的老病根）`)
  pass('薄连接器格式触发礼物规则', `队列峰值 ${n2}`)
  await page.evaluate(() => window.api.queueClear())

  // ③ 桥协议格式（bridge.txt 那种 gift <名> <数> | <人>）也要认
  await sleep(200)
  await send('gift 小心心 2 | 阿彪')
  const n3 = await peakQueued()
  assert.ok(n3 >= 1, `桥协议格式的礼物应入执行队列，队列峰值 ${n3}`)
  pass('桥协议格式触发礼物规则', `队列峰值 ${n3}`)

  // ④ 两种格式的礼物/点赞/关注都要进本场统计（统计页数字 = 真收到）
  const s0 = (await stats()).session
  await send('[connector] 点赞: 12')
  await send('[darkmage-connector] like 7')
  await send('[connector] 关注 by 阿彪')
  await send('[darkmage-connector] follow | 小王')
  await sleep(500)
  const s1 = (await stats()).session
  assert.equal(s1.likes - s0.likes, 19, `两种点赞格式都要累加：${s0.likes} → ${s1.likes}`)
  assert.equal(s1.follows - s0.follows, 2, `两种关注格式都要计次：${s0.follows} → ${s1.follows}`)
  assert.equal(s1.gifts, 8, `本场礼物个数应为 3+3+2：实际 ${s1.gifts}`)
  assert.ok(s1.coins > 0, `抖币应由内置礼物表补上，实际 ${s1.coins}`)
  pass('两种格式都进本场统计', `gifts=${s1.gifts} coins=${s1.coins} likes=${s1.likes} follows=${s1.follows}`)

  // ⑤ 连接器日志里的普通行不能被误判成礼物（否则日志一刷屏就乱触发整蛊）
  await page.evaluate(() => window.api.queueClear())
  await sleep(200)
  for (const noise of [
    '[connector] 正在连接直播间…',
    '[darkmage-connector] 断档礼物队列: 发现 3 条待补发',
    '[darkmage-connector] status: 已连接直播间',
    'stub connector'
  ]) await send(noise)
  await sleep(600)
  const n5 = await queued()
  const s2 = (await stats()).session
  assert.equal(n5, 0, `噪声行不该入队，实际 ${n5}`)
  assert.equal(s2.gifts, s1.gifts, '噪声行不该改本场礼物数')
  pass('噪声行不误触发', `队列 ${n5}，礼物数仍 ${s2.gifts}`)

  await page.evaluate(() => window.api.connectorStop())
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure, profile, modDir }, null, 2))
  await app.close()
  console.log(`SUMMARY ${checks.length}/5 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
