// 一条礼物规则可以带多个动作：主动作的字段直接放在规则上（老数据兼容），附加动作放 extraActions。
// 这里是主进程执行、页面测试触发、标签拼接共用的「把规则拆成动作列表」逻辑，别各写一套。
import type { EntertainmentAction, EntertainmentActionType, EntertainmentRule } from './types'

export const ACTION_TYPES: readonly EntertainmentActionType[] = ['key', 'script', 'sound', 'system', 'command', 'obs']

// 动作字段清单：从规则上抠主动作、清洗导入/IPC 来的附加动作都用这一份
const ACTION_KEYS = [
  'actionType',
  'keySeq',
  'scriptPath',
  'soundPath',
  'soundMode',
  'soundVolume',
  'systemCmd',
  'systemParam',
  'commandCmd',
  'commandParam',
  'obsAction',
  'obsSource',
  'obsFilter',
  'obsScene',
  'obsSeconds',
  'delayMs',
  // 内置绿幕抠图开关：★漏在清单外会被静默丢掉（2026-09-10 第一次加时就是漏在这儿）
  'chroma'
] as const

// 附加动作条数上限：只防导入的垃圾数据把规则文件撑爆，正常人用不到这么多
export const MAX_EXTRA_ACTIONS = 100

export function actionDelayMs(action: EntertainmentAction | undefined): number {
  return Math.max(0, Math.trunc(Number(action?.delayMs) || 0))
}

/**
 * 补上「界面显示的默认值」：选了动作类型却没动过下拉框时，界面上显示的是第一项，
 * 但字段是空的，存下来的规则什么都不执行。保存/导入时统一补成界面显示的那一项。
 */
export function withActionDefaults<T extends EntertainmentAction>(action: T): T {
  const out = { ...action }
  if (out.actionType === 'command' && !out.commandCmd) out.commandCmd = 'countdown-adjust'
  if (out.actionType === 'system' && !out.systemCmd) out.systemCmd = 'shutdown'
  if (out.actionType === 'obs' && !out.obsAction) out.obsAction = 'filter-toggle'
  // 特色整蛊：界面上玩法下拉默认显示第一个（锁链特效），没动过就存成它
  if (out.actionType === 'command' && out.commandCmd === 'special-play' && !String(out.commandParam || '').trim()) out.commandParam = 'chain_challenge|add|1'
  return out
}

/** 规则上的主动作（只带动作字段，不带礼物名/阈值那些） */
export function primaryAction(rule: EntertainmentRule): EntertainmentAction {
  const out: Record<string, unknown> = {}
  for (const key of ACTION_KEYS) if (rule[key] !== undefined) out[key] = rule[key]
  return out as unknown as EntertainmentAction
}

/** 清洗附加动作：只留认识的字段、动作类型必须合法、延迟取非负整数毫秒 */
export function normalizeExtraActions(input: unknown): EntertainmentAction[] {
  if (!Array.isArray(input)) return []
  const out: EntertainmentAction[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const src = raw as Record<string, unknown>
    if (!ACTION_TYPES.includes(src.actionType as EntertainmentActionType)) continue
    const clean: Record<string, unknown> = {}
    for (const key of ACTION_KEYS) if (src[key] !== undefined && src[key] !== null) clean[key] = src[key]
    clean.delayMs = Math.max(0, Math.trunc(Number(src.delayMs) || 0))
    out.push(withActionDefaults(clean as unknown as EntertainmentAction))
    if (out.length >= MAX_EXTRA_ACTIONS) break
  }
  return out
}

/** 一条规则触发时要依次执行的全部动作：主动作在前，附加动作按保存顺序在后 */
export function ruleActions(rule: EntertainmentRule): EntertainmentAction[] {
  return [primaryAction(rule), ...normalizeExtraActions(rule.extraActions)]
}

export function hasExtraActions(rule: EntertainmentRule): boolean {
  return Array.isArray(rule.extraActions) && rule.extraActions.length > 0
}
