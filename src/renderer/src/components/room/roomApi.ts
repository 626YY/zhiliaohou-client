// 直播间名额 / 扫码绑定：renderer 侧的接口封装与纯函数（按 Tmp/live-data/rooms-contract.md）。
// 主进程接口由 main 同事提供（preload：cardRooms / cardRoomVerify / cardRoomCommit / unbindRoom）；
// 这里不碰令牌 / cookie，只认主进程给的 proof（不显示、不打印）。
import type { BindRoomResult, CardRoomCommitInput, CardRoomCommitResult, CardRoomVerifyResult, CardRoomsResult, RoomQuotaState } from '@shared/types'

export type { RoomQuotaState, CardRoomVerifyResult, CardRoomCommitInput, CardRoomCommitResult }

export type RoomApi = {
  cardRooms: () => Promise<CardRoomsResult>
  cardRoomVerify: (room?: string, proof?: string) => Promise<CardRoomVerifyResult>
  cardRoomCommit: (input: CardRoomCommitInput) => Promise<CardRoomCommitResult>
  unbindRoom: (room: string) => Promise<BindRoomResult>
}

/** 取直播间接口：全部走 preload 暴露的 window.api（主进程只信 main frame）；老 preload 缺这几个方法时返回 null。 */
export function resolveRoomApi(): RoomApi | null {
  const api = window.api
  if (typeof api?.cardRooms !== 'function' || typeof api.cardRoomVerify !== 'function' || typeof api.cardRoomCommit !== 'function') return null
  return {
    cardRooms: () => api.cardRooms(),
    cardRoomVerify: (room, proof) => api.cardRoomVerify(room, proof),
    cardRoomCommit: (input) => api.cardRoomCommit(input),
    unbindRoom: (room) => api.unbindRoom(room)
  }
}

/** 抖音直播间号：字母、数字、下划线、连字符，1～64 位（不少主播的房号带字母，不是纯数字）。与主进程 license-connection.ts 同一规则。 */
export const ROOM_ID_RE = /^[0-9A-Za-z_-]{1,64}$/
const URL_RE = /https?:\/\/[^\s"'<>【】（）()]+/gi
const BARE_LIVE_RE = /(?:^|[^\w.])live\.douyin\.com\/([0-9A-Za-z_-]{3,})/i
/** live.douyin.com 下这些路径不是房号（分类页 / 搜索 / 关注等），粘进来当链接时不能误认成直播间。 */
const NOT_ROOM_WORDS = /^(www|live|v|http|https|search|follow|category|hot|explore|user|login|home|index|recommend)$/i

function looksLikeRoom(value: string): boolean {
  return ROOM_ID_RE.test(value) && !NOT_ROOM_WORDS.test(value)
}

export type RoomIdExtract = { room?: string; source: 'id' | 'link' | 'none'; error?: string }

/**
 * 从「直播间号」或「直播链接 / 分享文案」里识别真实的直播间号。
 * 只认 live.douyin.com/<房号> 与 douyin.com/…/live/<房号> 两种带房号的地址；短链接（v.douyin.com）里没有房号，
 * 明确让主播打开后复制完整地址，绝不猜别的房间。
 */
export function extractRoomId(raw: string): RoomIdExtract {
  const text = (raw || '').trim()
  if (!text) return { source: 'none', error: '请输入直播间号，或粘贴直播链接' }
  if (looksLikeRoom(text)) return { room: text, source: 'id' }
  const urls = text.match(URL_RE) || []
  const bare = text.match(BARE_LIVE_RE)
  if (!urls.length && bare && looksLikeRoom(bare[1])) return { room: bare[1], source: 'link' }
  let shortLink = false
  let foreign = false
  for (const u of urls) {
    let url: URL
    try {
      url = new URL(u)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase()
    if (host === 'live.douyin.com') {
      const m = url.pathname.match(/^\/([0-9A-Za-z_-]{3,})(?:\/|$)/)
      if (m && looksLikeRoom(m[1])) return { room: m[1], source: 'link' }
      continue
    }
    if (host === 'v.douyin.com') {
      shortLink = true
      continue
    }
    if (host.endsWith('.douyin.com') || host === 'douyin.com') {
      const m = url.pathname.match(/\/live\/([0-9A-Za-z_-]{3,})(?:\/|$)/)
      if (m && looksLikeRoom(m[1])) return { room: m[1], source: 'link' }
      continue
    }
    foreign = true
  }
  if (shortLink) return { source: 'none', error: '短链接里没有直播间号。请用浏览器打开它，等地址变成 live.douyin.com/房号 后，复制完整地址再粘贴' }
  if (urls.length && foreign) return { source: 'none', error: '这不是抖音直播链接。请复制抖音直播间地址栏里的完整链接' }
  if (urls.length) return { source: 'none', error: '链接里没有直播间号。请复制 live.douyin.com/房号 这样的完整地址' }
  return { source: 'none', error: '没识别出直播间号。直播间号是字母或数字，或者粘贴 live.douyin.com/… 完整链接' }
}

/** 列表头一句话：已绑 N / 总名额 · 还能加几个 · 剩余改绑次数 */
export function quotaSummary(q: RoomQuotaState | null | undefined, fallbackRooms: string[] = []): { bound: number; capacity: number; available: number; changesLeft: number; free: boolean } {
  if (!q) return { bound: fallbackRooms.length, capacity: Math.max(1, fallbackRooms.length), available: 0, changesLeft: 0, free: false }
  const rooms = Array.isArray(q.rooms) ? q.rooms : []
  return {
    bound: rooms.length,
    capacity: Math.max(0, Number(q.capacity) || 0),
    available: Math.max(0, Number(q.available) || 0),
    changesLeft: Math.max(0, Number(q.changes_left) || 0),
    // 免检：数量和改绑次数不限，界面别再报数字
    free: q.free === true
  }
}

/** 按槽位顺序排好的已绑直播间（bindings 缺失时按 rooms 顺序） */
export function orderedBindings(q: RoomQuotaState | null | undefined, fallbackRooms: string[] = []): { slot: number; room: string }[] {
  if (q && Array.isArray(q.bindings) && q.bindings.length) {
    return [...q.bindings].filter((b) => b && typeof b.room === 'string').sort((a, b) => a.slot - b.slot)
  }
  const rooms = q && Array.isArray(q.rooms) ? q.rooms : fallbackRooms
  return rooms.map((room, i) => ({ slot: i + 1, room }))
}

/** 名额 / 次数是否足够做这件事（先问一句，不够直接弹卡，不让主播白扫码） */
export function preflight(q: RoomQuotaState | null | undefined, action: 'bind' | 'replace'): 'ok' | 'room_slot' | 'room_change' | 'unknown' {
  if (!q) return 'unknown'
  if (action === 'bind') return (Number(q.available) || 0) > 0 ? 'ok' : 'room_slot'
  return (Number(q.changes_left) || 0) > 0 ? 'ok' : 'room_change'
}
