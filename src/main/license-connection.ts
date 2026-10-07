// 卡密平台连接（自 卡密系统/client-preview/src/main/license.ts 移植，已通过该处的连接单测）：
//   登录 / 注册 / 找回密码 / 退出 / 会话 / 兑换 / 在线授权。
//   授权 = 每次向平台要一张带本次随机 nonce 的 Ed25519 签名租约，本地用固定公钥验签，
//   同时核对 issuer / audience / 账号 / 产品 / 设备哈希 / 签发与到期时间 / 时钟跳变；
//   任何一项不对、断网、5xx、401 一律拒绝，并触发 denied 回调关掉正在输出的东西。
//   epoch：登录 / 退出 / 会话失效都会 +1，在途请求回来后发现 epoch 变了就作废，
//   防止「验证通过后换了账号，旧账号的许可继续执行」。
// 地址：base = 平台基地址（可带子路径，如 https://47.251.93.171:8770/card），所有接口都是 base + '/api/v1/…'，子路径不会丢。
//   证书：调用方把 server-tls.ts 的指纹校验装到传进来的 Session 上（47.251.93.171 钉指纹，其它主机走系统 CA）。
// 平台元信息 GET /api/v1/config：identity_mode（existing = 正式，复用原邮箱身份服务；local = 本机测试）与
//   registration_requires_code。读不到时按「需要验证码」处理，绝不假设是本机模式。
import { createPublicKey, randomBytes, randomUUID, verify, createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Session } from 'electron'
import type { CardSnapshot, CardRight, RoomQuotaState } from '@shared/types'
import { isModKeyXml, modKeyFingerprint, verifyModLease, type ModLeaseClaims } from './mod-lease-verify'
import { normalizeCardBaseUrl, type CardIdentityMode } from './card-provider'
import { readJson, writeJson } from './db'
import { logLine } from './crash-log'
import { cardMachineId } from './machine-id'

export const CARD_PLATFORM_PRODUCT = 'platform:assistant'
export const CARD_PRODUCTS = [CARD_PLATFORM_PRODUCT, 'game:librarian', 'game:dontscream', 'game:4wheel-challenge'] as const
/** 辅助转发（平台代调原邮箱服务）的操作白名单：POST /api/v1/compat/<operation>，服务端同名白名单 */
export const COMPAT_OPERATIONS = ['notify', 'config-save', 'config-get', 'heartbeat', 'live-events'] as const
export type CompatOperation = (typeof COMPAT_OPERATIONS)[number]

const REQUEST_TIMEOUT_MS = 8000
const META_CACHE_MS = 60_000
/** 与平台和 Mod 授权一致：抖音直播间号可以是字母、数字、下划线、连字符（不少主播的房号带字母），1～64 位。 */
export const ROOM_ID_RE = /^[0-9A-Za-z_-]{1,64}$/
/** 登录前的入口接口：401 是「账号 / 密码 / 验证码不对」，不是会话失效，不能触发 denied */
const ENTRY_PATHS = new Set(['/api/v1/login', '/api/v1/register', '/api/v1/reset-password', '/api/v1/send-code'])

// ---- 离线凭证（2026-09-14）----
// 平台连不上时靠它：平台在线时随 /me、/authorize 下发的 Ed25519 签名凭证（绑定 账号 + 产品 + 本机机器码 + 邮箱），
// 本机用内置公钥验签、看到期时间就能放行；改本地文件伪造不出来（没有平台私钥）。替代 0.3.56 的明文权益缓存。
//   · 文件 data/card-offline-leases.json：{origin,user,emailHash,machine,verifier,leases{产品→凭证},rights（只做显示）}
//   · 离线登录：平台连不上时拿邮箱 + 密码（本机 scrypt 核对）+ 本机凭证登录，之后每分钟试着重新联系平台，
//     联系上就自动切回在线；平台明确拒绝（密码不对 / 停用）才关。
//   · 本机没有凭证（文件丢了 / 过期）时再试更新源上的镜像包（平台 lease_mirror.py 定期发到 OSS）。
const OFFLINE_AUDIENCE = 'zhiliao-client-offline'
const OFFLINE_FILE = 'card-offline-leases'
const OFFLINE_MAX_SECONDS = 366 * 24 * 3600
const RELOGIN_MIN_GAP_MS = Math.max(5000, Number(process.env.ZL_CARD_RELOGIN_MS) || 60_000)
/** 免费模式下平台明确不认自动登录（改过密码 / 账号没了）：不再每分钟打扰平台，隔这么久再试 */
const REJECTED_RELOGIN_GAP_MS = Math.max(RELOGIN_MIN_GAP_MS, 10 * 60_000)

// ---- 免费模式（license-policy enforce=false，2026-10-07 用户：「就是免费软件来着，即使我们服务器挂了，软件也要可以正常使用的」
//      「千万不要干扰直播」「不要有任何的掉授权行为」）----
//   · 平台那边的任何拒绝 / 登录失效（401）都不关输出、不退出账号：401 时用内存里的密码静默重登再重试一次，重登不上就转本机登录；
//   · 平台没法用（断网 / 超时 / 5xx / 应答坏了）时登录不要任何凭证，直接进软件（localLogin），之后每分钟试着真登录；
//   · 只有主播自己点「退出 / 切换账号」才关输出（denied('user')）。
export interface LicenseConnectionOptions {
  /** 现在是不是免费模式（每次现读，开关改了立刻生效） */
  free?: () => boolean
  /** 本机账号表里这个邮箱的账号 id：平台连不上、这台电脑又没有登录记录时，用它当本次登录的账号 id */
  localId?: (email: string) => string | undefined
  /** 本机登录中重新联系上平台（自动登录成功）后调一次：把这段时间本机做的绑定补报上去 */
  onReconnect?: () => void
}
/** denied 回调的来由：user = 主播自己退出 / 切换账号；platform = 平台拒绝或登录失效（免费模式下不关输出） */
export type DeniedReason = 'user' | 'platform'

/** 平台这次是「没法用」而不是「明确说不行」：网络错误 / 超时 / 应答坏了 / 5xx / 429 */
export function platformUnavailable(error: unknown): boolean {
  if (error instanceof PlatformError) return error.status >= 500 || error.status === 429
  return isTransientError(error)
}
const MIRROR_BASE = (process.env.ZL_LEASE_MIRROR_URL || 'https://zhiliaohou.oss-cn-beijing.aliyuncs.com/').replace(/\/?$/, '/')

