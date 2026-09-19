// 端到端：隔离隐藏客户端（当前 out/ 构建）走真实 IPC 验「自动缓存抖音礼物图」与「连接器组件自动补齐/更新」
//   夹具游戏目录里造 Mods/WheelLive/（wheelLiveDir 解析到这里，不碰真实游戏目录）：
//   ① 启动后自动同步（ZL_GIFT_SYNC_STARTUP_MS=2000 把 15 秒等待缩到 2 秒）：不点任何按钮，真拉抖音礼物表、真下图 → 状态文件落地、目录里的图 = 下载数
//   ② 礼物图库把新图当「连接器实抓」（source=connector）收进来，按名字都能查到
//   ③ 手动「同步礼物图」再跑一次 → 已有的全认出、不重复下载（抖音礼物表每次轮换约 20 个礼物，零星新增正常）
//   ④ 夹具里放一个没版本标记的旧 douyin_room.py、不放 sign.js → 模拟模式启动前：旧的备份后换新、sign.js 补齐、日志各一条
// 用法：node tools/verify-gift-image-sync.mjs   （需要网络）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
import { isRealGift } from '../src/shared/giftFilter.ts'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/gift-image-sync')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
const gameExe = settings.gamePaths['4wheel-challenge']
const modDir = path.join(path.dirname(gameExe), 'Mods', 'WheelLive')
await fs.mkdir(modDir, { recursive: true })
// 连接器桩：只打一行就退出（验证「启动前补齐/更新组件」不需要真连）
await fs.writeFile(path.join(modDir, 'connector.py'), 'import sys\nprint("stub connector", flush=True)\nsys.exit(0)\n', 'utf8')
await fs.writeFile(path.join(modDir, 'bridge.txt'), '', 'utf8')
// 旧版弹幕组件桩：没有 DOUYIN_ROOM_VERSION 标记 → 应被客户端自带版本替换；sign.js 故意不放 → 应被补齐
await fs.writeFile(path.join(modDir, 'douyin_room.py'), '# 旧版桩：2026-08 的副本，没有 DOUYIN_ROOM_VERSION 标记\n', 'utf8')
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_GIFT_SYNC_STARTUP_MS: '2000' }
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
  await page.waitForFunction(() => !!window.api?.giftImagesSync)

  // ① 启动后自动同步：不碰任何按钮，等连接器日志出现同步结果（最多 4 分钟，取决于要下多少张）
  const statePath = path.join(profile, 'data', 'gift-image-sync.json')
  const deadline = Date.now() + 240_000
  let doneLine
  while (Date.now() < deadline) {
    const logs = await page.evaluate(() => window.api.connectorLog())
    doneLine = logs.find((l) => /礼物图同步完成|礼物图已是最新|拉取抖音礼物表失败/.test(l.text))
    if (doneLine) break
    await sleep(1000)
  }
  assert.ok(doneLine, '启动后 4 分钟内应自动同步完成（连接器日志里有结果行）')
  assert.ok(!/失败：/.test(doneLine.text) || /礼物图同步完成/.test(doneLine.text), `自动同步失败：${doneLine.text}`)
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
  const r1 = state.lastResult
  console.log('AUTO ' + JSON.stringify({ lastRoom: state.lastRoom, ...r1 }))
  assert.equal(state.lastRoom ?? '', '', '启动自动同步走通用礼物表（没房间号）')
  assert.ok(r1.total >= 500, '礼物表至少几百个礼物')
  assert.ok(r1.downloaded >= 1, '全新夹具目录首次同步应下到内置库没有的新礼物图')
  const dir = path.join(modDir, '礼物图', '抖音')
  const files = (await fs.readdir(dir)).filter((f) => /\.(png|webp|jpe?g|gif)$/i.test(f))
  assert.equal(files.length, r1.downloaded, '目录里的图片数 = 下载数（.part 都已改名）')
  assert.ok(!(await fs.readdir(dir)).some((f) => f.endsWith('.part')), '没有半截文件')
  const realFiles = files.filter((f) => isRealGift(f.replace(/\.[^.]+$/, '')))
  assert.equal(realFiles.length, files.length, '只下真礼物（道具类被 isRealGift 过滤）')
  pass('启动后自动同步真下图（不点按钮）', `total=${r1.total} existing=${r1.existing} downloaded=${r1.downloaded} failed=${r1.failed}`)

  // ② 礼物图库把新图当「连接器实抓」收进来，按名字都能查到
  const after = await page.evaluate(() => window.api.entertainmentListGiftImages())
  const byName = new Map(after.map((g) => [g.name, g]))
  const missing = files.map((f) => f.replace(/\.[^.]+$/, '')).filter((stem) => byName.get(stem)?.source !== 'connector')
  assert.equal(missing.length, 0, `新图都应作为 connector 来源进入礼物图库，缺：${missing.slice(0, 5).join('、')}`)
  pass('礼物图库收进新图（connector 来源）', `${after.length} 张，样例 ${files[0].replace(/\.[^.]+$/, '')}`)

  // ③ 手动同步：第一次下的图全部被认出、不重复下。抖音礼物表两次请求会轮换约 20 个礼物（实测 838→839，进出各 20 左右），
  //    所以不要求严格 0 新增，只要求新增极少且已有的全被认出
  const r2 = await page.evaluate(() => window.api.giftImagesSync(''))
  assert.equal(r2.ok, true, r2.error)
  assert.ok(r2.existing >= r1.existing + r1.downloaded - 40, `第一次下的图应全部被认出：existing ${r1.existing}+${r1.downloaded} → ${r2.existing}`)
  assert.ok(r2.downloaded <= 40, `第二次不该重复下载（只允许礼物表轮换带来的零星新礼物）：downloaded=${r2.downloaded}`)
  const files2 = (await fs.readdir(dir)).filter((f) => /\.(png|webp|jpe?g|gif)$/i.test(f))
  assert.equal(files2.length, files.length + r2.downloaded, '目录里的图 = 第一次 + 第二次新增（没有覆盖重写）')
  pass('手动同步不重复下载', `existing=${r2.existing} 轮换新增=${r2.downloaded}`)

  // ④ 连接器组件：旧版 douyin_room.py 备份后换新、缺 sign.js 补齐
  assert.equal(await fs.access(path.join(modDir, 'sign.js')).then(() => true, () => false), false, '夹具里一开始没有 sign.js')
  const start = await page.evaluate(() => window.api.connectorStart('', true))
  assert.equal(start.ok, true, start.error)
  await sleep(1500)
  const roomPy = await fs.readFile(path.join(modDir, 'douyin_room.py'), 'utf8')
  assert.ok(roomPy.length > 10000 && /^DOUYIN_ROOM_VERSION\s*=\s*"\d{4}-\d{2}-\d{2}"/m.test(roomPy), '旧版 douyin_room.py 已换成带版本标记的客户端自带版本')
  const baks = (await fs.readdir(modDir)).filter((f) => f.startsWith('douyin_room.py.bak-'))
  assert.equal(baks.length, 1, '旧文件应备份为 douyin_room.py.bak-YYYYMMDD')
  const signJs = await fs.stat(path.join(modDir, 'sign.js'))
  assert.ok(signJs.size > 400000, 'sign.js 已补进连接器目录')
  const logs = await page.evaluate(() => window.api.connectorLog())
  assert.ok(logs.some((l) => /douyin_room\.py 是旧版（无版本标记 → \d{4}-\d{2}-\d{2}）.*已换成客户端自带的版本/.test(l.text)), '日志应记录换新')
  assert.ok(logs.some((l) => /缺少 sign\.js，已用客户端自带的副本补齐/.test(l.text)), '日志应记录补齐 sign.js')
  await page.evaluate(() => window.api.connectorStop())
  pass('连接器组件：旧版换新 + 缺件补齐', `douyin_room.py ${roomPy.length} B，${baks[0]}，sign.js ${signJs.size} B`)
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure, profile, modDir }, null, 2))
  await app.close()
  console.log(`SUMMARY ${checks.length}/4 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
