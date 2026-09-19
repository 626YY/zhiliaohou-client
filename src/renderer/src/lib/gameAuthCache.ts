import type { EmailLicense } from '@shared/types'

// 全局游戏授权缓存：登录/会话建立时预取一次，切页面不再重复请求服务器。
// 授权在服务器端变化时（后台批准/拒绝），重新登录或申请游戏成功后强制刷新。
let cache: { email: string; auth: EmailLicense | null } | null = null
let inflight: Promise<EmailLicense | null> | null = null

// 返回 undefined = 该邮箱还没有缓存；null = 已缓存为「非邮箱账号」；否则为授权结果
export function getCachedAuth(email: string): EmailLicense | null | undefined {
  if (!email) return undefined
  if (cache && cache.email === email) return cache.auth
  return undefined
}

export async function fetchAuth(email: string, force = false): Promise<EmailLicense | null> {
  if (!email) {
    cache = { email: '', auth: null }
    return null
  }
  if (!force && cache && cache.email === email) return cache.auth
  if (!force && inflight) return inflight
  inflight = (async () => {
    try {
      const r = await window.api.emailGetLicense(email)
      cacheAuth(email, r.ok ? r : { ...r, games: {}, pendingGames: [] })
      return cache?.auth ?? null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

// 直接写入缓存（供启动页等实时查询方把结果同步给其他页面）
export function cacheAuth(email: string, auth: EmailLicense | null) {
  cache = { email, auth }
}

// 登录成功 / 会话恢复后调用一次（强制拉最新，后台改授权重登即生效），之后各页面直接用缓存
export async function preloadAuth(email: string): Promise<EmailLicense | null> {
  try {
    return await fetchAuth(email, true)
  } catch {
    return null
  }
}

export function clearAuthCache() {
  cache = null
  inflight = null
}
