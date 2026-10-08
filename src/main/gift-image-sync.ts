// 自动缓存抖音礼物图（2026-09-06 用户：「新上的礼物都没缓存」）：
//   客户端启动后 / 每小时 / 连接直播间时（以及连接器页手动点「同步礼物图」）拉抖音当前礼物表，把本地还没有图的礼物下载到
//   连接器同一个缓存目录 <Mod 目录>/礼物图/抖音/<礼物名>.<ext>——礼物图库扫描器本来就读这个目录且优先级最高，
//   特效 / 时间插件 / 规则页下拉立刻能用，不用等观众真送一次。
//   · 全自动：客户端启动 15 秒后跑一次、之后每小时检查一次（6 小时内不重复拉），连接直播间时再按房间跑一次；手动同步不受限
//   · 接口不登录也能拉（只带 ttwid），有登录 Cookie 就带上
//   · 只下本地没有的（连接器目录 + 内置库都没这个名字的图），一次最多 300 张，3 路并发，单张 15 秒超时
//   · 任何一步失败都只记连接器日志，不影响连接
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { connectorHomeDir } from './bridge'
import { readDouyinCookie } from './douyin-login'
import { findGiftImage, invalidateGiftImageCache } from './entertainment'
import {
  buildGiftListUrl,
  dedupeGiftsByName,
  extractDouyinGifts,
  giftFileStem,
  type DouyinGiftEntry
} from '@shared/douyinGiftList'
import { isRealGift } from '@shared/giftFilter'
import type { GiftImageSyncResult } from '@shared/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_DOWNLOADS = 300
const CONCURRENCY = 3
const FETCH_TIMEOUT_MS = 20_000
const IMAGE_TIMEOUT_MS = 15_000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_EXTS = ['.png', '.webp', '.jpg', '.jpeg', '.gif']

type SyncLog = (level: 'info' | 'warn', text: string) => void

interface SyncState {
  lastAt?: number
  lastRoom?: string
  lastResult?: Pick<GiftImageSyncResult, 'total' | 'existing' | 'downloaded' | 'failed'>
}

let running: Promise<GiftImageSyncResult> | null = null

/** 连接器目录下的礼物图缓存目录（与连接器 GiftImageCache 同一处；没装游戏整蛊 mod 时在客户端自己的连接器目录） */
export function giftImageCacheDir(): string {
  return path.join(connectorHomeDir(), '礼物图', '抖音')
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'data', 'gift-image-sync.json')
}

function readState(): SyncState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf-8')) as SyncState
  } catch {
    return {}
  }
}

function writeState(state: SyncState): void {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    /* 状态文件写不了只影响 6 小时节流 */
  }
}

function fail(dir: string, error: string): GiftImageSyncResult {
  return { ok: false, skipped: false, dir, total: 0, existing: 0, downloaded: 0, failed: 0, at: Date.now(), error }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function headerSafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim()
}

/** 请求头用的 Cookie：有登录态就带（新礼物/粉丝团礼物更全），没有就只带 ttwid */
async function cookieHeader(): Promise<string> {
  let cookie = ''
  try {
    cookie = await readDouyinCookie(connectorHomeDir())
  } catch {
    cookie = ''
  }
  if (/(?:^|;\s*)ttwid=/.test(cookie)) return headerSafe(cookie)
  try {
    const home = await fetchWithTimeout('https://live.douyin.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' }, FETCH_TIMEOUT_MS)
    const setCookie = typeof home.headers.getSetCookie === 'function' ? home.headers.getSetCookie().join('; ') : home.headers.get('set-cookie') || ''
    const ttwid = setCookie.match(/ttwid=([^;]+)/)?.[1] || ''
    if (ttwid) cookie = cookie ? `ttwid=${ttwid}; ${cookie}` : `ttwid=${ttwid}`
  } catch {
    /* 拿不到 ttwid 就裸请求，接口多数时候也给 */
  }
  return headerSafe(cookie)
}

async function fetchGiftList(roomId: string): Promise<DouyinGiftEntry[]> {
  const cookie = await cookieHeader()
  const res = await fetchWithTimeout(buildGiftListUrl(roomId), {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      Referer: roomId ? `https://live.douyin.com/${roomId}` : 'https://live.douyin.com/',
      ...(cookie ? { Cookie: cookie } : {})
    }
  }, FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { status_code?: unknown }
  if (json && typeof json === 'object' && 'status_code' in json && Number(json.status_code) !== 0) {
    throw new Error(`接口返回 status_code=${String(json.status_code)}`)
  }
  return extractDouyinGifts(json)
}

function imageExtension(buffer: Buffer, contentType: string): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 4) === 'GIF8') return '.gif'
  const ct = contentType.toLowerCase()
  if (ct.includes('png')) return '.png'
  if (ct.includes('webp')) return '.webp'
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg'
  if (ct.includes('gif')) return '.gif'
  return ''
}

function hasLocalFile(dir: string, stem: string): boolean {
  return IMAGE_EXTS.some((ext) => fs.existsSync(path.join(dir, stem + ext)))
}

async function downloadOne(dir: string, gift: DouyinGiftEntry): Promise<void> {
  const stem = giftFileStem(gift.name)
  const errors: string[] = []
  for (const url of gift.urls.slice(0, 3)) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', Referer: 'https://live.douyin.com/' }
      }, IMAGE_TIMEOUT_MS)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length < 64 || buffer.length > MAX_IMAGE_BYTES) throw new Error(`大小异常 ${buffer.length} B`)
      const ext = imageExtension(buffer, res.headers.get('content-type') || '')
      if (!ext) throw new Error('不是可识别的图片')
      const target = path.join(dir, stem + ext)
      const tmp = `${target}.part`
      fs.writeFileSync(tmp, buffer)
      fs.renameSync(tmp, target)
      return
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(errors.join(' | ') || '没有可用的图片地址')
}

