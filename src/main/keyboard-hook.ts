// 全局键鼠监听模块（自包含，零第三方依赖）。
// 供「键盘显示」直播挂件用：把主播实时按下的键鼠通过订阅回调抛出去，挂件窗口再画给观众看。
//
// 实现思路（详见 keyboard-hook-script.ts 顶部注释）：
//   spawn 一个隐藏窗口的 PowerShell，脚本用 Add-Type 编译 C#，装 WH_KEYBOARD_LL(13) 与
//   WH_MOUSE_LL(14) 两个低级钩子跑消息循环，每个事件立即向 stdout 写一行。TS 侧按行解析。
//   停止时向子进程 stdin 写一行 quit（脚本收到即 UnhookWindowsHookEx + PostQuitMessage 退出），
//   或直接杀进程兜底。
//
// 风格参考 src/main/marquee-widget.ts：单文件、模块级状态、导出幂等的开/关/查询函数、
//   app.on('before-quit') 里收尾。子进程生命周期管理参考 src/main/connector.ts 的
//   `child === c` 守卫写法（防旧进程的退出事件误伤新进程引用）。
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { KEYBOARD_HOOK_PS1 } from './keyboard-hook-script'

export interface KeyHookEvent {
  kind: 'key' | 'mouse'
  action: 'down' | 'up' | 'wheel'
  vk?: number
  scan?: number
  extended?: boolean
  button?: 'l' | 'r' | 'm' | 'x1' | 'x2'
  delta?: number
  ts: number
}

// ── 模块级状态 ──
let child: ChildProcess | null = null
let running = false
let manualStop = false // 主动 stop：子进程退出时不当成异常
let startedAt: number | undefined
let lastEventAt: number | undefined // 最近一次真实键鼠事件
let lastHeartbeatAt: number | undefined // 最近一次心跳/事件（判活用）
let lastError: string | undefined
let stdoutBuf = ''
let watchdog: ReturnType<typeof setInterval> | null = null
let displayRequested = false
let lockUntil = 0
let lockKeys = ''
let requestId = 0
type LockResult = { ok: boolean; error?: string }
const requests = new Map<string, { done: (result: LockResult) => void; timer: ReturnType<typeof setTimeout> }>()

function finishRequests(error: string): void {
  for (const request of requests.values()) {
    clearTimeout(request.timer)
    request.done({ ok: false, error })
  }
  requests.clear()
  lockUntil = 0
  lockKeys = ''
}

function stopIfUnused(): void {
  if (!displayRequested && !lockUntil && !requests.size) stopKeyboardHook(true)
}

/** 仅在钩子确认已应用后返回成功；超时卸载钩子，避免留下不确定的锁定。 */
export async function commandKeyboardLock(command: 'lock' | 'adjust' | 'unlock', ms = 0, keys = '*'): Promise<LockResult> {
  if (command !== 'lock' && !child) return { ok: true }
  const started = startKeyboardHook(false)
  if (!started.ok) return started
  const c = child!
  const id = String(++requestId)
  return new Promise((done) => {
    const timer = setTimeout(() => {
      lastError = '键盘锁定未收到钩子确认，已解除锁定；请重试'
      stopKeyboardHook(true)
    }, 10_000)
    requests.set(id, { done, timer })
    const line = command === 'lock' ? `lock ${id} ${ms} ${keys}` : command === 'adjust' ? `adjust ${id} ${ms}` : `unlock ${id}`
    c.stdin!.write(line + '\n', (err) => {
      if (err && child === c) {
        lastError = '键盘锁定控制失败：' + err.message
        stopKeyboardHook(true)
      }
    })
  })
}

// 长按会触发键盘 down 自动重复：记录已按下的 vk，重复 down 直接吞掉，抬起时清除
const pressed = new Set<number>()
const handlers = new Set<(e: KeyHookEvent) => void>()

const HEARTBEAT_TIMEOUT_ERR = '钩子心跳超时（可能被 UAC 提权窗口拦截，或系统繁忙）'

