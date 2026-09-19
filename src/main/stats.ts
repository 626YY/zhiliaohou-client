// 直播互动统计：读连接器写的 live_stats.json（本场报告）+ mod 本地 config.json 的 Viewers（累计账，含炸毁）+ 本地遥控计数。
// ★2026-08-06 累计互动改读 mod 本地 config.json：world_board.json 是连接器从服务器拉的世界榜缓存({ts,world,room_total})，
//   根本没有 cells 字段 → 客户端「累计互动」表(飞天/干掉/抓鸭/送礼/炸毁)永远解析为空。而 mod 的 config.json 里
//   Viewers 有完整的 6 维 × 5 时间窗本地账(Boom 炸毁还即时落盘) —— 游戏崩了账在磁盘不丢，重启后 mod 读回同步。
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { wheelLiveDir } from './bridge'
import { liveSessionRunning, readLiveSession } from './live-session'
import type { LiveSessionStats, LiveStatsResult, LiveBoardCell } from '@shared/types'

function readJson<T>(p: string): T | null {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
  } catch {
    // 读失败当没有
  }
  return null
}

// 期望 cells 形如 { "<metric>": { "<window>": number, ... }, ... }；不满足就返回空
function parseCells(cells: unknown): LiveBoardCell[] {
  const out: LiveBoardCell[] = []
  if (cells && typeof cells === 'object') {
    for (const [mk, mv] of Object.entries(cells as Record<string, unknown>)) {
      const metric = Number(mk)
      if (!Number.isFinite(metric)) continue
      if (mv && typeof mv === 'object') {
        for (const [wk, wv] of Object.entries(mv as Record<string, unknown>)) {
          const window = Number(wk)
          if (!Number.isFinite(window)) continue
          const v = Number(wv)
          if (Number.isFinite(v)) out.push({ metric, window, value: v })
        }
      } else {
        const v = Number(mv)
        if (Number.isFinite(v)) out.push({ metric, window: 3, value: v })
      }
    }
  }
  return out
}

// ===== 读 mod 本地 config.json 的 Viewers，聚合成「本房间累计账」=====
//   与 mod Records.cs 的 ViewerStat/Tally/MaxTally 结构对齐：
//     metric: 0=飞天(峰值,取最大) 1=干掉 2=抓鸭 3=送礼次数 4=送礼分 5=炸毁
//     window: 0=今日 1=本周 2=本月 3=总 4=本年
interface WlTally {
  Day?: number
  Week?: number
  Month?: number
  Year?: number
  Total?: number
}
interface WlViewerStat {
  Gift?: WlTally
  Score?: WlTally
  Kill?: WlTally
  Duck?: WlTally
  Boom?: WlTally
  FlyMax?: WlTally
}

const NUM = (x: unknown): number =>
  Number.isFinite(Number(x)) ? Number(x) : 0

function readLocalBoard(): { cells: LiveBoardCell[]; ts: number } {
  const dir = wheelLiveDir()
  if (!dir) return { cells: [], ts: 0 }
  const cfgPath = join(dir, 'config.json')
  const cfg = readJson<{ Viewers?: Record<string, WlViewerStat> }>(cfgPath)
  const viewers = cfg?.Viewers
  if (!viewers || typeof viewers !== 'object') return { cells: [], ts: 0 }

  // agg[metric][window]
  const agg: number[][] = Array.from({ length: 6 }, () => Array(5).fill(0))
  const feed = (
    st: WlViewerStat,
    field: keyof WlViewerStat,
    metric: number,
    isMax: boolean
  ) => {
    const t = st[field]
    if (!t || typeof t !== 'object') return
    const vals = [NUM(t.Day), NUM(t.Week), NUM(t.Month), NUM(t.Total), NUM(t.Year)]
    for (let w = 0; w < 5; w++) {
      agg[metric][w] = isMax
        ? Math.max(agg[metric][w], vals[w])
        : agg[metric][w] + vals[w]
    }
  }
  for (const st of Object.values(viewers)) {
    if (!st || typeof st !== 'object') continue
    feed(st, 'FlyMax', 0, true) // 飞天：跨观众取最大峰值
    feed(st, 'Kill', 1, false) // 干掉
    feed(st, 'Duck', 2, false) // 抓鸭
    feed(st, 'Gift', 3, false) // 送礼次数
    feed(st, 'Score', 4, false) // 送礼分
    feed(st, 'Boom', 5, false) // 炸毁
  }
  const cells: LiveBoardCell[] = []
  for (let m = 0; m < 6; m++)
    for (let w = 0; w < 5; w++)
      cells.push({ metric: m, window: w, value: agg[m][w] })

  // ts：config.json 修改时间(秒) —— 客户端据此判断账的新旧；游戏崩了文件还在，最后落盘时间即最后记账时刻
  let ts = 0
  try {
    const st = fs.statSync(cfgPath)
    ts = Math.floor(st.mtimeMs / 1000)
  } catch {
    /* stat 失败当 0 */
  }
  return { cells, ts }
}

