// 特色整蛊 · 共享引擎（主进程）
//
// 17 个玩法共用一个绿幕/透明采集窗口「特色整蛊」（2026-10-05 用户：那么多窗口好麻烦，都是全屏特效一个窗口就行；
// 功能还是各是各的）。直播伴侣只加一次窗口采集；页面里每个玩法自己一层画布、自己的设置和互动，
// 用到哪个玩法才加载哪个（见 special-page.ts）。运行时 rAF 无活动自停（窗口被直播伴侣盖住也不空转）。
//
// 触发：玩法本身不认礼物。礼物/关注/点赞/弹幕规则、转盘、九宫格、时间盲盒统统走娱乐助手的动作命令
// `special-play`（entertainment.ts → runSpecialAction），参数 `玩法|操作|数量|选项`；
// 盲盒走 `special-box`（runSpecialBox），参数 `事件id,事件id,…|显示名`，从盲盒事件库里随机抽。
// 窗口没开且允许「自动开窗」就先开窗再下发。内存告急时不再执行（和绿幕排队一致），主播亲手「试一试」不受限。
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { captureTitle, mediaUrl, scriptJson } from './capture-output'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, setOutputCloseHandler } from './output-window'
import { readJson, writeJson } from './db'
import { memoryLevel } from './memory-guard'
import { GAME_CODE } from './special-games'
import { buildSpecialPage, buildSpecialWindowPage, specialPageConfig } from './special-page'
import { specialAssetBase, specialAssetDir } from './special-assets'
import {
  DEFAULT_SPECIAL_WINDOW,
  SPECIAL_BOX_DEFAULT_NAME,
  SPECIAL_GAMES,
  SPECIAL_GAME_MAP,
  SPECIAL_LAYER_ORDER,
  SPECIAL_WINDOW_TITLE,
  defaultSpecialBoxEvents,
  defaultSpecialConfig,
  joinSpecialBoxParam,
  joinSpecialParam,
  newSpecialBoxEventId,
  parseSpecialBoxParam,
  parseSpecialParam,
  resolveSpecialCount,
  specialActionText,
  specialBoxEventDefaultName,
  type SpecialBoxEvent,
  type SpecialGameId,
  type SpecialGameMeta,
  type SpecialGameConfig,
  type SpecialGameplayState,
  type SpecialTestAction,
  type SpecialViewer,
  type SpecialWindowConfig
} from '../shared/specialGames'
import { Ipc, type EntertainmentAction, type EntertainmentRule } from '@shared/types'

const STORE = 'special-gameplay'
const WINDOW_PAGE = 'special-window.html'

// 0.3.63 那一版的盲盒（预设盒子 + 权重，参数 盲盒id|名字）：界面已经换成时间插件那种事件库，
// 这份只为已经绑过它的规则 / 转盘奖项还能照常开，不再新建、不在界面显示。
interface LegacyBox { id: string; name: string; entries: { param: string; weight: number }[]; opens: number }

// window：直播窗口（全部玩法共用）；没有 = 从 0.3.63 每个玩法各存的尺寸/底色里取用得最多的那组
// boxEvents：盲盒事件库；没有这个字段 = 第一次用，放进每个玩法一个的默认事件
// legacyMigrated：0.3.63 测试版玩法自带「触发礼物」，已搬进礼物规则（只搬一次）
// chainSkinV2：锁链默认皮肤从「经典金属」换成「霓虹」（存着的 default 都是自动落盘的默认值，换一次）
type Store = {
  games: Partial<Record<SpecialGameId, Partial<SpecialGameConfig>>>
  window?: SpecialWindowConfig
  boxEvents?: SpecialBoxEvent[]
  boxes?: LegacyBox[]
  legacyMigrated?: boolean
  chainSkinV2?: boolean
}
const rawStore = readJson<Store>(STORE, { games: {} })
let store: Store = normalizeStore(rawStore)

