// 整蛊器健康自检 + 一键/自动修复（2026-09-07：朋友「快捷键不好使」「重装后检测不到游戏」，她跑不了自检脚本，
// 用户定调「只能从程序里去避免」）。主播看不见也说不清的那几种坏法，客户端自己查、自己修：
//   ① 文件不全：dwmapi.dll / ue4ss / Mods/<mod> 缺了（常见：杀毒软件把 UE4SS 的代理 dwmapi.dll 隔离了；或手动删了一半）
//   ② 装错位置：mod 被解到游戏根目录（选错了启动器 exe 时的产物），游戏本体在 Binaries/Win64 里根本读不到
//   ③ 游戏在跑但 mod 没加载：进程起来 45 秒以上，mod 目录的 hb.json 还没有/不新鲜 → 大概率就是①②，或杀毒拦截了注入
//   ④ 2026-09-07 晚补：朋友那边「文件检查全绿、客户端也认出游戏在跑，但游戏里没有加载横幅、快捷键全无反应」。
//      前三项查的都是「文件在不在」，查不出「加载器压根没注入进游戏」。现在改成看证据：
//      加载器日志（UE4SS.log / MelonLoader Latest.log）是不是这次开游戏产生的、里面有没有我们 mod 的加载行、
//      正在跑的 exe 是不是客户端检查的那一份、系统有没有 UE4SS 依赖的 VC++ 运行库。游戏关了也能凭上次的日志判。
// 修复 = 重新从安装包装到正确位置（保留主播 config.json）+ 清掉根目录里那份错位的（只删确认是我们自己的那份）。
import { execFile } from 'node:child_process'
import os from 'node:os'
import { app, net, shell } from 'electron'
import fs from 'fs'
import { dirname, join } from 'path'
import type { ModHealth, ModHealthIssue } from '@shared/types'
import { currentGameId, gamePathFor } from './games'
import { queryGameState } from './game-launcher'
import { listMods, installMod } from './mods'
import { readJson, writeJson } from './db'
import { logLine } from './crash-log'
import { getSettings } from './settings'
import { SERVER_URL_HTTPS } from './server-tls'

type Rule = {
  modId: string
  modDir: string
  required: string[]
  strayRoots: (exeDir: string) => string[]
  hb: string
  /** 加载器（UE4SS / MelonLoader）自己的日志，按顺序找第一个存在的；每次启动游戏会重写 */
  loaderLogs: string[]
  loaderName: string
  /** 加载器日志里出现这个，才说明我们的 mod 真的跑起来了 */
  modMark: RegExp
  /** 我们 mod 自己的日志（给诊断报告用，可能没有） */
  modLog?: string
  /** 需要 VC++ 运行库（UE4SS 是 MSVC 编译的，缺了 dwmapi.dll 会静默加载失败） */
  needsVcRuntime: boolean
}
const RULES: Record<string, Rule> = {
  dontscream: {
    modId: 'zhiliao-dontscream',
    modDir: 'ue4ss/Mods/zhiliao',
    required: ['dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/Mods/mods.txt', 'ue4ss/Mods/zhiliao/enabled.txt', 'ue4ss/Mods/zhiliao/Scripts/main.lua', 'ue4ss/Mods/zhiliao/config.json', 'ue4ss/Mods/zhiliao/connector.py', 'ue4ss/Mods/zhiliao/douyin_room.py'],
    // Binaries/Win64 往上两层是 DontScream/，三层是游戏根：选错启动器时 zip 被解到这两处
    strayRoots: (exeDir) => [dirname(dirname(dirname(exeDir))), dirname(dirname(exeDir))],
    hb: 'ue4ss/Mods/zhiliao/hb.json',
    loaderLogs: ['ue4ss/UE4SS.log', 'UE4SS.log'],
    loaderName: 'UE4SS',
    modMark: /\[zhiliao\]/,
    modLog: 'ue4ss/zhiliao.log',
    needsVcRuntime: true
  },
  librarian: {
    modId: 'darkmage-librarian',
    modDir: 'ue4ss/Mods/DarkMage',
    required: ['dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/Mods/mods.txt', 'ue4ss/Mods/DarkMage/enabled.txt', 'ue4ss/Mods/DarkMage/Scripts/main.lua', 'ue4ss/Mods/DarkMage/config.json', 'ue4ss/Mods/DarkMage/connector.py', 'ue4ss/Mods/DarkMage/douyin_room.py'],
    strayRoots: (exeDir) => [dirname(dirname(dirname(exeDir))), dirname(dirname(exeDir))],
    hb: 'ue4ss/Mods/DarkMage/hb.json',
    loaderLogs: ['ue4ss/UE4SS.log', 'UE4SS.log'],
    loaderName: 'UE4SS',
    modMark: /\[DarkMage\]/,
    modLog: 'ue4ss/darkmage.log',
    needsVcRuntime: true
  },
  '4wheel-challenge': {
    modId: 'wheellive',
    modDir: 'Mods/WheelLive',
    required: ['version.dll', 'MelonLoader', 'Mods/WheelLive.dll', 'Mods/WheelLive/connector.py', 'Mods/WheelLive/douyin_room.py'],
    strayRoots: () => [],
    hb: 'Mods/WheelLive/hb.json',
    loaderLogs: ['MelonLoader/Latest.log'],
    loaderName: 'MelonLoader',
    modMark: /WheelLive v\d/,
    needsVcRuntime: false
  }
}

