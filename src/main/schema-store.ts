// 每款游戏的「整蛊菜单 + 参数说明 + 默认键位」定义包（SchemaBundle）。
//   2026-09-14 用户：「菜单不能是自动更新的吗，每次都要更新客户端也很累」——原来菜单一份写死在渲染层
//   pranks.ts、一份随安装包打在 mods-catalog/schemas 里，mod 上新整蛊必须发一版客户端，老客户端见到
//   不认识的整蛊 id 就直接把英文 id 显示给主播。
// 分工：
//   · 自带定义（mods-catalog/schemas/<游戏>/）= 保底：离线、首次启动、更新源挂了都有菜单
//   · 更新源定义 = 覆盖层：mod 清单（mods-catalog.json）里每款 mod 带一个 schema {url,size,sha256}，
//     下回来验 sha256 + 结构（parseSchemaBundle）才落到 userData/data/schemas/<gameId>.json；
//     覆盖层缺 config / binds 时那两样沿用自带的
//   · 任何一步失败都只影响「用不上新定义」，不影响游戏库 / 参数页能打开
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { catalogDir } from './catalog-dir'
import { groupPranks, parseSchemaBundle, sanePranks, SCHEMA_BUNDLE_MAX_BYTES, type RemoteCatalog } from '@shared/modsCatalog'
import { Ipc, type ConfigSchema, type NativeKeybinds, type PrankDef, type PrankGroup, type SchemaBundle } from '@shared/types'

/** gameId → 自带定义文件所在子目录（轮椅是最早的一款，文件在顶层） */
const BUNDLED_SUBDIR: Record<string, string> = { '4wheel-challenge': '', dontscream: 'dontscream', librarian: 'librarian' }
export const SCHEMA_GAME_IDS = Object.keys(BUNDLED_SUBDIR)

const FETCH_TIMEOUT_MS = 15000
const EMPTY_SCHEMA: ConfigSchema = { version: '0', groups: [], fields: [] }
const DEFAULT_BINDS: NativeKeybinds = { menu: 'F1', leaderboard: 'BackQuote', binds: {} }

function remoteDir(): string {
  return path.join(app.getPath('userData'), 'data', 'schemas')
}
function remoteFile(gameId: string): string {
  return path.join(remoteDir(), `${gameId}.json`)
}
function metaFile(gameId: string): string {
  return path.join(remoteDir(), `${gameId}.meta.json`)
}

function readJson(p: string): unknown {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    /* 坏文件当没有 */
  }
  return null
}

function writeJsonAtomic(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8')
  fs.renameSync(tmp, p)
}

/** 自带定义：三个文件拼成一份 bundle（没有的部分留空） */
function bundledBundle(gameId: string): SchemaBundle | null {
  const sub = BUNDLED_SUBDIR[gameId]
  if (sub === undefined) return null
  const dir = path.join(catalogDir(), 'schemas', sub)
  const pranks = sanePranks(readJson(path.join(dir, 'pranks.json')))
  const config = readJson(path.join(dir, 'config.schema.json')) as ConfigSchema | null
  const binds = readJson(path.join(dir, 'default_binds.json')) as NativeKeybinds | null
  return { gameId, pranks, config: config ?? undefined, binds: binds ?? undefined }
}

/** 生效定义 = 更新源覆盖层（验过的）→ 自带；覆盖层缺 config / binds 时用自带的补 */
export function bundleFor(gameId: string): SchemaBundle | null {
  const bundled = bundledBundle(gameId)
  if (!bundled) return null
  const remote = parseSchemaBundle(readJson(remoteFile(gameId)), gameId)
  if (!remote) return bundled
  return { ...remote, config: remote.config ?? bundled.config, binds: remote.binds ?? bundled.binds }
}

