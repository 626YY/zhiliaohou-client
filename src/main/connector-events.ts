import type { ConnectorEvent, ConnectorEventType } from '@shared/types'
import { giftNamesEqual, normalizeGiftName } from '../shared/giftName'

type ConnectorEventHandler = (event: ConnectorEvent) => void | Promise<void>

const handlers = new Set<ConnectorEventHandler>()

// 礼物名归一化搬到 shared/giftName.ts 让渲染进程也能用；这里保持原导出名，调用方不用改。
export { giftNamesEqual, normalizeGiftName }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function number(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const item = text(value)
    if (item) return item
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const item = number(value)
    if (item != null) return item
  }
  return undefined
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nestedText(value: unknown, keys: string[]): string | undefined {
  const item = object(value)
  if (!item) return undefined
  return firstText(...keys.map((key) => item[key]))
}

function nestedNumber(value: unknown, keys: string[]): number | undefined {
  const item = object(value)
  if (!item) return undefined
  return firstNumber(...keys.map((key) => item[key]))
}

function typeFrom(value: unknown): ConnectorEventType | undefined {
  const key = text(value).toLocaleLowerCase('en-US').replace(/[_\s-]/g, '')
  if (!key) return undefined
  if (key.includes('giftimage') || key === 'image') return 'gift-image'
  if (key === 'gift' || key.includes('giftmessage')) return 'gift'
  if (key === 'comment' || key === 'chat' || key.includes('chatmessage')) return 'comment'
  if (key === 'member' || key.includes('membermessage') || key === 'enter') return 'member'
  if (key === 'follow' || key === 'social' || key === 'subscribe') return 'follow'
  if (key === 'badge' || key === 'fansclub') return 'badge'
  if (key === 'like' || key.includes('likemessage')) return 'like'
  if (key === 'anchor' || key === 'roomanchor') return 'anchor'
  if (key === 'status' || key === 'state') return 'status'
  return undefined
}

function fromJson(raw: string, value: unknown, ts: number): ConnectorEvent | null {
  const item = Array.isArray(value) ? value[0] : value
  const data = object(item)
  if (!data) return null
  const nestedGifts = [data.gift, data.giftData, data.gift_data]
  const kind = typeFrom(firstText(data.type, data.event, data.kind, data.method))
  const giftName = firstText(
    data.giftName,
    data.gift_name,
    ...nestedGifts.map(value => nestedText(value, ['name', 'giftName', 'gift_name'])),
    typeof data.gift === 'string' ? data.gift : undefined,
    // 只有明确的礼物类型才把顶层 name 当礼物名，避免把普通进场事件误判。
    kind === 'gift' ? data.name : undefined
  )
  const senderObject = object(data.sender) || object(data.user) || object(data.author)
  const sender = firstText(
    data.senderName,
    data.sender_name,
    nestedText(data.sender, ['name', 'nickname', 'nickName']),
    nestedText(data.user, ['name', 'nickname', 'nickName']),
    nestedText(data.author, ['name', 'nickname', 'nickName']),
    typeof data.sender === 'string' ? data.sender : undefined,
    typeof data.user === 'string' ? data.user : undefined,
    typeof data.nickname === 'string' ? data.nickname : undefined
  )
  const count = firstNumber(
    data.count,
    data.num,
    data.number,
    data.repeatCount,
    data.repeat_count,
    data.comboCount,
    data.combo_count,
    ...nestedGifts.map(value => nestedNumber(value, ['count', 'num', 'repeatCount', 'repeat_count', 'comboCount']))
  )
  const diamondCount = firstNumber(
    data.diamondCount,
    data.diamondcount,
    data.diamond_count,
    data.coins,
    data.score,
    ...nestedGifts.map(value => nestedNumber(value, ['diamondCount', 'diamondcount', 'diamond_count', 'coins', 'score']))
  )
  const giftImage = firstText(
    data.giftImage,
    data.gift_image,
    data.imageUrl,
    data.image_url,
    data.icon,
    ...nestedGifts.map(value => nestedText(value, ['image', 'imageUrl', 'image_url', 'icon']))
  )
  const message = firstText(data.text, data.msg, data.message, data.content)
  let resolved = kind
  if (!resolved && giftName) resolved = 'gift'
  if (!resolved && (data.giftImage || data.gift_image)) resolved = 'gift-image'
  if (!resolved && message) resolved = 'comment'
  if (!resolved) return null
  if (resolved === 'gift-image') {
    if (!giftName || !giftImage) return null
    return { type: resolved, ts, raw, giftName, giftImage, sender, uid: text(data.uid || data.userId) || undefined }
  }
  if (resolved === 'gift' && !giftName) return null
  if (resolved === 'gift' && count != null && Math.trunc(count) <= 0) return null
  return {
    type: resolved,
    ts,
    raw,
    giftName,
    count: count == null ? (resolved === 'gift' ? 1 : undefined) : Math.max(0, Math.trunc(count)),
    diamondCount: diamondCount == null ? undefined : Math.max(0, diamondCount),
    sender,
    uid: firstText(data.uid, data.userId, data.user_id, nestedText(senderObject, ['id', 'uid'])),
    avatar: firstText(data.avatar, data.avatarUrl, data.avatar_url, nestedText(senderObject, ['avatar', 'avatarUrl', 'avatar_url'])),
    giftImage,
    text: message
  }
}

