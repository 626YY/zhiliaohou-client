// 卡密平台来源配置（2026-09-13 起支持正式公网平台）。读取顺序：
//   ① userData/license-provider.json —— 本机显式配置，优先级最高（测试 / 私有平台 / 主播自己切换过的默认配置）；
//   ② 打包后 resources/license-provider.json —— 随安装包带的官方默认配置（root 打包时写入），只在 app.isPackaged 时读；
//   ③ 都没有 → enabled=false，客户端完全按原有账号系统（旧服务器）工作，行为不变。
//   有文件但不合法 → enabled=true 但带 error：卡密功能全部报这个错，也不回退旧服务器
//                   （回退等于把主播输入的密码送去另一个来源，宁可明确报错）。
// 地址规则（origin 字段 = 平台基地址，可带子路径，如 https://47.251.93.171:8770/card）：
//   - 本机 127.0.0.1 允许 http / https；其它主机只允许 https（明文公网一律拒绝）；
//   - 不允许账号密码、查询串、锚点、编码字符、`..` / 空段这类路径穿越；子路径原样保留，拼接口时不会丢；
//   - 非本机 https 的证书：47.251.93.171 走 server-tls.ts 钉死的指纹，其它主机走系统 CA；不关 TLS 校验、不信任任意证书。
// 公钥从这里固定，绝不从网络上拿。
// 旧主播升级（只对「resources 默认文件 + 官方地址」生效）：
//   - migrateLegacyCredentials=true 时 card-auth 把旧 creds.json 里的邮箱账号密码复制到平台专用凭据库（旧文件不动）；
//   - 本机只有旧版「本地用户名账号」（没有任何邮箱身份）时不自动启用平台（legacyHold），主播点「切换」后才写成显式配置。
import { app } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { readJson } from './db'
import { CARD_SERVICE_URL } from './server-tls'
import { MOD_KEY_FINGERPRINT_RE, isModKeyXml, modKeyFingerprint } from './mod-lease-verify'
import type { User } from '@shared/types'

/** 某个游戏 mod 的公钥 pin（可只给指纹、只给公钥、或两者都给）；格式不对时只影响这一个产品，带 error。 */
export type CardModKeyPin = { keyXml?: string; fingerprint?: string; error?: string }

export type CardIdentityMode = 'existing' | 'local'
export type CardProviderSource = 'userData' | 'resources'

export type CardProviderConfig =
  | { enabled: false; legacyHold?: 'local-accounts'; defaultAvailable?: boolean }
  | {
      enabled: true
      /** 平台基地址（origin + 子路径，无尾部斜杠） */
      origin: string
      publicKey: string
      modKeys: Record<string, CardModKeyPin>
      source: CardProviderSource
      /** 是否就是正式官方平台地址（严格相等） */
      official: boolean
      /** 文件里声明的身份模式；平台 /api/v1/config 可读到时以平台为准 */
      identityMode?: CardIdentityMode
      /** 官方打包配置：把旧 creds.json 的邮箱凭据迁到平台专用凭据库（card-auth 执行，且只在 resources+official 时允许） */
      migrateLegacyCredentials: boolean
      error?: undefined
    }
  | { enabled: true; error: string; source?: CardProviderSource; origin?: undefined; publicKey?: undefined; modKeys?: undefined; identityMode?: undefined; migrateLegacyCredentials?: undefined; official?: undefined }

export const CARD_PROVIDER_FILE = 'license-provider.json'
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

let cached: CardProviderConfig | undefined

export function cardProviderPath(): string {
  return join(app.getPath('userData'), CARD_PROVIDER_FILE)
}

/** 随安装包的默认配置文件：只在打包后读 resources/，开发态没有默认配置。 */
export function defaultCardProviderPath(): string {
  if (!app.isPackaged) return ''
  const resources = process.resourcesPath
  return resources ? join(resources, CARD_PROVIDER_FILE) : ''
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1'
}

/**
 * 合法平台基地址：
 *   http(s)://127.0.0.1[:端口][/子路径]  或  https://主机[:端口][/子路径]
 * 不带查询、锚点、账号；子路径每段只能是 [A-Za-z0-9._-]，不能有 `.` / `..` / 空段 / 编码字符。
 * 返回规范化的基地址（无尾部斜杠），拼接口时直接 base + '/api/v1/…'。
 */
