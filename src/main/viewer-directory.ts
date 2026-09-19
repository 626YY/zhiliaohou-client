// 已出现的观众名单（大哥进场「选观众」下拉的数据源）。
//   · 只记本机见过的人：连接器事件里带昵称的（进场 / 礼物 / 弹幕 / 关注 / 点赞 / 灯牌）+ 连接器打的「头像: 昵称 -> 路径」行。
//   · 不是抖音粉丝列表：客户端拿不到粉丝名单，也不去抓账号数据；界面上要照实写「已出现的观众」。
//   · 头像三条路：① 事件/头像行给的 → 记下来；② 连接器早就下载过、但客户端重开后内存里没了 →
//     按连接器的命名规则（md5(昵称)[:16] + 扩展名）去 <Mod 目录>/avatars/ 找；③ 都没有就空着，界面用默认头像。
//   · 首次加载时把礼物记录（30 天）和时间插件记录里的送礼人并进来，主播不用重新等一场直播。
//   · 落盘 data/viewers.json：最多 2000 人、留 60 天；写盘攒 1 秒。
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { readJson, writeJson } from './db'
import { wheelLiveDir } from './bridge'
import type { ConnectorEvent, ViewerListResult, ViewerRow } from '@shared/types'

const STORE = 'viewers'
const MAX_ROWS = 2000
const KEEP_MS = 60 * 86_400_000
const SAVE_DEBOUNCE_MS = 1000
const AVATAR_EXTS = ['.jpg', '.png', '.webp']
// 磁盘探测结果缓存 30 秒：下拉每次打开都会查一遍，别对着 Mod 目录反复 existsSync
const PROBE_TTL_MS = 30_000

type Stored = { rows?: Partial<ViewerRow>[] }

let rows: ViewerRow[] = []
let saveTimer: NodeJS.Timeout | null = null
const probeCache = new Map<string, { path: string; at: number }>()

/** 连接器 AvatarCache 的昵称归一：连续空白折成一个空格再去首尾 */
export const viewerKey = (name: string): string => String(name || '').replace(/\s+/g, ' ').trim()

function sanitize(row: Partial<ViewerRow> | undefined): ViewerRow | null {
  const name = viewerKey(String(row?.name ?? '')).slice(0, 64)
  const lastSeen = Number(row?.lastSeen)
  if (!name || !Number.isFinite(lastSeen) || lastSeen <= 0) return null
  const uid = String(row?.uid ?? '').trim().slice(0, 64)
  const avatar = String(row?.avatar ?? '').trim()
  const seen = Math.max(1, Math.trunc(Number(row?.seen) || 1))
  return { name, lastSeen, seen, ...(uid ? { uid } : {}), ...(avatar ? { avatar } : {}), ...(row?.sim ? { sim: true } : {}) }
}

function prune(): void {
  const cut = Date.now() - KEEP_MS
  rows = rows.filter((row) => row.lastSeen >= cut)
  rows.sort((a, b) => b.lastSeen - a.lastSeen)
  if (rows.length > MAX_ROWS) rows.length = MAX_ROWS
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeJson(STORE, { rows })
  }, SAVE_DEBOUNCE_MS)
}

export function flushViewers(): void {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  writeJson(STORE, { rows })
}

/** 本地路径存在或是网络地址才算可用头像；连接器的缓存目录会被它自己按数量清理，文件没了就当没有 */
function usableAvatar(value: string | undefined): string {
  const src = String(value || '').trim()
  if (!src) return ''
  if (/^(?:https?|data):/i.test(src)) return src
  const local = src.replace(/^file:\/\/\/?/i, '')
  try { return fs.existsSync(local) ? local : '' } catch { return '' }
}

/** 连接器 AvatarCache 的命名规则：<Mod 目录>/avatars/<md5(昵称)[:16]>.{jpg,png,webp} */
export function probeCachedAvatar(name: string): string {
  const key = viewerKey(name)
  if (!key) return ''
  const now = Date.now()
  const hit = probeCache.get(key)
  if (hit && now - hit.at < PROBE_TTL_MS) return hit.path
  let found = ''
  const dir = wheelLiveDir()
  if (dir) {
    const base = crypto.createHash('md5').update(key, 'utf8').digest('hex').slice(0, 16)
    for (const ext of AVATAR_EXTS) {
      const candidate = path.join(dir, 'avatars', base + ext)
      try {
        if (fs.existsSync(candidate)) { found = candidate; break }
      } catch { /* 目录不可读当没有 */ }
    }
  }
  if (probeCache.size > 5000) probeCache.clear()
  probeCache.set(key, { path: found, at: now })
  return found
}

/** 这位观众现在能用的头像：记录里的 → 连接器磁盘缓存 → 空。
 *  带观众 id 的事件只认同 id 的记录（重名不串）；连接器磁盘缓存本身按昵称存，只给没 id 的事件用。 */
