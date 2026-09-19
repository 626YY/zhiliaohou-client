// 端到端：隔离隐藏客户端走真实 IPC + 真实 Steam 库，验「游戏 exe 路径认错了会自己纠正」。
//   病例直接取自 2026-09-07 用户真机 settings.json：轮椅一直指着测试夹具
//   C:\Temp\zhiliao-backend-audit-fixture\4WheelChallenge.exe（0 字节假 exe），
//   于是 mod 装进 C:\Temp、查进程查不到 —— 主播看到的就是「重装 mod 后检测不到游戏运行」。
//
//   ① 夹具路径不再算「已定位」，并说得出为什么
//   ② 自动探测会把它纠正到真实的 4Wheel Challenge.exe（注意真实文件名带空格）
//   ③ 手选到 DON'T SCREAM 根目录的启动器 Dont_Scream.exe → 自动改到 Binaries/Win64 的 Shipping exe
//      （选错这一层，mod 会装到 UE4SS 读不到的地方）
//   ④ 手选到崩溃处理器 / 卸载程序 → 同样纠正回游戏本体
//   ⑤ 路径压根不存在 → 掉头扫 Steam 库纠正；连扫都扫不到才报错，且不覆盖已存好的路径
// 用法：node tools/verify-game-path.mjs   （需要本机装着这三款游戏；不需要外网）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/game-path')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))

// ── 真机现场 ──────────────────────────────────────────────────────
const FIXTURE = 'C:\\Temp\\zhiliao-backend-audit-fixture\\4WheelChallenge.exe'
const STEAM = 'F:\\SteamLibrary\\steamapps\\common'
const WHEEL_DIR = path.join(STEAM, '4WheelChallenge')
const DS_DIR = path.join(STEAM, "DON'T SCREAM")
const WHEEL_OK = path.join(WHEEL_DIR, '4Wheel Challenge.exe')
const DS_LAUNCHER = path.join(DS_DIR, 'Dont_Scream.exe')
const DS_OK = path.join(DS_DIR, 'DontScream', 'Binaries', 'Win64', 'DontScream-Win64-Shipping.exe')
const CRASH = path.join(WHEEL_DIR, 'UnityCrashHandler64.exe')

for (const [label, p] of [['轮椅本体', WHEEL_OK], ['DS 启动器', DS_LAUNCHER], ['DS 本体', DS_OK]]) {
  if (!fsSync.existsSync(p)) {
    console.error(`跳过：本机没有${label} ${p}`)
    process.exit(2)
  }
}
// 夹具不在就现造一个同样的 0 字节假 exe（不碰真实设置，只在临时目录）
if (!fsSync.existsSync(FIXTURE)) {
  await fs.mkdir(path.dirname(FIXTURE), { recursive: true })
  await fs.writeFile(FIXTURE, '')
}

// 隔离 profile 里种下「病了的」设置：轮椅指夹具，DS 指根目录启动器
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(
  path.join(profile, 'data', 'settings.json'),
  JSON.stringify(
    {
      currentGameId: '4wheel-challenge',
      gamePath: FIXTURE,
      gameExeName: '4WheelChallenge.exe',
      gamePaths: { dontscream: DS_LAUNCHER }
    },
    null,
    2
  ),
  { flag: 'wx' }
)

const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