export function normalizeCardBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('缺少平台地址 origin')
  const text = raw.trim()
  if (/[\\\s]/.test(text)) throw new Error('平台地址不能含空白或反斜杠')
  // 路径按原文检查：URL 解析器会把 /card/../admin 静默归一成 /admin、把 %61 解成 a，那样配置写的和实际连的就不是一回事
  const shape = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?([?#].*)?$/.exec(text)
  if (!shape) throw new Error('平台地址不是合法网址')
  if (shape[4]) throw new Error('平台地址不能带参数或锚点')
  if (/@/.test(shape[2])) throw new Error('平台地址不能带账号密码')
  const rawPath = shape[3] || '/'
  if (/%/.test(rawPath)) throw new Error('平台地址路径不能含编码字符')
  const segments = rawPath.split('/').slice(1)
  if (segments.length && segments[segments.length - 1] === '') segments.pop()
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || !/^[A-Za-z0-9._-]+$/.test(seg)) throw new Error('平台地址路径不合法')
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('平台地址不是合法网址')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('平台地址只允许 http 或 https')
  if (url.username || url.password) throw new Error('平台地址不能带账号密码')
  if (url.search || url.hash) throw new Error('平台地址不能带参数或锚点')
  if (!isLoopbackHost(url.hostname) && url.protocol !== 'https:') throw new Error('非本机平台地址必须是 https')
  return url.origin + (segments.length ? '/' + segments.join('/') : '')
}

/** 兼容旧名字：以前只允许 127.0.0.1 origin，现在统一走 normalizeCardBaseUrl。 */
export const normalizeCardOrigin = normalizeCardBaseUrl

/** 合法公钥：Ed25519 原始 32 字节的 base64url（43 字符，允许尾部 =）。 */
export function normalizeCardPublicKey(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('缺少平台公钥 publicKey')
  const key = raw.trim().replace(/=+$/, '')
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('平台公钥格式不正确')
  if (Buffer.from(key, 'base64url').length !== 32) throw new Error('平台公钥长度不正确')
  return key
}

const MOD_PRODUCT_RE = /^game:[a-z0-9-]{1,40}$/

/**
 * modPublicKeys：{ "game:4wheel-challenge": { "keyXml": "<RSAKeyValue>…", "fingerprint": "hex64" } }。
 * 可选；没有这一段 = 该游戏的 mod 授权申请会明确报「本机配置不完整」，其它产品不受影响。
 * 每个产品单独校验，一个写坏了只坏它自己。
 */
export function parseModKeyPins(raw: unknown): Record<string, CardModKeyPin> {
  const pins: Record<string, CardModKeyPin> = {}
  if (raw === undefined || raw === null) return pins
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { '*': { error: 'modPublicKeys 必须是对象' } }
  for (const [product, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MOD_PRODUCT_RE.test(product)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      pins[product] = { error: `modPublicKeys["${product}"] 必须是对象` }
      continue
    }
    const v = value as Record<string, unknown>
    const pin: CardModKeyPin = {}
    if (v.keyXml !== undefined) {
      if (!isModKeyXml(v.keyXml)) {
        pins[product] = { error: `modPublicKeys["${product}"].keyXml 不是合法的 <RSAKeyValue> 公钥` }
        continue
      }
      pin.keyXml = v.keyXml
    }
    if (v.fingerprint !== undefined) {
      const fp = typeof v.fingerprint === 'string' ? v.fingerprint.trim().toLowerCase() : ''
      if (!MOD_KEY_FINGERPRINT_RE.test(fp)) {
        pins[product] = { error: `modPublicKeys["${product}"].fingerprint 必须是 64 位十六进制` }
        continue
      }
      pin.fingerprint = fp
    }
    if (!pin.keyXml && !pin.fingerprint) {
      pins[product] = { error: `modPublicKeys["${product}"] 至少要给 keyXml 或 fingerprint` }
      continue
    }
    if (pin.keyXml && pin.fingerprint && modKeyFingerprint(pin.keyXml) !== pin.fingerprint) {
      pins[product] = { error: `modPublicKeys["${product}"] 的公钥与指纹不一致` }
      continue
    }
    pins[product] = pin
  }
  return pins
}

function parseIdentityMode(raw: unknown): CardIdentityMode | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (raw === 'existing' || raw === 'local') return raw
  throw new Error('identityMode 只能是 existing 或 local')
}