let win: BrowserWindow | null = null
let ready: Promise<void> | null = null
// 这次开窗以来在窗口里加载过的玩法（清屏只管它们）
const loaded = new Set<SpecialGameId>()

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// 按玩法的参数规格夹紧专属参数（min/max 既是 UI 范围也是防爆上下限）；硬编码只做防爆。
function normalizeParams(meta: SpecialGameMeta, value?: Record<string, unknown>): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const p of meta.params) {
    const raw = value ? value[p.key] : undefined
    if (p.type === 'number') out[p.key] = clampNumber(raw, p.def as number, p.min ?? 0, p.max ?? 1_000_000)
    else if (p.type === 'toggle') out[p.key] = raw == null ? (p.def as boolean) : raw === true
    else if (p.type === 'select') {
      const ok = (p.options || []).some((o) => o.value === raw)
      out[p.key] = ok ? String(raw) : String(p.def)
    } else if (p.type === 'color') out[p.key] = /^#[0-9a-f]{6}$/i.test(String(raw)) ? String(raw) : String(p.def)
    else if (p.type === 'files') {
      // 多文件：换行分隔，去空行去重
      const list = String(raw ?? p.def).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      out[p.key] = [...new Set(list)].join('\n')
    } else out[p.key] = raw == null ? String(p.def) : String(raw).trim()
  }
  return out
}

function normalizeConfig(meta: SpecialGameMeta, value?: Partial<SpecialGameConfig>): SpecialGameConfig {
  const base = defaultSpecialConfig(meta)
  return {
    speed: clampNumber(value?.speed, base.speed, 0.25, 8),
    // 0 = 不限（用户铁律：不设上限）；仅做下界防负，上界放到百万级纯防爆
    countCap: Math.trunc(clampNumber(value?.countCap, base.countCap, 0, 1_000_000)),
    params: normalizeParams(meta, value?.params as Record<string, unknown> | undefined)
  }
}

function normalizeWindow(value?: Partial<SpecialWindowConfig>): SpecialWindowConfig {
  const base = DEFAULT_SPECIAL_WINDOW
  return {
    autoOpen: value?.autoOpen !== false,
    background: value?.background === 'transparent' ? 'transparent' : 'green',
    width: Math.trunc(clampNumber(value?.width, base.width, 160, 3840)),
    height: Math.trunc(clampNumber(value?.height, base.height, 160, 2160))
  }
}

// 0.3.63 及以前每个玩法自己一个窗口、各存一份尺寸/底色/自动开窗：合成一个窗口时取用得最多的那组
function windowFromLegacy(games?: Store['games']): Partial<SpecialWindowConfig> | undefined {
  const tally = new Map<string, { n: number; v: Partial<SpecialWindowConfig> }>()
  for (const raw of Object.values(games || {})) {
    const r = raw as Record<string, unknown> | undefined
    if (!r || r.width == null || r.height == null) continue
    const v: Partial<SpecialWindowConfig> = { width: Number(r.width), height: Number(r.height), background: r.background === 'transparent' ? 'transparent' : 'green', autoOpen: r.autoOpen !== false }
    const key = JSON.stringify(v)
    tally.set(key, { n: (tally.get(key)?.n || 0) + 1, v })
  }
  let best: { n: number; v: Partial<SpecialWindowConfig> } | undefined
  for (const t of tally.values()) if (!best || t.n > best.n) best = t
  return best?.v
}

// 事件库清洗：只留认识的玩法；名字空了用动作描述；权重 ≥0（0 = 暂时不抽）；id 重复的换新
function normalizeBoxEvents(list: unknown): SpecialBoxEvent[] {
  const seen = new Set<string>()
  const out: SpecialBoxEvent[] = []
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Partial<SpecialBoxEvent>
    const p = parseSpecialParam(String(r.param || ''))
    if (!p.id) continue
    const param = joinSpecialParam(p)
    let id = String(r.id || '').trim()
    if (!id || seen.has(id) || id.includes(',') || id.includes('|') || id === '*') id = newSpecialBoxEventId()
    seen.add(id)
    out.push({
      id,
      name: String(r.name || '').trim() || specialBoxEventDefaultName(param),
      param,
      enabled: r.enabled !== false,
      weight: clampNumber(r.weight, 1, 0, 1_000_000),
      prank: String(r.prank || '').trim()
    })
  }
  return out
}