const processStartedAt = new Map<number, number>()   // pid → 首次看到它在跑的时刻（估算进程存活时间）
const exePathByPid = new Map<number, string>()      // pid → 真实 exe 路径（每个 pid 只查一次，健康检查 6 秒一轮，不能每轮起 PowerShell）

/** 正在跑的那个游戏进程，exe 到底在哪。取不到就返回空串（当作没这条证据，不报错） */
function runningExePath(pid: number): Promise<string> {
  const known = exePathByPid.get(pid)
  if (known !== undefined) return Promise.resolve(known)
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('')
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        const p = err ? '' : String(stdout || '').trim()
        exePathByPid.set(pid, p)
        resolve(p)
      }
    )
  })
}

/** UE4SS 是 MSVC 编译的：系统缺 VC++ 2015-2022 运行库时 dwmapi.dll 会静默加载失败，游戏照常启动但一个 mod 都没有 */
function vcRuntimeMissing(): string[] {
  const sys = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  return ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].filter((f) => !fs.existsSync(join(sys, f)))
}

type LoadEvidence = {
  /** 加载器日志路径与最后写入时间；没有日志说明加载器根本没跑起来 */
  logPath?: string
  logAt?: number
  /** 日志里有没有我们 mod 的行 */
  modInLog?: boolean
  /** 日志里像报错的行（给主播看/给我们看） */
  errors: string[]
  /** UE4SS 在 mods.txt 里把我们这个 mod 标成了停用（老安装残留的 `zhiliao : 0`） */
  disabledInModsTxt?: boolean
}

