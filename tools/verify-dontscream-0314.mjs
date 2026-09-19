// 0.3.14 × DON'T SCREAM 0.2.9 端到端验证：用当前 out/ 构建起一个隔离的隐藏客户端实例，
// 走真实 preload/IPC 对着正在运行的游戏验：心跳状态、实时模式 cfgset 推送、整蛊原样召唤、礼物映射、mod 版本识别。
// 用法：node tools/verify-dontscream-0314.mjs --game-exe "<DontScream-Win64-Shipping.exe>"
// 前提：游戏已在运行且已进森林（hb.json in=1）。不关游戏、不连直播间；会往游戏里发一个 mummyrun 和一只 owl。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const exeArg = process.argv.indexOf('--game-exe')
assert.ok(exeArg >= 0 && process.argv[exeArg + 1], '--game-exe is required')
const gameExe = path.resolve(process.argv[exeArg + 1])
assert.match(path.basename(gameExe), /^DontScream-Win64-Shipping\.exe$/i)
await fs.access(gameExe)
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/dontscream-0314')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
settings.currentGameId = 'dontscream'
settings.gamePaths.dontscream = gameExe
await fs.writeFile(path.join(profile, 'data/settings.json'), JSON.stringify(settings))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const modDir = path.join(path.dirname(gameExe), 'ue4ss/Mods/zhiliao')
const modLog = path.join(path.dirname(gameExe), 'ue4ss/zhiliao.log')
const logBefore = (await fs.readFile(modLog, 'utf8')).length
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const pass = (name, detail = '') => { checks.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' | ' + detail : '')) }
async function delta() { return (await fs.readFile(modLog, 'utf8')).slice(logBefore) }
async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const r = await fn()
    if (r) return r
    await new Promise((res) => setTimeout(res, 400))
  }
  throw new Error('Timed out: ' + label)
}
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000
})
let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.liveState)

  // 1. 心跳状态：0.2.9 写 hb.json，客户端 liveState 应带 modAlive/inGame/bridgeReady
  const state = await page.evaluate(() => window.api.liveState())
  console.log('STATE ' + JSON.stringify(state))
  assert.equal(state.running, true, '游戏必须在运行')
  assert.equal(state.bridgeOk, true)
  assert.equal(path.resolve(state.path), path.join(modDir, 'bridge.txt'))
  assert.equal(state.modAlive, true, 'hb.json 应在 20 秒内更新过（mod 0.2.9 心跳）')
  assert.equal(state.bridgeReady, true)
  pass('liveState 带心跳：modAlive/bridgeReady', `inGame=${state.inGame} hbAgeSec=${state.hbAgeSec}`)

  // 2. 版本识别：游戏目录版本标记 0.2.9，与清单一致 → 不该提示可更新
  const mods = await page.evaluate(() => window.api.listMods())
  const ds = mods.mods.find((m) => m.id === 'zhiliao-dontscream')
  const inst = mods.installed['zhiliao-dontscream']
  assert.ok(ds && inst, '游戏库应识别已装的 DON\'T SCREAM mod')
  assert.equal(ds.version, '0.2.9', '清单版本')
  assert.equal(inst.version, '0.2.9', '已装版本（.zl-version 标记）')
  pass('游戏库识别 mod 0.2.9 = 清单 0.2.9（不提示可更新）', `installPath=${inst.installPath}`)

  // 3. 参数页数据：schema 含 RealtimeFallback，默认冷却 2 / 排队 20；当前 config 值读得到
  const cfg = await page.evaluate(() => window.api.readConfig())
  assert.equal(cfg.ok, true, cfg.error)
  const keys = cfg.schema.fields.map((f) => f.key)
  assert.ok(keys.includes('RealtimeFallback'), 'schema 缺 RealtimeFallback')
  const cd = cfg.schema.fields.find((f) => f.key === 'Cooldown')
  assert.equal(cd.default, 2)
  assert.equal(cfg.values.Binds.scream, 'Keypad1')
  pass('参数页 schema/配置：RealtimeFallback 在、冷却默认 2、尖叫=Keypad1', `fields=${keys.length}`)

  // 4. 实时模式推送：cfgset 走桥 → mod 即时生效（改到 3 再改回 2）
  let pos = (await fs.readFile(modLog, 'utf8')).length
  let r = await page.evaluate(() => window.api.liveSet('Cooldown', 3))
  assert.equal(r.ok, true, r.error)
  await until(async () => /cfgset Cooldown: 2 -> 3/.test((await fs.readFile(modLog, 'utf8')).slice(pos)), 'mod 应用 cfgset', 15000)
  pos = (await fs.readFile(modLog, 'utf8')).length
  r = await page.evaluate(() => window.api.liveSet('Cooldown', 2))
  assert.equal(r.ok, true, r.error)
  await until(async () => /cfgset Cooldown: 3 -> 2/.test((await fs.readFile(modLog, 'utf8')).slice(pos)), 'mod 还原 cfgset', 15000)
  pass('实时模式 cfgset：Cooldown 2→3→2 即时生效')

  // 5. 整蛊原样召唤：mummyrun 必须由总监放出 mummyrun，不能被换成别的
  pos = (await fs.readFile(modLog, 'utf8')).length
  r = await page.evaluate(() => window.api.livePrank('mummyrun'))
  assert.equal(r.ok, true, r.error)
  const t1 = await until(async () => {
    const s = (await fs.readFile(modLog, 'utf8')).slice(pos)
    return /SpawnScare\[1\]\(mummyrun\) => ok=true ret=true/.test(s) ? s : null
  }, 'mummyrun 由总监召唤', 25000)
  assert.ok(!/实时兜底|手动惊吓/.test(t1), '不许换成别的惊吓')
  pass('整蛊原样召唤：mummyrun → SpawnScare[1] ok=true，无替换')

  // 6. 礼物映射：gift 抖音 → owl
  await new Promise((res) => setTimeout(res, 2500))
  pos = (await fs.readFile(modLog, 'utf8')).length
  r = await page.evaluate(() => window.api.liveCmd('gift 抖音 1'))
  assert.equal(r.ok, true, r.error)
  await until(async () => {
    const s = (await fs.readFile(modLog, 'utf8')).slice(pos)
    return s.includes('gift -> 抖音') && /SpawnScare\[2\]\(owl\) => ok=true ret=true/.test(s)
  }, '礼物映射 owl 由总监召唤', 25000)
  pass('礼物映射：抖音 → owl → SpawnScare[2] ok=true')
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  const log = await delta().catch(() => '')
  await fs.writeFile(path.join(profile, 'mod-delta.log'), log)
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure, profile, gameExe }, null, 2))
  await app.close()
  console.log(`SUMMARY ${checks.length}/6 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