function normalizeLegacyBox(raw: Partial<LegacyBox> | undefined): LegacyBox | null {
  if (!raw || typeof raw !== 'object' || !raw.id) return null
  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((e) => ({ param: joinSpecialParam(parseSpecialParam(String(e?.param || ''))), weight: clampNumber(e?.weight, 1, 0, 1_000_000) }))
    .filter((e) => !!parseSpecialParam(e.param).id)
  return { id: String(raw.id), name: String(raw.name || '').trim() || SPECIAL_BOX_DEFAULT_NAME, entries, opens: Math.max(1, Math.trunc(clampNumber(raw.opens, 1, 1, 1_000_000))) }
}

function normalizeStore(value?: Partial<Store>): Store {
  const games: Store['games'] = {}
  for (const meta of SPECIAL_GAMES) games[meta.id] = normalizeConfig(meta, value?.games?.[meta.id])
  const boxes = Array.isArray(value?.boxes) ? value!.boxes.map((b) => normalizeLegacyBox(b)).filter((b): b is LegacyBox => !!b && b.entries.length > 0) : []
  return {
    games,
    window: normalizeWindow(value?.window ?? windowFromLegacy(value?.games)),
    boxEvents: Array.isArray(value?.boxEvents) ? normalizeBoxEvents(value!.boxEvents) : defaultSpecialBoxEvents(),
    ...(boxes.length ? { boxes } : {}),
    legacyMigrated: value?.legacyMigrated === true,
    chainSkinV2: value?.chainSkinV2 === true
  }
}

export function specialConfig(id: SpecialGameId): SpecialGameConfig {
  const meta = SPECIAL_GAME_MAP[id]
  return normalizeConfig(meta, store.games[id])
}

export function specialWindowConfig(): SpecialWindowConfig {
  return normalizeWindow(store.window)
}

function persist(): void {
  // 存盘时每个玩法也带上窗口的尺寸/底色/自动开窗：回到 0.3.63（一个玩法一个窗口）那版也还是主播设的样子
  const w = specialWindowConfig()
  const games: Record<string, unknown> = {}
  for (const [id, cfg] of Object.entries(store.games)) games[id] = { ...cfg, width: w.width, height: w.height, background: w.background, autoOpen: w.autoOpen }
  writeJson(STORE, { ...store, games })
}

// 窗口开关 / 设置变化告诉页面（规则自动开窗时，特色整蛊页的「窗口开着」要跟着亮）
function emitChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w !== win) {
      try { w.webContents.send(Ipc.SpecialChanged) } catch { /* 窗口正在关 */ }
    }
  }
}

function writeWindowPage(): string {
  const tmp = path.join(app.getPath('userData'), WINDOW_PAGE)
  const games = SPECIAL_GAMES.map((meta) => ({ meta, cfg: specialConfig(meta.id), code: GAME_CODE[meta.id] || '' }))
  fs.writeFileSync(tmp, buildSpecialWindowPage(games, specialWindowConfig(), SPECIAL_LAYER_ORDER, specialAssetBase()))
  return tmp
}

/** 详情页预览舞台的页面（zlspecial 协议提供，素材和本地文件同源） */
export function specialPreviewHtml(id: string): string | null {
  const meta = SPECIAL_GAME_MAP[id]
  if (!meta) return null
  return buildSpecialPage(meta, specialConfig(meta.id), GAME_CODE[meta.id] || '', 'zlspecial://app/assets/', {
    preview: true,
    fileBase: 'zlspecial://app/file/',
    background: specialWindowConfig().background
  })
}

export function specialWindowOpen(): boolean {
  return !!win && !win.isDestroyed()
}

