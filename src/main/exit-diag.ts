// 退出诊断：主播反馈「整个程序突然消失」，可 main.log 里消失前一行都没有 ——
// 主进程被强杀 / 原生崩溃 / 内存不足被系统终止时根本来不及写日志；而走正常退出流程时以前也没人记一笔。
// 于是「自己关的」和「被弄死的」在日志里长得一模一样（2026-09-19 隔壁主播一天四次无声重启，查不下去）。这里补三件事：
//   1. 运行标记 logs/run-state.json：启动写、每 15 秒心跳（顺手记内存/CPU/窗口数）、正常退出盖「clean」章。
//      下次启动一看：上次没盖章 = 不是自己退出的，而且死亡时刻精确到一次心跳、死前资源占用也在。
//   2. Crashpad 本地转储（crash-log.ts 里开）：主进程原生崩溃 / V8 内存耗尽会在 userData/Crashpad 留 .dmp，
//      主播机器上 Windows 可靠性记录被精简系统关掉也不影响；启动时把新出现的转储记进 main.log。
//   3. 每 60 秒一行 [perf]：系统剩余内存、客户端全部进程内存/CPU 汇总、主进程内存、窗口数。
//      「CPU 和内存占得很满」这种反馈能对上曲线，也能看出是不是越跑越大。
//   4. 退出码记录员（独立 PowerShell 进程，隐藏窗口、零 CPU 等待）：主进程一消失就把 Windows 给的真实退出码写进 main.log
//      （0xC0000005 原生崩溃 / 0x80000003 Chromium 内存不足自杀 / 1 被 taskkill / 0xC000013A 注销……），程序自己是没法记自己死因的。
//      ★只记录、绝不自动拉起程序：自动重启会把连接器和直播间连接全断掉（用户 2026-09-19 明确不要）。
// 上次异常退出 + 新转储 走服务器现成 POST /api/error（与 mod-health 一键上传同一接口），开工简报里直接能看到，不用等主播发日志。
import { app, BrowserWindow, net, powerMonitor } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logLine, logsDir } from './crash-log'
import { getSettings, saveSettings } from './settings'
import { SERVER_URL_HTTPS } from './server-tls'

// 诊断节奏不给主播调：心跳越密死亡时刻越准，15 秒足够；perf 每分钟一行，2MB 日志上限下约 9 天才轮转一次。
const HEARTBEAT_MS = 15_000
const PERF_LOG_MS = 60_000
const UPLOAD_DELAY_MS = 20_000
const MAX_DUMPS_REMEMBERED = 50

type Metrics = { rssMb: number; heapMb: number; totalWsMb: number; sysFreeMb: number; sysTotalMb: number; procs: number; cpuPct: number; windows: number }
type RunState = Metrics & {
  pid: number
  version: string
  startedAt: string
  lastBeat: string
  uptimeSec: number
  clean?: { at: string; reason: string }
  dumpsSeen?: string[]
}

let markerFile = ''
let startedAt = 0
let quitReason = ''
let finalized = false
let dumpsSeen: string[] = []
const pendingReports: Array<{ tag: string; msg: string; stack: string }> = []

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '?'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h ? `${h}小时${m}分` : m ? `${m}分${s}秒` : `${s}秒`
}

/** 退出路径上第一个说出理由的人算数：主窗口关闭 / 所有窗口清空 / 安装更新 / 管理员重启 / Windows 注销关机。 */
export function markQuitReason(reason: string): void {
  if (!quitReason) quitReason = reason
}

/** Windows 注销 / 关机 / 重启（主窗口的 session-end 事件）：子进程会以 0x40010004 被结束，以前日志里只剩几行 killed，看着像崩溃。 */
export function noteSessionEnd(): void {
  markQuitReason('Windows 注销或关机')
  logLine('power', 'Windows 会话结束（注销 / 关机 / 重启）')
  finalize('Windows 注销或关机')
}

function collect(): Metrics {
  const mu = process.memoryUsage()
  let ws = 0, cpu = 0, procs = 0
  try {
    for (const m of app.getAppMetrics()) {
      ws += m.memory?.workingSetSize || 0
      cpu += m.cpu?.percentCPUUsage || 0
      procs++
    }
  } catch { /* 取不到就只有主进程自己的数 */ }
  let free = -1, total = -1
  try {
    const info = process.getSystemMemoryInfo()
    free = Math.round(info.free / 1024)
    total = Math.round(info.total / 1024)
  } catch { /* 极少数环境拿不到系统内存 */ }
  let windows = 0
  try { windows = BrowserWindow.getAllWindows().length } catch { /* app 还没 ready */ }
  return {
    rssMb: Math.round(mu.rss / 1048576),
    heapMb: Math.round(mu.heapUsed / 1048576),
    totalWsMb: Math.round(ws / 1024),
    sysFreeMb: free,
    sysTotalMb: total,
    procs,
    cpuPct: Math.round(cpu),
    windows
  }
}

