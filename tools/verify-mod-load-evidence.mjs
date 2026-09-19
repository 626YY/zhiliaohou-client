// 「文件都在、就是没加载」这一类坏法的检测验证（2026-09-07 晚：朋友那边 DON'T SCREAM 没有加载横幅、
// 快捷键全无反应，而客户端自检全绿）。用一套假的游戏目录逐个造出坏法，看 modHealth 能不能说出人话。
// 覆盖：① 没有加载器日志（UE4SS 没注入）② 有日志但里面没有我们的 mod（mod 没启动）③ 正常加载 → 不报警
//       ④ 启动的是另一份游戏（other-copy）⑤ 从没开过游戏不误报 ⑥ 导出诊断报告内容齐全
// 用法：node tools/verify-mod-load-evidence.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'mod-load-evidence')
const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

// 一套「装得好好的」假游戏目录：required 里的文件一个不缺，坏的只是「有没有真的加载」
const REQUIRED = [
  'dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/Mods/mods.txt', 'ue4ss/Mods/zhiliao/enabled.txt',
  'ue4ss/Mods/zhiliao/Scripts/main.lua', 'ue4ss/Mods/zhiliao/config.json',
  'ue4ss/Mods/zhiliao/connector.py', 'ue4ss/Mods/zhiliao/douyin_room.py'
]
async function makeGameDir(base, exeName) {
  const win64 = path.join(base, 'DontScream', 'Binaries', 'Win64')
  for (const rel of REQUIRED) {
    const p = path.join(win64, rel)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, rel.endsWith('.json') ? '{}' : 'zltest')
  }
  await fs.writeFile(path.join(win64, exeName), 'zltest exe')
  return win64
}

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })
const EXE = 'DontScream-Win64-Shipping.exe'
const win64 = await makeGameDir(path.join(out, 'game'), EXE)
const shipExe = path.join(win64, EXE)
const ue4ssLog = path.join(win64, 'ue4ss', 'UE4SS.log')
const modLog = path.join(win64, 'ue4ss', 'zhiliao.log')
const hbFile = path.join(win64, 'ue4ss', 'Mods', 'zhiliao', 'hb.json')

const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({
  currentGameId: 'dontscream', gamePaths: { dontscream: shipExe }, gamePath: shipExe, gameExeName: EXE, guideSeen: true
}))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

