// 导入「品游娱乐助手Pro」（易语言写的老牌整蛊工具，主播圈叫它「品游」）的礼物触发配置。
//
// 依据：原版 9.71 的解包字符串（F:\知了猴工作室\Tmp\unpack\dump\strings_gbk.txt，0x158f9e6 / 0x1590fff / 0x1591ddf 三份内置示例方案，
// 以及它「执行功能」下拉的全表：
//   PC：正常按键,快速按键,强化按键,按住按键,同时按多个键,同时长按多键,鼠标单击,鼠标长按,鼠标左移,鼠标右移,鼠标点击坐标,鼠标点击多点坐标,
//       鼠标双击坐标,鼠标长按坐标,拖动A点到B点,点击A再长按B,点击A再拖动B到C,锁定键盘鼠标,锁定键盘,锁定WSAD,锁定鼠标
//   手游：自动抬头,自动低头,原地转圈圈,原地转圈+开火,蹦迪-左右探头（Q-E）,蹦迪-经典动作,蹦迪-恐龙扛狼,蹦迪-偷袭,自动前进（W）,自动后退（S）,
//         自动左移（A）,自动右移（D）,自动跳跃（空格）,自动下蹲（Ctrl）,自动下蹲（C）,自动丢枪（G）,自动趴下（Z）,自动钩锁（Q+左键）,退出（CF房间）,退出（CSGO）,大退（Alt+F4）
//   分发函数 0x4400b6 还认：播放音效/键盘弹起/键盘锁定/键盘解锁/解锁WSAD/鼠标锁定/鼠标解锁/播放视频/播放动图/停止视频/结束程序/自动关机/锁定屏幕/显示器息屏/
//         加班加减·乘以·除以·清零·增加·减少/计数加减·清零/倒计时加减·清零/转盘抽奖/高级转盘/发送文本/粘贴文本/OBS滤镜/OBS特效/OnlyClimb/PVZ命令/动作命令/物理脚本）
// 和它「导出配置」的文件名规则（品游配置_<方案>.py，素材在同级的 品游素材_<方案>\音效|视频|脚本）。格式是一个 JSON 对象：
//   键   = 礼物名（也可能是「关注触发」「点赞触发(1000)」「〖弹幕关键词〗」「2个加油鸭」这类特殊触发）
//   值   = { "动作": {...}, "视频": {...}, "物理": {...} }，一个礼物可以同时挂几类
//   动作 = 触发内容 / 触发类型 / 动作分类(键鼠·脚本·音效…) / 执行功能 / 执行脚本 / 功能代码(键名，如 M、F3、Ctrl+A；坐标 "80%,66%")
//          / 次数时间("1次"、"3秒"、"中等") / 音效文件 / 优先等级("0"、"插队"、"即时") / 执行次数 / 执行倍数("真"/"假")
//   视频 = 视频目录 / 视频文件("随机播放"=整个目录随机) / 视频位置 / 视频时间 / 视频加速 / 预播文件 / 执行脚本
// 易语言默认 GBK，所以文件解码要先试 UTF-8 再退 GBK（在主进程做）。
// 这里只做纯转换，不碰 electron / fs（主进程可以传一个 exists 回调进来查文件在不在），方便单测。
import type { EntertainmentCommandCmd, EntertainmentRule, PinyouPlan, PinyouRuleNote, PinyouSkipped } from './types'

/** 原软件目录里的素材根目录（绝对路径，找不到就不填，音效/视频只留文件名给主播自己补） */
export interface PinyouAssetRoots {
  /** 品游安装目录（或导出的 品游素材_xxx 目录） */
  root?: string
  sounds?: string
  videos?: string
  scripts?: string
  /** 主进程读取到的 .脚本 文本；键为文件名（兼容大小写和相对路径）。 */
  scriptContents?: Record<string, string>
  /** 主进程传入的「文件/目录在不在」检查；没有就不检查 */
  exists?: (absPath: string) => boolean
}

export interface PinyouScriptCommand {
  cmd: EntertainmentCommandCmd | 'delay'
  param?: string
}

export interface PinyouScriptParseResult {
  commands: PinyouScriptCommand[]
  unknown: string[]
}

/** 转换时用到的默认值与上限；只做防爆夹紧，不改原软件语义 */
export const PINYOU_DEFAULTS = {
  /** 「键盘按住」「自动下蹲（Ctrl）」这类没写时长时按住多久（毫秒） */
  holdMs: 1000,
  /** 原软件「键盘操作:锁定WSAD」不带时长（靠后面的解锁收尾），客户端锁键盘必须给时长，兜这个值 */
  lockMs: 5000,
  /** 「鼠标长按坐标」「点击A再长按B」没写时长时按住多久（毫秒） */
  mouseHoldMs: 1000,
  /** 拖动 / 多点点击 每一步之间的间隔（毫秒） */
  stepDelayMs: 100,
  /** 执行次数 × 次数时间(N次) 的乘积上限 */
  maxRepeat: 1000,
  /** 「蹦迪-左右探头（Q-E）」敲的键序列 */
  leanKeys: 'qeqe',
  /** 原软件速度下拉 → 按住时长（毫秒） */
  speedPresets: [
    [/^(快速|快|fast)$/, 500],
    [/^(中等|中速|普通|medium|normal)$/, 1000],
    [/^(慢速|慢|较慢|slow)$/, 2000],
    [/^(很慢|超慢|veryslow)$/, 3000]
  ] as [RegExp, number][]
}

type Dict = Record<string, unknown>

const isObj = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string => (v == null ? '' : String(v)).trim()

// ---------- 从任意文本里抠出顶层 JSON 对象（导出的 .py 可能前后夹着别的东西） ----------
export function extractJsonObjects(text: string): string[] {
  const starts: number[] = []
  const candidates: { start: number; end: number }[] = []
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') {
      starts.push(i)
    } else if (ch === '}') {
      const start = starts.pop()
      if (start !== undefined) candidates.push({ start, end: i + 1 })
    }
  }
  // 先试包含子对象的最长候选；前导残缺大括号不妨碍后面的完整表。
  // 成功后跳过它的子对象，避免一张包装表被重复导入。
  const out: string[] = []
  let acceptedEnd = -1
  for (const { start, end } of candidates.sort((a, b) => a.start - b.start)) {
    if (start < acceptedEnd) continue
    const candidate = text.slice(start, end)
    try {
      JSON.parse(candidate)
      out.push(candidate)
      acceptedEnd = end
    } catch { /* 外层不是 JSON，继续尝试其内部的完整候选 */ }
  }
  return out
}

// ---------- 判断一个对象是不是「礼物表」 ----------
const CATEGORY_KEYS = ['动作', '视频', '物理', '音效', '特效', '脚本']
const FIELD_KEYS = ['触发内容', '执行功能', '功能代码', '视频文件', '视频目录', '音效文件', '动作分类', '执行脚本']

function looksLikeGiftEntry(v: unknown): boolean {
  if (!isObj(v)) return false
  return CATEGORY_KEYS.some((k) => {
    const data = v[k]
    return isObj(data) && (Object.keys(data).length === 0 || k === '物理' ||
      Object.keys(data).some((field) => FIELD_KEYS.includes(field)))
  })
}

/** 找出包装对象/数组中的全部礼物表，单个条目和全局设置不算表。 */
export function findGiftTables(v: unknown, depth = 0): Dict[] {
  if ((!isObj(v) && !Array.isArray(v)) || depth > 8) return []
  const entries = Object.entries(v).filter(([key]) => !/^(全局设置|全局配置|设置|settings|options)$/i.test(key))
  const vals = entries.map(([, value]) => value)
  const hits = vals.filter(looksLikeGiftEntry).length
  const empties = vals.filter((x) => isObj(x) && Object.keys(x).length === 0).length
  const nested = entries.filter(([, child]) => !looksLikeGiftEntry(child))
    .map(([key, child]) => ({ key, tables: findGiftTables(child, depth + 1) }))
    .filter(({ tables }) => tables.length > 0)
  const nestedTables = nested.flatMap(({ tables }) => tables)
  if (isObj(v) && hits > 0 && hits + empties >= Math.ceil(vals.length * 0.5)) {
    // 有些导出把默认礼物表与其余方案放在同一层，不能认出默认表就漏掉其余方案。
    const nestedKeys = new Set(nested.map(({ key }) => key))
    return [Object.fromEntries(entries.filter(([key]) => !nestedKeys.has(key))), ...nestedTables]
  }
  return nestedTables
}