function make(type: ConnectorEventType, raw: string, ts: number, patch: Partial<ConnectorEvent> = {}): ConnectorEvent {
  return { type, ts, raw, ...patch }
}

function parseGiftLog(raw: string, ts: number): ConnectorEvent | null {
  // 两种连接器格式都要认：
  //   知了猴主连接器  「礼物: 小心心 x3  by 阿彪」「模拟礼物: …」
  //   各游戏 mod 连接器「gift 小心心 x3 by 阿彪」「sim gift …」「gift[sign] …」
  // 老实现只认中文那种，接 mod 连接器的游戏（图书管理员等）礼物根本进不了挂件。
  const prefix =
    raw.match(/^(?:模拟)?礼物\s*[:：]\s*(.*)$/i) ||
    raw.match(/^(?:sim\s+)?(?:gift|sign)(?:\[[a-z]+\])?\s*[:：]?\s+(.*)$/i)
  if (!prefix) return null
  const body = prefix[1].trim()
  const counted = body.match(/^(.*?)\s*[×x*]\s*(\d+)(?:\s+|$)(.*)$/i)
  // 桥协议那种「gift 小心心 2 | 阿彪」没有 ×/x 分隔，交给下面的 parseBridge 解析。
  // 老实现在这里就把整串当成礼物名（giftName="小心心 2 | 阿彪"），礼物规则永远匹配不上 →
  // 用这种格式的事件送了礼物娱乐助手什么都不触发（2026-09-07 verify-connector-formats 抓到）。
  if (!counted && /^gift\s/i.test(raw) && /\s\d+\s*(?:\|[\s\S]*)?$/.test(body)) return null
  const name = (counted?.[1] || body).trim()
  if (!name) return null
  const count = counted ? Math.max(1, Number(counted[2]) || 1) : 1
  const tail = counted?.[3]?.trim() || ''
  // 「分/个」后面是中文或行尾，\b 在中文边界上不成立——带着它分值和送礼人都会解析错。
  const score = tail.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*分\/个/i)
  const senderMatch = tail.match(/\bby\s+(.+?)(?=\s+\d+(?:\.\d+)?\s*分\/个|\s+\(分值未知\)|$)/i)
  return make('gift', raw, ts, {
    giftName: name,
    count,
    diamondCount: score ? Math.max(0, Number(score[1]) || 0) : undefined,
    sender: senderMatch?.[1]?.trim() || undefined
  })
}

function parseBridge(raw: string, ts: number): ConnectorEvent | null {
  const gift = raw.match(/^gift\s+(.+)$/i)
  if (gift) {
    const parts = gift[1].split('|').map((part) => part.trim())
    const head = parts.shift() || ''
    const countMatch = head.match(/^(.*?)\s+(\d+)$/)
    const giftName = (countMatch?.[1] || head).trim()
    if (!giftName) return null
    const count = Math.max(1, Number(countMatch?.[2] || 1) || 1)
    const diamondCandidate = parts.length > 1 ? Number(parts[parts.length - 1]) : NaN
    const hasDiamond = Number.isFinite(diamondCandidate) && diamondCandidate >= 0
    if (hasDiamond) parts.pop()
    return make('gift', raw, ts, {
      giftName,
      count,
      sender: parts.join('|').trim() || undefined,
      diamondCount: hasDiamond ? diamondCandidate : undefined
    })
  }
  const like = raw.match(/^like\s+(\d+)(?:\s*\|\s*(.*))?$/i)
  if (like) return make('like', raw, ts, { count: Number(like[1]), sender: like[2]?.trim() || undefined })
  const follow = raw.match(/^follow(?:\s*\|\s*(.*))?$/i)
  if (follow) return make('follow', raw, ts, { sender: follow[1]?.trim() || undefined })
  const badge = raw.match(/^badge(?:\s*\|\s*(.*))?$/i)
  if (badge) return make('badge', raw, ts, { sender: badge[1]?.trim() || undefined })
  const comment = raw.match(/^(?:comment|chat)\s*[:：]?\s*(.*)$/i)
  if (comment) return make('comment', raw, ts, { text: comment[1].trim() })
  return null
}