/** 只读加载器日志尾部：日志每次启动重写，但仍可能几 MB，别整个读进内存 */
function tailFile(p: string, maxBytes = 256 * 1024): string {
  try {
    const size = fs.statSync(p).size
    const start = Math.max(0, size - maxBytes)
    const fd = fs.openSync(p, 'r')
    try {
      const buf = Buffer.alloc(Math.min(size, maxBytes))
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

function loadEvidence(exeDir: string, rule: Rule): LoadEvidence {
  const ev: LoadEvidence = { errors: [] }
  for (const rel of rule.loaderLogs) {
    const p = join(exeDir, rel)
    try {
      const st = fs.statSync(p)
      if (!ev.logAt || st.mtimeMs > ev.logAt) {
        ev.logPath = p
        ev.logAt = st.mtimeMs
      }
    } catch {
      /* 没这个日志，看下一个候选 */
    }
  }
  if (!ev.logPath) return ev
  const text = tailFile(ev.logPath)
  ev.modInLog = rule.modMark.test(text)
  const modName = rule.modDir.split('/').pop() || ''
  ev.disabledInModsTxt = new RegExp(`Mod '${modName}' disabled in mods\\.txt`, 'i').test(text)
  // ★UE4SS 启动时会打一大片「Class::Member = 0x29」的成员偏移量表，其中不少名字带 Error
  //   （FArchiveState::ArIsError、UWorld::bKismetScriptError…），那是正常输出不是报错。
  //   2026-09-07：主播那份诊断报告的「第一条报错」就是它，把真正的
  //   「Error executing script: …main.lua:22: … No such file or directory」挤到了第 4 条，
  //   而结论只取第一条 → 主播看到一句没有意义的 0x29，还被建议「点修复重装」。
  const isNoise = (ln: string): boolean =>
    /::\w+\s*=\s*0x[0-9a-f]+/i.test(ln) || /Freed invalid callbacks/i.test(ln)
  // 能真正定位问题的行排前面：Lua 报错带文件名和行号，最值钱
  const isValuable = (ln: string): boolean =>
    /Error executing script|Failed to execute|No such file or directory|attempt to (index|call|compare|perform)|stack traceback|\.lua:\d+/i.test(
      ln
    )
  const hits: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!/error|failed|exception|cannot|无法|失败/i.test(line)) continue
    if (isNoise(line)) continue
    hits.push(line.trim().slice(0, 300))
    if (hits.length >= 40) break // 够挑了，别把整份日志塞进来
  }
  ev.errors = [...hits.filter(isValuable), ...hits.filter((l) => !isValuable(l))].slice(0, 6)
  return ev
}

/** 「上次看到这款游戏在跑」的时间：主播事后才来问，游戏早关了，用它判断上一次开游戏时 mod 到底加载没有 */
type SeenMap = Record<string, number>
function seenRunning(): SeenMap {
  return readJson<SeenMap>('game_last_run', {})
}
function markSeenRunning(gameId: string): void {
  const m = seenRunning()
  m[gameId] = Date.now()
  try { writeJson('game_last_run', m) } catch { /* 记不上不影响主流程 */ }
}

function hbAge(p: string): number | null {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as { ts?: number }
    const ts = Number(j.ts || 0)
    return ts > 0 ? Math.max(0, Math.round(Date.now() / 1000 - ts)) : null
  } catch {
    return null
  }
}

/** 根目录那份错位安装是不是我们自己的：里面有我们 mod 的目录才算，别把别的 UE4SS mod 当垃圾清了。 */
function strayInstallAt(root: string, rule: Rule): string[] {
  const hits: string[] = []
  try {
    const ue4ss = join(root, 'ue4ss')
    if (fs.existsSync(join(ue4ss, 'Mods', rule.modDir.split('/').pop()!))) {
      hits.push(ue4ss)
      const dw = join(root, 'dwmapi.dll')
      if (fs.existsSync(dw)) hits.push(dw)
    }
  } catch {
    /* 读不到当没有 */
  }
  return hits
}