export function viewerAvatar(name: string, uid = ''): string {
  const key = viewerKey(name)
  if (!key) return ''
  const id = String(uid || '').trim()
  if (id) return usableAvatar(rows.find((item) => item.uid === id)?.avatar)
  const same = rows.filter((item) => item.name === key)
  // 同名多人（都带 id）时不知道是谁，别猜；只有一条或有不带 id 的那条才用
  const row = same.find((item) => !item.uid) || (same.length === 1 ? same[0] : undefined)
  const stored = usableAvatar(row?.avatar)
  if (stored) return stored
  return same.length > 1 ? '' : probeCachedAvatar(key)
}

function findRow(name: string, uid: string): ViewerRow | undefined {
  // 有观众 id 先按 id 找（重名靠它区分）；没有 id 的事件只能按昵称，找不带 id 的那条，避免把重名人的头像串掉
  if (uid) {
    const byUid = rows.find((row) => row.uid === uid)
    if (byUid) return byUid
    const unowned = rows.find((row) => row.name === name && !row.uid)
    if (unowned) return unowned
    return undefined
  }
  return rows.find((row) => row.name === name && !row.uid) || rows.find((row) => row.name === name)
}

function upsert(name: string, patch: { uid?: string; avatar?: string; ts?: number; sim?: boolean; count?: boolean }): void {
  const key = viewerKey(name).slice(0, 64)
  if (!key) return
  const uid = String(patch.uid || '').trim().slice(0, 64)
  const avatar = String(patch.avatar || '').trim()
  const ts = patch.ts && patch.ts > 0 ? patch.ts : Date.now()
  let row = findRow(key, uid)
  if (!row) {
    row = { name: key, lastSeen: ts, seen: 0 }
    rows.push(row)
  }
  if (patch.count !== false) row.seen += 1
  if (ts > row.lastSeen) row.lastSeen = ts
  if (uid && !row.uid) row.uid = uid
  if (avatar) row.avatar = avatar
  if (patch.sim) row.sim = true
  else if (patch.sim === false) delete row.sim
  if (rows.length > MAX_ROWS + 200) prune()
  scheduleSave()
}

function isSimulated(raw: string): boolean {
  const body = String(raw || '').replace(/^\[[^\]]*\]\s*/, '')
  return /^(?:模拟|sim\s)/i.test(body)
}

/** 连接器事件入口（connector-runtime 分发）：带昵称的事件都记一笔；「头像:」行只补头像不算出现 */
export function noteViewerEvent(event: ConnectorEvent): void {
  const name = viewerKey(event.sender || '')
  if (!name) return
  if (event.type === 'avatar') {
    if (event.avatar) upsert(name, { avatar: event.avatar, ts: event.ts, count: false })
    return
  }
  if (event.type !== 'member' && event.type !== 'gift' && event.type !== 'comment' && event.type !== 'follow' && event.type !== 'like' && event.type !== 'badge') return
  upsert(name, { uid: event.uid, avatar: event.avatar, ts: event.ts, sim: isSimulated(event.raw) })
}

/** 首次加载：把礼物记录 / 时间插件记录里的送礼人并进来（只读它们的落盘文件，不反向依赖那两个模块） */
function seedFromOtherStores(): void {
  const giftLog = readJson<{ rows?: { ts?: number; sender?: string; sim?: boolean }[] }>('gift-log', {})
  for (const row of Array.isArray(giftLog.rows) ? giftLog.rows : []) {
    if (row?.sender) upsert(row.sender, { ts: Number(row.ts) || 0, sim: row.sim ? true : undefined, count: false })
  }
  const timeLog = readJson<{ entries?: { ts?: number; sender?: string; avatar?: string; source?: string }[] } | { ts?: number; sender?: string; avatar?: string; source?: string }[]>('time-gift-log', [])
  const entries = Array.isArray(timeLog) ? timeLog : Array.isArray(timeLog?.entries) ? timeLog.entries : []
  for (const entry of entries) {
    if (entry?.sender) upsert(entry.sender, { ts: Number(entry.ts) || 0, avatar: entry.avatar, sim: entry.source === 'test' ? true : undefined, count: false })
  }
}

{
  const saved = readJson<Stored>(STORE, {})
  rows = Array.isArray(saved.rows) ? saved.rows.map(sanitize).filter((row): row is ViewerRow => !!row) : []
  try { seedFromOtherStores() } catch (error) { console.warn('[viewers] 合并礼物记录失败：', (error as Error).message) }
  prune()
}

/** 给下拉：最近出现的在前；头像按「记录 → 磁盘缓存」补齐，补不到就空着 */
export function listViewers(limit = 1000): ViewerListResult {
  prune()
  const max = Math.max(1, Math.min(MAX_ROWS, Math.trunc(Number(limit) || 1000)))
  const out: ViewerRow[] = []
  for (const row of rows.slice(0, max)) {
    const avatar = usableAvatar(row.avatar) || probeCachedAvatar(row.name)
    out.push({ ...row, ...(avatar ? { avatar } : { avatar: undefined }) })
  }
  return { rows: out, total: rows.length }
}
