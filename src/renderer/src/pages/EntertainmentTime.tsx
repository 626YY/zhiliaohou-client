import TimeSetupGuide from '../components/TimeSetupGuide'
import PetCountdownPreview, { PetSkinThumbnail } from '../components/PetCountdownPreview'
import { petSkin } from '@shared/countdownPets'
import EmojiText from '../components/EmojiText'
import TimeProjectSetup from '../components/TimeProjectSetup'
import {useConfigurationLevel,ExpandedConfiguration} from '../lib/configurationLevel'
import AdvancedSection from '../components/AdvancedSection'
import { usePolling } from '../lib/usePolling'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Download, FolderOpen, Minus, MonitorPlay, Plus, Save, Upload, X, Zap } from 'lucide-react'
import type { ConnectorEvent, CountdownOp, TimeGiftLogEntry, TimeGiftOp, TimeWidgetConfig, TimeWidgetGift, TimeWidgetHotkey, TimeWidgetState } from '@shared/types'
import { normalizeTimeBlindBoxEvents } from '@shared/timeBlindBox'
import { Btn, Card, Field, Input, Select, Segmented, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'
import { COUNTDOWN_ART } from '../../../shared/countdownArt'
import { COUNTDOWN_THEMES, DEFAULT_COUNTDOWN_THEME, FRAME_H, FRAME_LAYOUT, FRAME_W, frameDataUri, themeById } from '../../../shared/countdownFrame'
import { formatCountdown } from '../../../shared/countdownTime'
import { normalizeGiftName } from '../../../shared/giftName'
import TimeBlindBoxEditor, { TimeBlindBoxPool } from '../components/TimeBlindBoxEditor'

// 本地图片走 zlmedia 协议：设置页是 http 环境，写 file:// 会被安全策略拦成空白图
function toMedia(value: string): string {
  const normalized = String(value || '').split(String.fromCharCode(92)).join('/')
  return 'zlmedia://local/' + normalized.split('/').map((part) => encodeURIComponent(part)).join('/')
}

const STORAGE_KEY = 'ent_time_cfg'
const PLANS_KEY = 'ent_time_plans'
const HOTKEY_FUNCS = ['无', 'Alt', 'Ctrl', 'Ctrl+Alt', 'Shift']

const GIFT_OPS: TimeGiftOp[] = ['加减', '乘以', '除以', '范围', '清零']

// 老存档运算方式迁移：以前的 加/减/盲盒/设为 对齐原版的 加减/范围
function migrateGiftOp(op: string | undefined): TimeGiftOp {
  const value = String(op ?? '')
  if (value === '盲盒' || value === '加') return '加减'
  if (value === '设为') return '范围'
  if (GIFT_OPS.includes(value as TimeGiftOp)) return value as TimeGiftOp
  return '加减'
}
// 可选主题：矢量主题 + 三张原版位图（经典）
const THEME_IDS = [...COUNTDOWN_THEMES.map((theme) => theme.id), 'legacy_cyan', 'legacy_orange', 'legacy_frame']

const defaultConfig: TimeWidgetConfig = {
  on: false,
  enable: true,
  title: '禁言倒计时',
  initial: 300,
  clockSpeed: 1000,
  addGift: '请吃鸡',
  addSeconds: 60,
  subGift: '棒棒糖',
  subSeconds: 30,
  autoHide: false,
  showGift: true,
  showNegative: false,
  showSeconds: false,
  zeroText: '时间到',
  bgImage: '',
  theme: DEFAULT_COUNTDOWN_THEME,
  titleColor: '#ffffff',
  timeColor: '#ffffff',
  startHotkey: { enabled: false, func: '无', key: '' },
  endHotkey: { enabled: false, func: '无', key: '' },
  gifts: [
    { name: '鲜花', op: '加减', seconds: 30, seconds2: null, text: '', img: '', video: '', videoLoop: false, videoSeconds: 0 },
    { name: '棒棒糖', op: '加减', seconds: -30, seconds2: null, text: '', img: '', video: '', videoLoop: false, videoSeconds: 0 }
  ],
  blindBoxEvents: [],
  giftPanel: true,
  giftColumns: 2,
  giftPanelWidth: 1,
  giftNameColor: '#ffffff',
  addColor: '#ff9a3c',
  subColor: '#3fe0d0',
  boxColor: '#f5c542',
  cellBg: '#242428',
  cellBorder: '#3a3a40',
  cellAlpha: 0.92,
  giftNameSize: 16,
  giftTextSize: 16,
  giftIconSize: 42,
  scale: 1,
  posX: 200,
  posY: 30
}

// 礼物格下行文字：没填自定义文字就按运算方式自动生成（与挂件端同一套规则）。
function effectText(gift: TimeWidgetGift): string {
  if (gift.text) return gift.text
  if (gift.mode === 'blindbox') return '盲盒'
  const value = Math.trunc(Number(gift.seconds) || 0)
  const end = gift.seconds2 == null ? null : Math.trunc(Number(gift.seconds2) || 0)
  const signed = (v: number) => (v > 0 ? `+${v}` : String(v))
  const range = end != null && end !== value ? `${signed(value)}~${end}` : signed(value)
  if (gift.op === '乘以') return `×${end != null && end !== value ? `${value}~${end}` : value}`
  if (gift.op === '除以') return `÷${end != null && end !== value ? `${value}~${end}` : value}`
  if (gift.op === '范围') return `=${end != null && end !== value ? `${value}~${end}` : value}`
  if (gift.op === '清零') return '清零'
  return range
}

function effectColor(gift: TimeWidgetGift, config: TimeWidgetConfig): string {
  if (gift.mode === 'blindbox') return config.boxColor || '#f5c542'
  if (gift.op === '范围') return config.boxColor || '#f5c542'
  if (gift.op === '除以' || gift.op === '清零') return config.subColor || '#3fe0d0'
  if (gift.op === '加减' && Math.trunc(Number(gift.seconds) || 0) < 0) return config.subColor || '#3fe0d0'
  return config.addColor || '#ff9a3c'
}

function hexToRgba(hex: string | undefined, alpha: number): string {
  const value = String(hex || '#242428').replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return `rgba(36,36,40,${alpha})`
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

type TimePlan = { name: string; config: TimeWidgetConfig }

// JSON 会把 NaN 写成 null；范围终点的 null 表示关闭范围，必须保留未填数值供下次修正。
function serializeConfig(value: TimeWidgetConfig | TimePlan[]): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item)
}

function numberOr(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) ? value : fallback
}

