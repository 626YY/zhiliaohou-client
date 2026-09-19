import crypto from 'node:crypto'
import dns from 'node:dns'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'gift-assets', 'douyin')
const defaultSource = 'https://raw.githubusercontent.com/weMakee/douyinGift/main/gift.json'
const sourceArg = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length)
const source = sourceArg || defaultSource

// 部分 Windows 网络环境优先返回不可达的 IPv6 地址，导致 raw.githubusercontent.com 被重置。
dns.setDefaultResultOrder('ipv4first')

function key(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}

function safeStem(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  const stem = normalized.replace(/[. ]+$/g, '').slice(0, 80)
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) return '礼物'
  return stem
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function shortHash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)
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

async function readSource() {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { headers: { accept: 'application/json', 'user-agent': 'ZhiliaohouGiftSync/1.0' } })
    if (!response.ok) throw new Error(`礼物清单下载失败：HTTP ${response.status}`)
    return await response.text()
  }
  return await fs.readFile(path.resolve(source), 'utf8')
}

async function fetchImage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'user-agent': 'ZhiliaohouGiftSync/1.0' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const extension = imageExtension(buffer, response.headers.get('content-type') || '')
    if (!extension) throw new Error('响应不是可识别的图片')
    return { buffer, extension }
  } finally {
    clearTimeout(timer)
  }
}

function uniqueRows(rows) {
  const byPair = new Map()
  for (const item of Array.isArray(rows) ? rows : []) {
    const name = String(item?.name || '').trim()
    const url = String(item?.url || '').trim().replace(/^http:\/\//i, 'https://')
    if (!name || !/^https?:\/\//i.test(url)) continue
    byPair.set(`${key(name)}\u0000${url}`, { name, url })
  }
  return [...byPair.values()]
}

function buildCatalog(rows, fileByUrl, metaByUrl) {
  const groups = new Map()
  for (const row of rows) {
    const groupKey = key(row.name)
    if (!groups.has(groupKey)) groups.set(groupKey, { name: row.name, urls: [] })
    const group = groups.get(groupKey)
    if (!group.urls.includes(row.url)) group.urls.push(row.url)
  }

  const canonicalByName = new Map()
  for (const group of groups.values()) canonicalByName.set(key(group.name), group.urls[group.urls.length - 1])

  const images = []
  for (const group of groups.values()) {
    const canonical = canonicalByName.get(key(group.name))
    const ordered = [canonical, ...group.urls.filter((url) => url !== canonical)]
    ordered.forEach((url, index) => {
      const file = fileByUrl.get(url)
      const meta = metaByUrl.get(url)
      if (!file) throw new Error(`缺少图片文件映射：${url}`)
      if (!meta) throw new Error(`缺少图片校验信息：${url}`)
      images.push({
        name: group.name,
        label: index === 0 ? group.name : `${group.name} · 图变体 ${index + 1}`,
        variant: index,
        canonical: index === 0,
        url,
        file,
        bytes: meta.bytes,
        sha256: meta.sha256
      })
    })
  }

  images.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.variant - b.variant || a.file.localeCompare(b.file))
  return images
}

async function main() {
  const raw = await readSource()
  const parsed = JSON.parse(raw)
  const originalRows = Array.isArray(parsed) ? parsed : []
  const rows = uniqueRows(originalRows)
  const urlNames = new Map()
  for (const row of rows) {
    if (!urlNames.has(row.url)) urlNames.set(row.url, [])
    urlNames.get(row.url).push(row.name)
  }

  await fs.mkdir(outputDir, { recursive: true })
  const fileByUrl = new Map()
  const usedNames = new Set()
  const fileNameKey = (value) => String(value).normalize('NFKC').toLocaleLowerCase('zh-CN')
  for (const [url, names] of urlNames) {
    const preferred = names[names.length - 1] || '礼物'
    const stem = safeStem(preferred)
    let file = `${stem}.png`
    if (usedNames.has(fileNameKey(file))) file = `${stem}__${shortHash(url)}.png`
    while (usedNames.has(fileNameKey(file))) file = `${stem}__${shortHash(`${url}:${file}`)}.png`
    usedNames.add(fileNameKey(file))
    fileByUrl.set(url, file)
  }

  const downloads = [...fileByUrl.entries()]
  const metaByUrl = new Map()
  let completed = 0
  const failures = []
  const worker = async () => {
    while (downloads.length) {
      const [url, file] = downloads.pop()
      try {
        const { buffer, extension } = await fetchImage(url)
        const finalFile = file.replace(/\.png$/i, extension)
        if (finalFile !== file) fileByUrl.set(url, finalFile)
        metaByUrl.set(url, { bytes: buffer.length, sha256: sha256(buffer) })
        const temp = path.join(outputDir, `${finalFile}.${process.pid}.part`)
        await fs.writeFile(temp, buffer)
        await fs.rename(temp, path.join(outputDir, finalFile))
        completed++
        if (completed % 25 === 0 || completed === urlNames.size) console.log(`已下载 ${completed}/${urlNames.size}`)
      } catch (error) {
        failures.push({ url, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker))
  if (failures.length) {
    console.error(`有 ${failures.length} 张礼物图下载失败`)
    for (const failure of failures) console.error(`${failure.url}\t${failure.error}`)
    process.exitCode = 1
    return
  }

  const images = buildCatalog(rows, fileByUrl, metaByUrl)
  const catalog = {
    schema: 1,
    source: {
      url: source,
      fetchedAt: new Date().toISOString(),
      sha256: sha256(Buffer.from(raw, 'utf8')),
      rowCount: originalRows.length,
      uniqueNameCount: new Set(rows.map((row) => key(row.name))).size,
      uniquePairCount: rows.length,
      uniqueImageCount: urlNames.size
    },
    images
  }
  await fs.writeFile(path.join(outputDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  console.log(`完成：${catalog.source.rowCount} 条记录，${catalog.source.uniqueNameCount} 个礼物名，${catalog.source.uniqueImageCount} 张不同图片，${images.length} 个名称/图片记录`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
