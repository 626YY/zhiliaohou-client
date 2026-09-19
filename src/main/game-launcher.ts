import {cardModeEnabled} from './card-provider'
import { spawn, exec, execFile, execSync } from 'child_process'
import { processRunning, processPid } from './proc-snapshot'
import { join, dirname, basename } from 'path'
import { shell } from 'electron'
import fs, { readdirSync, readFileSync, existsSync } from 'fs'
import { getSettings } from './settings'
import {
  currentGameId,
  gamePathFor,
  setGamePathFor,
  catalogGameIds,
  gameLaunchInfo,
  verifyGamePath
} from './games'
import { GAME_PATH_RULES, searchRootFor, gamePathSample } from '@shared/gamePaths'
import type {
  GameLaunchResult,
  GameProcessState
} from '@shared/types'

/** exe 是否在跑：走 proc-snapshot（异步 tasklist + 3 秒缓存，全客户端合并成一处），主线程不阻塞。 */
export async function isProcessRunning(exeName: string, force = false): Promise<boolean> {
  if (process.platform === 'win32') return processRunning(exeName, force)
  return new Promise((resolve) => {
    exec(`pgrep -f "${exeName}"`, (err, stdout) => {
      resolve(!err && stdout.trim().length > 0)
    })
  })
}

export async function launchGame(): Promise<GameLaunchResult> {
  if(cardModeEnabled()){
    try{await (await import('./card-auth')).cardRequireGameUse()}catch(error){return {ok:false,error:error instanceof Error?error.message:'卡密授权不可用'}}
  }
  // Steam DRM 游戏（UE Shipping exe）必须走 steam://run，直启会被 Steam OSS 拦下
  const info = gameLaunchInfo()
  if (info.steamLaunch && info.appid) {
    try {
      void shell.openExternal(`steam://run/${info.appid}`)
      return Promise.resolve({ ok: true })
    } catch {
      return Promise.resolve({ ok: false, error: '通过 Steam 启动游戏失败' })
    }
  }
  const exe = gamePathFor()
  if (!exe || !fs.existsSync(exe)) {
    return Promise.resolve({ ok: false, error: '游戏路径无效，请先在设置中指定游戏 exe' })
  }
  // spawn 的 EACCES/ENOENT 是异步 error 事件：以前 try/catch 接不到、IPC 已回「已启动」，然后主进程弹一个未捕获异常框。
  // 等 spawn/error 二选一再回结果；stdio 不接管道（游戏往 stdout 写超 64KB 会被管道卡住）
  return new Promise((resolve) => {
    let settled = false
    const done = (r: GameLaunchResult) => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    try {
      const child = spawn(exe, [], { cwd: dirname(exe), windowsHide: false, detached: true, stdio: 'ignore' })
      child.on('error', (e) => done({ ok: false, error: '启动游戏失败：' + (e?.message || String(e)) }))
      child.on('spawn', () => {
        child.unref()
        done({ ok: true, pid: child.pid })
      })
    } catch (e) {
      done({ ok: false, error: '启动游戏失败：' + (e instanceof Error ? e.message : String(e)) })
    }
  })
}

// ---- Steam 库定位的预热缓存：注册表查询与盘符枚举都要起子进程 / 碰盘，启动期在主线程同步做会拖慢窗口出现 ----
// 启动后由 index.ts 调 primeSteamLibraries() 异步填好；之后的同步扫描直接用缓存，缓存没有才退回同步查询。
let steamRootFromReg: string | null | undefined   // undefined=还没查过
let fixedDrives: string[] | null = null
let appsDirsCache: { at: number; dirs: string[] } | null = null
const APPS_CACHE_MS = 30_000

function parseSteamPath(out: string): string {
  const m = String(out || '').match(/SteamPath\s+REG_SZ\s+(.+)/i)
  return m ? m[1].trim().replace(/[\\/]+$/, '') : ''
}

export function primeSteamLibraries(): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  const reg = new Promise<void>((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000, encoding: 'utf8' }, (err, out) => {
      if (steamRootFromReg === undefined) steamRootFromReg = err ? null : parseSteamPath(out) || null
      resolve()
    })
  })
  // 只要固定硬盘：断连的映射网盘 / 空光驱盘符用 existsSync 探一下就可能卡几十秒
  const drives = new Promise<void>((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' } | ForEach-Object { $_.Name }"],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (err, out) => {
        if (!err) {
          const list = String(out || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Z]:\\$/i.test(s))
          if (list.length) fixedDrives = list
        }
        resolve()
      })
  })
  return Promise.all([reg, drives]).then(() => undefined)
}

