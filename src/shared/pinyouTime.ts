// 品游「时间类项目」→ 时间盲盒奖池（2026-09-07 用户：「关于时间类的我觉得他就应该自动
// 加载到时间规则里面」）。
//
// 为什么该进时间挂件而不是普通礼物规则：
//   主播素材里「虚拟主播时间」(61 视频/59 脚本)、「翻牌子时间」(57/56)、「加减播1-60分钟」(38/37)
//   这些项目，每个条目都是「一个视频 + 一句 加班加减:N」。而时间挂件的 TimeBlindBoxEvent
//   本来就长这样：op(加/减/乘/除) + value + video —— 触发时随机抽一个、播视频、改时间，
//   正是时间挂件的原生行为。塞进普通礼物规则反而绕了一圈，还配不出「一池随机抽」。
//
// 所以：一个时间类项目 = 一个盲盒奖池，项目里每个条目 = 池子里一个事件。
import type { TimeBlindBoxEvent } from './types'
import type { PinyouScriptCommand } from './pinyou'

/** 时间加减类命令：只有这些才算「时间项目」。count-* 是计数器，不算时间 */
const TIME_CMDS = new Set(['overtime-adjust', 'overtime-mul', 'overtime-div', 'countdown-adjust'])
/** 这些也是时间动作，但盲盒事件没有对应形态（清零），单独记下来 */
const TIME_CMDS_UNSUPPORTED = new Set(['overtime-clear', 'countdown-clear'])

export interface PinyouProjectEntry {
  /** 条目名（视频文件去掉扩展名），如「-10分」「翻牌子时间×2」 */
  name: string
  video: string
  /** 同名 .脚本 解析出来的动作；纯视频条目为空数组 */
  commands: PinyouScriptCommand[]
}

export interface TimeProjectPlan {
  /** 能变成盲盒事件的条目 */
  events: TimeBlindBoxEvent[]
  /** 进不了盲盒池的条目及原因（纯视频、只有清零、动作不是时间类…） */
  skipped: { name: string; why: string }[]
  /** 带时间动作的条目数 / 有脚本的条目数 —— 判断「是不是时间类项目」用 */
  timeItems: number
  scriptItems: number
}

function num(v: unknown): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  // 品游的范围写法「-100,100」：盲盒事件支持 value/value2，两端都取
  const n = Number(s.split(',')[0])
  return Number.isFinite(n) ? n : null
}

function rangeEnd(v: unknown): number | null {
  const parts = String(v ?? '').split(',')
  if (parts.length < 2) return null
  const n = Number(parts[1])
  return Number.isFinite(n) ? n : null
}

/** 一个条目 → 一个盲盒事件；映射不了返回原因 */
function entryToEvent(entry: PinyouProjectEntry, idPrefix: string, index: number): TimeBlindBoxEvent | string {
  const timeCmd = entry.commands.find((c) => TIME_CMDS.has(String(c.cmd)))
  if (!timeCmd) {
    if (entry.commands.some((c) => TIME_CMDS_UNSUPPORTED.has(String(c.cmd)))) return '只有「清零」，盲盒事件没有这种形态'
    if (!entry.commands.length) return '纯视频，没有时间动作'
    return '动作不是时间加减（' + entry.commands.map((c) => c.cmd).slice(0, 3).join('、') + '）'
  }
  const raw = num(timeCmd.param)
  if (raw == null) return '时间数值读不出来：' + String(timeCmd.param ?? '')
  const end = rangeEnd(timeCmd.param)

  let op: TimeBlindBoxEvent['op']
  let value = raw
  let value2 = end
  if (timeCmd.cmd === 'overtime-mul') {
    op = 'multiply'
  } else if (timeCmd.cmd === 'overtime-div') {
    op = 'divide'
    if (value === 0) return '除数是 0'
  } else {
    // 加减：品游用负数表示减少（加班加减:-2100 / 加班减少:600秒 都会解析成负值）。
    // 盲盒事件的 op 分 add/subtract，负值转成 subtract + 正数，界面上更好读。
    const negative = raw < 0 && (end == null || end <= 0)
    op = negative ? 'subtract' : 'add'
    if (negative) {
      value = Math.abs(raw)
      value2 = end == null ? null : Math.abs(end)
    }
  }
  if (value2 != null && value2 === value) value2 = null
  return {
    id: `${idPrefix}-${index + 1}`,
    name: entry.name.slice(0, 40),
    group: idPrefix,   // ★项目名 = 分组名：主播按项目整组开关、存成预设
    enabled: true,
    op,
    value,
    value2,
    video: entry.video,
    videoSeconds: 0 // 0 = 播完为止（盲盒事件不循环，连击时逐项播）
  }
}

/**
 * 把一个品游项目算成时间盲盒奖池。
 * idPrefix 建议用项目名的安全形式，保证同一项目重复导入时 id 稳定（不会越导越多）。
 */
export function planTimeProject(entries: PinyouProjectEntry[], idPrefix = 'py'): TimeProjectPlan {
  const events: TimeBlindBoxEvent[] = []
  const skipped: { name: string; why: string }[] = []
  let timeItems = 0
  let scriptItems = 0
  entries.forEach((entry, i) => {
    if (entry.commands.length) scriptItems += 1
    const r = entryToEvent(entry, idPrefix, i)
    if (typeof r === 'string') {
      skipped.push({ name: entry.name, why: r })
      return
    }
    timeItems += 1
    events.push(r)
  })
  return { events, skipped, timeItems, scriptItems }
}

/**
 * 这个项目算不算「时间类」——用来在导入界面自动给出去向。
 * 判据：有脚本的条目里，能变成时间事件的占一半以上，且至少有 2 个。
 * （「哈喽体力转盘」只有 1 个脚本且是播放视频，不该被当成时间项目）
 */
export function isTimeProject(plan: TimeProjectPlan): boolean {
  return plan.timeItems >= 2 && plan.timeItems * 2 >= plan.scriptItems
}
