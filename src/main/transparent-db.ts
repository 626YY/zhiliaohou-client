import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import JSZip from 'jszip'
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import type {
  TransparentColorRecord,
  TransparentDbImportResult,
  TransparentGiftPlatform,
  TransparentGiftRecord,
  TransparentGiftVersion,
  TransparentMenuProgram
} from '@shared/types'

const MAX_SOURCE_BYTES = 128 * 1024 * 1024
const MAX_ROWS = 10_000
const PLATFORMS: TransparentGiftPlatform[] = ['dy', 'ks', 'bz', 'sph', 'tk']

let sqlPromise: Promise<SqlJsStatic> | null = null

function sql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => app.isPackaged
        ? path.join(process.resourcesPath, 'sql.js', file)
        : path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file)
    })
  }
  return sqlPromise
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function number(value: unknown): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function lowerObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toLocaleLowerCase('en-US'), item]))
}

function first(value: Record<string, unknown>, ...keys: string[]): unknown {
  const lower = lowerObject(value)
  for (const key of keys) {
    const item = lower[key.toLocaleLowerCase('en-US')]
    if (item != null && item !== '') return item
  }
  return undefined
}

function platform(value: unknown): TransparentGiftPlatform {
  const key = text(value).toLocaleLowerCase('en-US').replace(/[_\s-]/g, '')
  const aliases: Record<string, TransparentGiftPlatform> = {
    dy: 'dy', douyin: 'dy', 抖音: 'dy',
    ks: 'ks', kuaishou: 'ks', 快手: 'ks',
    bz: 'bz', bili: 'bz', bilibili: 'bz', 哔哩哔哩: 'bz',
    sph: 'sph', shipinhao: 'sph', 视频号: 'sph',
    tk: 'tk', tiktok: 'tk'
  }
  return aliases[key] || 'dy'
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Buffer.isBuffer(value)
}

function utf8(value: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/^\uFEFF/, '').trim()
  } catch {
    return ''
  }
}

function parseJson(value: string): unknown {
  const input = value.trim()
  if (!input || (!input.startsWith('{') && !input.startsWith('[') && !input.startsWith('"'))) return undefined
  try {
    const parsed = JSON.parse(input)
    if (typeof parsed === 'string' && parsed !== input) return parseJson(parsed) ?? parsed
    return parsed
  } catch {
    return undefined
  }
}

function imageExtension(bytes: Uint8Array): string {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(bytes.subarray(0, 6)).toString('ascii'))) return 'gif'
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'webp'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp'
  return ''
}

function safeName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || 'gift'
}

function saveImportedImage(bytes: Uint8Array, name: string, sourceKey: string): string {
  const ext = imageExtension(bytes)
  if (!ext) return ''
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const dir = path.join(app.getPath('userData'), 'data', 'transparent-import-assets', sourceKey)
  fs.mkdirSync(dir, { recursive: true })
  const output = path.join(dir, `${safeName(name)}-${hash}.${ext}`)
  if (!fs.existsSync(output)) fs.writeFileSync(output, bytes)
  return output
}

function imageFromObject(value: unknown): string {
  const item = object(value)
  if (!item) return ''
  const candidate = first(item, 'imagePath', 'imagepath', 'img', 'image', 'imageUrl', 'imageurl', 'image_url', 'icon', 'url', 'path')
  if (typeof candidate === 'string') return candidate.trim()
  const nested = object(candidate)
  if (!nested) return ''
  return text(first(nested, 'url', 'src', 'path'))
}

interface DecodedBlob {
  text: string
  base64?: string
  json?: unknown
  imagePath?: string
}

function decodeOpaque(value: unknown): { text: string; base64?: string } {
  if (isBytes(value)) {
    const bytes = new Uint8Array(value)
    return {
      text: utf8(bytes),
      base64: Buffer.from(bytes).toString('base64')
    }
  }
  return { text: text(value) }
}