/** 保留单表调用接口；文件导入使用 findGiftTables，避免遗漏其余方案。 */
export function findGiftTable(v: unknown, depth = 0): Dict | null {
  return findGiftTables(v, depth)[0] ?? null
}

// ---------- 键名 → SendKeys ----------
const KEY_TOKEN: Record<string, string> = {
  空格: ' ',
  SPACE: ' ',
  ESC: '{ESC}',
  ESCAPE: '{ESC}',
  TAB: '{TAB}',
  ENTER: '{ENTER}',
  回车: '{ENTER}',
  BACK: '{BACKSPACE}',
  BACKSPACE: '{BACKSPACE}',
  CAPS: '{CAPSLOCK}',
  CAPSLOCK: '{CAPSLOCK}',
  PAUSE: '{BREAK}',
  HOME: '{HOME}',
  END: '{END}',
  INS: '{INSERT}',
  INSERT: '{INSERT}',
  DEL: '{DELETE}',
  DELETE: '{DELETE}',
  PGUP: '{PGUP}',
  PAGEUP: '{PGUP}',
  PGDN: '{PGDN}',
  PAGEDOWN: '{PGDN}',
  '←': '{LEFT}',
  '→': '{RIGHT}',
  '↑': '{UP}',
  '↓': '{DOWN}',
  LEFT: '{LEFT}',
  RIGHT: '{RIGHT}',
  UP: '{UP}',
  DOWN: '{DOWN}',
  '～': '`',
  '小/': '{DIVIDE}',
  '小*': '{MULTIPLY}',
  '小+': '{ADD}',
  '小-': '{SUBTRACT}',
  '小.': '{DECIMAL}',
  PRTSC: '{PRTSC}',
  SCROLL: '{SCROLLLOCK}',
  NUM: '{NUMLOCK}'
}
const MODIFIER: Record<string, string> = {
  CTRL: '^', 左CTRL: '^', 右CTRL: '^', CONTROL: '^',
  ALT: '%', 左ALT: '%', 右ALT: '%',
  SHIFT: '+', 左SHIFT: '+', 右SHIFT: '+'
}
const SENDKEYS_SPECIAL = new Set(['+', '^', '%', '~', '(', ')', '{', '}', '[', ']'])

function normKey(raw: string): string {
  return raw.trim().toUpperCase()
}

/** 单个键名 → SendKeys 片段；认不出返回 null */
export function keyToSendKeys(raw: string): string | null {
  const k = normKey(raw)
  if (!k) return null
  if (KEY_TOKEN[k]) return KEY_TOKEN[k]
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return `{${k}}`
  if (/^小[0-9]$/.test(k)) return k.slice(1)
  if (k.length === 1 && /^[\x21-\x7e]$/.test(k)) {
    if (SENDKEYS_SPECIAL.has(k)) return `{${k}}`
    return k.toLowerCase()
  }
  return null
}

/** 「Ctrl+A」「Ctrl+Shift+X」「Alt+F4」「M」→ SendKeys 序列；Win 键 SendKeys 发不了 */
export function comboToSendKeys(code: string): { seq: string | null; reason?: string } {
  const c = code.trim()
  if (!c) return { seq: null, reason: '功能代码为空' }
  // 结尾的「+」是键本身（如 Ctrl++），不是分隔符
  let parts = c.split('+')
  if (c.endsWith('+')) {
    parts = c.slice(0, -1).split('+')
    parts.push('+')
  }
  parts = parts.map((p) => p.trim()).filter(Boolean)
  let mods = ''
  const keys: string[] = []
  for (const p of parts) {
    const u = normKey(p)
    if (MODIFIER[u]) {
      mods += MODIFIER[u]
      continue
    }
    if (u === 'WIN' || u === '左WIN' || u === '右WIN') return { seq: null, reason: 'Win 键组合键客户端发不了' }
    const t = keyToSendKeys(p)
    if (t == null) return { seq: null, reason: `不认识的键名「${p}」` }
    keys.push(t)
  }
  if (keys.length === 0) {
    if (mods) return { seq: null, reason: '只有修饰键（Ctrl/Alt/Shift）没有主键，客户端不能单独敲修饰键；要按住请用「键盘按住」' }
    return { seq: null, reason: '功能代码为空' }
  }
  if (keys.length === 1) return { seq: mods + keys[0] }
  return { seq: mods ? `${mods}(${keys.join('')})` : keys.join('') }
}

/** 键名 → 「键盘按住」认的名字（主进程 HOLD_VK 表） */
export function keyToHoldName(raw: string): string | null {
  const k = normKey(raw)
  if (!k) return null
  const MAP: Record<string, string> = {
    空格: 'SPACE', SPACE: 'SPACE', ESC: 'ESC', ESCAPE: 'ESC', 回车: 'ENTER', ENTER: 'ENTER', BACK: 'BACKSPACE', BACKSPACE: 'BACKSPACE', CAPS: 'CAPSLOCK', CAPSLOCK: 'CAPSLOCK',
    CTRL: 'CTRL', CONTROL: 'CTRL', SHIFT: 'SHIFT', ALT: 'ALT',
    INS: 'INSERT', DEL: 'DELETE', PGUP: 'PAGEUP', PGDN: 'PAGEDOWN',
    '←': 'LEFT', '→': 'RIGHT', '↑': 'UP', '↓': 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', UP: 'UP', DOWN: 'DOWN', 左: 'LEFT', 右: 'RIGHT', 上: 'UP', 下: 'DOWN',
    左CTRL: 'CTRL', 右CTRL: 'CTRL', 左ALT: 'ALT', 右ALT: 'ALT', 左SHIFT: 'SHIFT', 右SHIFT: 'SHIFT'
  }
  if (MAP[k]) return MAP[k]
  if (/^小[0-9]$/.test(k)) return `NUM${k.slice(1)}`
  if (/^(SPACE|ENTER|TAB|ESC|SHIFT|CTRL|ALT|CAPSLOCK|BACKSPACE|LEFT|UP|RIGHT|DOWN|INSERT|DELETE|HOME|END|PAGEUP|PAGEDOWN|F([1-9]|1[0-9]|2[0-4])|[A-Z0-9])$/.test(k)) return k
  return null
}

// ---------- 小解析 ----------
/** "3秒"→3000ms，"0.5秒"→500，"1次"→null（不是时长），纯数字按秒 */
function parseSeconds(v: string): number | null {
  const s = v.replace(/\s/g, '')
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)(秒|s|S|毫秒|ms)?$/)
  if (!m) return null
  const n = Number(m[1])
  if (!isFinite(n)) return null
  return m[2] === '毫秒' || m[2] === 'ms' ? Math.round(n) : Math.round(n * 1000)
}

/** 原软件动作面板的速度下拉不是数字；换成稳定的按住时长。 */
function parseActionDuration(v: string): number | null {
  const numeric = parseSeconds(v)
  if (numeric != null) return numeric
  const s = v.replace(/\s/g, '').toLowerCase()
  if (!s || /^(自动|默认|none|无)$/.test(s)) return null
  const preset = PINYOU_DEFAULTS.speedPresets.find(([re]) => re.test(s))
  return preset ? preset[1] : null
}