function emit(e: KeyHookEvent): void {
  for (const h of handlers) {
    try {
      h(e)
    } catch {
      // 单个订阅者抛错不能连累其它订阅者
    }
  }
}

// 按行解析子进程 stdout
function onStdout(chunk: Buffer): void {
  stdoutBuf += chunk.toString('utf8')
  let idx: number
  while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, idx).replace(/\r$/, '').trim()
    stdoutBuf = stdoutBuf.slice(idx + 1)
    if (line) handleLine(line)
  }
}

function handleLine(line: string): void {
  const now = Date.now()

  if (line === 'hb' || line === 'ready') {
    lastHeartbeatAt = now
    if (lastError === HEARTBEAT_TIMEOUT_ERR) lastError = undefined
    return
  }
  if (line.startsWith('err ')) {
    lastError = '钩子脚本错误：' + line.slice(4)
    stopKeyboardHook(true)
    return
  }

  const p = line.split(' ')

  if (p[0] === 'lock-state') {
    const ms = Number(p[2])
    if (!Number.isFinite(ms) || ms < 0) return
    lockUntil = ms ? now + ms : 0
    lockKeys = ms ? p[3] : ''
    lastHeartbeatAt = now
    const request = requests.get(p[1])
    if (request) {
      requests.delete(p[1])
      clearTimeout(request.timer)
      request.done({ ok: true })
    }
    stopIfUnused()
    return
  }

  // 键盘：k d/u <vk> <scan> <ext>
  if (p[0] === 'k') {
    const action = p[1] === 'd' ? 'down' : p[1] === 'u' ? 'up' : null
    if (!action) return
    const vk = Number(p[2])
    if (!Number.isFinite(vk)) return
    const scan = Number(p[3])
    const extended = p[4] === '1'
    if (action === 'down') {
      if (pressed.has(vk)) return // 长按自动重复：已处于按下状态则不重复发 down
      pressed.add(vk)
    } else {
      pressed.delete(vk)
    }
    lastHeartbeatAt = now
    lastEventAt = now
    emit({
      kind: 'key',
      action,
      vk,
      scan: Number.isFinite(scan) ? scan : undefined,
      extended,
      ts: now
    })
    return
  }

  // 鼠标：m d/u <btn> 或 m w <delta>
  if (p[0] === 'm') {
    if (p[1] === 'w') {
      const delta = Number(p[2])
      lastHeartbeatAt = now
      lastEventAt = now
      emit({ kind: 'mouse', action: 'wheel', delta: Number.isFinite(delta) ? delta : 0, ts: now })
      return
    }
    const action = p[1] === 'd' ? 'down' : p[1] === 'u' ? 'up' : null
    if (!action) return
    const btn = p[2]
    if (btn !== 'l' && btn !== 'r' && btn !== 'm' && btn !== 'x1' && btn !== 'x2') return
    lastHeartbeatAt = now
    lastEventAt = now
    emit({ kind: 'mouse', action, button: btn, ts: now })
    return
  }
}

function clearWatchdog(): void {
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
}

function startWatchdog(): void {
  clearWatchdog()
  // 子进程还活着、却超过 8 秒没有任何心跳/事件 → 记一条诊断错误（不强杀，避免误伤）
  watchdog = setInterval(() => {
    if (!running) return
    if (lastHeartbeatAt && Date.now() - lastHeartbeatAt > 8000) {
      lastError = HEARTBEAT_TIMEOUT_ERR
    }
  }, 3000)
}

