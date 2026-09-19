// 轮椅 mod 短租约（RS256 JWT）的客户端侧验签：纯逻辑，只依赖 node:crypto，不碰 Electron。
// 规则与 C:\wheellive\mod\CardLicense.cs 的 Verify 一致（mod 自己还会再验一遍；这里先验是为了
// 「不把平台发错的东西写进游戏目录」和「不默默信任另一把公钥」）：
//   · 三段规范 base64url；header 恰为 {alg:RS256,typ:JWT}；RSA-SHA256 / PKCS#1 v1.5 验签
//   · claims 恰为 9 项：iss / aud / sub / product_id / room / machine_id / nonce / iat / exp
//   · sub = 当前账号、product_id / room / machine_id / nonce 与本次请求逐字相同
//   · 0 < exp - iat ≤ 120 秒、iat ≤ now + 300、exp > now
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'

export const MOD_LEASE_ISSUER = 'zhiliao-license'
export const MOD_LEASE_AUDIENCE = 'wheellive-mod'
export const MOD_LEASE_MAX_SEC = 120
export const MOD_LEASE_FUTURE_SKEW_SEC = 300
const MAX_LEASE_LENGTH = 16384
const CLAIM_KEYS = ['iss', 'aud', 'sub', 'product_id', 'room', 'machine_id', 'nonce', 'iat', 'exp'] as const

export interface ModLeaseClaims {
  iss: string
  aud: string
  sub: string
  product_id: string
  room: string
  machine_id: string
  nonce: string
  iat: number
  exp: number
}

export interface ModLeaseExpect {
  sub: string
  product: string
  room: string
  machineId: string
  nonce: string
  /** unix 秒；缺省取本机时间 */
  now?: number
}

const KEY_XML_RE = /^<RSAKeyValue><Modulus>([A-Za-z0-9+/=]+)<\/Modulus><Exponent>([A-Za-z0-9+/=]+)<\/Exponent><\/RSAKeyValue>$/
export const MOD_KEY_FINGERPRINT_RE = /^[0-9a-f]{64}$/

/** 平台的公钥指纹 = sha256(公钥 XML 文本 UTF-8) 的小写 hex（与 mod_signing.fingerprint / C# CardLicense.Fingerprint 同一算法）。 */
export function modKeyFingerprint(keyXml: string): string {
  return createHash('sha256').update(keyXml, 'utf8').digest('hex')
}

export function isModKeyXml(value: unknown): value is string {
  return typeof value === 'string' && KEY_XML_RE.test(value) && value.length <= 4096
}