interface OfflineClaims {
  sub: string
  email_hash: string
  product_id: string
  machine: string
  permanent: boolean
  right_exp: number | null
  iat: number
  exp: number
}
interface OfflineStore {
  origin: string
  user: string
  emailHash: string
  machine: string
  /** 本机 scrypt 核对密码用（离线登录时平台不在，只能本机核对）；只有在线登录成功过才有 */
  verifier?: { salt: string; hash: string }
  leases: Record<string, string>
  /** 显示用的权益摘要（离线快照里的名字 / 期限）；放行只看 leases */
  rights: CardRight[]
  at: number
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
function emailHashOf(email: string): string {
  return sha256(email.trim().toLowerCase())
}
function saneRight(raw: unknown): CardRight | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id, name: typeof r.name === 'string' ? r.name : r.id, kind: typeof r.kind === 'string' ? r.kind : '',
    status: typeof r.status === 'string' ? r.status : '', permanent: r.permanent === true,
    expires_at: typeof r.expires_at === 'number' ? r.expires_at : null, allowed: r.allowed === true,
    reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : []
  }
}

/** 平台明确拒绝时带上它的错误码（如 room_slot_card_required / room_not_bound / invalid_code），调用方按码分流；文案给主播看。 */
export class PlatformError extends Error {
  constructor(message: string, readonly status: number, readonly code = '') {
    super(message)
  }
}

/** 瞬时错误 = 不是平台明确拒绝、也不是会话 / 签名 / 时钟问题：超时、断网、5xx、应答不是 JSON 之类。 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof PlatformError) return false
  const message = error instanceof Error ? error.message : String(error)
  return !/登录已失效|登录状态已变化|请先登录|签名|不匹配|过期或系统时间/.test(message)
}

export function platformErrorCode(error: unknown): string {
  return error instanceof PlatformError ? error.code : ''
}

/** 平台元信息（注册 / 找回密码要不要验证码）。 */
export interface PlatformMeta {
  identityMode?: CardIdentityMode
  registration: boolean
  registrationRequiresCode: boolean
  /** true = 从平台读到的；false = 平台没回 / 读失败，按文件声明 + 保守值 */
  fromServer: boolean
}

/** 平台 room_quota → RoomQuotaState；字段缺失或类型不对一律拒绝（不给界面看一个半真半假的额度）。 */
export function parseRoomQuota(raw: unknown): RoomQuotaState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('平台未返回直播间名额')
  const v = raw as Record<string, unknown>
  const int = (key: string): number => {
    const n = v[key]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error('平台直播间名额数据无效：' + key)
    return n
  }
  const rooms = Array.isArray(v.rooms) ? v.rooms.map((r) => String(r)) : null
  if (!rooms || rooms.some((r) => !ROOM_ID_RE.test(r))) throw new Error('平台直播间名额数据无效：rooms')
  const bindings = Array.isArray(v.bindings)
    ? v.bindings.map((b) => {
        const item = b as Record<string, unknown>
        const slot = item?.slot
        const room = String(item?.room ?? '')
        if (typeof slot !== 'number' || !Number.isInteger(slot) || !ROOM_ID_RE.test(room)) throw new Error('平台直播间名额数据无效：bindings')
        return { slot, room }
      })
    : []
  const empty_slots = v.empty_slots === undefined ? undefined : (() => {
    if (!Array.isArray(v.empty_slots)) throw new Error('平台直播间名额数据无效：empty_slots')
    return v.empty_slots.map((b) => {
      const item = b as Record<string, unknown>
      const slot = item?.slot
      const last_room = item?.last_room
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || (last_room !== null && (typeof last_room !== 'string' || !ROOM_ID_RE.test(last_room)))) throw new Error('平台直播间名额数据无效：empty_slots')
      return { slot, last_room: last_room as string | null }
    })
  })()
  return { capacity: int('capacity'), changes_left: int('changes_left'), changes_used: int('changes_used'), available: int('available'), rooms: [...new Set(rooms)], bindings, ...(empty_slots === undefined ? {} : { empty_slots }) }
}

/**
 * /api/v1/config 应答 → PlatformMeta。缺 registration_requires_code 的旧平台：identity_mode=local 才算不要验证码，
 * 其它一律「需要」（正式平台复用原邮箱身份服务，注册 / 找回都要邮箱验证码，不能让人凭邮箱抢占旧账号）。
 */
export function parsePlatformMeta(raw: unknown, declared?: CardIdentityMode): PlatformMeta {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const mode = v.identity_mode === 'existing' || v.identity_mode === 'local' ? v.identity_mode : declared
  const requires = typeof v.registration_requires_code === 'boolean' ? v.registration_requires_code : mode !== 'local'
  return { identityMode: mode, registration: v.registration !== false, registrationRequiresCode: requires, fromServer: true }
}

export function conservativeMeta(declared?: CardIdentityMode): PlatformMeta {
  return { identityMode: declared, registration: true, registrationRequiresCode: declared !== 'local', fromServer: false }
}

export class LicenseConnection {
  private csrf = ''
  private user: { id: string; email: string } | null = null
  // 离线凭证（见文件头注释）：平台连不上时，验过签、没到期的凭证照常放行，绝不因为网络断而停播；
  // 平台明确拒绝（PlatformError）/ 下一次 /me 不再下发 → 删掉，下次联系上平台会覆盖。用户 2026-09-13：「给永久卡的就不用问授权了，除非我发信号封了」。
  private offlineStore: OfflineStore | null = readJson<OfflineStore | null>(OFFLINE_FILE, null)
  /** 离线登录中：平台没联系上，靠本机凭证放行；每分钟试着用记住的密码重新登录，成功即切回在线 */
  private offline: { password: string; since: number; lastRelogin: number; unverified: boolean; rejected?: boolean } | null = null
  /** 免费模式：本次登录用的密码（只在内存里，退出 / 换号即清）。平台登录失效时静默重登用 */
  private secret = ''
  private reloginWork: Promise<boolean> | null = null
  private offlineGraceLoggedAt = 0
  private machineId = ''
  private machineHash = ''
  private readonly machineWork: Promise<void>
  private epoch = 0
  private pending = new Map<string, Promise<void>>()
  private authWork: Promise<unknown> = Promise.resolve()
  private key: ReturnType<typeof createPublicKey>
  private metaCache: { at: number; value: PlatformMeta } | undefined
  private metaWork: Promise<PlatformMeta> | undefined
  readonly device = randomBytes(24).toString('hex')
  /** 平台基地址（含子路径，无尾部斜杠）；沿用 origin 这个名字是为了让旧调用方不用改 */
  readonly origin: string

