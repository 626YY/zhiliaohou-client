import SkinPicker from '../components/SkinPicker'
import EmojiText from '../components/EmojiText'
import {ExpandedConfiguration} from '../lib/configurationLevel'
import { widgetSkin, type WidgetSkinId } from '@shared/widgetSkins'
﻿import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw, ImagePlus, X, Save, FolderOpen, Gift, Film, Search, ArrowDown, ArrowUp, Plus, Trash2, Database, Upload, Gamepad2, Copy, ListChecks } from 'lucide-react'
import { Btn, Card, Field, Input, Select, Segmented, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES, DOUYIN_GIFTS, isRealDouyinGift } from '../data/douyinGifts'
import { encodeGif } from '../utils/gifEncoder'
import type { EntertainmentGiftImage, TransparentColorRecord, TransparentGiftVersion } from '@shared/types'
import { ruleActionLabel } from '@shared/entertainmentLabels'

const PROGRAMS_KEY = 'ent-transparent-programs'
const GIFT_LIBRARY_KEY = 'ent-transparent-gift-library-v1'
const TEXT_MENU_PROGRAMS_KEY = 'ent-transparent-text-menu-programs-v1'
const IMAGE_MENU_PROGRAMS_KEY = 'ent-transparent-image-menu-programs-v1'
const LIST_MENU_PROGRAMS_KEY = 'ent-transparent-list-menu-programs-v1'
const LIST_MENU_STYLE_KEY = 'ent-transparent-list-menu-style-v1'
const GIFT_VERSIONS_KEY = 'ent-transparent-gift-versions-v1'
const COLORS_KEY = 'ent-transparent-colors-v1'

const SCALES = [
  { value: '1080x1920(竖)', w: 1080, h: 1920 },
  { value: '750x1334(竖)', w: 750, h: 1334 },
  { value: '1280x720(横)', w: 1280, h: 720 },
  { value: '1920x1080(横)', w: 1920, h: 1080 },
  { value: '1920x480(横幅)', w: 1920, h: 480 },
  { value: '1080x256(横幅)', w: 1080, h: 256 }
]
const GIFT_PLATFORMS = [
  { value: 'dy', label: '抖音' },
  { value: 'ks', label: '快手' },
  { value: 'bz', label: '哔哩哔哩' },
  { value: 'sph', label: '视频号' },
  { value: 'tk', label: 'TikTok' }
] as const
type GiftPlatform = (typeof GIFT_PLATFORMS)[number]['value']
type GiftLibraryItem = {
  id: string
  platform: GiftPlatform
  name: string
  giftId: string
  diamondCount: number
  giftData: string
  giftDataBase64?: string
  imagePath: string
  imageName: string
  // 这个礼物对应什么整蛊/什么效果，礼物菜单的正文就是它
  effect?: string
}
// text=纯文字清单，image=图片宫格，list=图标+礼物名→效果 的竖列（做整蛊菜单用这个）
type GiftMenuMode = 'text' | 'image' | 'list'
type GiftMenuProgram = {
  name: string
  program: string
  listPro: GiftLibraryItem[]
  giftProBase64?: string
}
type GiftMenuDraft = {
  title: string
  items: GiftLibraryItem[]
}
type GiftMenuItemsUpdate = GiftLibraryItem[] | ((previous: GiftLibraryItem[]) => GiftLibraryItem[])
type GiftMergeMode = 'overwrite' | 'skip'
type MergeStats = { added: number; replaced: number; skipped: number }
const FONTS = ['微软雅黑', '宋体', '黑体', '楷体', '隶书', 'Arial', 'Impact']
const ALIGNS = [
  { value: 'center', label: '居中' },
  { value: 'left', label: '左对齐' },
  { value: 'right', label: '右对齐' },
  { value: 'top', label: '顶格' }
]
// 序号样式（复刻参考「添加序号」多样式）
const NUM_STYLES = [
  { value: 'dot', label: '1.' },
  { value: 'cn', label: '1、' },
  { value: 'circle', label: '①' }
]
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const DOUYIN_PRICES = new Map(DOUYIN_GIFTS.map((gift) => [normalizedLabel(gift.name), gift.price]))

// 表情库（复刻参考软件「表情：点击自动复制，上千emoji」）——按 Unicode 码点段程序化生成，共 1300+
const EMOJI_RANGES: [number, number][] = [
  [0x1f600, 0x1f64f], // 表情
  [0x1f300, 0x1f5ff], // 符号与图形
  [0x1f680, 0x1f6c5], // 交通
  [0x1f900, 0x1f9ff], // 补充符号
  [0x1fa70, 0x1faf8], // 扩展-A
  [0x2600, 0x26ff], // 杂项符号
  [0x2700, 0x27bf], // 装饰符号
  [0x1f1e6, 0x1f1ff] // 区域指示（旗帜字母）
]
function buildEmojis(): string[] {
  const out: string[] = []
  for (const [a, b] of EMOJI_RANGES) {
    for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c))
  }
  return out
}

function asGiftItem(value: unknown, index = 0): GiftLibraryItem | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const string = (key: string) => typeof raw[key] === 'string' ? raw[key] : ''
  const name = string('name').trim()
  if (!name) return null
  const savedPlatform = string('platform')
  const platform = GIFT_PLATFORMS.some((item) => item.value === savedPlatform) ? savedPlatform as GiftPlatform : 'dy'
  const count = Number(raw.diamondCount)
  return {
    id: string('id') || `gift-${Date.now()}-${index}`,
    platform,
    name,
    giftId: string('giftId'),
    diamondCount: Number.isFinite(count) && count > 0 ? count : 0,
    giftData: string('giftData'),
    giftDataBase64: string('giftDataBase64') || undefined,
    imagePath: string('imagePath'),
    imageName: string('imageName'),
    // 「对应什么整蛊」是礼物菜单的正文，存取都不能丢
    effect: string('effect')
  }
}

function asGiftMenuProgram(value: unknown): GiftMenuProgram | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.name !== 'string' || !raw.name.trim() || !Array.isArray(raw.listPro)) return null
  return {
    name: raw.name.trim(),
    program: typeof raw.program === 'string' ? raw.program : '',
    listPro: raw.listPro.map((item, index) => asGiftItem(item, index)).filter((item): item is GiftLibraryItem => !!item),
    giftProBase64: typeof raw.giftProBase64 === 'string' ? raw.giftProBase64 : undefined
  }
}

function asGiftVersion(value: unknown): TransparentGiftVersion | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const version = Number(raw.version)
  if (!name || !Number.isFinite(version)) return null
  return { name, version }
}

function asColorRecord(value: unknown): TransparentColorRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return null
  return {
    name,
    value: typeof raw.value === 'string' ? raw.value : '',
    valueBase64: typeof raw.valueBase64 === 'string' && raw.valueBase64 ? raw.valueBase64 : undefined
  }
}

function loadOptionalRecords<T>(key: string, normalize: (value: unknown) => T | null): T[] | undefined {
  const saved = localStorage.getItem(key)
  if (saved == null) return undefined
  try {
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.map(normalize).filter((item): item is T => !!item) : undefined
  } catch {
    return undefined
  }
}

function normalizedLabel(value: string): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function giftIdentity(item: Pick<GiftLibraryItem, 'platform' | 'name'>): string {
  return `${item.platform}\u0000${normalizedLabel(item.name)}`
}

function namedIdentity(item: { name: string }): string {
  return normalizedLabel(item.name)
}

function mergeRecords<T>(
  current: T[],
  incoming: T[],
  identity: (item: T) => string,
  mode: GiftMergeMode
): { items: T[]; stats: MergeStats } {
  const items = [...current]
  const positions = new Map<string, number>()
  items.forEach((item, index) => positions.set(identity(item), index))
  const stats: MergeStats = { added: 0, replaced: 0, skipped: 0 }
  for (const item of incoming) {
    const key = identity(item)
    const index = positions.get(key)
    if (index == null) {
      positions.set(key, items.length)
      items.push(item)
      stats.added++
    } else if (mode === 'overwrite') {
      items[index] = item
      stats.replaced++
    } else {
      stats.skipped++
    }
  }
  return { items, stats }
}

// Electron 的 file URL 必须对每个路径段编码；直接拼接会让空格、# 和中文文件名失效。
// 本地图片一律走自建的 zlmedia 协议：页面在开发期是 http://localhost，
// 直接写 file:// 会被安全策略拦掉，礼物图全成空白方块。
function mediaUrl(source: string): string {
  const value = String(source || '').trim()
  if (!value) return ''
  if (/^(?:data|https?|blob|zlmedia):/i.test(value)) return value
  const normalized = value.replace(/^file:\/\/+/i, '').split(String.fromCharCode(92)).join('/')
  const encoded = normalized.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `zlmedia://local/${encoded}`
}

// 歌舞单/节目单模板（复刻参考软件「歌舞单/节目单/超长歌舞单/互动节目单/滚动歌舞单」）
const SONGLIST_TEMPLATES: { name: string; text: string }[] = [
  { name: '歌舞单', text: '1. 开场舞\n2. 歌曲《一路生花》\n3. 舞蹈《爱你》\n4. 互动点歌\n5. 合唱《明天会更好》' },
  { name: '节目单', text: '1. 开场舞\n2. 个人独唱\n3. 双人合唱\n4. 舞蹈串烧\n5. 观众互动\n6. 压轴曲目' },
  { name: '超长歌舞单', text: '1. 开场舞\n2. 歌曲《海阔天空》\n3. 舞蹈《极乐净土》\n4. 观众点歌\n5. 情歌对唱\n6. 劲歌热舞\n7. 互动游戏\n8. 经典老歌\n9. 民族舞\n10. 结束曲《难忘今宵》' },
  { name: '互动节目单', text: '1. 开场舞\n2. 歌曲（观众点歌）\n3. 舞蹈（观众投票）\n4. 连麦互动\n5. 抽奖环节\n6. 压轴表演' },
  { name: '滚动歌舞单', text: '↓ 歌舞单 ↓\n1. 开场舞\n2. 歌曲\n3. 舞蹈\n4. 互动\n5. 合唱\n更多节目筹备中' }
]