export function parseConnectorEvent(rawValue: string, ts = Date.now()): ConnectorEvent | null {
  const raw = String(rawValue || '').trim()
  if (!raw) return null
  // connector.py 的 stdout 会统一加上 `[connector] `；桥协议测试文本通常没有。
  // 两者必须进入同一解析路径，否则真实直播事件只会显示日志而不会触发插件。
  const protocol = raw
    .replace(/^\s*(?:\[[^\]\[{}"\r\n]+\]\s*)+/, '')
    .replace(/^\s*(?:event|connector)\s*[:：]?\s*/i, '')
    .trim()
  const jsonCandidate = protocol
  if (jsonCandidate.startsWith('{') || jsonCandidate.startsWith('[')) {
    try {
      const event = fromJson(raw, JSON.parse(jsonCandidate), ts)
      if (event) return event
    } catch {
      // 不是 JSON 时继续尝试兼容的文本协议。
    }
  }
  const image = protocol.match(/^礼物图\s*[:：]\s*(.*?)\s*->\s*(.+?)\s*$/i)
  if (image?.[1] && image[2]) return make('gift-image', raw, ts, { giftName: image[1].trim(), giftImage: image[2].trim() })
  // 连接器下载好观众头像后打「头像: 昵称 -> 本地路径」（礼物行本身不带头像；以前只发给游戏桥，客户端看不到）
  const avatarLine = protocol.match(/^头像\s*[:：]\s*(.*?)\s*->\s*(.+?)\s*$/)
  if (avatarLine?.[1] && avatarLine[2]) return make('avatar', raw, ts, { sender: avatarLine[1].trim(), avatar: avatarLine[2].trim() })
  const gift = parseGiftLog(protocol, ts)
  if (gift) return { ...gift, raw }
  const bridge = parseBridge(protocol, ts)
  if (bridge) return { ...bridge, raw }
  const chat = protocol.match(/^弹幕\s*[:：]\s*(\S+)(?:\s+)(.+)$/)
  if (chat) return make('comment', raw, ts, { sender: chat[1].trim(), text: chat[2].trim() })
  const member = protocol.match(/^进场\s*[:：]\s*(.+)$/)
  if (member) return make('member', raw, ts, { sender: member[1].trim() })
  const follow = protocol.match(/^(?:模拟)?关注(?:\s+by)?\s*(.*)$/i)
  if (follow) return make('follow', raw, ts, { sender: follow[1].trim() || undefined })
  const badge = protocol.match(/^(?:模拟)?灯牌(?:\s+by)?\s*(.*)$/i)
  if (badge) return make('badge', raw, ts, { sender: badge[1].trim() || undefined })
  const like = protocol.match(/^点赞\s*[:：]?\s*(\d+)(?:\s+by\s+(.+))?$/i)
  if (like) return make('like', raw, ts, { count: Number(like[1]), sender: like[2]?.trim() || undefined })
  const anchor = protocol.match(/^认出主播\s*[:：]\s*(.+)$/)
  if (anchor) return make('anchor', raw, ts, { sender: anchor[1].trim() })
  const status = protocol.match(/^(?:状态|status)\s*[:：]\s*(.+)$/i)
  if (status) return make('status', raw, ts, { text: status[1].trim() })
  return null
}

export function eventLevel(event: ConnectorEvent): 'gift' | 'follow' | 'like' | 'info' {
  if (event.type === 'gift') return 'gift'
  if (event.type === 'follow' || event.type === 'badge') return 'follow'
  if (event.type === 'like') return 'like'
  return 'info'
}

export function subscribeConnectorEvent(handler: ConnectorEventHandler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function dispatchConnectorEvent(event: ConnectorEvent): void {
  for (const handler of [...handlers]) {
    try {
      const result = handler(event)
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => {})
      }
    } catch {
      // 一个插件异常不能阻断其他插件或直播连接器。
    }
  }
}
