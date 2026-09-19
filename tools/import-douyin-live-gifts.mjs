import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetDir = path.join(root, 'gift-assets', 'douyin')
const catalogPath = path.join(assetDir, 'catalog.json')
const defaultResponse = path.join(root, 'output', 'playwright', 'douyin-gifts', 'gift-list-response.json')

const responsePath = path.resolve(argValue('response') || defaultResponse)
const roomId = argValue('room-id') || ''
const roomUrl = argValue('room-url') || ''
const temporaryFiles = new Set()

function argValue(name) {
  const prefix = `--${name}=`
  const value = process.argv.find((arg) => arg.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

function key(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}

function pairKey(name, uri) {
  return `${key(name)}\u0000${String(uri || '').trim()}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function shortHash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function safeStem(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  const stem = normalized.replace(/[. ]+$/g, '').slice(0, 80)
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) return '礼物'
  return stem
}

function normalizeUrl(value) {
  const url = String(value || '').trim().replace(/^http:\/\//i, 'https://')
  return /^https?:\/\//i.test(url) ? url : ''
}

function imageUri(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, '').replace(/~tplv-[^/]+$/i, '')
  }
  try {
    const pathname = new URL(raw).pathname
    const marker = '/img/'
    const index = pathname.indexOf(marker)
    const uri = index >= 0 ? pathname.slice(index + marker.length) : pathname.replace(/^\/+/, '')
    return uri.replace(/~tplv-[^/]+$/i, '')
  } catch {
    return raw.replace(/~tplv-[^/]+$/i, '')
  }
}

function imageExtension(buffer, contentType = '') {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png'
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return '.jpg'
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString() === 'GIF87a' || buffer.subarray(0, 6).toString() === 'GIF89a')) return '.gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return '.webp'
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString() === 'BM') return '.bmp'
  const match = String(contentType).toLowerCase().match(/image\/(png|jpeg|jpg|gif|webp|bmp)/)
  return match ? `.${match[1] === 'jpeg' ? 'jpg' : match[1]}` : null
}

function imageUrls(gift) {
  const values = [
    ...(Array.isArray(gift?.image?.url_list) ? gift.image.url_list : []),
    ...(Array.isArray(gift?.icon?.url_list) ? gift.icon.url_list : []),
    ...(Array.isArray(gift?.webp_image?.url_list) ? gift.webp_image.url_list : [])
  ]
  return [...new Set(values.map(normalizeUrl).filter(Boolean))]
}

function firstImageUri(gift, urls) {
  return imageUri(gift?.image?.uri || gift?.icon?.uri || gift?.webp_image?.uri || urls[0])
}

function fileKey(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function insideAssetDir(file) {
  const resolved = path.resolve(assetDir, String(file || ''))
  const prefix = `${path.resolve(assetDir)}${path.sep}`
  return resolved.startsWith(prefix) ? resolved : null
}

async function digestFile(filePath) {
  const buffer = await fs.readFile(filePath)
  return { bytes: buffer.length, sha256: sha256(buffer) }
}

async function fetchImage(urls) {
  const failures = []
  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          referer: 'https://live.douyin.com/'
        }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const extension = imageExtension(buffer, response.headers.get('content-type') || '')
      if (!extension) throw new Error('响应不是可识别的图片')
      return { buffer, extension, url }
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(failures.join(' | '))
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

async function cleanupTemporaryFiles() {
  for (const file of temporaryFiles) await fs.unlink(file).catch(() => {})
  temporaryFiles.clear()
}

function sourceKinds(record) {
  const values = Array.isArray(record?.sourceKinds)
    ? record.sourceKinds
    : [record?.sourceKind || (record?.current ? 'douyin-live' : 'community-history')]
  return uniqueStrings(values)
}

async function readCatalog() {
  try {
    return JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { schema: 2, images: [], captures: [] }
    throw error
  }
}

function oldSource(catalog) {
  if (catalog?.source && typeof catalog.source === 'object') return catalog.source
  if (Array.isArray(catalog?.sources)) {
    return catalog.sources.find((source) => source?.kind === 'community-history') || catalog.sources[0] || null
  }
  return null
}

function oldImages(catalog) {
  return Array.isArray(catalog?.images) ? catalog.images : []
}

function makeCurrentGifts(response) {
  const pages = Array.isArray(response?.data?.pages) ? response.data.pages : []
  const byId = new Map()
  let order = 0
  for (const page of pages) {
    const pageName = String(page?.page_name || '').trim() || `页面 ${page?.page_type ?? ''}`
    for (const gift of Array.isArray(page?.gifts) ? page.gifts : []) {
      const id = String(gift?.id ?? '').trim()
      const name = String(gift?.name || '').trim()
      const urls = imageUrls(gift)
      const uri = firstImageUri(gift, urls)
      if (!id || !name || !uri || !urls.length) continue
      const previous = byId.get(id)
      if (previous) {
        previous.pages = uniqueStrings([...previous.pages, pageName])
        continue
      }
      byId.set(id, {
        id,
        name,
        uri,
        urls,
        diamondCount: Number.isFinite(Number(gift.diamond_count)) ? Number(gift.diamond_count) : 0,
        type: Number.isFinite(Number(gift.type)) ? Number(gift.type) : 0,
        pages: [pageName],
        order: order++
      })
    }
  }

  const groups = new Map()
  for (const gift of byId.values()) {
    const keyValue = pairKey(gift.name, gift.uri)
    let group = groups.get(keyValue)
    if (!group) {
      group = { name: gift.name, uri: gift.uri, urls: [], gifts: [], order: gift.order }
      groups.set(keyValue, group)
    }
    group.urls = uniqueStrings([...group.urls, ...gift.urls])
    group.gifts.push({
      id: gift.id,
      diamondCount: gift.diamondCount,
      type: gift.type,
      pages: gift.pages
    })
    group.order = Math.min(group.order, gift.order)
  }
  return { gifts: byId, groups: [...groups.values()] }
}

async function scanAssets() {
  const assets = new Map()
  const entries = await fs.readdir(assetDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(png|webp|jpg|jpeg|gif|bmp)$/i.test(entry.name)) continue
    const filePath = path.join(assetDir, entry.name)
    const meta = await digestFile(filePath)
    assets.set(entry.name, { file: entry.name, ...meta })
  }
  return assets
}

async function main() {
  const raw = await fs.readFile(responsePath, 'utf8')
  const response = JSON.parse(raw)
  if (Number(response?.status_code) !== 0) throw new Error(`抖音礼物接口返回异常：${response?.status_code ?? '未知状态'}`)
  if (!Array.isArray(response?.data?.pages)) throw new Error('响应缺少 data.pages，拒绝生成不完整内置清单')

  const current = makeCurrentGifts(response)
  if (current.gifts.size < 100) throw new Error(`当前礼物清单只有 ${current.gifts.size} 个 ID，疑似接口响应不完整`)

  await fs.mkdir(assetDir, { recursive: true })
  const catalog = await readCatalog()
  const previousRecords = oldImages(catalog)
  const assets = await scanAssets()
  const metaCache = new Map()
  const getMeta = async (file) => {
    if (!file) return null
    if (!metaCache.has(file)) {
      const filePath = insideAssetDir(file)
      metaCache.set(file, filePath && assets.has(file) ? assets.get(file) : null)
    }
    return metaCache.get(file)
  }

  const recordsByPair = new Map()
  const uriAssets = new Map()
  const oldOrder = new Map()
  previousRecords.forEach((rawRecord, index) => {
    const name = String(rawRecord?.name || '').trim()
    const file = String(rawRecord?.file || '').trim()
    const uri = String(rawRecord?.uri || imageUri(rawRecord?.url)).trim()
    if (!name || !file || !uri || !insideAssetDir(file)) return
    const record = {
      ...rawRecord,
      name,
      uri,
      sourceKinds: sourceKinds(rawRecord),
      current: false,
      urls: uniqueStrings([...(Array.isArray(rawRecord?.urls) ? rawRecord.urls : []), rawRecord?.url])
    }
    const pair = pairKey(name, uri)
    const previous = recordsByPair.get(pair)
    if (previous) {
      previous.urls = uniqueStrings([...previous.urls, ...record.urls])
      previous.sourceKinds = uniqueStrings([...previous.sourceKinds, ...record.sourceKinds])
      previous.giftIds = uniqueStrings([...(previous.giftIds || []), ...(record.giftIds || [])])
      return
    }
    recordsByPair.set(pair, record)
    oldOrder.set(pair, index)
    const meta = assets.get(file)
    if (meta && !uriAssets.has(uri)) uriAssets.set(uri, meta)
  })

  const digestAssets = new Map()
  for (const asset of assets.values()) {
    if (!digestAssets.has(`${asset.bytes}:${asset.sha256}`)) digestAssets.set(`${asset.bytes}:${asset.sha256}`, asset)
  }
  const usedFiles = new Set([...assets.keys()].map(fileKey))
  const currentUriAssets = new Map()
  const uriGroups = new Map()
  for (const group of current.groups) {
    if (!uriGroups.has(group.uri)) uriGroups.set(group.uri, group)
  }

  const pending = [...uriGroups.entries()]
  let completed = 0
  const failures = []
  const downloadWorker = async () => {
    while (pending.length) {
      const [uri, group] = pending.pop()
      try {
        let asset = uriAssets.get(uri)
        if (!asset || !assets.has(asset.file)) {
          const fetched = await fetchImage(group.urls)
          const meta = { bytes: fetched.buffer.length, sha256: sha256(fetched.buffer) }
          asset = digestAssets.get(`${meta.bytes}:${meta.sha256}`)
          if (!asset) {
            const base = safeStem(group.name)
            let file = `${base}${fetched.extension}`
            let suffix = 0
            while (usedFiles.has(fileKey(file))) {
              suffix++
              file = suffix === 1
                ? `${base}__dy${group.gifts[0]?.id || shortHash(uri)}${fetched.extension}`
                : `${base}__${shortHash(`${uri}:${suffix}`)}${fetched.extension}`
            }
            // Reserve the name before the first filesystem await; concurrent workers
            // can otherwise choose the same Windows filename for two image URIs.
            usedFiles.add(fileKey(file))
            const temp = path.join(assetDir, `${file}.${process.pid}.${shortHash(uri)}.part`)
            temporaryFiles.add(temp)
            await fs.writeFile(temp, fetched.buffer)
            await fs.rename(temp, path.join(assetDir, file))
            temporaryFiles.delete(temp)
            asset = { file, ...meta }
            assets.set(file, asset)
            digestAssets.set(`${meta.bytes}:${meta.sha256}`, asset)
          }
        }
        currentUriAssets.set(uri, asset)
        completed++
        if (completed % 50 === 0 || completed === uriGroups.size) console.log(`当前礼物图 ${completed}/${uriGroups.size}`)
      } catch (error) {
        failures.push({ uri, name: group.name, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, downloadWorker))
  if (failures.length) {
    console.error(`有 ${failures.length} 个当前礼物图片 URI 下载失败`)
    for (const failure of failures.slice(0, 30)) console.error(`${failure.name}\t${failure.uri}\t${failure.error}`)
    if (failures.length > 30) console.error(`另有 ${failures.length - 30} 个失败未展开`)
    await cleanupTemporaryFiles()
    process.exitCode = 1
    return
  }

  for (const group of current.groups) {
    const asset = currentUriAssets.get(group.uri) || uriAssets.get(group.uri)
    if (!asset) throw new Error(`当前礼物缺少本地图片：${group.name} (${group.uri})`)
    const pair = pairKey(group.name, group.uri)
    const existing = recordsByPair.get(pair)
    const record = existing || {
      name: group.name,
      uri: group.uri,
      file: asset.file,
      sourceKinds: [],
      urls: [],
      current: false
    }
    record.name = group.name
    record.uri = group.uri
    record.url = group.urls[0]
    record.urls = uniqueStrings([...group.urls, ...(record.urls || [])])
    record.file = asset.file
    record.bytes = asset.bytes
    record.sha256 = asset.sha256
    record.current = true
    record.sourceKinds = uniqueStrings([...(record.sourceKinds || []), 'douyin-live'])
    record.giftIds = uniqueStrings(group.gifts.map((gift) => gift.id))
    record.giftMeta = group.gifts
    record.pages = uniqueStrings(group.gifts.flatMap((gift) => gift.pages || []))
    record._captureOrder = group.order
    recordsByPair.set(pair, record)
  }

  const records = [...recordsByPair.values()]
  const byName = new Map()
  for (const record of records) {
    const nameKey = key(record.name)
    if (!byName.has(nameKey)) byName.set(nameKey, [])
    byName.get(nameKey).push(record)
  }
  for (const [nameKey, group] of byName) {
    group.sort((a, b) => {
      if (Boolean(a.current) !== Boolean(b.current)) return a.current ? -1 : 1
      const aOrder = a.current ? Number(a._captureOrder ?? Number.MAX_SAFE_INTEGER) : Number(oldOrder.get(pairKey(a.name, a.uri)) ?? Number.MAX_SAFE_INTEGER)
      const bOrder = b.current ? Number(b._captureOrder ?? Number.MAX_SAFE_INTEGER) : Number(oldOrder.get(pairKey(b.name, b.uri)) ?? Number.MAX_SAFE_INTEGER)
      return aOrder - bOrder || String(a.uri).localeCompare(String(b.uri))
    })
    const displayName = group[0]?.name || nameKey
    let currentVariant = 0
    let historyVariant = 0
    group.forEach((record, index) => {
      const isCurrent = Boolean(record.current)
      const variantNumber = isCurrent ? ++currentVariant : ++historyVariant
      record.name = displayName
      record.variant = index
      record.canonical = index === 0
      record.label = index === 0
        ? displayName
        : `${displayName} · 图变体 ${variantNumber}${isCurrent ? '（当前）' : '（历史）'}`
      delete record._captureOrder
    })
  }
  records.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN') || Number(a.variant || 0) - Number(b.variant || 0) || String(a.file).localeCompare(String(b.file)))

  const captureTime = Number(response?.extra?.now) > 0 ? new Date(Number(response.extra.now)).toISOString() : new Date().toISOString()
  const capture = {
    kind: 'douyin-live-gift-list',
    endpoint: 'https://live.douyin.com/webcast/gift/list/',
    capturedAt: captureTime,
    importedAt: new Date().toISOString(),
    responseSha256: sha256(Buffer.from(raw, 'utf8')),
    roomId,
    roomUrl,
    pageCount: response.data.pages.length,
    pageSummary: response.data.pages.map((page) => ({ pageType: page.page_type, pageName: page.page_name, giftCount: Array.isArray(page.gifts) ? page.gifts.length : 0 })),
    recordCount: response.data.pages.reduce((count, page) => count + (Array.isArray(page.gifts) ? page.gifts.length : 0), 0),
    uniqueGiftIdCount: current.gifts.size,
    uniqueNameCount: new Set([...current.gifts.values()].map((gift) => key(gift.name))).size,
    uniqueNameImageCount: current.groups.length,
    uniqueImageCount: uriGroups.size
  }
  const captures = Array.isArray(catalog?.captures) ? [...catalog.captures] : []
  if (!captures.some((item) => item?.responseSha256 === capture.responseSha256)) captures.push(capture)
  const history = oldSource(catalog) || {
    kind: 'community-history',
    url: 'https://raw.githubusercontent.com/weMakee/douyinGift/main/gift.json'
  }
  const result = {
    schema: 2,
    generatedAt: new Date().toISOString(),
    source: history,
    currentSource: capture,
    captures,
    summary: {
      currentGiftIdCount: current.gifts.size,
      currentNameCount: capture.uniqueNameCount,
      currentNameImageCount: current.groups.length,
      currentImageCount: uriGroups.size,
      catalogImageRecordCount: records.length,
      catalogFileCount: new Set(records.map((record) => record.file)).size,
      diskImageCount: assets.size
    },
    images: records
  }
  await fs.writeFile(catalogPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`完成：当前 ${capture.uniqueGiftIdCount} 个礼物 ID，${capture.uniqueNameCount} 个礼物名，${capture.uniqueImageCount} 张当前图片；内置清单 ${records.length} 条、${result.summary.catalogFileCount} 个资源文件`)
  console.log(`响应 SHA256：${capture.responseSha256}`)
}

main().catch((error) => {
  void cleanupTemporaryFiles()
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