/** 打开直播窗口「特色整蛊」（已开着就只是露出来，不抢焦点） */
export function openSpecialWindow(): { ok: boolean; error?: string } {
  try {
    if (win && !win.isDestroyed()) {
      win.showInactive()
      return { ok: true }
    }
    const cfg = specialWindowConfig()
    const tmp = writeWindowPage()
    const created = createCaptureOutputWindow({
      title: SPECIAL_WINDOW_TITLE,
      width: cfg.width,
      height: cfg.height,
      frame: false,
      transparent: true,
      backgroundColor: cfg.background === 'transparent' ? undefined : '#00FF00',
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
    })
    captureTitle(created, SPECIAL_WINDOW_TITLE)
    win = created
    loaded.clear()
    const p = created.loadFile(tmp)
    ready = p.then(() => undefined).catch(() => undefined)
    void p.catch((e) => console.warn('特色整蛊窗口加载失败', (e as Error).message))
    // 画布吃点击（各玩法自己判断点没点中），整窗拖动关掉，用页面右上角把手拖窗
    registerOutputWindow(created, { drag: false })
    setOutputCloseHandler(created, () => { closeSpecialWindow() })
    onOutputWindowClosed(created, () => {
      if (win === created) { win = null; ready = null; loaded.clear(); emitChanged() }
    })
    emitChanged()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `打开特色整蛊窗口失败：${(e as Error).message}` }
  }
}

export function closeSpecialWindow(): { ok: boolean; closed: number } {
  const w = win
  const had = !!w && !w.isDestroyed()
  win = null
  ready = null
  loaded.clear()
  try { w?.close() } catch { /* ignore */ }
  emitChanged()
  return { ok: true, closed: had ? 1 : 0 }
}

/** 改窗口设置（尺寸 / 底色 / 自动开窗）：开着的窗口跟着变 */
export function configureSpecialWindow(value: Partial<SpecialWindowConfig>): { ok: boolean; window: SpecialWindowConfig } {
  const previous = specialWindowConfig()
  const next = normalizeWindow({ ...previous, ...value })
  store.window = next
  persist()
  if (win && !win.isDestroyed()) {
    if (previous.width !== next.width || previous.height !== next.height) win.setSize(next.width, next.height)
    if (previous.background !== next.background) {
      win.setBackgroundColor(next.background === 'green' ? '#00ff00' : '#00000000')
      void runWhenReady(`window.__window && window.__window(${scriptJson({ background: next.background })})`)
    }
  }
  emitChanged()
  return { ok: true, window: next }
}

export function configureSpecialGame(id: SpecialGameId, value: Partial<SpecialGameConfig>): { ok: boolean } {
  const meta = SPECIAL_GAME_MAP[id]
  if (!meta) return { ok: false }
  const next = normalizeConfig(meta, { ...store.games[id], ...value })
  store.games[id] = next
  persist()
  if (win && !win.isDestroyed()) {
    void runWhenReady(`window.__config && window.__config(${scriptJson(specialPageConfig(next, specialWindowConfig().background))}, ${scriptJson(id)})`)
  }
  return { ok: true }
}

function runWhenReady<T = unknown>(script: string): Promise<T | undefined> {
  const target = win
  const r = ready || Promise.resolve()
  return r.then(() => {
    if (target && target === win && !target.isDestroyed()) return target.webContents.executeJavaScript(script) as Promise<T>
    return undefined
  }).catch(() => undefined)
}

/** 下发几条标准化命令给窗口（窗口没开则忽略）；announce = 最后盖一条提示（盲盒开出了什么） */
function applyToWindow(cmds: Record<string, unknown>[], announce = '', avatar = ''): void {
  if (!win || win.isDestroyed() || (!cmds.length && !announce)) return
  for (const c of cmds) loaded.add(c.game as SpecialGameId)
  void runWhenReady(`window.__applyMany && window.__applyMany(${scriptJson(cmds)}, ${scriptJson(announce)}, ${scriptJson(avatar)})`)
}

export function specialState(): SpecialGameplayState {
  return {
    games: SPECIAL_GAMES.map((meta) => ({ id: meta.id, config: specialConfig(meta.id) })),
    window: { ...specialWindowConfig(), open: specialWindowOpen() },
    assetDir: specialAssetDir()
  }
}

/** 累计统计（抓到几只鸭子之类）：窗口开着才读得到 */
export async function specialStats(id: SpecialGameId): Promise<{ open: boolean; value?: number }> {
  if (!specialWindowOpen()) return { open: false }
  const r = await runWhenReady<{ value?: number } | null>(`window.__stats && window.__stats(${scriptJson(id)})`)
  const value = Number(r?.value)
  return { open: true, ...(Number.isFinite(value) ? { value } : {}) }
}