export async function queryGameState(): Promise<GameProcessState> {
  const settings = getSettings()
  const exeName = basename(gamePathFor()) || settings.gameExeName
  const running = await isProcessRunning(exeName)
  const pid = running && process.platform === 'win32' ? await processPid(exeName) : undefined
  return { running, pid, exeName, gameId: currentGameId() }
}

/** 收集所有 Steam 库的 steamapps 目录：注册表 + 全盘常见位置 + libraryfolders.vdf 扩展 */
function collectSteamAppsDirs(): string[] {
  if (appsDirsCache && Date.now() - appsDirsCache.at < APPS_CACHE_MS) return appsDirsCache.dirs
  const dirs = collectSteamAppsDirsUncached()
  appsDirsCache = { at: Date.now(), dirs }
  return dirs
}

function collectSteamAppsDirsUncached(): string[] {
  const appsDirs = new Set<string>()
  const seen = new Set<string>()
  const addRoot = (root: string) => {
    if (!root || seen.has(root)) return
    seen.add(root)
    const apps = join(root, 'steamapps')
    if (existsSync(apps)) appsDirs.add(apps)
    const vdf = join(apps, 'libraryfolders.vdf')
    if (!existsSync(vdf)) return
    try {
      const txt = readFileSync(vdf, 'utf8')
      const re = /"path"\s+"([^"]+)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) {
        addRoot(m[1].replace(/\\\\/g, '\\').replace(/[\\/]+$/, ''))
      }
    } catch {
      /* 解析失败忽略该库 */
    }
  }

  // 1. 注册表里的 Steam 安装路径（优先用 primeSteamLibraries 预热的结果；没预热过才同步查一次并记住）
  if (steamRootFromReg === undefined) {
    try {
      const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000
      })
      steamRootFromReg = parseSteamPath(out) || null
    } catch {
      steamRootFromReg = null
    }
  }
  if (steamRootFromReg) addRoot(steamRootFromReg)

  // 2. 枚举盘符的常见 Steam 安装位置（预热拿到的固定硬盘列表优先；否则退回逐盘 existsSync）
  let drives: string[] = fixedDrives ? [...fixedDrives] : []
  if (!drives.length) {
    for (let c = 67; c <= 90; c++) {
      const d = String.fromCharCode(c)
      if (existsSync(`${d}:\\`)) drives.push(`${d}:\\`)
    }
  }
  for (const drive of drives) {
    addRoot(join(drive, 'Program Files (x86)', 'Steam'))
    addRoot(join(drive, 'Program Files', 'Steam'))
    addRoot(join(drive, 'Steam'))
  }

  // 3. 盘根一层名字含 steam 的目录（覆盖 SteamLibrary 等自定义库根）
  for (const drive of drives) {
    let names: string[]
    try {
      names = readdirSync(drive)
    } catch {
      continue
    }
    for (const name of names) {
      if (/steam/i.test(name)) addRoot(join(drive, name))
    }
  }
  return [...appsDirs]
}

/** 递归找 exe（DontScream 的 Shipping exe 在 Binaries/Win64/ 两层下），depth 防跑飞 */
function findExeRecursive(dir: string, matcher: RegExp, depth = 0): string {
  if (depth > 4) return ''
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return ''
  }
  for (const f of entries) {
    if (f.toLowerCase().endsWith('.exe') && matcher.test(f)) {
      return join(dir, f)
    }
  }
  for (const f of entries) {
    const full = join(dir, f)
    try {
      if (existsSync(full) && fs.statSync(full).isDirectory()) {
        const hit = findExeRecursive(full, matcher, depth + 1)
        if (hit) return hit
      }
    } catch {
      /* 无权限目录跳过 */
    }
  }
  return ''
}

/**
 * 扫描所有 Steam 库找指定游戏的 exe（不写设置，纯探测）。
 * 匹配规则统一取自 GAME_PATH_RULES —— 严格按文件名认，宁可找不到也不要认错：
 * 认错一层（比如 DON'T SCREAM 根目录的启动器 Dont_Scream.exe）会让 mod 装到 UE4SS 读不到的地方。
 */
function scanSteamFor(gameId: string): string {
  const rule = GAME_PATH_RULES[gameId]
  if (!rule) return ''
  const dirMatcher = rule.dir
  const exeMatcher = rule.exe

  const steamappsDirs = collectSteamAppsDirs()
  for (const appsDir of steamappsDirs) {
    const common = join(appsDir, 'common')
    if (!existsSync(common)) continue
    let entries: string[]
    try {
      entries = readdirSync(common)
    } catch {
      continue
    }
    const target = entries.find((e) => dirMatcher.test(e))
    if (!target) continue
    const gameDir = join(common, target)
    // 三款游戏统一递归找：轮椅的 exe 就在游戏根第一层，UE 两款在 Binaries/Win64。
    // 原来轮椅走「目录里排除 unins/crash 后随便挑一个」，正是选错 exe 的来源之一。
    const exe = findExeRecursive(gameDir, exeMatcher)
    if (exe) return exe
  }
  return ''
}

