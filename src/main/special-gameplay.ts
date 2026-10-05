// 特色整蛊 · 共享引擎（主进程）
//
// 一套引擎托管全部特色玩法：每个玩法一个绿幕/透明采集窗口（固定标题 = 玩法名），默认关、开哪个才有哪个。
// 页面 = 公共骨架（Canvas + 顶部横幅 + 运行时）+ 该玩法的 Canvas 代码（src/main/special-games/<id>.ts）。
// 运行时 rAF 无活动自停（窗口被直播伴侣盖住也不空转，呼应 app-setup 关掉了遮挡/后台降帧）；
// 可点玩法走绿底非穿透窗口 + 禁用整窗拖动（画布吃点击，靠自带把手拖窗）。
//
// 触发：玩法本身不认礼物。礼物/关注/点赞/弹幕规则、转盘、九宫格、时间盲盒统统走娱乐助手的动作命令
// `special-play`（entertainment.ts → runSpecialAction），参数 `玩法|操作|数量|选项`。窗口没开且玩法允许
// 「自动开窗」就先开窗再下发。内存告急时不再执行（和绿幕排队一致），主播亲手「试一试」不受限。
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { captureTitle, mediaUrl, scriptJson } from './capture-output'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, setOutputCloseHandler } from './output-window'
import { readJson, writeJson } from './db'
import { memoryLevel } from './memory-guard'
import { GAME_CODE } from './special-games'
import { buildSpecialPage, specialPageConfig } from './special-page'
import { specialAssetBase, specialAssetDir } from './special-assets'
import {
  SPECIAL_BOX_PRESETS,
  SPECIAL_GAMES,
  SPECIAL_GAME_MAP,
  defaultSpecialConfig,
  joinSpecialParam,
  parseSpecialBoxParam,
  parseSpecialParam,
  resolveSpecialCount,
  specialActionText,
  type SpecialBox,
  type SpecialGameId,
  type SpecialGameMeta,
  type SpecialGameConfig,
  type SpecialGameplayState,
  type SpecialTestAction,
  type SpecialViewer
} from '../shared/specialGames'
import { Ipc, type EntertainmentRule } from '@shared/types'

const STORE = 'special-gameplay'
const wins = new Map<SpecialGameId, BrowserWindow>()
const ready = new Map<SpecialGameId, Promise<void>>()

// legacyMigrated：0.3.63 测试版玩法自带「触发礼物」，已搬进礼物规则（只搬一次）
// boxes：特色整蛊盲盒；没有这个字段 = 第一次用，放进自带的三个
// chainSkinV2：锁链默认皮肤从「经典金属」换成「霓虹」（0.3.63 没发布过，存着的 default 都是自动落盘的默认值，换一次）
type Store = { games: Partial<Record<SpecialGameId, Partial<SpecialGameConfig>>>; legacyMigrated?: boolean; boxes?: SpecialBox[]; chainSkinV2?: boolean }
const rawStore = readJson<Store>(STORE, { games: {} })
let store: Store = normalizeStore(rawStore)

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
    autoOpen: value?.autoOpen !== false,
    background: value?.background === 'transparent' ? 'transparent' : 'green',
    width: Math.trunc(clampNumber(value?.width, base.width, 160, 3840)),
    height: Math.trunc(clampNumber(value?.height, base.height, 160, 2160)),
    speed: clampNumber(value?.speed, base.speed, 0.25, 8),
    // 0 = 不限（用户铁律：不设上限）；仅做下界防负，上界放到百万级纯防爆
    countCap: Math.trunc(clampNumber(value?.countCap, base.countCap, 0, 1_000_000)),
    params: normalizeParams(meta, value?.params as Record<string, unknown> | undefined)
  }
}

