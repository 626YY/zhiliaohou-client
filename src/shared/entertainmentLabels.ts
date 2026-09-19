// 礼物规则动作的中文短标签：排队窗口、日志、规则列表共用一份，别在主进程和页面各写一套对不上。
import type { EntertainmentAction, EntertainmentCommandCmd, EntertainmentRule, EntertainmentSystemCmd } from './types'

export const SYSTEM_LABELS: Record<EntertainmentSystemCmd, string> = {
  shutdown: '自动关机',
  lock: '锁定屏幕',
  displayoff: '显示器息屏',
  kill: '结束进程'
}

export const COMMAND_LABELS: Record<EntertainmentCommandCmd, string> = {
  'countdown-adjust': '倒计时加减',
  'countdown-clear': '倒计时清零',
  'send-text': '发送文本',
  'paste-text': '粘贴文本',
  'run-file': '运行文件',
  kill: '结束进程',
  mouse: '鼠标操作',
  'video-play': '播放视频',
  'video-play-wait': '播放视频并等待结束',
  'video-random': '随机播放视频',
  'sound-random': '随机播放音效',
  'video-stop': '停止视频',
  'video-gif': '播放动图',
  mobile: '手游动作',
  'wheel-spin': '转盘抽奖',
  'nine-spin': '九宫格抽奖',
  'count-adjust': '计时加减',
  'count-clear': '计时清零',
  'count-mul': '计时乘以',
  'count-div': '计时除以',
  'overtime-adjust': '加班加减',
  'overtime-clear': '加班清零',
  'overtime-mul': '加班乘以',
  'overtime-div': '加班除以',
  'key-hold': '键盘按住',
  'key-lock': '锁定键盘 / 调整锁定时长',
  'key-unlock': '解锁键盘',
  'key-up': '弹起按键',
  'key-sequence': '按键序列',
  'script-sequence': '动作脚本',
  'random-script': '随机脚本',
  'project-random': '触发项目（文件夹）',
  'blindbox-open': '开时间盲盒'
}

function baseName(value?: string): string {
  const parts = String(value || '').split(/[/\\]/)
  return parts[parts.length - 1] || ''
}

const MOBILE_LABELS: Record<string, string> = {
  up: '自动抬头', down: '自动低头', turn: '原地转圈', turnfire: '原地转圈并开火',
  dance: '蹦迪-经典', dance2: '蹦迪-偷袭', fwd: '自动前进', back: '自动后退', lmove: '自动左移', rmove: '自动右移'
}
const MOUSE_LABELS: Record<string, string> = {
  'click-left': '左键单击', 'click-right': '右键单击', 'dblclick-left': '左键双击',
  'down-left': '左键按住', 'up-left': '左键弹起', 'down-right': '右键按住', 'up-right': '右键弹起', move: '移动'
}

/**
 * 一条规则「要做什么」的短描述，给排队窗口和列表用；多个动作用「 → 」连起来。
 * 这里故意不 import entertainmentActions：本文件被 tools 里的 .ts 直跑脚本引用，
 * 多一个运行时依赖就要带扩展名，得不偿失。附加动作在保存时已清洗过。
 */
export function ruleActionLabel(rule: EntertainmentRule): string {
  const actions: EntertainmentAction[] = [rule, ...(Array.isArray(rule.extraActions) ? rule.extraActions : [])]
  return actions.map(actionLabel).join(' → ')
}

