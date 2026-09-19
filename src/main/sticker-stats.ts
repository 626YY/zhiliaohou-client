// 礼物贴纸统计：每款礼物累计收到多少次（按真实连击个数），主进程常驻累计并持久化。
// 复刻参考「礼物贴纸统计」；老实现在页面里用 localStorage 记，页面关着就漏记。
import { BrowserWindow, app } from 'electron'
import { readJson, writeJson } from './db'
import { normalizeGiftName } from '../shared/giftName'
import { findGiftImage } from './entertainment'
import { Ipc, type ConnectorEvent, type StickerRow, type StickerState } from '@shared/types'

interface Saved {
  rows?: Partial<StickerRow>[]
  lastGift?: string
  lastAt?: number
}

let rows: StickerRow[] = []
let lastGift = ''
let lastAt = 0
{
  const saved = readJson<Saved>('sticker-stats', {})
  rows = Array.isArray(saved.rows)
    ? saved.rows
      .map((row) => ({
        name: String(row?.name ?? '').trim(),
        count: Math.max(0, Math.trunc(Number(row?.count) || 0)),
        image: String(row?.image ?? '').trim() || undefined,
        last: Math.max(0, Number(row?.last) || 0)
      }))
      .filter((row) => row.name)
    : []
  lastGift = String(saved.lastGift ?? '')
  lastAt = Math.max(0, Number(saved.lastAt) || 0)
}

// 落盘防抖：每个礼物事件都 fsync 一次会把主线程拖住（热门房每秒几十事件），800ms 内合并成一次；退出前冲刷
let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, 800)
}
app.on('before-quit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saveNow()
  }
})
function saveNow(): void {
  writeJson('sticker-stats', { rows, lastGift, lastAt })
}

function autoImage(name: string): string {
  return findGiftImage(name)?.path || ''
}

export function stickerState(): StickerState {
  const sorted = [...rows].sort((a, b) => b.count - a.count || b.last - a.last)
  return {
    rows: sorted.map((row) => ({ ...row })),
    total: rows.reduce((sum, row) => sum + row.count, 0),
    lastGift,
    lastAt
  }
}

function broadcast(): void {
  const state = stickerState()
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send(Ipc.StickerChanged, state)
  }
}

function bump(name: string, count: number, image?: string): void {
  const key = normalizeGiftName(name)
  let row = rows.find((item) => normalizeGiftName(item.name) === key)
  if (!row) {
    row = { name: name.trim(), count: 0, image: undefined, last: 0 }
    rows.push(row)
  }
  row.count += count
  row.last = Date.now()
  if (!row.image) row.image = image || autoImage(row.name) || undefined
}

export function stickerReset(): { ok: boolean } {
  rows = []
  lastGift = ''
  lastAt = 0
  save()
  broadcast()
  return { ok: true }
}

// 把老版本页面 localStorage 里的统计并进来（升级后第一次打开页面时调用一次）
export function stickerImport(stats: Record<string, unknown>): { ok: boolean; imported: number } {
  let imported = 0
  for (const [name, value] of Object.entries(stats || {})) {
    const count = Math.max(0, Math.trunc(Number(value) || 0))
    if (!name.trim() || count <= 0) continue
    bump(name, count)
    imported += 1
  }
  if (imported) {
    save()
    broadcast()
  }
  return { ok: true, imported }
}

// 连接器礼物事件入口（connector-runtime 统一分发）：数量按真实连击数累加，不设上限
export function handleStickerGift(event: ConnectorEvent): void {
  if (event.type !== 'gift' || !event.giftName) return
  const count = Math.max(1, Math.trunc(Number(event.count) || 1))
  bump(event.giftName, count, event.giftImage || undefined)
  lastGift = event.giftName.trim()
  lastAt = Date.now()
  save()
  broadcast()
}

// 三个变更入口都已同步保存；退出时不再把进程启动时的旧快照写回。