function decodeBlob(value: unknown, giftName: string, sourceKey: string): DecodedBlob {
  if (isBytes(value)) {
    const bytes = new Uint8Array(value)
    const imagePath = saveImportedImage(bytes, giftName, sourceKey)
    const decoded = utf8(bytes)
    return {
      text: imagePath ? '' : decoded,
      base64: Buffer.from(bytes).toString('base64'),
      json: decoded ? parseJson(decoded) : undefined,
      imagePath: imagePath || undefined
    }
  }
  const decoded = text(value)
  return { text: decoded, json: parseJson(decoded) }
}

function giftRecord(value: unknown, index: number, sourceKey: string): TransparentGiftRecord | null {
  const item = object(value)
  if (!item) return null
  const name = text(first(item, 'name', 'giftName', 'gift_name')).trim()
  if (!name) return null
  const rawData = first(item, 'giftDataBase64') != null
    ? undefined
    : first(item, 'giftdata', 'giftData', 'giftByte', 'giftbyte')
  const decoded = decodeBlob(rawData, name, sourceKey)
  const dataObject = object(decoded.json)
  const explicitBase64 = text(first(item, 'giftDataBase64', 'giftdatabase64'))
  const explicitImage = text(first(item, 'imagePath', 'imagepath', 'img', 'image', 'imageUrl', 'imageurl'))
  const imagePath = explicitImage || decoded.imagePath || imageFromObject(dataObject) || ''
  const rawId = text(first(item, 'id'))
  const stable = crypto.createHash('sha1').update(`${sourceKey}|${rawId}|${name}|${index}`).digest('hex').slice(0, 14)
  return {
    id: rawId ? `sqlite-${sourceKey}-${rawId}` : `sqlite-${stable}`,
    platform: platform(first(item, 'platform')),
    name,
    giftId: text(first(item, 'giftid', 'giftId', 'gift_id', 'idstr')),
    diamondCount: Math.max(0, number(first(item, 'diamondcount', 'diamondCount', 'diamond_count', 'coins', 'score'))),
    giftData: decoded.text,
    giftDataBase64: explicitBase64 || decoded.base64 || undefined,
    imagePath,
    imageName: text(first(item, 'imageName', 'imagename')) || (imagePath ? imagePath.split(/[\\/]/).pop() || name : '')
  }
}

function tableNames(db: Database): Set<string> {
  const names = new Set<string>()
  const statement = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
  try {
    while (statement.step()) names.add(text(statement.getAsObject().name).toLocaleLowerCase('en-US'))
  } finally {
    statement.free()
  }
  return names
}

