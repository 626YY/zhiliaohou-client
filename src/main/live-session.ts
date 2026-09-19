// 直播本场统计（客户端侧记一份）：连接器事件本来就在主进程里统一解析分发（connector-runtime.ts），
// 这里顺手把礼物/点赞/关注记成本场账，让「直播互动统计」页不再依赖各游戏 mod 的连接器写 live_stats.json。
//   · 2026-09-07 用户实测：客户端当前游戏是图书管理员，它的薄连接器根本不写 live_stats.json，
//     于是主播明明开着播、礼物也送了，统计页永远「暂无本场数据」。
//   · 口径与主连接器的 LiveStats 一致：gifts 累加「个数」、coins 累加「抖币×个数」、likes 累加增量、follows 计次；
//     弹幕/进场/礼物图/状态不进本场账。抖币：事件自带就用自带的，没有就查内置礼物表（薄连接器不发抖币）。
//   · running 由「连接器进程在不在跑」决定（客户端自己最清楚），比看文件时间戳靠得住；
//     每 10 秒把 last 往前推一次，安静的直播间（没人互动）不会被统计页的 60 秒过期判断误判成已下播。
//   · 只落数值，绝不落观众昵称（隐私红线，同连接器 LiveStats 的老约定）。
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { subscribeConnectorEvent } from './connector-events'
import { findGiftImage } from './entertainment'
import type { ConnectorEvent, LiveSessionStats } from '@shared/types'

const SAVE_DEBOUNCE_MS = 1500
const HEARTBEAT_MS = 10_000

let session: LiveSessionStats | null = null
let subscribed = false
let loaded = false
let saveTimer: NodeJS.Timeout | null = null
let beatTimer: NodeJS.Timeout | null = null

function statePath(): string {
  return path.join(app.getPath('userData'), 'data', 'live-session.json')
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function save(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!session) return
  try {
    const file = statePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(session), 'utf-8')
    fs.renameSync(tmp, file)
  } catch {
    /* 统计写失败绝不影响直播 */
  }
}

function scheduleSave(): void {
  // 点赞会成串刷进来，攒一下再落盘，别把磁盘打满
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    save()
  }, SAVE_DEBOUNCE_MS)
}

/** 上次的本场账（客户端重启后还能看「已下播报告」）。running 一律按 0 读回：连接器此刻并没在跑。 */
function loadOnce(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf-8')) as Partial<LiveSessionStats>
    const started = num(raw.started)
    if (!started) return
    const last = Math.max(started, num(raw.last, started))
    const savedEnd = num(raw.endedAt)
    // 异常退出保留最后一次心跳；旧版 running:0 的 last 曾被每次退出改写，不能冒充准确结束时间。
    const endedAt = savedEnd >= started ? savedEnd : raw.running === 1 ? last : undefined
    session = {
      room: typeof raw.room === 'string' ? raw.room.slice(0, 64) : '',
      started,
      last,
      endedAt,
      durationUnknown: raw.durationUnknown === true || endedAt == null,
      gifts: num(raw.gifts),
      coins: num(raw.coins),
      likes: num(raw.likes),
      follows: num(raw.follows),
      running: 0
    }
  } catch {
    /* 没有历史记录是正常的 */
  }
}

function giftCoins(event: ConnectorEvent): number {
  if (event.diamondCount != null) return Math.max(0, Math.round(num(event.diamondCount)))
  // 薄连接器（图书管理员）只发礼物名和个数，抖币查内置礼物表补上
  const meta = event.giftName ? findGiftImage(event.giftName) : undefined
  return Math.max(0, Math.round(num(meta?.diamondCount)))
}

function onEvent(event: ConnectorEvent): void {
  if (!session || !session.running) return
  if (event.type === 'gift' && event.giftName) {
    const count = Math.max(1, Math.trunc(num(event.count, 1)))
    session.gifts += count
    session.coins += giftCoins(event) * count
  } else if (event.type === 'like') {
    session.likes += Math.max(0, Math.trunc(num(event.count)))
  } else if (event.type === 'follow') {
    session.follows += 1
  } else {
    return
  }
  session.last = nowSec()
  scheduleSave()
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  subscribeConnectorEvent(onEvent)
}

/**
 * 连接器启动成功时开一场新账。
 * @param room 直播间号；模拟模式传空，本场记作 'sim'（和主连接器写的 live_stats.json 口径一致）
 */
export function startLiveSession(room: string, sim = false): void {
  ensureSubscribed()
  loaded = true // 新的一场，不再读回历史
  const at = nowSec()
  session = {
    room: (sim ? 'sim' : String(room || '')).slice(0, 64),
    started: at,
    last: at,
    gifts: 0,
    coins: 0,
    likes: 0,
    follows: 0,
    running: 1
  }
  if (beatTimer) clearInterval(beatTimer)
  // 心跳：安静的直播间也要让 last 往前走，否则统计页 60 秒后把「直播中」判成「已下播」
  beatTimer = setInterval(() => {
    if (!session || !session.running) return
    session.last = nowSec()
    save()
  }, HEARTBEAT_MS)
  save()
}

/** 连接器停了：本场定格，留着当「已下播报告」。 */
export function stopLiveSession(): void {
  if (beatTimer) {
    clearInterval(beatTimer)
    beatTimer = null
  }
  // stopConnector 会在手动断开、关窗、before-quit 中重复调用；历史报告和已结束的本场必须保持不变。
  if (!session || session.running !== 1) return
  session.running = 0
  session.last = Math.max(session.started, nowSec())
  session.endedAt = session.last
  save()
}

/** 连接器是不是正跑着（统计页据此判「直播中」，比文件时间戳可靠）。 */
export function liveSessionRunning(): boolean {
  return !!session && session.running === 1
}

/** 本场是不是模拟模式（礼物记录据此给「模拟」标记）。 */
export function liveSessionSim(): boolean {
  return !!session && session.running === 1 && session.room === 'sim'
}

/** 客户端侧本场账；没有就返回 null。 */
export function readLiveSession(): LiveSessionStats | null {
  loadOnce()
  return session ? { ...session } : null
}