export async function modHealth(gameIdArg?: string): Promise<ModHealth> {
  const gameId = gameIdArg || currentGameId()
  const rule = RULES[gameId]
  const issues: ModHealthIssue[] = []
  const now = Date.now()
  if (!rule) return { gameId, ok: true, issues, checkedAt: now }
  const gp = gamePathFor(gameId)
  if (!gp || !fs.existsSync(gp)) {
    issues.push({ code: 'no-path', text: '还没定位到这款游戏的 exe（到「启动游戏」页重新搜索）', fixable: false })
    return { gameId, modId: rule.modId, ok: false, issues, checkedAt: now }
  }
  const exeDir = dirname(gp)
  const { installed } = listMods()
  const rec = installed[rule.modId]
  const marker = join(exeDir, rule.modDir)
  if (!fs.existsSync(marker)) {
    // 目录里根本没有 mod（没装过，或主播自己删掉了）：不算故障、启动自修也不动它——主播嫌 mod 影响游戏手删了，不能每次开客户端又给装回去
    const stray = rule.strayRoots(exeDir).flatMap((r) => strayInstallAt(r, rule))
    if (stray.length) issues.push({ code: 'misplaced', text: '整蛊器装错了位置（在游戏根目录，游戏读不到）', fixable: true, files: stray })
    else issues.push({ code: 'not-installed', text: rec ? '整蛊器目录不在了（被删除或游戏重装过），到游戏库重新安装' : '整蛊器还没安装', fixable: true })
    return { gameId, modId: rule.modId, ok: false, issues, checkedAt: now }
  }
  const missing = rule.required.filter((f) => !fs.existsSync(join(exeDir, f)))
  if (missing.length) {
    const hint = missing.includes('dwmapi.dll') || missing.includes('version.dll')
      ? '（多半是杀毒软件把它删了：修复后请把游戏目录加入杀毒软件白名单）'
      : ''
    issues.push({ code: 'missing-files', text: `整蛊器文件不全，缺 ${missing.length} 个：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}${hint}`, fixable: true, files: missing })
  }
  const stray = rule.strayRoots(exeDir).flatMap((r) => strayInstallAt(r, rule))
  if (stray.length) issues.push({ code: 'misplaced', text: '游戏根目录里还有一份装错位置的整蛊器（会让游戏启动器误加载）', fixable: true, files: stray })
  // 游戏在跑：看 mod 有没有真的活着
  let loaded: boolean | undefined
  let hbAgeSec: number | undefined
  const ev = loadEvidence(exeDir, rule)
  const st = await queryGameState()
  if (st.running) {
    markSeenRunning(gameId)
    if (st.pid && !processStartedAt.has(st.pid)) processStartedAt.set(st.pid, now)
    const aliveFor = st.pid ? now - (processStartedAt.get(st.pid) || now) : 0
    const age = hbAge(join(exeDir, rule.hb))
    hbAgeSec = age ?? undefined
    loaded = age !== null && age <= 30
    // 跑的是不是我们检查的这一份：有的机器上装了两份游戏（换过 Steam 库、或另一个盘的旧副本），
    // 客户端对着 A 检查文件全绿，主播启动的却是 B —— 文件检查永远看不出这种
    if (st.pid) {
      const real = await runningExePath(st.pid)
      if (real && dirname(real).toLowerCase() !== exeDir.toLowerCase()) {
        issues.push({ code: 'other-copy', text: `你启动的游戏不是整蛊器装的那一份（正在跑：${dirname(real)}；整蛊器装在：${exeDir}）。到「启动游戏」页重新搜索本机游戏，或用整蛊器里的「启动游戏」按钮开`, fixable: false })
      }
    }
    if (!loaded && aliveFor > 45_000 && !missing.length) {
      const d = diagnoseNotLoaded(rule, ev, processStartedAt.get(st.pid || 0) || now)
      issues.push({ ...d, text: `游戏在跑但整蛊器没加载：${d.text}` })
    }
  } else if (!missing.length) {
    // 游戏已经关了也要能给结论：主播都是事后才来问的
    // 「开过游戏，但既没有心跳、加载器日志里也没有我们的行」= 上一局整蛊器根本没加载。
    // 从没开过游戏（没记录）就什么都不说，别对着刚装好的机器喊狼来了。
    const lastRun = seenRunning()[gameId]
    const neverLoaded = hbAge(join(exeDir, rule.hb)) === null && !ev.modInLog
    if (lastRun && neverLoaded) {
      const d = diagnoseNotLoaded(rule, ev, lastRun)
      issues.push({ ...d, code: 'last-run-not-loaded', text: `上次进游戏时整蛊器没有加载：${d.text}` })
    }
  }
  const version = rec?.version || ''
  return { gameId, modId: rule.modId, ok: issues.length === 0, issues, loaded, hbAgeSec, version, checkedAt: now, loader: { name: rule.loaderName, logAt: ev.logAt, modInLog: ev.modInLog, errors: ev.errors.slice(0, 3) } }
}