function hexToRgba(hex: string, a = 1): string {
  let h = String(hex || '').replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6) || '000000', 16)
  if (Number.isNaN(n)) return `rgba(0,0,0,${a})`
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// 两色插值（渐变/对半用）
function lerpColor(c1: string, c2: string, t: number): string {
  const p = (hex: string) => {
    let h = hex.replace('#', '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const n = parseInt(h.slice(0, 6) || 'ffffff', 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const a = p(c1)
  const b = p(c2)
  const m = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${m[0]},${m[1]},${m[2]})`
}

// 稳定伪随机（随机色模式：同一行每帧同色，点「换一批」才重摇）
function seededPick<T>(arr: T[], seed: number, i: number): T {
  let x = (seed * 9301 + i * 49297 + 233) % 233280
  x = (x * 9301 + 49297) % 233280
  return arr[Math.abs(x) % arr.length]
}

// 这两个小组件必须放在模块顶层：以前定义在组件函数体内，每次渲染都是新引用，React 当成不同组件把整段子树卸载重建——
// 「更多功能」里每敲一个字输入框就失焦、折叠区自动收起（2026-09-07 审计 P0）
const ColorField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-2">
    <input type="color" aria-label={label} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent" />
    <Input value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
)

// 内容库折叠区：礼物库/模板/表情库默认收起，不打断「文字→样式→导出」主配置流
const CollapseSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <details className="group rounded-lg border border-[var(--line)] bg-[var(--bg-elev)]">
    <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs font-medium text-[var(--text-3)] transition hover:text-[var(--text)] [&::-webkit-details-marker]:hidden">
      {title}
      <span className="text-[10px] text-[var(--text-4)] transition group-open:rotate-180">▾</span>
    </summary>
    <div className="px-3 pb-3"><ExpandedConfiguration>{children}</ExpandedConfiguration></div>
  </details>
)

export default function EntertainmentTransparent() {
  const toast = useToast((s) => s.toast)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const scrollPosRef = useRef(0)
  const blinkOnRef = useRef(true)

  // 竖列版式存档：所有用到它的 useState 都在下面，必须先定义（const 有暂时性死区）
  const listStyleSaved = (() => {
    try {
      return JSON.parse(localStorage.getItem(LIST_MENU_STYLE_KEY) || '{}') as Record<string, unknown>
    } catch {
      return {} as Record<string, unknown>
    }
  })()
  const savedNum = (key: string, fallback: number) => typeof listStyleSaved[key] === 'number' ? listStyleSaved[key] as number : fallback
  const savedStr = (key: string, fallback: string) => typeof listStyleSaved[key] === 'string' ? listStyleSaved[key] as string : fallback
  const savedBool = (key: string, fallback: boolean) => typeof listStyleSaved[key] === 'boolean' ? listStyleSaved[key] as boolean : fallback
  const savedEnum = <T extends string>(key: string, allow: readonly T[], fallback: T): T => {
    const value = listStyleSaved[key]
    return typeof value === 'string' && (allow as readonly string[]).includes(value) ? value as T : fallback
  }

  // 基础
  const [scale, setScale] = useState('1080x1920(竖)')
  const [renderMode, setRenderMode] = useState<'text' | 'image' | 'flash'>('text')
  const [text, setText] = useState('感谢你的礼物')
  const [font, setFont] = useState('微软雅黑')
  // 原版 baseinfo 默认：font_size=50、spacing_size=0。
  const [fontSize, setFontSize] = useState(50)
  const [fontScale, setFontScale] = useState(1)
  const [autoFont, setAutoFont] = useState(false)
  const [rotate, setRotate] = useState(0)
  const [visualSkin, setVisualSkin] = useState<string>('custom')
  const [color, setColor] = useState('#ffffff')
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(5)
  const [spacing, setSpacing] = useState(0)
  const [bold, setBold] = useState(true)
  const [lineHeight, setLineHeight] = useState(1.35)
  const [align, setAlign] = useState('center')
  const [autoNumber, setAutoNumber] = useState(false)
  const [numStyle, setNumStyle] = useState('dot')

  // 阴影 / 发光 / 底框
  const [shadowColor, setShadowColor] = useState('#000000')
  const [shadowBlur, setShadowBlur] = useState(0)
  const [glowColor, setGlowColor] = useState('#ffa726')
  const [glowRange, setGlowRange] = useState(0)
  const [boxOn, setBoxOn] = useState(false)
  const [boxColor, setBoxColor] = useState('#000000')
  const [boxAlpha, setBoxAlpha] = useState(0.5)
  const [boxPad, setBoxPad] = useState(20)

  // 背景
  const [bgColor, setBgColor] = useState('#000000')
  const [bgAlpha, setBgAlpha] = useState(0)

  // 多行颜色：单色/循环/随机/渐变/对半（渐变、对半用 色1→色2）
  const [colorMode, setColorMode] = useState<'single' | 'cycle' | 'random' | 'gradient' | 'half' | 'diagonal' | 'split' | 'manual'>('single')
  const DEFAULT_CYCLE = ['#ffffff', '#ffd24a', '#ff8a50', '#4fc3f7', '#a78bfa', '#4ade80', '#f472b6', '#f87171']
  const [cycleColors, setCycleColors] = useState<string[]>(DEFAULT_CYCLE)
  const [gradFrom, setGradFrom] = useState('#ffd24a')
  const [gradTo, setGradTo] = useState('#ff5a8a')
  const [randomSeed, setRandomSeed] = useState(1)

  // 滚动 / 闪烁
  const [scrollDir, setScrollDir] = useState('none')
  const [scrollSpeed, setScrollSpeed] = useState(3)
  const [blink, setBlink] = useState('none')
  // 闪烁节拍（毫秒，越小闪得越快）；原版闪烁快慢是写死的，这里做成可调
  const [blinkSpeed, setBlinkSpeed] = useState(250)
  // 每行单独配色（配色模式选「逐行指定」时用）
  const [lineColors, setLineColors] = useState<string[]>([])
  // 自动对齐：按字数补空格，让各行的效果文字竖着对齐（原版「自动对齐/对齐字数参考」）
  const [autoAlign, setAutoAlign] = useState(false)
  const [alignRefChars, setAlignRefChars] = useState(4)
  // 竖列里礼物图的位置：左 / 上 / 右（原版「图标靠上/图标靠右」）
  const [listIconPos, setListIconPos] = useState<'left' | 'top' | 'right'>(() => savedEnum('listIconPos', ['left', 'top', 'right'] as const, 'left'))
  // 分几栏 + 怎么填：'col' = 填满一栏再起下一栏（直播菜单常见的两大列），'row' = 左右交替
  const [listCols, setListCols] = useState(() => savedNum('listCols', 1))
  const [listFlow, setListFlow] = useState<'col' | 'row'>(() => savedEnum('listFlow', ['col', 'row'] as const, 'col'))
  // 文字相对礼物图的大小（直播菜单一般字比图还大）
  const [listTextScale, setListTextScale] = useState(() => savedNum('listTextScale', 0.62))
  // 只要「图 + 整蛊名」的话就把礼物名关掉，连箭头一起省掉，画面更干净
  const [listShowName, setListShowName] = useState(() => savedBool('listShowName', true))
  // 正在给第几条换礼物（点条目里的礼物图打开）
  const [swapIndex, setSwapIndex] = useState<number | null>(null)
  const [swapSearch, setSwapSearch] = useState('')
  // 条目列表搜索（礼物名/整蛊名都能搜）
  const [menuFilter, setMenuFilter] = useState('')
  // 右键常用菜单：{x,y,index} 定位到哪一条
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  // 导出时裁掉空白（礼物列表图基本都要贴到直播画面上，留白越少越好对位）
  const [cropExport, setCropExport] = useState(true)
  const [cropPad, setCropPad] = useState(16)
  // 批量输入框：一行一条「礼物名 = 效果」
  const [bulkText, setBulkText] = useState('')

  // 素材目录（参考软件：图片目录/默认图片目录/字体目录/合成图片目录）
  const MATERIAL_KEY = 'ent-transparent-material'
  const [mat, setMat] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MATERIAL_KEY) || '{}') as { fontDir: string; imageDir: string; outputDir: string } }
    catch { return { fontDir: '', imageDir: '', outputDir: '' } }
  })
  const [customFonts, setCustomFonts] = useState<string[]>([])

  const pickMaterialDir = async (key: 'fontDir' | 'imageDir' | 'outputDir') => {
    const res = await window.api.selectFile({ title: '选择目录', properties: ['openDirectory'] })
    if (!res.ok || !res.path) return
    const next = { ...mat, [key]: res.path }
    setMat(next)
    localStorage.setItem(MATERIAL_KEY, JSON.stringify(next))
    if (key === 'fontDir') {
      const r = await window.api.listFontFiles(res.path)
      if (r.ok && r.list) {
        const loaded: string[] = []
        for (const f of r.list) {
          try {
            const face = new FontFace(f.name, `url("${mediaUrl(f.path)}")`)
            await face.load()
            document.fonts.add(face)
            loaded.push(f.name)
          } catch { /* ignore */ }
        }
        setCustomFonts(loaded)
        toast(`已加载 ${loaded.length} 个自定义字体`, 'success')
      }
    }
  }
  const ALL_FONTS = [...customFonts, ...FONTS.filter((f) => !customFonts.includes(f))]

  // 表情库（1300+，程序化生成一次）
  const EMOJIS = useMemo(buildEmojis, [])
  const [emojiSearch, setEmojiSearch] = useState('')
  const filteredEmojis = emojiSearch.trim()
    ? EMOJIS.filter((e) => e.includes(emojiSearch.trim()))
    : EMOJIS

  // 原 gf.db 的礼物记录：platform/name/giftid/diamondcount/giftdata。
  const [giftPlatform, setGiftPlatform] = useState<(typeof GIFT_PLATFORMS)[number]['value']>('dy')
  const [giftName, setGiftName] = useState('')
  const [giftId, setGiftId] = useState('')
  const [giftDiamondCount, setGiftDiamondCount] = useState(0)
  const [giftData, setGiftData] = useState('')
  const [giftDataBase64, setGiftDataBase64] = useState('')
  const [giftImagePath, setGiftImagePath] = useState('')
  const [giftImageName, setGiftImageName] = useState('')
  const [giftLibrary, setGiftLibrary] = useState<GiftLibraryItem[]>([])
  const hydratedRef = useRef(false)
  const [giftLibraryPick, setGiftLibraryPick] = useState('')
  const [giftLibrarySearch, setGiftLibrarySearch] = useState('')
  const [giftMergeMode, setGiftMergeMode] = useState<GiftMergeMode>('overwrite')
  const [databaseBusy, setDatabaseBusy] = useState(false)
  const [databaseImportInfo, setDatabaseImportInfo] = useState<{
    source: string
    gifts: MergeStats
    textMenus: MergeStats
    imageMenus: MergeStats
    programs: MergeStats
    versions: MergeStats
    colors: MergeStats
    warnings: string[]
  } | null>(null)
  // undefined 表示尚未导入原版元数据，导出时使用原版默认表；空数组表示原库确实为空。
  const [giftVersions, setGiftVersions] = useState<TransparentGiftVersion[] | undefined>(() => loadOptionalRecords(GIFT_VERSIONS_KEY, asGiftVersion))
  const [colors, setColors] = useState<TransparentColorRecord[] | undefined>(() => loadOptionalRecords(COLORS_KEY, asColorRecord))

  // 原版 gf.db.giftlist 与 config.db 两张 programlist 表是独立的数据路径。
  // 整蛊竖列是主打用法，默认就停在它上面
  const [giftMenuMode, setGiftMenuMode] = useState<GiftMenuMode>('list')
  const [textMenuDraft, setTextMenuDraft] = useState<GiftMenuDraft>({ title: '礼物菜单', items: [] })
  const [imageMenuDraft, setImageMenuDraft] = useState<GiftMenuDraft>({ title: '礼物菜单', items: [] })
  const [listMenuDraft, setListMenuDraft] = useState<GiftMenuDraft>({ title: '整蛊菜单', items: [] })
  // 存档一律用惰性初始值读：放到 useEffect 里读，会被同一轮的写 effect 用初始空值覆盖掉。
  const [listMenuPrograms, setListMenuPrograms] = useState<GiftMenuProgram[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LIST_MENU_PROGRAMS_KEY) || '[]')
      return Array.isArray(saved) ? saved.map(asGiftMenuProgram).filter((item): item is GiftMenuProgram => !!item) : []
    } catch {
      return []
    }
  })
  // 图文竖列的排版可调项（图标多大、行多高、名字和效果之间用什么连接、各自什么颜色）
  const [listIconSize, setListIconSize] = useState(() => savedNum('listIconSize', 84))
  const [listRowGap, setListRowGap] = useState(() => savedNum('listRowGap', 18))
  const [listSep, setListSep] = useState(() => savedStr('listSep', ' → '))
  const [listNameColor, setListNameColor] = useState(() => savedStr('listNameColor', '#ffffff'))
  const [listEffectColor, setListEffectColor] = useState(() => savedStr('listEffectColor', '#ffd166'))
  const [listShowDiamond, setListShowDiamond] = useState(() => savedBool('listShowDiamond', false))
  const [listNameRatio, setListNameRatio] = useState(() => savedNum('listNameRatio', 0.38))
  const [listStripe, setListStripe] = useState(() => savedBool('listStripe', true))
  const [listStripeColor, setListStripeColor] = useState(() => savedStr('listStripeColor', '#000000'))
  const [listStripeAlpha, setListStripeAlpha] = useState(() => savedNum('listStripeAlpha', 0.28))
  const [giftMenuPreview, setGiftMenuPreview] = useState(false)
  const [textMenuPrograms, setTextMenuPrograms] = useState<GiftMenuProgram[]>([])
  const [imageMenuPrograms, setImageMenuPrograms] = useState<GiftMenuProgram[]>([])
  const [giftMenuProgramName, setGiftMenuProgramName] = useState('')
  const [giftMenuProgramPick, setGiftMenuProgramPick] = useState('')
  const menuImageRefs = useRef<Record<string, HTMLImageElement>>({})
  const activeDraft = giftMenuMode === 'text' ? textMenuDraft : giftMenuMode === 'image' ? imageMenuDraft : listMenuDraft
  const giftMenuTitle = activeDraft.title
  const giftMenuItems = activeDraft.items
  const setGiftMenuTitle = (title: string) => {
    if (giftMenuMode === 'text') setTextMenuDraft((draft) => ({ ...draft, title }))
    else if (giftMenuMode === 'image') setImageMenuDraft((draft) => ({ ...draft, title }))
    else setListMenuDraft((draft) => ({ ...draft, title }))
  }
  const setGiftMenuItems = (update: GiftMenuItemsUpdate) => {
    const apply = (items: GiftLibraryItem[]) => typeof update === 'function' ? update(items) : update
    if (giftMenuMode === 'text') setTextMenuDraft((draft) => ({ ...draft, items: apply(draft.items) }))
    else if (giftMenuMode === 'image') setImageMenuDraft((draft) => ({ ...draft, items: apply(draft.items) }))
    else setListMenuDraft((draft) => ({ ...draft, items: apply(draft.items) }))
  }

  // 图片叠加
  const [imgDataUrl, setImgDataUrl] = useState('')
  // 方案使用原始路径而不是 data URL，避免图片方案写入 localStorage 后超出容量或丢失。
  const [imgPath, setImgPath] = useState('')
  const [imgScale, setImgScale] = useState(0.8)
  const [imgName, setImgName] = useState('')
  const [giftImgs, setGiftImgs] = useState<EntertainmentGiftImage[]>([])
  const [giftImgSearch, setGiftImgSearch] = useState('')
  const [customImages, setCustomImages] = useState<{ name: string; path: string }[]>([])
  const imgElRef = useRef<HTMLImageElement | null>(null)

  // 常用礼物目录由旧版价格清单和内置真实图片目录合并，图片目录是权威名称来源。
  const giftCatalogNames = useMemo(
    () => [...new Set([...DOUYIN_GIFT_NAMES, ...giftImgs.map((gift) => gift.name)])].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [giftImgs]
  )
  const canonicalGiftImgs = useMemo(() => {
    const seen = new Set<string>()
    const result: EntertainmentGiftImage[] = []
    for (const gift of giftImgs) {
      const key = normalizedLabel(gift.name)
      // 加成卡/助力票这类道具观众送不出来，礼物库里不该出现
      if (!gift.canonical || !key || seen.has(key) || !isRealDouyinGift(gift.name)) continue
      seen.add(key)
      result.push(gift)
    }
    return result
  }, [giftImgs])
  const [giftSearch, setGiftSearch] = useState('')
  const filteredGifts = giftSearch.trim()
    ? giftCatalogNames.filter((gift) => gift.includes(giftSearch.trim()))
    : giftCatalogNames
  const giftImageByKey = useMemo(() => {
    const images = new Map<string, EntertainmentGiftImage>()
    for (const gift of giftImgs) {
      const key = normalizedLabel(gift.name)
      if (gift.canonical && key && !images.has(key)) images.set(key, gift)
    }
    return images
  }, [giftImgs])

  useEffect(() => {
    let active = true
    void window.api.entertainmentListGiftImages().then((list) => {
      if (!active) return
      setGiftImgs(list)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!canonicalGiftImgs.length) return
    // 礼物库按真实礼物名保留一个当前图；所有同名图片变体仍可在图片选择器里使用。
    setGiftLibrary((previous) => {
      const next = [...previous]
      const positions = new Map(previous.map((gift, index) => [giftIdentity(gift), index]))
      for (const [index, image] of canonicalGiftImgs.entries()) {
              const key = giftIdentity({ platform: 'dy', name: image.name })
        const position = positions.get(key)
        if (position != null) {
          if (!next[position].imagePath || !next[position].giftId || !next[position].diamondCount) {
            next[position] = {
              ...next[position],
              imagePath: next[position].imagePath || image.path,
              imageName: next[position].imageName || image.path.split(/[\\/]/).pop() || image.name,
              giftId: next[position].giftId || image.giftId || image.giftIds?.[0] || '',
              diamondCount: next[position].diamondCount || image.diamondCount || DOUYIN_PRICES.get(normalizedLabel(image.name)) || 0
            }
          }
          continue
        }
        positions.set(key, next.length)
        next.push({
          id: `gift-builtin-${index}-${image.name}`,
          platform: 'dy',
          name: image.name,
          giftId: image.giftId || image.giftIds?.[0] || '',
          diamondCount: image.diamondCount ?? DOUYIN_PRICES.get(normalizedLabel(image.name)) ?? 0,
          giftData: '',
          imagePath: image.path,
          imageName: image.path.split(/[\\/]/).pop() || image.name
        })
      }
      return next
    })
  }, [canonicalGiftImgs])

  useEffect(() => {
    if (!mat.imageDir) { setCustomImages([]); return }
    window.api.entertainmentListImageFiles(mat.imageDir).then((r) => setCustomImages(r.ok ? r.list ?? [] : []))
  }, [mat.imageDir])

  // 图片预加载（draw 同步用，避免异步 onload 时序导致画布黑帧）
  useEffect(() => {
    if (!imgDataUrl) {
      imgElRef.current = null
      return
    }
    const img = new Image()
    img.onload = () => {
      imgElRef.current = img
      draw()
    }
    img.src = imgDataUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgDataUrl])

  // 右键菜单：点别处/滚动就收起
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [ctxMenu])

  // 原版「直接粘贴进来」：截图/复制的图片 Ctrl+V 直接当叠加图用，不用先存成文件
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        event.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          setImgDataUrl(String(reader.result || ''))
          setImgPath('')
          setImgName('剪贴板图片')
          setRenderMode((mode) => (mode === 'text' ? 'image' : mode))
          toast('已粘贴剪贴板图片', 'success')
        }
        reader.readAsDataURL(file)
        return
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 方案
  const [programs, setPrograms] = useState<{ name: string; cfg: Record<string, unknown> }[]>([])
  const [progName, setProgName] = useState('')
  const [progPick, setProgPick] = useState('')

  useEffect(() => {
    try {
      setPrograms(JSON.parse(localStorage.getItem(PROGRAMS_KEY) ?? '[]'))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(GIFT_LIBRARY_KEY) ?? '[]')
      if (Array.isArray(saved)) {
        // 早先导入过的礼物库里存着加成卡/助力票这类道具，过滤规则改了也不会自己消失，
        // 每次载入顺手洗一遍，否则界面上永远还是旧名单。
        setGiftLibrary(
          saved
            .map((item, index) => asGiftItem(item, index))
            .filter((item): item is GiftLibraryItem => !!item && isRealDouyinGift(item.name))
        )
      }
      const savedTextPrograms = JSON.parse(localStorage.getItem(TEXT_MENU_PROGRAMS_KEY) ?? '[]')
      if (Array.isArray(savedTextPrograms)) setTextMenuPrograms(savedTextPrograms.map(asGiftMenuProgram).filter((item): item is GiftMenuProgram => !!item))
      const savedImagePrograms = JSON.parse(localStorage.getItem(IMAGE_MENU_PROGRAMS_KEY) ?? '[]')
      if (Array.isArray(savedImagePrograms)) setImageMenuPrograms(savedImagePrograms.map(asGiftMenuProgram).filter((item): item is GiftMenuProgram => !!item))

    } catch {
      // 损坏的旧存储不应阻止透明图工具继续可用。
    }
    hydratedRef.current = true
  }, [])

  // 三份存档：读完（hydrated）之前不写回，否则 StrictMode 双跑 effect 时第二次读到的是第一次写进去的空数组
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem(GIFT_LIBRARY_KEY, JSON.stringify(giftLibrary))
  }, [giftLibrary])

  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem(TEXT_MENU_PROGRAMS_KEY, JSON.stringify(textMenuPrograms))
  }, [textMenuPrograms])

  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem(IMAGE_MENU_PROGRAMS_KEY, JSON.stringify(imageMenuPrograms))
  }, [imageMenuPrograms])

  useEffect(() => {
    localStorage.setItem(LIST_MENU_PROGRAMS_KEY, JSON.stringify(listMenuPrograms))
  }, [listMenuPrograms])

  // 竖列排版单独存，换方案不会把调好的版式冲掉
  useEffect(() => {
    localStorage.setItem(LIST_MENU_STYLE_KEY, JSON.stringify({
      listIconSize, listRowGap, listSep, listNameColor, listEffectColor,
      listShowDiamond, listNameRatio, listStripe, listStripeColor, listStripeAlpha,
      listIconPos, listCols, listFlow, listTextScale, autoAlign, alignRefChars, listShowName
    }))
  }, [listIconSize, listRowGap, listSep, listNameColor, listEffectColor, listShowDiamond, listNameRatio, listStripe, listStripeColor, listStripeAlpha, listIconPos, listCols, listFlow, listTextScale, autoAlign, alignRefChars, listShowName])


  useEffect(() => {
    if (giftVersions === undefined) localStorage.removeItem(GIFT_VERSIONS_KEY)
    else localStorage.setItem(GIFT_VERSIONS_KEY, JSON.stringify(giftVersions))
  }, [giftVersions])

  useEffect(() => {
    if (colors === undefined) localStorage.removeItem(COLORS_KEY)
    else localStorage.setItem(COLORS_KEY, JSON.stringify(colors))
  }, [colors])

  useEffect(() => {
    for (const item of giftMenuItems) {
      if (!item.imagePath || menuImageRefs.current[item.imagePath]) continue
      const image = new Image()
      image.onload = () => {
        menuImageRefs.current[item.imagePath] = image
        draw()
      }
      image.src = mediaUrl(item.imagePath)
    }
    // draw is intentionally called after native image decoding completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftMenuItems])

  const saveProgram = () => {
    const name = progName.trim() || `方案${programs.length + 1}`
    if (programs.some((program) => program.name === name)) {
      return toast('方案名称重复，请删除旧方案或使用新名称', 'error')
    }
    const cfg = { text, font, fontSize, fontScale, autoFont, rotate, color, strokeColor, strokeWidth, spacing, bold, lineHeight, align, autoNumber, numStyle, shadowColor, shadowBlur, glowColor, glowRange, boxOn, boxColor, boxAlpha, boxPad, bgColor, bgAlpha, colorMode, cycleColors, gradFrom, gradTo, scrollDir, scrollSpeed, blink, blinkSpeed, lineColors, autoAlign, alignRefChars, scale, imgScale, renderMode, imgPath, imgName, giftPlatform, giftName, giftId, giftDiamondCount }
    const next = [...programs, { name, cfg }]
    setPrograms(next)
    localStorage.setItem(PROGRAMS_KEY, JSON.stringify(next))
    setProgName('')
    toast(`方案「${name}」已保存`, 'success')
  }

  const loadProgram = (name: string) => {
    const p = programs.find((x) => x.name === name)
    if (!p) return
    const c = p.cfg as Record<string, unknown>
    const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)
    const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
    setText(str(c.text, text))
    setFont(str(c.font, font))
    setFontSize(num(c.fontSize, fontSize))
    setFontScale(num(c.fontScale, fontScale))
    setAutoFont(bool(c.autoFont, autoFont))
    setRotate(num(c.rotate, rotate))
    setColor(str(c.color, color))
    setStrokeColor(str(c.strokeColor, strokeColor))
    setStrokeWidth(num(c.strokeWidth, strokeWidth))
    setSpacing(num(c.spacing, spacing))
    setBold(bool(c.bold, bold))
    setLineHeight(num(c.lineHeight, lineHeight))
    setAlign(str(c.align, align))
    setAutoNumber(bool(c.autoNumber, autoNumber))
    setNumStyle(str(c.numStyle, numStyle))
    setShadowColor(str(c.shadowColor, shadowColor))
    setShadowBlur(num(c.shadowBlur, shadowBlur))
    setGlowColor(str(c.glowColor, glowColor))
    setGlowRange(num(c.glowRange, glowRange))
    setBoxOn(bool(c.boxOn, boxOn))
    setBoxColor(str(c.boxColor, boxColor))
    setBoxAlpha(num(c.boxAlpha, boxAlpha))
    setBoxPad(num(c.boxPad, boxPad))
    setBgColor(str(c.bgColor, bgColor))
    setBgAlpha(num(c.bgAlpha, bgAlpha))
    setColorMode(str(c.colorMode, colorMode) as typeof colorMode)
    if (Array.isArray(c.cycleColors)) setCycleColors(c.cycleColors.filter((x): x is string => typeof x === 'string'))
    setGradFrom(str(c.gradFrom, gradFrom))
    setGradTo(str(c.gradTo, gradTo))
    setScrollDir(str(c.scrollDir, scrollDir))
    setScrollSpeed(num(c.scrollSpeed, scrollSpeed))
    setBlink(str(c.blink, blink))
    setBlinkSpeed(num(c.blinkSpeed, blinkSpeed))
    if (Array.isArray(c.lineColors)) setLineColors((c.lineColors as unknown[]).map((v) => typeof v === 'string' ? v : ''))
    setAutoAlign(bool(c.autoAlign, autoAlign))
    setAlignRefChars(num(c.alignRefChars, alignRefChars))
    setScale(str(c.scale, scale))
    setImgScale(num(c.imgScale, imgScale))
    setRenderMode(str(c.renderMode, renderMode) as typeof renderMode)
    const savedImagePath = str(c.imgPath, '')
    setImgPath(savedImagePath)
    setImgName(str(c.imgName, savedImagePath ? savedImagePath.split(/[\\/]/).pop() ?? '' : ''))
    setImgDataUrl(savedImagePath ? mediaUrl(savedImagePath) : '')
    const platform = str(c.giftPlatform, 'dy')
    setGiftPlatform(GIFT_PLATFORMS.some((item) => item.value === platform) ? platform as (typeof GIFT_PLATFORMS)[number]['value'] : 'dy')
    setGiftName(str(c.giftName, ''))
    setGiftId(str(c.giftId, ''))
    setGiftDiamondCount(num(c.giftDiamondCount, 0))
    toast(`已加载方案「${name}」`, 'success')
  }

  const deleteProgram = (name: string) => {
    const next = programs.filter((p) => p.name !== name)
    setPrograms(next)
    localStorage.setItem(PROGRAMS_KEY, JSON.stringify(next))
    if (progPick === name) setProgPick('')
  }

  const clearGiftDraft = () => {
    setGiftLibraryPick('')
    setGiftPlatform('dy')
    setGiftName('')
    setGiftId('')
    setGiftDiamondCount(0)
    setGiftData('')
    setGiftDataBase64('')
    setGiftImagePath('')
    setGiftImageName('')
  }

  const selectGift = (item: GiftLibraryItem) => {
    setGiftLibraryPick(item.id)
    setGiftPlatform(item.platform)
    setGiftName(item.name)
    setGiftId(item.giftId)
    setGiftDiamondCount(item.diamondCount)
    setGiftData(item.giftData)
    setGiftDataBase64(item.giftDataBase64 || '')
    setGiftImagePath(item.imagePath)
    setGiftImageName(item.imageName)
  }

  const saveGift = () => {
    const name = giftName.trim()
    if (!name) return toast('请先填写礼物名称', 'error')
    const item: GiftLibraryItem = {
      id: giftLibraryPick || `gift-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      platform: giftPlatform,
      name,
      giftId: giftId.trim(),
      diamondCount: Math.max(0, giftDiamondCount),
      giftData: giftData.trim(),
      giftDataBase64: giftDataBase64.trim() || undefined,
      imagePath: giftImagePath,
      imageName: giftImageName
    }
    setGiftLibrary((previous) => giftLibraryPick
      ? previous.map((gift) => gift.id === giftLibraryPick ? item : gift)
      : [...previous, item])
    setGiftLibraryPick(item.id)
    toast(giftLibraryPick ? `已更新礼物「${name}」` : `已加入礼物库「${name}」`, 'success')
  }

  const deleteGift = () => {
    if (!giftLibraryPick) return
    const current = giftLibrary.find((gift) => gift.id === giftLibraryPick)
    setGiftLibrary((previous) => previous.filter((gift) => gift.id !== giftLibraryPick))
    clearGiftDraft()
    if (current) toast(`已从礼物库删除「${current.name}」`, 'info')
  }

  const pickGiftImage = async () => {
    const r = await window.api.selectFile({
      title: '选择礼物图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    if (!r.ok || !r.path) return
    setGiftImagePath(r.path)
    setGiftImageName(r.path.split(/[\\/]/).pop() ?? '')
    setGiftDataBase64('')
  }

  const addGiftToMenu = () => {
    const item = giftLibrary.find((gift) => gift.id === giftLibraryPick)
    if (!item) return toast('请从礼物库选择一个礼物后再加入菜单', 'error')
    setGiftMenuItems((previous) => [...previous, { ...item }])
    toast(`已加入${giftMenuMode === 'text' ? '文字' : '图片'}菜单：${item.name}`, 'success')
  }

  // 批量配整张礼物列表图：一行一条「礼物名 = 对应整蛊」，自动匹配礼物图。
  // 逐个从礼物库点选太慢，主播配一张 6~10 行的菜单基本都是一次性写完。
  const bulkFillMenu = (raw: string, append: boolean) => {
    const lines = raw.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean)
    if (!lines.length) return toast('先写几行「礼物名 = 效果」', 'error')
    const missing: string[] = []
    const rows: GiftLibraryItem[] = []
    lines.forEach((line, index) => {
      const [namePart, ...rest] = line.split(/[=＝:：]/)
      const name = (namePart || '').trim()
      if (!name) return
      const effect = rest.join('=').trim()
      const key = normalizedLabel(name)
      const known = giftLibrary.find((gift) => normalizedLabel(gift.name) === key)
      const image = giftImageByKey.get(key)
      if (!known && !image) missing.push(name)
      rows.push({
        id: known?.id || `gift-bulk-${Date.now()}-${index}`,
        platform: known?.platform || 'dy',
        name: known?.name || image?.name || name,
        giftId: known?.giftId || image?.giftId || '',
        diamondCount: known?.diamondCount ?? image?.diamondCount ?? DOUYIN_PRICES.get(key) ?? 0,
        giftData: known?.giftData || '',
        imagePath: known?.imagePath || image?.path || '',
        imageName: known?.imageName || '',
        effect
      })
    })
    if (!rows.length) return toast('没解析出礼物行', 'error')
    setGiftMenuItems((previous) => (append ? [...previous, ...rows] : rows))
    setGiftMenuPreview(true)
    if (missing.length) toast(`已生成 ${rows.length} 行；这些礼物没找到图：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}`, 'info')
    else toast(`已生成 ${rows.length} 行礼物列表`, 'success')
  }

  // 一键从「礼物触发」的规则生成菜单：只取【当前启用】的规则。
  // 主播在礼物触发页用「项目预设」开了哪几个项目，这里就只出那几个项目 ——
  // 观众看到的菜单 = 实际能触发的东西，换直播换个预设，菜单跟着变。
  const importFromRules = async () => {
    const rules = await window.api.entertainmentRulesList()
    const live = rules.filter(
      (rule) =>
        rule.enabled !== false &&
        String(rule.giftName || '').trim() &&
        (rule.triggerType || 'gift') === 'gift'
    )
    if (!live.length) {
      return toast('没有启用中的礼物规则：先去「礼物触发」开几个项目，或选一个项目预设', 'error')
    }
    // 同一个礼物可能挂了好几条规则（几个项目都绑了它）：合成一行，效果用「、」连起来
    const merged = new Map<string, { name: string; effects: string[] }>()
    for (const rule of live) {
      const gift = String(rule.giftName).trim()
      const key = normalizedLabel(gift)
      // 展示用的是规则名（品游项目里的条目名，主播自己起的），没名字才退回动作描述
      const label = String(rule.name || '').trim() || ruleActionLabel(rule)
      const row = merged.get(key) || { name: gift, effects: [] }
      if (label && !row.effects.includes(label)) row.effects.push(label)
      merged.set(key, row)
    }
    const rows: GiftLibraryItem[] = [...merged].map(([key, row], index) => {
      const image = giftImageByKey.get(key)
      return {
        id: `gift-rule-${index}-${row.name}`,
        platform: 'dy',
        name: image?.name || row.name,
        giftId: image?.giftId || '',
        diamondCount: image?.diamondCount ?? DOUYIN_PRICES.get(key) ?? 0,
        giftData: '',
        imagePath: image?.path || '',
        imageName: '',
        // 一个礼物挂太多条就截断，菜单一行放不下那么多字
        effect: row.effects.slice(0, 3).join('、') + (row.effects.length > 3 ? ' 等' : '')
      }
    })
    rows.sort((a, b) => (a.diamondCount || 0) - (b.diamondCount || 0))
    setGiftMenuItems(rows)
    setGiftMenuPreview(true)
    const groups = new Set(live.map((rule) => String(rule.group || '').trim()).filter(Boolean))
    toast(
      `已按启用中的规则生成 ${rows.length} 行（便宜→贵）` + (groups.size ? `，${groups.size} 个项目` : ''),
      'success'
    )
  }

  // 一键从当前游戏的礼物映射（GiftMap）生成菜单：菜单和游戏实际触发永远一致，
  // 这才是「正确」——手打的菜单迟早和配置对不上。
  const importFromGameConfig = async () => {
    const [cfgResult, pranksResult] = await Promise.all([window.api.readConfig(), window.api.readPranks()])
    if (!cfgResult.ok) return toast(cfgResult.error || '读不到当前游戏配置（先在游戏库选好游戏）', 'error')
    const giftMap = cfgResult.values?.GiftMap
    if (!giftMap || typeof giftMap !== 'object' || Array.isArray(giftMap)) return toast('当前游戏配置里没有礼物→整蛊映射', 'error')
    const prankNames = new Map(pranksResult.pranks.map((prank) => [prank.id, prank.name]))
    const rows: GiftLibraryItem[] = []
    for (const [gift, prankId] of Object.entries(giftMap as Record<string, unknown>)) {
      if (!isRealDouyinGift(gift)) continue
      const key = normalizedLabel(gift)
      const image = giftImageByKey.get(key)
      rows.push({
        id: `gift-cfg-${rows.length}-${gift}`,
        platform: 'dy',
        name: image?.name || gift,
        giftId: image?.giftId || '',
        diamondCount: image?.diamondCount ?? DOUYIN_PRICES.get(key) ?? 0,
        giftData: '',
        imagePath: image?.path || '',
        imageName: '',
        effect: prankNames.get(String(prankId)) || String(prankId)
      })
    }
    if (!rows.length) return toast('礼物映射是空的', 'error')
    rows.sort((a, b) => (a.diamondCount || 0) - (b.diamondCount || 0))
    setGiftMenuItems(rows)
    setGiftMenuPreview(true)
    toast(`已按当前游戏配置生成 ${rows.length} 行（便宜→贵）。行数多可删掉不想展示的`, 'success')
  }

  // 按价格排序当前菜单（便宜→贵，观众一眼看到入门价）
  const sortMenuByPrice = () => {
    if (!giftMenuItems.length) return
    setGiftMenuItems((previous) => [...previous].sort((a, b) => (a.diamondCount || 0) - (b.diamondCount || 0)))
    toast('已按价格排序（便宜→贵）', 'success')
  }

  // 复制成品到剪贴板：不落盘直接 Ctrl+V 贴进 OBS/聊天
  const copyImage = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = cropExport ? croppedDataUrl(canvas, cropPad) : canvas.toDataURL('image/png')
    const result = await window.api.entertainmentCopyImage(dataUrl)
    if (result.ok) toast('图片已复制，直接 Ctrl+V 粘贴', 'success')
    else toast(result.error || '复制失败', 'error')
  }

  const importLocalGiftImages = () => {
    if (!canonicalGiftImgs.length) return toast('还没有可导入的本地礼物图', 'info')
    setGiftLibrary((previous) => {
      const byName = new Map(canonicalGiftImgs.map((item) => [item.name, item]))
      const existing = new Set(previous.filter((item) => item.platform === 'dy').map((item) => item.name))
      const next = previous.map((item) => {
        const local = item.platform === 'dy' ? byName.get(item.name) : undefined
        if (!local || item.imagePath) return item
        return { ...item, imagePath: local.path, imageName: local.path.split(/[\\/]/).pop() || local.name }
      })
      for (const [index, local] of canonicalGiftImgs.entries()) {
        if (existing.has(local.name)) continue
        next.push({
          id: `gift-local-${Date.now()}-${index}`,
          platform: 'dy',
          name: local.name,
          giftId: '',
          diamondCount: 0,
          giftData: '',
          imagePath: local.path,
          imageName: local.path.split(/[\\/]/).pop() || local.name
        })
      }
      return next
    })
    toast('本地真实礼物图已同步到礼物库', 'success')
  }

  const importTransparentDatabase = async () => {
    if (databaseBusy) return
    const selected = await window.api.selectFile({
      title: '导入透明图助手数据库',
      filters: [{ name: '透明图数据库', extensions: ['db', 'sqlite', 'zip'] }],
      properties: ['openFile']
    })
    if (!selected.ok || !selected.path) return
    setDatabaseBusy(true)
    try {
      const result = await window.api.entertainmentTransparentImport(selected.path)
      if (!result.ok) {
        toast(result.error || '透明图数据库导入失败', 'error')
        return
      }

      const incomingGifts = (result.gifts || [])
        .map((item, index) => asGiftItem(item, index))
        .filter((item): item is GiftLibraryItem => !!item)
      const giftMerge = mergeRecords(giftLibrary, incomingGifts, giftIdentity, giftMergeMode)
      const mergedGifts = giftMerge.items
      const canonicalGifts = new Map(mergedGifts.map((item) => [giftIdentity(item), item]))
      const canonicalMenu = (item: GiftMenuProgram): GiftMenuProgram => ({
        ...item,
        listPro: item.listPro.map((gift) => ({ ...(canonicalGifts.get(giftIdentity(gift)) || gift) }))
      })
      const incomingTextMenus = (result.textPrograms || [])
        .map(asGiftMenuProgram)
        .filter((item): item is GiftMenuProgram => !!item)
        .map(canonicalMenu)
      const incomingImageMenus = (result.imagePrograms || [])
        .map(asGiftMenuProgram)
        .filter((item): item is GiftMenuProgram => !!item)
        .map(canonicalMenu)
      const textMerge = mergeRecords(textMenuPrograms, incomingTextMenus, namedIdentity, giftMergeMode)
      const imageMerge = mergeRecords(imageMenuPrograms, incomingImageMenus, namedIdentity, giftMergeMode)

      const incomingPrograms = (result.programs || [])
        .filter((item): item is { name: string; cfg: Record<string, unknown> } => !!item && typeof item.name === 'string' && !!item.cfg)
      const programMerge = mergeRecords(programs, incomingPrograms, namedIdentity, giftMergeMode)

      const versionMerge = result.giftVersions
        ? mergeRecords(giftVersions || [], result.giftVersions, namedIdentity, giftMergeMode)
        : { items: giftVersions || [], stats: { added: 0, replaced: 0, skipped: 0 } }
      const colorMerge = result.colors
        ? mergeRecords(colors || [], result.colors, namedIdentity, giftMergeMode)
        : { items: colors || [], stats: { added: 0, replaced: 0, skipped: 0 } }

      setGiftLibrary(mergedGifts)
      setTextMenuPrograms(textMerge.items)
      setImageMenuPrograms(imageMerge.items)
      setPrograms(programMerge.items)
      if (result.giftVersions) setGiftVersions(versionMerge.items)
      if (result.colors) setColors(colorMerge.items)
      localStorage.setItem(GIFT_LIBRARY_KEY, JSON.stringify(mergedGifts))
      localStorage.setItem(TEXT_MENU_PROGRAMS_KEY, JSON.stringify(textMerge.items))
      localStorage.setItem(IMAGE_MENU_PROGRAMS_KEY, JSON.stringify(imageMerge.items))
      localStorage.setItem(PROGRAMS_KEY, JSON.stringify(programMerge.items))

      const warnings = [...(result.warnings || [])]
      setDatabaseImportInfo({
        source: result.source || selected.path,
        gifts: giftMerge.stats,
        textMenus: textMerge.stats,
        imageMenus: imageMerge.stats,
        programs: programMerge.stats,
        versions: versionMerge.stats,
        colors: colorMerge.stats,
        warnings
      })
      const totalAdded = giftMerge.stats.added + textMerge.stats.added + imageMerge.stats.added + programMerge.stats.added
      // ★源库里本来就没数据 ≠ 数据都已存在。2026-09-07：主播拿了一份【全新未用过】的
      //   透明图助手数据库来导（giftlist/programlist/programlistimg 三张表都是 0 行），
      //   旧文案一律说「全部已存在」，看起来就像我们读不到 —— 必须把两种情况分开说。
      const sourceEmpty =
        !(result.gifts?.length || result.textPrograms?.length || result.imagePrograms?.length || result.programs?.length)
      toast(
        sourceEmpty
          ? '这个数据库里没有礼物库和菜单节目（三张表都是空的）。请选透明图助手里正在用的那份数据库——一般在它安装目录的「配置文件」下，做过节目之后才有内容'
          : `已导入透明图数据库：礼物新增 ${giftMerge.stats.added}，文字菜单新增 ${textMerge.stats.added}，图片菜单新增 ${imageMerge.stats.added}${totalAdded === 0 ? '（这些内容之前已经导过）' : ''}`,
        sourceEmpty ? 'info' : warnings.length ? 'info' : 'success'
      )
    } catch (error) {
      toast(`透明图数据库导入失败：${(error as Error).message}`, 'error')
    } finally {
      setDatabaseBusy(false)
    }
  }

  const exportTransparentDatabase = async () => {
    if (databaseBusy) return
    setDatabaseBusy(true)
    try {
      const result = await window.api.entertainmentTransparentExport({
        gifts: giftLibrary,
        textPrograms: textMenuPrograms,
        imagePrograms: imageMenuPrograms,
        programs,
        ...(giftVersions ? { giftVersions } : {}),
        ...(colors ? { colors } : {})
      })
      if (result.ok) toast(`透明图数据库已导出：${result.path}`, 'success')
      else if (result.error !== '已取消') toast(result.error || '透明图数据库导出失败', 'error')
    } catch (error) {
      toast(`透明图数据库导出失败：${(error as Error).message}`, 'error')
    } finally {
      setDatabaseBusy(false)
    }
  }

  // 挪到指定位置（右键「置顶」用）
  const moveGiftMenuItemTo = (index: number, target: number) => {
    setGiftMenuItems((previous) => {
      if (index < 0 || index >= previous.length) return previous
      const copy = [...previous]
      const [item] = copy.splice(index, 1)
      copy.splice(Math.max(0, Math.min(copy.length, target)), 0, item)
      return copy
    })
  }

  const moveGiftMenuItem = (index: number, offset: -1 | 1) => {
    const next = index + offset
    if (next < 0 || next >= giftMenuItems.length) return
    setGiftMenuItems((previous) => {
      const copy = [...previous]
      ;[copy[index], copy[next]] = [copy[next], copy[index]]
      return copy
    })
  }

  const menuModeLabel = giftMenuMode === 'text' ? '文字' : giftMenuMode === 'image' ? '图片' : '竖列'
  const menuPrograms = giftMenuMode === 'text' ? textMenuPrograms : giftMenuMode === 'image' ? imageMenuPrograms : listMenuPrograms
  const setMenuPrograms = (update: (previous: GiftMenuProgram[]) => GiftMenuProgram[]) => {
    if (giftMenuMode === 'text') setTextMenuPrograms(update)
    else if (giftMenuMode === 'image') setImageMenuPrograms(update)
    else setListMenuPrograms(update)
  }

  const saveGiftMenu = () => {
    if (!giftMenuItems.length) return toast('礼物菜单至少需要一个礼物', 'error')
    const name = giftMenuProgramName.trim() || `${menuModeLabel}菜单${menuPrograms.length + 1}`
    if (menuPrograms.some((item) => item.name === name)) return toast('节目单名称重复，请删除旧方案或使用新名称', 'error')
    const program: GiftMenuProgram = {
      name,
      program: giftMenuTitle,
      listPro: giftMenuItems.map((item) => ({ ...item }))
    }
    setMenuPrograms((previous) => [...previous, program])
    setGiftMenuProgramPick(name)
    setGiftMenuProgramName('')
    toast(`已保存${menuModeLabel}菜单方案「${name}」`, 'success')
  }

  const loadGiftMenu = (name: string) => {
    const program = menuPrograms.find((item) => item.name === name)
    if (!program) return
    setGiftMenuTitle(program.program)
    setGiftMenuItems(program.listPro.map((item) => ({ ...item })))
    setGiftMenuPreview(true)
    toast(`已加载${menuModeLabel}菜单方案「${name}」`, 'success')
  }

  const deleteGiftMenu = (name: string) => {
    setMenuPrograms((previous) => previous.filter((item) => item.name !== name))
    if (giftMenuProgramPick === name) setGiftMenuProgramPick('')
  }

  const dims = () => {
    const hit = SCALES.find((s) => s.value === scale)
    return hit ? { w: hit.w, h: hit.h } : { w: 1080, h: 1920 }
  }

  // 行颜色（single/cycle/random/gradient/half）
  const lineColor = (i: number, total: number): string => {
    switch (colorMode) {
      case 'cycle':
        return cycleColors[i % cycleColors.length] || color
      case 'random':
        return seededPick(cycleColors, randomSeed, i)
      case 'gradient':
        return total <= 1 ? gradFrom : lerpColor(gradFrom, gradTo, i / (total - 1))
      case 'half':
        return i < total / 2 ? gradFrom : gradTo
      case 'diagonal': {
        // 对角：色相沿对角线推进，比单纯上下渐变更有斜切感
        const ratio = total <= 1 ? 0 : (i / (total - 1)) * 0.65 + 0.35
        return lerpColor(gradFrom, gradTo, Math.min(1, ratio))
      }
      case 'split': {
        // 分割：整段切成 N 块，每块一个颜色（块数=配色数）
        const blocks = Math.max(1, cycleColors.length)
        const size = Math.max(1, Math.ceil(total / blocks))
        return cycleColors[Math.min(blocks - 1, Math.floor(i / size))] || color
      }
      case 'manual':
        // 每行单独配色：没填的行回落到主文字色
        return lineColors[i] || color
      default:
        return color
    }
  }

  const numberedLines = (): string[] => {
    let lines = text.split('\n')
    if (autoNumber) {
      lines = lines.map((l, i) => {
        if (numStyle === 'cn') return `${i + 1}、${l}`
        if (numStyle === 'circle') return `${CIRCLED[i] ?? i + 1 + '.'}${l}`
        return `${i + 1}. ${l}`
      })
    }
    return lines
  }

  const drawGiftMenu = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save()
    if (rotate !== 0) {
      ctx.translate(w / 2, h / 2)
      ctx.rotate((rotate * Math.PI) / 180)
      ctx.translate(-w / 2, -h / 2)
    }

    const weight = bold ? 'bold' : 'normal'
    const drawStyledText = (value: string, x: number, y: number, fill: string) => {
      if (glowRange > 0) {
        ctx.save()
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowRange
        ctx.strokeStyle = glowColor
        ctx.lineWidth = Math.max(2, glowRange / 3)
        ctx.lineJoin = 'round'
        ctx.strokeText(value, x, y)
        ctx.restore()
      }
      if (shadowBlur > 0) {
        ctx.save()
        ctx.shadowColor = shadowColor
        ctx.shadowBlur = shadowBlur
        ctx.fillStyle = fill
        ctx.fillText(value, x, y)
        ctx.restore()
      }
      if (strokeWidth > 0) {
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.strokeStyle = strokeColor
        ctx.strokeText(value, x, y)
      }
      ctx.fillStyle = fill
      ctx.fillText(value, x, y)
    }

    const margin = Math.max(28, Math.round(w * 0.06))
    const items = giftMenuItems
    const title = giftMenuTitle.trim()
    const logicalLines = [title, ...items.map((item, index) => `${index + 1}. ${item.name}${item.diamondCount ? `  ${item.diamondCount}钻` : ''}`)].filter(Boolean)
    let fs = Math.max(12, Math.round(fontSize * fontScale))
    if (autoFont && logicalLines.length) {
      ctx.font = `${weight} 100px "${font}"`
      const maxWidth = Math.max(...logicalLines.map((line) => ctx.measureText(line).width), 1)
      fs = Math.max(12, Math.min(Math.floor((w - margin * 2) * 100 / maxWidth), Math.floor((h - margin * 2) / Math.max(1, logicalLines.length * lineHeight))))
    }

    if (giftMenuMode === 'text') {
      ctx.font = `${weight} ${fs}px "${font}"`
      ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'
      ctx.textBaseline = 'middle'
      ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`
      const titleSize = title ? Math.round(fs * 1.18) : 0
      const lineHeightPx = fs * lineHeight
      const totalHeight = (title ? titleSize * 1.3 : 0) + items.length * lineHeightPx
      const startY = align === 'top' ? margin + titleSize / 2 : (h - totalHeight) / 2 + titleSize / 2
      const x = align === 'left' ? margin : align === 'right' ? w - margin : w / 2
      let y = startY
      if (title) {
        ctx.font = `${weight} ${titleSize}px "${font}"`
        drawStyledText(title, x, y, lineColor(0, Math.max(1, logicalLines.length)))
        y += titleSize * 0.65 + lineHeightPx / 2
        ctx.font = `${weight} ${fs}px "${font}"`
      }
      items.forEach((item, index) => {
        const value = `${index + 1}. ${item.name}${item.diamondCount ? `  ${item.diamondCount}钻` : ''}`
        drawStyledText(value, x, y + index * lineHeightPx, lineColor(index + (title ? 1 : 0), Math.max(1, logicalLines.length)))
      })
      ctx.restore()
      return
    }

    // 图文竖列：一行一个礼物 —— 左边礼物图，右边「礼物名 → 对应整蛊」。
    // 做整蛊菜单就是用这个模式（原版 MakeGift：礼物图 + 文字合成一行）。
    if (giftMenuMode === 'list') {
      const listTitleSize = title ? Math.round(fs * 1.25) : 0
      const listTop = margin + (title ? listTitleSize * 1.5 : 0)
      const available = Math.max(1, h - listTop - margin)
      // 分栏：填满一栏再起下一栏（直播菜单常见的两大列），或左右交替
      const cols = Math.max(1, Math.min(4, listCols))
      const perCol = Math.max(1, Math.ceil(items.length / cols))
      const rowsInCol = listFlow === 'col' ? perCol : Math.ceil(items.length / cols)
      // 图标和行高都可调；行数多到放不下时整体等比缩，保证不裁行。
      const wantRow = listIconSize + listRowGap
      const shrink = Math.min(1, available / (wantRow * Math.max(1, rowsInCol)))
      const icon = Math.max(8, listIconSize * shrink)
      const rowH = Math.max(icon + 2, wantRow * shrink)
      const textSize = Math.max(10, Math.round(icon * listTextScale))
      const colGap = Math.max(10, icon * 0.35)
      const colW = (w - margin * 2 - colGap * (cols - 1)) / cols

      if (title) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `${weight} ${listTitleSize}px "${font}"`
        drawStyledText(title, w / 2, margin + listTitleSize / 2, lineColor(0, Math.max(1, logicalLines.length)))
      }

      ctx.textBaseline = 'middle'
      // 自动对齐：短名字补空格补到参考字数，效果文字才会竖着排整齐
      const padName = (value: string) => {
        if (!autoAlign) return value
        const want = Math.max(1, alignRefChars)
        return value.length >= want ? value : value + '　'.repeat(want - value.length)
      }
      items.forEach((item, index) => {
        const col = listFlow === 'col' ? Math.floor(index / perCol) : index % cols
        const rowInCol = listFlow === 'col' ? index % perCol : Math.floor(index / cols)
        const left = margin + (colW + colGap) * col
        const right = left + colW
        const nameX = listIconPos === 'right' ? left : left + icon + Math.max(8, icon * 0.22)
        const nameWidth = Math.max(40, (right - nameX) * Math.min(0.9, Math.max(0.15, listNameRatio)))
        const rowTop = listTop + rowH * rowInCol
        const centerY = rowTop + rowH / 2
        // 斑马底条：直播画面上没有它，长清单会糊成一片
        if (listStripe && index % 2 === 1) {
          ctx.save()
          ctx.fillStyle = hexToRgba(listStripeColor, Math.min(1, Math.max(0, listStripeAlpha)))
          ctx.fillRect(left, rowTop, colW, rowH)
          ctx.restore()
        }
        const image = item.imagePath ? menuImageRefs.current[item.imagePath] : undefined
        if (image) {
          const fit = Math.min(icon / Math.max(1, image.width), icon / Math.max(1, image.height))
          const drawW = image.width * fit
          const drawH = image.height * fit
          // 图标位置：左 / 上 / 右
          const iconX = listIconPos === 'right' ? right - icon + (icon - drawW) / 2 : listIconPos === 'top' ? (left + right) / 2 - drawW / 2 : left + (icon - drawW) / 2
          const iconY = listIconPos === 'top' ? rowTop + Math.max(2, rowH * 0.06) : centerY - drawH / 2
          ctx.save()
          // 图标闪动：只让图跟着节拍闪，文字保持常亮
          if (effBlink === 'icon' && !blinkOnRef.current) ctx.globalAlpha = 0.12
          ctx.drawImage(image, iconX, iconY, drawW, drawH)
          ctx.restore()
        }
        ctx.font = `${weight} ${textSize}px "${font}"`
        ctx.textAlign = 'left'
        const diamond = listShowDiamond && item.diamondCount ? ` ${item.diamondCount}钻` : ''
        const label = padName(`${item.name}${diamond}`)
        const effect = (item.effect || '').trim()
        const rowColor = colorMode === 'single' ? (listNameColor || color) : lineColor(index + (title ? 1 : 0), Math.max(1, logicalLines.length))
        // 分栏时每栏宽度有限，文字必须缩进栏内，否则右栏会压到左栏、末尾被裁掉
        const drawFit = (value: string, x: number, y: number, fill: string, maxWidth: number) => {
          if (maxWidth <= 0) return
          let size = textSize
          ctx.font = `${weight} ${size}px "${font}"`
          let guard = 0
          while (ctx.measureText(value).width > maxWidth && size > 9 && guard++ < 40) {
            size -= 1
            ctx.font = `${weight} ${size}px "${font}"`
          }
          drawStyledText(value, x, y, fill)
          ctx.font = `${weight} ${textSize}px "${font}"`
        }
        const effectColorNow = colorMode === 'single' ? (listEffectColor || color) : rowColor
        if (listIconPos === 'top') {
          // 图在上：文字画在图下方，整行居中
          ctx.textAlign = 'center'
          const textY = rowTop + rowH - textSize * 0.7
          const line = listShowName ? (effect ? `${label}${listSep}${effect}` : label) : effect
          drawFit(line, (left + right) / 2, textY, listShowName ? rowColor : effectColorNow, colW - 8)
        } else {
          const textLeft = listIconPos === 'right' ? left : nameX
          const textRight = listIconPos === 'right' ? right - icon - Math.max(8, icon * 0.22) : right
          if (!listShowName) {
            // 关掉礼物名：只剩「图 + 整蛊名」，箭头也一起省掉
            drawFit(effect || label, textLeft, centerY, effectColorNow, textRight - textLeft)
          } else {
            const effectWidth = effect ? Math.max(40, (textRight - textLeft) * (1 - Math.min(0.85, Math.max(0.15, listNameRatio)))) : 0
            const nameMax = Math.max(30, textRight - textLeft - effectWidth)
            drawFit(label, textLeft, centerY, rowColor, nameMax)
            if (effect) {
              // 名字实际多宽就从哪儿接着写，但不越过本栏右边界
              ctx.font = `${weight} ${textSize}px "${font}"`
              const measured = Math.min(ctx.measureText(label).width, nameMax)
              const effectX = Math.min(textLeft + Math.max(measured + textSize * 0.3, nameMax * 0.92), textRight - 20)
              drawFit(`${listSep}${effect}`, effectX, centerY, effectColorNow, textRight - effectX)
            }
          }
        }
      })
      ctx.restore()
      return
    }

    const titleSize = title ? Math.round(fs * 1.1) : 0
    const top = margin + (title ? titleSize * 1.35 : 0)
    const availableH = Math.max(1, h - top - margin)
    const columns = Math.max(1, Math.min(h > w ? 2 : 4, items.length || 1))
    const rows = Math.max(1, Math.ceil(items.length / columns))
    const cellW = (w - margin * 2) / columns
    const maxImageBound = Math.max(8, Math.min(cellW * 0.58, h * 0.2))
    const labelSize = Math.max(12, Math.min(fs, Math.floor(maxImageBound * 0.3)))
    // 每个图片项保持为紧凑卡位，名称必须紧跟礼物图，而非被画布高度拉到页面底部。
    const cellH = Math.min(availableH / rows, maxImageBound + labelSize * 2.8)
    const imageBound = Math.max(8, Math.min(maxImageBound, cellH - labelSize * 2.2))

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (title) {
      ctx.font = `${weight} ${titleSize}px "${font}"`
      drawStyledText(title, w / 2, margin + titleSize / 2, lineColor(0, Math.max(1, logicalLines.length)))
    }
    items.forEach((item, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = margin + cellW * (column + 0.5)
      const y = top + cellH * row
      const imageTop = y + Math.max(0, (cellH - imageBound - labelSize * 1.7) / 2)
      const image = item.imagePath ? menuImageRefs.current[item.imagePath] : undefined
      if (image) {
        const fit = Math.min(imageBound / Math.max(1, image.width), imageBound / Math.max(1, image.height))
        const drawW = image.width * fit
        const drawH = image.height * fit
        ctx.drawImage(image, x - drawW / 2, imageTop, drawW, drawH)
      }
      ctx.font = `${weight} ${labelSize}px "${font}"`
      const label = `${item.name}${item.diamondCount ? ` ${item.diamondCount}钻` : ''}`
      drawStyledText(label, x, imageTop + imageBound + labelSize * 0.75, lineColor(index + (title ? 1 : 0), Math.max(1, logicalLines.length)))
    })
    ctx.restore()
  }

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = dims()
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    ctx.clearRect(0, 0, w, h)

    // 背景
    if (bgAlpha > 0) {
      ctx.fillStyle = hexToRgba(bgColor, Math.min(1, Math.max(0, bgAlpha)))
      ctx.fillRect(0, 0, w, h)
    }

    if (giftMenuPreview) {
      drawGiftMenu(ctx, w, h)
      return
    }

    // 图片叠加（预加载好的元素，同步画）
    if (renderMode !== 'text' && imgElRef.current) {
      const img = imgElRef.current
      const iw = img.width || 1
      const ih = img.height || 1
      const fit = Math.min(w / iw, h / ih) * imgScale
      const dw = iw * fit
      const dh = ih * fit
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }

    ctx.save()
    // 旋转（整体，绕画布中心）
    if (rotate !== 0) {
      ctx.translate(w / 2, h / 2)
      ctx.rotate((rotate * Math.PI) / 180)
      ctx.translate(-w / 2, -h / 2)
    }

    ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'
    ctx.textBaseline = 'middle'
    ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`
    const weight = bold ? 'bold' : 'normal'
    const lines = numberedLines()

    // 自动字号（复刻 isAutoFont：最长行占画布宽 92% 以内的最大字号）
    let fs = Math.max(8, Math.round(fontSize * fontScale))
    if (autoFont && lines.length > 0) {
      ctx.font = `${weight} 100px "${font}"`
      let maxW = 1
      for (const l of lines) {
        const m = ctx.measureText(l || ' ')
        if (m.width > maxW) maxW = m.width
      }
      fs = Math.max(8, Math.floor((100 * w * 0.92) / maxW))
      // 高度也不许爆：全部行 + 行距 ≤ 画布高 92%
      const maxByH = Math.floor((h * 0.92) / (lines.length * lineHeight))
      fs = Math.min(fs, Math.max(8, maxByH))
    }
    ctx.font = `${weight} ${fs}px "${font}"`

    const lh = fs * lineHeight
    const totalH = lines.length * lh
    const baseY = align === 'top' ? fs / 2 + boxPad : h / 2 - (totalH - lh) / 2

    // 滚动偏移：竖向 = y 偏移循环；横向 = x 偏移循环（修复：原版左右滚动选了没效果）
    const isVScroll = scrollDir === 'up' || scrollDir === 'down'
    const isHScroll = scrollDir === 'left' || scrollDir === 'right'
    const vCycle = totalH + lh // 竖向循环周期：整块文字高 + 一行间隙
    let maxLineW = 0
    for (const l of lines) {
      const m = ctx.measureText(l || ' ')
      if (m.width > maxLineW) maxLineW = m.width
    }
    const hCycle = maxLineW + w * 0.4 // 横向循环周期：最长行宽 + 40% 画布宽间隙
    const rawPos = scrollPosRef.current || 0
    const vOff = isVScroll ? ((rawPos % vCycle) + vCycle) % vCycle : 0
    const hOff = isHScroll ? ((rawPos % hCycle) + hCycle) % hCycle : 0

    const xBase = align === 'left' ? boxPad : align === 'right' ? w - boxPad : w / 2

    // 底框：画在文字层【下面】（修复：原版画在文字之后，半透明底把字盖花）
    if (boxOn) {
      const boxW = maxLineW + boxPad * 2
      const boxH = totalH + boxPad * 2
      const bx = align === 'left' ? 0 : align === 'right' ? w - boxW : (w - boxW) / 2
      const by = align === 'top' ? 0 : (h - boxH) / 2
      ctx.fillStyle = hexToRgba(boxColor, Math.min(1, Math.max(0, boxAlpha)))
      ctx.beginPath()
      ctx.roundRect(bx, by, boxW, boxH, 16)
      ctx.fill()
    }

    // 逐行绘制（发光/阴影/描边/填充 全行生效——修复：原版发光只画了第一行）
    const drawLineAt = (line: string, x: number, y: number, fill: string) => {
      if (glowRange > 0) {
        ctx.save()
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowRange
        ctx.strokeStyle = glowColor
        ctx.lineWidth = Math.max(2, glowRange / 3)
        ctx.lineJoin = 'round'
        ctx.strokeText(line, x, y)
        ctx.restore()
      }
      if (shadowBlur > 0) {
        ctx.save()
        ctx.shadowColor = shadowColor
        ctx.shadowBlur = shadowBlur
        ctx.fillStyle = fill
        ctx.fillText(line, x, y)
        ctx.restore()
      }
      if (strokeWidth > 0) {
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.strokeStyle = strokeColor
        ctx.strokeText(line, x, y)
      }
      ctx.fillStyle = fill
      ctx.fillText(line, x, y)
    }

    lines.forEach((line, i) => {
      const fill = lineColor(i, lines.length)
      if (isHScroll) {
        // 横向滚动：整块沿 x 平移循环，画两份保证无缝
        const dir = scrollDir === 'left' ? -1 : 1
        const off = dir * hOff
        drawLineAt(line, xBase + off, baseY + i * lh, fill)
        drawLineAt(line, xBase + off - dir * hCycle, baseY + i * lh, fill)
      } else if (isVScroll) {
        const dir = scrollDir === 'up' ? -1 : 1
        const off = dir * vOff
        const y1 = baseY + i * lh + off
        drawLineAt(line, xBase, y1, fill)
        drawLineAt(line, xBase, y1 - dir * vCycle, fill)
      } else {
        drawLineAt(line, xBase, baseY + i * lh, fill)
      }
    })

    ctx.restore()
  }

  // 动画循环：滚动 + 闪烁（flash 模式自动闪）
  const effBlink = renderMode === 'flash' && blink === 'none' ? 'short-hide' : blink
  useEffect(() => {
    draw()
    cancelAnimationFrame(animRef.current)
    if (scrollDir === 'none' && effBlink === 'none') return
    let last = Date.now()
    const loop = () => {
      const now = Date.now()
      const dt = (now - last) / 16.667
      last = now
      if (scrollDir !== 'none') {
        scrollPosRef.current += scrollSpeed * dt
      }
      let repaint = scrollDir !== 'none'
      if (effBlink !== 'none') {
        // 短隐长显 / 长隐短显 / 直角闪烁（硬切，不留残影）/ 图标闪动（只闪图，字常亮）
        const unit = Math.max(60, blinkSpeed)
        const onDur = effBlink === 'short-hide' ? unit * 2.8 : effBlink === 'long-hide' ? unit : unit * 2
        const offDur = effBlink === 'short-hide' ? unit : effBlink === 'long-hide' ? unit * 2.8 : unit * 2
        const cycleMs = onDur + offDur
        const visible = now % cycleMs < onDur
        if (visible !== blinkOnRef.current) {
          blinkOnRef.current = visible
          const canvas = canvasRef.current
          if (effBlink === 'icon') {
            repaint = true
            // 图标闪动不动整块画布，交给 draw 里按 iconBlinkRef 控制图片透明度
            canvas?.style.removeProperty('opacity')
          } else {
            canvas?.style.setProperty('opacity', visible ? '1' : effBlink === 'square' ? '0' : '0.12')
          }
        }
      }
      if (repaint) draw()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(animRef.current)
      blinkOnRef.current = true
      if (canvasRef.current) canvasRef.current.style.removeProperty('opacity')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollDir, effBlink, text, font, fontSize, fontScale, autoFont, rotate, color, strokeColor, strokeWidth, spacing, bold, lineHeight, align, autoNumber, numStyle, shadowColor, shadowBlur, glowColor, glowRange, boxOn, boxColor, boxAlpha, boxPad, bgColor, bgAlpha, colorMode, cycleColors, gradFrom, gradTo, randomSeed, scrollSpeed, scale, imgScale, renderMode, giftMenuPreview, giftMenuMode, giftMenuTitle, giftMenuItems, listIconSize, listRowGap, listSep, listNameColor, listEffectColor, listShowDiamond, listNameRatio, listStripe, listStripeColor, listStripeAlpha, listIconPos, listCols, listFlow, listTextScale, autoAlign, alignRefChars, lineColors, blinkSpeed, listShowName])

  const useImagePath = (sourcePath: string, name?: string) => {
    setImgPath(sourcePath)
    setImgDataUrl(mediaUrl(sourcePath))
    setImgName(name || sourcePath.split(/[\\/]/).pop() || '')
  }

  const pickImage = async () => {
    const r = await window.api.selectFile({
      title: '选择图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    if (r.ok && r.path) useImagePath(r.path)
  }

  // 配置导入/导出（原版「导出配置 / 导入配置」）：把这个工具的全部本地存档打成一个 json，
  // 换电脑或者给朋友照搬版式时直接导。
  const TRANSPARENT_KEYS = [
    PROGRAMS_KEY, MATERIAL_KEY, GIFT_LIBRARY_KEY, TEXT_MENU_PROGRAMS_KEY,
    IMAGE_MENU_PROGRAMS_KEY, LIST_MENU_PROGRAMS_KEY, LIST_MENU_STYLE_KEY, COLORS_KEY
  ]

  const exportConfig = async () => {
    const dump: Record<string, unknown> = {}
    for (const key of TRANSPARENT_KEYS) {
      const raw = localStorage.getItem(key)
      if (raw != null) dump[key] = raw
    }
    const payload = JSON.stringify({ kind: 'zhiliao-transparent-config', version: 1, data: dump }, null, 2)
    const dataUrl = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(payload)))
    // 跟导出 PNG 同一套走向：设了合成图片目录就直接落盘，否则弹保存框
    const result = await window.api.entertainmentSavePng(dataUrl, '透明图配置.json', mat.outputDir || undefined)
    if (result.ok) toast('配置已导出', 'success')
    else toast(result.error || '导出失败', 'error')
  }

  const importConfig = async () => {
    const picked = await window.api.selectFile({
      title: '选择配置文件',
      filters: [{ name: '配置', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (!picked.ok || !picked.path) return
    try {
      const text = await (await fetch(mediaUrl(picked.path))).text()
      const parsed = JSON.parse(text) as { kind?: string; data?: Record<string, string> }
      if (parsed.kind !== 'zhiliao-transparent-config' || !parsed.data) return toast('这不是透明图工具的配置文件', 'error')
      for (const [key, value] of Object.entries(parsed.data)) {
        if (TRANSPARENT_KEYS.includes(key) && typeof value === 'string') localStorage.setItem(key, value)
      }
      toast('配置已导入，重新打开本页生效', 'success')
    } catch {
      toast('配置文件读取失败', 'error')
    }
  }

  // 按内容裁剪：画布是固定比例的，礼物列表通常只占上面一小块，
  // 直接导出会得到一张大半透明的图，叠到直播画面上很难对位。裁到内容边界再留一点边。
  const croppedDataUrl = (canvas: HTMLCanvasElement, pad: number): string => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas.toDataURL('image/png')
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    let top = height, left = width, right = -1, bottom = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === 0) continue
        if (y < top) top = y
        if (y > bottom) bottom = y
        if (x < left) left = x
        if (x > right) right = x
      }
    }
    if (right < 0 || bottom < 0) return canvas.toDataURL('image/png')
    const x0 = Math.max(0, left - pad)
    const y0 = Math.max(0, top - pad)
    const w = Math.min(width - x0, right - left + 1 + pad * 2)
    const h = Math.min(height - y0, bottom - top + 1 + pad * 2)
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')?.drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
    return out.toDataURL('image/png')
  }

  const exportPng = async (defaultName?: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const dataUrl = cropExport ? croppedDataUrl(canvas, cropPad) : canvas.toDataURL('image/png')
      const name = defaultName ?? (giftMenuPreview ? `礼物菜单_${Date.now()}.png` : `透明图_${Date.now()}.png`)
      const r = await window.api.entertainmentSavePng(dataUrl, name, mat.outputDir || undefined)
      if (r.ok) toast(`已保存：${r.path}`, 'success')
      else toast(r.error ?? '保存失败', 'error')
    } catch {
      toast('导出失败', 'error')
    }
  }

  const makeGiftMenu = () => {
    if (!giftMenuItems.length) return toast('礼物菜单至少需要一个礼物', 'error')
    setGiftMenuPreview(true)
    // 等状态提交和 Canvas 重绘完成后导出，避免把切换前的普通透明图写成菜单文件。
    requestAnimationFrame(() => requestAnimationFrame(() => exportPng(`礼物菜单_${Date.now()}.png`)))
  }

  // 导出 GIF 动画（复刻参考「开始制作滚动图片/闪动视频」）。
  // 滚动：帧覆盖一个完整循环周期 → 首尾无缝；闪烁：亮/暗帧交替。
  const exportGif = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const originalScroll = scrollPosRef.current
      const isScroll = scrollDir !== 'none'
      const frameCount = isScroll ? 24 : 8
      const frames: { width: number; height: number; pixels: Uint8ClampedArray; delayMs: number }[] = []
      // 循环周期与 draw 内一致
      const { w } = dims()
      const lines = numberedLines()
      const fsNow = Math.max(8, Math.round(fontSize * fontScale))
      const lh = fsNow * lineHeight
      const vCycle = lines.length * lh + lh
      ctx.font = `${bold ? 'bold' : 'normal'} ${fsNow}px "${font}"`
      let maxLineW = 0
      for (const l of lines) {
        const m = ctx.measureText(l || ' ')
        if (m.width > maxLineW) maxLineW = m.width
      }
      const hCycle = maxLineW + w * 0.4
      const cycle = scrollDir === 'left' || scrollDir === 'right' ? hCycle : vCycle
      for (let i = 0; i < frameCount; i++) {
        if (isScroll) {
          scrollPosRef.current = (cycle * i) / frameCount
        }
        draw()
        if (!isScroll && effBlink !== 'none') {
          // 闪烁 GIF：偶数帧原样，奇数帧压暗
          if (i % 2 === 1) {
            ctx.save()
            ctx.globalCompositeOperation = 'destination-in'
            ctx.fillStyle = 'rgba(0,0,0,0.1)'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.restore()
          }
        }
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        frames.push({ width: canvas.width, height: canvas.height, pixels: img.data, delayMs: isScroll ? 60 : 300 })
      }
      scrollPosRef.current = originalScroll
      draw()
      // 和 PNG 导出同一套裁法：取所有帧透明边界的并集再留边。滚动/闪烁每帧内容位置不同，
      // 逐帧各裁各的画面会抖，并集边界能保证动画稳定又不带大片透明。
      if (cropExport) {
        const fullW = canvas.width
        const fullH = canvas.height
        let top = fullH, left = fullW, right = -1, bottom = -1
        for (const frame of frames) {
          const px = frame.pixels
          for (let y = 0; y < fullH; y++) {
            for (let x = 0; x < fullW; x++) {
              if (px[(y * fullW + x) * 4 + 3] === 0) continue
              if (y < top) top = y
              if (y > bottom) bottom = y
              if (x < left) left = x
              if (x > right) right = x
            }
          }
        }
        if (right >= 0 && bottom >= 0) {
          const x0 = Math.max(0, left - cropPad)
          const y0 = Math.max(0, top - cropPad)
          const w = Math.min(fullW - x0, right - left + 1 + cropPad * 2)
          const h = Math.min(fullH - y0, bottom - top + 1 + cropPad * 2)
          for (const frame of frames) {
            const out = new Uint8ClampedArray(w * h * 4)
            for (let y = 0; y < h; y++) {
              const start = ((y0 + y) * fullW + x0) * 4
              out.set(frame.pixels.subarray(start, start + w * 4), y * w * 4)
            }
            frame.pixels = out
            frame.width = w
            frame.height = h
          }
        }
      }
      const blob = encodeGif(frames)
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      const r = await window.api.entertainmentSavePng(dataUrl, `透明图动画_${Date.now()}.gif`, mat.outputDir || undefined)
      if (r.ok) toast(`已保存 GIF：${r.path}`, 'success')
      else toast(r.error ?? '保存失败', 'error')
    } catch {
      toast('GIF 导出失败', 'error')
    }
  }

  const resetAll = () => {
    setText('感谢你的礼物')
    setFont('微软雅黑')
    setFontSize(50)
    setFontScale(1)
    setAutoFont(false)
    setRotate(0)
    setColor('#ffffff')
    setStrokeColor('#000000')
    setStrokeWidth(5)
    setSpacing(0)
    setBold(true)
    setLineHeight(1.35)
    setAlign('center')
    setAutoNumber(false)
    setNumStyle('dot')
    setShadowBlur(0)
    setGlowRange(0)
    setBoxOn(false)
    setBgAlpha(0)
    setColorMode('single')
    setCycleColors(DEFAULT_CYCLE)
    setScrollDir('none')
    setBlink('none')
    setImgDataUrl('')
    setImgPath('')
    setImgName('')
    setGiftPlatform('dy')
    setGiftName('')
    setGiftId('')
    setGiftDiamondCount(0)
    setGiftData('')
    setGiftImagePath('')
    setGiftImageName('')
    setGiftLibraryPick('')
    setGiftMenuPreview(false)
    toast('已重置', 'info')
  }


  const activeGiftMenuPrograms = menuPrograms

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <div className="mb-5 border-b border-[var(--line)] pb-4"><SkinPicker label="透明图配色" value={visualSkin} onChange={(id) => {
          setVisualSkin(id)
          const colors = widgetSkin(id)
          setColor(colors.text); setColorMode('single'); setStrokeColor(colors.bg); setStrokeWidth(2)
          setShadowColor(colors.bg); setShadowBlur(0); setGlowRange(0)
          setListNameColor(colors.text); setListEffectColor(colors.accent)
          setBoxColor(colors.bg); setBoxAlpha(0.94); setBoxOn(true)
          setListStripeColor(colors.surface); setListStripeAlpha(0.88)
        }} /></div>

        <div className="space-y-3">
          {/* ============ 主体：整蛊菜单制作 ============ */}
          <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-2)]">制作礼物菜单</span>
              <Segmented
                size="sm"
                value={giftMenuMode}
                onChange={(value) => { setGiftMenuMode(value as GiftMenuMode); setGiftMenuProgramPick('') }}
                options={[{ value: 'list', label: '整蛊竖列' }, { value: 'text', label: '文字菜单' }, { value: 'image', label: '图片宫格' }]}
              />
            </div>
            <Field label="菜单标题">
              <Input value={giftMenuTitle} onChange={(e) => setGiftMenuTitle(e.target.value)} placeholder="标题" />
            </Field>
            {(
              <Field label="批量填写" hint={giftMenuMode === 'list' ? '一行一条：礼物名 = 对应整蛊。礼物图自动匹配' : '一行一个礼物名（也可写 礼物名 = 备注），礼物图自动匹配'}>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={5}
                  placeholder={'小心心 = 屏幕反转' + String.fromCharCode(10) + '棒棒糖 = 手抖三秒' + String.fromCharCode(10) + '大啤酒 = 强制干杯'}
                  className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent-2)]"
                />
                <div className="mt-1.5 flex gap-2">
                  <Btn size="sm" variant="secondary" onClick={importFromRules} className="flex-1" title="按「礼物触发」里当前启用的规则生成（用项目预设开哪几个项目，这儿就出哪几个）"><ListChecks size={13} /> 从礼物规则生成</Btn>
                  <Btn size="sm" variant="secondary" onClick={importFromGameConfig} className="flex-1" title="按当前游戏礼物映射自动生成"><Gamepad2 size={13} /> 从游戏配置生成</Btn>
                </div>
                <div className="mt-1.5 flex gap-2">
                  <Btn size="sm" variant="ghost" onClick={sortMenuByPrice} title="按礼物价格重排当前列表（便宜→贵）">按价排序</Btn>
                </div>
                <div className="mt-1.5 flex gap-2">
                  <Btn size="sm" onClick={() => bulkFillMenu(bulkText, false)} className="flex-1"><Plus size={13} /> 生成列表（覆盖）</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => bulkFillMenu(bulkText, true)} className="flex-1">追加</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setBulkText(giftMenuItems.map((item) => `${item.name} = ${item.effect ?? ''}`).join(String.fromCharCode(10)))} title="把当前列表回填到文本框">回填</Btn>
                </div>
              </Field>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--text-4)]">按当前顺序绘制，{giftMenuMode === 'list' ? '一行一个礼物：左边礼物图，右边「礼物名 → 对应整蛊」' : giftMenuMode === 'image' ? '礼物图排成宫格' : '只显示名称和钻石数'}。</span>
              <Btn size="sm" variant="secondary" onClick={addGiftToMenu} title="将选中的礼物加入菜单"><Plus size={13} /> 加入</Btn>
            </div>
            {giftMenuItems.length > 3 && (
              <Input value={menuFilter} onChange={(e) => setMenuFilter(e.target.value)} placeholder="搜列表（礼物名 / 整蛊名）…" className="h-7 text-xs" />
            )}
            <div className="max-h-80 overflow-y-auto rounded border border-[var(--line)] bg-[var(--bg-input)] p-1">
              {giftMenuItems.length === 0 ? (
                <span className="block px-2 py-3 text-center text-[11px] text-[var(--text-4)]">上面写好「礼物名 = 整蛊」点生成，或从礼物规则一键生成</span>
              ) : giftMenuItems
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => {
                  const q = menuFilter.trim()
                  return !q || item.name.includes(q) || (item.effect || '').includes(q)
                })
                .map(({ item, index }) => (
                <div
                  key={`${item.id}-${index}`}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, index }) }}
                  className="flex flex-wrap items-center gap-1 rounded px-1.5 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--bg-elev)]"
                >
                  <span className="w-5 shrink-0 text-right tnum text-[var(--text-4)]">{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => { setSwapIndex(swapIndex === index ? null : index); setSwapSearch('') }}
                    title="点这里换个礼物"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition hover:bg-[var(--accent-soft)] ${swapIndex === index ? 'bg-[var(--accent-soft)]' : ''}`}
                  >
                    {item.imagePath ? <img src={mediaUrl(item.imagePath)} alt="" className="h-5 w-5 object-contain" /> : <Gift size={13} className="text-[var(--text-4)]" />}
                  </button>
                  <span className={`min-w-0 truncate ${giftMenuMode === 'list' ? 'w-16 shrink-0' : 'flex-1'}`}><EmojiText text={item.name} /></span>
                  {giftMenuMode === 'list' ? (
                    <Input
                      value={item.effect ?? ''}
                      onChange={(e) => setGiftMenuItems((previous) => previous.map((row, rowIndex) => rowIndex === index ? { ...row, effect: e.target.value } : row))}
                      placeholder="对应什么整蛊"
                      className="min-w-0 flex-1"
                    />
                  ) : (
                    <span className="tnum text-[11px] text-[var(--text-4)]">{item.diamondCount || '-'}</span>
                  )}
                  <Btn size="sm" variant="ghost" onClick={() => moveGiftMenuItem(index, -1)} disabled={index === 0} title="上移"><ArrowUp size={13} /></Btn>
                  <Btn size="sm" variant="ghost" onClick={() => moveGiftMenuItem(index, 1)} disabled={index === giftMenuItems.length - 1} title="下移"><ArrowDown size={13} /></Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setGiftMenuItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} title="移除"><X size={13} /></Btn>
                  {swapIndex === index && (
                    <div className="mt-1 w-full rounded border border-[var(--accent-2)] bg-[var(--bg-card)] p-1.5">
                      <Input value={swapSearch} onChange={(e) => setSwapSearch(e.target.value)} placeholder="搜礼物名，点一下就替换" autoFocus />
                      <div className="mt-1 grid max-h-32 grid-cols-4 gap-1 overflow-y-auto">
                        {canonicalGiftImgs
                          .filter((gift) => !swapSearch.trim() || gift.name.includes(swapSearch.trim()))
                          .slice(0, 60)
                          .map((gift) => (
                            <button
                              key={gift.path}
                              type="button"
                              title={gift.name}
                              onClick={() => {
                                setGiftMenuItems((previous) => previous.map((row, rowIndex) => rowIndex === index
                                  ? { ...row, name: gift.name, imagePath: gift.path, giftId: gift.giftId || row.giftId, diamondCount: gift.diamondCount ?? DOUYIN_PRICES.get(normalizedLabel(gift.name)) ?? row.diamondCount }
                                  : row))
                                setSwapIndex(null)
                              }}
                              className="flex flex-col items-center gap-0.5 rounded p-1 transition hover:bg-[var(--accent-soft)]"
                            >
                              <img src={mediaUrl(gift.path)} alt="" className="h-7 w-7 object-contain" />
                              <span className="w-full truncate text-[9px] text-[var(--text-4)]">{gift.name}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {giftMenuMode === 'list' && (
              <div className="space-y-2 rounded border border-[var(--line)] bg-[var(--bg-card)] p-2">
                {/* 常用的三项放外面，其余收进折叠，免得一屏全是选项 */}
                <div className="flex flex-wrap items-center gap-3">
                  <Field label="分几栏" className="w-auto">
                    <Segmented size="sm" value={String(listCols)} onChange={(v) => setListCols(Number(v))} options={[{ value: '1', label: '1栏' }, { value: '2', label: '2栏' }, { value: '3', label: '3栏' }]} />
                  </Field>
                  <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]"><Toggle value={listShowName} onChange={setListShowName} />显示礼物名</label>
                  <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]"><Toggle value={listStripe} onChange={setListStripe} />隔行底条</label>
                </div>
                <CollapseSection title="排版微调（图多大、字多大、颜色、间距）">
                <div className="grid grid-cols-2 gap-2">
                  <Field advanced label="礼物图大小">
                    <Input type="number" min={16} max={240} value={listIconSize} onChange={(e) => setListIconSize(Math.max(16, Math.min(240, Number(e.target.value) || 84)))} />
                  </Field>
                  <Field advanced label="行间距">
                    <Input type="number" min={0} max={120} value={listRowGap} onChange={(e) => setListRowGap(Math.max(0, Math.min(120, Number(e.target.value) || 0)))} />
                  </Field>
                  <Field advanced label="连接符" hint="礼物名和效果之间显示什么">
                    <Input value={listSep} onChange={(e) => setListSep(e.target.value)} placeholder=" → " />
                  </Field>
                  <Field advanced label="礼物名占宽" hint="0.15~0.9，效果文字从这里开始">
                    <Input type="number" step={0.02} min={0.15} max={0.9} value={listNameRatio} onChange={(e) => setListNameRatio(Math.max(0.15, Math.min(0.9, Number(e.target.value) || 0.38)))} />
                  </Field>
                  <Field advanced label="礼物名颜色">
                    <div className="flex gap-1.5">
                      <input type="color" value={listNameColor} onChange={(e) => setListNameColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-[var(--line)] bg-[var(--bg-input)]" />
                      <Input value={listNameColor} onChange={(e) => setListNameColor(e.target.value)} />
                    </div>
                  </Field>
                  <Field advanced label="效果文字颜色">
                    <div className="flex gap-1.5">
                      <input type="color" value={listEffectColor} onChange={(e) => setListEffectColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-[var(--line)] bg-[var(--bg-input)]" />
                      <Input value={listEffectColor} onChange={(e) => setListEffectColor(e.target.value)} />
                    </div>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field advanced label="怎么填" hint="填满一栏再起下一栏 / 左右交替">
                    <Segmented size="sm" value={listFlow} onChange={(v) => setListFlow(v as typeof listFlow)} options={[{ value: 'col', label: '按栏填' }, { value: 'row', label: '左右交替' }]} />
                  </Field>
                  <Field advanced label="文字大小" hint="相对礼物图的倍数">
                    <div className="flex items-center gap-2">
                      <input type="range" min={0.3} max={1.5} step={0.02} value={listTextScale} onChange={(e) => setListTextScale(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
                      <span className="tnum w-10 text-right text-xs text-[var(--text-3)]">{listTextScale.toFixed(2)}</span>
                    </div>
                  </Field>
                  <Field advanced label="礼物图位置">
                    <Segmented size="sm" value={listIconPos} onChange={(v) => setListIconPos(v as typeof listIconPos)} options={[{ value: 'left', label: '靠左' }, { value: 'top', label: '靠上' }, { value: 'right', label: '靠右' }]} />
                  </Field>
                  <Field advanced label="对齐字数参考" hint="短名字补空格补到这个字数">
                    <div className="flex items-center gap-2">
                      <Toggle value={autoAlign} onChange={setAutoAlign} />
                      <Input type="number" min={1} max={12} value={alignRefChars} onChange={(e) => setAlignRefChars(Math.max(1, Math.min(12, Number(e.target.value) || 4)))} disabled={!autoAlign} />
                    </div>
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]"><Toggle value={listShowDiamond} onChange={setListShowDiamond} />显示钻石数</label>
                  {listStripe && (
                    <>
                      <span className="text-[11px] text-[var(--text-4)]">底条颜色/浓度</span>
                      <input type="color" value={listStripeColor} onChange={(e) => setListStripeColor(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-[var(--line)] bg-[var(--bg-input)]" />
                      <input type="range" min={0} max={1} step={0.02} value={listStripeAlpha} onChange={(e) => setListStripeAlpha(Number(e.target.value))} className="w-24 accent-[var(--accent)]" />
                    </>
                  )}
                </div>
                </CollapseSection>
              </div>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input value={giftMenuProgramName} onChange={(e) => setGiftMenuProgramName(e.target.value)} placeholder="菜单方案名" />
              <Btn size="sm" variant="secondary" onClick={saveGiftMenu}><Save size={13} /> 保存</Btn>
            </div>
            {activeGiftMenuPrograms.length > 0 && (
              <div className="flex gap-2">
                <Select value={giftMenuProgramPick} onChange={(e) => { setGiftMenuProgramPick(e.target.value); if (e.target.value) loadGiftMenu(e.target.value) }}>
                  <option value="">-- 选择{giftMenuMode === 'text' ? '文字' : giftMenuMode === 'image' ? '图片' : '竖列'}菜单方案 --</option>
                  {activeGiftMenuPrograms.map((program) => <option key={program.name} value={program.name}>{program.name}</option>)}
                </Select>
                {giftMenuProgramPick && <Btn size="sm" variant="ghost" onClick={() => deleteGiftMenu(giftMenuProgramPick)} title="删除菜单方案"><Trash2 size={14} /></Btn>}
              </div>
            )}
            <div className="flex gap-2">
              <Btn size="sm" onClick={makeGiftMenu} className="flex-1"><Gift size={13} /> 制作礼物菜单</Btn>
              {giftMenuPreview && <Btn size="sm" variant="secondary" onClick={() => setGiftMenuPreview(false)} title="回到普通透明图"><X size={13} /></Btn>}
            </div>
            {ctxMenu && (
              <div
                className="fixed z-50 min-w-28 rounded-lg border border-[var(--line-strong)] bg-[var(--bg-card)] py-1 text-xs shadow-lg"
                style={{ left: Math.min(ctxMenu.x, window.innerWidth - 130), top: Math.min(ctxMenu.y, window.innerHeight - 190) }}
              >
                {([
                  ['换礼物', () => { setSwapIndex(ctxMenu.index); setSwapSearch('') }],
                  ['置顶', () => moveGiftMenuItemTo(ctxMenu.index, 0)],
                  ['上移', () => moveGiftMenuItem(ctxMenu.index, -1)],
                  ['下移', () => moveGiftMenuItem(ctxMenu.index, 1)],
                  ['复制这行', () => setGiftMenuItems((previous) => {
                    const copy = [...previous]
                    copy.splice(ctxMenu.index + 1, 0, { ...previous[ctxMenu.index], id: `${previous[ctxMenu.index].id}-copy-${Date.now()}` })
                    return copy
                  })],
                  ['删除', () => setGiftMenuItems((previous) => previous.filter((_, i) => i !== ctxMenu.index))]
                ] as [string, () => void][]).map(([label, action]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { action(); setCtxMenu(null) }}
                    className={`block w-full px-3 py-1.5 text-left transition hover:bg-[var(--accent-soft)] ${label === '删除' ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <CollapseSection title="更多功能">
          <div className="space-y-3 pt-2">
          {/* 重置原来挤在「导出 PNG / 复制 / GIF」那一排里，只有个图标，主播导出时容易误点（2026-09-14 反馈），挪到这里并写明后果 */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2">
            <span className="text-xs text-[var(--text-3)]">从头做一张：清空文字、图片和所有样式（已保存的菜单方案不受影响）</span>
            <Btn variant="secondary" onClick={resetAll}><RefreshCw size={14} /> 重置</Btn>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="画布比例">
              <Select value={scale} onChange={(e) => setScale(e.target.value)}>
                {SCALES.map((s) => (
                  <option key={s.value} value={s.value}>{s.value}</option>
                ))}
              </Select>
            </Field>
            <Field label="模式">
              <Segmented
                value={renderMode}
                onChange={(v) => setRenderMode(v)}
                size="sm"
                options={[
                  { value: 'text', label: '文字' },
                  { value: 'image', label: '图片' },
                  { value: 'flash', label: '闪动' }
                ]}
              />
            </Field>
          </div>

          <Field label="图片叠加" hint="可选：叠加礼物图标/挂件，居中缩放">
            <div className="flex gap-2">
              <Input value={imgName} readOnly placeholder="未选择图片" className="flex-1" />
              {imgDataUrl && <Btn variant="ghost" onClick={() => { setImgDataUrl(''); setImgPath(''); setImgName('') }} title="移除图片"><X size={14} /></Btn>}
              <Btn variant="secondary" onClick={pickImage}><ImagePlus size={14} /> 选图</Btn>
            </div>
            {customImages.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-[var(--text-4)]">图片目录（{customImages.length} 张）：</div>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {customImages.slice(0, 80).map((image) => (
                    <button
                      key={image.path}
                      onClick={() => useImagePath(image.path, image.name)}
                      className="group flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-input)] px-1.5 py-1 text-[11px] text-[var(--text-3)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
                      title={image.path}
                    >
                      <img src={mediaUrl(image.path)} alt="" className="h-6 w-6 object-contain" loading="lazy" />
                      {image.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {canonicalGiftImgs.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[11px] text-[var(--text-4)]">内置抖音礼物图（{canonicalGiftImgs.length} 个）：</span>
                  <Input
                    value={giftImgSearch}
                    onChange={(e) => setGiftImgSearch(e.target.value)}
                    placeholder="搜索礼物图…"
                    className="h-6 flex-1 px-2 py-0.5 text-[11px]"
                  />
                </div>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {canonicalGiftImgs
                    .filter((g) => !giftImgSearch.trim() || g.name.includes(giftImgSearch.trim()))
                    .slice(0, 40)
                    .map((g) => (
                    <button
                      key={`${g.name}\u0000${g.path}`}
                      onClick={() => useImagePath(g.path, g.name)}
                      className="group flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-input)] px-1.5 py-1 text-[11px] text-[var(--text-3)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
                      title={g.name}
                    >
                      <img src={mediaUrl(g.path)} alt="" className="h-6 w-6 object-contain" loading="lazy" />
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {imgDataUrl && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-4)]">大小</span>
                <input type="range" min={0.1} max={2} step={0.05} value={imgScale} onChange={(e) => setImgScale(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
                <span className="tnum text-[11px] text-[var(--text-4)]">{imgScale.toFixed(2)}x</span>
              </div>
            )}
          </Field>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-3)]">素材目录</span>
              {mat.outputDir && (
                <button
                  onClick={() => window.api.openPath(mat.outputDir)}
                  className="text-[11px] text-[var(--accent-2)] transition hover:underline"
                >
                  打开图片位置
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {([['fontDir', '字体目录'], ['imageDir', '图片目录'], ['outputDir', '合成图片目录']] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-[var(--text-4)]">{label}</span>
                  <Input value={mat[key]} readOnly placeholder="未设置" className="flex-1 text-[11px]" />
                  <Btn size="sm" variant="secondary" onClick={() => pickMaterialDir(key)}>选择</Btn>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-[var(--text-4)]">
              设置合成图片目录后，导出直接保存到该目录，不再弹保存框。
            </p>
          </div>

          <Field label="文字内容" hint="支持多行，用换行分隔">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent-2)]"
            />
          </Field>

          <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-2)]"><Database size={14} /> 原版数据库</span>
              <span className="text-[11px] text-[var(--text-4)]">gf.db / config.db / ZIP</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-[var(--text-4)]">重名</span>
              <Segmented
                size="sm"
                value={giftMergeMode}
                onChange={(value) => setGiftMergeMode(value as GiftMergeMode)}
                options={[{ value: 'overwrite', label: '覆盖现有' }, { value: 'skip', label: '跳过现有' }]}
              />
              <Btn size="sm" variant="secondary" onClick={importTransparentDatabase} disabled={databaseBusy}><Upload size={13} /> 导入</Btn>
              <Btn size="sm" variant="secondary" onClick={exportTransparentDatabase} disabled={databaseBusy}><Download size={13} /> 导出</Btn>
            </div>
            {databaseImportInfo && (
              <div className="space-y-1 text-[11px] text-[var(--text-4)]">
                <div className="truncate" title={databaseImportInfo.source}>最近导入：{databaseImportInfo.source}</div>
                <div>礼物 +{databaseImportInfo.gifts.added} / 覆盖 {databaseImportInfo.gifts.replaced} / 跳过 {databaseImportInfo.gifts.skipped} · 文字菜单 +{databaseImportInfo.textMenus.added} · 图片菜单 +{databaseImportInfo.imageMenus.added} · 普通方案 +{databaseImportInfo.programs.added}</div>
                {(databaseImportInfo.versions.added > 0 || databaseImportInfo.colors.added > 0) && <div>版本表 +{databaseImportInfo.versions.added} · 配色表 +{databaseImportInfo.colors.added}</div>}
                {databaseImportInfo.warnings.map((warning) => <div key={warning} className="text-[var(--warn)]">{warning}</div>)}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-2)]"><Gift size={14} /> 礼物库</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-4)]">{giftLibrary.length} 个礼物</span>
                <Btn size="sm" variant="secondary" onClick={importLocalGiftImages} title="将连接器已下载的真实抖音礼物图导入礼物库"><ImagePlus size={13} /> 导入本地礼物图</Btn>
              </div>
            </div>
            {giftLibrary.length > 0 && (
              <div>
                <div className="relative mb-1.5">
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
                  <Input value={giftLibrarySearch} onChange={(e) => setGiftLibrarySearch(e.target.value)} placeholder="搜索礼物库（内置图）…" className="pl-7 text-xs" />
                </div>
                <div className="max-h-36 overflow-y-auto rounded border border-[var(--line)] bg-[var(--bg-input)] p-1">
                {giftLibrary
                  .filter((item) => !giftLibrarySearch.trim() || item.name.includes(giftLibrarySearch.trim()))
                  .map((item) => (
                  <button
                    key={item.id}
                    onClick={() => selectGift(item)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition ${giftLibraryPick === item.id ? 'bg-[var(--accent-soft)] text-[var(--accent-2)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-elev)]'}`}
                    title={`${GIFT_PLATFORMS.find((platform) => platform.value === item.platform)?.label ?? item.platform} · ID ${item.giftId || '未填写'} · ${item.diamondCount} 钻石`}
                  >
                    {item.imagePath ? <img src={mediaUrl(item.imagePath)} alt="" className="h-5 w-5 shrink-0 object-contain" /> : <Gift size={13} className="shrink-0" />}
                    <span className="min-w-0 flex-1 truncate"><EmojiText text={item.name} /></span>
                    <span className="tnum text-[11px] text-[var(--text-4)]">{item.diamondCount || '-'}</span>
                  </button>
                  ))}
                </div>
              </div>
            )}
          </div>


          <CollapseSection title={`常用礼物（抖音礼物库 ${giftCatalogNames.length}） · 点击填入礼物库`}>
            <div className="relative mb-1.5">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
              <Input value={giftSearch} onChange={(e) => setGiftSearch(e.target.value)} placeholder="搜索礼物…" className="pl-7" />
            </div>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {filteredGifts.map((g) => (
                <button
                  key={g}
                  onClick={() => {
                    const image = giftImageByKey.get(normalizedLabel(g))
                    setGiftLibraryPick('')
                    setGiftPlatform('dy')
                    setGiftName(g)
                    setGiftId(image?.giftId || image?.giftIds?.[0] || '')
                    setGiftDiamondCount(image?.diamondCount ?? DOUYIN_PRICES.get(normalizedLabel(g)) ?? 0)
                    setGiftData('')
                    setGiftDataBase64('')
                    setGiftImagePath(image?.path || '')
                    setGiftImageName(image?.path.split(/[\\/]/).pop() || '')
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-card)] px-2 py-0.5 text-[11px] text-[var(--text-2)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-2)]"
                >
                  <Gift size={10} /> {g}
                </button>
              ))}
              {filteredGifts.length === 0 && <span className="p-1 text-[11px] text-[var(--text-4)]">无匹配礼物</span>}
            </div>
          </CollapseSection>

          <CollapseSection title="歌舞单/节目单模板 · 一键填入">
            <div className="flex flex-wrap gap-1.5">
              {SONGLIST_TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setText(t.text)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-card)] px-2 py-1 text-[11px] text-[var(--text-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent-2)]"
                >
                  <Gift size={10} /> {t.name}
                </button>
              ))}
            </div>
          </CollapseSection>

          <CollapseSection title={`表情库（${EMOJIS.length} 个） · 点击插入文字`}>
            <Input value={emojiSearch} onChange={(e) => setEmojiSearch(e.target.value)} placeholder="搜索 emoji…" className="mb-1.5" />
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--bg-input)] p-1.5">
              {filteredEmojis.slice(0, 600).map((e, i) => (
                <button
                  key={`${e}_${i}`}
                  onClick={() => setText((t) => (t ? `${t}${e}` : e))}
                  className="rounded-md px-1 py-0.5 text-lg leading-none transition hover:bg-[var(--accent-soft)]"
                  title={`插入 ${e}`}
                >
                  {e}
                </button>
              ))}
              {filteredEmojis.length === 0 && <span className="p-1 text-[11px] text-[var(--text-4)]">无匹配表情</span>}
              {filteredEmojis.length > 600 && <span className="p-1 text-[11px] text-[var(--text-4)]">…搜索查看更多</span>}
            </div>
          </CollapseSection>

          <div className="grid grid-cols-2 gap-2">
            <Field label="字体" hint={customFonts.length > 0 ? `已加载 ${customFonts.length} 个自定义字体` : undefined}>
              <Select value={font} onChange={(e) => setFont(e.target.value)}>
                {ALL_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </Field>
            <Field label="字号">
              <Input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value) || 0)} disabled={autoFont} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={autoFont} onChange={setAutoFont} />
              自动字号
            </label>
            <Field advanced label="旋转" hint={rotate !== 0 ? `${rotate}°` : '不旋转'}>
              <input type="range" min={-180} max={180} step={1} value={rotate} onChange={(e) => setRotate(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field advanced label="字体缩放" hint={`${Math.round(fontScale * 100)}%`}>
              <input type="range" min={0.3} max={3} step={0.05} value={fontScale} onChange={(e) => setFontScale(Number(e.target.value))} className="w-full accent-[var(--accent)]" disabled={autoFont} />
            </Field>
            <Field advanced label="行间距" hint={`${lineHeight.toFixed(2)}x`}>
              <input type="range" min={0.8} max={2.5} step={0.05} value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="文字颜色">
              <ColorField label="文字颜色" value={color} onChange={setColor} />
            </Field>
            <Field advanced label="描边颜色">
              <ColorField label="描边颜色" value={strokeColor} onChange={setStrokeColor} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field advanced label="描边宽度" hint={strokeWidth > 0 ? `${strokeWidth}px` : '不描边'}>
              <input type="range" min={0} max={24} step={1} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </Field>
            <Field advanced label="字间距(px)">
              <Input type="number" value={spacing} onChange={(e) => setSpacing(Number(e.target.value) || 0)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field advanced label="阴影颜色 + 模糊">
              <div className="flex flex-col gap-1.5">
                <ColorField label="阴影颜色" value={shadowColor} onChange={setShadowColor} />
                <input type="range" min={0} max={30} step={1} value={shadowBlur} onChange={(e) => setShadowBlur(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                <span className="text-[11px] text-[var(--text-4)]">{shadowBlur > 0 ? `${shadowBlur}px` : '关'}</span>
              </div>
            </Field>
            <Field advanced label="发光颜色 + 范围">
              <div className="flex flex-col gap-1.5">
                <ColorField label="发光颜色" value={glowColor} onChange={setGlowColor} />
                <input type="range" min={0} max={40} step={1} value={glowRange} onChange={(e) => setGlowRange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                <span className="text-[11px] text-[var(--text-4)]">{glowRange > 0 ? `${glowRange}px` : '关'}</span>
              </div>
            </Field>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-3)]">底框（圆角半透明底）</span>
              <Toggle value={boxOn} onChange={setBoxOn} />
            </div>
            {boxOn && (
              <div className="space-y-2">
                <Field advanced label="底框颜色">
                  <ColorField label="底框颜色" value={boxColor} onChange={setBoxColor} />
                </Field>
                <Field advanced label="底框透明度" hint={`${Math.round(boxAlpha * 100)}%`}>
                  <input type="range" min={0} max={100} value={Math.round(boxAlpha * 100)} onChange={(e) => setBoxAlpha(Number(e.target.value) / 100)} className="w-full accent-[var(--accent)]" />
                </Field>
                <Field advanced label="内边距(px)">
                  <Input type="number" value={boxPad} onChange={(e) => setBoxPad(Number(e.target.value) || 0)} />
                </Field>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="背景颜色">
              <ColorField label="背景颜色" value={bgColor} onChange={setBgColor} />
            </Field>
            <Field label="背景透明度" hint={bgAlpha > 0 ? `${Math.round(bgAlpha * 100)}%` : '全透明'}>
              <input type="range" min={0} max={100} value={Math.round(bgAlpha * 100)} onChange={(e) => setBgAlpha(Number(e.target.value) / 100)} className="w-full accent-[var(--accent)]" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="对齐">
              <Segmented size="sm" value={align} onChange={setAlign} options={ALIGNS} />
            </Field>
            <Field advanced label="多行颜色">
              <Select value={colorMode} onChange={(e) => setColorMode(e.target.value as typeof colorMode)}>
                <option value="single">单色</option>
                <option value="cycle">循环配色</option>
                <option value="random">随机</option>
                <option value="gradient">渐变（色1→色2）</option>
                <option value="half">对半（前半色1后半色2）</option>
                <option value="diagonal">对角（斜切渐变）</option>
                <option value="split">分割（按配色数切块）</option>
                <option value="manual">逐行指定</option>
              </Select>
            </Field>
          </div>

          {colorMode === 'manual' && (
            <Field advanced label="逐行颜色" hint="按文字的行顺序，一行一个颜色">
              <div className="flex flex-wrap items-center gap-1.5">
                {text.split(String.fromCharCode(10)).map((line, index) => (
                  <span key={index} className="inline-flex items-center gap-1 rounded border border-[var(--line)] px-1.5 py-1">
                    <input
                      type="color"
                      value={lineColors[index] || color}
                      onChange={(e) => setLineColors((previous) => {
                        const next = [...previous]
                        next[index] = e.target.value
                        return next
                      })}
                      className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span className="max-w-16 truncate text-[11px] text-[var(--text-3)]">{line.trim() || `第${index + 1}行`}</span>
                  </span>
                ))}
              </div>
            </Field>
          )}

          {colorMode === 'cycle' && (
            <Field advanced label="循环色组（点色块修改）">
              <div className="flex flex-wrap items-center gap-1.5">
                {cycleColors.map((c, i) => (
                  <span key={i} className="relative inline-flex">
                    <input
                      type="color"
                      value={c}
                      onChange={(e) => {
                        const next = [...cycleColors]
                        next[i] = e.target.value
                        setCycleColors(next)
                      }}
                      className="h-7 w-7 cursor-pointer rounded border border-[var(--line)] bg-transparent"
                    />
                    {cycleColors.length > 2 && (
                      <button
                        onClick={() => setCycleColors(cycleColors.filter((_, j) => j !== i))}
                        className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--bg-card)] text-[9px] leading-none text-[var(--text-4)] shadow hover:text-[var(--danger)]"
                        title="删除此色"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {cycleColors.length < 12 && (
                  <Btn size="sm" variant="ghost" onClick={() => setCycleColors([...cycleColors, '#ffffff'])}>+ 加色</Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={() => setCycleColors(DEFAULT_CYCLE)}>重置</Btn>
              </div>
            </Field>
          )}

          {colorMode === 'random' && (
            <Field advanced label="随机色">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-4)]">每行固定一色，不满意就</span>
                <Btn size="sm" variant="secondary" onClick={() => setRandomSeed((s) => s + 1)}>换一批</Btn>
              </div>
            </Field>
          )}

          {(colorMode === 'gradient' || colorMode === 'half') && (
            <div className="grid grid-cols-2 gap-2">
              <Field advanced label="色1">
                <ColorField label="色1" value={gradFrom} onChange={setGradFrom} />
              </Field>
              <Field advanced label="色2">
                <ColorField label="色2" value={gradTo} onChange={setGradTo} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="滚动">
              <Segmented
                size="sm"
                value={scrollDir}
                onChange={setScrollDir}
                options={[
                  { value: 'none', label: '无' },
                  { value: 'up', label: '上' },
                  { value: 'down', label: '下' },
                  { value: 'left', label: '左' },
                  { value: 'right', label: '右' }
                ]}
              />
            </Field>
            <Field label="闪烁">
              <Segmented
                size="sm"
                value={blink}
                onChange={setBlink}
                options={[
                  { value: 'none', label: '无' },
                  { value: 'short-hide', label: '短隐长显' },
                  { value: 'long-hide', label: '长隐短显' },
                  { value: 'square', label: '直角闪烁' },
                  { value: 'icon', label: '图标闪动' }
                ]}
              />
            </Field>
          </div>

          {blink !== 'none' && (
            <Field advanced label="闪烁快慢" hint="数值越小闪得越快">
              <div className="flex items-center gap-2">
                <input type="range" min={60} max={1200} step={10} value={blinkSpeed} onChange={(e) => setBlinkSpeed(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
                <span className="tnum w-14 text-right text-xs text-[var(--text-3)]">{blinkSpeed}ms</span>
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={autoNumber} onChange={setAutoNumber} />
              自动添加序号
            </label>
            {autoNumber && (
              <Field advanced label="序号样式">
                <Segmented size="sm" value={numStyle} onChange={setNumStyle} options={NUM_STYLES} />
              </Field>
            )}
          </div>

          <Field label="方案管理" hint="保存当前配置，随时加载复用">
            <div className="flex gap-2">
              <Input value={progName} onChange={(e) => setProgName(e.target.value)} placeholder="方案名" className="flex-1" />
              <Btn variant="secondary" onClick={saveProgram}><Save size={14} /> 保存</Btn>
            </div>
            {programs.length > 0 && (
              <div className="mt-2 flex gap-2">
                <Select
                  value={progPick}
                  onChange={(e) => { setProgPick(e.target.value); if (e.target.value) loadProgram(e.target.value) }}
                >
                  <option value="">-- 选择方案 --</option>
                  {programs.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </Select>
                {progPick && <Btn variant="ghost" onClick={() => deleteProgram(progPick)}><X size={14} /></Btn>}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Btn size="sm" variant="secondary" onClick={exportConfig} className="flex-1" title="把全部方案、礼物库、版式打包成 json"><Download size={13} /> 导出配置</Btn>
              <Btn size="sm" variant="secondary" onClick={importConfig} className="flex-1" title="从 json 恢复全部方案与版式"><FolderOpen size={13} /> 导入配置</Btn>
            </div>
          </Field>

          </div>
          </CollapseSection>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2.5 py-2">
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
              <Toggle value={cropExport} onChange={setCropExport} />导出时裁掉空白
            </label>
            {cropExport && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-4)]">留边</span>
                <input type="range" min={0} max={120} step={2} value={cropPad} onChange={(e) => setCropPad(Number(e.target.value))} className="w-24 accent-[var(--accent)]" />
                <span className="tnum w-8 text-right text-[11px] text-[var(--text-3)]">{cropPad}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Btn onClick={() => exportPng()} className="flex-1"><Download size={14} /> 导出透明 PNG</Btn>
            <Btn variant="secondary" onClick={copyImage} title="复制到剪贴板"><Copy size={14} /> 复制</Btn>
            <Btn variant="secondary" onClick={exportGif} title="导出 GIF 动画（滚动/闪动）"><Film size={14} /> GIF</Btn>
          </div>
          {mat.outputDir && (
            <button
              onClick={() => window.api.openPath(mat.outputDir)}
              className="flex items-center gap-1 text-[11px] text-[var(--accent-2)] transition hover:underline"
            >
              <FolderOpen size={11} /> 打开合成图片目录
            </button>
          )}
          <p className="text-[11px] leading-4 text-[var(--text-4)]">
            对应参考软件「直播透明图合成助手」：文字/图片/闪动模式、自动字号、旋转、描边/阴影/发光、底框、背景、上下左右滚动、闪烁、渐变/对半/循环/随机多行颜色、序号样式、横幅比例。导出透明背景 PNG / 无缝循环 GIF 叠加到直播画面。
          </p>
        </div>
      </Card>

      <Card className="sticky top-0 flex max-h-[calc(100vh-160px)] flex-col items-center self-start overflow-auto p-4">
        <div className="mb-3 flex w-full items-center justify-between text-xs text-[var(--text-3)]"><span>画面预览</span><span>透明背景</span></div>
        <canvas
          ref={canvasRef}
          className="min-h-0 max-h-[calc(100vh-220px)] max-w-full rounded-lg border border-[var(--line)] shadow-[var(--shadow-card)]"
          style={{ aspectRatio: `${dims().w} / ${dims().h}`, background: 'repeating-conic-gradient(#2a2a2a 0% 25%, #1c1c1c 0% 50%) 0 0 / 24px 24px' }}
        />
      </Card>
    </div>
  )
}