export function parseCardProviderConfig(text: string, source: CardProviderSource = 'userData'): CardProviderConfig {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { enabled: true, error: '授权来源配置不是合法 JSON', source }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: true, error: '授权来源配置格式不正确', source }
  const v = value as Record<string, unknown>
  if (v.provider !== 'card') return { enabled: true, error: '授权来源配置的 provider 不是 card', source }
  try {
    // origin / baseUrl 两个名字都认（root 打包的公共配置用 baseUrl）；同时给时必须一致
    const origin = normalizeCardBaseUrl(v.baseUrl !== undefined ? v.baseUrl : v.origin)
    if (v.baseUrl !== undefined && v.origin !== undefined && normalizeCardBaseUrl(v.origin) !== origin) throw new Error('origin 与 baseUrl 不一致')
    const official = origin === CARD_SERVICE_URL
    return {
      enabled: true,
      origin,
      publicKey: normalizeCardPublicKey(v.publicKey),
      modKeys: parseModKeyPins(v.modPublicKeys),
      source,
      official,
      identityMode: parseIdentityMode(v.identityMode),
      // 迁移只对「随包默认文件 + 官方地址」放行；显式文件里写了也不算（那是主播 / 测试自己配的来源）
      migrateLegacyCredentials: v.migrateLegacyCredentials === true && source === 'resources' && official
    }
  } catch (e) {
    return { enabled: true, error: '授权来源配置无效：' + (e instanceof Error ? e.message : String(e)), source }
  }
}

function readConfigFile(file: string, source: CardProviderSource): CardProviderConfig {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch {
    return { enabled: true, error: '授权来源配置无法读取：' + file, source }
  }
  return parseCardProviderConfig(text, source)
}

/**
 * 本机是否只有旧版「本地用户名账号」：users.json 里有账号、但没有任何一个是邮箱账号，
 * 且旧「记住密码」里也没有邮箱。这种主播从没用过邮箱身份，随包默认平台不能悄悄把他们的账号藏起来。
 * 只要出现任何一个邮箱身份（users.json 的 email 字段 / 邮箱形式的用户名 / creds.json 里的邮箱），就按正常主播进平台。
 */
export function legacyLocalAccountsOnly(): boolean {
  const users = readJson<User[]>('users', [])
  if (!Array.isArray(users) || users.length === 0) return false
  const hasEmailUser = users.some((u) => u && (typeof u.email === 'string' && u.email ? true : EMAIL_RE.test(String(u.username ?? ''))))
  if (hasEmailUser) return false
  const creds = readJson<{ map?: Record<string, string> }>('creds', {})
  const keys = creds && creds.map && typeof creds.map === 'object' ? Object.keys(creds.map) : []
  return !keys.some((k) => EMAIL_RE.test(k))
}

function resolve(): CardProviderConfig {
  const explicit = cardProviderPath()
  if (fs.existsSync(explicit)) return readConfigFile(explicit, 'userData')
  const fallback = defaultCardProviderPath()
  if (fallback && fs.existsSync(fallback)) {
    const config = readConfigFile(fallback, 'resources')
    // 默认文件坏了也算「配置了但无效」：明确报错，不悄悄回退旧服务器
    if (config.enabled && !config.error && legacyLocalAccountsOnly()) return { enabled: false, legacyHold: 'local-accounts', defaultAvailable: true }
    return config
  }
  return { enabled: false }
}

/** 读一次并缓存：来源是安装时写入的，运行中不热切换（切换来源必须重启，避免半程换源）。 */
export function loadCardProviderConfig(): CardProviderConfig {
  if (cached) return cached
  cached = resolve()
  return cached
}

/** 是否启用卡密平台（含配置无效的情况：无效也不回退旧服务器）。 */
export function cardModeEnabled(): boolean {
  return loadCardProviderConfig().enabled
}

/**
 * legacyHold 的主播明确选择切换：把随包默认配置原样写成本机显式配置（重启后生效）。
 * 只在「没有显式文件 + 默认文件存在且合法」时允许；不删旧账号、不动旧配置，只是让下次启动走平台。
 */
export function adoptDefaultCardProvider(): { ok: boolean; error?: string; restart?: boolean } {
  const explicit = cardProviderPath()
  if (fs.existsSync(explicit)) return { ok: false, error: '本机已有显式授权来源配置，无需切换' }
  const fallback = defaultCardProviderPath()
  if (!fallback || !fs.existsSync(fallback)) return { ok: false, error: '安装包里没有默认授权来源配置' }
  const config = readConfigFile(fallback, 'resources')
  if (!config.enabled || config.error) return { ok: false, error: config.enabled ? config.error : '默认授权来源配置无效' }
  try {
    const temp = explicit + '.' + process.pid + '.tmp'
    fs.writeFileSync(temp, fs.readFileSync(fallback), { flag: 'wx' })
    fs.renameSync(temp, explicit)
  } catch (e) {
    return { ok: false, error: '写入授权来源配置失败：' + (e instanceof Error ? e.message : String(e)) }
  }
  return { ok: true, restart: true }
}