export function getSchemaFor(gameId: string): ConfigSchema {
  return bundleFor(gameId)?.config ?? EMPTY_SCHEMA
}
export function getPranksFor(gameId: string): PrankDef[] {
  return bundleFor(gameId)?.pranks ?? []
}
export function getBindsFor(gameId: string): NativeKeybinds {
  return bundleFor(gameId)?.binds ?? DEFAULT_BINDS
}

/** 全部游戏的菜单（按分组），渲染层一次拿走；没有定义的游戏给空数组 */
export function prankCatalog(): Record<string, PrankGroup[]> {
  const out: Record<string, PrankGroup[]> = {}
  for (const gid of SCHEMA_GAME_IDS) out[gid] = groupPranks(getPranksFor(gid))
  return out
}

/** 自带清单里 mod id → gameId（定义包按游戏存，清单按 mod 发） */
function modGameIds(): Record<string, string> {
  const dir = path.join(catalogDir(), 'manifests')
  const out: Record<string, string> = {}
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const m = readJson(path.join(dir, f)) as { id?: unknown; gameId?: unknown } | null
      if (m && typeof m.id === 'string' && typeof m.gameId === 'string') out[m.id] = m.gameId
    }
  } catch {
    /* 没有清单目录就没有映射 */
  }
  return out
}

async function fetchBundle(url: string, sha256: string): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > SCHEMA_BUNDLE_MAX_BYTES) throw new Error('定义包过大')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > SCHEMA_BUNDLE_MAX_BYTES) throw new Error('定义包过大')
    const got = crypto.createHash('sha256').update(buf).digest('hex')
    if (got !== sha256) throw new Error('定义包 sha256 不符')
    return JSON.parse(buf.toString('utf-8'))
  } finally {
    clearTimeout(timer)
  }
}

let syncing: Promise<boolean> | null = null

/**
 * 按远端清单同步各游戏的定义包。同一时刻只跑一份；每款只在 sha256 变了才下；
 * 任何一款失败不影响别的。有更新就广播 PrankCatalogChanged 让渲染层重拉菜单。返回是否有更新。
 */
export function syncRemoteSchemas(catalog: RemoteCatalog | null): Promise<boolean> {
  if (!catalog) return Promise.resolve(false)
  if (syncing) return syncing
  syncing = (async () => {
    const games = modGameIds()
    let changed = false
    for (const [modId, entry] of Object.entries(catalog.mods)) {
      const schema = entry.schema
      const gameId = games[modId]
      if (!schema || !gameId || BUNDLED_SUBDIR[gameId] === undefined) continue
      const meta = readJson(metaFile(gameId)) as { sha256?: unknown } | null
      if (meta?.sha256 === schema.sha256 && fs.existsSync(remoteFile(gameId))) continue
      try {
        const bundle = parseSchemaBundle(await fetchBundle(schema.url, schema.sha256), gameId)
        if (!bundle) throw new Error('定义包结构不合法')
        writeJsonAtomic(remoteFile(gameId), bundle)
        writeJsonAtomic(metaFile(gameId), { sha256: schema.sha256, url: schema.url, at: Date.now() })
        changed = true
      } catch {
        /* 下不到 / 验不过：继续用上一份（或自带的），下次刷新清单再试 */
      }
    }
    if (changed) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(Ipc.PrankCatalogChanged)
      }
    }
    return changed
  })().finally(() => {
    syncing = null
  })
  return syncing
}

/** 诊断用：每款游戏当前生效的定义来自哪、多少条整蛊 */
export function schemaSnapshot(): Record<string, { source: 'remote' | 'bundled'; pranks: number; version: string }> {
  const out: Record<string, { source: 'remote' | 'bundled'; pranks: number; version: string }> = {}
  for (const gid of SCHEMA_GAME_IDS) {
    const remote = parseSchemaBundle(readJson(remoteFile(gid)), gid)
    const b = bundleFor(gid)
    out[gid] = { source: remote ? 'remote' : 'bundled', pranks: b?.pranks.length ?? 0, version: b?.version ?? '' }
  }
  return out
}
