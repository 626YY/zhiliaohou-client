// 端到端：隔离隐藏客户端（当前 out/ 构建）走真实 IPC 验「直播互动统计不再依赖 mod 侧写 live_stats.json」
//   夹具游戏目录 Mods/WheelLive/ 里故意放一份「上一场残留」的 live_stats.json（room=sim、last 是 2 小时前）+ 桩 connector.py：
//   ① 没连接器时：统计页读到的是那份残留报告，且判为已下播（不能因为文件里 running:1 就说直播中）
//   ② 模拟模式启动连接器：本场账开张 → 残留被让位、room 变成 sim、判「直播中」
//   ③ 模拟礼物/点赞/关注 → 礼物个数、抖币（内置礼物表补的）、点赞、关注都记上
//   ④ 安静 70 秒（超过统计页 60 秒过期线）仍然是「直播中」——靠连接器进程在跑 + 10 秒心跳
//   ⑤ 停止连接器 → 已下播，数字定格
// 用法：node tools/verify-live-session.mjs   （不需要网络）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/live-session')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
const gameExe = settings.gamePaths['4wheel-challenge']
const modDir = path.join(path.dirname(gameExe), 'Mods', 'WheelLive')
await fs.mkdir(modDir, { recursive: true })
// 连接器桩：一直挂着不退出（模拟模式下真实连接器也是常驻），这样 connectorState().running 为真
await fs.writeFile(
  path.join(modDir, 'connector.py'),
  'import sys, time\nprint("stub connector", flush=True)\nwhile True: time.sleep(1)\n',
  'utf8'
)
await fs.writeFile(path.join(modDir, 'bridge.txt'), '', 'utf8')
// 上一场残留：running:1 但 last 是 2 小时前（DS 目录 2026-09-06 就躺着这样一份模拟模式的残留）
const staleAt = Math.floor(Date.now() / 1000) - 7200
await fs.writeFile(
  path.join(modDir, 'live_stats.json'),
  JSON.stringify({ room: '残留房间', started: staleAt - 600, last: staleAt, gifts: 7, coins: 70, likes: 3, follows: 1, running: 1 }),
  'utf8'
)
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
  await page.waitForFunction(() => !!window.api?.liveStats && !!window.api?.connectorSimulate)
  const stats = () => page.evaluate(() => window.api.liveStats())

  // ① 没连接器：读到残留报告，但必须判已下播
  const before = await stats()
  assert.equal(before.ok, true, before.error)
  assert.equal(before.session.room, '残留房间', '没本场账时读 mod 的残留报告')
  assert.equal(before.session.running, 0, '残留里 running:1 也要按已下播算（last 是 2 小时前）')
  pass('残留报告判已下播', `room=${before.session.room} gifts=${before.session.gifts}`)

  // ② 模拟模式启动 → 本场账开张，残留让位
  const start = await page.evaluate(() => window.api.connectorStart('', true))
  assert.equal(start.ok, true, start.error)
  await sleep(1200)
  const opened = await stats()
  assert.equal(opened.session.room, 'sim', '本场账（模拟模式）顶掉残留')
  assert.equal(opened.session.running, 1, '连接器在跑 → 直播中')
  assert.equal(opened.session.gifts, 0, '新的一场从 0 开始')
  pass('本场账开张顶掉残留', `room=${opened.session.room} running=${opened.session.running}`)

  // ③ 模拟礼物/点赞/关注 → 都记上；小心心内置礼物表有抖币，coins 应大于 0
  for (const line of ['礼物: 小心心 ×3  by 阿彪', '礼物: 小心心 ×2  by 阿彪', '点赞: 12', '关注 by 阿彪', '关注 by 小王']) {
    const r = await page.evaluate((t) => window.api.connectorSimulate(t), line)
    assert.equal(r.ok, true, `${line} → ${r.error ?? ''}`)
  }
  await sleep(600)
  const counted = await stats()
  assert.equal(counted.session.gifts, 5, '礼物按个数累加（3+2）')
  assert.equal(counted.session.likes, 12, '点赞累加增量')
  assert.equal(counted.session.follows, 2, '关注计次')
  assert.ok(counted.session.coins > 0, `抖币应由内置礼物表补上，实际 ${counted.session.coins}`)
  pass('礼物/点赞/关注都记上', `gifts=${counted.session.gifts} coins=${counted.session.coins} likes=${counted.session.likes} follows=${counted.session.follows}`)

  // ④ 安静 70 秒（超过 60 秒过期线）仍是直播中
  await sleep(70_000)
  const quiet = await stats()
  assert.equal(quiet.session.running, 1, '安静的直播间不该被判成已下播')
  assert.equal(quiet.session.gifts, 5, '安静期间数字不该变')
  assert.ok(quiet.session.last > counted.session.last, '心跳应把 last 往前推')
  pass('安静 70 秒仍判直播中', `last 推进 ${quiet.session.last - counted.session.last} 秒`)

  // ⑤ 停止 → 已下播，数字定格
  await page.evaluate(() => window.api.connectorStop())
  await sleep(1000)
  const stopped = await stats()
  assert.equal(stopped.session.running, 0, '停止后判已下播')
  assert.equal(stopped.session.gifts, 5, '停止后数字定格')
  assert.equal(stopped.session.room, 'sim', '仍是本场账（残留更旧）')
  pass('停止后已下播且数字定格', `gifts=${stopped.session.gifts} coins=${stopped.session.coins}`)
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
