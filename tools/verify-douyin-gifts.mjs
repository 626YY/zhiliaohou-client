import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetDir = path.join(root, 'gift-assets', 'douyin')
const catalogPath = path.join(assetDir, 'catalog.json')

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function insideAssetDir(file) {
  const target = path.resolve(assetDir, file)
  return target.startsWith(`${path.resolve(assetDir)}${path.sep}`) ? target : null
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  if (![1, 2].includes(catalog?.schema) || !Array.isArray(catalog.images)) throw new Error('礼物图 catalog.json 格式无效')

  const byPair = new Map()
  const byFile = new Map()
  const byUri = new Map()
  for (const image of catalog.images) {
    if (!image?.name || !image?.url || !image?.file || !image?.sha256 || !Number.isFinite(image?.bytes)) {
      throw new Error('礼物图清单存在不完整记录')
    }
    const uri = String(image.uri || image.url).trim()
    const pair = `${String(image.name).normalize('NFKC').trim().toLocaleLowerCase('zh-CN')}\u0000${uri}`
    const previousPair = byPair.get(pair)
    if (previousPair && (previousPair.file !== image.file || previousPair.sha256 !== image.sha256)) {
      throw new Error(`同一礼物名/图片 URI 指向不一致文件：${image.name}`)
    }
    byPair.set(pair, image)
    const previousFile = byFile.get(image.file)
    if (previousFile && (previousFile.sha256 !== image.sha256 || previousFile.bytes !== image.bytes)) {
      throw new Error(`同一文件名对应多个图片内容：${image.file}`)
    }
    byFile.set(image.file, image)
    const previousUri = byUri.get(uri)
    if (previousUri && (previousUri.file !== image.file || previousUri.sha256 !== image.sha256)) {
      throw new Error(`同一图片 URI 指向不一致文件：${uri}`)
    }
    byUri.set(uri, image)
  }

  const seenFiles = new Set()
  for (const image of byFile.values()) {
    const filePath = insideAssetDir(image.file)
    if (!filePath) throw new Error(`清单文件越出资源目录：${image.file}`)
    const fileKey = image.file.normalize('NFKC').toLocaleLowerCase('zh-CN')
    if (seenFiles.has(fileKey)) throw new Error(`Windows 文件名冲突：${image.file}`)
    seenFiles.add(fileKey)
    const buffer = await fs.readFile(filePath)
    if (buffer.length !== image.bytes) throw new Error(`图片大小不符：${image.file}`)
    if (digest(buffer) !== image.sha256) throw new Error(`图片哈希不符：${image.file}`)
  }

  const source = catalog.source || {}
  if (catalog.schema === 1 && source.uniqueImageCount !== byUri.size) {
    throw new Error(`清单数量不符：声明 ${source.uniqueImageCount}，实际 ${byUri.size}`)
  }
  if (catalog.schema === 2) {
    const currentSource = catalog.currentSource || {}
    const current = catalog.images.filter((image) => image.current === true)
    const currentIds = new Set(current.flatMap((image) => Array.isArray(image.giftIds) ? image.giftIds : []))
    const currentNames = new Set(current.map((image) => String(image.name).normalize('NFKC').trim().toLocaleLowerCase('zh-CN')))
    const currentUris = new Set(current.map((image) => String(image.uri || image.url)))
    if (currentSource.uniqueGiftIdCount !== currentIds.size) throw new Error(`当前礼物 ID 数量不符：声明 ${currentSource.uniqueGiftIdCount}，实际 ${currentIds.size}`)
    if (currentSource.uniqueNameCount !== currentNames.size) throw new Error(`当前礼物名数量不符：声明 ${currentSource.uniqueNameCount}，实际 ${currentNames.size}`)
    if (currentSource.uniqueNameImageCount !== current.length) throw new Error(`当前礼物名/图片记录数量不符：声明 ${currentSource.uniqueNameImageCount}，实际 ${current.length}`)
    if (currentSource.uniqueImageCount !== currentUris.size) throw new Error(`当前图片 URI 数量不符：声明 ${currentSource.uniqueImageCount}，实际 ${currentUris.size}`)
    if (catalog.summary?.catalogImageRecordCount !== catalog.images.length) throw new Error('summary.catalogImageRecordCount 与清单不符')
    if (catalog.summary?.catalogFileCount !== byFile.size) throw new Error('summary.catalogFileCount 与清单不符')
  }
  console.log(`礼物图校验通过：${source.rowCount || '-'} 条历史源记录，${catalog.currentSource?.uniqueGiftIdCount || '-'} 个当前礼物 ID，${catalog.currentSource?.uniqueNameCount || source.uniqueNameCount || '-'} 个礼物名，${byUri.size} 张不同图片，${catalog.images.length} 个名称/图片记录`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
