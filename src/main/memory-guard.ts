// 内存告急自动降级：Windows 没有「挑进程杀」的机制，系统内存用光时谁正在申请内存谁就分配失败，
// 而 Chromium 分配失败是立刻自我终止（不弹窗）。我们的页面 / GPU 进程每条视频、每个动画都在申请释放，
// 主播机器（游戏 + 直播伴侣 + 声卡 + 我们）快满时最先撞上的大概率是我们 —— 隔壁主播「别的程序不崩只有整蛊台崩」。
// 这里的原则：宁可少播一条视频，也不能整个程序没了。
//   每 15 秒看系统剩余内存（含页面文件剩余）：
//     · 低于「吃紧线」：记日志 + 连接器面板提示（每 5 分钟最多一次），不动行为；
//     · 低于「告急线」：排队的绿幕视频停着不播、礼物规则新来的视频只排队不开播（★一条不丢，用户 2026-09-19：礼物触发不能被吞）、连接器面板说明原因；
//     · 回到吃紧线以上：自动解除。两条线在设置页可调（默认 800MB / 400MB），总开关可关。
import { app } from 'electron'
import { getSettings } from './settings'
import { logLine } from './crash-log'

export type MemoryLevel = 'normal' | 'tight' | 'critical'
const CHECK_MS = 15_000
const REMIND_MS = 5 * 60_000
let level: MemoryLevel = 'normal'
let lastRemindAt = 0
let timer: ReturnType<typeof setInterval> | null = null
let dropped = 0
let onCritical: (() => number) | null = null
let onRecover: (() => void) | null = null
let notify: ((level: 'warn' | 'info', text: string) => void) | null = null

export function memoryLevel(): MemoryLevel {
  return level
}

/** 告急 / 恢复时要做的事由业务模块登记：onCritical 返回当前排着的条数（只停不丢），onRecover 把排队的接着播；提示由连接器面板登记。 */
export function registerMemoryGuardHooks(hooks: { onCritical?: () => number; onRecover?: () => void; notify?: (level: 'warn' | 'info', text: string) => void }): void {
  if (hooks.onCritical) onCritical = hooks.onCritical
  if (hooks.onRecover) onRecover = hooks.onRecover
  if (hooks.notify) notify = hooks.notify
}

/** 告急中：新来的自动视频只排队不开播（礼物一条不丢），回落后按顺序补播。 */
export function memoryHold(): boolean {
  if (level === 'critical') dropped++
  return level === 'critical'
}

function thresholds(): { tight: number; critical: number; enabled: boolean } {
  const s = getSettings()
  const tight = Math.max(200, Math.min(8000, Number(s.memoryTightMb) || 800))
  const critical = Math.max(100, Math.min(tight - 50, Number(s.memoryCriticalMb) || 400))
  return { tight, critical, enabled: s.memoryGuard !== false }
}

/** 系统可用内存（MB）：物理剩余 + 页面文件剩余的一半（页面文件慢但能救命，只算一半别太乐观）。 */
export function availableMemoryMb(): { free: number; swapFree: number; available: number } {
  try {
    const info = process.getSystemMemoryInfo()
    const free = Math.round(info.free / 1024)
    const swapFree = Math.round((info.swapFree || 0) / 1024)
    return { free, swapFree, available: free + Math.round(swapFree / 2) }
  } catch {
    return { free: -1, swapFree: -1, available: -1 }
  }
}

function tick(): void {
  const t = thresholds()
  if (!t.enabled) { if (level !== 'normal') { level = 'normal'; logLine('memory', '内存守卫已在设置里关闭，解除降级') } return }
  const m = availableMemoryMb()
  if (m.available < 0) return
  const next: MemoryLevel = m.available < t.critical ? 'critical' : m.available < t.tight ? 'tight' : 'normal'
  const now = Date.now()
  if (next !== level) {
    const prev = level
    level = next
    if (next === 'critical') {
      const cleared = (() => { try { return onCritical?.() ?? 0 } catch { return 0 } })()
      const msg = `系统内存告急：剩余 ${m.free}MB（页面文件剩余 ${m.swapFree}MB）。排队中的 ${cleared} 条和新来的自动视频先停着不播（一条不丢），手动操作不受影响；回落后按顺序补播`
      logLine('memory', msg)
      notify?.('warn', msg)
      lastRemindAt = now
    } else if (next === 'tight') {
      const msg = `系统内存吃紧：剩余 ${m.free}MB（页面文件剩余 ${m.swapFree}MB）。建议关掉不用的程序或挂件；低于 ${t.critical}MB 会自动暂停新视频`
      logLine('memory', msg)
      if (now - lastRemindAt > REMIND_MS) { notify?.('warn', msg); lastRemindAt = now }
    } else {
      const msg = `系统内存恢复：剩余 ${m.free}MB，${prev === 'critical' ? `降级解除（期间攒下 ${dropped} 条自动视频，现在按顺序补播）` : '吃紧解除'}`
      logLine('memory', msg)
      if (prev === 'critical') { notify?.('info', msg); try { onRecover?.() } catch { /* 补播失败不影响守卫 */ } }
      dropped = 0
    }
  } else if (next !== 'normal' && now - lastRemindAt > REMIND_MS) {
    lastRemindAt = now
    logLine('memory', `系统内存${next === 'critical' ? '仍告急' : '仍吃紧'}：剩余 ${m.free}MB`)
  }
}

export function startMemoryGuard(): void {
  if (timer) return
  const t = thresholds()
  const m = availableMemoryMb()
  logLine('memory', `内存守卫${t.enabled ? '已启动' : '已关闭'}：吃紧线 ${t.tight}MB / 告急线 ${t.critical}MB，当前剩余 ${m.free}MB（页面文件剩余 ${m.swapFree}MB${m.swapFree === 0 ? '，页面文件关着：可用额度只有物理内存，建议开启' : ''}）`)
  timer = setInterval(tick, CHECK_MS)
  app.on('before-quit', () => { if (timer) clearInterval(timer); timer = null })
}

/** 测试用：直接按给定的「可用 MB」跑一次判定（不用真把机器内存耗光）。 */
export function memoryGuardProbe(availableMb: number): MemoryLevel {
  {
    const t = thresholds()
    if (!t.enabled) { level = 'normal'; return level }
    const next: MemoryLevel = availableMb < t.critical ? 'critical' : availableMb < t.tight ? 'tight' : 'normal'
    if (next !== level) {
      level = next
      if (next === 'critical') { const held = onCritical?.() ?? 0; const msg = `[探针] 系统内存告急：可用 ${availableMb}MB，排队中的 ${held} 条先停着不播`; logLine('memory', msg); notify?.('warn', msg) }
      else if (next === 'normal') { logLine('memory', `[探针] 系统内存恢复：可用 ${availableMb}MB，降级解除（期间攒下 ${dropped} 条自动视频，现在按顺序补播）`); dropped = 0; try { onRecover?.() } catch { /* */ } }
      else logLine('memory', `[探针] 系统内存吃紧：可用 ${availableMb}MB`)
    }
    return level
  }
}
