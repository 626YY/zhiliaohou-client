/**
 * obs-local.ts —— 本机 OBS Studio / 抖音直播伴侣：安装位置 / 进程状态 / obs-websocket 配置 / 场景集合离线解析
 *
 * 零依赖（只用 node:child_process / node:fs / node:path / node:os / node:util），仅面向 Windows。
 *
 * 本机实测到的真实格式（2026-09，OBS 31 Steam 版，安装在 E:\SteamLibrary\steamapps\common\OBS Studio）：
 *  - 注册表 HKLM\SOFTWARE\OBS Studio 的默认值 = 安装目录（安装包版和 Steam 版都会写）
 *  - obs64.exe 在 <安装目录>\bin\64bit\，必须以该目录为工作目录启动，否则找不到 locale/数据文件
 *  - %APPDATA%\obs-studio\plugin_config\obs-websocket\config.json 键名：
 *      alerts_enabled / auth_required / first_load / server_enabled / server_password / server_port
 *    2 空格缩进 + CRLF、键名字母序（obs-websocket 用 nlohmann::json dump(2) 经文本模式写出）
 *  - 当前场景集合：OBS 31 写在 user.ini 的 [Basic] SceneCollectionFile=未命名.json；OBS 30 及更早在 global.ini
 *  - basic/scenes/<集合>.json：
 *      sources[] 每项 { name, uuid, id, versioned_id, settings, filters?: [ { name, id, versioned_id, enabled, settings } ] }
 *      没有滤镜的源根本没有 filters 键；场景本身也是 id="scene" 的 source；groups[] 结构同 sources[]；
 *      current_program_scene / current_scene 是当前场景名；scene_order[] = [{ name }] 是界面顺序
 *  - tasklist 没命中时输出一句 GBK 中文提示（「信息: 没有运行的任务匹配指定标准。」），不能靠 "INFO:" 判断
 */
import { execFile, spawn, spawnSync } from 'node:child_process'
import { processRunning } from './proc-snapshot'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import type { ObsFilterInfo } from './obs-ws-core'
import { companionExecutable, companionRegistryLocations, discoverCompanion, type CompanionProbe } from './live-companion-discovery'

const OBS_EXE = 'obs64.exe'
// 抖音直播伴侣是 OBS 的定制发行版，安装目录和进程名与 OBS 不同。
// 直播伴侣仍然支持窗口捕获；这里仅做检测和采集提示，不把它误当成可用的 obs-websocket。
// 当前产品只接入抖音直播伴侣。B 站 livehime 进程名相近，不能纳入运行态判断，
// 否则会把错误的客户端显示成可用目标。
const LIVE_COMPANION_EXES = ['直播伴侣.exe']
const DEFAULT_WS_PORT = 4455
const DEFAULT_INSTALL_DIRS = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'obs-studio'),
  'C:\\Program Files\\obs-studio'
]
const DEFAULT_LIVE_COMPANION_DIRS = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'webcast_mate'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'webcast_mate'),
  'C:\\Program Files (x86)\\webcast_mate',
  'C:\\Program Files\\webcast_mate'
]

// ==================== 控制台输出解码 ====================

/**
 * 解码 reg / tasklist 等命令行工具的输出。
 * 中文 Windows 的控制台默认代码页是 936(GBK)，但也可能被改成 65001(UTF-8)：
 * 先按 UTF-8 解，出现替换符（U+FFFD）再按 GBK 解。Node 与 Electron 都自带 full-ICU，TextDecoder('gbk') 可用。
 */
export function decodeConsoleOutput(buf: Buffer | null | undefined): string {
  if (!buf || !buf.length) return ''
  let ascii = true
  for (const b of buf) {
    if (b >= 0x80) {
      ascii = false
      break
    }
  }
  if (ascii) return buf.toString('latin1')
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return utf8
  }
}

function systemRoot(): string {
  return process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
}

/** 优先用 System32 里的绝对路径，避免 PATH 被改坏；不走 shell，省掉引号转义问题 */
function systemTool(name: string): string {
  const abs = join(systemRoot(), 'System32', name)
  return existsSync(abs) ? abs : name
}

// ==================== 安装位置 / 进程 ====================

let installDirCache: string | null | undefined