// 把动作拼成下发给页面的命令：选项只带玩法认识的（size/kind/color），数量受主播自己设的上限夹
function buildCommand(meta: SpecialGameMeta, cfg: SpecialGameConfig, op: string, count: number, fields: Record<string, string>, viewer?: SpecialViewer, test = false): Record<string, unknown> {
  const opSpec = meta.ops.find((o) => o.value === op) ?? meta.ops[0]
  let n = Math.max(1, Math.trunc(count) || 1)
  // 只有「增加 / 来电」这类生成数量受上限约束；乘除倍数、减少不夹
  if (cfg.countCap > 0 && (opSpec.value === 'add' || opSpec.value === 'show')) n = Math.min(cfg.countCap, n)
  const cmd: Record<string, unknown> = {
    game: meta.id,
    operation: opSpec.value,
    count: n,
    username: String(viewer?.name || ''),
    avatar: viewer?.avatar ? mediaUrl(viewer.avatar) : '',
    gift: String(viewer?.gift || '')
  }
  for (const f of meta.fields ?? []) cmd[f.key] = fields[f.key] || f.def
  if (test) cmd.test = true
  return cmd
}

// 窗口没开：允许自动开窗就开（页面加载完 runWhenReady 会把命令补上），否则报原因
function ensureOpen(force: boolean): { ok: boolean; error?: string } {
  if (specialWindowOpen()) return { ok: true }
  if (!force && !specialWindowConfig().autoOpen) return { ok: false, error: '特色整蛊窗口没开，且设置了不自动打开' }
  return openSpecialWindow()
}

/** 动作命令 special-play 的执行入口：param = 玩法|操作|数量|选项；times = 礼物规则合并的执行次数（数量 ×times） */
export function runSpecialAction(param: string, viewer?: SpecialViewer, times = 1, force = false): { ok: boolean; error?: string } {
  const p = parseSpecialParam(param)
  if (!p.id) return { ok: false, error: '没有选择特色整蛊玩法' }
  if (memoryLevel() === 'critical') return { ok: false, error: '内存告急，暂不生成新的特色整蛊' }
  const meta = SPECIAL_GAME_MAP[p.id]
  const cfg = specialConfig(p.id)
  const opened = ensureOpen(force)
  if (!opened.ok) return opened
  const n = Math.max(1, Math.trunc(Number(times) || 1))
  const count = resolveSpecialCount(p.count, meta.countDef) * n
  if (!Number.isSafeInteger(count)) return { ok: false, error: '数量超出可精确表示范围，请检查规则数值' }
  applyToWindow([buildCommand(meta, cfg, p.op, count, p.fields, viewer, force)])
  return { ok: true }
}

// ================= 特色整蛊盲盒（照时间插件：事件库 + 每个礼物自己勾选奖池）=================
const MERGEABLE_OPS = new Set(['add', 'show', 'reduce', 'tornado'])

export function specialBoxEvents(): SpecialBoxEvent[] {
  return (store.boxEvents ?? []).map((e) => ({ ...e }))
}

/** 整个事件库一起存（编辑器改哪个都把整份交回来）；删掉的事件顺手从礼物规则的奖池里摘掉 */
export async function saveSpecialBoxEvents(list: SpecialBoxEvent[]): Promise<{ ok: boolean; events: SpecialBoxEvent[] }> {
  const before = new Set((store.boxEvents ?? []).map((e) => e.id))
  store.boxEvents = normalizeBoxEvents(list)
  persist()
  const after = new Set(store.boxEvents.map((e) => e.id))
  const removed = [...before].filter((id) => !after.has(id))
  if (removed.length) await dropBoxEventsFromRules(removed).catch((e) => console.warn('[special-gameplay] 清理奖池引用失败', (e as Error).message))
  emitChanged()
  return { ok: true, events: specialBoxEvents() }
}

