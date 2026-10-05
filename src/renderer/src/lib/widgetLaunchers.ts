// 挂件总控：每个直播挂件「怎么开 / 怎么关 / 开没开」的统一入口。
// 配置存在渲染层 localStorage 的挂件（倒计时/计数/转盘/视频/绿幕），这里按各自页面的存储键读出来再开，
// 和页面上点「开启」走同一条 IPC，所以开出来的窗口和页面里开的一模一样。
import type { CountChallengeConfig, GreenScreenSlot, LotteryItem, TimeWidgetConfig, VideoWidgetConfig } from '@shared/types'
import { overtimeToChallengeCfg, readOvertimeCfg } from './overtimeConfig'
import { NINE_ORDER, nineItems } from '@shared/lottery'
import { SPECIAL_GAMES } from '@shared/specialGames'
export const CHALLENGE_MODE_KEY='ent_challenge_active_mode'

// 九宫格绿幕窗口用的 8 外圈格配色（和九宫格页保持一致）

export type WidgetGroup = '互动' | '展示' | '播放' | '特色整蛊'
export const WIDGET_GROUPS: WidgetGroup[] = ['互动', '展示', '播放', '特色整蛊']

export interface WidgetLauncher {
  id: string
  label: string
  group: WidgetGroup
  open: () => Promise<{ ok: boolean; error?: string }>
  close: () => Promise<unknown>
}

export interface WidgetOpenState {
  [id: string]: boolean
}

function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const notConfigured = (what: string) => Promise.resolve({ ok: false, error: `${what}还没配置，先去对应模块设置一次` })

export const WIDGET_LAUNCHERS: WidgetLauncher[] = [
  { id: 'effects', label: '礼物动画', group: '展示', open: () => window.api.effectsOpen(), close: () => window.api.effectsClose() },
  { id: 'entrance', label: '大哥进场横幅', group: '互动', open: () => window.api.entranceOpen(), close: () => window.api.entranceClose() },
  { id: 'queue', label: '整蛊排队', group: '互动', open: () => window.api.queueOpen(), close: () => window.api.queueClose() },
  { id: 'marquee', label: '飘屏', group: '展示', open: () => window.api.marqueeOpen(), close: () => window.api.marqueeClose() },
  { id: 'keyboard', label: '键盘显示', group: '展示', open: () => window.api.keyboardOpen(), close: () => window.api.keyboardClose() },
  { id: 'progress', label: '积分条', group: '互动', open: () => window.api.progressOpen(), close: () => window.api.progressClose() },
  { id: 'wish', label: '礼物心愿', group: '互动', open: () => window.api.wishOpen(), close: () => window.api.wishClose() },
  {
    id: 'time',
    label: '倒计时',
    group: '互动',
    open: () => {
      const cfg = readLS<Partial<TimeWidgetConfig>>('ent_time_cfg')
      return window.api.timeWidgetOpen({ ...(cfg || {}), on: true })
    },
    close: () => window.api.timeWidgetClose()
  },
  {
    id: 'challenge',
    label: '计数挑战',
    group: '互动',
    open: () => {
      const mode=localStorage.getItem(CHALLENGE_MODE_KEY)
      const cfg = mode==='counter'?readLS<CountChallengeConfig>('ent_challenge_counter_cfg'):mode==='timer'?readLS<CountChallengeConfig>('ent_challenge_timer_cfg'):readLS<CountChallengeConfig>('ent_challenge_timer_cfg')||readLS<CountChallengeConfig>('ent_challenge_counter_cfg')
      if (!cfg) return notConfigured('计数挑战')
      return window.api.challengeOpen({ ...cfg, slot: 'challenge' })
    },
    close: () => window.api.challengeClose('challenge')
  },
  {
    id: 'overtime',
    label: '加班器',
    group: '互动',
    open: () => window.api.challengeOpen(overtimeToChallengeCfg(readOvertimeCfg())),
    close: () => window.api.challengeClose('overtime')
  },
  {
    id: 'wheel',
    label: '转盘',
    group: '互动',
    open: async () => {
      const items = readLS<LotteryItem[]>('ent-wheel-items')
      const trigger = readLS<{autoSpin:boolean;triggerGift:string}>('ent-wheel-trigger') || {autoSpin:false,triggerGift:''}
      await window.api.lotteryConfigure('wheel',trigger,items || [],localStorage.getItem('ent-wheel-center') || '')
      return window.api.lotteryOpen('lucky', Array.isArray(items) && items.length ? items : [],localStorage.getItem('ent-wheel-center') || undefined)
    },
    close: () => window.api.lotteryClose('lucky')
  },
  {
    id: 'nine',
    label: '九宫格',
    group: '互动',
    open: async () => {
      const cells = readLS<string[]>('ent-nine-cells')
      if (!Array.isArray(cells) || cells.length !== 9 || NINE_ORDER.some(i => !String(cells[i]).trim())) return notConfigured('九宫格奖项')
      const imgs = readLS<string[]>('ent-nine-imgs') || []
      const items = nineItems(cells,imgs,readLS<Partial<LotteryItem>[]>('ent-nine-actions') || [])
      await window.api.lotteryConfigure('nine',readLS<{autoSpin:boolean;triggerGift:string}>('ent-nine-trigger') || {autoSpin:false,triggerGift:''},items)
      return window.api.lotteryOpen('nine', items)
    },
    close: () => window.api.lotteryClose('nine')
  },
  {
    id: 'video-main',
    label: '主视频',
    group: '播放',
    open: () => {
      const cfg = readLS<VideoWidgetConfig>('ent_video_cfg_main') || readLS<VideoWidgetConfig>('ent_video_cfg')
      if (!cfg?.path) return notConfigured('主视频')
      return window.api.videoWidgetOpen({ ...cfg, slot: 'main' })
    },
    close: () => window.api.videoWidgetClose('main')
  },
  {
    id: 'video-vip',
    label: 'VIP 视频',
    group: '播放',
    open: () => {
      const cfg = readLS<VideoWidgetConfig>('ent_video_cfg_vip')
      if (!cfg?.path) return notConfigured('VIP 视频')
      return window.api.videoWidgetOpen({ ...cfg, slot: 'vip' })
    },
    close: () => window.api.videoWidgetClose('vip')
  },
  ...([1, 2, 3, 4] as GreenScreenSlot[]).map((slot): WidgetLauncher => ({
    id: `green-${slot}`,
    label: `绿幕 ${slot} 号`,
    group: '播放',
    open: () => {
      // 没配素材也能开：主进程会开一个纯绿底空窗口，主播可以先把来源加进直播伴侣
      const drafts = readLS<Record<number, { type: 'video' | 'image'; src: string; text: string }>>('ent_green_slots')
      const draft = drafts?.[slot]
      return window.api.greenScreenOpen(draft?.src || '', draft?.type || 'video', draft?.text || '', slot)
    },
    close: () => window.api.greenScreenClose(slot)
  })),
  // 特色整蛊：每个玩法一个窗口，和其它挂件同一份开关 / 自动开启名单（娱乐助手、特色整蛊两处看到的是同一份）
  ...SPECIAL_GAMES.map((g): WidgetLauncher => ({
    id: `special-${g.id}`,
    label: g.name,
    group: '特色整蛊',
    open: () => window.api.specialOpen(g.id),
    close: () => window.api.specialClose(g.id)
  }))
]

