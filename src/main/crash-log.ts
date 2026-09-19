// 崩溃日志：主播机器上出的错必须留下证据。
// 之前主进程一旦有未捕获异常，Electron 弹一个英文的「A JavaScript error occurred in the main process」，
// 主播看不懂、关掉就退出，事后什么都查不到。这里把所有异常写进 userData/logs/main.log，
// 并换成中文提示且不退出；渲染层页面出错（PageErrorBoundary）也通过 IPC 记进同一份日志。
import { app, crashReporter, dialog, shell } from 'electron'
import fs from 'fs'
import path from 'path'

const MAX_BYTES = 2 * 1024 * 1024
let logFile = ''
let dialogShownAt = 0

export function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function ensureFile(): string {
  if (logFile) return logFile
  const dir = logsDir()
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'main.log')
  return logFile
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 写一行日志；超过 2MB 就把旧的挪成 main.log.1 重新开始。 */
export function logLine(tag: string, message: unknown): void {
  try {
    const file = ensureFile()
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1')
    } catch {
      /* 挪不动就继续往里写 */
    }
    const text = message instanceof Error ? `${message.message}\n${message.stack || ''}` : typeof message === 'string' ? message : JSON.stringify(message)
    fs.appendFileSync(file, `[${stamp()}] [${tag}] ${text}\n`, 'utf8')
  } catch {
    /* 日志本身出错不能再炸 */
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack || ''}`
  try {
    return typeof err === 'string' ? err : JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// 同一分钟内只弹一次提示，避免异常循环时弹窗刷屏
function showOnce(title: string, body: string): void {
  const now = Date.now()
  if (now - dialogShownAt < 60_000) return
  dialogShownAt = now
  try {
    dialog.showErrorBox(title, body)
  } catch {
    /* 窗口系统没就绪也不要紧 */
  }
}

export function initCrashLog(): void {
  logLine('start', `知了猴整蛊台 ${app.getVersion()} 启动，packaged=${app.isPackaged} exe=${process.execPath}`)
  // 原生崩溃 / V8 内存耗尽时 JS 层什么都留不下；开 Crashpad 只在本机 userData/Crashpad 落 .dmp，不上传。
  // 主播机器上精简系统常把 Windows 可靠性记录关掉，有了本地转储就不依赖它。必须在 ready 前调用。
  try {
    crashReporter.start({ productName: '知了猴整蛊台', companyName: '知了猴工作室', submitURL: '', uploadToServer: false, compress: false })
  } catch (e) {
    logLine('startup', `Crashpad 崩溃转储没开起来：${e instanceof Error ? e.message : String(e)}`)
  }
  // Node 的警告（MaxListenersExceededWarning 之类）带上它是在哪里加的监听器，不然只知道漏、不知道谁漏
  process.on('warning', (w) => logLine('warning', `${w.name}: ${w.message}\n${w.stack || ''}`))
  process.on('uncaughtException', (err) => {
    logLine('uncaughtException', describe(err))
    showOnce('知了猴整蛊台遇到问题', `程序内部出了一个错误，已记录到日志，客户端会继续运行。\n\n${(err as Error)?.message || String(err)}\n\n日志位置：${ensureFile()}`)
  })
  process.on('unhandledRejection', (reason) => {
    logLine('unhandledRejection', describe(reason))
  })
  app.on('render-process-gone', (_e, contents, details) => {
    logLine('render-process-gone', `${details.reason} exitCode=${details.exitCode} url=${(() => { try { return contents.getURL() } catch { return '' } })()}`)
    if (details.reason !== 'clean-exit') showOnce('知了猴整蛊台页面崩溃', `界面进程意外退出（${details.reason}），已记录到日志。关掉再打开客户端即可恢复。\n\n日志位置：${ensureFile()}`)
  })
  app.on('child-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') logLine('child-process-gone', `${details.type} ${details.reason} exitCode=${details.exitCode} name=${details.name || ''}`)
  })
  // console.error / console.warn 也镜像一份进日志，主播那边没有终端能看
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    logLine('error', args.map((a) => (a instanceof Error ? describe(a) : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' '))
    origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    logLine('warn', args.map((a) => (a instanceof Error ? describe(a) : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' '))
    origWarn(...args)
  }
}

/** 渲染层页面错误边界捕获到的错误，记进同一份日志。 */
export function reportRendererError(payload: { message?: string; stack?: string; component?: string; route?: string }): { ok: boolean; file: string } {
  logLine('page-error', `route=${payload?.route || ''}\n${payload?.message || ''}\n${payload?.stack || ''}\n${payload?.component || ''}`)
  return { ok: true, file: ensureFile() }
}

export async function openLogsDir(): Promise<{ ok: boolean; path: string }> {
  const dir = logsDir()
  fs.mkdirSync(dir, { recursive: true })
  ensureFile()
  const err = await shell.openPath(dir)
  return { ok: !err, path: dir }
}
