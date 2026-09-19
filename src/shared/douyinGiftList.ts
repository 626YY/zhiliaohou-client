// 抖音直播礼物表（live.douyin.com/webcast/gift/list）的纯数据处理：主进程同步礼物图、单测都用这里，不碰文件和网络。
// 2026-09-06 实测：接口不登录、只带 ttwid 也能拉到全量礼物表（约 1000 个礼物），礼物在 data.gifts[]，
// 真实房间还会多出 data.pages[].gifts[]；每个礼物带 id / name / diamond_count / image.url_list[]。

export interface DouyinGiftEntry {
  id: string
  name: string
  diamondCount: number
  /** 候选图 URL（https，按响应顺序；不同 CDN 域名指向同一张图） */
  urls: string[]
  /** 去掉图床域名与 ~tplv 后缀的路径，用来认出「同一张图」 */
  uri: string
  describe?: string
  /** 礼物面板上是否显示（下架/隐藏礼物为 false，图照样缓存，观众仍可能送出） */
  onPanel: boolean
}

const GIFT_LIST_ENDPOINT = 'https://live.douyin.com/webcast/gift/list/'

export function giftNameKey(value: string): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}

/** 与连接器 GiftImageCache._safe_name 同规则：去掉 Windows 非法文件名字符、折叠空白、最多 40 字；空了给个稳定的兜底名 */
export function giftFileStem(name: string): string {
  const collapsed = String(name || '').replace(/\s+/g, ' ').trim()
  const stem = collapsed.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40)
  if (stem) return stem
  let hash = 5381
  for (const ch of collapsed) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0
  return `礼物-${hash.toString(16)}`
}

export function giftImageUri(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  let pathname = raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname
    } catch {
      return ''
    }
  }
  const marker = '/img/'
  const index = pathname.indexOf(marker)
  const uri = index >= 0 ? pathname.slice(index + marker.length) : pathname.replace(/^\/+/, '')
  return uri.replace(/~tplv-[^/]+$/i, '')
}

export function buildGiftListUrl(roomId: string): string {
  const params = new URLSearchParams({
    aid: '6383',
    app_name: 'douyin_web',
    live_id: '1',
    device_platform: 'web',
    language: 'zh-CN',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '124.0.0.0',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    room_id: /^\d+$/.test(String(roomId || '').trim()) ? String(roomId).trim() : '0',
    fetch_giftlist_from: '2'
  })
  return `${GIFT_LIST_ENDPOINT}?${params.toString()}`
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function urlsOf(image: unknown): string[] {
  if (!image || typeof image !== 'object') return []
  const list = (image as { url_list?: unknown }).url_list
  const urls = Array.isArray(list) ? list.map(textOf).filter((u) => /^https?:\/\//i.test(u)) : []
  return [...new Set(urls.map((u) => u.replace(/^http:\/\//i, 'https://')))]
}

function toEntry(raw: unknown): DouyinGiftEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const gift = raw as Record<string, unknown>
  const name = textOf(gift.name)
  const id = textOf(gift.id ?? gift.gift_id)
  const urls = urlsOf(gift.image)
  if (!name || !id || !urls.length) return null
  const diamond = Number(gift.diamond_count)
  return {
    id,
    name,
    diamondCount: Number.isFinite(diamond) ? diamond : 0,
    urls,
    uri: giftImageUri(urls[0]),
    describe: textOf(gift.describe) || undefined,
    onPanel: gift.is_displayed_on_panel !== false
  }
}

/** 从接口响应里抠出全部礼物（data.gifts + data.pages[].gifts），按 id 去重、同 id 合并候选 URL */
export function extractDouyinGifts(json: unknown): DouyinGiftEntry[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!data || typeof data !== 'object') return []
  const d = data as { gifts?: unknown; pages?: unknown }
  const sources: unknown[] = []
  if (Array.isArray(d.gifts)) sources.push(...d.gifts)
  if (Array.isArray(d.pages)) {
    for (const page of d.pages) {
      const gifts = (page as { gifts?: unknown } | null)?.gifts
      if (Array.isArray(gifts)) sources.push(...gifts)
    }
  }
  const byId = new Map<string, DouyinGiftEntry>()
  for (const raw of sources) {
    const entry = toEntry(raw)
    if (!entry) continue
    const current = byId.get(entry.id)
    if (!current) {
      byId.set(entry.id, entry)
      continue
    }
    for (const url of entry.urls) if (!current.urls.includes(url)) current.urls.push(url)
    if (!current.uri) current.uri = entry.uri
    current.onPanel = current.onPanel || entry.onPanel
  }
  return [...byId.values()]
}

/** 同名礼物只留一条（面板上的优先，其次 id 大的=更新的），给「按名字找图」用 */
export function dedupeGiftsByName(gifts: DouyinGiftEntry[]): DouyinGiftEntry[] {
  const byName = new Map<string, DouyinGiftEntry>()
  for (const gift of gifts) {
    const key = giftNameKey(gift.name)
    if (!key) continue
    const current = byName.get(key)
    if (!current || (gift.onPanel && !current.onPanel) || (gift.onPanel === current.onPanel && Number(gift.id) > Number(current.id))) {
      byName.set(key, gift)
    }
  }
  return [...byName.values()]
}