/** 「1次」「3次」→ 次数；其他（时长）返回 null */
function parseTimes(v: string): number | null {
  const m = v.replace(/\s/g, '').match(/^(\d+)次$/)
  return m ? Math.max(1, Number(m[1])) : null
}
function parseInt0(v: string): number {
  const n = parseInt(v, 10)
  return isFinite(n) ? n : 0
}
function parseBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  const s = str(v).toLowerCase()
  if (/^(真|是|true|1|开启|开|启用)$/.test(s)) return true
  if (/^(假|否|false|0|关闭|关|禁用)$/.test(s)) return false
  return undefined
}
function queueMeta(...values: unknown[]): { mode?: EntertainmentRule['queueMode']; priority?: number } {
  let mode: EntertainmentRule['queueMode'] | undefined
  let priority: number | undefined
  for (const value of values) {
    if (value === true) { mode = 'jump'; continue }
    const s = str(value)
    if (!s) continue
    if (/^(即时|立即|instant)$/i.test(s)) mode = 'instant'
    else if (/^(插队|优先|jump)$/i.test(s)) mode = 'jump'
    else if (/^(排队|普通|normal)$/i.test(s)) mode = 'normal'
    else if (/^-?\d+$/.test(s)) priority = parseInt0(s)
  }
  return { mode, priority }
}

/** 原软件的坐标既可能是像素「100,200」也可能是屏幕百分比「80%,66%」（它的坐标拾取器给的就是百分比）；原样带 % 交给执行器换算 */
const POINT_RE = /(-?\d+(?:\.\d+)?%?)\s*[,，x×]\s*(-?\d+(?:\.\d+)?%?)/gi
function parsePoints(s: string): [string, string][] {
  const out: [string, string][] = []
  for (const m of s.matchAll(POINT_RE)) out.push([m[1], m[2]])
  return out
}
const mouseParam = (action: string, point?: [string, string] | null): string => (point ? `${action}|${point[0]}|${point[1]}` : action)

/** 「10」「5,20」「5~20」→ 客户端的「a,b」范围写法；减少类取负 */
function rangeParam(code: string, negate = false): string {
  const cleaned = code.replace(/[~～]/g, ',').replace(/[^\d,.\-]/g, '')
  const nums = cleaned.split(',').filter((p) => /\d/.test(p)).map((p) => Number(p)).filter((n) => Number.isFinite(n))
  if (!nums.length) return ''
  const signed = negate ? nums.map((n) => -n) : nums
  return signed.slice(0, 2).join(',')
}

const hasExt = (name: string): boolean => /\.[a-z0-9]{2,4}$/i.test(name)
const isAbsolutePath = (p: string): boolean => /^(?:[a-z]:[\\/]|\\\\)/i.test(p)
const joinWin = (...parts: string[]): string =>
  parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join('\\')

// ---------- 原软件 .脚本 宏：一行一个动作，「动作名:参数」 ----------
// 真实脚本里见过的行：正常按键:F10,1次 / 延迟时间:0.3秒 / 粘贴文本:bossrush 101 / 键盘弹起:Shift / 键盘锁定 / 键盘按住:F2 /
// 左键单击:80%,66% / 左键按住:20%,18% / 鼠标移到:80%,66% / 左键弹起:当前位置 / 动作命令:运行文件["x.exe" "a.mp4"] / OBS滤镜:游戏窗口\人物扭曲[开]
type ScriptLineRun = (arg: string, line: string) => PinyouScriptCommand[] | null
const scriptLine = (prefixes: string, run: ScriptLineRun): { re: RegExp; run: ScriptLineRun } => ({
  re: new RegExp(`^(?:${prefixes})\\s*(?:[:：=,，|]\\s*)?(.*)$`, 'i'),
  run
})
const unquote = (s: string): string => s.trim().replace(/^['"“”「」]|['"“”「」]$/g, '').trim()
const parseDelay = (v: string): number | null => {
  const m = unquote(v).match(/(-?\d+(?:\.\d+)?)\s*(毫秒|ms|秒|s)?/i)
  if (!m) return null
  const n = Number(m[1]); if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round((m[2] && /毫秒|ms/i.test(m[2])) ? n : n * 1000))
}
/** 「F2,300毫秒」「W,300」「F10,1次」→ [键, 后半] */
const splitArg = (s: string): [string, string] => {
  const m = unquote(s).match(/^(.+?)\s*(?:[,，|:\t]|\s{2,})\s*(.+)$/)
  return m ? [unquote(m[1]), unquote(m[2])] : [unquote(s), '']
}
const mouseLine = (action: string, needPoint = false): ScriptLineRun => (arg) => {
  const point = parsePoints(arg)[0]
  if (needPoint && !point) return null
  return [{ cmd: 'mouse', param: mouseParam(action, point) }]
}
const counterLine = (cmd: EntertainmentCommandCmd, negate = false, needValue = true): ScriptLineRun => (arg) => {
  const value = rangeParam(arg, negate)
  if (needValue && !value) return null
  return [{ cmd, param: needValue ? value : undefined }]
}
const SCRIPT_LINE_RULES = [
  scriptLine('延迟时间|延时|等待|暂停|sleep|wait|delay', (arg) => { const ms = parseDelay(arg); return ms == null ? null : [{ cmd: 'delay', param: String(ms) }] }),
  scriptLine('键盘按住|按住按键|长按|按住|hold', (arg) => {
    // 没写时长用默认值；不能把默认值再丢给 parseDelay（无单位按秒算，会变成 1000 秒）
    const [key, duration] = splitArg(arg); const ms = duration ? parseDelay(duration) : PINYOU_DEFAULTS.holdMs
    const hold = keyToHoldName(key)
    return hold && ms != null ? [{ cmd: 'key-hold', param: `${hold},${ms}` }] : null
  }),
  scriptLine('键盘弹起|弹起|松开|释放|release|keyup', (arg) => { const key = keyToHoldName(unquote(arg)); return key ? [{ cmd: 'key-up', param: key }] : null }),
  scriptLine('正常按键|快速按键|强化按键|组合按键|同时按多个键|键盘按键|按键|按下|敲击|keypress|key|press', (arg) => {
    const [key, rest] = splitArg(arg)
    const seq = key ? comboToSendKeys(key).seq : null
    if (!seq) return null
    const times = Math.min(PINYOU_DEFAULTS.maxRepeat, (parseTimes(rest) ?? (/^\d+$/.test(rest) ? Number(rest) : 1)) || 1)
    return Array.from({ length: Math.max(1, times) }, () => ({ cmd: 'key-sequence' as const, param: seq }))
  }),
  // ★「键盘操作:解锁WSAD」要排在「键盘操作:锁定WSAD」前面判：否则 line 里含「锁定」的正则会先吃掉解锁
  scriptLine('键盘操作\\s*[:：]?\\s*解锁WSAD|键盘操作\\s*[:：]?\\s*解锁WASD', () => [{ cmd: 'key-unlock' }]),
  scriptLine('键盘操作\\s*[:：]?\\s*锁定WSAD|键盘操作\\s*[:：]?\\s*锁定WASD', (arg) => {
    // 原软件这种写法不带时长，靠后面的「解锁」收尾；客户端锁键盘必须给时长，用默认值兜住
    const ms = parseDelay(arg) || PINYOU_DEFAULTS.lockMs
    return [{ cmd: 'key-lock', param: `W,A,S,D|${ms}` }]
  }),
  scriptLine('锁定键盘鼠标|键盘锁定|锁定键盘|锁定WSAD|锁定WASD', (arg, line) => {
    const ms = parseDelay(arg)
    if (!ms) return null   // 原软件脚本里的「键盘锁定」没写时长时靠后面的「键盘解锁」收尾，客户端锁键盘必须给时长，交给主播补
    const keys = /WSAD|WASD/i.test(line) ? 'W,A,S,D' : '全部'
    return [{ cmd: 'key-lock', param: `${keys}|${ms}` }]
  }),
  scriptLine('键盘解锁|解锁键盘|解锁WSAD|解锁WASD|解锁', () => [{ cmd: 'key-unlock' }]),
  scriptLine('鼠标锁定|锁定鼠标|鼠标解锁|解锁鼠标|中键单击|滚轮向前|滚轮向后|顺时针转圈|逆时针转圈|鼠标左移|鼠标右移', () => null),
  scriptLine('左键双击|双击', mouseLine('dblclick-left')),
  scriptLine('左键按住|左键长按|鼠标长按', mouseLine('down-left')),
  scriptLine('右键按住|右键长按', mouseLine('down-right')),
  scriptLine('左键弹起|左键抬起', mouseLine('up-left')),
  scriptLine('右键弹起|右键抬起', mouseLine('up-right')),
  scriptLine('右键单击|右击', mouseLine('click-right')),
  scriptLine('左键单击|鼠标单击|单击', mouseLine('click-left')),
  scriptLine('鼠标移到|鼠标移动|移动到', mouseLine('move', true)),
  scriptLine('鼠标|mouse', (arg) => {
    const a = unquote(arg)
    const action = /双击|double/i.test(a) ? 'dblclick-left' : /右键|right/i.test(a) ? 'click-right' : /移到|移动|move/i.test(a) ? 'move' : /按住|down/i.test(a) ? 'down-left' : /弹起|up|松开/i.test(a) ? 'up-left' : 'click-left'
    return [{ cmd: 'mouse', param: mouseParam(action, parsePoints(a)[0]) }]
  }),
  scriptLine('粘贴文本|paste', (arg) => { const v = unquote(arg); return v ? [{ cmd: 'paste-text', param: v }] : null }),
  scriptLine('发送文本|文本|text|send', (arg) => { const v = unquote(arg); return v ? [{ cmd: 'send-text', param: v }] : null }),
  scriptLine('结束程序|结束进程|关闭程序|kill', (arg) => { const v = unquote(arg); return v ? [{ cmd: 'kill', param: v }] : null }),
  scriptLine('播放动图|播放GIF', (arg) => { const v = unquote(arg); return v ? [{ cmd: 'video-gif', param: v }] : null }),
  scriptLine('停止视频|关闭视频', () => [{ cmd: 'video-stop' }]),
  // ★原软件「盲盒触发一个文件夹」的核心写法：播放视频:<目录>\\随机播放[绿幕2]
  //   一个项目就是一个文件夹，触发时从里面随机抽一条播，[绿幕N] 指定播到几号绿幕窗口。
  //   旧逻辑把整串当文件路径，于是这类脚本一条都播不出来（主播真实素材里有 11 处）。
  scriptLine('播放视频|随机播放视频|播放随机视频', (arg) => {
    const raw = unquote(arg)
    if (!raw) return null
    const slot = raw.match(/[[【]\s*(?:绿幕|窗口|绿布)?\s*(\d+)\s*[\]】]/)
    // 去掉尾部的 [绿幕N] 与「随机播放」标记，剩下的就是目录/文件
    const body = raw.replace(/[[【][^\]】]*[\]】]\s*$/, '').trim()
    const random = /(?:^|[\\/])随机播放?$|随机$/.test(body) || /随机播放/.test(raw)
    const target = body.replace(/(?:[\\/])?随机播放?$/, '').replace(/[\\/]+$/, '').trim()
    if (!target) return null
    const param = slot ? `${target}|绿幕${slot[1]}` : target
    // 目录 → 随机抽一条（带同名 .脚本 的会连它的动作一起执行）；具体文件 → 直接播
    return [{ cmd: random ? 'project-random' : 'video-play', param: random ? param : `${target}|0` }]
  }),
  scriptLine('动作命令', (arg) => {
    const run = arg.match(/^(?:运行文件|创建进程|执行外部程序)\s*[\[【]([\s\S]+)[\]】]\s*$/)
    return run ? [{ cmd: 'run-file', param: run[1].trim() }] : null
  }),
  scriptLine('倒计时清零', counterLine('countdown-clear', false, false)),
  scriptLine('倒计时减少', counterLine('countdown-adjust', true)),
  scriptLine('倒计时加减|倒计时增加', counterLine('countdown-adjust')),
  scriptLine('计数乘以', counterLine('count-mul')),
  scriptLine('计数除以', counterLine('count-div')),
  scriptLine('计数清零', counterLine('count-clear', false, false)),
  scriptLine('计数减少', counterLine('count-adjust', true)),
  scriptLine('计数加减|计数增加', counterLine('count-adjust')),
  scriptLine('加班清零', counterLine('overtime-clear', false, false)),
  scriptLine('加班乘以', counterLine('overtime-mul')),
  scriptLine('加班除以', counterLine('overtime-div')),
  scriptLine('加班减少', counterLine('overtime-adjust', true)),
  scriptLine('加班加减|加班增加', counterLine('overtime-adjust')),
  scriptLine('转盘抽奖|高级转盘抽奖|高级转盘', () => [{ cmd: 'wheel-spin' }])
]

