// 远端 mod 清单：让「上新一版 mod」不再必须发一版客户端。
//   2026-09-07 用户：「以后我们要做很多游戏的」——原来每款 mod 的版本和下载地址都写死在客户端自带的
//   mods-catalog/manifests/*.json 里，改一个版本号就得重新打包发版；服务器那份 /api/manifest 又只有轮椅一款
//   （连接器 check_update 里明确写了别的游戏不查它），所以后台「升级推送」看起来只管一个游戏。
//
// 分工：
//   · 客户端自带清单 = 保底（离线、首次启动、远端挂了都能用，内置 zip 也还在）
//   · 远端清单 = 覆盖层，只覆盖 version / download / changelog，其余字段（介绍、封面、installedMarker、
//     装到哪）仍以自带清单为准 —— 远端写错也带不跑安装逻辑
//   · 只有远端版本更新才覆盖；download 必须「白名单地址 + 正数大小 + 64 位 sha256」三样齐全才认
//   · 拉不到就用上次缓存，缓存也没有就用自带的；任何一步失败都不影响游戏库能打开
//
// 清单在更新源 `updates/mods-catalog.json`，由 tools/publish-mods-catalog.py 生成上传。
// 纯逻辑（解析/清洗/覆盖/版本比较）在 src/shared/modsCatalog.ts，有单测 tools/test-mods-catalog.mjs。
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { overlayCatalog, parseRemoteCatalog, type RemoteCatalog } from '@shared/modsCatalog'
import type { ModManifest } from '@shared/types'
import { syncRemoteSchemas } from './schema-store'

const CATALOG_URL =
  process.env.ZL_MODS_CATALOG_URL || 'https://zhiliaohou.oss-cn-beijing.aliyuncs.com/updates/mods-catalog.json'
// 回归把清单指到本地夹具服务器时，同源的下载 / 定义包地址也放行；线上不设（白名单只有更新源）
const ALLOW_ORIGIN = process.env.ZL_MODS_CATALOG_URL ? new URL(CATALOG_URL).origin : ''
const FETCH_TIMEOUT_MS = 8000
// 半小时刷一次就够（主播不会盯着游戏库等新版）。测试用 ZL_MODS_CATALOG_REFRESH_MS 缩短，同 ZL_GIFT_SYNC_STARTUP_MS 的路子。
const REFRESH_MS = Number(process.env.ZL_MODS_CATALOG_REFRESH_MS) || 30 * 60 * 1000

let cache: RemoteCatalog | null = null
let cacheAt = 0
let loadedFromDisk = false
let inflight: Promise<void> | null = null

function cachePath(): string {
  return path.join(app.getPath('userData'), 'data', 'mods-catalog.json')
}

function writeCacheFile(data: RemoteCatalog): void {
  try {
    const file = cachePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8')
    fs.renameSync(tmp, file)
  } catch {
    /* 缓存写不了只影响下次离线 */
  }
}

/** 拉一次远端清单。同一时刻只跑一份；失败静默（继续用缓存/自带清单，下次再试）。 */
export function refreshRemoteCatalog(force = false): Promise<void> {
  if (!force && cache && Date.now() - cacheAt < REFRESH_MS) return Promise.resolve()
  if (inflight) return inflight
  inflight = (async () => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
    try {
      // 带时间戳绕开 CDN/浏览器缓存，否则刚推的清单要等缓存过期才生效
      const res = await fetch(`${CATALOG_URL}?t=${Date.now()}`, { signal: ctl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = parseRemoteCatalog(await res.json(), ALLOW_ORIGIN)
      if (data) {
        cache = data
        cacheAt = Date.now()
        writeCacheFile(data)
        // 清单带的定义包（菜单 / 参数 / 键位）顺手同步；失败静默，下次刷新再试
        void syncRemoteSchemas(data).catch(() => {})
      }
    } catch {
      /* 拉不到不是错误：保底清单一直在 */
    } finally {
      clearTimeout(timer)
      inflight = null
    }
  })()
  return inflight
}

/** 当前可用的远端清单（内存 → 磁盘缓存 → 没有）。顺手触发一次后台刷新。 */
function current(): RemoteCatalog | null {
  if (!cache && !loadedFromDisk) {
    loadedFromDisk = true
    try {
      cache = parseRemoteCatalog(JSON.parse(fs.readFileSync(cachePath(), 'utf-8')), ALLOW_ORIGIN)
    } catch {
      cache = null
    }
    cacheAt = 0 // 磁盘缓存不算新鲜，下次照样刷新
  }
  void refreshRemoteCatalog().catch(() => {})
  return cache
}

/** 把远端清单盖到自带清单上（详见 shared/modsCatalog.ts::overlayCatalog）。 */
export function applyRemoteCatalog(mods: ModManifest[]): ModManifest[] {
  return overlayCatalog(mods, current())
}

/** 诊断用：当前远端清单快照。 */
export function remoteCatalogSnapshot(): {
  url: string
  at: number
  generatedAt: string
  mods: Record<string, string>
} {
  const c = current()
  const mods: Record<string, string> = {}
  for (const [id, e] of Object.entries(c?.mods || {})) mods[id] = e.version || ''
  return { url: CATALOG_URL, at: cacheAt, generatedAt: c?.generatedAt || '', mods }
}