export function statsPrankTick(): void {
  // 遥控整蛊计数：带 ts 存 userData，统计页过滤「本场」用。保留 7 天、最多 1000 条防膨胀。
  const f = join(app.getPath('userData'), 'prank_ticks.json')
  try {
    const arr = readJson<{ ts: number }[]>(f) ?? []
    arr.push({ ts: Date.now() })
    const cut = Date.now() - 7 * 86_400_000
    const clean = arr.filter((x) => Number(x?.ts) >= cut).slice(-1000)
    fs.writeFileSync(f, JSON.stringify(clean), 'utf-8')
  } catch {
    // 计数写失败不影响整蛊
  }
}

// mod 的 live_stats.json 多久算「新鲜」：主连接器每 10s 落一次盘，两分钟没动就是上一场的残留
const MOD_STATS_FRESH_SEC = 120

/**
 * 本场账取哪一份：
 *   · mod 的 live_stats.json 新鲜 → 用它（轮椅/DON'T SCREAM 的连接器写，还带 mod 侧的口径）
 *   · 否则用客户端自己记的（图书管理员的薄连接器根本不写这个文件；DS 目录还可能躺着上一场模拟模式的残留）
 *   · 两份都不新鲜 → 取 last 更晚的那份，当「上一场已下播报告」看
 */
function pickSession(dir: string): LiveSessionStats | null {
  const mod = dir ? readJson<LiveSessionStats>(join(dir, 'live_stats.json')) : null
  const own = readLiveSession()
  // 当前连接的房间优先；刚结束后也不能让同一场连接器残留的 running:1 把时钟重新启动。
  if (own && liveSessionRunning()) return own
  if (own?.endedAt && (!mod || Number(mod.started) <= own.endedAt)) return own
  const now = Date.now() / 1000
  const fresh = (s: LiveSessionStats | null): boolean =>
    !!s && now - Number(s.last || s.started) <= MOD_STATS_FRESH_SEC
  if (fresh(mod)) return mod
  if (fresh(own)) return own
  if (mod && own) return Number(mod.last || 0) >= Number(own.last || 0) ? mod : own
  return mod || own
}

export function readLiveStats(): LiveStatsResult {
  const dir = wheelLiveDir()
  const session = pickSession(dir)
  let remotePranks = 0
  if (session?.started) {
    const ticks =
      readJson<{ ts: number }[]>(join(app.getPath('userData'), 'prank_ticks.json')) ?? []
    // session.started 是秒（连接器 int(time.time())），prank tick 是毫秒，统一到毫秒再比
    remotePranks = ticks.filter((x) => Number(x?.ts) >= session.started * 1000).length
  }
  if (!session) {
    return { ok: false, remotePranks: 0, error: '暂无本场数据，连接直播间后自动记录' }
  }
  // ★2026-08-09 假「直播中」修复：连接器每 10s 更新 last，异常退出(kill/崩溃)不会写 running:0，
  //   残留 running:1 会让统计页永远显示「直播中」且时长一直增长（实测涨到 81 小时）。
  //   心跳过期判断：running 但 last 距今超过 60s → 连接器已死，按已下播处理（时长用 last 定格）。
  //   ★2026-09-07 补：连接器进程在不在跑，客户端自己最清楚，比文件时间戳可靠——
  //   在跑就一定是「直播中」（安静的直播间没人互动，last 不动也不该判成已下播）；没在跑才走过期判断。
  if (liveSessionRunning()) {
    session.running = 1
  } else if (session.running && Date.now() / 1000 - Number(session.last || session.started) > 60) {
    session.running = 0
  }
  // ★2026-08-06 累计账改读 mod 本地 config.json 的 Viewers（完整 6 维×5 窗，含炸毁，游戏崩了不丢）。
  //   本地账为空时退回老的 world_board.json cells 解析（老连接器格式，尽力而为）。
  const local = dir ? readLocalBoard() : { cells: [], ts: 0 }
  const board =
    local.cells.length > 0
      ? { ts: local.ts, cells: local.cells }
      : dir
        ? (() => {
            const b = readJson<{ ts?: number; cells?: unknown }>(
              join(dir, 'world_board.json')
            )
            return { ts: Number(b?.ts ?? 0), cells: parseCells(b?.cells) }
          })()
        : undefined
  return {
    ok: true,
    session,
    remotePranks,
    board
  }
}