// 盲盒清洗：结果只留认识的玩法；权重 ≥0（0 = 暂时不开这个）；每次开几个 ≥1（不设上限，只防非数字）
function normalizeBox(raw: Partial<SpecialBox> | undefined, index: number): SpecialBox | null {
  if (!raw || typeof raw !== 'object') return null
  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((e) => ({ param: String(e?.param || ''), weight: clampNumber(e?.weight, 1, 0, 1_000_000) }))
    .filter((e) => !!parseSpecialParam(e.param).id)
    .map((e) => { const p = parseSpecialParam(e.param); return { param: joinSpecialParam(p), weight: e.weight } })
  return {
    id: String(raw.id || '').trim() || `box-${Date.now().toString(36)}-${index}`,
    name: String(raw.name || '').trim() || '特色整蛊盲盒',
    entries,
    opens: Math.max(1, Math.trunc(clampNumber(raw.opens, 1, 1, 1_000_000))),
    announce: raw.announce !== false
  }
}

function normalizeStore(value?: Partial<Store>): Store {
  const games: Store['games'] = {}
  for (const meta of SPECIAL_GAMES) games[meta.id] = normalizeConfig(meta, value?.games?.[meta.id])
  const rawBoxes = Array.isArray(value?.boxes) ? value!.boxes : SPECIAL_BOX_PRESETS
  const boxes = rawBoxes.map((b, i) => normalizeBox(b, i)).filter((b): b is SpecialBox => !!b)
  return { games, legacyMigrated: value?.legacyMigrated === true, boxes, chainSkinV2: value?.chainSkinV2 === true }
}

export function specialConfig(id: SpecialGameId): SpecialGameConfig {
  const meta = SPECIAL_GAME_MAP[id]
  return normalizeConfig(meta, store.games[id])
}

function persist(): void {
  writeJson(STORE, store)
}

// 窗口开关变化告诉页面（规则自动开窗时，特色整蛊页的「直播中」标记要跟着亮）
function emitChanged(): void {
  const own = new Set<BrowserWindow>(wins.values())
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !own.has(w)) {
      try { w.webContents.send(Ipc.SpecialChanged) } catch { /* 窗口正在关 */ }
    }
  }
}

function writePage(meta: SpecialGameMeta, cfg: SpecialGameConfig): string {
  const tmp = path.join(app.getPath('userData'), `special-${meta.id}.html`)
  fs.writeFileSync(tmp, buildSpecialPage(meta, cfg, GAME_CODE[meta.id] || '', specialAssetBase()))
  return tmp
}

/** 详情页预览舞台的页面（zlspecial 协议提供，素材和本地文件同源） */
export function specialPreviewHtml(id: string): string | null {
  const meta = SPECIAL_GAME_MAP[id]
  if (!meta) return null
  return buildSpecialPage(meta, specialConfig(meta.id), GAME_CODE[meta.id] || '', 'zlspecial://app/assets/', {
    preview: true,
    fileBase: 'zlspecial://app/file/'
  })
}