async function dropBoxEventsFromRules(ids: string[]): Promise<void> {
  const gone = new Set(ids)
  const { listRules, updateRule } = await import('./entertainment')
  const fix = <T extends EntertainmentAction>(a: T): T => {
    if (a.actionType !== 'command' || a.commandCmd !== 'special-box') return a
    const p = parseSpecialBoxParam(a.commandParam)
    if (p.all || !p.ids.some((id) => gone.has(id))) return a
    return { ...a, commandParam: joinSpecialBoxParam({ ...p, ids: p.ids.filter((id) => !gone.has(id)) }) }
  }
  for (const rule of listRules()) {
    const primary = fix(rule)
    const extras = (rule.extraActions ?? []).map(fix)
    if (primary === rule && extras.every((a, i) => a === rule.extraActions?.[i])) continue
    updateRule({ ...rule, commandParam: primary.commandParam, extraActions: rule.extraActions ? extras : undefined } as EntertainmentRule)
  }
}

type BoxPool = { ok: true; events: SpecialBoxEvent[]; name: string; opens: number } | { ok: false; error: string }

function resolveBoxPool(param: string): BoxPool {
  const p = parseSpecialBoxParam(param)
  const name = p.name || SPECIAL_BOX_DEFAULT_NAME
  const lib = store.boxEvents ?? []
  if (p.all) {
    const events = lib.filter((e) => e.enabled && e.weight > 0)
    return events.length ? { ok: true, events, name, opens: 1 } : { ok: false, error: '盲盒事件库里没有启用的事件' }
  }
  if (!p.ids.length) return { ok: false, error: '盲盒奖池是空的，先勾选要抽的事件' }
  const found = p.ids.map((id) => lib.find((e) => e.id === id)).filter((e): e is SpecialBoxEvent => !!e)
  if (!found.length) {
    // 0.3.63 那一版的盲盒（参数 盲盒id|名字）：按它原来的内容和权重照开
    const legacy = p.ids.length === 1 ? (store.boxes ?? []).find((b) => b.id === p.ids[0]) : undefined
    if (legacy) {
      return {
        ok: true,
        events: legacy.entries.map((e, i) => ({ id: `${legacy.id}-${i}`, name: specialBoxEventDefaultName(e.param), param: e.param, enabled: true, weight: e.weight, prank: '' })),
        name: p.name || legacy.name,
        opens: legacy.opens
      }
    }
    return { ok: false, error: '奖池里的事件都删掉了，重新勾选一下' }
  }
  const usable = found.filter((e) => e.enabled && e.weight > 0)
  if (!usable.length) return { ok: false, error: `奖池里 ${found.length} 个事件都停用了，去盲盒事件库打开` }
  return { ok: true, events: usable, name, opens: 1 }
}

// 按权重抽一个；权重全是 0 时等概率
function pickWeighted(events: SpecialBoxEvent[]): SpecialBoxEvent {
  const total = events.reduce((sum, e) => sum + Math.max(0, e.weight), 0)
  if (total <= 0) return events[Math.floor(Math.random() * events.length)]
  let r = Math.random() * total
  for (const e of events) { r -= Math.max(0, e.weight); if (r < 0) return e }
  return events[events.length - 1]
}