function readMarker(): RunState | null {
  try {
    if (!fs.existsSync(markerFile)) return null
    const o = JSON.parse(fs.readFileSync(markerFile, 'utf8'))
    return o && typeof o.pid === 'number' ? (o as RunState) : null
  } catch {
    return null
  }
}

function writeMarker(clean?: { at: string; reason: string }): void {
  try {
    const now = Date.now()
    const state: RunState = {
      ...collect(),
      pid: process.pid,
      version: app.getVersion(),
      startedAt: stamp(new Date(startedAt)),
      lastBeat: stamp(),
      uptimeSec: Math.round((now - startedAt) / 1000),
      dumpsSeen,
      ...(clean ? { clean } : {})
    }
    // 先写临时文件再改名：心跳写到一半断电/被杀，不会留下半截 JSON 让下次启动读不出
    const tmp = markerFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8')
    fs.renameSync(tmp, markerFile)
  } catch { /* 诊断本身不能把程序拖垮 */ }
}

function finalize(reason: string): void {
  if (finalized) return
  finalized = true
  writeMarker({ at: stamp(), reason })
}

/** userData/Crashpad 下新出现的 .dmp：主进程原生崩溃 / V8 OOM 的唯一物证。 */
function scanCrashDumps(): Array<{ file: string; sizeKb: number; mtime: string }> {
  const found: Array<{ file: string; sizeKb: number; mtime: string }> = []
  let root = ''
  try { root = app.getPath('crashDumps') } catch { return found }
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (/\.dmp$/i.test(e.name)) {
        try {
          const st = fs.statSync(full)
          found.push({ file: full, sizeKb: Math.round(st.size / 1024), mtime: stamp(st.mtime) })
        } catch { /* 正在写的转储先跳过，下次再记 */ }
      }
    }
  }
  walk(root, 0)
  return found
}

function checkPreviousRun(): void {
  const prev = readMarker()
  dumpsSeen = Array.isArray(prev?.dumpsSeen) ? prev!.dumpsSeen!.slice(-MAX_DUMPS_REMEMBERED) : []
  if (prev) {
    if (prev.clean) {
      logLine('exit-diag', `上次运行 ${prev.version} 正常退出：${prev.clean.reason}（${prev.clean.at}）`)
    } else {
      const msg =
        `上次运行没有走正常退出流程（崩溃 / 被强制结束 / 内存不足被系统终止）：版本 ${prev.version} pid ${prev.pid}，` +
        `启动 ${prev.startedAt}，最后心跳 ${prev.lastBeat}（已运行 ${fmtDuration(prev.uptimeSec)}）；` +
        `死前 15 秒内：客户端 ${prev.procs} 个进程共 ${prev.totalWsMb}MB、主进程 ${prev.rssMb}MB（堆 ${prev.heapMb}MB）、` +
        `系统剩余内存 ${prev.sysFreeMb}MB/${prev.sysTotalMb}MB、CPU ${prev.cpuPct}%、窗口 ${prev.windows} 个`
      logLine('unclean-exit', msg)
      pendingReports.push({ tag: 'unclean-exit', msg: `上次异常退出 ${prev.version}`, stack: msg })
    }
  }
  const dumps = scanCrashDumps()
  const fresh = dumps.filter(d => !dumpsSeen.includes(path.basename(d.file)))
  for (const d of fresh) {
    logLine('crash-dump', `发现崩溃转储 ${d.file}（${d.sizeKb}KB，${d.mtime}）—— 主进程原生崩溃或内存耗尽的现场，排查时把这个文件发给作者`)
    pendingReports.push({ tag: 'crash-dump', msg: `崩溃转储 ${path.basename(d.file)} ${d.sizeKb}KB ${d.mtime}`, stack: d.file })
    dumpsSeen.push(path.basename(d.file))
  }
  dumpsSeen = dumpsSeen.slice(-MAX_DUMPS_REMEMBERED)
  // 一份主进程转储 30MB 上下，只留最新 3 份，别让主播磁盘被崩溃现场堆满
  const byTime = [...dumps].sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  for (const old of byTime.slice(3)) {
    try { fs.unlinkSync(old.file); logLine('crash-dump', `清理旧转储 ${path.basename(old.file)}`) } catch { /* 删不掉下次再试 */ }
  }
}