let app
let fake
try {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.modHealth))
  const health = () => page.evaluate(() => window.api.modHealth('dontscream'))
  const codes = (h) => h.issues.map((i) => i.code)

  // ---- ⑤ 从没开过这款游戏：不许报「没加载」 ----
  let h = await health()
  assert.ok(!codes(h).includes('last-run-not-loaded'), `没开过游戏就报警了：${JSON.stringify(h.issues)}`)
  assert.equal(h.ok, true, `干净装好的目录不该有问题：${JSON.stringify(h.issues)}`)
  pass('从没开过游戏 → 不误报')

  // 让客户端「记得」刚开过一次游戏（正常情况下由健康检查看到进程在跑时写下）
  await fs.writeFile(path.join(profile, 'data', 'game_last_run.json'), JSON.stringify({ dontscream: Date.now() }))

  // ---- ① 开过游戏，但没有任何加载器日志 → UE4SS 根本没注入 ----
  h = await health()
  assert.ok(codes(h).includes('last-run-not-loaded'), `没有 UE4SS 日志时应报「上次没加载」：${JSON.stringify(h.issues)}`)
  const noInject = h.issues.find((i) => i.code === 'last-run-not-loaded')
  assert.match(noInject.text, /上次进游戏时整蛊器没有加载/)
  assert.match(noInject.text, /没有注入|VC\+\+/, `应指向注入失败的原因：${noInject.text}`)
  assert.equal(h.ok, false)
  pass('没有加载器日志 → 报「UE4SS 没注入」并给原因', noInject.text.slice(0, 60))

  // ---- ② 有 UE4SS 日志，但里面没有我们的 mod → mod 没被启动 ----
  await fs.writeFile(ue4ssLog, [
    '[2026-09-07 20:10:01.000] Console created',
    '[2026-09-07 20:10:01.100] UE4SS - v3.0.1 Beta #0',
    '[2026-09-07 20:10:01.200] Starting mods (from mods.txt load order)...',
    "[2026-09-07 20:10:02.000] Error: Lua script failed to load: attempt to index a nil value",
    '[2026-09-07 20:10:03.000] Event loop start'
  ].join('\r\n'))
  h = await health()
  const notStarted = h.issues.find((i) => i.code === 'last-run-not-loaded')
  assert.ok(notStarted, `有日志无 mod 行时应报「上次没加载」：${JSON.stringify(h.issues)}`)
  assert.match(notStarted.text, /整蛊器没跑起来/, notStarted.text)
  assert.match(notStarted.text, /Lua script failed to load/, `应把日志里的报错带出来：${notStarted.text}`)
  assert.equal(notStarted.fixable, true, '这种应该可以点修复')
  assert.equal(h.loader?.name, 'UE4SS')
  assert.equal(h.loader?.modInLog, false)
  pass('有日志但没有 mod 行 → 报「mod 没跑起来」并带出日志报错')

  // ---- ②b mods.txt 把整蛊器标成停用（以前装过别的 mod 留下的）→ 说清楚，并且「修复」要能改回来 ----
  await fs.writeFile(path.join(win64, 'ue4ss', 'Mods', 'mods.txt'), 'BPModLoaderMod : 1\r\nzhiliao : 0\r\nKeybinds : 1\r\n')
  await fs.appendFile(ue4ssLog, "\r\n[2026-09-07 20:10:01.300] Mod 'zhiliao' disabled in mods.txt.")
  h = await health()
  const disabled = h.issues.find((i) => i.code === 'last-run-not-loaded')
  assert.ok(disabled, `mods.txt 停用时应报「上次没加载」：${JSON.stringify(h.issues)}`)
  assert.match(disabled.text, /mods\.txt 里被标成了停用/, disabled.text)
  const fix = await page.evaluate(() => window.api.modRepair('dontscream'))
  assert.ok(fix.did.some((d) => d.includes('mods.txt')), `修复没改 mods.txt：${JSON.stringify(fix)}`)
  // 修复会顺带重装（mods.txt 换成包里那份，本来就不列我们的 mod，靠 enabled.txt 加载）：
  // 只要求「不再是停用状态」，别写死成必须出现 zhiliao : 1
  const modsTxt = await fs.readFile(path.join(win64, 'ue4ss', 'Mods', 'mods.txt'), 'utf8')
  assert.ok(!/zhiliao\s*:\s*0/i.test(modsTxt), `修复后 zhiliao 仍是停用：${modsTxt}`)
  assert.ok(fsSync.existsSync(path.join(win64, 'ue4ss', 'Mods', 'zhiliao', 'enabled.txt')), '修复后 enabled.txt 应该在')
  pass('mods.txt 里被停用 → 说清楚并能一键改回启用')

  // ---- ②c 老整蛊器把作者机器的路径写死了（2026-09-07 事故：主播游戏在 D 盘，脚本去开 F 盘的日志）----
  // 一并验「报错排序」：UE4SS 启动会打一大片 Class::Member = 0x29 的成员偏移量表，其中不少名字带 Error，
  // 旧逻辑把它们当报错、真报错被挤到后面，结论只取第一条 → 主播看到一句没有意义的 0x29。
  await fs.writeFile(path.join(win64, 'ue4ss', 'Mods', 'mods.txt'), 'BPModLoaderMod : 1\r\n')
  await fs.writeFile(ue4ssLog, [
    '[2026-09-07 20:36:39.7703024] FArchiveState::ArIsError = 0x29',
    '[2026-09-07 20:36:39.7703201] FArchiveState::ArIsCriticalError = 0x29',
    '[2026-09-07 20:36:39.7752978] UWorld::bKismetScriptError = 0x18D',
    String.raw`[2026-09-07 20:36:39.8291677] Error executing script: ...\ue4ss\Mods\zhiliao\Scripts\main.lua:22: F:/SteamLibrary/steamapps/common/DON'T SCREAM/DontScream/Binaries/Win64/ue4ss/zhiliao.log: No such file or directory`,
    String.raw`[2026-09-07 20:36:39.8292505] Failed to execute main script: D:\Steam\DontScream\Binaries\Win64\ue4ss\Mods\zhiliao\Scripts\main.lua`
  ].join('\r\n'))
  await fs.rm(hbFile, { force: true })
  await fs.rm(modLog, { force: true })
  h = await health()
  const outdated = h.issues.find((i) => i.code === 'last-run-not-loaded')
  assert.ok(outdated, `写死路径时应报「上次没加载」：${JSON.stringify(h.issues)}`)
  assert.match(outdated.text, /版本太旧/, `应说清要升级，而不是重装同一个版本：${outdated.text}`)
  assert.match(outdated.text, /zhiliao\.log/, `应带出它去找的那个路径：${outdated.text}`)
  assert.ok(!/ArIsError/.test(outdated.text), `偏移量表被当成报错给主播看了：${outdated.text}`)
  assert.match(
    h.loader.errors[0],
    /Error executing script|No such file or directory/,
    `报错没按价值排序：${JSON.stringify(h.loader.errors)}`
  )
  assert.ok(
    !h.loader.errors.some((e) => /=\s*0x[0-9A-F]+/i.test(e)),
    `偏移量表混进报错列表：${JSON.stringify(h.loader.errors)}`
  )
  // 这种坏法的解药就是装新版：点「修复」必须真的重装，漏进白名单的话这里会挂
  const fix2 = await page.evaluate(() => window.api.modRepair('dontscream'))
  assert.ok(fix2.did.some((d) => /重装/.test(d)), `写死路径这种坏法点修复必须重装：${JSON.stringify(fix2)}`)
  pass('老整蛊器写死路径 → 说清要升级、真报错排第一、点修复会重装')

  // ---- ③ 日志里有我们的加载行 + 心跳在 → 一切正常，不报警 ----
  await fs.appendFile(ue4ssLog, '\r\n[2026-09-07 20:10:44.000] [Lua] 20:10:44 [zhiliao] mod loaded v0.2.13')
  await fs.writeFile(modLog, '20:10:44 [zhiliao] mod loading\r\n20:10:44 [zhiliao] bind key F4 -> lunge')
  await fs.writeFile(hbFile, JSON.stringify({ ts: Math.round(Date.now() / 1000), in: 1, ready: 1 }))
  h = await health()
  assert.equal(h.ok, true, `正常加载却报了问题：${JSON.stringify(h.issues)}`)
  assert.equal(h.loader?.modInLog, true)
  pass('日志里有 mod 加载行 + 心跳 → 不报警')

  // ---- ④ 启动的是另一份游戏：进程在跑，但 exe 不在客户端检查的那个目录 ----
  // 用一个自己起的、同名的假进程模拟（绝不碰用户真的游戏）
  const otherDir = path.join(out, 'other-copy')
  await fs.mkdir(otherDir, { recursive: true })
  const fakeExe = path.join(otherDir, EXE)
  await fs.copyFile(process.execPath, fakeExe)   // 拿 electron.exe 当壳，只要进程名对得上
  fake = spawn(fakeExe, ['--version'], { detached: false, stdio: 'ignore', env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
  // --version 会立刻退出，改用一个一直等的：node 模式跑一个空的 setInterval
  fake.kill()
  fake = spawn(fakeExe, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'ignore', env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
  const sawOther = await (async () => {
    for (let i = 0; i < 20; i++) {
      const cur = await health()
      if (codes(cur).includes('other-copy')) return cur
      await page.waitForTimeout(1000)
    }
    return null
  })()
  assert.ok(sawOther, '启动另一份游戏时没报 other-copy')
  const oc = sawOther.issues.find((i) => i.code === 'other-copy')
  assert.match(oc.text, /不是整蛊器装的那一份/)
  assert.ok(oc.text.includes(otherDir) && oc.text.includes(win64), `应把两个路径都写清楚：${oc.text}`)
  pass('启动的是另一份游戏 → 报出两边路径')
  fake.kill()
  fake = null

  // ---- ⑥ 导出诊断报告 ----
  const desktop = path.join(os.homedir(), 'Desktop')
  const before = new Set(fsSync.existsSync(desktop) ? await fs.readdir(desktop) : [])
  const rep = await page.evaluate(() => window.api.modDiagnose('dontscream'))
  assert.equal(rep.ok, true, rep.error)
  assert.ok(fsSync.existsSync(rep.file), '诊断文件没落盘：' + rep.file)
  const text = await fs.readFile(rep.file, 'utf8')
  for (const need of ['诊断报告', '文件检查', '加载器', 'UE4SS 日志', '心跳 hb.json', 'zhiliao', 'VC++ 运行库']) {
    assert.ok(text.includes(need), `诊断报告缺「${need}」段`)
  }
  assert.ok(!/密码|password|cookie|token/i.test(text), '诊断报告里不该有账号密码类内容')
  await fs.rm(rep.file, { force: true })
  for (const f of (fsSync.existsSync(desktop) ? await fs.readdir(desktop) : [])) {
    if (!before.has(f) && f.startsWith('知了猴整蛊器诊断-')) await fs.rm(path.join(desktop, f), { force: true })
  }
  pass('导出诊断报告：内容齐全、不含敏感信息、可删除', path.basename(rep.file))

  console.log(`\n整蛊器加载证据检测 ${passed.length}/8 PASS`)
} finally {
  try { fake?.kill() } catch { /* 已退出 */ }
  await app?.close()
}
