// 远端 mod 清单的纯逻辑（无 fs / 无网络 / 无 electron，可直接单测）。
// 背景与分工见 src/main/mods-catalog-remote.ts 顶部注释：自带清单保底，远端只当覆盖层。
import type { ConfigSchema, ModManifest, ModStatus, NativeKeybinds, PrankDef, PrankGroup, SchemaBundle } from './types'

/** 远端允许覆盖的字段。别的（介绍/封面/installedMarker/装到哪）一律以客户端自带清单为准。 */
export interface RemoteModEntry {
  version?: string
  /** 远端只允许给这三样；filename 由 url 推、kind/installInto 等一律用内置清单的（远端写错也带不跑安装逻辑） */
  download?: { url: string; size: number; sha256: string }
  changelog?: ModManifest['changelog']
  /** 上架状态：和版本比较解耦，远端给了合法值就盖（版本没变也盖）。后台「Mod 管理」点「发布状态到客户端」写的就是它 */
  status?: ModStatus
  /**
   * 这款 mod 的「菜单 + 参数 + 默认键位」定义包（SchemaBundle 的 JSON）。和 download 一样三样齐全才认；
   * 客户端下回来验过 sha256、结构合法才盖掉自带的定义 —— 上新整蛊不用再发客户端（2026-09-14）
   */
  schema?: { url: string; size: number; sha256: string }
}

/** 定义包最大字节数：三款游戏加起来也就几十 KB，超过这个数肯定不是我们发的 */
export const SCHEMA_BUNDLE_MAX_BYTES = 4 * 1024 * 1024

export const MOD_STATUSES: readonly ModStatus[] = ['listed', 'coming_soon', 'unlisted']

/** 把任意输入清洗成合法状态；不是这三个值之一就返回 null（调用方当「没给」处理，绝不猜） */
export function normalizeModStatus(v: unknown): ModStatus | null {
  if (typeof v !== 'string') return null
  const s = v.trim() as ModStatus
  return MOD_STATUSES.includes(s) ? s : null
}

/** 清单条目的生效状态：老清单没有这个字段 = 在售 */
export function modStatusOf(mod: Pick<ModManifest, 'status'> | null | undefined): ModStatus {
  return normalizeModStatus(mod?.status) ?? 'listed'
}

/**
 * 状态挡不挡这次安装。只拦「首次安装」：已经装在机器上的（客户端记录或游戏目录里检测到的）
 * 重装 / 修复 / 升级一律放行 —— 下架是「不再卖给新人」，不是把主播已经在用的整蛊器收走；
 * mod-health 的一键修复、启动自修走的也是 installMod，不放行的话下架的 mod 坏了就再也修不好。
 * 返回空串 = 不拦；否则是给主播看的原因。
 */
export function installBlockedReason(mod: Pick<ModManifest, 'status'>, alreadyInstalled: boolean): string {
  if (alreadyInstalled) return ''
  const st = modStatusOf(mod)
  if (st === 'coming_soon') return '该 Mod 尚未发售，敬请期待'
  if (st === 'unlisted') return '该 Mod 已下架'
  return ''
}

/** 从下载直链取文件名：只认「字母数字._-」组成的最后一段，取不到就退回内置清单的文件名 */
export function fileNameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    return /^[\w.-]{1,120}$/.test(last) && !/^\.+$/.test(last) ? last : ''
  } catch {
    return ''
  }
}

export interface RemoteCatalog {
  generatedAt?: string
  mods: Record<string, RemoteModEntry>
}

/** 下载直链白名单：只认我们自己的更新源。远端清单被人改了也不会把主播导去别处下东西。 */
const URL_ALLOW = /^https:\/\/(?:[\w-]+\.)*(?:zhiliaohou\.oss-cn-beijing\.aliyuncs\.com|47\.251\.93\.171(?::\d+)?)\//