/**
 * 「文件都在、就是没加载」时到底是哪种坏法。分三层，从最能解释问题的那层报起：
 *  ① 加载器日志压根没有 / 不是这次开游戏留下的 → 加载器没注入（缺 VC++ 运行库、杀毒拦下 dwmapi.dll、或用了别的方式启动）
 *  ② 日志有、但里面没有我们 mod 的行 → 加载器起来了，mod 没被启用或 Lua 报错
 *  ③ 日志里有我们的行，只是心跳不新鲜 → mod 起来了但卡住/刚重载，按老逻辑提示重装
 */
/**
 * 老版整蛊器写死路径的特征行：Lua 报某个绝对路径打不开。
 * 例：`...\Scripts\main.lua:22: F:/SteamLibrary/.../ue4ss/zhiliao.log: No such file or directory`
 * 新版（DS 0.2.14+ / 图书管理员 zlpaths）运行时自己算路径，不会再出这种行。
 */
const HARDCODED_PATH = /\.lua:\d+:\s*([^\n]*?):\s*No such file or directory/i

function diagnoseNotLoaded(rule: Rule, ev: LoadEvidence, sessionStart: number): ModHealthIssue {
  const fresh = ev.logAt !== undefined && ev.logAt >= sessionStart - 60_000
  if (!ev.logPath || !fresh) {
    const lack = rule.needsVcRuntime ? vcRuntimeMissing() : []
    if (lack.length) {
      return { code: 'no-vcruntime', text: `游戏里没有加载整蛊器：本机缺少微软 VC++ 运行库（少 ${lack.join('、')}），${rule.loaderName} 没法启动。装一个「Microsoft Visual C++ 2015-2022 x64 运行库」再进游戏`, fixable: false }
    }
    return { code: 'loader-not-injected', text: `${rule.loaderName} 没有注入到游戏里（连它自己的日志都没有）。多半是杀毒软件把游戏目录里的 dwmapi.dll 拦了：把游戏目录加进杀毒白名单后重进游戏；也可能是从别的快捷方式启动了另一份游戏`, fixable: true }
  }
  if (ev.modInLog === false) {
    // ★老版整蛊器把作者电脑上的路径写死在脚本里（DON'T SCREAM ≤0.2.13、图书管理员 ≤0.8.4）：
    //   主播的游戏不在那个位置 → 脚本第一句开日志就失败 → 整个整蛊器一行都不跑。
    //   这一种绝不能说「点修复重装」——重装的是同一个版本，装完还是坏的。要说升级。
    const hard = ev.errors.map((e) => HARDCODED_PATH.exec(e)).find((m) => m !== null)
    if (hard) {
      return {
        code: 'mod-outdated-hardcoded-path',
        text: `整蛊器版本太旧，装在你这个位置起不来（它去找 ${hard[1]}，那是作者电脑上的路径）。点「修复」升级到新版就能用`,
        fixable: true
      }
    }
    if (ev.disabledInModsTxt) {
      return { code: 'mod-disabled', text: `${rule.loaderName} 起来了，但整蛊器在 mods.txt 里被标成了停用（多半是以前装过别的 mod 留下的）。点「修复」把它改回启用`, fixable: true }
    }
    const why = ev.errors.length ? `日志里的报错：${ev.errors[0]}` : '整蛊器没有被启用（enabled.txt 丢了）'
    return { code: 'mod-not-started', text: `${rule.loaderName} 起来了，但整蛊器没跑起来。${why}。点「修复」重装一次`, fixable: true }
  }
  return { code: 'not-loaded', text: '心跳没来。先关游戏点「修复」重装；还不行多半是杀毒软件拦截，把游戏目录加白名单', fixable: true }
}

