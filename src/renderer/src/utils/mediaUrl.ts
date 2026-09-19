// 本地图片一律走自建的 zlmedia 协议：页面在开发期是 http://localhost，
// 直接写 file:// 会被安全策略拦掉，礼物图全成空白方块。主进程 index.ts 注册了 zlmedia://local/<路径>。
export function mediaUrl(source: string | undefined | null): string {
  const value = String(source || '').trim()
  if (!value) return ''
  if (/^(?:data|https?|blob|zlmedia):/i.test(value)) return value
  const normalized = value.replace(/^file:\/\/+/i, '').split(String.fromCharCode(92)).join('/')
  const encoded = normalized.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `zlmedia://local/${encoded}`
}