// 抽 draws 次并下发：同一个事件抽中几次——增加类合并成一条（各次的随机数量相加），
// 乘除按次数逐条叠乘，清空/暂停这类不要数量的只做一次。最后整窗盖一条「某某的盲盒开出：…」。
async function runBoxEvents(events: SpecialBoxEvent[], boxName: string, viewer: SpecialViewer | undefined, draws: number, force: boolean): Promise<{ ok: boolean; error?: string; opened?: string[] }> {
  if (!events.length) return { ok: false, error: '盲盒奖池是空的' }
  if (memoryLevel() === 'critical') return { ok: false, error: '内存告急，暂不生成新的特色整蛊' }
  const n = Math.max(1, Math.trunc(Number(draws) || 1))
  if (!Number.isSafeInteger(n)) return { ok: false, error: '抽取次数超出可精确表示范围，请检查规则数值' }
  const opened = ensureOpen(force)
  if (!opened.ok) return opened
  const tally = new Map<SpecialBoxEvent, number>()
  for (let i = 0; i < n; i++) {
    const e = events.length === 1 ? events[0] : pickWeighted(events)
    tally.set(e, (tally.get(e) || 0) + 1)
  }
  const cmds: Record<string, unknown>[] = []
  const texts: string[] = []
  const pranks: string[] = []
  for (const [ev, k] of tally) {
    const p = parseSpecialParam(ev.param)
    if (!p.id) continue
    const meta = SPECIAL_GAME_MAP[p.id]
    const cfg = specialConfig(p.id)
    const op = meta.ops.find((o) => o.value === p.op) ?? meta.ops[0]
    let label: string
    if (op.count === false) {
      cmds.push(buildCommand(meta, cfg, op.value, 1, p.fields, viewer, force))
      label = specialActionText(ev.param)
    } else if (MERGEABLE_OPS.has(op.value)) {
      let total = 0
      for (let j = 0; j < k; j++) total += resolveSpecialCount(p.count, meta.countDef)
      if (!Number.isSafeInteger(total)) return { ok: false, error: '数量超出可精确表示范围，请检查规则数值' }
      cmds.push(buildCommand(meta, cfg, op.value, total, p.fields, viewer, force))
      label = specialActionText(joinSpecialParam({ ...p, count: String(total) }))
    } else {
      for (let j = 0; j < k; j++) cmds.push(buildCommand(meta, cfg, op.value, resolveSpecialCount(p.count, meta.countDef), p.fields, viewer, force))
      label = specialActionText(ev.param) + (k > 1 ? ` ×${k}次` : '')
    }
    const custom = !!ev.name && ev.name !== specialBoxEventDefaultName(ev.param)
    texts.push(custom ? `${ev.name}（${label}）` : label)
    if (ev.prank) for (let j = 0; j < k; j++) pranks.push(ev.prank)
  }
  if (!cmds.length) return { ok: false, error: '奖池里的事件没有可执行的玩法' }
  const who = viewer?.name ? `${viewer.name}的` : ''
  const announce = `🎁 ${who}「${boxName}」${n > 1 ? `×${n} ` : ''}开出：${texts.join('、')}`
  applyToWindow(cmds, announce, viewer?.avatar ? mediaUrl(viewer.avatar) : '')
  if (pranks.length) void runPranks(pranks)
  return { ok: true, opened: texts }
}

// 事件附带的游戏整蛊：游戏没开 / 不是这款游戏时整蛊发不出去，画面整蛊照样执行（只记日志，不让盲盒整个失败）
async function runPranks(list: string[]): Promise<void> {
  const { entertainmentCommand } = await import('./entertainment')
  for (const param of list) {
    const r = await entertainmentCommand('game-prank', param).catch((e) => ({ ok: false, error: (e as Error).message }))
    if (!r.ok) console.warn('[special-gameplay] 盲盒附带的游戏整蛊没发出去：', r.error)
  }
}

/** 动作命令 special-box：param = 事件id,…|显示名（* = 事件库全部启用的）；times = 礼物规则合并的份数，每份抽一个 */
export async function runSpecialBox(param: string, viewer?: SpecialViewer, times = 1, force = false): Promise<{ ok: boolean; error?: string; opened?: string[] }> {
  const pool = resolveBoxPool(param)
  if (!pool.ok) return pool
  const n = Math.max(1, Math.trunc(Number(times) || 1)) * pool.opens
  return runBoxEvents(pool.events, pool.name, viewer, n, force)
}

/** 「抽一次」：按这个奖池抽一次发到直播窗口（没开会先打开），不看自动开窗开关 */
export function drawSpecialBox(param: string): Promise<{ ok: boolean; error?: string; opened?: string[] }> {
  return runSpecialBox(param, { name: '主播' }, 1, true)
}

/** 事件库里「测试」：这个事件直接开一次（停用的也能试） */
export function testSpecialBoxEvent(id: string): Promise<{ ok: boolean; error?: string; opened?: string[] }> {
  const ev = (store.boxEvents ?? []).find((e) => e.id === id)
  if (!ev) return Promise.resolve({ ok: false, error: '找不到这个盲盒事件' })
  return runBoxEvents([ev], '测试', { name: '主播' }, 1, true)
}

