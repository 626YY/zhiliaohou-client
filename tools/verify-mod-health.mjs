// 健康自检/自动修复：只在临时游戏目录布置损坏文件，从 OSS 下载并验证真实修复链路。
// 不启动占位游戏、不读写真实游戏目录；所有删除和移动先核对路径位于本次隔离配置内。
// 用法：node tools/verify-mod-health.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output/playwright/mod-health'); await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
const GAME_ROOT = path.join(profile, 'dontscream-fixture')
const SHIP = path.join(GAME_ROOT, 'DontScream', 'Binaries', 'Win64', 'DontScream-Win64-Shipping.exe')
const WIN64 = path.dirname(SHIP)
const DW = path.join(WIN64, 'dwmapi.dll')
const DW_BAK = DW + '.zltest'
const STRAY_UE4SS = path.join(GAME_ROOT, 'ue4ss')
const STRAY_DW = path.join(GAME_ROOT, 'dwmapi.dll')
await fs.mkdir(WIN64, { recursive: true })
await fs.writeFile(SHIP, '')
await fs.writeFile(DW, 'fixture')
const assertFixturePaths = () => {
  for (const target of [DW, DW_BAK, STRAY_UE4SS, STRAY_DW]) {
    const relative = path.relative(profile, path.resolve(target))
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Refusing to modify non-fixture path')
  }
}
const exists = (p) => fsSync.existsSync(p)
const checks = []
const pass = (n, d = '') => { checks.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }
const breakIt = async () => {
  assertFixturePaths()
  if (exists(DW)) await fs.rename(DW, DW_BAK)
  await fs.mkdir(path.join(STRAY_UE4SS, 'Mods', 'zhiliao'), { recursive: true })
  await fs.writeFile(path.join(STRAY_UE4SS, 'Mods', 'zhiliao', 'enabled.txt'), '')
  await fs.writeFile(STRAY_DW, 'zltest stray')
}
const restore = async () => {
  assertFixturePaths()
  // 无论测试成败：dwmapi.dll 必须在（重装回来的就用重装的，否则把改名的挪回去）；错位文件必须清掉
  if (!exists(DW) && exists(DW_BAK)) await fs.rename(DW_BAK, DW)
  if (exists(DW) && exists(DW_BAK)) await fs.rm(DW_BAK, { force: true })
  await fs.rm(STRAY_UE4SS, { recursive: true, force: true })
  await fs.rm(STRAY_DW, { force: true })
}
const waitFor = async (fn, ms, step = 1000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, step)) } return fn() }

const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({ ...settings, currentGameId: 'dontscream', gamePaths: { ...settings.gamePaths, dontscream: SHIP }, gamePath: SHIP, gameExeName: path.basename(SHIP) }))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
let failure, app
try {
  // ① 启动前弄坏 → 启动自修
  await breakIt()
  assert.ok(!exists(DW) && exists(STRAY_DW), '夹具没布好')
  const t0 = Date.now()
  app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.api?.modHealth)
  const fixed = await waitFor(() => exists(DW) && !exists(STRAY_UE4SS) && !exists(STRAY_DW), 150_000)
  assert.ok(fixed, '启动自修没把 dwmapi.dll 装回来 / 没清掉错位文件（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）')
  // 文件先落地、日志随后才写（文件流），给日志 15 秒
  const mainLog = path.join(profile, 'logs', 'main.log')
  const readMh = async () => (exists(mainLog) ? await fs.readFile(mainLog, 'utf8') : '').split(/\r?\n/).filter((l) => l.includes('[modhealth]'))
  await waitFor(async () => (await readMh()).some((l) => l.includes('自动修复完成')), 15_000, 500)
  const mh = await readMh()
  console.log('  main.log [modhealth]:\n    ' + mh.join('\n    '))
  assert.ok(mh.some((l) => l.includes('自动修复完成')), 'main.log 没有「自动修复完成」')
  pass('启动自修：文件缺失 + 装错位置 → 自动清理并从 OSS 重装', ((Date.now() - t0) / 1000).toFixed(1) + 's')
  let h = await page.evaluate(() => window.api.modHealth('dontscream'))
  assert.equal(h.ok, true, '自修后 health 仍不 ok: ' + JSON.stringify(h.issues))
  pass('自修后 modHealth ok', `v${h.version || '?'} modId=${h.modId}`)

  // ② 再弄坏 → 手动 health / repair
  await breakIt()
  h = await page.evaluate(() => window.api.modHealth('dontscream'))
  console.log('  弄坏后 health:', JSON.stringify(h.issues))
  assert.equal(h.ok, false)
  const miss = h.issues.find((i) => i.code === 'missing-files'); assert.ok(miss && miss.fixable && miss.files.includes('dwmapi.dll'), '没报 missing-files dwmapi.dll')
  assert.ok(/杀毒/.test(miss.text), '缺 dwmapi.dll 应提示杀毒白名单')
  const mis = h.issues.find((i) => i.code === 'misplaced'); assert.ok(mis && mis.fixable && mis.files.length >= 1, '没报 misplaced')
  assert.ok(!h.issues.some((i) => i.code === 'not-loaded'), '游戏没在跑不该报 not-loaded')
  pass('modHealth：报出 missing-files（含杀毒提示）+ misplaced，不误报 not-loaded')
  const r = await page.evaluate(() => window.api.modRepair('dontscream'))
  console.log('  repair:', JSON.stringify(r))
  assert.equal(r.ok, true, '修复失败 ' + r.error)
  assert.ok(r.did.some((d) => d.startsWith('清掉错位文件')) && r.did.includes('已重装整蛊器'))
  assert.ok(exists(DW) && !exists(STRAY_UE4SS) && !exists(STRAY_DW), '修复后文件状态不对')
  h = await page.evaluate(() => window.api.modHealth('dontscream'))
  assert.equal(h.ok, true, '修复后 health 仍不 ok: ' + JSON.stringify(h.issues))
  pass('modRepair：清错位 + 重装 → modHealth ok')

  // ③ 别的游戏（本机装没装都行）：没定位 → no-path 不可修；定位了 → 正常给出结论
  const h4 = await page.evaluate(() => window.api.modHealth('4wheel-challenge'))
  if (h4.issues[0]?.code === 'no-path') {
    assert.ok(h4.ok === false && h4.issues[0].fixable === false, JSON.stringify(h4))
    const r4 = await page.evaluate(() => window.api.modRepair('4wheel-challenge'))
    assert.equal(r4.ok, false)
    pass('未定位的游戏：no-path 不可修，repair 明确拒绝', r4.error)
  } else {
    assert.equal(h4.modId, 'wheellive')
    pass('轮椅（本机已定位）：health 正常给出结论', `ok=${h4.ok} v${h4.version || '?'} issues=${JSON.stringify(h4.issues.map((i) => i.code))}`)
  }
  const hx = await page.evaluate(() => window.api.modHealth('no-such-game'))
  assert.ok(hx.ok === true && hx.issues.length === 0)
  const rx = await page.evaluate(() => window.api.modRepair('no-such-game'))
  assert.equal(rx.ok, false)
  pass('没有整蛊器规则的游戏：health ok 且无问题，repair 明确拒绝', rx.error)
} catch (e) { failure = e; console.log('FAIL ' + (e?.stack || e)) }
finally {
  await app?.close().catch(() => {})
  await restore()
  console.log('  夹具已还原：dwmapi.dll=' + exists(DW) + ' 备份残留=' + exists(DW_BAK) + ' 错位残留=' + (exists(STRAY_UE4SS) || exists(STRAY_DW)))
}
if (failure) process.exit(1)
console.log(`全部通过 ${checks.length} 项`)