/**
 * 把主播选/填的一条路径落成「正确的那条」。
 * 主播多半是在游戏目录里点错了文件（选到启动器、崩溃处理器），正确的 exe 就在同一棵树下：
 *   合格 → 原样用；不合格 → 从游戏根往下重找 → 还找不到就扫 Steam 库 → 仍没有才报错。
 */
export function resolveGamePath(
  gameId: string,
  picked: string
): { ok: boolean; path?: string; fixed?: boolean; error?: string } {
  const raw = String(picked || '').trim().replace(/^"|"$/g, '')
  if (!raw) return { ok: false, error: '还没选游戏 exe' }

  const first = verifyGamePath(gameId, raw)
  if (first.ok) {
    setGamePathFor(gameId, raw)
    return { ok: true, path: raw, fixed: false }
  }

  const rule = GAME_PATH_RULES[gameId]
  if (rule) {
    const root = searchRootFor(gameId, raw)
    if (root && existsSync(root)) {
      const hit = findExeRecursive(root, rule.exe)
      if (hit && verifyGamePath(gameId, hit).ok) {
        setGamePathFor(gameId, hit)
        return { ok: true, path: hit, fixed: true }
      }
    }
    const scanned = scanSteamFor(gameId)
    if (scanned && verifyGamePath(gameId, scanned).ok) {
      setGamePathFor(gameId, scanned)
      return { ok: true, path: scanned, fixed: true }
    }
  }
  const sample = gamePathSample(gameId)
  return { ok: false, error: first.reason + (sample ? `（正确的是 ...\\${sample}）` : '') }
}

export function detectSteamGame(): { ok: boolean; path?: string; error?: string } {
  const gameId = currentGameId()
  // 已有路径要「合格」才直接用：只判存在的话，夹具留下的 0 字节假 exe 会让这里永远不再重扫
  const existing = gamePathFor(gameId)
  if (existing && verifyGamePath(gameId, existing).ok) {
    return { ok: true, path: existing }
  }
  const path = scanSteamFor(gameId)
  if (!path) {
    const sample = gamePathSample(gameId)
    return {
      ok: false,
      error: '没在 Steam 库里找到这个游戏，请手动选择' + (sample ? ` ...\\${sample}` : '游戏 exe')
    }
  }
  setGamePathFor(gameId, path)
  return { ok: true, path }
}

/** 探测全部游戏（不改当前游戏，逐个扫盘存路径），返回 gameId → path */
export function detectAllGames(): { ok: boolean; found: Record<string, string> } {
  const found: Record<string, string> = {}
  for (const id of catalogGameIds()) {
    // 同上：只判 existsSync 的话，错的路径一旦存进去就再也纠正不了
    const existing = gamePathFor(id)
    if (existing && verifyGamePath(id, existing).ok) {
      found[id] = existing
      continue
    }
    const p = scanSteamFor(id)
    if (p) {
      setGamePathFor(id, p)
      found[id] = p
    }
  }
  return { ok: true, found }
}

/**
 * 主进程启动时把设置里记着的每条游戏路径都过一遍 resolveGamePath（2026-09-07 接管补：0.3.17 的自动纠正只在游戏库页
 * 挂载时跑，主播停在别的页面就不纠；主播报「重装 mod 后检测不到游戏运行」多半就是这类错路径）。
 * 只纠「能纠对」的：resolveGamePath 找到合格 exe 才写回；找不到原样保留，不清空、不报错弹窗。返回纠正明细供日志。
 */
export function correctSavedGamePathsAtStartup(): { gameId: string; from: string; to: string }[] {
  const fixed: { gameId: string; from: string; to: string }[] = []
  try {
    const s = getSettings()
    const entries: [string, string][] = Object.entries(s.gamePaths || {}).filter(([, v]) => !!v) as [string, string][]
    if (s.gamePath && !entries.some(([id]) => id === '4wheel-challenge')) entries.push(['4wheel-challenge', s.gamePath])
    for (const [gameId, saved] of entries) {
      try {
        const r = resolveGamePath(gameId, saved)
        if (r.ok && r.fixed && r.path && r.path !== saved) fixed.push({ gameId, from: saved, to: r.path })
      } catch {
        /* 单条失败不影响其它游戏 */
      }
    }
  } catch {
    /* 设置读不到就算了，游戏库页挂载时还会再纠一次 */
  }
  return fixed
}