/** 「在直播窗口试一试」：不看自动开窗开关，没开就先开；不受内存保护限制（主播亲手点的）。 */
export function testSpecialGame(id: SpecialGameId, action?: SpecialTestAction): { ok: boolean; error?: string } {
  const meta = SPECIAL_GAME_MAP[id]
  if (!meta) return { ok: false, error: '未知玩法' }
  const cfg = specialConfig(id)
  const opened = ensureOpen(true)
  if (!opened.ok) return opened
  const op = meta.ops.some((o) => o.value === action?.op) ? String(action?.op) : meta.ops[0].value
  const count = resolveSpecialCount(action?.count, meta.countDef)
  applyToWindow([buildCommand(meta, cfg, op, count, action?.fields ?? {}, { name: '主播' }, true)])
  return { ok: true }
}

/** 全部清屏：窗口里用过的玩法统统清掉场上的东西（音乐球是停止），窗口留着。保护主播 / 特色整蛊页的「全部清屏」用。 */
export function clearAllSpecial(): { ok: boolean; cleared: number } {
  if (!specialWindowOpen()) return { ok: true, cleared: 0 }
  const cmds = [...loaded].map((id) => {
    const meta = SPECIAL_GAME_MAP[id]
    const op = meta.ops.some((o) => o.value === 'clear') ? 'clear' : 'stop'
    return { game: id, operation: op, count: 1, username: '', avatar: '', gift: '' }
  })
  applyToWindow(cmds)
  return { ok: true, cleared: cmds.length }
}

/** 关闭特色整蛊窗口 */
export function closeAllSpecial(): { ok: boolean; closed: number } {
  return closeSpecialWindow()
}

/**
 * 启动时的一次性整理：
 * - 0.3.63 测试版的玩法自带「自动触发 + 触发礼物 + 每份数量」，搬成礼物规则（分组「特色整蛊」、即时执行），只搬一次。
 *   「任意礼物都触发」（礼物名留空）在礼物规则里不存在——空礼物名永不匹配——这种只能放弃。
 * - 合成一个窗口：窗口设置、盲盒事件库第一次落盘；以前每个玩法各写一份的页面文件删掉。
 */
export async function migrateLegacySpecialTriggers(): Promise<number> {
  if (!store.chainSkinV2) {
    const chain = store.games.chain_challenge
    if (chain?.params && chain.params.visualStyle === 'default') chain.params = { ...chain.params, visualStyle: 'neon' }
    store.chainSkinV2 = true
    persist()
  }
  if (!rawStore.window || !Array.isArray(rawStore.boxEvents)) {
    persist()
    for (const meta of SPECIAL_GAMES) {
      try { fs.rmSync(path.join(app.getPath('userData'), `special-${meta.id}.html`), { force: true }) } catch { /* 删不掉不影响 */ }
    }
  }
  if (store.legacyMigrated) return 0
  const { addRule } = await import('./entertainment')
  let moved = 0
  for (const meta of SPECIAL_GAMES) {
    const legacy = rawStore.games?.[meta.id] as Record<string, unknown> | undefined
    const gift = String(legacy?.triggerGift ?? '').trim()
    if (legacy?.enabled !== true || !gift) continue
    const count = Math.max(1, Math.trunc(Number(legacy.triggerCount) || meta.countDef))
    const rule: EntertainmentRule = {
      id: '',
      name: `特色整蛊·${meta.name}`,
      group: '特色整蛊',
      giftName: gift,
      triggerType: 'gift',
      actionType: 'command',
      commandCmd: 'special-play',
      commandParam: `${meta.id}|${meta.ops[0].value}|${count}`,
      times: 1,
      repeat: 1,
      multiply: true,
      queueMode: 'instant',
      enabled: true
    }
    if (addRule(rule).ok) moved++
  }
  store.legacyMigrated = true
  persist()
  if (moved) console.log(`[special-gameplay] 已把 ${moved} 个玩法的礼物触发搬进礼物规则`)
  return moved
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
  ready = null
  loaded.clear()
})