  constructor(
    baseUrl: string,
    publicKey: string,
    private browserSession: Session,
    private denied: (reason: DeniedReason) => void,
    private declaredMode?: CardIdentityMode,
    private options: LicenseConnectionOptions = {}
  ) {
    this.origin = normalizeCardBaseUrl(baseUrl)
    const key = Buffer.from(publicKey, 'base64url')
    if (key.length !== 32) throw new Error('平台公钥无效')
    this.key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]),
      type: 'spki',
      format: 'der'
    })
    // 机器码读不到只是拿不到离线凭证（在线授权照常），不能影响启动
    this.machineWork = cardMachineId()
      .then((id) => { this.machineId = id; this.machineHash = sha256(id) })
      .catch((error) => logLine('card', '读不到本机机器码，离线凭证不可用（在线授权不受影响）：' + (error instanceof Error ? error.message : String(error))))
  }

  /** 当前登录账号（同步读，给 session 查询用）。 */
  currentUser(): { id: string; email: string } | null {
    return this.user ? { ...this.user } : null
  }

  /** 是不是正靠本机登录在用（平台暂时联系不上 / 平台不认自动登录）；给界面提示用 */
  usingLocalLogin(): boolean {
    return !!this.offline
  }

  private free(): boolean {
    try {
      return this.options.free?.() === true
    } catch {
      return false
    }
  }

  /** 最近一次读到的平台元信息（同步）；还没读过 / 读失败 → 保守值。 */
  metaSync(): PlatformMeta {
    return this.metaCache?.value ?? conservativeMeta(this.declaredMode)
  }

  /** 读平台元信息（60 秒缓存；在途合并）。读不到不抛错，回保守值 —— 页面据此决定要不要验证码栏。 */
  async meta(force = false): Promise<PlatformMeta> {
    if (!force && this.metaCache && Date.now() - this.metaCache.at < META_CACHE_MS) return this.metaCache.value
    if (this.metaWork) return this.metaWork
    this.metaWork = (async () => {
      try {
        const reply = await this.request('/api/v1/config')
        const value = parsePlatformMeta(reply, this.declaredMode)
        this.metaCache = { at: Date.now(), value }
        return value
      } catch {
        // 旧平台没有 /config、网络抖动：不缓存失败，按文件声明 + 保守值
        return conservativeMeta(this.declaredMode)
      } finally {
        this.metaWork = undefined
      }
    })()
    return this.metaWork
  }

  private url(path: string): string {
    if (!path.startsWith('/')) throw new Error('接口路径无效')
    return this.origin + path
  }

  private async request(path: string, body?: unknown, extraHeaders: Record<string, string> = {}, retried = false): Promise<Record<string, any>> {
    // 离线登录中：没有平台会话，先试着重新登录（一分钟最多一次），没联系上就按瞬时错误抛，绝不带着空会话去打接口（会 401 → 关输出）
    if (this.offline && path !== '/api/v1/login' && !(await this.relogin())) throw new Error('平台暂时联系不上，稍后会自动重试')
    const epoch = this.epoch
    // 机器码头：平台据此下发绑定本机的离线凭证；读不到机器码就不带（平台照常应答，只是没有离线凭证）
    if (!this.machineId && (path === '/api/v1/me' || path === '/api/v1/authorize')) await this.machineWork
    const machine: Record<string, string> = this.machineId && (path === '/api/v1/me' || path === '/api/v1/authorize') ? { 'X-Machine-Id': this.machineId } : {}
    const response = await this.browserSession.fetch(this.url(path), {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}), ...machine, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    const text = await response.text()
    if (text.length > 1048576) throw new Error('服务响应过大')
    let value: Record<string, any>
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error('平台响应无效（' + response.status + '）')
    }
    if (epoch !== this.epoch) throw new Error('登录状态已变化')
    if (response.status === 401) {
      if (ENTRY_PATHS.has(path)) {
        throw new PlatformError(typeof value.error === 'string' && value.error ? value.error : '账号或密码不正确', 401, typeof value.code === 'string' ? value.code : '')
      }
      if (this.free() && this.user) {
        // 免费模式：平台登录失效只影响这一次「向平台上报」，绝不关输出、不退出账号。
        // 用内存里的密码静默重登一次再重试；重登不上就转成本机登录（之后每分钟试一次），这次按网络问题报
        this.csrf = ''
        // 几个后台请求同时 401：共用同一份本机登录状态（换成新的会让正在进行的那次重登以为自己过期了）
        if (!this.offline) this.offline = { password: this.secret, since: Date.now(), lastRelogin: 0, unverified: false }
        if (!retried && this.secret && (await this.relogin().catch(() => false)) && epoch === this.epoch) {
          return this.request(path, body, extraHeaders, true)
        }
        throw new Error('平台暂时联系不上，稍后会自动重试')
      }
      // 平台明确说会话失效 / 账号停用：本机离线凭证一并作废（下次在线登录会重新拿）
      this.dropOffline()
      this.invalidate()
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok || value.ok !== true) {
      // 平台明确说「不允许」时把原因带上（如 no_entitlement / expired / account_banned），主播才知道该兑换还是该找作者
      const reasons = value.allowed === false && Array.isArray(value.reasons) ? value.reasons.map(String).filter(Boolean) : []
      throw new PlatformError(
        value.error || (reasons.length ? '授权未通过：' + reasons.join('、') : '授权不可用，功能已封锁'),
        response.status,
        typeof value.code === 'string' ? value.code : ''
      )
    }
    return value
  }

  /** 当前会话的直播间名额（GET /api/v1/rooms）。平台没上这个接口 / 未登录都抛错，不用本机数据顶替。 */
  async rooms(): Promise<RoomQuotaState> {
    if (!this.user) throw new Error('请先登录平台账号')
    const epoch = this.epoch
    const reply = await this.request('/api/v1/rooms')
    if (epoch !== this.epoch || !this.user) throw new Error('登录状态已变化')
    return parseRoomQuota(reply.room_quota)
  }

  /** 绑定 / 改绑 / 解绑：cookie + CSRF + Idempotency-Key；名额与改绑次数在平台事务里扣，回最新 room_quota。 */
  async roomCommit(action: 'bind' | 'replace' | 'unbind', payload: { room: string; previous?: string }, idempotencyKey: string = randomUUID()): Promise<RoomQuotaState> {
    if (!this.user) throw new Error('请先登录平台账号')
    if (!ROOM_ID_RE.test(payload.room)) throw new Error('直播间号格式不正确')
    const body = action === 'replace' ? { previous: payload.previous, room: payload.room } : { room: payload.room }
    if (action === 'replace' && !ROOM_ID_RE.test(String(payload.previous ?? ''))) throw new Error('原直播间号格式不正确')
    const epoch = this.epoch
    const user = this.user.id
    const reply = await this.request('/api/v1/rooms/' + action, body, { 'Idempotency-Key': idempotencyKey })
    if (epoch !== this.epoch || !this.user || this.user.id !== user) throw new Error('登录状态已变化')
    return parseRoomQuota(reply.room_quota)
  }

  private invalidate(reason: DeniedReason = 'platform'): void {
    this.epoch++
    this.user = null
    this.csrf = ''
    this.secret = ''
    this.offline = null
    this.pending.clear()
    this.denied(reason)
  }

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const work = this.authWork.then(run, run)
    this.authWork = work.catch(() => {})
    return work
  }

  private async clearSession(csrf: string): Promise<void> {
    try {
      if (csrf) {
        await this.browserSession.fetch(this.url('/api/v1/logout'), {
          method: 'POST',
          credentials: 'include',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: '{}',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
      }
    } catch {
      /* 断网也必须清除本机身份，不能恢复旧会话。 */
    } finally {
      await this.browserSession.clearStorageData()
    }
  }

  logout(): Promise<void> {
    const csrf = this.csrf
    // 主动退出：本机离线凭证一并删掉（换号 / 借机器给别人用，旧账号的离线授权不能留在这台机器上）。
    // 免费模式：凭证不代表任何权益，留着这台电脑的密码核对记录——服务器挂着时下次登录还能核对密码（防手误）
    if (!this.free()) this.dropOffline()
    this.invalidate('user')
    return this.serialized(() => this.clearSession(csrf))
  }

  /** 删掉本机账号记录时：这个邮箱在这台电脑上的登录记录 / 离线凭证一并删掉 */
  forgetAccount(email: string): void {
    if (this.offlineStore && this.offlineStore.emailHash === emailHashOf(email)) this.dropOffline()
  }

  /**
   * 发邮箱验证码（注册 / 找回密码前）。不需要登录；平台在本机模式（不发验证码）时会明确拒绝。
   * 返回平台原样的 ok 应答（可能带 cooldown 之类的提示字段）。
   */
  async sendCode(email: string): Promise<Record<string, unknown>> {
    if (typeof email !== 'string' || !email || email.length > 254) throw new Error('邮箱格式不正确')
    return this.request('/api/v1/send-code', { email })
  }

  /** 登录 / 注册：注册在正式模式要带邮箱验证码（code）；本机模式平台不看 code，留空即可。 */
  login(email: string, password: string, register = false, code = ''): Promise<CardSnapshot> {
    const body: Record<string, string> = { email, password }
    if (register && code) body.code = code
    return this.authenticate(register ? '/api/v1/register' : '/api/v1/login', body)
  }

  /** 找回密码：邮箱验证码 + 新密码；平台像登录一样直接返回会话（cookie / csrf / user 与 login 一致）。 */
  resetPassword(email: string, code: string, password: string): Promise<CardSnapshot> {
    if (typeof code !== 'string' || !code.trim() || code.length > 32) throw new Error('请填写邮箱收到的验证码')
    return this.authenticate('/api/v1/reset-password', { email, code: code.trim(), password })
  }

  private async authenticate(path: string, body: Record<string, string>): Promise<CardSnapshot> {
    const { email, password } = body
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 128) {
      throw new Error('账号或密码格式不正确')
    }
    const csrf = this.csrf
    this.invalidate('user')
    const epoch = this.epoch
    return this.serialized(async () => {
      try {
        await this.clearSession(csrf)
        if (epoch !== this.epoch) throw new Error('登录状态已变化')
        // 主播身份独立于同邮箱的发卡管理员身份；服务端把此会话限制为客户端用途。
        const reply = await this.request(path, { ...body, audience: 'client' })
        if (epoch !== this.epoch) throw new Error('登录状态已变化')
        if (typeof reply.csrf !== 'string' || !reply.user || typeof reply.user.id !== 'string' || typeof reply.user.email !== 'string') {
          throw new Error('平台登录响应无效')
        }
        this.csrf = reply.csrf
        this.user = { id: reply.user.id, email: reply.user.email }
        this.secret = password
        // 在线登录成功：记下密码的 scrypt 核对值，平台连不上时离线登录靠它核对（不存密码本身）
        this.rememberVerifier(reply.user.id, reply.user.email, password)
        if (this.free()) {
          // 免费模式：登录成功就算进来了；紧接着读 /me（顺带拿离线凭证）没读到也不影响使用
          try {
            return await this.state()
          } catch {
            return this.withMeta({ ok: true, enabled: true, origin: this.origin, user: { ...this.user } }, this.metaSync())
          }
        }
        return await this.state()
      } catch (error) {
        let failure: unknown = error
        // 平台联系不上（不是「密码不对」这类明确拒绝）：本机有这个邮箱的签名凭证 → 离线登录，主播照样能开播
        if (epoch === this.epoch && path === '/api/v1/login' && isTransientError(error)) {
          try {
            const snapshot = await this.offlineLogin(email, password, error)
            if (snapshot) return snapshot
          } catch (e) {
            failure = e   // 本机核对密码不对：当成明确拒绝报给主播，不再用原来的网络错误
          }
        }
        // 免费模式：平台没法用（不是「密码不对」这类明确拒绝）→ 不要任何凭证，直接本机登录进软件，功能照常
        if (epoch === this.epoch && failure === error && this.free() && path !== '/api/v1/reset-password' && platformUnavailable(error)) {
          try {
            return await this.localLogin(email, password, error)
          } catch (e) {
            failure = e
          }
        }
        if (epoch === this.epoch) this.invalidate('user')
        await this.browserSession.clearStorageData()
        throw failure
      }
    })
  }

  /**
   * 免费模式下平台没法用时的登录：不要任何凭证，直接进软件。这台电脑记过这个邮箱的密码核对值就核对一下（防手误），
   * 没记过（这台电脑第一次登这个号）也放行。账号 id 用这台电脑上次登录记下的，没有就看本机账号表，都没有按邮箱算一个本机 id。
   * 之后每分钟试着真登录一次，联系上就切回在线（上报直播间、通知等辅助功能恢复）。
   */
  private async localLogin(email: string, password: string, cause: unknown): Promise<CardSnapshot> {
    const emailHash = emailHashOf(email)
    const store = this.offlineStore
    let id = ''
    let verified = false
    if (store && store.origin === this.origin && store.emailHash === emailHash && store.verifier) {
      if (!this.checkVerifier(store.verifier, password)) {
        throw new PlatformError('账号或密码不正确（服务器暂时连不上，按这台电脑上次登录的记录核对）', 401, 'invalid_login')
      }
      id = store.user
      verified = true
    }
    if (!id) {
      try {
        id = this.options.localId?.(email) || ''
      } catch {
        id = ''
      }
    }
    if (!id) id = 'local-' + emailHash.slice(0, 24)
    this.user = { id, email }
    this.csrf = ''
    this.secret = password
    this.offline = { password, since: Date.now(), lastRelogin: Date.now(), unverified: !verified }
    const message = cause instanceof Error ? cause.message : String(cause)
    logLine('card', `平台暂时联系不上（${message}），免费模式直接用本机登录：${email}${verified ? '' : '（这台电脑没有这个账号的登录记录，平台恢复后再核对）'}`)
    return this.withMeta({ ok: true, enabled: true, origin: this.origin, user: { ...this.user }, offline: true }, this.metaSync())
  }

  private withMeta(snapshot: CardSnapshot, meta: PlatformMeta): CardSnapshot {
    snapshot.identityMode = meta.identityMode
    snapshot.registrationRequiresCode = meta.registrationRequiresCode
    return snapshot
  }

  async state(): Promise<CardSnapshot> {
    if (!this.user) {
      const health = await this.request('/health')
      if (health.service !== 'zhiliao-license') throw new Error('卡密平台未连接')
      return this.withMeta({ ok: true, enabled: true, origin: this.origin }, await this.meta())
    }
    // 离线登录中：先试着重新登录（节流），没联系上就给离线快照（权益来自验过签的凭证），不抛错、不 denied
    if (this.offline && !(await this.relogin())) return this.withMeta(this.offlineSnapshot(), this.metaSync())
    try {
      const reply = await this.request('/api/v1/me')
      this.csrf = reply.csrf
      const rights: CardRight[] = Array.isArray(reply.rights)
        ? reply.rights.map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ''),
            name: String(r.name ?? ''),
            kind: String(r.kind ?? ''),
            status: String(r.status ?? ''),
            permanent: r.permanent === true,
            expires_at: typeof r.expires_at === 'number' ? r.expires_at : null,
            allowed: r.allowed === true,
            reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : []
          }))
        : []
      const snapshot: CardSnapshot = { ok: true, enabled: true, origin: this.origin, user: { id: reply.user.id, email: reply.user.email }, rights }
      // 平台随 /me 下发的离线凭证：整套替换（收回 / 到期的产品就不会再有）；老平台没这个字段则不动本机的
      this.absorbLeases(reply.offline_leases, { id: reply.user.id, email: reply.user.email }, rights)
      // 平台 GET me 顺带给 room_quota；没有（旧平台）就不带，界面另走 cardRooms() 读
      if (reply.room_quota !== undefined) {
        try { snapshot.roomQuota = parseRoomQuota(reply.room_quota) } catch { /* 额度数据坏了不影响权益本身 */ }
      }
      return this.withMeta(snapshot, this.metaSync())
    } catch (error) {
      // 只有平台明确拒绝 / 会话失效才算失去授权；网络抖动、超时、5xx 读不到 /me 不能把正在输出的东西全关掉
      //（渲染层每分钟刷一次快照，以前这里一次超时就 denied → 整场直播的输出被关，隔壁主播 2026-09-13 就是这么断的）
      if (!isTransientError(error)) {
        this.denied('platform')
        throw error
      }
      // 平台暂时联系不上：本机有验过签的凭证 → 给离线快照（界面照常显示权益 + 「离线授权中」提示），不抛错
      if (this.validLease(CARD_PLATFORM_PRODUCT)) return this.withMeta(this.offlineSnapshot(), this.metaSync())
      throw error
    }
  }

  async redeem(code: string): Promise<CardSnapshot> {
    if (typeof code !== 'string' || code.length > 100) throw new Error('卡密格式不正确')
    if (!this.user) throw new Error('请先登录平台账号')
    await this.request('/api/v1/redeem', { code })
    return this.state()
  }

  // ================= 离线凭证 =================

  /** 验一张离线凭证：签名 + 签发方 / 受众 / 产品 / 本机机器码 / 账号 / 时效；任何一项不对都抛错。 */
  private verifyOffline(token: unknown, product: string, user?: string): OfflineClaims {
    if (typeof token !== 'string' || !token || token.length > 16384) throw new Error('离线凭证格式错误')
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some((p) => !/^[-_A-Za-z0-9]+$/.test(p))) throw new Error('离线凭证格式错误')
    const [header, payload, signature] = parts
    const meta = JSON.parse(Buffer.from(header, 'base64url').toString())
    if (meta.alg !== 'EdDSA' || meta.typ !== 'JWT' || !verify(null, Buffer.from(header + '.' + payload), this.key, Buffer.from(signature, 'base64url'))) {
      throw new Error('离线凭证签名不正确')
    }
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!this.machineHash) throw new Error('本机机器码不可用')
    if (c.iss !== 'zhiliao-license' || c.aud !== OFFLINE_AUDIENCE || c.product_id !== product || c.machine !== this.machineHash) throw new Error('离线凭证与本机或产品不匹配')
    if (typeof c.sub !== 'string' || !c.sub || (user && c.sub !== user) || typeof c.email_hash !== 'string') throw new Error('离线凭证与当前账号不匹配')
    const now = Date.now() / 1000
    if (!Number.isInteger(c.iat) || !Number.isInteger(c.exp) || c.exp <= now || c.iat > now + 300 || c.exp - c.iat > OFFLINE_MAX_SECONDS) throw new Error('离线凭证已过期或系统时间异常')
    return { sub: c.sub, email_hash: c.email_hash, product_id: c.product_id, machine: c.machine, permanent: c.permanent === true, right_exp: typeof c.right_exp === 'number' ? c.right_exp : null, iat: c.iat, exp: c.exp }
  }

  /** 当前账号在本机的某个产品凭证（验过签、没到期）；没有 / 验不过 → null。 */
  private validLease(product: string): OfflineClaims | null {
    const store = this.offlineStore
    if (!store || !this.user || store.user !== this.user.id || store.origin !== this.origin || !store.leases[product]) return null
    try {
      return this.verifyOffline(store.leases[product], product, store.user)
    } catch {
      return null
    }
  }

  /** 平台连不上（超时 / 断网 / 5xx / 应答坏了）时：本机有这个产品和娱乐助手两张有效凭证 → 放行。 */
  private offlineGrant(product: string, error?: unknown): boolean {
    if (error !== undefined && !isTransientError(error)) return false
    const platform = this.validLease(CARD_PLATFORM_PRODUCT)
    const own = product === CARD_PLATFORM_PRODUCT ? platform : this.validLease(product)
    if (!platform || !own) return false
    if (Date.now() - this.offlineGraceLoggedAt > 60_000) {
      this.offlineGraceLoggedAt = Date.now()
      const message = error instanceof Error ? error.message : error === undefined ? '离线登录中' : String(error)
      logLine('card', `平台暂时联系不上（${message}），按上次授权继续（本机签名凭证，有效到 ${new Date(Math.min(own.exp, platform.exp) * 1000).toLocaleString('zh-CN', { hour12: false })}）：${product}${own.permanent ? '（永久）' : ''}`)
    }
    return true
  }

  private saveOffline(): void {
    try { writeJson(OFFLINE_FILE, this.offlineStore) } catch { /* 存不下只影响下次离线 */ }
  }

  private freshStore(user: { id: string; email: string }): OfflineStore {
    const keep = this.offlineStore && this.offlineStore.user === user.id && this.offlineStore.origin === this.origin ? this.offlineStore : null
    return { origin: this.origin, user: user.id, emailHash: emailHashOf(user.email), machine: this.machineHash, verifier: keep?.verifier, leases: keep ? { ...keep.leases } : {}, rights: keep?.rights ?? [], at: Date.now() }
  }

  /** /me 下发的整套凭证：逐张验签后整套替换；字段缺失（老平台）则不动本机的。 */
  private absorbLeases(raw: unknown, user: { id: string; email: string }, rights: CardRight[]): void {
    if (raw === undefined || !this.machineHash) return
    const store = this.freshStore(user)
    store.leases = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [product, token] of Object.entries(raw as Record<string, unknown>)) {
        if (!(CARD_PRODUCTS as readonly string[]).includes(product)) continue
        try {
          this.verifyOffline(token, product, user.id)
          store.leases[product] = token as string
        } catch (e) {
          logLine('card', `平台下发的离线凭证验不过（${product}）：` + (e instanceof Error ? e.message : String(e)))
        }
      }
    }
    store.rights = rights
    this.offlineStore = store
    this.saveOffline()
  }

  /** /authorize 顺带下发的单张凭证：验过就合并进去（没有就不动）。 */
  private absorbLease(product: string, token: unknown): void {
    if (token === undefined || !this.user || !this.machineHash) return
    try {
      this.verifyOffline(token, product, this.user.id)
    } catch {
      return
    }
    const store = this.freshStore(this.user)
    store.leases[product] = token as string
    this.offlineStore = store
    this.saveOffline()
  }

  /** 平台明确拒绝某产品：这张离线凭证作废（封号 / 收回 / 到期的信号）。 */
  private forgetLease(product: string): void {
    if (!this.offlineStore || !this.offlineStore.leases[product]) return
    const leases = { ...this.offlineStore.leases }
    delete leases[product]
    this.offlineStore = { ...this.offlineStore, leases }
    this.saveOffline()
  }

  private dropOffline(): void {
    this.offline = null
    this.offlineStore = null
    try { writeJson(OFFLINE_FILE, null) } catch { /* ignore */ }
  }

  private rememberVerifier(userId: string, email: string, password: string): void {
    try {
      const salt = randomBytes(16).toString('hex')
      const store = this.freshStore({ id: userId, email })
      store.verifier = { salt, hash: scryptSync(password, salt, 32).toString('hex') }
      this.offlineStore = store
      this.saveOffline()
    } catch (e) {
      logLine('card', '记录离线登录核对值失败（不影响在线使用）：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  private checkVerifier(verifier: { salt: string; hash: string }, password: string): boolean {
    try {
      const got = scryptSync(password, verifier.salt, 32)
      const want = Buffer.from(verifier.hash, 'hex')
      return got.length === want.length && timingSafeEqual(got, want)
    } catch {
      return false
    }
  }

  /**
   * 平台连不上时的登录：本机凭证（邮箱、机器码对得上，密码本机核对）→ 没有再试更新源镜像包。
   * 有效就以凭证里的账号登录（无平台会话），之后每分钟试着真登录一次；一张都没有 → 返回 null，调用方按原来的网络错误处理；
   * 本机核对密码不对 → 抛 PlatformError（当作明确拒绝）。
   */
  private async offlineLogin(email: string, password: string, cause: unknown): Promise<CardSnapshot | null> {
    await this.machineWork
    if (!this.machineHash) return null
    const emailHash = emailHashOf(email)
    let store: OfflineStore | null = this.offlineStore
    let verified = false
    if (store && store.origin === this.origin && store.emailHash === emailHash && store.machine === this.machineHash) {
      if (!store.verifier || !this.checkVerifier(store.verifier, password)) {
        throw new PlatformError('账号或密码不正确（平台暂时联系不上，按本机记录核对）', 401, 'invalid_login')
      }
      verified = true
    } else {
      store = null
    }
    const check = (s: OfflineStore | null): OfflineClaims | null => {
      if (!s) return null
      try {
        const c = this.verifyOffline(s.leases[CARD_PLATFORM_PRODUCT], CARD_PLATFORM_PRODUCT)
        return c.email_hash === emailHash ? c : null
      } catch {
        return null
      }
    }
    let platform = check(store)
    if (!platform) {
      const mirrored = await this.fetchMirror(email).catch((e) => { logLine('card', '更新源上的离线凭证镜像不可用：' + (e instanceof Error ? e.message : String(e))); return null })
      const mirroredClaims = check(mirrored)
      if (!mirrored || !mirroredClaims) return null
      store = { ...mirrored, verifier: store?.verifier }
      platform = mirroredClaims
      verified = false
    }
    const message = cause instanceof Error ? cause.message : String(cause)
    this.user = { id: platform.sub, email }
    this.csrf = ''
    this.offlineStore = store
    this.saveOffline()
    this.offline = { password, since: Date.now(), lastRelogin: Date.now(), unverified: !verified }
    logLine('card', `平台暂时联系不上（${message}），用本机签名凭证离线登录：${email}${verified ? '' : '（本机没有密码核对记录，平台恢复后再核对）'}，凭证有效到 ${new Date(platform.exp * 1000).toLocaleString('zh-CN', { hour12: false })}`)
    return this.withMeta(this.offlineSnapshot(), this.metaSync())
  }

  /** 更新源上的离线凭证镜像包（平台 lease_mirror.py 定期发）：按 邮箱 + 本机机器码 算对象名，验过签的才要。 */
  private async fetchMirror(email: string): Promise<OfflineStore | null> {
    const key = 'updates/leases/' + sha256('zl-offline:' + email.trim().toLowerCase() + ':' + this.machineHash) + '.json'
    const response = await this.browserSession.fetch(MIRROR_BASE + key + '?t=' + Date.now(), { redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) return null
    const text = await response.text()
    if (text.length > 262144) throw new Error('镜像包过大')
    const bundle = JSON.parse(text) as { leases?: unknown; rights?: unknown }
    if (!bundle || typeof bundle !== 'object' || !bundle.leases || typeof bundle.leases !== 'object') return null
    const leases: Record<string, string> = {}
    let sub = ''
    for (const [product, token] of Object.entries(bundle.leases as Record<string, unknown>)) {
      if (!(CARD_PRODUCTS as readonly string[]).includes(product)) continue
      try {
        const c = this.verifyOffline(token, product)
        if (sub && c.sub !== sub) continue
        sub = c.sub
        leases[product] = token as string
      } catch { /* 验不过的不要 */ }
    }
    if (!sub || !leases[CARD_PLATFORM_PRODUCT]) return null
    const rights = Array.isArray(bundle.rights) ? bundle.rights.map(saneRight).filter((r): r is CardRight => !!r) : []
    return { origin: this.origin, user: sub, emailHash: emailHashOf(email), machine: this.machineHash, leases, rights, at: Date.now() }
  }

  /**
   * 离线登录中试着重新登录（一分钟最多一次；在途合并）。成功 → 切回在线，返回 true；
   * 联系不上 → false（继续离线）；平台明确拒绝（密码不对 / 停用）→ 这是封禁信号：删凭证、关输出、抛错。
   */
  private relogin(): Promise<boolean> {
    const off = this.offline
    if (!off || !this.user) return Promise.resolve(true)
    if (this.reloginWork) return this.reloginWork
    if (Date.now() - off.lastRelogin < (off.rejected ? REJECTED_RELOGIN_GAP_MS : RELOGIN_MIN_GAP_MS)) return Promise.resolve(false)
    if (!off.password) return Promise.resolve(false)
    off.lastRelogin = Date.now()
    const epoch = this.epoch
    const user = this.user
    this.reloginWork = (async () => {
      try {
        const reply = await this.request('/api/v1/login', { email: user.email, password: off.password, audience: 'client' })
        if (epoch !== this.epoch || this.offline !== off) return false
        const valid = typeof reply.csrf === 'string' && !!reply.user && typeof reply.user.id === 'string'
        if (!valid || reply.user.id !== user.id) {
          if (this.free() && valid) {
            // 免费模式：当时平台连不上、先用本机账号进的，平台恢复后账号 id 对不上——本次照旧用本机身份，平台会话只用来上报
            logLine('card', '平台恢复后的账号编号和本机记录不同，本次继续用本机身份（重新打开客户端后以平台为准）')
          } else if (this.free()) {
            return false
          } else {
            this.dropOffline()
            this.invalidate()
            throw new Error('登录状态已变化')
          }
        }
        this.csrf = reply.csrf
        if (reply.user.id === user.id) this.user = { id: reply.user.id, email: reply.user.email }
        this.secret = off.password
        this.offline = null
        logLine('card', `重新联系上平台，已切回在线（离线了 ${Math.round((Date.now() - off.since) / 60000)} 分钟）`)
        if (this.options.onReconnect) {
          const hook = this.options.onReconnect
          setImmediate(() => {
            try {
              hook()
            } catch (e) {
              logLine('card', '重新联系上平台后的补报没跑成：' + (e instanceof Error ? e.message : String(e)))
            }
          })
        }
        return true
      } catch (error) {
        if (error instanceof PlatformError) {
          if (this.free()) {
            // 免费模式：平台不认这次自动登录（改过密码 / 账号没了 / 停用）也不关输出、不退出；本机继续正常用，隔一阵再试
            if (!off.rejected) logLine('card', '平台没认这次自动登录（' + error.message + '），本机继续正常使用，稍后再试')
            off.rejected = true
            return false
          }
          logLine('card', '平台恢复后拒绝了本账号（' + error.message + '），已关闭输出')
          this.dropOffline()
          if (epoch === this.epoch) this.invalidate()
          throw error
        }
        if (!isTransientError(error)) {
          if (this.free()) return false
          throw error
        }
        return false
      } finally {
        this.reloginWork = null
      }
    })()
    return this.reloginWork
  }

  /** 离线快照：权益里的 allowed 只来自验过签的凭证；名字 / 种类用上次平台给的摘要。 */
  private offlineSnapshot(): CardSnapshot {
    const user = this.user!
    const store = this.offlineStore
    const platform = this.validLease(CARD_PLATFORM_PRODUCT)
    const base: CardRight[] = store?.rights.length
      ? store.rights
      : CARD_PRODUCTS.map((id) => ({ id, name: id === CARD_PLATFORM_PRODUCT ? '娱乐助手' : id, kind: id === CARD_PLATFORM_PRODUCT ? 'platform' : 'game', status: '', permanent: false, expires_at: null, allowed: false, reasons: [] }))
    const rights = base.map((r) => {
      const lease = this.validLease(r.id)
      const allowed = !!platform && !!lease
      return { ...r, allowed, permanent: lease ? lease.permanent : r.permanent, expires_at: lease ? lease.right_exp : r.expires_at, reasons: allowed ? [] : r.reasons }
    })
    return { ok: true, enabled: true, origin: this.origin, user: { ...user }, rights, offline: true, ...(platform ? { offlineUntil: platform.exp } : {}) }
  }

  /** 在线授权门：通过才返回；不通过抛错。同产品在途请求合并，完成即丢弃（不缓存放行结果）。 */
  async require(product: string): Promise<void> {
    if (!this.user) throw new Error('请先登录平台账号')
    if (!(CARD_PRODUCTS as readonly string[]).includes(product)) throw new Error('未知产品')
    if (this.offline) {
      // 离线登录中：不等重新登录（节流内不发请求；发了也最多等 8 秒），凭证有效就直接放行，礼物触发不能被拖慢
      void this.relogin().catch(() => {})
      if (this.offlineGrant(product)) return
      throw new Error('平台暂时联系不上，且本机没有这项功能的离线授权')
    }
    const epoch = this.epoch
    let work = this.pending.get(product)
    if (!work) {
      const user = this.user.id
      const nonce = randomBytes(32).toString('base64url')
      const start = performance.now()
      const wall = Date.now()
      work = (async () => {
        const reply = await this.request('/api/v1/authorize', { product_id: product, device_id: this.device, nonce })
        if (reply.allowed !== true || typeof reply.lease !== 'string' || reply.lease.length > 16384) throw new Error('未取得有效授权')
        const parts = reply.lease.split('.')
        if (parts.length !== 3 || parts.some((p: string) => !/^[-_A-Za-z0-9]+$/.test(p))) throw new Error('授权签名格式错误')
        const [header, payload, signature] = parts
        const meta = JSON.parse(Buffer.from(header, 'base64url').toString())
        if (meta.alg !== 'EdDSA' || meta.typ !== 'JWT' || !verify(null, Buffer.from(header + '.' + payload), this.key, Buffer.from(signature, 'base64url'))) {
          throw new Error('授权签名不正确')
        }
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
        const now = Date.now() / 1000
        if (
          claims.iss !== 'zhiliao-license' ||
          claims.aud !== 'zhiliao-client' ||
          claims.sub !== user ||
          claims.product_id !== product ||
          claims.nonce !== nonce ||
          claims.device !== createHash('sha256').update(this.device).digest('hex')
        ) {
          throw new Error('授权与当前请求不匹配')
        }
        if (
          !Number.isInteger(claims.iat) ||
          !Number.isInteger(claims.exp) ||
          claims.exp - claims.iat > 300 ||
          claims.iat > now + 300 ||  // 与服务器存在时钟偏差时仍校验有效票据；nonce/签名/到期检查照常。
          claims.exp <= now ||
          performance.now() - start > REQUEST_TIMEOUT_MS + 500 ||
          Math.abs(Date.now() - wall - (performance.now() - start)) > 2000
        ) {
          throw new Error('授权已过期或系统时间异常')
        }
        if (epoch !== this.epoch || !this.user) throw new Error('登录状态已变化')
        // 顺带刷新这个产品的离线凭证（平台带了才有）
        this.absorbLease(product, reply.offline_lease)
      })().catch((error) => {
        // 平台明确拒绝：这张离线凭证作废（封号 / 收回 / 到期的信号）
        if (error instanceof PlatformError) this.forgetLease(product)
        else if (this.offlineGrant(product, error)) return
        if (product === CARD_PLATFORM_PRODUCT) this.denied('platform')
        throw error
      })
      this.pending.set(product, work)
      void work.finally(() => { if (this.pending.get(product) === work) this.pending.delete(product) }).catch(() => {})
    }
    await work
    if (epoch !== this.epoch || !this.user) throw new Error('登录状态已变化')
  }

  /**
   * 辅助转发：平台用当前登录账号 + 服务端加密保存的原邮箱会话去调旧接口（通知 / 云配置 / 心跳 / 观众记录）。
   * 客户端不带任何旧凭据，邮箱由平台按登录账号决定；返回旧接口的原样应答（外层 {ok:true,result} 已剥掉）。
   * 平台拒绝时抛 PlatformError（identity_relogin / identity_not_linked / identity_unavailable / room_not_bound …），
   * 只有平台会话本身失效（401）才会走 invalidate → denied；旧会话失效是 409，不影响卡密授权。
   */
  async compat(operation: CompatOperation, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.user) throw new Error('请先登录平台账号')
    if (!(COMPAT_OPERATIONS as readonly string[]).includes(operation)) throw new Error('未知辅助操作')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('辅助请求格式不正确')
    const epoch = this.epoch
    const user = this.user.id
    const reply = await this.request('/api/v1/compat/' + operation, payload)
    if (epoch !== this.epoch || !this.user || this.user.id !== user) throw new Error('登录状态已变化')
    const result = reply.result
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('平台辅助应答无效')
    return result as Record<string, unknown>
  }

  /** 平台公开的轮椅 mod 验签公钥（C# XML）与指纹；这里只做格式与自洽校验，信不信由调用方的 pin 决定。 */
  async modPublicKey(): Promise<{ keyXml: string; fingerprint: string }> {
    const reply = await this.request('/api/v1/mod-public-key')
    if (!isModKeyXml(reply.key_xml) || typeof reply.fingerprint !== 'string') throw new Error('平台未提供合法的轮椅 mod 公钥')
    if (modKeyFingerprint(reply.key_xml) !== reply.fingerprint.toLowerCase()) throw new Error('平台的轮椅 mod 公钥与其指纹不一致')
    return { keyXml: reply.key_xml, fingerprint: reply.fingerprint.toLowerCase() }
  }

  /**
   * 替轮椅 mod 向平台申请一张短租约（同一登录会话 + CSRF），本地用 keyXml（调用方已按本机 pin 决定）验签，
   * 并核对账号 / 产品 / 直播间 / 机器码 / nonce / 时效；请求前后 epoch 变了（换号 / 退出）一律作废。
   * 只给主进程用：房间号和机器码都由调用方从真实来源读，这里不做任何兜底或伪造。
   */
  async modLease(input: { product: string; room: string; machineId: string; keyXml: string }): Promise<{ lease: string; claims: ModLeaseClaims }> {
    if (!this.user) throw new Error('请先登录平台账号')
    if (!/^game:[a-z0-9-]{1,40}$/.test(input.product)) throw new Error('未知产品')
    if (!ROOM_ID_RE.test(input.room)) throw new Error('直播间号格式不正确（只能是字母、数字、下划线或连字符，1～64 位）')
    if (!/^[A-Za-z0-9-]{8,64}$/.test(input.machineId)) throw new Error('机器码格式不正确')
    const epoch = this.epoch
    const user = this.user.id
    const nonce = randomBytes(32).toString('base64url')
    const start = performance.now()
    const wall = Date.now()
    const reply = await this.request('/api/v1/mod-license', { product_id: input.product, room: input.room, machine_id: input.machineId, nonce })
    if (typeof reply.lease !== 'string' || reply.lease.length > 16384) throw new Error('未取得有效的轮椅授权')
    const claims = verifyModLease(reply.lease, input.keyXml, { sub: user, product: input.product, room: input.room, machineId: input.machineId, nonce })
    if (typeof reply.expires_at === 'number' && reply.expires_at !== claims.exp) throw new Error('轮椅授权到期时间与平台应答不一致')
    if (performance.now() - start > REQUEST_TIMEOUT_MS + 500 || Math.abs(Date.now() - wall - (performance.now() - start)) > 2000) {
      throw new Error('轮椅授权请求耗时异常或系统时间跳变')
    }
    if (epoch !== this.epoch || !this.user || this.user.id !== user) throw new Error('登录状态已变化')
    return { lease: reply.lease, claims }
  }
}
