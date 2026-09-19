// 服务器 HTTPS（2026-09-07）：账号密码 / 授权 / 通知以前全程明文 http。服务器没有域名、443 被别的服务占着，
// 用的是自签证书（服务器 /opt/wheellive/tls/cert.pem，2026-09-07 签发，10 年，SAN=IP）。这里把证书 SHA-256 指纹钉死：
// 只对我们的服务器主机生效，别的域名（OSS、抖音）照常走系统校验。换证书 = 同时发一版客户端。
// 注意：只有走 Electron 网络栈的请求（net.fetch / net.request / session.fetch）受这个校验管，Node 的 fetch 不认自签证书，服务器调用一律用 net.fetch。
// 卡密平台（2026-09-13）：正式平台挂在同一台服务器、同一张证书、同一个 8770 端口的 /card 子路径下；
// 平台会话用独立的内存分区，所以指纹校验要能装到任意 Session 上（installServerCertPin(ses)），默认仍是 defaultSession。
import { session, type Session } from 'electron'

export const SERVER_HOST = '47.251.93.171'
export const SERVER_URL_HTTPS = 'https://47.251.93.171:8770'   // 与明文共用 8770：服务器按首字节分流（安全组只放行了 8770）
export const SERVER_URL_HTTP = 'http://47.251.93.171:8770'
/** 正式卡密平台基地址：与服务器同证书、同端口，子路径 /card（拼接口时不能丢掉这一段） */
export const CARD_SERVICE_URL = SERVER_URL_HTTPS + '/card'
const PIN_B64 = 'olLetXyb5y6ezV7qvIriRIU8qmfhKs+AI/srKka0ZIA='
const PIN_HEX = 'a252deb57c9be72e9ecd5eeabc8ae244853caa67e12acf8023fb2b2a46b46480'

/** 证书校验：只对我们的服务器主机比指纹（0 通过 / -2 拒绝），其它主机交给系统默认校验（-3）。 */
export function verifyServerCertificate(hostname: string, fingerprint: unknown): 0 | -2 | -3 {
  if (hostname !== SERVER_HOST) return -3
  const fp = String(fingerprint || '').replace(/^sha256\//i, '').trim()
  const hex = fp.replace(/:/g, '').toLowerCase()
  return fp === PIN_B64 || hex === PIN_HEX ? 0 : -2
}

/** 把服务器证书指纹校验装到一个 Session 上；不传就是 defaultSession（旧账号系统 / 更新 / 通知都走它）。 */
export function installServerCertPin(ses: Session = session.defaultSession): void {
  ses.setCertificateVerifyProc((req, cb) => {
    cb(verifyServerCertificate(req.hostname, req.certificate?.fingerprint))
  })
}

/** 老设置里存的明文默认地址 → 新的 HTTPS 默认地址（主播自己改过的地址不动） */
export function migrateServerUrl(url: string): string {
  const u = String(url || '').trim().replace(/\/+$/, '')
  return !u || u === SERVER_URL_HTTP ? SERVER_URL_HTTPS : u
}