function normalize(value: Partial<TimeWidgetConfig>): TimeWidgetConfig {
  const hotkey = (item: Partial<TimeWidgetHotkey> | undefined): TimeWidgetHotkey => ({
    enabled: !!item?.enabled,
    func: HOTKEY_FUNCS.includes(String(item?.func)) ? String(item?.func) : '无',
    key: String(item?.key || '')
  })
  const color = (input: unknown, fallback: string) =>
    /^#[0-9a-f]{6}$/i.test(String(input || '')) ? String(input) : fallback
  return {
    ...defaultConfig,
    ...value,
    on: !!value.on,
    enable: value.enable !== false,
    title: String(value.title ?? defaultConfig.title),
    initial: Math.trunc(numberOr(value.initial, defaultConfig.initial)),
    clockSpeed: Math.max(50, Math.trunc(numberOr(value.clockSpeed, defaultConfig.clockSpeed))),
    addGift: String(value.addGift ?? defaultConfig.addGift),
    addSeconds: Math.max(0, numberOr(value.addSeconds, defaultConfig.addSeconds)),
    subGift: String(value.subGift ?? defaultConfig.subGift),
    subSeconds: Math.max(0, numberOr(value.subSeconds, defaultConfig.subSeconds)),
    autoHide: !!value.autoHide,
    showGift: value.showGift !== false,
    showNegative: !!value.showNegative,
    showSeconds: !!value.showSeconds,
    zeroText: String(value.zeroText ?? defaultConfig.zeroText),
    bgImage: String(value.bgImage ?? ''),
    theme: THEME_IDS.includes(String(value.theme)) ? String(value.theme) : DEFAULT_COUNTDOWN_THEME,
    titleColor: color(value.titleColor, defaultConfig.titleColor),
    timeColor: color(value.timeColor, defaultConfig.timeColor),
    startHotkey: hotkey(value.startHotkey),
    endHotkey: hotkey(value.endHotkey),
    gifts: (Array.isArray(value.gifts) ? value.gifts : defaultConfig.gifts ?? [])
      .filter((item): item is TimeWidgetGift => !!item && typeof item === 'object')
      .map((item) => {
        const op = migrateGiftOp(item.op as string | undefined)
        // 老「减」= 负向加减
        const seconds = String(item.op) === '减' ? -Math.abs(Math.trunc(numberOr(item.seconds, 30))) : Math.trunc(numberOr(item.seconds, 30))
        return {
          name: String(item.name ?? ''),
          // 旧版 op=盲盒只是随机加减；只有显式 mode 才使用事件奖池。
          mode: item.mode === 'blindbox' ? 'blindbox' : 'direct',
          blindBoxEventIds: [...new Set(Array.isArray(item.blindBoxEventIds) ? item.blindBoxEventIds.map(String) : [])],
          op,
          seconds,
          seconds2: item.seconds2 == null ? null : Math.trunc(numberOr(item.seconds2, 0)),
          text: String(item.text ?? ''),
          img: String(item.img ?? ''),
          video: String(item.video ?? ''),
          videoLoop: item.videoLoop === true,
          videoSeconds: Math.max(0, Math.trunc(numberOr(item.videoSeconds, 0))),
          // 屏幕显示：关掉照样触发，只是不上挂件礼物栏
          showOnPanel: item.showOnPanel !== false
        }
      }),
    blindBoxEvents: normalizeTimeBlindBoxEvents(value.blindBoxEvents),
    giftPanel: value.giftPanel !== false,
    giftColumns: [1, 2, 3].includes(Number(value.giftColumns)) ? Number(value.giftColumns) : 2,
    // 1.35/1.6 是两个历史版本的默认宽（礼物栏比时间框宽，用户定版不要超边界）。
    // 存档里撞上这两个值按「没调过」迁移回 1；用户自己调的其他值原样保留。
    giftPanelWidth: (() => {
      const raw = numberOr(value.giftPanelWidth, 1)
      return Math.max(1, Math.min(2.5, raw === 1.35 || raw === 1.6 ? 1 : raw))
    })(),
    giftNameColor: color(value.giftNameColor, '#ffffff'),
    addColor: color(value.addColor, '#ff9a3c'),
    subColor: color(value.subColor, '#3fe0d0'),
    boxColor: color(value.boxColor, '#f5c542'),
    cellBg: color(value.cellBg, '#242428'),
    cellBorder: color(value.cellBorder, '#3a3a40'),
    cellAlpha: Math.max(0, Math.min(1, numberOr(value.cellAlpha, 0.92))),
    giftNameSize: Math.max(8, Math.min(40, Math.trunc(numberOr(value.giftNameSize, 16)))),
    giftTextSize: Math.max(8, Math.min(40, Math.trunc(numberOr(value.giftTextSize, 16)))),
    giftIconSize: Math.max(16, Math.min(96, Math.trunc(numberOr(value.giftIconSize, 42)))),
    scale: Math.max(0.4, Math.min(4, numberOr(value.scale, 1))),
    // 指定播放窗口 / 滚动条 / 记录窗口标题与条数（主进程 normalize 同一套规则，别漏）
    boxVideoSlot: [1, 2, 3, 4].includes(Number(value.boxVideoSlot)) ? Number(value.boxVideoSlot) : 4,
    giftTicker: value.giftTicker === true,
    boxVideoOverflow: value.boxVideoOverflow !== false,
    logTitle: String(value.logTitle ?? '抽时间记录').slice(0, 40),
    logRows: Math.max(1, Math.min(30, Math.trunc(numberOr(value.logRows, 8)))),
    posX: Math.trunc(numberOr(value.posX, defaultConfig.posX)),
    posY: Math.trunc(numberOr(value.posY, defaultConfig.posY))
  }
}

function loadConfig(): TimeWidgetConfig {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))
  } catch {
    return defaultConfig
  }
}

function loadPlans(): TimePlan[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PLANS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is { name: string; config?: Partial<TimeWidgetConfig> } =>
        !!item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
      )
      .map((item) => ({ name: item.name, config: normalize(item.config || {}) }))
  } catch {
    return []
  }
}

// 时间文字用挂件那份共享实现（shared/countdownTime），预览和上播画面才不会两个样。
const formatTime = formatCountdown

// 面板底图：自定义图优先，其次矢量主题；legacy_* 是三张原版位图。
function previewSource(config: TimeWidgetConfig): string {
  if (config.bgImage) return /^https?:/i.test(config.bgImage) ? config.bgImage : toMedia(config.bgImage)
  if (config.theme === 'legacy_orange') return COUNTDOWN_ART.mode1_orange
  if (config.theme === 'legacy_frame') return COUNTDOWN_ART.mode2_frame
  if (config.theme === 'legacy_cyan') return COUNTDOWN_ART.mode1_cyan
  return frameDataUri(themeById(config.theme).style)
}

// 原版运算器 0x430c55：加减 / 范围 / 清零 / 乘以 / 除以
const COUNTDOWN_OPS: CountdownOp[] = ['加减', '范围', '清零', '乘以', '除以']

