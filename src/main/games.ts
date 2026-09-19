import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getSettings, saveSettings } from './settings'
import { checkGamePath } from '@shared/gamePaths'
import type { GamePathVerdict } from '@shared/gamePaths'
import type { GameItem } from '@shared/types'

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

// 内置游戏清单：支持多游戏，新增游戏只需在这里加一条
// steamLaunch=true 的游戏（UE Shipping exe 有 Steam DRM）必须走 steam://run，
// 直启 exe 会被 Steam OSS 拦下弹「启动游戏时发现错误」。
// librarian 的 Steam library_hero/logo 是 404，启动页用本地商店图。
const CATALOG: { id: string; name: string; appid: string; steamLaunch?: boolean; hero?: string }[] = [
  { id: '4wheel-challenge', name: '轮椅模拟器', appid: '3504700' },
  { id: 'dontscream', name: "DON'T SCREAM", appid: '2497900', steamLaunch: true },
  {
    id: 'librarian',
    name: '图书管理员',
    appid: '4197610',
    steamLaunch: true,
    hero: '/mod-images/librarian/ss1.jpg'
  }
]

// 当前游戏的启动信息（appid / 是否走 steam://run）
export function gameLaunchInfo(id?: string): { appid: string; steamLaunch: boolean } {
  const gid = id ?? currentGameId()
  const g = CATALOG.find((x) => x.id === gid)
  return { appid: g?.appid ?? '', steamLaunch: !!g?.steamLaunch }
}

// 当前游戏 id：从 settings 读用户选择，默认清单第一个（未配置时回落）
export function currentGameId(): string {
  const id = getSettings().currentGameId
  return id && CATALOG.some((g) => g.id === id)
    ? id
    : CATALOG[0]?.id || '4wheel-challenge'
}

export function setCurrentGameId(id: string): void {
  if (CATALOG.some((g) => g.id === id)) saveSettings({ currentGameId: id })
}

// 全部内置游戏 id（detectAllGames 用）
export function catalogGameIds(): string[] {
  return CATALOG.map((g) => g.id)
}

// 每游戏 exe 路径：gamePaths[id] 优先；旧字段 gamePath 只兜底 WheelLive（它本来就是为轮椅写的）
export function gamePathFor(id?: string): string {
  const gid = id ?? currentGameId()
  const s = getSettings()
  const p = s.gamePaths?.[gid]
  if (p) return p
  return gid === '4wheel-challenge' ? s.gamePath : ''
}

export function setGamePathFor(id: string, path: string): void {
  const s = getSettings()
  const next = { ...(s.gamePaths ?? {}), [id]: path }
  // WheelLive 同步写旧字段，保持旧逻辑/旧版工具兼容
  saveSettings(
    id === '4wheel-challenge'
      ? { gamePaths: next, gamePath: path }
      : { gamePaths: next }
  )
}

/**
 * 一条 exe 路径合不合格（存在性和大小在这里探，判定规则在 shared/gamePaths.ts）。
 * 2026-09-07：以前全链路只判 `fs.existsSync`，于是测试夹具留下的 0 字节 4WheelChallenge.exe
 * 一直被当成「已定位」——mod 装进 C:\Temp、查进程查不到，主播看到的就是「重装 mod 后检测不到」。
 * 放在 games.ts 而不是 game-launcher.ts：后者引前者，反过来引会成环。
 */
export function verifyGamePath(gameId: string, exePath: string): GamePathVerdict {
  let exists = false
  let size = -1
  try {
    const st = fs.statSync(exePath)
    exists = st.isFile()
    size = st.size
  } catch {
    exists = false
  }
  // 隔离回归的占位 exe 就放在本客户端的 userData 里（0 字节、名字也不合规）。
  // 真主播的游戏不可能装在这儿，所以这里只判存在——否则测试会掉头去扫真实 Steam 库，
  // 把真游戏目录写进测试 profile（2026-09-06 踩过：隔离测试别碰真实游戏路径）。
  if (exists && isUnderUserData(exePath)) {
    return { ok: true, code: 'no-rule', reason: '' }
  }
  return checkGamePath(gameId, exePath, { exists, size })
}

function isUnderUserData(p: string): boolean {
  try {
    const rel = path.relative(app.getPath('userData'), p)
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  } catch {
    return false
  }
}

export function listGames(): GameItem[] {
  return CATALOG.map((g) => {
    const hero = g.hero || `${CDN}/${g.appid}/library_hero.jpg`
    const p = gamePathFor(g.id)
    const v = verifyGamePath(g.id, p)
    return {
      id: g.id,
      name: g.name,
      appid: g.appid,
      installed: v.ok,
      path: p || '',
      // 没设过路径不算「出错」，别在游戏库里吓人
      pathError: !p || v.code === 'empty' ? '' : v.reason,
      hero,
      header: hero,
      logo: `${CDN}/${g.appid}/logo.png`
    }
  })
}