function rows(db: Database, table: string): Record<string, SqlValue>[] {
  const result: Record<string, SqlValue>[] = []
  const statement = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ${MAX_ROWS}`)
  try {
    while (statement.step()) result.push(statement.getAsObject())
  } finally {
    statement.free()
  }
  return result
}

function arrayFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return arrayFrom(parseJson(value))
  const item = object(value)
  if (!item) return []
  const candidate = first(item, 'listPro', 'listpro', 'gifts', 'giftlist', 'items', 'list', 'giftpro')
  if (candidate === value) return []
  return arrayFrom(candidate)
}

function menuProgram(row: Record<string, unknown>, index: number, sourceKey: string): TransparentMenuProgram {
  const name = text(first(row, 'program_name', 'programName', 'name')) || `菜单方案${index + 1}`
  const rawBlob = first(row, 'giftpro', 'giftPro', 'data')
  const decoded = decodeBlob(rawBlob, name, sourceKey)
  const payload = decoded.json ?? rawBlob
  const payloadObject = object(payload)
  const title = text(payloadObject ? first(payloadObject, 'program', 'title', 'subject', 'program_name', 'programName') : '') || name
  const list = arrayFrom(payload)
    .map((entry, itemIndex) => giftRecord(entry, itemIndex, sourceKey))
    .filter((entry): entry is TransparentGiftRecord => !!entry)
  return { name, program: title, listPro: list, giftProBase64: decoded.base64 }
}

function giftVersion(row: Record<string, unknown>): TransparentGiftVersion | null {
  const name = text(first(row, 'name', 'platform')).trim()
  if (!name) return null
  return {
    name,
    version: Math.max(0, Math.trunc(number(first(row, 'ver', 'version'))))
  }
}

function colorRecord(row: Record<string, unknown>): TransparentColorRecord | null {
  const name = text(first(row, 'color_name', 'colorName', 'name')).trim()
  if (!name) return null
  const decoded = decodeOpaque(first(row, 'colorv', 'colorValue', 'value'))
  return {
    name,
    value: decoded.text,
    valueBase64: decoded.base64
  }
}

function baseProgram(row: Record<string, unknown>, index: number): { name: string; cfg: Record<string, unknown> } {
  const name = text(first(row, 'program_name', 'programName', 'name')) || `方案${index + 1}`
  return {
    name,
    cfg: {
      text: text(first(row, 'looogtxt', 'text')),
      font: text(first(row, 'font_str', 'fontStr')) || '微软雅黑',
      fontSize: number(first(row, 'font_size', 'fontSize')) || 50,
      color: text(first(row, 'colorstr', 'color')) || '#ffffff',
      strokeColor: text(first(row, 'strok_color', 'strokColor')) || '#000000',
      spacing: number(first(row, 'spacing_size', 'spacingSize')),
      scale: text(first(row, 'scale')) || '1080x1920(竖)',
      scrollDir: text(first(row, 'isrolling')) ? 'up' : 'none',
      imgPath: text(first(row, 'imgdir'))
    }
  }
}

interface ParsedDatabases {
  gifts: TransparentGiftRecord[]
  textPrograms: TransparentMenuProgram[]
  imagePrograms: TransparentMenuProgram[]
  programs: { name: string; cfg: Record<string, unknown> }[]
  giftVersions: TransparentGiftVersion[]
  colors: TransparentColorRecord[]
  recognized: number
}

async function parseDatabases(databases: { name: string; bytes: Uint8Array }[], sourceKey: string): Promise<ParsedDatabases> {
  const SQL = await sql()
  const output: ParsedDatabases = {
    gifts: [], textPrograms: [], imagePrograms: [], programs: [], giftVersions: [], colors: [], recognized: 0
  }
  for (const source of databases) {
    const db = new SQL.Database(source.bytes)
    try {
      const tables = tableNames(db)
      if (tables.has('giftlist')) {
        output.recognized++
        const imported = rows(db, 'giftlist')
          .map((row, index) => giftRecord(row, index, sourceKey))
          .filter((item): item is TransparentGiftRecord => !!item)
        output.gifts.push(...imported)
      }
      if (tables.has('programlist')) {
        output.recognized++
        output.textPrograms.push(...rows(db, 'programlist').map((row, index) => menuProgram(row, index, sourceKey)))
      }
      if (tables.has('programlistimg')) {
        output.recognized++
        output.imagePrograms.push(...rows(db, 'programlistimg').map((row, index) => menuProgram(row, index, sourceKey)))
      }
      if (tables.has('baseinfo')) {
        output.recognized++
        output.programs.push(...rows(db, 'baseinfo').map(baseProgram))
      }
      if (tables.has('giftver')) {
        output.recognized++
        output.giftVersions.push(...rows(db, 'giftver').map(giftVersion).filter((item): item is TransparentGiftVersion => !!item))
      }
      if (tables.has('colorlist')) {
        output.recognized++
        output.colors.push(...rows(db, 'colorlist').map(colorRecord).filter((item): item is TransparentColorRecord => !!item))
      }
    } finally {
      db.close()
    }
  }

  const programGifts = [...output.textPrograms, ...output.imagePrograms].flatMap((program) => program.listPro)
  const seen = new Set(output.gifts.map((gift) => `${gift.platform}\u0000${gift.name}\u0000${gift.giftId}`))
  for (const gift of programGifts) {
    const key = `${gift.platform}\u0000${gift.name}\u0000${gift.giftId}`
    if (!seen.has(key)) {
      seen.add(key)
      output.gifts.push(gift)
    }
  }
  return output
}

async function sourceDatabases(filePath: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw new Error('数据库文件无效或超过 128 MB')
  const ext = path.extname(filePath).toLocaleLowerCase('en-US')
  if (ext === '.zip') {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath))
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && /(?:^|\/)(?:gf|config)\.db$/i.test(entry.name))
    if (!entries.length) throw new Error('压缩包中没有 gf.db 或 config.db')
    const result: { name: string; bytes: Uint8Array }[] = []
    for (const entry of entries) {
      const bytes = await entry.async('uint8array')
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`${entry.name} 超过 128 MB`)
      result.push({ name: entry.name, bytes })
    }
    return result
  }

  const paths = [filePath]
  const fileName = path.basename(filePath).toLocaleLowerCase('en-US')
  const sibling = fileName === 'gf.db'
    ? path.join(path.dirname(filePath), 'config.db')
    : fileName === 'config.db' ? path.join(path.dirname(filePath), 'gf.db') : ''
  if (sibling && fs.existsSync(sibling)) paths.push(sibling)
  return paths.map((item) => ({ name: path.basename(item), bytes: new Uint8Array(fs.readFileSync(item)) }))
}

export async function importTransparentDatabase(filePathValue: string): Promise<TransparentDbImportResult> {
  try {
    const filePath = path.resolve(String(filePathValue || ''))
    if (!filePathValue || !fs.existsSync(filePath)) return { ok: false, error: '请选择存在的 gf.db、config.db 或导出压缩包' }
    const sourceKey = crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 12)
    const parsed = await parseDatabases(await sourceDatabases(filePath), sourceKey)
    if (!parsed.recognized) return { ok: false, error: '没有识别到 giftlist、programlist、programlistimg 或 baseinfo 表' }
    const warnings: string[] = []
    if (!parsed.gifts.length) warnings.push('数据库中的礼物表为空；没有生成虚假的礼物记录。')
    return {
      ok: true,
      gifts: parsed.gifts,
      textPrograms: parsed.textPrograms,
      imagePrograms: parsed.imagePrograms,
      programs: parsed.programs,
      giftVersions: parsed.giftVersions,
      colors: parsed.colors,
      source: filePath,
      warnings
    }
  } catch (error) {
    return { ok: false, error: `导入透明图数据库失败：${(error as Error).message}` }
  }
}

function normalizedGift(value: unknown, index: number): TransparentGiftRecord | null {
  return giftRecord(value, index, 'export')
}

function blobForGift(gift: TransparentGiftRecord): Uint8Array | null {
  if (gift.giftDataBase64) {
    try { return new Uint8Array(Buffer.from(gift.giftDataBase64, 'base64')) } catch { /* use fallback */ }
  }
  if (gift.giftData) return new Uint8Array(Buffer.from(gift.giftData, 'utf8'))
  if (gift.imagePath && !/^(?:https?:|data:|file:)/i.test(gift.imagePath) && fs.existsSync(gift.imagePath)) {
    const data = fs.readFileSync(gift.imagePath)
    if (data.length <= 16 * 1024 * 1024) return new Uint8Array(data)
  }
  return null
}

function portableGift(gift: TransparentGiftRecord): Record<string, unknown> {
  return {
    id: gift.id,
    platform: gift.platform,
    name: gift.name,
    giftid: gift.giftId,
    giftId: gift.giftId,
    diamondcount: gift.diamondCount,
    diamondCount: gift.diamondCount,
    giftdata: gift.giftData,
    giftData: gift.giftData,
    giftDataBase64: gift.giftDataBase64 || '',
    imagePath: gift.imagePath,
    imageName: gift.imageName
  }
}

function createGiftDatabase(SQL: SqlJsStatic, gifts: TransparentGiftRecord[]): Uint8Array {
  const db = new SQL.Database()
  db.run('CREATE TABLE giftlist (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, platform TEXT NULL, name TEXT NULL, giftid TEXT NULL, diamondcount INTEGER NULL, giftdata BLOB NULL, userid INTEGER NULL)')
  const statement = db.prepare('INSERT INTO giftlist (time,createtime,platform,name,giftid,diamondcount,giftdata,userid) VALUES (?,?,?,?,?,?,?,?)')
  const now = Math.floor(Date.now() / 1000)
  try {
    for (const gift of gifts.slice(0, MAX_ROWS)) {
      statement.run([now, now, gift.platform, gift.name, gift.giftId, Math.max(0, Math.trunc(gift.diamondCount)), blobForGift(gift), 0])
    }
  } finally {
    statement.free()
  }
  const bytes = db.export()
  db.close()
  return bytes
}

function createConfigDatabase(
  SQL: SqlJsStatic,
  textPrograms: TransparentMenuProgram[],
  imagePrograms: TransparentMenuProgram[],
  programs: { name: string; cfg: Record<string, unknown> }[],
  giftVersions?: TransparentGiftVersion[],
  colors?: TransparentColorRecord[]
): Uint8Array {
  const db = new SQL.Database()
  db.run('CREATE TABLE baseinfo (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, program_name TEXT NULL, font_size TEXT NULL, font_str TEXT NULL, colorstr TEXT NULL, strok_color TEXT NULL, spacing_size TEXT NULL, scale TEXT NULL, isrolling TEXT NULL, looogtxt TEXT NULL, imgdir TEXT NULL)')
  db.run('CREATE TABLE programlist (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, program_name TEXT NULL, giftpro BLOB NULL)')
  db.run('CREATE TABLE programlistimg (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, program_name TEXT NULL, giftpro BLOB NULL)')
  db.run('CREATE TABLE giftver (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, name TEXT NULL, ver INTEGER NULL)')
  db.run('CREATE TABLE colorlist (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, color_name TEXT NULL, colorv BLOB NULL)')
  const now = Math.floor(Date.now() / 1000)

  const baseRows = programs.length ? programs : [{ name: 'Global', cfg: {} }]
  const base = db.prepare('INSERT INTO baseinfo (time,createtime,program_name,font_size,font_str,colorstr,strok_color,spacing_size,scale,isrolling,looogtxt,imgdir) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  try {
    for (const program of baseRows.slice(0, MAX_ROWS)) {
      const cfg = object(program.cfg) || {}
      base.run([
        now, now, program.name || 'Global', String(number(cfg.fontSize) || 50), text(cfg.font) || '微软雅黑',
        text(cfg.color) || '#ffffff', text(cfg.strokeColor) || '#000000', String(number(cfg.spacing)),
        text(cfg.scale) || '1080x1920(竖)', text(cfg.scrollDir) === 'none' ? '' : text(cfg.scrollDir),
        text(cfg.text), text(cfg.imgPath)
      ])
    }
  } finally {
    base.free()
  }

  const insertMenus = (table: 'programlist' | 'programlistimg', list: TransparentMenuProgram[]) => {
    const statement = db.prepare(`INSERT INTO ${table} (time,createtime,program_name,giftpro) VALUES (?,?,?,?)`)
    try {
      for (const program of list.slice(0, MAX_ROWS)) {
        let payload: Uint8Array
        if (program.giftProBase64) {
          try {
            payload = new Uint8Array(Buffer.from(program.giftProBase64, 'base64'))
          } catch {
            payload = new Uint8Array()
          }
        } else {
          payload = new Uint8Array(Buffer.from(JSON.stringify({
            program: program.program,
            programName: program.name,
            listPro: program.listPro.map(portableGift)
          }), 'utf8'))
        }
        statement.run([now, now, program.name, new Uint8Array(payload)])
      }
    } finally {
      statement.free()
    }
  }
  insertMenus('programlist', textPrograms)
  insertMenus('programlistimg', imagePrograms)

  const versions = db.prepare('INSERT INTO giftver (time,createtime,name,ver) VALUES (?,?,?,?)')
  const colorStatement = db.prepare('INSERT INTO colorlist (time,createtime,color_name,colorv) VALUES (?,?,?,?)')
  const versionRows = giftVersions ?? PLATFORMS.map((name) => ({ name, version: name === 'dy' ? 100 : 0 }))
  const colorRows: TransparentColorRecord[] = colors ?? Array.from({ length: 20 }, (_, index) => ({ name: String(index), value: '' }))
  try {
    for (const item of versionRows.slice(0, MAX_ROWS)) {
      versions.run([now, now, item.name, Math.max(0, Math.trunc(item.version))])
    }
    for (const item of colorRows.slice(0, MAX_ROWS)) {
      let value: Uint8Array | null = null
      if (item.valueBase64) {
        try { value = new Uint8Array(Buffer.from(item.valueBase64, 'base64')) } catch { /* keep null */ }
      } else if (item.value) {
        value = new Uint8Array(Buffer.from(item.value, 'utf8'))
      }
      colorStatement.run([now, now, item.name, value])
    }
  } finally {
    versions.free()
    colorStatement.free()
  }
  const bytes = db.export()
  db.close()
  return bytes
}

export async function exportTransparentDatabase(payloadValue: unknown): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const payload = object(payloadValue) || {}
    const gifts = (Array.isArray(payload.gifts) ? payload.gifts : [])
      .map(normalizedGift)
      .filter((gift): gift is TransparentGiftRecord => !!gift)
    const normalizePrograms = (value: unknown): TransparentMenuProgram[] => (Array.isArray(value) ? value : [])
      .map((item, index) => {
        const row = object(item)
        if (!row) return null
        const name = text(first(row, 'name', 'programName')) || `菜单方案${index + 1}`
        const program: TransparentMenuProgram = {
          name,
          program: text(first(row, 'program', 'title')) || name,
          listPro: (Array.isArray(row.listPro) ? row.listPro : []).map(normalizedGift).filter((gift): gift is TransparentGiftRecord => !!gift)
        }
        const base64 = text(first(row, 'giftProBase64', 'giftprobase64'))
        if (base64) program.giftProBase64 = base64
        return program
      })
      .filter((item): item is TransparentMenuProgram => !!item)
    const textPrograms = normalizePrograms(payload.textPrograms)
    const imagePrograms = normalizePrograms(payload.imagePrograms)
    const programs = (Array.isArray(payload.programs) ? payload.programs : [])
      .map((item, index) => {
        const row = object(item)
        if (!row) return null
        return { name: text(row.name) || `方案${index + 1}`, cfg: object(row.cfg) || {} }
      })
      .filter((item): item is { name: string; cfg: Record<string, unknown> } => !!item)
    const normalizeVersions = (value: unknown): TransparentGiftVersion[] | undefined => {
      if (!Array.isArray(value)) return undefined
      return value.map((item) => {
        const row = object(item)
        if (!row) return null
        const name = text(first(row, 'name', 'platform'))
        return name ? { name, version: Math.max(0, Math.trunc(number(first(row, 'version', 'ver')))) } : null
      }).filter((item): item is TransparentGiftVersion => !!item)
    }
    const normalizeColors = (value: unknown): TransparentColorRecord[] | undefined => {
      if (!Array.isArray(value)) return undefined
      return value.map((item) => {
        const row = object(item)
        if (!row) return null
        const name = text(first(row, 'name', 'colorName', 'color_name'))
        if (!name) return null
        const color: TransparentColorRecord = {
          name,
          value: text(first(row, 'value', 'colorValue'))
        }
        const base64 = text(first(row, 'valueBase64', 'valuebase64'))
        if (base64) color.valueBase64 = base64
        return color
      }).filter((item): item is TransparentColorRecord => !!item)
    }
    const giftVersions = normalizeVersions(payload.giftVersions)
    const colors = normalizeColors(payload.colors)

    const SQL = await sql()
    const zip = new JSZip()
    zip.file('gf.db', createGiftDatabase(SQL, gifts))
    zip.file('config.db', createConfigDatabase(SQL, textPrograms, imagePrograms, programs, giftVersions, colors))
    zip.file('README.txt', '知了猴整蛊台透明图数据库导出\r\n包含原版兼容的 gf.db 与 config.db。\r\n')
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const options = {
      title: '导出透明图礼物库和菜单方案',
      defaultPath: path.join(app.getPath('documents'), `透明图数据库_${new Date().toISOString().slice(0, 10)}.zip`),
      filters: [{ name: '透明图数据库压缩包', extensions: ['zip'] }]
    }
    const owner = BrowserWindow.getFocusedWindow()
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, error: '已取消' }
    fs.writeFileSync(result.filePath, buffer)
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: `导出透明图数据库失败：${(error as Error).message}` }
  }
}