/**
 * 解析原软件的 .脚本 文本宏。不同版本导出的脚本行名略有差异，
 * 这里按「行首动作名」表驱动解析而不是依赖固定列顺序；不认识的行会回传给导入预览，绝不静默丢掉。
 */
export function parsePinyouScript(text: string): PinyouScriptParseResult {
  const commands: PinyouScriptCommand[] = []
  const unknown: string[] = []
  const clean = (line: string): string => line.replace(/^\uFEFF/, '').replace(/\s*(?:\/\/|#).*$/, '').trim()
  for (const original of String(text || '').split(/\r?\n/).flatMap((line) => line.split(/[;；]+/))) {
    const line = clean(original)
    if (!line) continue
    // 常见 JSON 脚本导出：[{"动作":"按键","参数":"M"}, ...]
    if (/^\{.*\}$/.test(line)) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        const action = String(obj['动作'] ?? obj['action'] ?? obj['命令'] ?? obj['command'] ?? '').trim()
        const value = String(obj['参数'] ?? obj['参数1'] ?? obj['键'] ?? obj['key'] ?? obj['值'] ?? obj['value'] ?? '').trim()
        const synthetic = `${action} ${value}`.trim()
        if (synthetic) {
          const nested = parsePinyouScript(synthetic)
          commands.push(...nested.commands); unknown.push(...nested.unknown)
          continue
        }
      } catch { /* 不是 JSON 行，按普通脚本继续 */ }
    }
    let handled = false
    for (const rule of SCRIPT_LINE_RULES) {
      const m = line.match(rule.re)
      if (!m) continue
      const result = rule.run(m[1] ?? '', line)
      if (result) commands.push(...result); else unknown.push(line)
      handled = true
      break
    }
    if (handled) continue
    // 原软件有时直接把动作写作「M」「Ctrl+A」。
    if (/^(?:[A-Za-z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|(?:Ctrl|Alt|Shift)\s*\+.+)$/i.test(line)) {
      const seq = comboToSendKeys(line).seq
      if (seq) commands.push({ cmd: 'key-sequence', param: seq }); else unknown.push(line)
      continue
    }
    unknown.push(line)
  }
  return { commands, unknown }
}

/** 原软件的特殊触发名 → 客户端触发来源 */
export function triggerFromName(name: string): {
  giftName: string
  triggerType?: EntertainmentRule['triggerType']
  times?: number
} {
  const n = name.trim()
  if (n === '关注触发' || n === '关注') return { giftName: '关注', triggerType: 'follow' }
  const like = n.match(/^点赞触发[（(](\d+)[）)]$/) || n.match(/^点赞[（(](\d+)[）)]$/) || n.match(/^点赞触发$/) || n.match(/^点赞$/)
  if (like) return { giftName: '点赞', triggerType: 'like', times: like[1] ? Number(like[1]) : undefined }
  if (/^(进场触发|进入直播间|进场)$/.test(n)) return { giftName: '进场', triggerType: 'member' }
  // 原软件部分版本把数量写在触发名中："3个小心心"、"小心心×3"。
  const qty = n.match(/^(\d+)\s*个\s*(.+)$/) || n.match(/^(.+?)\s*[xх×＊*]\s*(\d+)$/i)
  if (qty) {
    const firstIsNum = /^\d+$/.test(qty[1])
    const count = Number(firstIsNum ? qty[1] : qty[2])
    const gift = (firstIsNum ? qty[2] : qty[1]).trim()
    if (gift && Number.isFinite(count) && count > 0) return { giftName: gift, times: count }
  }
  const kw = n.match(/^〖(.+)〗$/) || n.match(/^【(.+)】$/)
  if (kw) return { giftName: kw[1].trim(), triggerType: 'comment' }
  return { giftName: n }
}

const MOBILE_MAP: [RegExp, string][] = [
  [/抬头/, 'up'],
  [/低头/, 'down'],
  [/转圈.*(开火|射击)|开火.*转圈/, 'turnfire'],
  [/转圈/, 'turn'],
  [/偷袭/, 'dance2'],   // 客户端有独立的「蹦迪-偷袭」（W/S 前后交替），别并成经典蹦迪
  [/蹦迪|摇摆/, 'dance'],
  [/前进/, 'fwd'],
  [/后退/, 'back'],
  [/左移|向左/, 'lmove'],
  [/右移|向右/, 'rmove']
]

/** 「自动跳跃（空格）」「自动钩锁（Q+左键）」→ 括号里的键位；没有括号或括号里不是键位返回 null */
const PAREN_RE = /[（(]\s*([^（）()]+?)\s*[）)]\s*$/
function parenTokens(kind: string): { keys: string[]; mouse: string[]; raw: string } | null {
  const m = kind.match(PAREN_RE)
  if (!m) return null
  const keys: string[] = []
  const mouse: string[] = []
  for (const tok of m[1].split('+').map((t) => t.trim()).filter(Boolean)) {
    if (/^(左键|鼠标左键|左击)$/.test(tok)) mouse.push('click-left')
    else if (/^(右键|鼠标右键|右击)$/.test(tok)) mouse.push('click-right')
    else keys.push(tok)
  }
  return { keys, mouse, raw: m[1] }
}

// ---------- 主转换 ----------
type ActionCtx = {
  gift: string
  kind: string
  fn: string
  cls: string
  code: string
  cnt: string
  sound: string
  script: string
  d: Dict
  priority: string
  repeat: string
  made: boolean
}
type ActionRule = { test: RegExp | ((ctx: ActionCtx) => boolean); run: (ctx: ActionCtx) => void }

export function convertPinyouTable(
  table: Dict,
  planName: string,
  file: string,
  roots: PinyouAssetRoots = {}
): PinyouPlan {
  const rules: EntertainmentRule[] = []
  const notes: PinyouRuleNote[] = []
  const skipped: PinyouSkipped[] = []
  let empty = 0
  const exists = (p: string): boolean | undefined => (roots.exists ? roots.exists(p) : undefined)

  const base = (name: string, priority: string, repeat: string, meta: Dict = {}): EntertainmentRule => {
    const t = triggerFromName(name)
    const qm = queueMeta(meta['排队方式'], meta['执行方式'], meta['队列方式'], meta['是否插队'], priority)
    const r: EntertainmentRule = {
      id: '',
      giftName: t.giftName,
      actionType: 'key',
      priority: qm.priority ?? parseInt0(priority),
      repeat: Math.max(1, parseInt0(repeat) || 1),
      enabled: true
    }
    if (qm.mode) r.queueMode = qm.mode
    const multiply = parseBool(meta['执行倍数'] ?? meta['倍数'] ?? meta['是否倍数'])
    if (multiply !== undefined) r.multiply = multiply
    if (t.triggerType) r.triggerType = t.triggerType
    if (t.times) r.times = t.times
    // 原软件的「点赞触发」没写次数时是「点了就触发一次」；客户端 multiply 默认按数量倍数执行，一条点赞事件带几十个赞会连跑几十次，这里默认关掉
    if (t.triggerType === 'like' && !t.times && multiply === undefined) r.multiply = false
    return r
  }
  const skip = (gift: string, category: string, reason: string): void => {
    skipped.push({ gift, category, reason })
  }
  const note = (gift: string, text: string): void => {
    notes.push({ gift, text })
  }
  /** 素材路径拼好后查一下在不在（主进程给了 exists 才查） */
  const checkAsset = (gift: string, what: string, absPath: string): void => {
    if (exists(absPath) === false) note(gift, `${what}「${absPath}」在原软件目录里没找到，导入后请在规则里重新选文件`)
  }
  const scriptText = (name: string): string | null => {
    const raw = str(name)
    if (!raw || raw === '自动匹配') return null
    const map = roots.scriptContents || {}
    const target = raw.replace(/[\\/]+/g, '\\').toLowerCase()
    const baseName = target.split('\\').pop() || target
    for (const [k, value] of Object.entries(map)) {
      const kk = k.replace(/[\\/]+/g, '\\').toLowerCase()
      if (kk === target || kk.split('\\').pop() === baseName) return value
    }
    return null
  }
  const addScript = (gift: string, priority: string, repeat: string, name: string, meta: Dict = {}): boolean => {
    const script = str(name)
    if (!script || script === '自动匹配') return false
    const text = scriptText(script)
    if (text == null) {
      note(gift, `原软件脚本「${script}」未找到文件，已保留脚本名；请把它放回原软件「脚本」目录后重新导入`)
      return false
    }
    const parsed = parsePinyouScript(text)
    if (!parsed.commands.length) {
      note(gift, `原软件脚本「${script}」没有识别出可执行动作${parsed.unknown.length ? `：${parsed.unknown.slice(0, 3).join('；')}` : ''}`)
      return false
    }
    const r = base(gift, priority, repeat, meta)
    r.actionType = 'command'; r.commandCmd = 'script-sequence'
    r.commandParam = JSON.stringify(parsed.commands)
    rules.push(r)
    if (parsed.unknown.length) note(gift, `原软件脚本「${script}」有 ${parsed.unknown.length} 行未识别，已保留原文提示：${parsed.unknown.slice(0, 3).join('；')}`)
    return true
  }
  const soundRule = (name: string, priority: string, repeat: string, soundFile: string, meta: Dict = {}): boolean => {
    const f = soundFile.trim()
    if (!f) return false
    if (!hasExt(f)) {
      const r = base(name, priority, repeat, meta)
      r.actionType = 'command'; r.commandCmd = 'sound-random'; r.commandParam = roots.sounds ? joinWin(roots.sounds, f) : f
      rules.push(r)
      if (!roots.sounds) note(name, `随机音效目录「${f}」没找到原软件「音效」根目录，导入后请重新选择目录`)
      else checkAsset(name, '随机音效目录', r.commandParam)
      return true
    }
    const r = base(name, priority, repeat, meta)
    r.actionType = 'sound'
    r.soundPath = isAbsolutePath(f) ? f : roots.sounds ? joinWin(roots.sounds, f) : f
    r.soundMode = 'sync'
    rules.push(r)
    if (!roots.sounds && !isAbsolutePath(f)) note(name, `音效「${f}」只带了文件名，没找到原软件的「音效」目录，导入后请在规则里重新选文件`)
    else checkAsset(name, '音效', r.soundPath)
    return true
  }
  /** 原软件里相对写的动图/视频文件：先在安装目录、再在「视频」目录里找 */
  const resolveMedia = (name: string): string => {
    if (!name || isAbsolutePath(name)) return name
    const candidates = [roots.root, roots.videos].filter((p): p is string => !!p).map((dir) => joinWin(dir, name))
    return candidates.find((p) => exists(p)) ?? candidates[0] ?? name
  }

  /** 生成一条规则并登记：填好动作后 push，ctx.made = true */
  const emit = (ctx: ActionCtx, fill: (r: EntertainmentRule) => void): EntertainmentRule => {
    const r = base(ctx.gift, ctx.priority, ctx.repeat, ctx.d)
    fill(r)
    rules.push(r)
    ctx.made = true
    return r
  }
  /** 「次数时间 = N次」和「执行次数」是两层：每次执行敲 N 下 × 执行 M 次 */
  const applyTimes = (ctx: ActionCtx, r: EntertainmentRule): void => {
    const times = parseTimes(ctx.cnt)
    if (times && times > 1) r.repeat = Math.min(PINYOU_DEFAULTS.maxRepeat, Math.max(1, r.repeat || 1) * times)
  }
  const sequence = (ctx: ActionCtx, steps: PinyouScriptCommand[]): void => {
    emit(ctx, (r) => { r.actionType = 'command'; r.commandCmd = 'script-sequence'; r.commandParam = JSON.stringify(steps) })
  }
  const command = (ctx: ActionCtx, cmd: EntertainmentCommandCmd, param?: string): EntertainmentRule =>
    emit(ctx, (r) => { r.actionType = 'command'; r.commandCmd = cmd; if (param !== undefined) r.commandParam = param })
  const system = (ctx: ActionCtx, cmd: NonNullable<EntertainmentRule['systemCmd']>, param?: string): void => {
    emit(ctx, (r) => { r.actionType = 'system'; r.systemCmd = cmd; if (param) r.systemParam = param })
  }
  const delayStep = (ms: number): PinyouScriptCommand => ({ cmd: 'delay', param: String(ms) })
  const mouseStep = (action: string, point?: [string, string]): PinyouScriptCommand => ({ cmd: 'mouse', param: mouseParam(action, point) })
  const counter = (cmd: EntertainmentCommandCmd, negate = false, needValue = true) => (ctx: ActionCtx): void => {
    const value = rangeParam(ctx.code, negate)
    if (needValue && !value) { skip(ctx.gift, '动作', `「${ctx.kind}」没有填数值`); return }
    command(ctx, cmd, needValue ? value : undefined)
  }
  const skipWith = (reason: (ctx: ActionCtx) => string) => (ctx: ActionCtx): void => skip(ctx.gift, '动作', reason(ctx))

  /** 「自动跳跃（空格）」「自动钩锁（Q+左键）」按括号里的键位导；返回 false 表示括号里不是键位 */
  const importParenKey = (ctx: ActionCtx): boolean => {
    const tok = parenTokens(ctx.kind)
    if (!tok || (!tok.keys.length && !tok.mouse.length)) return false
    const dur = parseActionDuration(ctx.cnt)
    if (tok.mouse.length) {
      // 键 + 鼠标键的组合（自动钩锁（Q+左键））：按顺序敲键、再点鼠标
      const steps: PinyouScriptCommand[] = []
      for (const k of tok.keys) {
        const seq = comboToSendKeys(k).seq
        if (!seq) return false
        steps.push({ cmd: 'key-sequence', param: seq }, delayStep(PINYOU_DEFAULTS.stepDelayMs))
      }
      for (const m of tok.mouse) steps.push(mouseStep(m))
      sequence(ctx, steps)
      note(ctx.gift, `「${ctx.kind}」按括号里的「${tok.raw}」导成了顺序按键 + 鼠标点击，请核对是不是这个意思`)
      return true
    }
    const keyName = tok.keys.join('+')
    const seq = comboToSendKeys(keyName).seq
    const holdName = tok.keys.length === 1 ? keyToHoldName(keyName) : null
    if (!seq && !holdName) return false
    const useHold = holdName && ((dur && dur > 0) || !seq)   // 有时长、或者是 Ctrl/Shift 这种敲不了只能按住的键 → 按住
    const holdMs = dur && dur > 0 ? dur : PINYOU_DEFAULTS.holdMs
    if (useHold) command(ctx, 'key-hold', `${holdName},${holdMs}`)
    else emit(ctx, (r) => { r.actionType = 'key'; r.keySeq = seq! })
    note(ctx.gift, `「${ctx.kind}」按括号里的键位「${tok.raw}」导成了${useHold ? '按住 ' + holdMs + ' 毫秒' : '按一下'}，请核对是不是这个意思`)
    return true
  }

  // 执行功能 → 客户端动作。按顺序匹配，先精确后模糊；新加原软件功能时往这张表里加一行即可。
  const ACTION_RULES: ActionRule[] = [
    // —— 键盘 ——
    {
      test: (c) => /^(正常按键|快速按键|强化按键|组合按键|同时按多个键)$/.test(c.kind) || (!c.fn && c.cls === '键鼠'),
      run: (c) => {
        const combo = comboToSendKeys(c.code)
        if (combo.seq == null) { skip(c.gift, '动作', `${c.kind}：${combo.reason}`); return }
        const r = emit(c, (r) => { r.actionType = 'key'; r.keySeq = combo.seq! })
        if (c.kind === '同时按多个键' && c.code.split('+').filter((key) => !MODIFIER[normKey(key)]).length > 1) {
          note(c.gift, `「${c.code}」已转成顺序敲击，修饰键保持按住；多个主键不会同时按下`)
        }
        applyTimes(c, r)
      }
    },
    {
      test: /^(键盘按住|按住按键|同时长按多键|按住)$/,
      run: (c) => {
        const keys = c.code.split('+').map((s) => s.trim()).filter(Boolean)
        const hold = keys.length ? keyToHoldName(keys[0]) : null
        if (!hold) { skip(c.gift, '动作', `键盘按住：不认识的键名「${c.code}」`); return }
        command(c, 'key-hold', `${hold},${parseActionDuration(c.cnt) ?? PINYOU_DEFAULTS.holdMs}`)
        if (keys.length > 1) note(c.gift, `原软件是同时长按「${c.code}」，客户端一条规则只按住一个键，这里只按住了「${keys[0]}」`)
      }
    },
    {
      test: /^(键盘弹起|弹起按键|松开按键)$/,
      run: (c) => {
        const key = keyToHoldName(c.code.split('+')[0] || '')
        if (!key) { skip(c.gift, '动作', `键盘弹起：不认识的键名「${c.code}」`); return }
        command(c, 'key-up', key)
      }
    },
    // —— 音效 ——
    { test: /^播放音效$/, run: (c) => { c.made = soundRule(c.gift, c.priority, c.repeat, c.sound || c.code, c.d); if (!c.made && !(c.sound || c.code)) skip(c.gift, '动作', '播放音效没有填音效文件') } },
    { test: /禁用音效|恢复音效/, run: skipWith((c) => `「${c.kind}」是原软件自己的音效总开关，客户端没有对应动作`) },
    // —— 屏幕 / 系统（放在键盘锁定前面，「锁定屏幕」绝不能落进键盘锁定或反过来）——
    { test: /锁屏|锁定屏幕|锁定电脑|锁定系统|锁定计算机/, run: (c) => system(c, 'lock') },
    { test: /关机/, run: (c) => system(c, 'shutdown') },
    { test: /息屏|关闭显示器/, run: (c) => system(c, 'displayoff') },
    // —— 键鼠锁定（原软件写法两种词序都有：锁定键盘 / 键盘锁定，锁定WSAD / 解锁WSAD，鼠标锁定 / 锁定鼠标）——
    { test: /(锁定|解锁)\s*鼠标$|^鼠标\s*(锁定|解锁)/, run: skipWith((c) => `「${c.kind}」需要鼠标拦截，客户端暂不支持`) },
    { test: /减少转圈次数|减少跳跃次数/, run: skipWith((c) => `「${c.kind}」是原软件手游动作的内部计数，客户端没有对应动作`) },
    {
      test: /锁定\s*(键盘|WSAD|WASD|按键)|(键盘|WSAD|WASD)\s*(锁定|解锁)|解锁|锁定时间|减少锁定|增加锁定/i,
      run: (c) => {
        if (/解锁/.test(c.kind)) { command(c, 'key-unlock'); return }
        const adjust = /减少|增加/.test(c.kind)
        const duration = parseSeconds(c.cnt || (adjust ? c.code : '') || c.kind.match(/\d+(?:\.\d+)?\s*(?:毫秒|秒)/)?.[0] || '')
        const keys = /WSAD|WASD/i.test(c.kind) ? ['W', 'A', 'S', 'D']
          : /锁定\s*按键|按键\s*锁定/.test(c.kind) ? c.code.split(/[,，+]/).map(keyToHoldName) : ['全部']
        if (!duration || duration > 2147483647 || keys.some((key) => !key || key === 'ESC')) {
          skip(c.gift, '动作', `「${c.kind}」缺少有效锁定时长或键名（Esc 专用于解锁），请补齐后导入`)
          return
        }
        command(c, 'key-lock', adjust ? `调整|${/减少/.test(c.kind) ? -duration : duration}` : `${keys.join(',')}|${duration}`)
        if (/键盘鼠标/.test(c.kind)) note(c.gift, `「${c.kind}」只锁了键盘，鼠标拦截客户端暂不支持`)
      }
    },
    // —— 名字括号里是「键+鼠标键」的动作（自动钩锁（Q+左键））要先于鼠标规则，否则会被当成单纯的鼠标点击 ——
    { test: (c) => { const t = parenTokens(c.kind); return !!t && t.mouse.length > 0 && t.keys.length > 0 }, run: (c) => { if (!importParenKey(c)) skip(c.gift, '动作', `不认识的执行功能「${c.kind}」`) } },
    // —— 鼠标 ——
    {
      test: /拖动A点到B点|点击A再长按B|点击A再拖动B到C|多点坐标|长按坐标/,
      run: (c) => {
        const pts = parsePoints(c.code)
        const gap = PINYOU_DEFAULTS.stepDelayMs
        const holdMs = parseActionDuration(c.cnt) ?? PINYOU_DEFAULTS.mouseHoldMs
        const need = /A点到B点|点击A再长按B/.test(c.kind) ? 2 : /B到C/.test(c.kind) ? 3 : 1
        if (pts.length < need) { skip(c.gift, '动作', `「${c.kind}」需要 ${need} 个坐标点，功能代码里只有 ${pts.length} 个`); return }
        let steps: PinyouScriptCommand[]
        if (/拖动A点到B点/.test(c.kind)) steps = [mouseStep('down-left', pts[0]), delayStep(gap), mouseStep('move', pts[1]), delayStep(gap), mouseStep('up-left')]
        else if (/点击A再长按B/.test(c.kind)) steps = [mouseStep('click-left', pts[0]), delayStep(gap), mouseStep('down-left', pts[1]), delayStep(holdMs), mouseStep('up-left')]
        else if (/B到C/.test(c.kind)) steps = [mouseStep('click-left', pts[0]), delayStep(gap), mouseStep('down-left', pts[1]), delayStep(gap), mouseStep('move', pts[2]), delayStep(gap), mouseStep('up-left')]
        else if (/长按坐标/.test(c.kind)) steps = [mouseStep('down-left', pts[0]), delayStep(holdMs), mouseStep('up-left')]
        else steps = pts.flatMap((p, i) => (i ? [delayStep(gap), mouseStep('click-left', p)] : [mouseStep('click-left', p)]))
        sequence(c, steps)
      }
    },
    { test: /中键|滚轮|鼠标左移|鼠标右移|鼠标.*转圈|转圈.*鼠标/, run: skipWith((c) => `鼠标动作「${c.kind}」需要中键/滚轮/相对移动，客户端暂不支持`) },
    {
      test: /^鼠标操作$/,
      run: (c) => {
        // 「鼠标操作」的具体动作写在功能代码里：左键单击,80%,66%
        const parsed = parsePinyouScript(c.code)
        if (!parsed.commands.length) { skip(c.gift, '动作', `鼠标操作「${c.code}」认不出来`); return }
        if (parsed.commands.length === 1) command(c, parsed.commands[0].cmd as EntertainmentCommandCmd, parsed.commands[0].param)
        else sequence(c, parsed.commands)
      }
    },
    {
      test: /鼠标|左键|右键/,
      run: (c) => {
        const point = parsePoints(c.code)[0]
        const action = /右键弹起|右键抬起/.test(c.kind) ? 'up-right'
          : /左键弹起|左键抬起/.test(c.kind) ? 'up-left'
          : /右键长按|右键按住/.test(c.kind) ? 'down-right'
          : /移到|移动/.test(c.kind) ? 'move'
          : /右键|右击/.test(c.kind) ? 'click-right'
          : /双击/.test(c.kind) ? 'dblclick-left'
          : /长按|按住/.test(c.kind) ? 'down-left'
          : 'click-left'
        if (action === 'move' && !point) { skip(c.gift, '动作', `「${c.kind}」没有填目标坐标`); return }
        const r = command(c, 'mouse', mouseParam(action, point))
        if (/坐标/.test(c.kind) && !point) note(c.gift, `「${c.kind}」功能代码里没有坐标，导成了在当前光标位置点击`)
        if (/长按|按住/.test(c.kind)) note(c.gift, `原软件是鼠标长按，客户端导成「${action === 'down-right' ? '右' : '左'}键按住」，松开要再配一条「弹起」`)
        if (/单击|点击|双击/.test(c.kind)) applyTimes(c, r)
      }
    },
    // —— 手游 / 游戏动作 ——
    { test: /探头/, run: (c) => { emit(c, (r) => { r.actionType = 'key'; r.keySeq = PINYOU_DEFAULTS.leanKeys }); note(c.gift, `「${c.kind}」导成了左右交替敲 Q/E`) } },
    {
      test: (c) => c.kind.startsWith('手游') || MOBILE_MAP.some(([re]) => re.test(c.kind)),
      run: (c) => {
        // 原软件的手游动作有的带「手游-」前缀，有的直接写「原地转圈圈」「自动前进（W）」
        const hit = MOBILE_MAP.find(([re]) => re.test(c.kind))
        if (!hit) {
          if (importParenKey(c)) return
          skip(c.gift, '动作', `不认识的手游动作「${c.kind}」`)
          return
        }
        const duration = parseActionDuration(c.cnt)
        // 手游动作的「次数时间」在原软件里是按住时长；附在参数后交给执行器做真按住。
        command(c, 'mobile', duration && duration > 0 ? `${hit[1]}|${duration}` : hit[1])
        if (/恐龙|经典/.test(c.kind)) note(c.gift, `「${c.kind}」按蹦迪动作导入（A/D 左右交替）`)
      }
    },
    { test: /^退出[（(]/, run: skipWith((c) => `「${c.kind}」是特定游戏的退出流程，客户端没有对应动作；可以改用「大退（Alt+F4）」`) },
    // —— 进程 / 文本 ——
    {
      test: /结束进程|结束程序|关闭程序|杀进程/,
      run: (c) => { system(c, 'kill', c.code); if (!c.code) note(c.gift, `「${c.kind}」没有填进程名，导入后请在规则里补上要结束的进程`) }
    },
    { test: /发送文本|粘贴文本/, run: (c) => command(c, /粘贴/.test(c.kind) ? 'paste-text' : 'send-text', c.code) },
    // —— 倒计时 / 计数 / 加班（功能代码是数字或「a,b」「a~b」范围）——
    { test: /倒计时清零/, run: counter('countdown-clear', false, false) },
    { test: /倒计时减少/, run: counter('countdown-adjust', true) },
    { test: /倒计时/, run: counter('countdown-adjust') },
    { test: /计数清零/, run: counter('count-clear', false, false) },
    { test: /计数减少/, run: counter('count-adjust', true) },
    { test: /计数/, run: counter('count-adjust') },
    { test: /加班清零/, run: counter('overtime-clear', false, false) },
    { test: /加班乘以/, run: counter('overtime-mul') },
    { test: /加班除以/, run: counter('overtime-div') },
    { test: /加班减少/, run: counter('overtime-adjust', true) },
    { test: /加班/, run: counter('overtime-adjust') },
    { test: /转盘抽奖|高级转盘/, run: (c) => command(c, 'wheel-spin') },
    // —— 视频 / 动图 ——
    {
      test: /播放动图|播放GIF/i,
      run: (c) => {
        const p = resolveMedia(c.code)
        command(c, 'video-gif', p)
        if (!c.code) note(c.gift, `「${c.kind}」没有填动图路径，导入后请在规则里选文件`)
        else checkAsset(c.gift, '动图', p)
      }
    },
    { test: /停止视频|关闭视频|停止播放/, run: (c) => command(c, 'video-stop') },
    {
      test: /^播放视频$/,
      run: (c) => {
        if (!c.code || !hasExt(c.code)) { skip(c.gift, '动作', '播放视频没有填视频文件（原软件一般把视频放在「视频」分类里，那边会正常导入）'); return }
        const p = resolveMedia(c.code)
        command(c, 'video-play', `${p}|0`)
        checkAsset(c.gift, '视频', p)
      }
    },
    // —— 原软件自家插件 / 脚本 ——
    {
      test: /^动作命令$/,
      run: (c) => {
        const parsed = parsePinyouScript(`动作命令:${c.code}`)
        if (!parsed.commands.length) { skip(c.gift, '动作', `动作命令「${c.code}」只认「运行文件[路径]」这种写法`); return }
        command(c, parsed.commands[0].cmd as EntertainmentCommandCmd, parsed.commands[0].param)
      }
    },
    { test: /随机执行脚本/, run: skipWith((c) => `「${c.kind}」要从原软件的脚本分类里随机挑一个，客户端没有对应动作；可以挑一个脚本改成「执行脚本」再导`) },
    { test: /物理脚本|物理/, run: skipWith(() => '物理整蛊硬件的动作，客户端不支持') },
    { test: /OBS滤镜|OBS特效/i, run: skipWith((c) => `「${c.kind}」请在客户端的规则里选「OBS」动作重新配一次`) },
    { test: /OnlyClimb|PVZ命令/i, run: skipWith((c) => `「${c.kind}」是原软件针对特定游戏的插件，客户端没有对应动作`) },
    {
      test: (c) => /脚本/.test(c.kind) || c.cls === '脚本',
      run: (c) => { c.made = addScript(c.gift, c.priority, c.repeat, c.script || c.code, c.d); if (!c.made && !c.script && !c.code) skip(c.gift, '动作', '脚本动作没有填写脚本文件名') }
    },
    // —— 兜底：名字括号里带键位的 PC 动作（自动跳跃（空格）/ 自动下蹲（Ctrl）/ 大退（Alt+F4））——
    { test: (c) => !!c.kind && !!parenTokens(c.kind), run: (c) => { if (!importParenKey(c)) skip(c.gift, '动作', `不认识的执行功能「${c.kind}」`) } },
    { test: (c) => !!c.kind, run: skipWith((c) => `不认识的执行功能「${c.kind}」`) },
    { test: () => true, run: skipWith(() => '没有填执行功能') }
  ]

  for (const [gift, entryRaw] of Object.entries(table)) {
    if (!isObj(entryRaw)) continue
    if (Object.keys(entryRaw).length === 0) {
      empty++
      continue
    }
    for (const [category, dataRaw] of Object.entries(entryRaw)) {
      if (!isObj(dataRaw)) continue
      const d = dataRaw
      const priority = str(d['优先等级'] ?? d['优先级'] ?? d['执行优先级'])
      const repeat = str(d['执行次数'])
      const script = str(d['执行脚本'])
      if (category === '动作') {
        const fn = str(d['执行功能'])
        const cls = str(d['动作分类'])
        const ctx: ActionCtx = {
          gift, fn, cls, kind: fn || cls,
          code: str(d['功能代码']), cnt: str(d['次数时间']), sound: str(d['音效文件']), script,
          d, priority, repeat, made: false
        }
        const rule = ACTION_RULES.find(({ test }) => (typeof test === 'function' ? test(ctx) : test.test(ctx.kind)))
        rule?.run(ctx)
        // 原软件的「动作」可以顺带放一个音效：单独再导一条音效规则
        if (ctx.kind !== '播放音效' && ctx.sound) soundRule(gift, priority, repeat, ctx.sound, d)
        if (ctx.made && script && !/脚本/.test(ctx.kind)) addScript(gift, priority, repeat, script, d)
      } else if (category === '视频') {
        const dir = str(d['视频目录'])
        const vf = str(d['视频文件'])
        const pre = str(d['预播文件'])
        const prePath = pre ? (isAbsolutePath(pre) ? pre : roots.videos ? joinWin(roots.videos, pre) : pre) : ''
        if (prePath && roots.videos) checkAsset(gift, '预播视频', prePath)
        if (!vf) {
          if (pre) {
            const pr = base(gift, priority, repeat, d)
            pr.actionType = 'command'; pr.commandCmd = 'video-play-wait'; pr.commandParam = prePath; rules.push(pr)
          } else skip(gift, '视频', '没有填视频文件')
        } else {
          let mainCmd: EntertainmentCommandCmd = 'video-play'
          let mainParam: string
          if (vf === '随机播放' || !hasExt(vf)) {
            mainCmd = 'video-random'
            mainParam = roots.videos ? joinWin(roots.videos, dir) : dir
            if (!roots.videos) note(gift, `视频目录「${dir}」没找到原软件「视频」根目录，导入后请重新选择目录`)
            else checkAsset(gift, '随机视频目录', mainParam)
          } else {
            const filePath = isAbsolutePath(vf) ? vf : roots.videos ? joinWin(roots.videos, dir, vf) : joinWin(dir, vf)
            // 原软件的礼物视频播一次就收（「视频时间」是秒数，"自动"=播完为止）；客户端用「路径|秒数」表示一次性播放
            const secs = parseSeconds(str(d['视频时间']))
            mainParam = secs && secs > 0 ? `${filePath}|${(secs / 1000).toFixed(3).replace(/\.?0+$/, '')}` : `${filePath}|0`
            if (!roots.videos && !isAbsolutePath(vf)) note(gift, `视频「${joinWin(dir, vf)}」没找到原软件「视频」根目录，导入后请在规则里重新选文件`)
            else checkAsset(gift, '视频', filePath)
          }
          const r = base(gift, priority, repeat, d)
          r.actionType = 'command'
          if (pre) {
            // 预播与主视频必须串行，否则排队节拍会在预播尚未结束时把它替换掉。
            r.commandCmd = 'script-sequence'
            r.commandParam = JSON.stringify([{ cmd: 'video-play-wait', param: prePath }, { cmd: mainCmd, param: mainParam }])
          } else {
            r.commandCmd = mainCmd
            r.commandParam = mainParam
          }
          rules.push(r)
        }
        if (script && script !== '自动匹配') addScript(gift, priority, repeat, script, d)
      } else if (category === '物理') {
        skip(gift, '物理', '物理整蛊硬件的动作，客户端不支持')
      } else {
        skip(gift, category, `不认识的分类「${category}」`)
      }
    }
  }
  return { name: planName, file, rules, notes, skipped, empty }
}

/** 从文件名推方案名：原软件配置_xxx.py → xxx */
export function planNameFromFile(fileName: string): string {
  let n = fileName.replace(/\.[^.]+$/, '')
  n = n.replace(/^品游配置_?/, '').replace(/^配置_?/, '')
  return n || fileName
}