function logSystemInfo(): void {
  try {
    const cpus = os.cpus()
    const m = collect()
    logLine('sys', `${os.type()} ${os.release()} ${os.arch()} | CPU ${cpus.length} 线程 ${cpus[0]?.model?.trim() || '?'} | 内存 ${m.sysTotalMb}MB 剩余 ${m.sysFreeMb}MB | 渲染模式 ${getSettings().renderMode || 'balanced'} | 转储目录 ${(() => { try { return app.getPath('crashDumps') } catch { return '?' } })()}`)
  } catch { /* 只是信息 */ }
}

function logPerf(): void {
  const m = collect()
  logLine('perf', `系统剩余 ${m.sysFreeMb}MB/${m.sysTotalMb}MB | 客户端 ${m.procs} 进程共 ${m.totalWsMb}MB CPU ${m.cpuPct}% | 主进程 ${m.rssMb}MB 堆 ${m.heapMb}MB | 窗口 ${m.windows} | 已运行 ${fmtDuration((Date.now() - startedAt) / 1000)}`)
}

/** 上次异常退出 / 新转储 报到服务器：无令牌、按 IP 限流，一次启动最多发一条请求，失败只记日志。 */
function uploadPendingReports(): void {
  if (!pendingReports.length) return
  const entries = pendingReports.splice(0).map(r => ({ t: new Date().toISOString(), tag: r.tag, msg: r.msg, stack: r.stack.slice(0, 1800) }))
  const base = String(getSettings().serverUrl || SERVER_URL_HTTPS).replace(/\/+$/, '')
  const body = JSON.stringify({ v: app.getVersion(), e: entries })
  let done = false
  const finish = (ok: boolean, why = ''): void => {
    if (done) return
    done = true
    logLine('exit-diag', ok ? `异常退出记录已上报服务器（${entries.length} 条）` : `异常退出记录上报失败：${why}`)
  }
  const timer = setTimeout(() => finish(false, '服务器没有响应'), 20_000)
  try {
    // 必须用 net.request：服务器自签证书钉在 server-tls.ts，Node 的 fetch 不认
    const req = net.request({ url: `${base}/api/error`, method: 'POST' })
    req.setHeader('Content-Type', 'application/json')
    req.on('response', res => {
      const sc = res.statusCode || 0
      res.on('data', () => { /* 只回 {"ok":1} */ })
      res.on('end', () => { clearTimeout(timer); finish(sc < 400, `HTTP ${sc}`) })
      res.on('error', () => { clearTimeout(timer); finish(false, '响应中断') })
    })
    req.on('error', e => { clearTimeout(timer); finish(false, String(e?.message || e)) })
    req.write(body)
    req.end()
  } catch (e) {
    clearTimeout(timer)
    finish(false, String(e))
  }
}