/** 比较点分版本号：>0 表示 a 更新。缺的段当 0，`1.0` 与 `1.0.0` 相等。 */
export function compareVersion(a: string, b: string): number {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/** 地址是否允许：白名单更新源；回归时清单本身来自本地夹具服务器，则同源的下载 / 定义包地址也放行 */
function urlAllowed(url: string, allowOrigin: string): boolean {
  if (URL_ALLOW.test(url)) return true
  if (!allowOrigin) return false
  try {
    return new URL(url).origin === allowOrigin
  } catch {
    return false
  }
}

function saneEntry(entry: unknown, allowOrigin: string): RemoteModEntry | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const e = entry as Record<string, unknown>
  const out: RemoteModEntry = {}
  const ver = typeof e.version === 'string' ? e.version.trim() : ''
  if (/^\d+(?:\.\d+){0,4}$/.test(ver)) out.version = ver
  const dl = e.download
  if (dl && typeof dl === 'object' && !Array.isArray(dl)) {
    const d = dl as Record<string, unknown>
    const url = typeof d.url === 'string' ? d.url.trim() : ''
    const size = Number(d.size)
    const sha = typeof d.sha256 === 'string' ? d.sha256.trim().toLowerCase() : ''
    // 三样都要立得住才认：地址在白名单里、大小是正数、sha256 是 64 位十六进制。
    // 少一样就整条 download 不要（退回自带清单的内置 zip），绝不给一个下不动或校验不过的地址。
    if (urlAllowed(url, allowOrigin) && Number.isFinite(size) && size > 0 && /^[0-9a-f]{64}$/.test(sha)) {
      out.download = { url, size, sha256: sha }
    }
  }
  if (Array.isArray(e.changelog)) out.changelog = e.changelog as ModManifest['changelog']
  // 状态：不合法的值直接丢（当没给），拼错的字段值不许被猜成下架
  const st = normalizeModStatus(e.status)
  if (st) out.status = st
  // 定义包：同 download 的口径（白名单地址 + 正数且不超上限的大小 + 64 位 sha256），少一样整块不要
  const sc = e.schema
  if (sc && typeof sc === 'object' && !Array.isArray(sc)) {
    const s = sc as Record<string, unknown>
    const url = typeof s.url === 'string' ? s.url.trim() : ''
    const size = Number(s.size)
    const sha = typeof s.sha256 === 'string' ? s.sha256.trim().toLowerCase() : ''
    if (urlAllowed(url, allowOrigin) && Number.isFinite(size) && size > 0 && size <= SCHEMA_BUNDLE_MAX_BYTES && /^[0-9a-f]{64}$/.test(sha)) {
      out.schema = { url, size, sha256: sha }
    }
  }
  // 只带 status 的条目也要活下来：后台改上架状态时版本号往往没变（0.3.47 之前这里会把整条丢掉，
  // 于是「后台点了下架、客户端照样显示」）。老客户端仍按老规则丢掉它，不会被状态字段弄坏。
  return out.version || out.download || out.status || out.schema ? out : null
}

// ============ 定义包（菜单 / 参数 / 默认键位） ============

const ID_RE = /^[\w-]{1,64}$/

function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : ''
}

/** 清洗整蛊清单：id 合法、名字非空才留；同 id 只留第一条 */
export function sanePranks(raw: unknown): PrankDef[] {
  if (!Array.isArray(raw)) return []
  const out: PrankDef[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const p = x as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id.trim() : ''
    const name = cleanText(p.name, 60)
    if (!ID_RE.test(id) || !name || seen.has(id)) continue
    seen.add(id)
    const def: PrankDef = { id, name, cat: cleanText(p.cat, 40) || '其他' }
    if (p.danger === true) def.danger = true
    const desc = cleanText(p.desc, 400)
    if (desc) def.desc = desc
    out.push(def)
  }
  return out
}

function saneConfig(raw: unknown): ConfigSchema | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const c = raw as Record<string, unknown>
  if (!Array.isArray(c.groups) || !Array.isArray(c.fields)) return undefined
  const groups = c.groups.filter((g) => g && typeof g === 'object' && typeof (g as { id?: unknown }).id === 'string' && typeof (g as { name?: unknown }).name === 'string')
  const fields = c.fields.filter((f) => f && typeof f === 'object' && typeof (f as { key?: unknown }).key === 'string' && typeof (f as { type?: unknown }).type === 'string')
  if (!fields.length) return undefined
  return { version: typeof c.version === 'string' ? c.version : '0', groups: groups as ConfigSchema['groups'], fields: fields as ConfigSchema['fields'] }
}