export function openSpecialGame(id: SpecialGameId, value?: Partial<SpecialGameConfig>): { ok: boolean; error?: string } {
  const meta = SPECIAL_GAME_MAP[id]
  if (!meta) return { ok: false, error: '未知玩法' }
  try {
    if (value) {
      store.games[id] = normalizeConfig(meta, { ...store.games[id], ...value })
      persist()
    }
    const cfg = specialConfig(id)
    const existing = wins.get(id)
    if (existing && !existing.isDestroyed()) {
      existing.showInactive()
      return { ok: true }
    }
    const tmp = writePage(meta, cfg)
    const win = createCaptureOutputWindow({
      title: meta.name,
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
    captureTitle(win, meta.name)
    wins.set(id, win)
    const created = win
    const p = win.loadFile(tmp)
    ready.set(id, p.then(() => undefined).catch(() => undefined))
    void p.catch((e) => console.warn(`特色玩法「${meta.name}」加载失败`, (e as Error).message))
    // 可点玩法禁用整窗拖动（画布吃点击），用页面右上角把手拖窗；纯动画玩法保留整窗拖动。
    registerOutputWindow(win, meta.interactive ? { drag: false } : {})
    setOutputCloseHandler(win, () => { closeSpecialGame(id) })
    onOutputWindowClosed(win, () => {
      if (wins.get(id) === created) { wins.delete(id); ready.delete(id); emitChanged() }
    })
    emitChanged()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `打开特色玩法失败：${(e as Error).message}` }
  }
}

export function closeSpecialGame(id: SpecialGameId): { ok: boolean } {
  const win = wins.get(id)
  wins.delete(id)
  ready.delete(id)
  try { win?.close() } catch { /* ignore */ }
  emitChanged()
  return { ok: true }
}

export function configureSpecialGame(id: SpecialGameId, value: Partial<SpecialGameConfig>): { ok: boolean } {
  const meta = SPECIAL_GAME_MAP[id]
  if (!meta) return { ok: false }
  const previous = specialConfig(id)
  const next = normalizeConfig(meta, { ...store.games[id], ...value })
  store.games[id] = next
  persist()
  const win = wins.get(id)
  if (win && !win.isDestroyed()) {
    if (previous.width !== next.width || previous.height !== next.height) win.setSize(next.width, next.height)
    win.setBackgroundColor(next.background === 'green' ? '#00ff00' : '#00000000')
    runWhenReady(id, `window.__config && window.__config(${scriptJson(specialPageConfig(next))})`)
  }
  return { ok: true }
}

function runWhenReady<T = unknown>(id: SpecialGameId, script: string): Promise<T | undefined> {
  const win = wins.get(id)
  const r = ready.get(id) || Promise.resolve()
  return r.then(() => {
    const cur = wins.get(id)
    if (cur && cur === win && !cur.isDestroyed()) return cur.webContents.executeJavaScript(script) as Promise<T>
    return undefined
  }).catch(() => undefined)
}

/** 下发一条标准化命令给某玩法（窗口没开则忽略）。 */
function applyCommand(id: SpecialGameId, cmd: Record<string, unknown>): void {
  const win = wins.get(id)
  if (!win || win.isDestroyed()) return
  void runWhenReady(id, `window.__apply && window.__apply(${scriptJson(cmd)})`)
}

export function specialState(): SpecialGameplayState {
  return {
    games: SPECIAL_GAMES.map((meta) => {
      const win = wins.get(meta.id)
      return { id: meta.id, open: !!win && !win.isDestroyed(), config: specialConfig(meta.id) }
    }),
    assetDir: specialAssetDir()
  }
}

/** 累计统计（抓到几只鸭子之类）：窗口开着才读得到 */
export async function specialStats(id: SpecialGameId): Promise<{ open: boolean; value?: number }> {
  const win = wins.get(id)
  if (!win || win.isDestroyed()) return { open: false }
  const r = await runWhenReady<{ value?: number } | null>(id, 'window.__stats && window.__stats()')
  const value = Number(r?.value)
  return { open: true, ...(Number.isFinite(value) ? { value } : {}) }
}

// 把动作拼成下发给页面的命令：选项只带玩法认识的（size/kind/color），数量受主播自己设的上限夹
// announce：盲盒开出时的提示，页面执行完动作后用它盖掉玩法自己的横幅
function buildCommand(meta: SpecialGameMeta, cfg: SpecialGameConfig, op: string, count: number, fields: Record<string, string>, viewer?: SpecialViewer, test = false, announce = ''): Record<string, unknown> {
  const opSpec = meta.ops.find((o) => o.value === op) ?? meta.ops[0]
  let n = Math.max(1, Math.trunc(count) || 1)
  // 只有「增加 / 来电」这类生成数量受上限约束；乘除倍数、减少不夹
  if (cfg.countCap > 0 && (opSpec.value === 'add' || opSpec.value === 'show')) n = Math.min(cfg.countCap, n)
  const cmd: Record<string, unknown> = {
    operation: opSpec.value,
    count: n,
    username: String(viewer?.name || ''),
    avatar: viewer?.avatar ? mediaUrl(viewer.avatar) : '',
    gift: String(viewer?.gift || '')
  }
  for (const f of meta.fields ?? []) cmd[f.key] = fields[f.key] || f.def
  if (test) cmd.test = true
  if (announce) cmd.announce = announce
  return cmd
}

// 窗口没开：允许自动开窗就开（页面加载完 runWhenReady 会把命令补上），否则报原因
function ensureOpen(meta: SpecialGameMeta, cfg: SpecialGameConfig, force: boolean): { ok: boolean; error?: string } {
  const win = wins.get(meta.id)
  if (win && !win.isDestroyed()) return { ok: true }
  if (!force && !cfg.autoOpen) return { ok: false, error: `「${meta.name}」窗口没开，且设置了不自动打开` }
  return openSpecialGame(meta.id)
}

/** 动作命令 special-play 的执行入口：param = 玩法|操作|数量|选项；times = 礼物规则合并的执行次数（数量 ×times）；
 *  boxName：从盲盒里开出来的（画面上提示「某某 开出了…」） */
export function runSpecialAction(param: string, viewer?: SpecialViewer, times = 1, boxName = '', force = false): { ok: boolean; error?: string } {
  const p = parseSpecialParam(param)
  if (!p.id) return { ok: false, error: '没有选择特色整蛊玩法' }
  if (memoryLevel() === 'critical') return { ok: false, error: '内存告急，暂不生成新的特色整蛊' }
  const meta = SPECIAL_GAME_MAP[p.id]
  const cfg = specialConfig(p.id)
  const opened = ensureOpen(meta, cfg, force)
  if (!opened.ok) return opened
  const n = Math.max(1, Math.trunc(Number(times) || 1))
  const count = resolveSpecialCount(p.count, meta.countDef) * n
  if (!Number.isSafeInteger(count)) return { ok: false, error: '数量超出可精确表示范围，请检查规则数值' }
  const announce = boxName ? `🎁 ${viewer?.name ? viewer.name + '的' : ''}「${boxName}」开出：${specialActionText(joinSpecialParam({ ...p, count: String(count) }))}` : ''
  applyCommand(p.id, buildCommand(meta, cfg, p.op, count, p.fields, viewer, force, announce))
  return { ok: true }
}

// ================= 特色整蛊盲盒 =================
export function specialBoxes(): SpecialBox[] {
  return (store.boxes ?? []).map((b) => ({ ...b, entries: b.entries.map((e) => ({ ...e })) }))
}
export function saveSpecialBox(value: Partial<SpecialBox>): { ok: boolean; boxes: SpecialBox[]; error?: string } {
  const box = normalizeBox(value, (store.boxes ?? []).length)
  if (!box) return { ok: false, boxes: specialBoxes(), error: '盲盒内容不对' }
  const list = [...(store.boxes ?? [])]
  const at = list.findIndex((b) => b.id === box.id)
  if (at >= 0) list[at] = box
  else list.push(box)
  store.boxes = list
  persist()
  return { ok: true, boxes: specialBoxes() }
}
export function removeSpecialBox(id: string): { ok: boolean; boxes: SpecialBox[] } {
  store.boxes = (store.boxes ?? []).filter((b) => b.id !== id)
  persist()
  return { ok: true, boxes: specialBoxes() }
}

// 按权重抽一个结果；权重全是 0 时等概率
function pickEntry(box: SpecialBox): string | null {
  const list = box.entries.filter((e) => !!parseSpecialParam(e.param).id)
  if (!list.length) return null
  const total = list.reduce((sum, e) => sum + Math.max(0, e.weight), 0)
  if (total <= 0) return list[Math.floor(Math.random() * list.length)].param
  let r = Math.random() * total
  for (const e of list) { r -= Math.max(0, e.weight); if (r < 0) return e.param }
  return list[list.length - 1].param
}

/** 动作命令 special-box：param = 盲盒id|显示名。每次开 box.opens 个，各自按权重抽一种 */
export function runSpecialBox(param: string, viewer?: SpecialViewer, force = false): { ok: boolean; error?: string; opened?: string[] } {
  const p = parseSpecialBoxParam(param)
  const box = (store.boxes ?? []).find((b) => b.id === p.id) ?? (store.boxes ?? []).find((b) => !!p.name && b.name === p.name)
  if (!box) return { ok: false, error: `找不到特色整蛊盲盒「${p.name || p.id}」，可能已经删了` }
  if (!box.entries.length) return { ok: false, error: `盲盒「${box.name}」里还没有放东西` }
  const opened: string[] = []
  let lastError = ''
  for (let i = 0; i < box.opens; i++) {
    const pick = pickEntry(box)
    if (!pick) break
    const r = runSpecialAction(pick, viewer, 1, box.announce ? box.name : '', force)
    if (r.ok) opened.push(pick)
    else lastError = r.error || ''
  }
  return opened.length ? { ok: true, opened } : { ok: false, error: lastError || '盲盒没开出东西' }
}

/** 「开一次试试」：发到直播窗口（没开会先打开），不看自动开窗开关 */
export function testSpecialBox(id: string): { ok: boolean; error?: string; opened?: string[] } {
  const box = (store.boxes ?? []).find((b) => b.id === id)
  if (!box) return { ok: false, error: '找不到这个盲盒' }
  return runSpecialBox(`${box.id}|${box.name}`, { name: '主播' }, true)
}

/** 「在直播窗口试一试」：不看自动开窗开关，没开就先开；不受内存保护限制（主播亲手点的）。 */
export function testSpecialGame(id: SpecialGameId, action?: SpecialTestAction): { ok: boolean; error?: string } {
  const meta = SPECIAL_GAME_MAP[id]
  if (!meta) return { ok: false, error: '未知玩法' }
  const cfg = specialConfig(id)
  const opened = ensureOpen(meta, cfg, true)
  if (!opened.ok) return opened
  const op = meta.ops.some((o) => o.value === action?.op) ? String(action?.op) : meta.ops[0].value
  const count = resolveSpecialCount(action?.count, meta.countDef)
  applyCommand(id, buildCommand(meta, cfg, op, count, action?.fields ?? {}, { name: '主播' }, true))
  return { ok: true }
}

/** 全部清屏：开着的玩法统统清掉场上的东西（音乐球是停止），窗口留着。保护主播 / 特色整蛊页的「全部清屏」用。 */
export function clearAllSpecial(): { ok: boolean; cleared: number } {
  let cleared = 0
  for (const [id, win] of wins) {
    if (win.isDestroyed()) continue
    const meta = SPECIAL_GAME_MAP[id]
    const op = meta.ops.some((o) => o.value === 'clear') ? 'clear' : 'stop'
    applyCommand(id, { operation: op, count: 1, username: '', avatar: '', gift: '' })
    cleared++
  }
  return { ok: true, cleared }
}

/** 关闭全部特色整蛊窗口 */
export function closeAllSpecial(): { ok: boolean; closed: number } {
  const ids = [...wins.keys()]
  for (const id of ids) closeSpecialGame(id)
  return { ok: true, closed: ids.length }
}

/**
 * 0.3.63 测试版的玩法自带「自动触发 + 触发礼物 + 每份数量」，现在统一走礼物规则。
 * 启动时把开着的那几条搬成礼物规则（分组「特色整蛊」、即时执行），只搬一次。
 * 「任意礼物都触发」（礼物名留空）在礼物规则里不存在——空礼物名永不匹配——这种只能放弃。
 */
export async function migrateLegacySpecialTriggers(): Promise<number> {
  if (!store.chainSkinV2) {
    const chain = store.games.chain_challenge
    if (chain?.params && chain.params.visualStyle === 'default') chain.params = { ...chain.params, visualStyle: 'neon' }
    store.chainSkinV2 = true
    persist()
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
  for (const win of wins.values()) { try { win.close() } catch { /* ignore */ } }
  wins.clear()
  ready.clear()
})