// 退出码记录员脚本。只有 ASCII 以外的中文，所以文件带 BOM（PowerShell 5.1 没 BOM 会按 ANSI 读、中文全乱）；
// 往 main.log 追加时用无 BOM UTF-8，和主进程写的行一致。等待用 WaitForExit（阻塞在内核句柄上，不轮询、不吃 CPU）。
const RECORDER_SCRIPT = `param([int]$ParentPid, [string]$Marker, [string]$Log)
$enc = New-Object System.Text.UTF8Encoding($false)
function Say($s) { try { [IO.File]::AppendAllText($Log, ('[{0}] [watchdog] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $s) + [Environment]::NewLine, $enc) } catch {} }
try { $p = Get-Process -Id $ParentPid -ErrorAction Stop } catch { Say ('找不到主进程 pid=' + $ParentPid + '：' + $_.Exception.Message); exit 0 }
# 退出码走 Win32 直取：OpenProcess(SYNCHRONIZE|QUERY_LIMITED) → WaitForSingleObject → GetExitCodeProcess。
# .NET 的 Process.ExitCode 对不是自己启动的进程时灵时不灵（实测偶尔 null），这条路不依赖它。
$code = $null
$h = [IntPtr]::Zero
try {
  Add-Type -Namespace ZL -Name K32 -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
'@
  $h = [ZL.K32]::OpenProcess([uint32](0x00100000 -bor 0x1000), $false, [uint32]$ParentPid)
} catch { $h = [IntPtr]::Zero }
try { $null = $p.Handle } catch {}
Say ('退出码记录员就位，盯着主进程 pid=' + $ParentPid + '（记录员 pid=' + $PID + '）')
if ($h -ne [IntPtr]::Zero) {
  [void][ZL.K32]::WaitForSingleObject($h, [uint32]4294967295)
  $raw = [uint32]0
  if ([ZL.K32]::GetExitCodeProcess($h, [ref]$raw)) { $code = [int64]$raw }
  [void][ZL.K32]::CloseHandle($h)
} else {
  try { $p.WaitForExit() } catch { Say ('等待主进程失败：' + $_.Exception.Message); exit 0 }
  try { $code = $p.ExitCode } catch {}
}
Start-Sleep -Milliseconds 1500
if ($code -eq $null) { try { $code = $p.ExitCode } catch {} }
$clean = $false; $reason = ''
try { $j = Get-Content -LiteralPath $Marker -Raw -Encoding UTF8 | ConvertFrom-Json; if ($j.clean) { $clean = $true; $reason = [string]$j.clean.reason } } catch {}
$hex = '未知'; $name = ''
if ($code -ne $null) {
  # 崩溃退出码是负的 int32（0xC0000005 = -1073741819）；PowerShell 里 0xFFFFFFFF 字面量是 -1，-band 白做，得手工补 2^32
  $v = [int64]$code
  if ($v -lt 0) { $v += 4294967296 }
  $u = [uint32]$v
  $hex = '0x{0:X8}' -f $u
  switch ($u) {
    0          { $name = '正常' }
    1          { $name = '被结束（taskkill / 任务管理器 / 杀毒软件）' }
    2147483651 { $name = '断点异常：Chromium 主动终止，最常见于内存不足' }
    3221225477 { $name = '访问违规：原生代码崩溃' }
    3221226505 { $name = '致命错误 / 栈保护（常见于内存不足或断言）' }
    3221225786 { $name = 'Ctrl+C / 会话结束' }
    1073807364 { $name = '被调试器终止 / Windows 注销关机' }
    3221226356 { $name = '堆损坏' }
    3221225725 { $name = '栈溢出' }
    3221225495 { $name = '内存不足：系统拒绝分配' }
    default    { $name = '' }
  }
}
if ($clean) { Say ('主进程 pid=' + $ParentPid + ' 已退出 code=' + $hex + ' ' + $name + '；标记=正常退出（' + $reason + '）') }
else { Say ('主进程 pid=' + $ParentPid + ' 消失 code=' + $hex + ' ' + $name + '；标记=没走正常退出流程 —— 这就是「程序突然消失」，退出码是死因线索') }
`