/** 单个动作的短描述 */
export function actionLabel(rule: EntertainmentAction): string {
  switch (rule.actionType) {
    case 'key':
      return `按键 ${rule.keySeq || ''}`.trim()
    case 'script':
      return `脚本 ${baseName(rule.scriptPath)}`.trim()
    case 'sound':
      return `音效 ${baseName(rule.soundPath)}`.trim()
    case 'system':
      return rule.systemCmd ? SYSTEM_LABELS[rule.systemCmd] || rule.systemCmd : '系统动作'
    case 'command':
      if (rule.commandCmd === 'mobile') {
        const [action, duration] = (rule.commandParam || '').split('|')
        return `手游动作 ${MOBILE_LABELS[action] || action}${duration ? ` ${Number(duration) / 1000}秒` : ''}`.trim()
      }
      if (rule.commandCmd === 'mouse') {
        const [action, x, y] = (rule.commandParam || '').split('|')
        return `鼠标 ${MOUSE_LABELS[action] || action}${x && y ? `（${x}, ${y}）` : ''}`.trim()
      }
      if (rule.commandCmd === 'script-sequence') {
        let steps = 0
        try { const arr = JSON.parse(rule.commandParam || '[]'); steps = Array.isArray(arr) ? arr.length : 0 } catch { steps = 0 }
        return `动作脚本（${steps} 步）`
      }
      if (rule.commandCmd === 'video-play' || rule.commandCmd === 'video-gif') {
        const v = splitVideoParam(rule.commandParam)
        const secs = Number(v.seconds)
        const where = v.target ? ` →${v.target === '视频' ? '视频窗口' : v.target}` : ''
        return `${COMMAND_LABELS[rule.commandCmd] || rule.commandCmd} ${baseName(v.path)}${Number.isFinite(secs) && secs > 0 ? ` 最多${secs}秒` : v.target === '视频' && v.seconds === undefined ? ' 循环' : ' 播完结束'}${where}`.trim()
      }
      return `${rule.commandCmd ? COMMAND_LABELS[rule.commandCmd] || rule.commandCmd : '动作命令'}${rule.commandParam ? ' ' + rule.commandParam : ''}`
    case 'obs':
      return rule.obsAction === 'scene'
        ? `OBS 切场景 ${rule.obsScene || ''}`.trim()
        : `OBS ${OBS_ACTION_LABELS[rule.obsAction || 'filter-toggle']} ${rule.obsFilter || ''}${rule.obsAction === 'filter-flash' && rule.obsSeconds ? ` ${rule.obsSeconds}秒` : ''}`.trim()
    default:
      return '动作'
  }
}

export const OBS_ACTION_LABELS: Record<NonNullable<EntertainmentRule['obsAction']>, string> = {
  'filter-on': '开滤镜',
  'filter-off': '关滤镜',
  'filter-toggle': '切换滤镜',
  'filter-flash': '滤镜亮几秒',
  scene: '切场景'
}

/** 视频/动图命令参数「路径|秒数」拆合：默认绿幕整段播完结束；独立视频窗口秒数为空才循环播放；品游导入的一次性视频带着秒数，编辑器改文件时必须保留 */
/** 尾部还可带「|绿幕N / |视频」选播到哪里；不写 = 默认窗口（跟随设置页的默认播放窗口） */
export function splitVideoParam(param?: string): { path: string; seconds?: string; target?: string; overflow?: boolean } {
  let s = String(param ?? '')
  let target: string | undefined
  let overflow: boolean | undefined
  // 尾缀：绿幕N / 绿幕N固定 / 固定 / 视频（固定 = 只在那个窗口排队，不去别的窗口）
  const tm = /^(.*?)\s*\|\s*(绿幕\s*[1-4]|视频|固定)(固定)?$/.exec(s)
  if (tm) {
    s = tm[1].trim()
    const head = tm[2].replace(/\s+/g, '')
    // 只有「固定」（不去别的窗口）才带 overflow 键；默认允许去别的窗口时不带，老调用方按「没有这个键」判断
    if (head === '固定') overflow = false
    else { target = head; if (head !== '视频' && tm[3]) overflow = false }
  }
  // 不带后缀时不返回 target 键（调用方按「没有这个键」判断没选窗口）
  const base = ((): { path: string; seconds?: string } => {
    const bar = s.lastIndexOf('|')
    if (bar >= 0) {
      const secs = s.slice(bar + 1).trim()
      if (/^\d*\.?\d*$/.test(secs) && /\d/.test(secs)) return { path: s.slice(0, bar), seconds: secs }
    }
    return { path: s }
  })()
  return { ...base, ...(target ? { target } : {}), ...(overflow === undefined ? {} : { overflow }) }
}
export function joinVideoParam(path: string, seconds?: string, target?: string, overflow = true): string {
  const secs = String(seconds ?? '').trim()
  let out = /^\d*\.?\d*$/.test(secs) && /\d/.test(secs) ? `${path}|${secs}` : path
  if (target === '视频') out = `${out}|视频`
  else if (target && /^绿幕[1-4]$/.test(target)) out = `${out}|${target}${overflow ? '' : '固定'}`
  else if (!overflow) out = `${out}|固定`
  return out
}
