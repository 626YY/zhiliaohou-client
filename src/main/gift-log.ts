// 礼物记录（谁·送了什么·几个·多少抖币·什么时候）：主进程常驻记，页面关着也照样记。
//   · 2026-09-07 用户：「客户端里面也要有礼物记录的」。以前按人记的账只有管理后台的观众页/世界榜单，
//     客户端这边只有「每款礼物收了多少个」（礼物贴纸统计）和跨观众求和的累计互动，看不出是谁送的。
//   · 数据来自连接器事件（connector-runtime 统一分发），三款游戏的连接器格式都已归一，所以三款都有记录。
//   · 抖币：事件自带就用自带的；薄连接器（图书管理员）不发抖币，查内置礼物表补。
//   · 只存本机、只给主播自己看，绝不外传（世界榜上报走的是另一条链路，跟这份记录无关）。
//   · 留 30 天、最多 3000 条；写盘攒 0.8 秒一次（礼物成串来时别把磁盘打满），页面推送即时。
import { BrowserWindow } from 'electron'
import { readJson, writeJson } from './db'
import { findGiftImage } from './entertainment'
import { liveSessionSim } from './live-session'
import { Ipc, type ConnectorEvent, type GiftLogRow, type GiftLogState, type GiftSenderRow } from '@shared/types'

const MAX_ROWS = 3000
const KEEP_MS = 30 * 86_400_000
const SAVE_DEBOUNCE_MS = 800
const DEFAULT_LIMIT = 100

let rows: GiftLogRow[] = []
let saveTimer: NodeJS.Timeout | null = null

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sanitize(row: Partial<GiftLogRow>): GiftLogRow | null {
  const gift = String(row?.gift ?? '').trim()
  const ts = num(row?.ts)
  if (!gift || ts <= 0) return null
  return {
    ts,
    sender: String(row?.sender ?? '').trim().slice(0, 64),
    gift: gift.slice(0, 64),
    count: Math.max(1, Math.trunc(num(row?.count, 1))),
    coins: Math.max(0, Math.trunc(num(row?.coins))),
    image: String(row?.image ?? '').trim() || undefined,
    sim: row?.sim ? true : undefined
  }
}

{
  const saved = readJson<{ rows?: Partial<GiftLogRow>[] }>('gift-log', {})
  rows = Array.isArray(saved.rows)
    ? saved.rows.map(sanitize).filter((row): row is GiftLogRow => !!row)
    : []
  prune()
}

function prune(): void {
  const cut = Date.now() - KEEP_MS
  rows = rows.filter((row) => row.ts >= cut)
  if (rows.length > MAX_ROWS) rows = rows.slice(rows.length - MAX_ROWS)
}

function save(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  writeJson('gift-log', { rows })
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeJson('gift-log', { rows })
  }, SAVE_DEBOUNCE_MS)
}

/** 按送礼人聚合：抖币多的在前，抖币相同看个数，再看谁更近。 */
function senderBoard(): GiftSenderRow[] {
  const map = new Map<string, GiftSenderRow>()
  for (const row of rows) {
    const key = row.sender || ''
    let item = map.get(key)
    if (!item) {
      item = { sender: key, gifts: 0, coins: 0, last: 0 }
      map.set(key, item)
    }
    item.gifts += row.count
    item.coins += row.coins
    item.last = Math.max(item.last, row.ts)
  }
  return [...map.values()].sort((a, b) => b.coins - a.coins || b.gifts - a.gifts || b.last - a.last)
}

/**
 * 礼物记录快照。
 * @param limit 最近多少条明细（默认 100，最多 500）；送礼榜固定给前 50 名
 */
export function giftLogState(limit = DEFAULT_LIMIT): GiftLogState {
  const take = Math.min(500, Math.max(1, Math.trunc(num(limit, DEFAULT_LIMIT))))
  return {
    rows: rows.slice(-take).reverse().map((row) => ({ ...row })),
    senders: senderBoard().slice(0, 50),
    kept: rows.length,
    total: rows.reduce((sum, row) => sum + row.count, 0),
    totalCoins: rows.reduce((sum, row) => sum + row.coins, 0)
  }
}

function broadcast(): void {
  const state = giftLogState()
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send(Ipc.GiftLogChanged, state)
  }
}

export function giftLogClear(): { ok: boolean; cleared: number } {
  const cleared = rows.length
  rows = []
  save()
  broadcast()
  return { ok: true, cleared }
}

// 模拟出来的礼物要标出来，否则调试用的假礼物混在记录里看不出来。
// 两个来源：模拟模式的连接器打「模拟礼物: …」/「sim gift …」；互动工具的「模拟事件」在模拟模式下手打的行。
function isSimulated(raw: string): boolean {
  const body = String(raw || '').replace(/^\s*(?:\[[^\]]+\]\s*)+/, '').trim()
  return /^(?:模拟|sim\s)/i.test(body) || liveSessionSim()
}

/** 连接器礼物事件入口（connector-runtime 统一分发）。个数按真实连击数，不设上限。 */
export function handleGiftLog(event: ConnectorEvent): void {
  if (event.type !== 'gift' || !event.giftName) return
  const count = Math.max(1, Math.trunc(num(event.count, 1)))
  const meta = findGiftImage(event.giftName)
  const unit = event.diamondCount != null ? Math.max(0, Math.round(num(event.diamondCount))) : Math.max(0, Math.round(num(meta?.diamondCount)))
  rows.push({
    ts: event.ts || Date.now(),
    sender: String(event.sender ?? '').trim().slice(0, 64),
    gift: event.giftName.trim().slice(0, 64),
    count,
    coins: unit * count,
    image: (event.giftImage || meta?.path || '').trim() || undefined,
    sim: isSimulated(event.raw) || undefined
  })
  prune()
  scheduleSave()
  broadcast()
}

/** 退出前把攒着没写的落盘。 */
export function flushGiftLog(): void {
  if (saveTimer) save()
}