/** C# RSA.FromXmlString 的 <RSAKeyValue> → node KeyObject（经 JWK：模数 / 指数都是大端无前导零）。 */
export function modKeyFromXml(keyXml: string): KeyObject {
  const match = KEY_XML_RE.exec(keyXml)
  if (!match) throw new Error('轮椅 mod 公钥格式不正确')
  const n = Buffer.from(match[1], 'base64')
  const e = Buffer.from(match[2], 'base64')
  if (n.length < 256 || e.length === 0) throw new Error('轮椅 mod 公钥长度不正确（要求 RSA-2048 以上）')
  return createPublicKey({ key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') }, format: 'jwk' })
}

/** 规范 base64url：只含 [A-Za-z0-9_-]、不带填充、重编码后逐字相同（与 C# B64Url 一致）。 */
function decodeCanonical(part: string): Buffer | null {
  if (!part || part.length > MAX_LEASE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(part) || part.length % 4 === 1) return null
  const raw = Buffer.from(part, 'base64url')
  return raw.toString('base64url') === part ? raw : null
}

function parseJsonObject(raw: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw.toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 验签 + 全部核对；任一项不满足抛 Error（错误文案给主播 / 日志看，不含租约内容）。 */
export function verifyModLease(token: unknown, keyXml: string, expect: ModLeaseExpect): ModLeaseClaims {
  if (typeof token !== 'string' || !token || token.length > MAX_LEASE_LENGTH) throw new Error('轮椅授权格式错误')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('轮椅授权格式错误')
  const header = decodeCanonical(parts[0])
  const payload = decodeCanonical(parts[1])
  const signature = decodeCanonical(parts[2])
  if (!header || !payload || !signature) throw new Error('轮椅授权编码不规范')
  const meta = parseJsonObject(header)
  if (!meta || Object.keys(meta).length !== 2 || meta.alg !== 'RS256' || meta.typ !== 'JWT') throw new Error('轮椅授权算法不正确')
  const key = modKeyFromXml(keyXml)
  const signed = Buffer.from(parts[0] + '.' + parts[1], 'ascii')
  if (!verify('sha256', signed, key, signature)) throw new Error('轮椅授权签名不正确（平台公钥与本机固定的不一致）')
  const claims = parseJsonObject(payload)
  if (!claims || Object.keys(claims).length !== CLAIM_KEYS.length || CLAIM_KEYS.some((k) => !(k in claims))) throw new Error('轮椅授权内容不完整')
  const str = (k: string): string | null => (typeof claims[k] === 'string' ? (claims[k] as string) : null)
  if (str('iss') !== MOD_LEASE_ISSUER || str('aud') !== MOD_LEASE_AUDIENCE) throw new Error('轮椅授权签发方不正确')
  const sub = str('sub')
  if (!sub || sub !== expect.sub) throw new Error('轮椅授权与当前账号不匹配')
  if (str('product_id') !== expect.product) throw new Error('轮椅授权与产品不匹配')
  if (str('room') !== expect.room) throw new Error('轮椅授权与直播间号不匹配')
  if (str('machine_id') !== expect.machineId) throw new Error('轮椅授权与本机机器码不匹配')
  if (str('nonce') !== expect.nonce) throw new Error('轮椅授权与本次请求不匹配')
  const iat = claims.iat
  const exp = claims.exp
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) throw new Error('轮椅授权时间字段不正确')
  const now = Math.floor(expect.now ?? Date.now() / 1000)
  if ((exp as number) - (iat as number) <= 0 || (exp as number) - (iat as number) > MOD_LEASE_MAX_SEC) throw new Error('轮椅授权时长不合法')
  if ((iat as number) > now + MOD_LEASE_FUTURE_SKEW_SEC) throw new Error('轮椅授权签发时间在未来，系统时间异常')
  if (now >= (exp as number)) throw new Error('轮椅授权已过期')
  return {
    iss: MOD_LEASE_ISSUER, aud: MOD_LEASE_AUDIENCE, sub, product_id: expect.product, room: expect.room,
    machine_id: expect.machineId, nonce: expect.nonce, iat: iat as number, exp: exp as number
  }
}

export interface ModKeyPin {
  keyXml?: string
  fingerprint?: string
}

/**
 * 决定用哪把公钥验签：本机固定的 pin 优先；只 pin 了指纹时，平台给的公钥必须算出同一指纹才采用。
 * 没有 pin 一律拒绝——不能因为「平台说这是它的公钥」就信另一把钥。
 */
export function resolvePinnedModKey(pin: ModKeyPin | undefined, fetched?: { keyXml?: unknown; fingerprint?: unknown }): string {
  if (!pin || (!pin.keyXml && !pin.fingerprint)) throw new Error('本机配置不完整：license-provider.json 缺少轮椅 mod 公钥（modPublicKeys）')
  if (pin.keyXml) {
    if (!isModKeyXml(pin.keyXml)) throw new Error('本机配置不完整：轮椅 mod 公钥格式不正确')
    if (pin.fingerprint && modKeyFingerprint(pin.keyXml) !== pin.fingerprint) throw new Error('本机配置不完整：轮椅 mod 公钥与指纹不一致')
    return pin.keyXml
  }
  if (!MOD_KEY_FINGERPRINT_RE.test(pin.fingerprint || '')) throw new Error('本机配置不完整：轮椅 mod 公钥指纹格式不正确')
  if (!fetched || !isModKeyXml(fetched.keyXml)) throw new Error('平台未提供合法的轮椅 mod 公钥')
  if (modKeyFingerprint(fetched.keyXml) !== pin.fingerprint) throw new Error('平台的轮椅 mod 公钥与本机固定指纹不一致，已拒绝')
  return fetched.keyXml
}
