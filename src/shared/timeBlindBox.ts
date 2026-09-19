import type { TimeBlindBoxEvent } from './types'

const ops = ['add', 'subtract', 'multiply', 'divide']
const actions = ['none', 'prank', 'effect']
const numeric = (value: unknown) => value == null || value === '' ? NaN : Number(value)

// 规范化保留无效条目供编辑器修正；执行前校验，不把错误的倍数偷偷换成 1。
export function normalizeTimeBlindBoxEvents(value: unknown): TimeBlindBoxEvent[] {
  return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object').map(item => ({
    id: String(item.id ?? '').trim(), name: String(item.name ?? '').trim(),
    group: String(item.group ?? '').trim(), enabled: item.enabled !== false,
    op: String(item.op ?? 'add') as TimeBlindBoxEvent['op'], value: numeric(item.value),
    value2: item.value2 == null || item.value2 === '' ? null : numeric(item.value2),
    video: String(item.video ?? '').trim(), videoSeconds: item.videoSeconds == null ? 0 : numeric(item.videoSeconds),
    sound: String(item.sound ?? '').trim(), soundVolume: item.soundVolume == null ? 100 : numeric(item.soundVolume),
    action: String(item.action ?? 'none') as TimeBlindBoxEvent['action'], actionParam: String(item.actionParam ?? '').trim()
  }))
}

export function validateTimeBlindBoxEvent(event: TimeBlindBoxEvent): string | null {
  if (!event.id || !event.name) return '请填写盲盒事件名称'
  if (!ops.includes(event.op)) return '请选择加、减、乘或除'
  const values = event.value2 == null ? [event.value] : [event.value, event.value2]
  if (values.some(value => !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return '运算数值无效或过大'
  if (values.some(value => value < 0)) return '请填写非负数，减时选择减号'
  if (event.op === 'divide' && values.some(value => value <= 0)) return '除数必须大于 0'
  if (event.videoSeconds != null && (!Number.isFinite(event.videoSeconds) || event.videoSeconds < 0 || event.videoSeconds > 2_147_483)) return '视频时长无效或过大'
  if (event.soundVolume != null && (!Number.isFinite(event.soundVolume) || event.soundVolume < 0 || event.soundVolume > 100)) return '音量应在 0～100 之间'
  if (!actions.includes(event.action || 'none')) return '请选择有效的附加事件'
  if (event.action && event.action !== 'none' && !event.actionParam?.trim()) return '请选择附加事件'
  return null
}

/**
 * 把选中的事件 id 解析成抽奖池。
 * skipDisabled=true 时跳过停用的事件（真触发走这条：项目开关关了就不该抽到它）；
 * 缺省 false 保留原行为，让「测试」按钮能试停用的事件。
 */
export function resolveTimeBlindBoxPool(
  events: TimeBlindBoxEvent[],
  ids: string[] | undefined,
  options?: { skipDisabled?: boolean }
): { ok: boolean; events?: TimeBlindBoxEvent[]; error?: string } {
  const chosen = [...new Set(Array.isArray(ids) ? ids : [])]
  if (!chosen.length) return { ok: false, error: '盲盒奖池为空，请选择参与抽奖的事件' }
  const pool: TimeBlindBoxEvent[] = []
  let disabled = 0
  for (const id of chosen) {
    const matches = events.filter(event => event.id === id)
    if (matches.length !== 1) return { ok: false, error: matches.length ? '事件编号重复，请重新保存事件' : '奖池中的事件已删除，请重新选择' }
    if (options?.skipDisabled && matches[0].enabled === false) { disabled += 1; continue }
    const error = validateTimeBlindBoxEvent(matches[0])
    if (error) return { ok: false, error: `「${matches[0].name || '未命名事件'}」：${error}` }
    pool.push({ ...matches[0] })
  }
  // 全被项目开关关掉了：说清是「停用」而不是「没选」，不然主播只会以为奖池坏了
  if (!pool.length) return { ok: false, error: disabled ? `奖池里 ${disabled} 个事件都停用了，去事件库把项目开关打开` : '盲盒奖池为空，请选择参与抽奖的事件' }
  return { ok: true, events: pool }
}

/** 事件库按项目分组一览（界面按组显示 + 组开关要用） */
export function blindBoxGroups(events: TimeBlindBoxEvent[]): { group: string; total: number; enabled: number }[] {
  const map = new Map<string, { total: number; enabled: number }>()
  for (const event of events) {
    const key = String(event.group || '').trim() || '未分组'
    const cur = map.get(key) || { total: 0, enabled: 0 }
    cur.total += 1
    if (event.enabled !== false) cur.enabled += 1
    map.set(key, cur)
  }
  return [...map].map(([group, v]) => ({ group, ...v }))
}

export function pickTimeBlindBoxValue(event: TimeBlindBoxEvent, random = Math.random): number {
  const error = validateTimeBlindBoxEvent(event)
  if (error) throw new Error(error)
  if (event.value2 == null || event.value === event.value2) return event.value
  const lo = Math.min(event.value, event.value2), hi = Math.max(event.value, event.value2)
  const draw = Math.max(0, Math.min(1 - Number.EPSILON, random()))
  if (Number.isInteger(lo) && Number.isInteger(hi)) {
    const span = hi - lo + 1
    if (!Number.isSafeInteger(span)) throw new Error('随机范围过大，请缩小范围')
    return lo + Math.floor(draw * span)
  }
  // 小数倍数按连续区间抽取，不截断成整数，也不会把正除数舍入为零。
  return lo + draw * (hi - lo)
}

export function applyTimeBlindBoxValue(before: number, event: TimeBlindBoxEvent, value: number, showNegative = false): number {
  const error = validateTimeBlindBoxEvent({ ...event, value, value2: null })
  if (error) throw new Error(error)
  if (!Number.isSafeInteger(before)) throw new Error('当前时间无效或过大')
  const next = event.op === 'multiply' ? before * value : event.op === 'divide' ? before / value : event.op === 'subtract' ? before - value : before + value
  const rounded = Math.round(next)
  if (!Number.isSafeInteger(rounded)) throw new Error('计算后的时间过大，本次未执行')
  return showNegative ? rounded : Math.max(0, rounded)
}

/**
 * 把导入的盲盒事件并进已有事件库。
 * 同一个项目重复导入不叠加：导入事件的 id 形如「<项目名>-<序号>」，
 * 按项目名前缀先清掉旧的那批，再整批放进来。
 */
export function mergeImportedBlindBoxEvents(
  existing: TimeBlindBoxEvent[],
  incoming: TimeBlindBoxEvent[]
): TimeBlindBoxEvent[] {
  const prefixes = [...new Set(incoming.map((e) => String(e?.id || '').replace(/-\d+$/, '')))].filter(Boolean)
  const list = Array.isArray(existing) ? existing : []
  const belongs = (e: TimeBlindBoxEvent, p: string) => String(e?.id || '').startsWith(p + '-')
  // 这个项目原来被整组关掉了，重新导入（比如加了新视频）不该悄悄把它打开
  const offBefore = new Set(
    prefixes.filter((p) => {
      const old = list.filter((e) => belongs(e, p))
      return old.length > 0 && old.every((e) => e.enabled === false)
    })
  )
  const kept = list.filter((e) => !prefixes.some((p) => belongs(e, p)))
  const merged = incoming.map((e) => {
    const p = prefixes.find((prefix) => belongs(e, prefix))
    return p && offBefore.has(p) ? { ...e, enabled: false } : e
  })
  return [...kept, ...merged]
}