/** 拉起独立的退出码记录员。只记录，绝不重启程序。 */
function spawnExitRecorder(): void {
  if (process.platform !== 'win32' || process.env.ZL_NO_EXIT_RECORDER) return
  try {
    const script = path.join(logsDir(), 'exit-recorder.ps1')
    fs.writeFileSync(script, '﻿' + RECORDER_SCRIPT, 'utf8')
    // ★两个坑叠在一起，只能绕：
    //   1. Node/libuv 在 Windows 上把非 detached 的子进程塞进「父进程死则全灭」的 Job —— 记录员会跟主进程一起被杀，
    //      恰好在最需要它的时刻（强杀 / 崩溃）一行都写不出（实测：直接拉起也一样）。
    //   2. detached（DETACHED_PROCESS）能出 Job，但 powershell.exe 是控制台程序，没有控制台可挂就静默退出。
    //   所以经 wscript.exe 跳一层：它是图形程序，detached 也活得好；再用 WScript.Shell.Run 样式 0 拉 PowerShell，
    //   PowerShell 得到一个隐藏的新控制台、不在 Job 里、不闪窗（本机计划任务闪黑窗那次也是这个套路）。
    //   .vbs 写成 UTF-16 带 BOM：WSH 按系统 ANSI 读脚本，中文路径在 65001 代码页机器上会读错，Unicode 文件不受影响。
    const q = (s: string) => '""' + s.replace(/"/g, '') + '""'
    const cmdLine = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ${q(script)} ${process.pid} ${q(markerFile)} ${q(path.join(logsDir(), 'main.log'))}`
    const vbs = path.join(logsDir(), 'exit-recorder.vbs')
    fs.writeFileSync(vbs, Buffer.from(`﻿Set sh = CreateObject("WScript.Shell")\r\nsh.Run "${cmdLine}", 0, False\r\n`, 'utf16le'))
    const child = spawn('wscript.exe', ['//B', '//Nologo', vbs], { windowsHide: true, detached: true, stdio: 'ignore' })
    child.on('error', e => logLine('exit-diag', `退出码记录员起不来：${String(e?.message || e)}`))
    child.unref()
  } catch (e) {
    logLine('exit-diag', `退出码记录员起不来：${String(e)}`)
  }
}

// 页面进程挂了（crashed / oom / 被杀）→ 同一个窗口里自动重载页面：窗口不关、句柄和标题不变，直播伴侣的采集源不受影响，画面闪一下就回来。
// 主播不用再「关掉再打开」。省内存模式下多个挂件共用一个进程，一个页面出错会一起重载，靠这个兜底。
// 同一窗口 10 分钟内最多救 3 次，再多就是真坏了（留给主播手动处理，避免无限重载循环）。
const RECOVER_WINDOW_MS = 10 * 60_000
const RECOVER_MAX = 3
const recoverHistory = new WeakMap<BrowserWindow, number[]>()
function autoRecoverPage(contents: Electron.WebContents, reason: string): void {
  if (finalized || reason === 'clean-exit') return
  const win = BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed()) return
  const now = Date.now()
  const history = (recoverHistory.get(win) || []).filter(t => now - t < RECOVER_WINDOW_MS)
  let title = ''
  try { title = win.getTitle() } catch { /* 窗口正在销毁 */ }
  if (history.length >= RECOVER_MAX) {
    logLine('recover', `窗口「${title}」页面进程 ${reason}，10 分钟内已自动重载 ${history.length} 次，不再自动救，请主播关掉再打开`)
    // 兼容自适应：省内存模式（挂件共用进程）下反复崩 = 这台机器的显卡驱动 / 系统和共用进程合不来，
    // 自动切回「每窗口独立进程」（0.3.59 及以前的行为），下次启动生效；主播不用懂这些
    if (getSettings().processMode !== 'stable') {
      try {
        saveSettings({ processMode: 'stable' })
        logLine('recover', '省内存模式下页面反复崩溃，已自动把「进程模式」切回每窗口独立进程，下次启动生效（设置页可改回）')
        void import('./connector').then(m => m.pushConnectorLog('warn', '挂件页面反复出错，已自动切回「每个窗口独立进程」模式，重启客户端后生效'))
      } catch (e) { logLine('recover', `自动切换进程模式失败：${String(e)}`) }
    }
    return
  }
  history.push(now)
  recoverHistory.set(win, history)
  logLine('recover', `窗口「${title}」页面进程 ${reason}，${history.length}/${RECOVER_MAX} 次自动重载（窗口不关、采集源不变）`)
  setTimeout(() => {
    try { if (!win.isDestroyed() && !contents.isDestroyed()) contents.reload() } catch (e) { logLine('recover', `自动重载失败：${String(e)}`) }
  }, 300)
}

/** 在 app ready 之后、只由拿到单实例锁的那个实例调用（第二实例不能碰运行标记，它属于正在跑的那个）。 */
export function initExitDiag(): void {
  app.on('render-process-gone', (_e, contents, details) => autoRecoverPage(contents, details.reason))
  startedAt = Date.now()
  markerFile = path.join(logsDir(), 'run-state.json')
  checkPreviousRun()
  logSystemInfo()
  writeMarker()
  spawnExitRecorder()
  logPerf()
  setInterval(() => { if (!finalized) writeMarker() }, HEARTBEAT_MS)
  setInterval(logPerf, PERF_LOG_MS)
  setTimeout(uploadPendingReports, UPLOAD_DELAY_MS)

  // 退出路径全部留痕：以后日志里没有这些行却出现了新的 [start]，就能断定不是自己退出的
  app.on('before-quit', () => logLine('quit', `before-quit：${quitReason || '未标注来源'}`))
  app.on('will-quit', () => logLine('quit', 'will-quit'))
  app.on('quit', (_e, code) => {
    logLine('quit', `quit exitCode=${code}：${quitReason || '未标注来源'}`)
    finalize(quitReason || `quit exitCode=${code}`)
  })
  process.on('exit', code => {
    logLine('exit', `主进程退出 code=${code}`)
    finalize(quitReason || `process exit ${code}`)
  })
  try {
    powerMonitor.on('suspend', () => logLine('power', '系统睡眠'))
    powerMonitor.on('resume', () => logLine('power', '系统唤醒'))
    powerMonitor.on('lock-screen', () => logLine('power', '锁屏'))
    powerMonitor.on('unlock-screen', () => logLine('power', '解锁'))
  } catch { /* powerMonitor 只在 ready 后可用，这里本来就在 ready 后 */ }
}