/** 「去配置」去哪：特色整蛊去它自己的页面，其它挂件去娱乐助手对应模块 */
export function widgetConfigRoute(id: string): string {
  if (id.startsWith('special-')) return `/special?tool=${id.slice('special-'.length)}`
  const tool = id.startsWith('green-') ? 'green&slot=' + id.slice(6) : id.startsWith('video-') ? 'video&slot=' + id.slice(6) : id === 'queue' ? 'gift' : id === 'wish' ? 'progress' : id
  return '/ent?tool=' + tool
}

// 一次把所有挂件的开关状态查出来（各查各的 state 接口）
export async function readWidgetOpenState(): Promise<WidgetOpenState> {
  const [effects, entrance, queue, marquee, keyboard, progress, wish, time, challenge, lottery, video, green, overtime, special] = await Promise.all([
    window.api.effectsState().catch(() => null),
    window.api.entranceState().catch(() => null),
    window.api.queueState().catch(() => null),
    window.api.marqueeState().catch(() => null),
    window.api.keyboardState().catch(() => null),
    window.api.progressState().catch(() => null),
    window.api.wishState().catch(() => null),
    window.api.timeWidgetState().catch(() => null),
    window.api.challengeState('challenge').catch(() => null),
    window.api.lotteryState().catch(() => null),
    window.api.videoWidgetState().catch(() => null),
    window.api.greenScreenState().catch(() => null),
    window.api.challengeState('overtime').catch(() => null),
    window.api.specialState().catch(() => null)
  ])
  const state: WidgetOpenState = {
    effects: !!effects?.open,
    entrance: !!entrance?.open,
    queue: !!queue?.open,
    marquee: !!marquee?.open,
    keyboard: !!keyboard?.open,
    progress: !!progress?.open,
    wish: !!wish?.open,
    time: !!time?.open,
    challenge: !!challenge?.open,
    overtime: !!overtime?.open,
    wheel: !!lottery?.lucky,
    nine: !!lottery?.nine,
    'video-main': !!video?.main,
    'video-vip': !!video?.vip
  }
  for (const slot of [1, 2, 3, 4]) state[`green-${slot}`] = !!green?.slots?.find((s) => s.slot === slot)?.open
  for (const g of special?.games ?? []) state[`special-${g.id}`] = !!g.open
  return state
}

const AUTO_KEY = 'ent_widget_auto'

export function readAutoOpenIds(): string[] {
  const list = readLS<string[]>(AUTO_KEY)
  return Array.isArray(list) ? list.filter((id) => WIDGET_LAUNCHERS.some((w) => w.id === id)) : []
}

export function writeAutoOpenIds(ids: string[]): void {
  localStorage.setItem(AUTO_KEY, JSON.stringify(ids))
}

// 按顺序开，一个失败不影响后面的；返回失败清单给页面提示
export async function openWidgets(ids: string[]): Promise<{ id: string; error: string }[]> {
  const failed: { id: string; error: string }[] = []
  for (const id of ids) {
    const launcher = WIDGET_LAUNCHERS.find((w) => w.id === id)
    if (!launcher) continue
    try {
      const r = await launcher.open()
      if (!r.ok) failed.push({ id, error: r.error || '打开失败' })
    } catch (e) {
      failed.push({ id, error: (e as Error).message })
    }
  }
  return failed
}