/** 一键修复：清掉根目录错位的那份 → 重装到正确位置（保留主播 config.json）。游戏在跑时重装会被 installMod 拒绝。 */
export async function repairMod(gameIdArg?: string): Promise<{ ok: boolean; error?: string; did: string[] }> {
  const gameId = gameIdArg || currentGameId()
  const rule = RULES[gameId]
  const did: string[] = []
  if (!rule) return { ok: false, error: '这款游戏没有整蛊器', did }
  const h = await modHealth(gameId)
  if (h.issues.some((i) => i.code === 'no-path')) return { ok: false, error: h.issues[0].text, did }
  for (const i of h.issues) {
    if (i.code === 'misplaced' && i.files) {
      for (const f of i.files) {
        try {
          fs.rmSync(f, { recursive: true, force: true })
          did.push('清掉错位文件 ' + f)
        } catch (e) {
          did.push('清不掉 ' + f + '：' + String(e))
        }
      }
    }
  }
  // mods.txt 里被标成停用：把那一行改回启用（只改我们自己这一条，别人的 mod 不动）
  if (rule && h.issues.some((i) => i.code === 'mod-disabled' || i.code === 'last-run-not-loaded')) {
    const gp = gamePathFor(gameId)
    const modsTxt = gp ? join(dirname(gp), 'ue4ss', 'Mods', 'mods.txt') : ''
    const modName = rule.modDir.split('/').pop() || ''
    try {
      if (modsTxt && modName && fs.existsSync(modsTxt)) {
        const before = fs.readFileSync(modsTxt, 'utf-8')
        const after = before.replace(new RegExp(`^([ \\t]*${modName}[ \\t]*:[ \\t]*)0([ \\t]*)$`, 'gim'), '$11$2')
        if (after !== before) {
          fs.writeFileSync(modsTxt, after, 'utf-8')
          did.push('把 mods.txt 里的整蛊器改回启用')
        }
      }
    } catch (e) {
      did.push('改不动 mods.txt：' + String(e))
    }
  }
  // ★'mod-outdated-hardcoded-path' 必须在这张表里：那种坏法的解药就是装新版，
  //   漏了它主播点「修复」会什么都不做，正好拿不到修好的整蛊器。
  if (h.issues.some((i) => ['missing-files', 'not-installed', 'not-loaded', 'misplaced', 'mod-not-started', 'mod-disabled', 'loader-not-injected', 'last-run-not-loaded', 'mod-outdated-hardcoded-path'].includes(i.code))) {
    const r = await installMod(rule.modId)
    did.push(r.ok ? '已重装整蛊器' : '重装失败：' + (r.error || ''))
    if (!r.ok) return { ok: false, error: r.error, did }
  }
  logLine('modhealth', `${gameId} 修复：${did.join('；') || '无需操作'}`)
  return { ok: true, did }
}

/**
 * 导出诊断报告到桌面：主播说不清、也跑不了脚本，让他点一下把证据攒成一个 txt 发过来。
 * 只收本机路径/版本/日志尾部这类排障必需的信息，不带账号、密码、cookie。
 */