function attach(c: ChildProcess): void {
  c.stdout?.on('data', (d: Buffer) => { if (child === c) onStdout(d) })
  c.stderr?.on('data', (d: Buffer) => {
    if (child !== c) return
    // 记录首个报错片段（Add-Type 编译失败、缺权限等都会走这里），便于排查
    const t = String(d).trim()
    if (t) lastError = 'PowerShell: ' + t.slice(0, 300)
  })
  c.stdin?.on('error', () => {
    // 进程退出后往 stdin 写会触发 EPIPE：静默忽略，否则未捕获异常会崩主进程
  })
  c.on('exit', (code) => {
    // 只清自己的引用：旧进程退出事件晚于新 spawn 到达时，不能抹掉新进程引用
    if (child !== c) return
    child = null
    running = false
    pressed.clear()
    clearWatchdog()
    if (!manualStop) {
      const detail = lastError ? '：' + lastError : ''
      lastError = '键鼠钩子进程意外退出 (code=' + (code ?? 'unknown') + ')' + detail
    }
    finishRequests(lastError || '键鼠钩子已退出')
  })
  c.on('error', (err) => {
    if (child !== c) return
    child = null
    running = false
    pressed.clear()
    clearWatchdog()
    lastError = '键鼠钩子进程出错：' + err.message
    finishRequests(lastError)
  })
}

/** 启动全局键鼠监听。幂等：已在运行则直接返回成功。 */
export function startKeyboardHook(forDisplay = true): { ok: boolean; error?: string } {
  if (forDisplay) displayRequested = true
  if (child && child.exitCode === null) return { ok: true }

  manualStop = false
  lastError = undefined
  pressed.clear()
  stdoutBuf = ''

  let scriptPath: string
  try {
    scriptPath = path.join(app.getPath('userData'), 'keyboard-hook.ps1')
    // 加 UTF-8 BOM，保证 PowerShell 5.1 用 -File 读取时不误判编码（脚本含中文注释）
    fs.writeFileSync(scriptPath, '﻿' + KEYBOARD_HOOK_PS1, 'utf8')
  } catch (e) {
    lastError = '写入钩子脚本失败：' + (e as Error).message
    return { ok: false, error: lastError }
  }

  try {
    const c = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      // 把主进程 PID 交给脚本：客户端被强杀时脚本靠它秒退，不用等 stdin EOF
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ZL_PARENT_PID: String(process.pid) } }
    )
    child = c
    attach(c)
    running = true
    startedAt = Date.now()
    lastHeartbeatAt = Date.now()
    startWatchdog()
    return { ok: true }
  } catch (e) {
    running = false
    lastError = '启动键鼠钩子失败：' + (e as Error).message
    return { ok: false, error: lastError }
  }
}

/** 关闭显示监听；锁定动作尚未结束时保留钩子，强制退出则解除全部锁定。 */
export function stopKeyboardHook(force = false): void {
  displayRequested = false
  if (!force && (lockUntil || requests.size)) return
  manualStop = true
  finishRequests(lastError || '键鼠钩子已停止，锁定已解除')
  clearWatchdog()
  const c = child
  child = null
  running = false
  pressed.clear()
  if (!c || c.exitCode !== null) return

  // 首选优雅退出：写一行 quit，脚本收到即 Unhook + 退出
  try {
    c.stdin?.write('quit\n')
  } catch {
    // ignore
  }
  // 兜底：700ms 内没退就强杀；同时关掉 stdin 触发脚本侧 EOF 退出路径
  const killer = setTimeout(() => {
    try {
      c.kill()
    } catch {
      // ignore
    }
  }, 700)
  c.once('exit', () => clearTimeout(killer))
  try {
    c.stdin?.end()
  } catch {
    // ignore
  }
}

/** 查询当前状态。 */
export function keyboardHookState(): {
  running: boolean
  startedAt?: number
  lastEventAt?: number
  error?: string
  lock: { active: boolean; remainingMs: number; keys: string }
} {
  const remainingMs = Math.max(0, lockUntil - Date.now())
  return { running, startedAt, lastEventAt, error: lastError, lock: { active: remainingMs > 0, remainingMs, keys: lockKeys } }
}

/** 订阅键鼠事件，返回取消订阅函数。 */
export function onKeyHookEvent(handler: (e: KeyHookEvent) => void): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

// 退出前收尾，别把钩子进程留成孤儿
app.on('before-quit', () => {
  stopKeyboardHook(true)
})