function saneBinds(raw: unknown): NativeKeybinds | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const b = raw as Record<string, unknown>
  const binds: Record<string, string> = {}
  if (b.binds && typeof b.binds === 'object' && !Array.isArray(b.binds)) {
    for (const [k, v] of Object.entries(b.binds as Record<string, unknown>)) if (ID_RE.test(k) && typeof v === 'string') binds[k] = v.slice(0, 40)
  }
  return { menu: cleanText(b.menu, 40) || 'F1', leaderboard: cleanText(b.leaderboard, 40) || 'BackQuote', binds }
}

/**
 * 解析并清洗一份定义包。至少要有一条合法整蛊才算数（config / binds 可缺，缺了就沿用自带的）；
 * gameId 给了就必须对得上 —— 防止发错文件把 A 游戏的菜单盖到 B 游戏上。
 */
export function parseSchemaBundle(raw: unknown, gameId?: string): SchemaBundle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const gid = typeof r.gameId === 'string' ? r.gameId.trim() : ''
  if (!ID_RE.test(gid) || (gameId && gid !== gameId)) return null
  const pranks = sanePranks(r.pranks)
  if (!pranks.length) return null
  const out: SchemaBundle = { gameId: gid, pranks }
  const ver = typeof r.version === 'string' ? r.version.trim() : ''
  if (/^\d+(?:\.\d+){0,4}$/.test(ver)) out.version = ver
  const config = saneConfig(r.config)
  if (config) out.config = config
  const binds = saneBinds(r.binds)
  if (binds) out.binds = binds
  return out
}

/** 按 cat 分组，组的顺序 = 首次出现的顺序；组 id 就用分组名（同一游戏内唯一） */
export function groupPranks(pranks: PrankDef[]): PrankGroup[] {
  const groups: PrankGroup[] = []
  const byName = new Map<string, PrankGroup>()
  for (const p of pranks) {
    let g = byName.get(p.cat)
    if (!g) {
      g = { id: p.cat, name: p.cat, items: [] }
      byName.set(p.cat, g)
      groups.push(g)
    }
    g.items.push(p)
  }
  return groups
}

/**
 * 解析并清洗远端清单；结构不对或一条都不合格就返回 null（调用方据此保持用自带清单）。
 * allowOrigin：额外放行的同源地址（只有回归把清单指到本地夹具服务器时才给；线上永远是空）。
 */
export function parseRemoteCatalog(raw: unknown, allowOrigin = ''): RemoteCatalog | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const mods = (raw as { mods?: unknown }).mods
  if (!mods || typeof mods !== 'object' || Array.isArray(mods)) return null
  const out: Record<string, RemoteModEntry> = {}
  for (const [id, entry] of Object.entries(mods as Record<string, unknown>)) {
    if (!/^[\w.-]{1,64}$/.test(id)) continue
    const ok = saneEntry(entry, allowOrigin)
    if (ok) out[id] = ok
  }
  if (!Object.keys(out).length) return null
  const at = (raw as { generatedAt?: unknown }).generatedAt
  return { generatedAt: typeof at === 'string' ? at : '', mods: out }
}

/**
 * 把远端清单盖到自带清单上：
 *   · version / download / changelog 只在远端版本**更新**时覆盖（平级或更旧一律忽略，免得把主播降级）
 *   · status 与版本比较解耦：远端给了合法状态就盖，版本没变、甚至更旧也盖（下架/待发售本来就不改版本）；
 *     远端没给就保留自带清单的（缺省在售）
 * 原数组不改。
 */
export function overlayCatalog(mods: ModManifest[], catalog: RemoteCatalog | null): ModManifest[] {
  if (!catalog) return mods
  return mods.map((mod) => {
    const entry = catalog.mods[mod.id]
    if (!entry) return mod
    const base: ModManifest = entry.status ? { ...mod, status: entry.status } : mod
    if (!entry.version) return base
    if (compareVersion(entry.version, mod.version || '0.0.0') <= 0) return base
    return {
      ...base,
      version: entry.version,
      download: entry.download
        ? { ...mod.download, url: entry.download.url, size: entry.download.size, sha256: entry.download.sha256, filename: fileNameFromUrl(entry.download.url) || mod.download.filename }
        : mod.download,
      changelog: entry.changelog ?? mod.changelog
    }
  })
}