async function buildDiagnosisText(gameIdArg?: string): Promise<{ gameId: string; lines: string[] }> {
  const gameId = gameIdArg || currentGameId()
  const rule = RULES[gameId]
  const lines: string[] = []
  const add = (s = ''): number => lines.push(s)
  try {
    const h = await modHealth(gameId)
    const gp = gamePathFor(gameId)
    const exeDir = gp ? dirname(gp) : ''
    const st = await queryGameState()
    add(`知了猴整蛊器 诊断报告`)
    add(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`)
    add(`客户端版本：${app.getVersion()}    Windows：${os.release()}`)
    add(`游戏：${gameId}    整蛊器版本：${h.version || '（客户端没有安装记录）'}`)
    add(`游戏 exe：${gp || '（没定位到）'}`)
    add(`游戏在跑：${st.running ? `是（pid ${st.pid ?? '?'}）` : '否'}`)
    if (st.running && st.pid) add(`实际在跑的 exe：${(await runningExePath(st.pid)) || '（取不到）'}`)
    add(`结论：${h.ok ? '文件检查通过' : h.issues.map((i) => i.text).join(' / ')}`)
    add()
    if (rule && exeDir) {
      add('— 文件检查 —')
      for (const f of rule.required) add(`  ${fs.existsSync(join(exeDir, f)) ? '有' : '缺'}  ${f}`)
      if (rule.needsVcRuntime) {
        const lack = vcRuntimeMissing()
        add(`  VC++ 运行库：${lack.length ? '缺 ' + lack.join('、') : '齐全'}`)
      }
      add()
      add('— 加载器 —')
      const ev = loadEvidence(exeDir, rule)
      add(`  ${rule.loaderName} 日志：${ev.logPath || '（没有，说明加载器没跑起来）'}`)
      if (ev.logAt) add(`  日志最后写入：${new Date(ev.logAt).toLocaleString('zh-CN', { hour12: false })}`)
      add(`  日志里有整蛊器的行：${ev.modInLog === undefined ? '（没日志）' : ev.modInLog ? '有' : '没有'}`)
      for (const e of ev.errors) add(`  疑似报错：${e}`)
      add()
      add('— 心跳 hb.json —')
      try { add('  ' + fs.readFileSync(join(exeDir, rule.hb), 'utf-8').trim()) } catch { add('  （没有，整蛊器没有跑起来过）') }
      add()
      for (const [title, rel] of [[`${rule.loaderName} 日志尾部`, rule.loaderLogs.find((r) => fs.existsSync(join(exeDir, r)))], ['整蛊器日志尾部', rule.modLog]] as [string, string | undefined][]) {
        if (!rel) continue
        add(`— ${title}（${rel}）—`)
        for (const l of tailFile(join(exeDir, rel), 40 * 1024).split(/\r?\n/).slice(-60)) if (l.trim()) add('  ' + l)
        add()
      }
    }
  } catch (e) {
    add(`（收集过程中出错：${String(e)}）`)
  }
  return { gameId, lines }
}

/** 导出到桌面：主播自己把 txt 发给客服 */
export async function exportModDiagnosis(gameIdArg?: string): Promise<{ ok: boolean; file?: string; error?: string }> {
  const { gameId, lines } = await buildDiagnosisText(gameIdArg)
  try {
    const file = join(app.getPath('desktop'), `知了猴整蛊器诊断-${gameId}-${new Date().toISOString().slice(0, 10)}.txt`)
    fs.writeFileSync(file, lines.join('\r\n'), 'utf-8')
    shell.showItemInFolder(file)
    logLine('modhealth', `${gameId} 诊断报告已导出：${file}`)
    return { ok: true, file }
  } catch (e) {
    return { ok: false, error: '写不出诊断文件：' + String(e) }
  }
}

/**
 * 一键上传诊断：主播不用找文件、不用复制粘贴，点一下报个编号给客服就行。
 * 走服务器现成的 POST /api/error —— 无令牌、按 IP 限流（10 分钟 30 次）、单条 stack 截 2000 字、
 * 整个 body 上限 64KB。所以按 1800 字分片，并且【一次请求把所有片一起发】：
 * 分多次请求既慢又容易自己把自己限流掉。
 * ★必须用 net.request（Electron 网络栈）：服务器是自签证书、指纹钉在 server-tls.ts 里，
 *   Node 的 fetch 不认它。
 */
export async function uploadModDiagnosis(gameIdArg?: string): Promise<{ ok: boolean; code?: string; error?: string }> {
  const { gameId, lines } = await buildDiagnosisText(gameIdArg)
  // 编号：主播只需要念后面 4 位给客服，前面是日期（我们按天定位快）
  const code = `${new Date().toISOString().slice(5, 10).replace('-', '')}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`
  const text = lines.join('\n').slice(0, 40_000) // 服务器一批最多 50 条，留足余量
  const parts: string[] = []
  for (let i = 0; i < text.length; i += 1800) parts.push(text.slice(i, i + 1800))
  const entries = parts.map((stack, i) => ({
    t: new Date().toISOString(),
    tag: 'diag',
    msg: `诊断 ${code} ${gameId} 第${i + 1}/${parts.length}片`,
    stack
  }))
  const base = String(getSettings().serverUrl || SERVER_URL_HTTPS).replace(/\/+$/, '')
  const body = JSON.stringify({ v: app.getVersion(), e: entries })

  return new Promise((resolve) => {
    let done = false
    const finish = (r: { ok: boolean; code?: string; error?: string }): void => {
      if (done) return
      done = true
      logLine('modhealth', `${gameId} 诊断上传${r.ok ? '成功 ' + code : '失败：' + (r.error || '')}`)
      resolve(r)
    }
    const timer = setTimeout(() => finish({ ok: false, error: '服务器没有响应，请检查网络后重试' }), 20_000)
    try {
      const req = net.request({ url: `${base}/api/error`, method: 'POST' })
      req.setHeader('Content-Type', 'application/json')
      req.on('response', (res) => {
        const sc = res.statusCode || 0
        res.on('data', () => {
          /* 服务器只回 {"ok":1}，不用读 */
        })
        res.on('end', () => {
          clearTimeout(timer)
          if (sc === 429) return finish({ ok: false, error: '上传太频繁了，过十分钟再试' })
          if (sc >= 400) return finish({ ok: false, error: `服务器拒收（${sc}）` })
          finish({ ok: true, code })
        })
        res.on('error', () => {
          clearTimeout(timer)
          finish({ ok: false, error: '上传中断，请重试' })
        })
      })
      req.on('error', (e) => {
        clearTimeout(timer)
        // net:: 那串错误码主播看不懂，换成人话并指一条退路（导出到桌面自己发）
        const raw = String(e?.message || e)
        const offline = /ERR_(CONNECTION|EMPTY_RESPONSE|TIMED_OUT|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|ADDRESS)/i.test(raw)
        finish({
          ok: false,
          error: offline
            ? '连不上服务器，检查网络后再试；也可以点「存到桌面」把文件发给客服'
            : '上传失败，可以点「存到桌面」把文件发给客服'
        })
      })
      req.write(body)
      req.end()
    } catch (e) {
      clearTimeout(timer)
      finish({ ok: false, error: String(e) })
    }
  })
}

/** 启动时静默自修：只修「客户端装过（或目录里确有）但文件不全」的，游戏没在跑才动手；结果记 main.log。 */
export async function autoRepairAtStartup(): Promise<void> {
  for (const gameId of Object.keys(RULES)) {
    try {
      const gp = gamePathFor(gameId)
      if (!gp || !fs.existsSync(gp)) continue
      const h = await modHealth(gameId)
      const bad = h.issues.filter((i) => i.code === 'missing-files' || i.code === 'misplaced')
      if (!bad.length) continue
      const st = await queryGameState()
      if (st.running) { logLine('modhealth', `${gameId} 有问题但游戏在跑，等关了再修：${bad.map((b) => b.text).join('；')}`); continue }
      logLine('modhealth', `${gameId} 启动自检发现：${bad.map((b) => b.text).join('；')} → 自动修复`)
      const r = await repairMod(gameId)
      logLine('modhealth', `${gameId} 自动修复${r.ok ? '完成' : '失败'}：${r.did.join('；')}${r.error ? ' ' + r.error : ''}`)
    } catch (e) {
      logLine('modhealth', `${gameId} 启动自检异常：${String(e)}`)
    }
  }
}