// 计数挑战 / 加班器是宫格里各自独立的卡片，时间插件页里不再放它们的入口（2026-09-08 用户要求去掉）
export default function EntertainmentTime() {
  const {level}=useConfigurationLevel()
  const [allSettingsOpen,setAllSettingsOpen]=useState(false)
  // 基础模式「导入时间视频项目」向导：写配置只走下面的 update（React 状态 + localStorage + 主进程同一条路）
  const [projectSetupOpen,setProjectSetupOpen]=useState(false)
  const [hasSavedSettings,setHasSavedSettings]=useState(()=>localStorage.getItem(STORAGE_KEY)!==null)
  const toast = useToast((store) => store.toast)
  const [config, setConfig] = useState<TimeWidgetConfig>(loadConfig)
  const [state, setState] = useState<TimeWidgetState>({ open: false, remaining: 0, running: false })
  const [plans, setPlans] = useState<TimePlan[]>(loadPlans)
  const [planName, setPlanName] = useState('')
  const [planPick, setPlanPick] = useState('')
  const [cachedGifts, setCachedGifts] = useState<string[]>([])
  const [liveGifts, setLiveGifts] = useState<string[]>([])
  // 礼物名 → 本地已下载的真实抖音礼物图，预览和挂件用同一份图源
  const [giftImages, setGiftImages] = useState<Record<string, string>>({})

  // 送时间记录（谁送的什么、±多少秒）
  const [giftLog, setGiftLog] = useState<TimeGiftLogEntry[]>([])
  const [testBusy, setTestBusy] = useState(false)
  const testInFlight = useRef(false)
  const [blindBoxError, setBlindBoxError] = useState('')
  const [timeLogOpen, setTimeLogOpen] = useState(false)
  const settingsFileRef = useRef<HTMLInputElement>(null)

  // 「抽时间记录」窗口开没开（开关状态存在客户端设置里，开机自动恢复）
  const toggleTimeLog = async (on: boolean): Promise<void> => {
    const result: { ok: boolean; error?: string } = on ? await window.api.timeLogOpen() : await window.api.timeLogClose()
    if (!result.ok) return toast(result.error || '打开记录窗口失败', 'error')
    setTimeLogOpen(on)
    toast(on ? '记录窗口已开启，直播伴侣里选「抽时间记录」这个来源' : '记录窗口已关闭', on ? 'success' : 'info')
  }
  useEffect(() => { void window.api.timeLogState().then((r) => setTimeLogOpen(r.open)) }, [])

  const refresh = async () => {
    setState(await window.api.timeWidgetState())
    setGiftLog(await window.api.timeWidgetLog())
  }

  usePolling(() => Promise.all([window.api.timeWidgetState(), window.api.timeWidgetLog()]), ([next, log]) => {
    setState((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    setGiftLog((current) => current.length === log.length && current[0]?.ts === log[0]?.ts ? current : log)
  }, 1000)

  useEffect(() => {
    let active = true
    void window.api.entertainmentListGiftImages().then((items) => {
      if (!active) return
      setCachedGifts([...new Set(items.map((item) => item.name).filter(Boolean))])
      const map: Record<string, string> = {}
      for (const item of items) {
        const key = normalizeGiftName(item.name)
        if (key && !map[key]) map[key] = toMedia(item.path)
      }
      setGiftImages(map)
    })
    const off = window.api.onConnectorEvent((event: ConnectorEvent) => {
      if (event.type !== 'gift' || !event.giftName) return
      const gift = event.giftName.trim()
      setLiveGifts((current) => current.includes(gift) ? current : [gift, ...current].slice(0, 120))
    })
    return () => { active = false; off() }
  }, [])

  const giftNames = useMemo(() => {
    const seen = new Set<string>()
    const add = (name: string) => { if (name && !seen.has(name)) seen.add(name) }
    liveGifts.forEach(add)
    cachedGifts.forEach(add)
    DOUYIN_GIFT_NAMES.forEach(add)
    return [...seen]
  }, [cachedGifts, liveGifts])

  const update = (patch: Partial<TimeWidgetConfig>) => {
    const next = normalize({ ...config, ...patch })
    // 编辑时保留尾部空格和未填数值；执行前由主进程校验。
    next.blindBoxEvents = patch.blindBoxEvents ?? config.blindBoxEvents ?? []
    setConfig(next)
    setHasSavedSettings(true)
    localStorage.setItem(STORAGE_KEY, serializeConfig(next))
    return window.api.timeWidgetUpdate(next).catch(() => {toast('设置未同步，请重新保存', 'error');return {ok:false,error:'设置未同步，请重新保存'}})
  }

  const runBlindBoxAction = async (action: () => Promise<{ ok: boolean; error?: string; queued?: number }>) => {
    if (testInFlight.current) return
    testInFlight.current = true
    setTestBusy(true)
    setBlindBoxError('')
    try {
      await window.api.timeWidgetUpdate(config)
      const result = await action()
      if (!result.ok) {
        const message = result.error || '执行失败，请重试'
        setBlindBoxError(message)
        toast(message, 'error')
      } else if (result.queued) toast(`已加入队列 ${result.queued} 项`, 'info')
      await refresh()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '执行失败，请重试'
      setBlindBoxError(message)
      toast(message, 'error')
    } finally {
      testInFlight.current = false
      setTestBusy(false)
    }
  }

  const removeBlindBoxEvent = (id: string) => {
    const affected = (config.gifts || []).filter(gift => gift.blindBoxEventIds?.includes(id))
    update({
      blindBoxEvents: (config.blindBoxEvents || []).filter(event => event.id !== id),
      gifts: (config.gifts || []).map(gift => ({ ...gift, blindBoxEventIds: gift.blindBoxEventIds?.filter(eventId => eventId !== id) }))
    })
    if (affected.length) toast(`事件已删除，已从 ${affected.length} 个礼物奖池移除`, 'info')
  }

  const updateHotkey = (which: 'startHotkey' | 'endHotkey', patch: Partial<TimeWidgetHotkey>) =>
    update({ [which]: { ...config[which], ...patch } } as Partial<TimeWidgetConfig>)

  const save = async () => {
    await window.api.timeWidgetUpdate(config)
    localStorage.setItem(STORAGE_KEY, serializeConfig(config))
    toast('倒计时设置已保存', 'success')
  }

  const savePlan = () => {
    const name = planName.trim() || `倒计时方案${plans.length + 1}`
    const next = [...plans.filter((plan) => plan.name !== name), { name, config }]
    setPlans(next)
    localStorage.setItem(PLANS_KEY, serializeConfig(next))
    setPlanName('')
    setPlanPick(name)
    toast(`方案「${name}」已保存`, 'success')
  }

  const loadPlan = (name: string) => {
    const plan = plans.find((item) => item.name === name)
    if (!plan) return
    update(plan.config)
    setPlanPick(name)
    toast(`已加载方案「${name}」`, 'success')
  }

  // 导出/导入整套设置：倒计时配置 + 全部方案（换台电脑、给别的主播都能带走）
  const exportSettings = () => {
    const payload = { kind: 'zhiliao-time-cfg', version: 1, exportedAt: new Date().toISOString(), config, plans }
    const blob = new Blob([serializeConfig(payload as never)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `时间插件设置_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('设置已导出', 'success')
  }

  const importSettings = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      // 认三种：整包 { config, plans } / 只有方案的数组 / 单个配置对象
      const incoming = Array.isArray(parsed)
        ? { config: null, plans: parsed }
        : { config: parsed?.config ?? (parsed?.kind ? null : parsed), plans: parsed?.plans }
      let planCount = 0
      if (Array.isArray(incoming.plans)) {
        const rows = incoming.plans
          .filter((item: unknown) => !!item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string')
          .map((item: { name: string; config?: Partial<TimeWidgetConfig> }) => ({ name: item.name, config: normalize(item.config || {}) }))
        if (rows.length) {
          const names = new Set(rows.map((row) => row.name))
          const next = [...plans.filter((plan) => !names.has(plan.name)), ...rows]
          setPlans(next)
          localStorage.setItem(PLANS_KEY, serializeConfig(next))
          planCount = rows.length
        }
      }
      if (incoming.config && typeof incoming.config === 'object') {
        // ★事件库要整份换过来（normalize 会补默认值，但事件数组要显式给）
        const next = normalize(incoming.config as Partial<TimeWidgetConfig>)
        next.blindBoxEvents = normalizeTimeBlindBoxEvents((incoming.config as Partial<TimeWidgetConfig>).blindBoxEvents)
        update(next)
        toast(`设置已导入：${next.blindBoxEvents.length} 个盲盒事件` + (planCount ? `、${planCount} 套方案` : ''), 'success')
        return
      }
      if (!planCount) throw new Error('格式不对')
      toast(`已导入 ${planCount} 套方案`, 'success')
    } catch {
      toast('导入失败：请选择本页导出的 JSON 设置文件', 'error')
    }
  }

  const deletePlan = () => {
    if (!planPick) return
    const next = plans.filter((plan) => plan.name !== planPick)
    setPlans(next)
    localStorage.setItem(PLANS_KEY, serializeConfig(next))
    setPlanPick('')
  }

  const pickBg = async () => {
    const result = await window.api.selectFile({
      title: '选择倒计时背景图',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile']
    })
    if (result.ok && result.path) update({ bgImage: result.path })
  }

  const pickGiftVideo = async (index: number) => {
    const result = await window.api.selectFile({
      title: '选择该礼物触发的绿幕视频',
      filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'avi'] }],
      properties: ['openFile']
    })
    if (result.ok && result.path) setGift(index, { video: result.path })
  }

  const toggleWindow = async () => {
    if (state.open) {
      await window.api.timeWidgetClose()
      update({ on: false })
      await refresh()
      toast('倒计时窗口已关闭', 'info')
      return
    }
    const result = await window.api.timeWidgetOpen(config)
    if (!result.ok) return toast(result.error || '倒计时窗口打开失败', 'error')
    update({ on: true })
    await refresh()
    toast('倒计时窗口已开启', 'success')
  }

  const testGift = async (kind: 'add' | 'sub') => {
    await runBlindBoxAction(async () => {
      if (!state.open) {
        const result = await window.api.timeWidgetOpen(config)
        if (!result.ok) return result
      }
      return window.api.timeWidgetTestGift(kind === 'add' ? config.addGift : config.subGift)
    })
  }

  const previewZero = !!(state.zeroed && config.zeroText)
  const previewValue = previewZero
    ? config.zeroText
    : config.showSeconds
      ? String(config.showNegative ? state.remaining : Math.max(0, state.remaining))
      : formatTime(state.remaining, config.showNegative)
  const previewSize = config.theme === 'legacy_frame'
    ? { width: 716, height: 294 }
    : config.theme?.startsWith('legacy')
      ? { width: 252, height: 103 }
      : { width: FRAME_W, height: FRAME_H }
  // 时间字号跟着字数收缩，长成「1天02:03:04」或归零文字也不会撑出时间框
  const previewTimeSize = (() => {
    const base = String(config.theme || '').startsWith('legacy') ? (config.theme === 'legacy_cyan' ? 58 : 64) : 58
    const width = previewSize.width * 0.9
    if (previewZero) {
      const units = Array.from(previewValue).reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? 1 : 0.62), 0)
      const safeHeight = previewSize.height * FRAME_LAYOUT.zeroTimeHeight / 100
      return Math.max(10, Math.min(base, Math.floor(safeHeight / 1.3), Math.floor(width / Math.max(1, units))))
    }
    const est = previewValue.length * base * 0.56
    return Math.max(14, Math.min(base, Math.floor(base * (est > width ? width / est : 1))))
  })()
  const legacyTheme = String(config.theme || '').startsWith('legacy')
  const selectedPet = petSkin(config.theme)
  const previewTextShadow = ['paper', 'sakura', 'ticket', 'glacier'].includes(config.theme) ? 'none' : undefined
  // 换主题 = 换整套配色（面板描边、标题、礼物栏文字），换完仍可单独调任意一项
  const applyTheme = (id: string) => {
    if (id.startsWith('legacy')) return update({ theme: id })
    const theme = themeById(id)
    update({
      theme: id,
      titleColor: theme.titleColor,
      timeColor: theme.timeColor,
      giftNameColor: theme.giftNameColor,
      addColor: theme.addColor,
      subColor: theme.subColor,
      boxColor: theme.boxColor,
      cellBg: theme.cellBg,
      cellBorder: theme.cellBorder
    })
  }
  const giftRows = (config.gifts ?? []).filter((gift) => gift.name.trim())
  // 上屏预览只画「屏幕显示」开着的；关掉的照样触发，只是不上挂件
  const visibleGiftRows = giftRows.filter((gift) => gift.showOnPanel !== false)
  const giftImageOf = (gift: TimeWidgetGift): string =>
    gift.img ? (/^(?:https?:|data:|file:|zlmedia:)/i.test(gift.img) ? gift.img : toMedia(gift.img)) : giftImages[normalizeGiftName(gift.name)] || ''
  const setGift = (index: number, patch: Partial<TimeWidgetGift>) =>
    update({ gifts: (config.gifts ?? []).map((gift, i) => (i === index ? { ...gift, ...patch } : gift)) })
  const addGiftRow = () => {
    update({ gifts: [...(config.gifts ?? []), { name: '', op: '加减', seconds: 30, seconds2: null, text: '', img: '', video: '', videoLoop: false, videoSeconds: 0 }] })
  }
  const removeGiftRow = (index: number) =>
    update({ gifts: (config.gifts ?? []).filter((_, i) => i !== index) })
  const moveGiftRow = (index: number, delta: number) => {
    const list = [...(config.gifts ?? [])]
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const [item] = list.splice(index, 1)
    list.splice(target, 0, item)
    update({ gifts: list })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div hidden={level!=='basic'}><TimeSetupGuide config={config} state={state} hasSavedSettings={hasSavedSettings} onApply={update} onOpen={async()=>{const next={...config,enable:true};const r=await window.api.timeWidgetOpen(next);if(r.ok)await update({enable:true,on:true});await refresh();return r}} onClose={async()=>{await window.api.timeWidgetClose();await update({on:false});await refresh()}} onMore={()=>{setAllSettingsOpen(true);setTimeout(()=>document.querySelector('[data-time-settings]')?.scrollIntoView({block:'start',behavior:'smooth'}),0)}} onImportProject={()=>setProjectSetupOpen(true)}/></div>
      {projectSetupOpen&&<TimeProjectSetup config={config} onClose={()=>setProjectSetupOpen(false)} onApply={update}/>}
      <details data-time-settings open={level==='advanced'||allSettingsOpen} onToggle={e=>{if(level==='basic')setAllSettingsOpen(e.currentTarget.open)}}>
      <summary className="cursor-pointer py-3 text-sm font-medium text-[var(--text-2)]">已有设置、时间盲盒和外观（点击展开）</summary>
      <ExpandedConfiguration><Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-base font-semibold text-[var(--text)]">
            <Clock size={17} className="text-[var(--accent-2)]" /> 时间插件 · 倒计时
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn size="sm" variant="secondary" onClick={save} title="保存当前倒计时设置"><Save size={13} /> 保存</Btn>
            <Btn size="sm" variant="secondary" onClick={() => void testGift('add')} disabled={testBusy} title="按当前加时礼物测试"><Plus size={13} /> 测试加时</Btn>
            <Btn size="sm" variant="secondary" onClick={() => void testGift('sub')} disabled={testBusy} title="按当前减时礼物测试"><Minus size={13} /> 测试减时</Btn>
            <Btn size="sm" variant={state.open ? 'secondary' : 'primary'} onClick={toggleWindow} title="打开或关闭直播采集窗口"><MonitorPlay size={13} /> {state.open ? '关闭' : '开启'}</Btn>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2" aria-label="基础配置">
          <Field label="标题"><Input value={config.title} onChange={(event) => update({ title: event.target.value })} /></Field>
          <Field label="初始时间（秒）"><Input type="number" value={config.initial} onChange={(event) => update({ initial: Number(event.target.value) || 0 })} /></Field>
        </div>

        <AdvancedSection title="浏览全部时间皮肤"><div className="mb-4 grid grid-cols-3 gap-2 min-[1180px]:grid-cols-6" aria-label="时间皮肤画廊">
          {COUNTDOWN_THEMES.filter((theme) => petSkin(theme.id) || ['theatre','arcade','aurora','sakura','ticket','terminal','nebula','sunset','gilded','glacier','graphite'].includes(theme.id)).map((theme) => <Btn key={theme.id} variant="secondary" size="sm"
            aria-label={`时间皮肤：${theme.name}`} aria-pressed={config.theme === theme.id} onClick={() => applyTheme(theme.id)}
            className={`!block !p-2 ${config.theme === theme.id ? '!border-[var(--accent)] !bg-[var(--accent-soft)]' : ''}`}>
            {petSkin(theme.id) ? <PetSkinThumbnail id={theme.id}/> : <span className="relative block aspect-[252/103] w-full"><img src={frameDataUri(theme.style)} alt="" className="absolute inset-0 h-full w-full" />
              <span className="absolute inset-x-[18%] top-[19%] text-center text-[8px] font-medium" style={{color:theme.titleColor}}>直播倒计时</span>
              <span className="tnum absolute inset-x-1 top-[50%] text-center text-xs font-bold" style={{color:theme.timeColor}}>01:28:30</span>
            </span>}<span className="mt-1 block text-[11px]">{theme.name}</span>
            {['nebula','sunset','gilded','glacier','graphite'].includes(theme.id) && <span className="block text-[10px] font-normal text-[var(--text-3)]">{['nebula','sunset','gilded'].includes(theme.id) ? '动态' : '静态'}</span>}
          </Btn>)}
        </div></AdvancedSection>
        <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_210px] lg:items-center">
          <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3" data-testid="time-preview">
            {selectedPet ? <PetCountdownPreview config={config} value={previewValue} zeroed={previewZero} giftImage={giftImageOf} giftText={effectText} giftColor={gift=>effectColor(gift,config)} background={previewSource(config)}/> : <>
            <div className="mx-auto max-w-full" style={{ width: previewSize.width }}>
              <div data-countdown-theme={config.theme} className="countdown-motion-head relative w-full overflow-hidden" style={{ aspectRatio: `${previewSize.width}/${previewSize.height}` }}>
                <img src={previewSource(config)} alt="" className="absolute inset-0 h-full w-full object-fill" />
                <div className="absolute flex items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap text-center font-bold [text-shadow:-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000]" style={{ left: legacyTheme ? '6%' : '18%', right: legacyTheme ? '6%' : '18%', top: legacyTheme ? '9%' : `${FRAME_LAYOUT.titleTop}%`, height: legacyTheme ? '25%' : `${FRAME_LAYOUT.titleHeight}%`, color: config.titleColor, fontSize: legacyTheme ? 17 : 19, textShadow: previewTextShadow }}>{config.title}</div>
                <div data-testid="time-preview-value" className="absolute flex items-center justify-center overflow-hidden whitespace-nowrap text-center font-extrabold leading-none [text-shadow:-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000]" style={{ left: '4%', right: '4%', top: previewZero ? `${FRAME_LAYOUT.zeroTimeTop}%` : legacyTheme ? '35%' : `${FRAME_LAYOUT.timeTop}%`, height: previewZero ? `${FRAME_LAYOUT.zeroTimeHeight}%` : legacyTheme ? '55%' : `${FRAME_LAYOUT.timeHeight}%`, color: config.timeColor, fontSize: previewTimeSize, textShadow: previewTextShadow }}>{previewValue}</div>
              </div>
              {/* 礼物栏：配几个显示几个，和挂件端同一套排版（整块板+1px 分隔线） */}
              {config.giftPanel !== false && visibleGiftRows.length > 0 && (
                <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${config.giftColumns || 2},1fr)`, background: config.cellBorder || '#3a3a40' }}>
                  {visibleGiftRows.map((gift, index) => (
                    <div key={index} className="flex min-w-0 items-center gap-2 px-1.5 py-1" style={{ background: hexToRgba(config.cellBg, config.cellAlpha ?? 0.92) }}>
                      <div className="shrink-0 overflow-hidden" style={{ width: config.giftIconSize || 40, height: config.giftIconSize || 40 }}>
                        {giftImageOf(gift) && <img src={giftImageOf(gift)} alt="" className="h-full w-full object-contain" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold leading-tight [text-shadow:-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000]" style={{ color: config.giftNameColor || '#fff', fontSize: config.giftNameSize || 15, textShadow: previewTextShadow }}>{gift.name}</div>
                        <div className="my-0.5 h-px bg-[#d8d8d8] opacity-75" />
                        <div className="truncate font-bold leading-tight [text-shadow:-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000]" style={{ color: effectColor(gift, config), fontSize: config.giftTextSize || 15, textShadow: previewTextShadow }}>{effectText(gift)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-[11px] text-[var(--text-4)]">窗口</div><div className="mt-1 font-medium text-[var(--text)]">{state.open ? '已开启' : '已关闭'}</div></div>
            <div><div className="text-[11px] text-[var(--text-4)]">计时</div><div className="mt-1 font-medium text-[var(--text)]">{state.running ? '进行中' : '已停止'}</div></div>
            <div><div className="text-[11px] text-[var(--text-4)]">剩余</div><div className="mt-1 font-mono font-medium text-[var(--text)]">{formatTime(state.remaining, config.showNegative)}</div></div>
            <div><div className="text-[11px] text-[var(--text-4)]">礼物</div><div className="mt-1 font-medium text-[var(--text)]">{liveGifts.length + cachedGifts.length} 个</div></div>
          </div>
        </div>

        <AdvancedSection title="方案与导入导出"><div className="mb-4 flex flex-wrap items-center gap-2 border-y border-[var(--line)] py-3">
          <Input value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="方案名" className="w-32" />
          <Btn size="sm" variant="secondary" onClick={savePlan} title="保存当前倒计时方案"><Save size={12} /> 保存方案</Btn>
          <Select value={planPick} onChange={(event) => event.target.value ? loadPlan(event.target.value) : setPlanPick('')} className="w-40">
            <option value="">选择已保存方案</option>
            {plans.map((plan) => <option key={plan.name} value={plan.name}>{plan.name}</option>)}
          </Select>
          {planPick && <Btn size="sm" variant="ghost" onClick={deletePlan} title="删除当前方案"><X size={13} /></Btn>}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <Btn size="sm" variant="secondary" onClick={exportSettings} title="把倒计时设置和全部方案导出成 JSON"><Download size={12} /> 导出设置</Btn>
          <Btn size="sm" variant="secondary" onClick={() => settingsFileRef.current?.click()} title="从 JSON 导入设置和方案"><Upload size={12} /> 导入设置</Btn>
          <input
            ref={settingsFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importSettings(file) }}
          />
        </div></AdvancedSection>

        <div className="grid gap-4 md:grid-cols-2">


          <Field advanced label="时钟周期（毫秒）"><Input type="number" min="50" value={config.clockSpeed} onChange={(event) => update({ clockSpeed: Number(event.target.value) || 1000 })} /></Field>
          <Field label="归零文字"><Input value={config.zeroText} onChange={(event) => update({ zeroText: event.target.value })} /></Field>

          <Field label="主题面板" hint="换主题会套用整套配色，颜色仍可单独改">
            <Select aria-label="时间皮肤" value={config.theme} onChange={(event) => applyTheme(event.target.value)}>
              {COUNTDOWN_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              <option value="legacy_cyan">经典 · 青蓝</option>
              <option value="legacy_orange">经典 · 橙色</option>
              <option value="legacy_frame">经典 · 宽横幅</option>
            </Select>
          </Field>
          <Field advanced label="背景图">
            <div className="flex gap-2"><Input value={config.bgImage} readOnly placeholder="使用主题面板" className="flex-1 text-xs" /><Btn size="sm" variant="secondary" onClick={pickBg} title="选择背景图"><FolderOpen size={12} /></Btn>{config.bgImage && <Btn size="sm" variant="ghost" onClick={() => update({ bgImage: '' })} title="清除背景图"><X size={12} /></Btn>}</div>
          </Field>

          <Field advanced label="标题颜色">
            <div className="flex gap-2"><input type="color" value={config.titleColor} onChange={(event) => update({ titleColor: event.target.value })} className="h-9 w-11 cursor-pointer rounded border border-[var(--line)] bg-[var(--bg-input)]" /><Input value={config.titleColor} onChange={(event) => update({ titleColor: event.target.value })} /></div>
          </Field>
          <Field advanced label="时间颜色">
            <div className="flex gap-2"><input type="color" value={config.timeColor} onChange={(event) => update({ timeColor: event.target.value })} className="h-9 w-11 cursor-pointer rounded border border-[var(--line)] bg-[var(--bg-input)]" /><Input value={config.timeColor} onChange={(event) => update({ timeColor: event.target.value })} /></div>
          </Field>
        </div>

        <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={config.enable} onChange={(enable) => update({ enable })} />开启倒计时功能</label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={config.autoHide} onChange={(autoHide) => update({ autoHide })} />归零后自动隐藏</label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={config.showGift} onChange={(showGift) => update({ showGift })} />显示礼物信息</label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={config.showNegative} onChange={(showNegative) => update({ showNegative })} />显示负数</label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={config.showSeconds} onChange={(showSeconds) => update({ showSeconds })} />显示原始秒数</label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]" title="挂件下面多一条：谁（带头像）送了什么礼物、抽到多少时间"><Toggle value={config.giftTicker === true} onChange={(giftTicker) => update({ giftTicker })} />送礼滚动条</label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]" title="单行显示昵称、礼物和时间变化，配色跟随倒计时">
            <Toggle value={timeLogOpen} onChange={(on) => void toggleTimeLog(on)} />抽时间记录窗口
          </label>
        </div>

        {/* 指定播放窗口：礼物视频和盲盒视频都在这个绿幕播（以前写死 4 号，主播没采那个窗口就以为「视频没播」） */}
        <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="指定播放窗口" hint="礼物栏里配的视频、盲盒抽中的视频都在这个窗口播；直播伴侣里要采它">
            <Select aria-label="指定播放窗口" value={String(config.boxVideoSlot || 4)} onChange={(e) => update({ boxVideoSlot: Number(e.target.value) })}>
              <option value="1">绿幕 1</option>
              <option value="2">绿幕 2</option>
              <option value="3">绿幕 3</option>
              <option value="4">绿幕 4</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-[var(--text-2)]" title="关掉就只在上面那个窗口排队等">
            <Toggle value={config.boxVideoOverflow !== false} onChange={(boxVideoOverflow) => update({ boxVideoOverflow })} />本窗口忙时去别的窗口
          </label>
          <Field advanced label="记录窗口显示条数" hint="只显示今天最近的这几条，新的顶掉旧的">
            <Input aria-label="记录窗口显示条数" type="number" min="1" max="30" value={config.logRows ?? 8} onChange={(event) => update({ logRows: Math.max(1, Math.min(30, Number(event.target.value) || 8)) })} />
          </Field>
        </div>

        {/* 挂件礼物栏：加几个显示几个；每格可关「屏幕显示」（关了照样触发，不上屏） */}
        <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-[var(--text)]">礼物触发</div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-3)]"><Toggle value={config.giftPanel !== false} onChange={(giftPanel) => update({ giftPanel })} />显示礼物栏</label>
              <Segmented size="sm" value={String(config.giftColumns || 2)} onChange={(v) => update({ giftColumns: Number(v) })} options={[{ value: '1', label: '1列' }, { value: '2', label: '2列' }, { value: '3', label: '3列' }]} />
              <Btn size="sm" variant="secondary" onClick={addGiftRow} title="再加一格"><Plus size={12} /> 添加礼物</Btn>
            </div>
          </div>
          <div className="space-y-2">
            {giftRows.length === 0 && (config.gifts ?? []).length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--line)] px-3 py-4 text-center text-xs text-[var(--text-4)]">还没有礼物，点「添加礼物」加一格</div>
            )}
            {(config.gifts ?? []).map((gift, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-card)] px-2 py-2" data-testid="time-gift-row">
                <span className="w-5 text-center text-[11px] font-bold text-[var(--text-4)]">{index + 1}</span>
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-black/20">
                  {giftImageOf(gift) && <img src={giftImageOf(gift)} alt="" className="h-full w-full object-contain" />}
                </div>
                <Input aria-label={`礼物 ${index + 1} 名称`} value={gift.name} list="time-real-gifts" onChange={(event) => setGift(index, { name: event.target.value })} placeholder="礼物名" className="w-32" />
                <Select aria-label={`礼物 ${index + 1} 触发方式`} value={gift.mode || 'direct'} onChange={event => setGift(index, { mode: event.target.value as TimeWidgetGift['mode'] })} className="w-28"><option value="direct">直接改时间</option><option value="blindbox">抽时间盲盒</option></Select>
                {gift.mode !== 'blindbox' && <><Select aria-label={`礼物 ${index + 1} 运算`} value={gift.op} onChange={(event) => setGift(index, { op: event.target.value as TimeGiftOp })} className="w-20">
                  {GIFT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                </Select>
                <Input type="number" value={gift.seconds} onChange={(event) => setGift(index, { seconds: Number(event.target.value) || 0 })} placeholder="数值" className="w-20" title="加减=秒数，乘/除=倍数，范围=目标值" />
                {gift.op !== '清零' && (
                  <Input type="number" value={gift.seconds2 ?? ''} onChange={(event) => setGift(index, { seconds2: event.target.value === '' ? null : Number(event.target.value) || 0 })} placeholder="到" className="w-20" title="终点：留空=固定值，填了=区间随机" />
                )}
                <Input value={gift.text ?? ''} onChange={(event) => setGift(index, { text: event.target.value })} placeholder="自定义文字" className="w-24" title="留空自动生成" />
                <div className="flex min-w-[210px] flex-1 items-center gap-1">
                  <Input value={gift.video ?? ''} readOnly placeholder="对应绿幕视频（可选）" className="min-w-0 flex-1 text-xs" title="收到这个礼物时在「指定播放窗口」播放" />
                  <Btn size="sm" variant="secondary" onClick={() => void pickGiftVideo(index)} title="选择对应绿幕视频"><FolderOpen size={12} /></Btn>
                  {gift.video && <Btn size="sm" variant="ghost" onClick={() => setGift(index, { video: '' })} title="清除视频"><X size={12} /></Btn>}
                </div>
                {gift.video && <label className="flex items-center gap-1 text-[11px] text-[var(--text-3)]" title="关闭后视频播完自动关闭绿幕窗口"><Toggle value={gift.videoLoop === true} onChange={(videoLoop) => setGift(index, { videoLoop })} />循环</label>}
                {gift.video && <Input type="number" min="0" value={gift.videoSeconds ?? 0} onChange={(event) => setGift(index, { videoSeconds: Math.max(0, Number(event.target.value) || 0) })} placeholder="秒" className="w-16" title="播放秒数，0 表示不强制，到视频结束关闭" />}</>}
                {gift.mode === 'blindbox' && <Input value={gift.text ?? ''} onChange={event => setGift(index, { text: event.target.value })} placeholder="时间盲盒" aria-label={`礼物 ${index + 1} 显示文字`} className="w-28" />}
                <span className="min-w-[52px] text-right text-[11px] font-bold" style={{ color: effectColor(gift, config) }}>{effectText(gift)}</span>
                <div className="ml-auto flex items-center gap-1">
                  <label className="flex items-center gap-1 text-[11px] text-[var(--text-3)]" title="关掉后这个礼物照样触发计时，只是不上挂件的礼物栏"><Toggle value={gift.showOnPanel !== false} onChange={(showOnPanel) => setGift(index, { showOnPanel })} />屏幕显示</label>
                  <Btn size="sm" variant="secondary" onClick={() => void runBlindBoxAction(() => window.api.timeWidgetTestGift(gift.name))} disabled={testBusy || !gift.name.trim()} aria-label={`测试礼物 ${gift.name || index + 1}`} title={gift.mode === 'blindbox' ? '按当前奖池抽一次' : '测试这格'}><Zap size={12} />{gift.mode === 'blindbox' ? '抽一次' : '测试'}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => moveGiftRow(index, -1)} disabled={index === 0} title="上移"><ArrowUp size={12} /></Btn>
                  <Btn size="sm" variant="ghost" onClick={() => moveGiftRow(index, 1)} disabled={index === (config.gifts ?? []).length - 1} title="下移"><ArrowDown size={12} /></Btn>
                  <Btn size="sm" variant="ghost" onClick={() => removeGiftRow(index)} title="删除这格"><X size={12} /></Btn>
                </div>
                {gift.mode === 'blindbox' && <TimeBlindBoxPool gift={gift} events={config.blindBoxEvents || []} onChange={blindBoxEventIds => setGift(index, { blindBoxEventIds })} />}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-[var(--text-4)]">本场已识别 {liveGifts.length} 个礼物，本地缓存 {cachedGifts.length} 张礼物图。盲盒使用所抽事件的视频、音效和运算。</div>
          {giftLog.length > 0 && (
            <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--bg-card)] p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-2)]">送时间记录</span>
                <Btn size="sm" variant="ghost" onClick={async () => { await window.api.timeWidgetLogClear(); await refresh() }} title="清空记录"><X size={12} /></Btn>
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {giftLog.slice(0, 30).map((entry, index) => (
                  <div key={`${entry.ts}-${index}`} className="flex items-center gap-2 px-1 py-0.5 text-[11px] text-[var(--text-3)]">
                    <span className="tnum shrink-0 text-[var(--text-4)]">{new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                    <span className="min-w-0 flex-1 truncate" title={entry.error || entry.eventName}><EmojiText text={entry.sender || '观众'} /> 送出「<EmojiText text={entry.name} />」{entry.source === 'test' ? '（测试）' : ''}{entry.eventName ? ` → ${entry.eventName}` : ''}{entry.error && <span className="ml-1 text-[var(--danger)]">{entry.error}</span>}</span>
                    <span className={`tnum shrink-0 font-bold ${entry.delta > 0 ? 'text-[var(--ok)]' : entry.delta < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-4)]'}`}>{entry.delta > 0 ? `+${entry.delta}` : entry.delta} 秒</span>
                    <span className="tnum shrink-0 text-[var(--text-4)]">剩 {entry.remaining}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <TimeBlindBoxEditor
          events={config.blindBoxEvents || []} gifts={config.gifts || []} state={state} busy={testBusy} error={blindBoxError}
          onChange={blindBoxEvents => update({ blindBoxEvents })} onRemove={removeBlindBoxEvent}
          onTest={id => void runBlindBoxAction(() => window.api.timeWidgetTestEvent(id))}
          onCancel={() => void runBlindBoxAction(async () => {
            const result = await window.api.timeWidgetCancelQueue()
            if (result.ok) toast(`已停止盲盒，取消 ${result.cancelled} 项`, 'info')
            return result
          })}
        />

        <AdvancedSection title="默认加时与减时规则" hint={`当前：${config.addGift||"未设置加时礼物"} ${config.addSeconds} 秒；${config.subGift||"未设置减时礼物"} ${config.subSeconds} 秒。已配置规则继续生效。`}><div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-medium text-[var(--text)]">默认加时/减时礼物</div><div className="text-xs text-[var(--text-4)]">本场已识别 {liveGifts.length} 个，已缓存 {cachedGifts.length} 个</div></div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="增加时间礼物"><Input value={config.addGift} list="time-real-gifts" onChange={(event) => update({ addGift: event.target.value })} placeholder="礼物名" /></Field>
            <Field label="增加时间秒数"><Input type="number" value={config.addSeconds} onChange={(event) => update({ addSeconds: Number(event.target.value) || 0 })} /></Field>
            <Field label="增加运算方式">
              <Select value={config.addOp || '加减'} onChange={(event) => update({ addOp: event.target.value as CountdownOp })}>
                {COUNTDOWN_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
              </Select>
            </Field>
            <Field label="增加区间终点（留空=固定值）"><Input type="number" value={config.addSeconds2 ?? ''} onChange={(event) => update({ addSeconds2: event.target.value === '' ? null : Number(event.target.value) || 0 })} /></Field>
            <Field label="减少时间礼物"><Input value={config.subGift} list="time-real-gifts" onChange={(event) => update({ subGift: event.target.value })} placeholder="礼物名" /></Field>
            <Field label="减少时间秒数"><Input type="number" value={config.subSeconds} onChange={(event) => update({ subSeconds: Number(event.target.value) || 0 })} /></Field>
            <Field label="减少运算方式">
              <Select value={config.subOp || '加减'} onChange={(event) => update({ subOp: event.target.value as CountdownOp })}>
                {COUNTDOWN_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
              </Select>
            </Field>
            <Field label="减少区间终点（留空=固定值）"><Input type="number" value={config.subSeconds2 ?? ''} onChange={(event) => update({ subSeconds2: event.target.value === '' ? null : Number(event.target.value) || 0 })} /></Field>
          </div>
          <datalist id="time-real-gifts">{giftNames.map((name) => <option key={name} value={name} />)}</datalist>
        </div></AdvancedSection>

        <AdvancedSection title="计时联动热键"><div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4 md:grid-cols-2">
          {(['startHotkey', 'endHotkey'] as const).map((which) => {
            const hotkey = config[which]
            const isStart = which === 'startHotkey'
            return <div key={which} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
              <label className="col-span-2 flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={hotkey.enabled} onChange={(enabled) => updateHotkey(which, { enabled })} />{isStart ? '计时开始时执行热键' : '计时结束时执行热键'}</label>
              <Field label="功能键"><Select value={hotkey.func} onChange={(event) => updateHotkey(which, { func: event.target.value })}>{HOTKEY_FUNCS.map((name) => <option key={name} value={name}>{name}</option>)}</Select></Field>
              <Field label="主键"><Input value={hotkey.key} onChange={(event) => updateHotkey(which, { key: event.target.value })} placeholder="如 F2" /></Field>
            </div>
          })}
        </div></AdvancedSection>

        <div className="mt-4 border-t border-[var(--line)] pt-4 text-sm leading-6 text-[var(--text-3)]">
          <div className="font-medium text-[var(--text-2)]">用法：</div>
          <div>1. 直播伴侣里设置禁麦/开麦热键</div>
          <div>2. 在「计时联动热键」中设置和伴侣一样的热键</div>
        </div>

        {/* 挂件外观：礼物格配色、字号、图标大小、整体缩放 */}
        <AdvancedSection title="外观微调"><div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <div className="mb-3 text-sm font-medium text-[var(--text)]">挂件外观</div>
          {selectedPet&&<label className="mb-4 flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={config.petMotion!==false} onChange={petMotion=>update({petMotion})}/>萌宠小动作</label>}
          {selectedPet&&<div className="mb-4 max-w-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-3)]">
              <span>边上吊饰大小</span>
              <span className="tnum text-[var(--text-2)]">{Number(config.charmScale ?? 0.7).toFixed(2)}</span>
            </div>
            <input type="range" min={0.2} max={2} step={0.02} value={Number(config.charmScale ?? 0.7)} onChange={(event) => update({ charmScale: Number(event.target.value) })} className="w-full accent-[var(--accent)]" />
          </div>}
          <div className="grid gap-4 md:grid-cols-2">
            {([
              ['giftNameColor', '礼物名颜色'],
              ['addColor', '加时文字颜色'],
              ['subColor', '减时文字颜色'],
              ['boxColor', '范围文字颜色'],
              ['cellBg', '礼物格底色'],
              ['cellBorder', '礼物格边框色']
            ] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <div className="flex gap-2">
                  <input type="color" value={config[key] || '#ffffff'} onChange={(event) => update({ [key]: event.target.value } as Partial<TimeWidgetConfig>)} className="h-9 w-11 cursor-pointer rounded border border-[var(--line)] bg-[var(--bg-input)]" />
                  <Input value={config[key] || ''} onChange={(event) => update({ [key]: event.target.value } as Partial<TimeWidgetConfig>)} />
                </div>
              </Field>
            ))}
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {([
              ['giftNameSize', '礼物名字号', 8, 40, 1],
              ['giftTextSize', '效果文字号', 8, 40, 1],
              ['giftIconSize', '礼物图大小', 16, 96, 2],
              ['cellAlpha', '礼物格底色透明度', 0, 1, 0.02],
              ['scale', '挂件整体缩放', 0.4, 4, 0.05]
            ] as const).map(([key, label, min, max, step]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-3)]">
                  <span>{label}</span>
                  <span className="tnum text-[var(--text-2)]">{config[key] ?? ''}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={Number(config[key] ?? 0)} onChange={(event) => update({ [key]: Number(event.target.value) } as Partial<TimeWidgetConfig>)} className="w-full accent-[var(--accent)]" />
              </div>
            ))}
          </div>
        </div></AdvancedSection>

        <div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4 md:grid-cols-2">
          <Field advanced label="初始位置 X"><Input type="number" value={config.posX} onChange={(event) => update({ posX: Number(event.target.value) || 0 })} /></Field>
          <Field advanced label="初始位置 Y"><Input type="number" value={config.posY} onChange={(event) => update({ posY: Number(event.target.value) || 0 })} /></Field>
        </div>

        <div className="mt-4 flex justify-end border-t border-[var(--line)] pt-4"><Btn size="sm" variant="ghost" onClick={async () => { await window.api.timeWidgetClear(); await refresh() }} title="清零并停止当前倒计时"><X size={13} /> 清零</Btn></div>
      </Card></ExpandedConfiguration>
      </details>
    </div>
  )
}