async function runPool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

async function doSync(opts: { roomId: string; force: boolean; log: SyncLog }): Promise<GiftImageSyncResult> {
  const dir = giftImageCacheDir()
  if (!dir) return fail('', '未找到当前游戏的整蛊 Mod 目录，礼物图无处可存；先在「启动游戏」页配好游戏路径并安装 Mod')
  const state = readState()
  // 节流：6 小时内拉过就不再拉。通用礼物表（没房间号）满足于任何一次近期同步；带房间号的只认同一房间（房间专属礼物页不同）
  const recent = !!state.lastAt && Date.now() - state.lastAt < MIN_INTERVAL_MS
  if (!opts.force && recent && (!opts.roomId || (state.lastRoom || '') === opts.roomId)) {
    const last = state.lastResult
    return { ok: true, skipped: true, dir, total: last?.total ?? 0, existing: last?.existing ?? 0, downloaded: 0, failed: 0, at: state.lastAt ?? Date.now() }
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return fail(dir, `礼物图目录建不了：${dir}`)
  }

  let gifts: DouyinGiftEntry[]
  try {
    gifts = dedupeGiftsByName(await fetchGiftList(opts.roomId))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts.log('warn', `拉取抖音礼物表失败：${message}；本次不同步礼物图`)
    return fail(dir, `拉取抖音礼物表失败：${message}`)
  }
  if (!gifts.length) {
    opts.log('warn', '抖音礼物表返回为空，本次不同步礼物图')
    return fail(dir, '抖音礼物表返回为空，稍后再试')
  }

  const todo: DouyinGiftEntry[] = []
  let existing = 0
  let ignored = 0
  for (const gift of gifts) {
    // 加成卡 / 助力票 / 礼包这类道具观众送不出来，礼物图库扫描器也不收，别白下
    if (!isRealGift(gift.name)) {
      ignored++
      continue
    }
    if (hasLocalFile(dir, giftFileStem(gift.name)) || findGiftImage(gift.name)) existing++
    else todo.push(gift)
  }
  const batch = todo.slice(0, MAX_DOWNLOADS)
  let downloaded = 0
  let failed = 0
  const failedNames: string[] = []
  if (batch.length) {
    opts.log('info', `礼物图同步：抖音礼物表 ${gifts.length - ignored} 个礼物，本地缺 ${todo.length} 张，开始下载${todo.length > batch.length ? `（本次先下 ${batch.length} 张）` : ''}`)
    await runPool(batch, CONCURRENCY, async (gift) => {
      try {
        await downloadOne(dir, gift)
        downloaded++
      } catch (error) {
        failed++
        if (failedNames.length < 10) failedNames.push(gift.name)
        opts.log('warn', `礼物图下载失败 ${gift.name}：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    if (downloaded) invalidateGiftImageCache()
  }
  const result: GiftImageSyncResult = {
    ok: true,
    skipped: false,
    dir,
    total: gifts.length - ignored,
    existing,
    downloaded,
    failed,
    failedNames: failedNames.length ? failedNames : undefined,
    at: Date.now()
  }
  writeState({ lastAt: result.at, lastRoom: opts.roomId, lastResult: { total: gifts.length - ignored, existing, downloaded, failed } })
  opts.log('info', downloaded || failed
    ? `礼物图同步完成：新增 ${downloaded} 张${failed ? `，${failed} 张失败` : ''}，本地已有 ${existing} 张 → ${dir}`
    : `礼物图已是最新：抖音礼物表 ${gifts.length - ignored} 个礼物本地都有图`)
  return result
}

/**
 * 同步抖音礼物图。同一时刻只跑一份（并发调用共用结果）。
 * @param roomId 直播间号（只影响接口里的房间专属礼物页，空=通用礼物表）
 * @param force  手动同步：忽略 6 小时节流
 */
export function syncDouyinGiftImages(
  options: { roomId?: string; force?: boolean; onLog?: SyncLog } = {}
): Promise<GiftImageSyncResult> {
  if (running) return running
  const roomId = String(options.roomId || '').trim()
  const log: SyncLog = options.onLog ?? (() => {})
  running = doSync({ roomId, force: !!options.force, log })
    .catch((error) => fail(giftImageCacheDir(), error instanceof Error ? error.message : String(error)))
    .finally(() => {
      running = null
    })
  return running
}

const STARTUP_DELAY_MS = Number(process.env.ZL_GIFT_SYNC_STARTUP_MS) || 15_000
const TICK_MS = 60 * 60 * 1000
let scheduled = false

/**
 * 全自动同步：客户端起来 15 秒后跑一次，之后每小时检查一次（真正拉取受 6 小时节流），不依赖连接器连没连。
 * 没配游戏路径（找不到 Mod 目录）就什么也不做，等下个钟点再看。
 */
export function scheduleGiftImageSync(log: SyncLog): void {
  if (scheduled) return
  scheduled = true
  const tick = (): void => {
    if (!giftImageCacheDir()) return
    void syncDouyinGiftImages({ onLog: log }).catch(() => {})
  }
  setTimeout(tick, STARTUP_DELAY_MS)
  setInterval(tick, TICK_MS)
}
