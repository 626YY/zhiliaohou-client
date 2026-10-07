// PowerShell 小动作的排队执行器（按键 / 鼠标 / 发文本 / 系统动作 / 按住弹起）。
// 以前每个动作直接 spawn 一个新 PowerShell、谁也不等谁：观众一次刷 99 个礼物，「立即执行」那 30 份同时冒出 30 个
// PowerShell（每个几十 MB、启动吃满一个核，按住类还要现编 C#），主播电脑（游戏 + 直播伴侣 + 我们）内存一紧，
// 先撞上分配失败的往往就是整蛊台的页面 / GPU 进程 —— 整个程序闪退（2026-10-07 用户：「尽量不要崩」）。
// 现在：同一时间最多 3 个短动作、4 个按住类在跑，其余按先来后到排队（一份不丢，只是晚一点点），
// 每个进程都挂 error 监听（spawn 失败是异步 error 事件，不挂会变成主进程未捕获异常），跑太久的强制结束。
import { spawn, type ChildProcess } from 'child_process'
import { logLine } from './crash-log'

type Lane = 'short' | 'long'
interface Job { script: string; timeoutMs: number }

const LIMIT: Record<Lane, number> = { short: 3, long: 4 }
const queues: Record<Lane, Job[]> = { short: [], long: [] }
const running: Record<Lane, number> = { short: 0, long: 0 }
let warnedAt = 0

/**
 * 排队跑一段 PowerShell（隐藏窗口、不读输出）。long = 按住这种要跑很久的，走单独的道，不占短动作的位置。
 * timeoutMs：超过就强制结束（按住类按 时长 + 余量 传进来）。
 */
export function runPowerShell(script: string, opts: { long?: boolean; timeoutMs?: number } = {}): void {
  const lane: Lane = opts.long ? 'long' : 'short'
  queues[lane].push({ script, timeoutMs: Math.max(1000, opts.timeoutMs ?? 15_000) })
  const waiting = queues[lane].length
  if (waiting > 200 && Date.now() - warnedAt > 60_000) {
    warnedAt = Date.now()
    logLine('ps-runner', `按键 / 鼠标类动作排了 ${waiting} 条（礼物来得比电脑能按的快），按顺序慢慢执行，一条不丢`)
  }
  pump(lane)
}

function pump(lane: Lane): void {
  while (running[lane] < LIMIT[lane] && queues[lane].length) {
    const job = queues[lane].shift()!
    running[lane]++
    start(lane, job)
  }
}

function start(lane: Lane, job: Job): void {
  let child: ChildProcess | null = null
  let finished = false
  const done = (): void => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    running[lane]--
    // 让出一拍再起下一个，连击时不至于一口气把 CPU 吃满
    setImmediate(() => pump(lane))
  }
  const timer = setTimeout(() => {
    try { child?.kill() } catch { /* 已经退了 */ }
    done()
  }, job.timeoutMs)
  try {
    child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', job.script], { windowsHide: true, stdio: 'ignore' })
    child.on('error', (e) => {
      logLine('ps-runner', `PowerShell 没起来：${e?.message || e}`)
      done()
    })
    child.on('exit', done)
  } catch (e) {
    logLine('ps-runner', `PowerShell 没起来：${e instanceof Error ? e.message : String(e)}`)
    done()
  }
}

/** 给自检 / 测试看：现在各道上跑着几个、排着几个 */
export function powerShellQueueState(): { short: { running: number; waiting: number }; long: { running: number; waiting: number } } {
  return {
    short: { running: running.short, waiting: queues.short.length },
    long: { running: running.long, waiting: queues.long.length }
  }
}
