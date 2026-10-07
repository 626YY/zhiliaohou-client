// 整蛊台 AI 语音播报（2026-10-07 用户：「给所有的整个整蛊台的都给个开关能够生成这个 ai 语音，真的还挺好听的」
// 「每个模块一个小开关，自己配了视频的就不用了，当然也可以选择开不开」「记得基础模式做好引导」）：
// 各模块出结果时念一句（「加30秒」「抽中再来一次」「翻车，3次」），声音和特色整蛊开奖同一套。
// 特色整蛊自己的开奖配音在它的开奖设置里，这里不重复念。
import { SPECIAL_VOICE_OPTIONS } from './specialGames'

export type AnnounceModule = 'time' | 'wheel' | 'nine' | 'gift' | 'progress' | 'entrance' | 'challenge' | 'overtime'

export interface AnnounceModuleMeta {
  id: AnnounceModule
  label: string
  /** 念出来大概是什么样（设置里、引导里给主播看） */
  example: string
  /** 哪些算「自己配了视频 / 声音的」（默认不念）；空 = 这个模块没有自带声音的情况 */
  media: string
}

export const ANNOUNCE_MODULES: AnnounceModuleMeta[] = [
  { id: 'time', label: '时间插件', example: '加30秒', media: '配了视频或音效的礼物、盲盒事件' },
  { id: 'wheel', label: '转盘抽奖', example: '抽中再来一次', media: '配了语音或奖品视频的奖项' },
  { id: 'nine', label: '九宫格转盘', example: '抽中免单一次', media: '配了语音或奖品视频的奖项' },
  { id: 'gift', label: '礼物触发', example: '翻车，3次', media: '会播视频、放音效的规则' },
  { id: 'progress', label: '积分心愿', example: '心愿达成，小心心100个', media: '配了达成音效的' },
  { id: 'entrance', label: '大哥进场', example: '欢迎大哥 小明', media: '配了进场视频或音效的' },
  { id: 'challenge', label: '计数挑战', example: '加5', media: '' },
  { id: 'overtime', label: '加班器', example: '加班加10分钟', media: '' }
]
export const ANNOUNCE_MODULE_MAP: Record<string, AnnounceModuleMeta> = Object.fromEntries(ANNOUNCE_MODULES.map((m) => [m.id, m]))

export interface AnnounceModuleConfig {
  /** 这个模块念不念 */
  on: boolean
  /** 自己配了视频 / 声音的事件也念（默认不念，免得和自带的声音撞在一起） */
  withMedia: boolean
}

export interface AnnounceConfig {
  /** 总开关 */
  enabled: boolean
  voiceName: string
  /** 语速 %（0 = 正常） */
  rate: number
  /** 音量 % */
  volume: number
  /** 念之前先敲一声锣 */
  gong: boolean
  gongVolume: number
  /** 锣后停顿（毫秒） */
  gapMs: number
  /** 排着等念的超过这么多句，新来的就不念了（不攒一长串） */
  maxQueue: number
  modules: Record<AnnounceModule, AnnounceModuleConfig>
}

// 各模块默认不念：主播在模块页头打开「AI 播报」才念（2026-10-07 用户：「AI 语音一定是开了播报才有，没播报不能有」）。
// 总开关默认开着——它同时管着特色整蛊的开奖配音（那边一直是默认念的），关掉就整个整蛊台一句 AI 语音都没有。
export const DEFAULT_ANNOUNCE: AnnounceConfig = {
  enabled: true,
  voiceName: 'zh-CN-XiaoyiNeural',
  rate: 0,
  volume: 100,
  gong: false,
  gongVolume: 70,
  gapMs: 400,
  maxQueue: 6,
  modules: Object.fromEntries(ANNOUNCE_MODULES.map((m) => [m.id, { on: false, withMedia: false }])) as Record<AnnounceModule, AnnounceModuleConfig>
}

export const ANNOUNCE_VOICE_OPTIONS = SPECIAL_VOICE_OPTIONS

/** 数值项的上下限（设置页控件和主进程夹紧共用） */
export const ANNOUNCE_LIMITS = {
  rate: { min: -50, max: 100, step: 5 },
  volume: { min: 0, max: 100, step: 5 },
  gongVolume: { min: 0, max: 100, step: 5 },
  gapMs: { min: 0, max: 3000, step: 50 },
  maxQueue: { min: 1, max: 50, step: 1 }
} as const

function clamp(raw: unknown, def: number, min: number, max: number): number {
  const n = Number(raw)
  if (raw == null || raw === '' || !Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function normalizeAnnounce(raw?: unknown): AnnounceConfig {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<AnnounceConfig>
  const L = ANNOUNCE_LIMITS
  const voice = String(v.voiceName ?? '')
  const modules = {} as Record<AnnounceModule, AnnounceModuleConfig>
  const rawModules = (v.modules && typeof v.modules === 'object' ? v.modules : {}) as Partial<Record<AnnounceModule, Partial<AnnounceModuleConfig>>>
  for (const m of ANNOUNCE_MODULES) {
    const r = rawModules[m.id] ?? {}
    modules[m.id] = { on: r.on === true, withMedia: r.withMedia === true }
  }
  return {
    enabled: v.enabled == null ? DEFAULT_ANNOUNCE.enabled : v.enabled === true,
    voiceName: /^[a-z]{2,3}-[A-Z]{2}(?:-[a-z]+)?-[A-Za-z]+Neural$/.test(voice) ? voice : DEFAULT_ANNOUNCE.voiceName,
    rate: clamp(v.rate, DEFAULT_ANNOUNCE.rate, L.rate.min, L.rate.max),
    volume: clamp(v.volume, DEFAULT_ANNOUNCE.volume, L.volume.min, L.volume.max),
    gong: v.gong === true,
    gongVolume: clamp(v.gongVolume, DEFAULT_ANNOUNCE.gongVolume, L.gongVolume.min, L.gongVolume.max),
    gapMs: clamp(v.gapMs, DEFAULT_ANNOUNCE.gapMs, L.gapMs.min, L.gapMs.max),
    maxQueue: clamp(v.maxQueue, DEFAULT_ANNOUNCE.maxQueue, L.maxQueue.min, L.maxQueue.max),
    modules
  }
}

/** 秒数念成中文时长：30 → 30秒，90 → 1分30秒，3600 → 1小时 */
export function spokenDuration(seconds: number): string {
  let s = Math.max(0, Math.round(Math.abs(Number(seconds) || 0)))
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const parts = [h ? `${h}小时` : '', m ? `${m}分` : '', s ? `${s}秒` : '']
  const out = parts.join('')
  return out ? out.replace(/^(\d+)分$/, '$1分钟') : '0秒'
}

/** 念出来的那句：去掉表情和怪符号（语音会念成乱码），+ − × ÷ 换成字，最多 40 个字 */
export function announceLine(text: string): string {
  const s = String(text ?? '')
    .replace(/[+＋]/g, '加')
    .replace(/[×＊*](?=\d)/g, '乘')
    .replace(/[÷]/g, '除以')
    .replace(/[^\p{Script=Han}\p{L}\p{N}，。！？、：,.!?~～\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > 40 ? s.slice(0, 40) : s
}

/** 设置页 / 引导里「试听」：给一个模块（念它的示例句）或者直接给一句话 */
export interface AnnouncePreviewRequest {
  module?: AnnounceModule
  text?: string
  /** 还没存的设置（试听时按页面上正在调的声音 / 语速 / 音量） */
  config?: Partial<AnnounceConfig>
}