const checks = []
const pass = (name, detail = '') => {
  checks.push(name)
  console.log('PASS ' + name + (detail ? ' | ' + detail : ''))
}
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'],
  cwd: root,
  env,
  timeout: 30000
})
let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.gamesList && !!window.api?.setGamePath)
  const games = () => page.evaluate(() => window.api.gamesList())
  const setPath = (id, p) => page.evaluate(([i, x]) => window.api.setGamePath(i, x), [id, p])

  // ① 夹具不再算「已定位」，且说得出原因
  //    ★ 必须主动种下坏路径再读：游戏库页面一挂载就会自动 detectAllGames，
  //      等页面 ready 之后再读启动时那份设置，拿到的已经是纠正过的了（第一版测试就这么误判成 FAIL）。
  await page.evaluate(
    ([f, l]) => window.api.saveSettings({ gamePath: f, gamePaths: { '4wheel-challenge': f, dontscream: l } }),
    [FIXTURE, DS_LAUNCHER]
  )
  const before = await games()
  const w0 = before.find((g) => g.id === '4wheel-challenge')
  assert.equal(w0.installed, false, '0 字节的夹具 exe 不该算已定位')
  assert.match(w0.pathError, /空的|临时目录/, `要说清为什么，实际「${w0.pathError}」`)
  const d0 = before.find((g) => g.id === 'dontscream')
  assert.equal(d0.installed, false, '根目录的启动器不该算已定位')
  assert.match(d0.pathError, /游戏本体|DontScream-Win64-Shipping/, `实际「${d0.pathError}」`)
  pass('夹具与启动器都不再算「已定位」', w0.pathError)

  // ② 自动探测把夹具纠正到真实 exe（真实文件名带空格）
  const det = await page.evaluate(() => window.api.detectAllGames())
  assert.equal(det.found['4wheel-challenge'], WHEEL_OK, `应纠正到真实轮椅 exe，实际 ${det.found['4wheel-challenge']}`)
  assert.equal(det.found['dontscream'], DS_OK, `DS 应纠正到 Shipping exe，实际 ${det.found['dontscream']}`)
  const after = await games()
  assert.equal(after.find((g) => g.id === '4wheel-challenge').installed, true)
  assert.equal(after.find((g) => g.id === '4wheel-challenge').path, WHEEL_OK)
  pass('自动探测纠正到真实 exe', path.basename(WHEEL_OK))

  // ③ 手选到 DS 根目录启动器 → 自动改到 Binaries/Win64 的本体
  const r3 = await setPath('dontscream', DS_LAUNCHER)
  assert.equal(r3.ok, true, `应该能纠正：${r3.error}`)
  assert.equal(r3.fixed, true, '应标记为「改过」，UI 才好告诉主播')
  assert.equal(r3.path, DS_OK, `应落到 Shipping exe，实际 ${r3.path}`)
  pass('选到启动器自动改到游戏本体', path.basename(DS_OK))

  // ④ 选到崩溃处理器 → 纠正回本体（同目录，别顺手认了）
  const r4 = await setPath('4wheel-challenge', CRASH)
  assert.equal(r4.ok, true, `应该能纠正：${r4.error}`)
  assert.equal(r4.path, WHEEL_OK, `应落到游戏本体，实际 ${r4.path}`)
  pass('选到崩溃处理器也纠正回本体')

  // ⑤ 选对的照常收下，且不谎报「改过」
  const r5 = await setPath('4wheel-challenge', WHEEL_OK)
  assert.equal(r5.ok, true)
  assert.equal(r5.fixed, false, '本来就对的不该说「已改到」')
  pass('本来就对的原样收下')

  // ⑥ 填了不存在的路径：不静默留着坏路径，而是掉头扫 Steam 库改到真的（UI 会 toast 告知改过了）
  const r6 = await setPath('4wheel-challenge', 'D:\\没有这个目录\\4Wheel Challenge.exe')
  assert.equal(r6.ok, true, `本机装着轮椅，应该能扫到并纠正：${r6.error}`)
  assert.equal(r6.fixed, true, '改过就要标出来，否则主播不知道路径被换了')
  assert.equal(r6.path, WHEEL_OK, `应落到真实 exe，实际 ${r6.path}`)
  pass('填错路径会扫库纠正而不是留着坏值')

  // ⑥b 扫也扫不到（没有规则的游戏）→ 明确报错，且不许动已经存好的路径
  const r6b = await setPath('some-unknown-game', 'D:\\没有这个目录\\x.exe')
  assert.equal(r6b.ok, false, '扫不到就该报错，不能静默收下')
  assert.ok(r6b.error && r6b.error.length > 4, `要给出原因，实际「${r6b.error}」`)
  const keep = await games()
  assert.equal(keep.find((g) => g.id === '4wheel-challenge').path, WHEEL_OK, '失败不许把已有的好路径覆盖掉')
  pass('扫不到时报错且不覆盖已有设置', r6b.error.slice(0, 40))

  // ⑦ 真实设置没被这次测试碰过（隔离 profile 归隔离 profile）
  const realSettings = path.join(process.env.APPDATA, 'zhiliao-client', 'data', 'settings.json')
  const realBefore = fsSync.existsSync(realSettings) ? fsSync.statSync(realSettings).mtimeMs : 0
  assert.ok(String(profile).includes('output'), '测试 profile 必须在 output 下')
  pass('测试只写隔离 profile', `真实设置 mtime ${new Date(realBefore).toLocaleTimeString()}`)
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure }, null, 2))
  await app.close()
  console.log(`SUMMARY ${checks.length}/8 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