/**
 * 查注册表 HKLM\SOFTWARE\OBS Studio 的默认值。
 * 输出形如「    (默认)    REG_SZ    E:\SteamLibrary\steamapps\common\OBS Studio」，
 * 名字列在中文系统是 (默认)、英文是 (Default)，所以不看它，只取 REG_SZ 之后到行尾的那段。
 */
function queryRegistryDefaultValue(keyPath: string): string | null {
  if (process.platform !== 'win32') return null
  try {
    const r = spawnSync(systemTool('reg.exe'), ['query', keyPath, '/ve'], { windowsHide: true, timeout: 5000 })
    if (r.error || r.status !== 0) return null
    const text = decodeConsoleOutput(r.stdout)
    const m = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(text)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

/**
 * OBS 安装目录：先查注册表，再回退到默认安装路径；都没有返回 null。
 * 结果按进程缓存（注册表查询要起一个 reg.exe，~50ms），传 refresh=true 强制重查。
 */
export function obsInstallDir(refresh = false): string | null {
  if (!refresh && installDirCache !== undefined) return installDirCache
  let found: string | null = null
  const fromReg = queryRegistryDefaultValue('HKLM\\SOFTWARE\\OBS Studio')
  if (fromReg && existsSync(fromReg)) found = fromReg
  if (!found) {
    for (const dir of DEFAULT_INSTALL_DIRS) {
      if (existsSync(dir)) {
        found = dir
        break
      }
    }
  }
  installDirCache = found
  return found
}

/** <安装目录>\bin\64bit\obs64.exe，存在才返回 */
export function obsExePath(dir: string): string | null {
  const exe = join(dir, 'bin', '64bit', OBS_EXE)
  return existsSync(exe) ? exe : null
}

/**
 * 启动 OBS（脱离本进程，关掉我们 OBS 也不会跟着退出）。
 * 工作目录必须是 bin\64bit，否则 OBS 找不到 locale 会直接报错退出。
 * extraArgs 例：['--disable-shutdown-check']（跳过「上次未正常关闭」的安全模式询问）、['--startstreaming']
 */
export function launchObs(dir: string, extraArgs: string[] = []): { ok: boolean; error?: string; pid?: number } {
  const exe = obsExePath(dir)
  if (!exe) return { ok: false, error: `找不到 ${OBS_EXE}：${join(dir, 'bin', '64bit')}` }
  try {
    const child = spawn(exe, extraArgs, { cwd: dirname(exe), detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true, pid: child.pid }
  } catch (err) {
    return { ok: false, error: `启动 OBS 失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/** obs64.exe 是否在运行：走共享进程快照（异步、缓存），不再各自起 tasklist 卡主线程 */
export function isObsRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return processRunning(OBS_EXE)
}

const companionProbe: CompanionProbe = {
  fileExists: (file) => { try { return statSync(file).isFile() } catch { return false } },
  directories: (dir) => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] } }
}

/** 起一个 PowerShell 取 JSON（异步，最多 6 秒）；失败/超时给 null。PowerShell 冷启动要 1～2 秒，绝不能同步等。 */
function powershellJson(script: string): Promise<unknown> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      execFile(systemTool('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
        '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ' + script], { windowsHide: true, timeout: 6000, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve(null)
        try { resolve(JSON.parse(decodeConsoleOutput(stdout as Buffer).replace(/^\uFEFF/, '').trim() || 'null')) } catch { resolve(null) }
      })
    } catch { resolve(null) }
  })
}

let companionCache: { preferred: string; found: { installDir: string; exePath: string } | null } | undefined
type CompanionFound = ReturnType<typeof discoverCompanion>
let companionInflight: Promise<CompanionFound> | null = null
async function findCompanion(refresh = false, preferred = ''): Promise<CompanionFound> {
  if (!refresh && companionCache?.preferred === preferred) return companionCache.found
  if (companionInflight) return companionInflight
  companionInflight = findCompanionUncached(preferred).finally(() => { companionInflight = null })
  return companionInflight
}
async function findCompanionUncached(preferred: string): Promise<CompanionFound> {
  const paths = await powershellJson("@(Get-CimInstance Win32_Process -Filter \"Name='直播伴侣.exe'\" | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ }) | ConvertTo-Json -Compress")
  let found = discoverCompanion({ preferred, processes: (Array.isArray(paths) ? paths : [paths]).filter((p): p is string => typeof p === 'string'), defaults: DEFAULT_LIVE_COMPANION_DIRS }, companionProbe)
  if (!found) {
    const entries = await powershellJson("@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '直播伴侣|webcast_mate' } | Select-Object DisplayName,InstallLocation,DisplayIcon) | ConvertTo-Json -Compress")
    found = discoverCompanion({ registry: companionRegistryLocations(entries) }, companionProbe)
  }
  companionCache = { preferred, found }
  return found
}

export async function liveCompanionInstallDir(refresh = false, preferred = ''): Promise<string | null> {
  return (await findCompanion(refresh, preferred))?.installDir || null
}

export function validateLiveCompanionDirectory(dir: string): boolean {
  return !!companionExecutable(dir, companionProbe)
}

/** 抖音直播伴侣进程是否在运行（共享进程快照，异步）。 */
export async function isLiveCompanionRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  for (const name of LIVE_COMPANION_EXES) if (await processRunning(name)) return true
  return false
}

/**
 * 直播伴侣的 OBS 场景目录（不同版本会按插件实例分目录）。
 * 直播伴侣通常没有开放 obs-websocket，因此只用于判断本地配置是否已创建，
 * 不会拿它去覆盖 OBS 的远程接口配置。
 */
export function liveCompanionConfigRoot(): string | null {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  const candidates = [
    join(appData, 'douyin-plugins', 'obsplus', 'clock'),
    join(appData, 'douyin-plugins', 'obsplus', 'livehime')
  ]
  return candidates.find((dir) => existsSync(dir)) ?? null
}

export interface LiveCompanionStatus {
  installed: boolean
  running: boolean
  installDir: string | null
  configRoot: string | null
}

export async function liveCompanionStatus(refresh = false, preferred = ''): Promise<LiveCompanionStatus> {
  const [installDir, running] = await Promise.all([liveCompanionInstallDir(refresh, preferred), isLiveCompanionRunning()])
  return {
    installed: !!installDir,
    running,
    installDir,
    configRoot: liveCompanionConfigRoot()
  }
}

/** 仅启动桌面程序。成功只代表进程已创建，不代表登录或采集已连接。 */
export async function launchLiveCompanion(preferred = ''): Promise<{ ok: boolean; error?: string; pid?: number }> {
  if (await isLiveCompanionRunning()) return { ok: true }
  const found = await findCompanion(true, preferred)
  if (!found) return { ok: false, error: '未找到抖音直播伴侣，请选择安装目录' }
  return new Promise((resolveResult) => {
    const child = spawn(found.exePath, [], { cwd: dirname(found.exePath), detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (err) => resolveResult({ ok: false, error: `启动抖音直播伴侣失败：${err.message}` }))
    child.once('spawn', () => { child.unref(); resolveResult({ ok: true, pid: child.pid }) })
  })
}

// ==================== 配置目录 ====================

/**
 * OBS 用户配置根目录：一般是 %APPDATA%\obs-studio；
 * 便携模式（安装目录下有 portable_mode.txt / obs_portable_mode.txt）时是 <安装目录>\config\obs-studio。
 */
export function obsConfigRoot(): string {
  const dir = obsInstallDir()
  if (dir && (existsSync(join(dir, 'portable_mode.txt')) || existsSync(join(dir, 'obs_portable_mode.txt')))) {
    return join(dir, 'config', 'obs-studio')
  }
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'obs-studio')
}

export function obsWebSocketConfigPath(): string {
  return join(obsConfigRoot(), 'plugin_config', 'obs-websocket', 'config.json')
}

// ==================== obs-websocket 配置 ====================

export interface ObsWebSocketConfig {
  /** 配置文件是否存在且能解析 */
  found: boolean
  enabled: boolean
  port: number
  password: string
  authRequired: boolean
  /** 实际读取的配置文件路径 */
  path: string
  /** 文件存在但解析失败时的说明 */
  error?: string
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * 读 obs-websocket 的配置；文件不存在时返回默认值（port 4455、未启用）。
 * configPath 仅供测试用，正常调用不传。
 */
export function readObsWebSocketConfig(configPath?: string): ObsWebSocketConfig {
  const path = configPath ?? obsWebSocketConfigPath()
  const fallback: ObsWebSocketConfig = {
    found: false,
    enabled: false,
    port: DEFAULT_WS_PORT,
    password: '',
    authRequired: true,
    path
  }
  if (!existsSync(path)) return fallback
  try {
    const json = JSON.parse(stripBom(readFileSync(path, 'utf8'))) as Record<string, unknown>
    const port = json.server_port
    return {
      found: true,
      enabled: json.server_enabled === true,
      port: typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_WS_PORT,
      password: typeof json.server_password === 'string' ? json.server_password : '',
      authRequired: json.auth_required !== false,
      path
    }
  } catch (err) {
    return { ...fallback, error: `配置文件解析失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

function backupStamp(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}

/**
 * 把 obs-websocket 设为：启用服务器 + 需要密码 + 指定密码（端口和其它键保持原样）。
 * - 写之前先备份为 config.json.bak-<yyyyMMdd>（当天已有备份则加时分秒后缀，不覆盖最早那份）
 * - 只在 OBS 未运行时允许改真实配置（OBS 退出时会用内存里的旧值把文件写回去，改了也白改）
 * - 保留原文件的缩进和换行风格，键名按字母序，和 obs-websocket 自己写出来的一致
 * configPath 仅供测试用：指向临时目录时不做「OBS 是否运行」检查。
 */
export async function enableObsWebSocket(password: string, configPath?: string): Promise<{ ok: boolean; error?: string; path?: string; backup?: string }> {
  if (!password) return { ok: false, error: '密码不能为空' }
  const realPath = obsWebSocketConfigPath()
  const path = configPath ?? realPath
  if (samePath(path, realPath) && (await isObsRunning())) return { ok: false, error: '请先关闭 OBS 再修改' }

  let existing: Record<string, unknown> = {}
  let indent = '  '
  let eol = '\r\n'
  let backup: string | undefined
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8')
      try {
        const parsed = JSON.parse(stripBom(raw))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>
      } catch {
        // 原文件坏了：照样备份，然后按默认值重写
      }
      const indentMatch = /^([ \t]+)"/m.exec(raw)
      if (indentMatch) indent = indentMatch[1]
      if (raw.includes('\n') && !raw.includes('\r\n')) eol = '\n'
      let backupPath = `${path}.bak-${backupStamp()}`
      if (existsSync(backupPath)) {
        const now = new Date()
        const p = (n: number): string => String(n).padStart(2, '0')
        backupPath += `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
      }
      copyFileSync(path, backupPath)
      backup = backupPath
    } else {
      mkdirSync(dirname(path), { recursive: true })
    }
    const merged: Record<string, unknown> = {
      alerts_enabled: false,
      first_load: false,
      server_port: DEFAULT_WS_PORT,
      ...existing,
      auth_required: true,
      server_enabled: true,
      server_password: password
    }
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(merged).sort()) sorted[key] = merged[key]
    const text = JSON.stringify(sorted, null, indent).replace(/\n/g, eol) + eol
    writeFileSync(path, text, 'utf8')
    return { ok: true, path, backup }
  } catch (err) {
    return { ok: false, error: `写入配置失败：${err instanceof Error ? err.message : String(err)}`, path, backup }
  }
}

// ==================== 场景集合离线解析 ====================

export interface ObsSceneCollectionInfo {
  /** 是否找到了场景集合文件 */
  found: boolean
  /** 场景集合 json 路径 */
  path?: string
  /** 场景集合名 */
  name?: string
  /** 当前节目场景 */
  currentScene?: string
  /** 场景名列表（界面顺序） */
  scenes: string[]
  /** 所有源（含场景、分组）上的滤镜 */
  filters: ObsFilterInfo[]
  error?: string
}

/** 极简 ini 解析：{ 小写节名 → { 小写键 → 值 } }；libobs 写值时把反斜杠转义成 \\，这里还原 */
function readIni(file: string): Map<string, Map<string, string>> | null {
  if (!existsSync(file)) return null
  const out = new Map<string, Map<string, string>>()
  let section = new Map<string, string>()
  out.set('', section)
  for (const rawLine of stripBom(readFileSync(file, 'utf8')).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      section = new Map<string, string>()
      out.set(line.slice(1, -1).trim().toLowerCase(), section)
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const value = line.slice(eq + 1).replace(/\\(.)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c))
    section.set(line.slice(0, eq).trim().toLowerCase(), value)
  }
  return out
}

function iniGet(file: string, section: string, key: string): string | undefined {
  return readIni(file)?.get(section.toLowerCase())?.get(key.toLowerCase())
}

interface RawSource {
  name?: unknown
  id?: unknown
  versioned_id?: unknown
  filters?: unknown
}

interface RawFilter {
  name?: unknown
  id?: unknown
  versioned_id?: unknown
  enabled?: unknown
}

function collectFilters(sources: unknown, out: ObsFilterInfo[]): void {
  if (!Array.isArray(sources)) return
  for (const s of sources as RawSource[]) {
    if (!s || typeof s.name !== 'string' || !Array.isArray(s.filters)) continue
    for (const f of s.filters as RawFilter[]) {
      if (!f || typeof f.name !== 'string') continue
      const kind = typeof f.id === 'string' ? f.id : typeof f.versioned_id === 'string' ? f.versioned_id : ''
      out.push({ source: s.name, filter: f.name, kind, enabled: f.enabled !== false })
    }
  }
}

/**
 * 离线解析当前场景集合（OBS 没开、或 WebSocket 没连上时也能展示场景/滤镜列表）。
 * 当前集合取 user.ini（OBS 31+）或 global.ini（旧版）里的 [Basic] SceneCollectionFile；
 * 都没有就取 scenes 目录里最近修改的 json。configRoot 仅供测试用。
 */
export function readSceneCollection(configRoot?: string): ObsSceneCollectionInfo {
  const root = configRoot ?? obsConfigRoot()
  const scenesDir = join(root, 'basic', 'scenes')
  const empty: ObsSceneCollectionInfo = { found: false, scenes: [], filters: [] }
  if (!existsSync(scenesDir)) return { ...empty, error: `场景目录不存在：${scenesDir}` }

  let file: string | undefined
  const configured =
    iniGet(join(root, 'user.ini'), 'Basic', 'SceneCollectionFile') ??
    iniGet(join(root, 'global.ini'), 'Basic', 'SceneCollectionFile')
  if (configured) {
    // 有的版本写的是不带扩展名的「安全文件名」
    for (const candidate of [configured, `${configured}.json`]) {
      const full = join(scenesDir, candidate)
      if (existsSync(full) && statSync(full).isFile()) {
        file = full
        break
      }
    }
  }
  if (!file) {
    let newest = -1
    for (const name of readdirSync(scenesDir)) {
      if (!name.toLowerCase().endsWith('.json')) continue // 跳过 .json.bak 等
      const full = join(scenesDir, name)
      try {
        const st = statSync(full)
        if (st.isFile() && st.mtimeMs > newest) {
          newest = st.mtimeMs
          file = full
        }
      } catch {
        /* 忽略读不到的文件 */
      }
    }
  }
  if (!file) return { ...empty, error: `场景目录里没有场景集合文件：${scenesDir}` }

  try {
    const json = JSON.parse(stripBom(readFileSync(file, 'utf8'))) as Record<string, unknown>
    const filters: ObsFilterInfo[] = []
    collectFilters(json.sources, filters)
    collectFilters(json.groups, filters)
    const scenes: string[] = []
    if (Array.isArray(json.scene_order)) {
      for (const item of json.scene_order as Array<{ name?: unknown }>) {
        if (item && typeof item.name === 'string') scenes.push(item.name)
      }
    }
    if (!scenes.length && Array.isArray(json.sources)) {
      for (const s of json.sources as RawSource[]) if (s && s.id === 'scene' && typeof s.name === 'string') scenes.push(s.name)
    }
    const current = json.current_program_scene ?? json.current_scene
    return {
      found: true,
      path: file,
      name: typeof json.name === 'string' ? json.name : undefined,
      currentScene: typeof current === 'string' ? current : undefined,
      scenes,
      filters
    }
  } catch (err) {
    return { ...empty, path: file, error: `场景集合解析失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/** 离线列出当前场景集合里所有源的滤镜（source.name / filter.name / filter.id / filter.enabled） */
export function readSceneCollectionFilters(configRoot?: string): ObsFilterInfo[] {
  return readSceneCollection(configRoot).filters
}
