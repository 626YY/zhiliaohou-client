import { randomUUID } from 'node:crypto'
import type { ConnectorEvent } from '@shared/types'

export interface LiveReportContext { email: string; server: string; room: string; game: string }
export interface LiveReportEvent {
  id: string; ts: number; type: 'gift' | 'follow' | 'like' | 'enter' | 'comment'
  nick: string; gift: string; count: number; coins: number
}
export interface PendingLiveEvent extends LiveReportContext { event: LiveReportEvent }
export interface LiveReportReply { ok: boolean; accepted?: string[]; error?: string }

const clean = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const integer = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback
}
const MAX_PENDING = 20_000

/** 保存未确认的事件；服务端按 id 去重，超时和重启后重传不会再次计数。 */
export class LiveReportQueue {
  private pending: PendingLiveEvent[]
  private sending = false
  private nextContext = 0
  constructor(
    initial: PendingLiveEvent[],
    private persist: (rows: PendingLiveEvent[]) => void,
    private send: (context: LiveReportContext, events: LiveReportEvent[]) => Promise<LiveReportReply>
  ) {
    this.pending = Array.isArray(initial) ? initial.filter(x => x?.event?.id && x.email && x.server && x.room) : []
  }

  add(context: LiveReportContext | null, event: ConnectorEvent, unitCoins: number, simulated: boolean): boolean {
    if (!context || simulated || /\[模拟\]|模拟礼物|(?:^|\]\s*)sim\s+gift/i.test(event.raw)) return false
    const type = event.type === 'member' ? 'enter' : event.type
    if (!['gift', 'follow', 'like', 'enter', 'comment'].includes(type)) return false
    if (!Number.isFinite(event.ts) || event.ts <= 0 || event.ts > Date.now() + 60_000) throw new Error('观众记录时间异常，请检查电脑时间')
    const nick = clean(event.sender, 32)
    // 无昵称的聚合点赞不能冒充一位观众；不上传头像、本地路径、弹幕正文。
    if (!nick || !/^[a-zA-Z0-9_-]{1,64}$/.test(context.room)) return false
    if (this.pending.length >= MAX_PENDING) throw new Error('观众记录积压已达上限，请恢复服务器连接')
    const count = event.type === 'gift' ? integer(event.count, 1) : event.type === 'like' ? integer(event.count) : 1
    if (!count) return false
    if (count > 1_000_000_000) throw new Error('观众记录数量超过服务器上限，请导出诊断联系管理员')
    const gift = event.type === 'gift' ? clean(event.giftName, 64) : ''
    if (event.type === 'gift' && !gift) return false
    // 与 live-session.ts 的 giftCoins 口径一致：单价四舍五入后乘数量。
    const coins = event.type === 'gift' ? integer(Math.round(Number(unitCoins))) * count : 0
    if (!Number.isSafeInteger(coins) || coins > 1_000_000_000) throw new Error('观众记录金额超过服务器上限，请导出诊断联系管理员')
    const row: PendingLiveEvent = { ...context, event: {
      id: randomUUID(), ts: Math.floor(event.ts / 1000), type: type as LiveReportEvent['type'], nick, gift, count, coins
    } }
    const next = [...this.pending, row]
    this.persist(next)
    this.pending = next
    return true
  }

  async flush(email: string, server: string): Promise<number> {
    if (this.sending) return 0
    const contexts = new Map<string, PendingLiveEvent>()
    for (const item of this.pending) {
      if (item.email === email && item.server === server) contexts.set(`${item.room}|${item.game}`, item)
    }
    if (!contexts.size) return 0
    // 已解绑旧房间的积压可能一直被拒，轮流尝试各房间，避免堵住新直播间。
    const first = [...contexts.values()][this.nextContext++ % contexts.size]
    const batch = this.pending.filter(x => x.email === email && x.server === server && x.room === first.room && x.game === first.game).slice(0, 200)
    this.sending = true
    try {
      const result = await this.send(first, batch.map(x => x.event))
      if (!result.ok) throw new Error(result.error || '观众记录上传失败，恢复连接后重试')
      const sent = new Set(batch.map(x => x.event.id))
      const acknowledged = new Set((result.accepted || []).filter(id => sent.has(id)))
      if (!acknowledged.size) throw new Error('服务器未确认观众记录，记录已保留待重试')
      const next = this.pending.filter(x => !acknowledged.has(x.event.id))
      this.persist(next)
      this.pending = next
      return acknowledged.size
    } finally {
      this.sending = false
    }
  }

  get size(): number { return this.pending.length }
}
