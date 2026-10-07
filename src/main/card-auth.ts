import {ensureCardModSupport} from './card-mod-support'
import {cardEpoch,bumpCardEpoch} from './card-epoch'
import {renewCardModLease,invalidateCardModLease,hasCardModLease,writeFreeModLease} from './card-mod-license'
import {licenseEnforced} from './license-policy'
import {getSettings} from './settings'
// 卡密平台模式的账号层：只在 userData/license-provider.json 存在时生效（见 card-provider.ts）。
//   - 登录 / 注册 / 退出 / 会话 / 兑换 / 授权全部走本机卡密平台（LicenseConnection），不碰旧服务器；
//   - 卡密账号在本地另有一份记录（card_users：昵称 / 头像 / 绑定的直播间），和旧账号 users.json 互不读写；
//   - 「记住密码」按平台来源另开文件，旧服务器存的密码绝不会被读出来送去新平台；
//   - 退出 / 换账号 / 授权被拒 / 平台掉线 → closeAll：关全部输出窗口、清执行队列、停本客户端拉起的连接器（不动游戏进程）；
//   - 有输出在跑时每 2 秒向平台复核一次授权（在途合并，不重复发请求）。
// 旧账号系统的所有代码（auth.ts / license.ts / email-api.ts）在这个模式下一行都不会被调到。
import { session as electronSession, shell } from 'electron'
import { randomUUID, createHash } from 'crypto'
import { createCollection, readJson, writeJson } from './db'
import { createCredStore, credGetUser, type CredStore } from './cred-store'
import { LicenseConnection, CARD_PLATFORM_PRODUCT, CARD_PRODUCTS, PlatformError, platformUnavailable, type DeniedReason } from './license-connection'
import { loadCardProviderConfig, cardModeEnabled, type CardProviderConfig } from './card-provider'
import { installServerCertPin } from './server-tls'
import { logLine } from './crash-log'
import { emitCardAccountChange } from './card-account-events'
import { configCloudLoad, configCloudSave, getNotifications, markNotifyRead, markNotifyReadAll } from './email-api'
import { getMainWindow } from './main-window-ref'
import { currentGameId } from './games'
import { connectorState, stopConnector } from './connector'
import { clearExecQueue, execQueueLength } from './entertainment'
import { danmakuForwardState, stopDanmakuForward } from './danmaku-forward'
import { closeGreenScreen, greenScreenState } from './green-screen'
import { closeTimeWidget, timeLogClose, timeLogOpen, timeLogState, timeWidgetCancelQueue, timeWidgetState } from './time-widget'
import { closeMarquee, marqueeState } from './marquee-widget'
import { challengeWidgetState, closeChallengeWidget } from './challenge-widget'
import { closeVideoWidget, videoWidgetState } from './video-widget'
import { closeLotteryWindow, lotteryState } from './lottery-widget'
import { advancedWheelState, closeAdvancedWheel } from './advanced-wheel'
import { closeEffectsWindow, effectsState } from './effects-widget'
import { closeEntranceWindow, entranceState } from './entrance-widget'
import { closeQueueWindow, queueWidgetState } from './queue-widget'
import { closeWishWindow, wishWindowState } from './wish-widget'
import { closeProgressWindow, progressState } from './progress-widget'
import { closeKeyboardWindow, keyboardWidgetState } from './keyboard-widget'
import { closeProtectWidget, protectWidgetState } from './protect-widget'
import { obsDisconnectNow } from './obs-service'
import {
  Ipc,
  type AuthAccount,
  type AuthResult,
  type BindRoomResult,
  type CardRight,
  type CardSnapshot,
  type EmailAuthResult,
  type EmailLicense,
  type SessionUser,
  type SyncEmailRoomsResult,
  type User
} from '@shared/types'

export { cardModeEnabled } from './card-provider'

/** 授权门未通过：IPC 守卫把它翻译成 {ok:false,code:'license_required',product} 并通知主窗口弹卡密入口。 */
export class NeedsLicense extends Error {
  constructor(readonly product: string, message = '请先激活对应的卡密后使用此功能') {
    super(message)
  }
}

interface CardUser {
  id: string
  origin: string
  email: string
  nickname: string
  avatar: string
  createdAt: number
  lastLoginAt: number
  boundRooms: string[]
}

const GAME_PRODUCTS: Record<string, string> = {
  '4wheel-challenge': 'game:4wheel-challenge',
  dontscream: 'game:dontscream',
  librarian: 'game:librarian'
}
const ROOM_RE = /^[0-9A-Za-z_-]{1,64}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// 2026-09-13 用户：「轮询可以长一些，但网络问题一定不能掉线」。
//   · 定时器 30 秒一跳：轮椅 mod 的短租约（平台签 120 秒、mod 硬编码 MaxLeaseSec=120）每跳续一次，够用且不能再长；
//   · 向平台确认「娱乐助手 / 当前游戏还有授权」每 2 跳（60 秒）一次——原来每 2 秒问一次，一个主播 2 小时能打 3000 多次；
//   · 网络抖动 / 超时 / 连不上平台：只记日志（每分钟最多一条），绝不关输出；只有平台明确拒绝（PlatformError：无授权 / 到期 / 停用）
//     或登录失效才关。轮椅 mod 自己的 120 秒租约到期后由 mod 侧停整蛊，那是下一步要连 mod 一起放长的事。
const RECHECK_MS = Math.max(1000, Number(process.env.ZL_CARD_RECHECK_MS) || 30_000)   // 回归用 ZL_CARD_RECHECK_MS 缩短
const REQUIRE_EVERY_TICKS = 2
let recheckTick = 0
let transientFailures = 0
let lastTransientLogAt = 0

const cardUsers = createCollection<CardUser>('card_users')
/** 旧账号系统的 users.json：这里只读（复制昵称 / 头像、登录页列出旧邮箱账号），绝不写。 */
const legacyUsers = createCollection<User>('users')
const LEGACY_ID_PREFIX = 'legacy:'
let connection: LicenseConnection | null = null
let connectionError = ''
let creds: CredStore | null = null
let recheckTimer: ReturnType<typeof setInterval> | null = null
let checking = false
let denyPending = false

/**
 * 直播间绑定层（card-rooms.ts）挂进来的钩子：绑定 / 解绑 / 同步走平台额度，退出换号时销毁扫码凭证，
 * 复核时确认运行中的连接器所连房间仍在绑定列表里。card-rooms 依赖本模块，所以用钩子而不是反向 import。
 */
export interface CardRoomHooks {
  deny?: () => void
  login?: () => Promise<void>
  recheck?: () => Promise<void>
  bind?: (room: string) => Promise<BindRoomResult>
  unbind?: (room: string) => Promise<BindRoomResult>
  sync?: () => Promise<SyncEmailRoomsResult>
}
let roomHooks: CardRoomHooks = {}
export function registerCardRoomHooks(hooks: CardRoomHooks): void {
  roomHooks = hooks
}

/** 游戏 id → 平台产品 id；不认识的游戏给一个平台一定拒绝的产品名（不会误放行）。 */
export function cardProductForGame(gameId: string): string {
  return GAME_PRODUCTS[gameId] || 'game:' + String(gameId || 'unknown')
}

export function originKey(origin: string): string {
  return createHash('sha256').update(origin).digest('hex').slice(0, 12)
}

/** 给直播间绑定层用的平台连接（未启用 / 配置无效抛错，和其它入口一致）。 */
export function cardConnection(): LicenseConnection {
  return ensureConnection()
}

function ensureConnection(): LicenseConnection {
  if (connection) return connection
  if (connectionError) throw new Error(connectionError)
  const config = loadCardProviderConfig()
  if (!config.enabled) throw new Error('本机未启用卡密平台')
  if (config.error || !config.origin || !config.publicKey) {
    connectionError = config.error || '授权来源配置无效'
    throw new Error(connectionError)
  }
  try {
    // 独立的内存分区：平台会话 cookie 只活在这里，退出程序即丢，也不和页面/抖音登录的 cookie 混在一起。
    // 证书：同一套指纹校验装到这个分区（47.251.93.171 钉指纹，其它主机系统 CA），不关校验、不信任任意证书
    const partition = electronSession.fromPartition('card-license-' + randomUUID())
    installServerCertPin(partition)
    const origin = config.origin
    connection = new LicenseConnection(config.origin, config.publicKey, partition, deny, config.identityMode, {
      free: () => !licenseEnforced(),
      localId: (email) => cardUsers.find((u) => u.origin === origin && String(u.email ?? '').toLowerCase() === email.trim().toLowerCase())?.id,
      // 免费模式：服务器挂着那段时间本机绑定的直播间，连回平台后补报（后台看得到）；通知 / 心跳也立刻跑一次
      onReconnect: () => {
        if (licenseEnforced()) return
        void Promise.resolve(roomHooks.login?.()).catch((e) => logLine('card', '连回平台后对账直播间未完成：' + (e instanceof Error ? e.message : String(e))))
        emitCardAccountChange()
      }
    })
    const credFile = 'creds-card-' + originKey(config.origin)
    creds = createCredStore(credFile)
    logLine('card', `卡密平台已接入：${config.origin}（配置来源 ${config.source}${config.official ? '，官方地址' : ''}）`)
    migrateLegacyCredentials(config, creds, credFile)
    return connection
  } catch (e) {
    connectionError = '授权来源配置无效：' + (e instanceof Error ? e.message : String(e))
    throw new Error(connectionError)
  }
}

/**
 * 旧主播升级：把旧账号系统「记住密码」（data/creds.json）里的邮箱账号密码复制到平台专用凭据库。
 *   - 只在「随安装包的默认配置 + 官方平台地址」下执行（card-provider 已把 migrateLegacyCredentials 按这两个条件收紧）：
 *     同一套软件、同一台服务器的升级，不是把密码送去别的服务；
 *   - 只复制邮箱形式的账号（旧本地用户名账号不是邮箱身份，不动）；解出来的密码用 safeStorage 重新加密存入；
 *   - 旧文件原样保留；平台凭据库里已有的账号不覆盖；「上次登录」优先保留新库已有的，否则沿用旧库里的邮箱；
 *   - 每个平台地址只做一次（data/card-cred-migration.json 记录），主播之后删掉的记住密码不会被再次复活。
 */
function migrateLegacyCredentials(config: CardProviderConfig & { enabled: true }, store: CredStore, storeFile: string): void {
  if (config.error || !config.migrateLegacyCredentials || config.source !== 'resources' || !config.official) return
  const marker = readJson<{ done?: Record<string, { at: number; count: number }> }>('card-cred-migration', {})
  const done = marker && typeof marker.done === 'object' && marker.done ? marker.done : {}
  if (done[config.origin]) return
  try {
    const legacy = readJson<{ last?: string; map?: Record<string, string> }>('creds', {})
    const legacyMap = legacy && legacy.map && typeof legacy.map === 'object' ? legacy.map : {}
    const target = readJson<{ last?: string; map?: Record<string, string> }>(storeFile, {})
    const targetMap = target && target.map && typeof target.map === 'object' ? target.map : {}
    const keepLast = typeof target.last === 'string' && target.last && targetMap[target.last] ? target.last : ''
    let count = 0
    for (const key of Object.keys(legacyMap)) {
      const email = key.toLowerCase()
      if (!EMAIL_RE.test(email) || email in targetMap) continue
      const password = credGetUser(email)
      if (!password) continue
      store.save(email, password)
      count++
    }
    // 「上次登录」：新库已有的不动（连它的密文都不重写）；否则沿用旧库记住的邮箱；旧库上次登录不是邮箱（本地账号）就不设，
    // 别让自动登录挑错账号。save() 每次都会把 last 指到刚存的账号，所以最后直接把 last 字段改回来
    if (count) {
      const legacyLast = typeof legacy.last === 'string' ? legacy.last.toLowerCase() : ''
      const after = readJson<{ last?: string; map?: Record<string, string> }>(storeFile, {})
      const afterMap = after && after.map && typeof after.map === 'object' ? after.map : {}
      const wantLast = keepLast || (EMAIL_RE.test(legacyLast) && afterMap[legacyLast] ? legacyLast : '')
      writeJson(storeFile, { ...after, last: wantLast, map: afterMap })
    }
    writeJson('card-cred-migration', { done: { ...done, [config.origin]: { at: Date.now(), count } } })
    if (count) logLine('card', `已把 ${count} 个旧邮箱账号的记住密码迁到平台凭据库（旧文件保留）`)
  } catch (e) {
    logLine('card', '旧凭据迁移未完成：' + (e instanceof Error ? e.message : String(e)))
  }
}

function credStore(): CredStore {
  ensureConnection()
  return creds!
}

function quietly(label: string, fn: () => unknown): void {
  try {
    void Promise.resolve(fn()).catch((e) => logLine('card', `${label} 收尾失败：${String(e)}`))
  } catch (e) {
    logLine('card', `${label} 收尾失败：${String(e)}`)
  }
}

/** 授权被拒 / 退出 / 换账号 / 平台掉线：关掉所有正在输出的东西。不结束游戏进程。 */
export function closeAllCardOutputs(): void {
  // 同一轮事件循环里可能被叫多次（invalidate + require 失败 + 复核失败），合并成一次
  if (denyPending) return
  denyPending = true
  bumpCardEpoch(); recentProof.clear(); invalidateCardModLease()
  // 通知轮询 / 心跳 / 观众记录：账号没了就立刻停下（它们按当前账号判断，这里只是催一下）
  emitCardAccountChange()
  // 扫码窗口关掉、扫码凭证销毁：旧账号的登录态不能落到下一个账号
  quietly('room-proofs', () => roomHooks.deny?.())
  quietly('key-unlock', () => import('./keyboard-hook').then(m=>m.commandKeyboardLock('unlock')))
  setImmediate(() => { denyPending = false })
  quietly('exec-queue', () => clearExecQueue())
  quietly('connector', () => stopConnector())
  quietly('time-queue', () => timeWidgetCancelQueue())
  quietly('time', () => closeTimeWidget())
  quietly('time-log', () => timeLogClose())
  quietly('marquee', () => closeMarquee())
  quietly('challenge', () => closeChallengeWidget(undefined))
  quietly('video', () => closeVideoWidget())
  for (const kind of ['wheel', 'nine', 'lucky'] as const) quietly('lottery-' + kind, () => closeLotteryWindow(kind))
  for (const source of [1, 2] as const) quietly('advanced-wheel-' + source, () => closeAdvancedWheel(source))
  quietly('effects', () => closeEffectsWindow())
  quietly('entrance', () => closeEntranceWindow())
  quietly('queue', () => closeQueueWindow())
  quietly('wish', () => closeWishWindow())
  quietly('progress', () => closeProgressWindow())
  quietly('keyboard', () => closeKeyboardWindow())
  quietly('protect', () => closeProtectWidget())
  quietly('green', () => closeGreenScreen(undefined, { clearQueue: true }))
  quietly('forward', () => stopDanmakuForward())
  quietly('obs', () => obsDisconnectNow())
}

let freeDenyLoggedAt = 0
function deny(reason: DeniedReason = 'platform'): void {
  // 免费模式：平台那边的拒绝 / 登录失效一律不关输出（2026-10-07 用户：「千万不要干扰直播」「不要有任何的掉授权行为」）；
  // 只有主播自己退出 / 切换账号（reason=user）才关
  if (reason === 'platform' && !licenseEnforced()) {
    if (Date.now() - freeDenyLoggedAt > 60_000) {
      freeDenyLoggedAt = Date.now()
      logLine('card', '平台那边登录失效或拒绝了一次请求（免费模式不影响使用，输出照常）')
    }
    return
  }
  closeAllCardOutputs()
}

function flag(read: () => unknown): boolean {
  try {
    return !!read()
  } catch {
    return false
  }
}

/** 有没有东西正在用（输出窗口 / 连接器 / 排队中的动作）：有才复核授权，没有就不打扰平台。 */
export async function anyCardUseActive(): Promise<boolean> {
  if (hasCardModLease()) return true
  if ([
    () => connectorState().running || connectorState().connecting,
    () => execQueueLength() > 0,
    () => timeWidgetState().open,
    () => timeLogState().open,
    () => marqueeState().open,
    () => { const v = videoWidgetState(); return v.main || v.vip },
    () => { const l = lotteryState(); return l.wheel || l.nine || l.lucky },
    () => { const w = advancedWheelState(); return w.one || w.two },
    () => effectsState().open,
    () => entranceState().open,
    () => queueWidgetState().open,
    () => wishWindowState().open,
    () => progressState().open,
    () => keyboardWidgetState().open,
    () => protectWidgetState().open,
    () => greenScreenState().open,
    () => danmakuForwardState().running
  ].some(flag)) return true
  try {
    return !!(await challengeWidgetState()).open
  } catch {
    return false
  }
}

async function recheck(force = false): Promise<void> {
  // 免检：不向平台发任何复核请求，也永远不会 deny（连不上平台再也不会关输出）
  if (!licenseEnforced()) return
  if (checking || !connection || !connection.currentUser()) return
  checking = true
  try {
    if (!(await anyCardUseActive())) return
    const tick = ++recheckTick
    const full = force || tick % REQUIRE_EVERY_TICKS === 0
    if (full) {
      await connection.require(CARD_PLATFORM_PRODUCT)
      // 连接器在跑 = 正在向某款游戏送整蛊：对应游戏卡也要一直有效
      const cs = connectorState()
      if (cs.running || cs.connecting) await connection.require(cardProductForGame(currentGameId()))
    }
    if (hasCardModLease()) { if (full) await connection.require('game:4wheel-challenge'); await renewCardModLease(connection) }
    // 后台解绑了正在连的直播间 → 只停本客户端拉起的连接器，不算授权失败（不关别的输出）
    if (roomHooks.recheck) await roomHooks.recheck().catch((error) => logLine('card', '直播间绑定复核未完成：' + (error instanceof Error ? error.message : String(error))))
    transientFailures = 0
  } catch (e) {
    // 平台明确拒绝（PlatformError：无授权 / 到期 / 停用）或登录失效 → 立刻关输出。
    // 网络抖动 / 超时 / 连不上平台 → 不能因为一次慢响应就把整场直播的输出全关掉（2026-09-13 用户直播中被
    // "The operation was aborted due to timeout" 关掉过一次）：连续 5 次（约 10 秒）都失败才关，期间只记日志。
    const message = e instanceof Error ? e.message : String(e)
    const transient = !(e instanceof PlatformError) && !/登录已失效|请先登录|登录状态已变化/.test(message)
    if (transient) {
      transientFailures++
      if (Date.now() - lastTransientLogAt > 60_000) {
        lastTransientLogAt = Date.now()
        logLine('card', `授权复核暂时失败（已连续 ${transientFailures} 次，网络问题不关输出，恢复后自动继续）：` + message)
      }
      return
    }
    logLine('card', '授权复核未通过（平台明确拒绝），已关闭输出：' + message)
    deny()
  } finally {
    checking = false
  }
}

/** 启动复核定时器（只在卡密模式下起）。 */
export function startCardWatch(): void {
  if (!cardModeEnabled() || recheckTimer) return
  invalidateCardModLease()
  recheckTimer = setInterval(() => void recheck(), RECHECK_MS)
}

export function stopCardWatch(): void {
  if (recheckTimer) clearInterval(recheckTimer)
  recheckTimer = null
}

/** 授权门：通过返回，不通过抛 NeedsLicense（配置无效抛普通 Error，不当成「去激活卡密」）。 */
export async function cardRequire(product: string): Promise<void> {
  if (!licenseEnforced()) return
  const conn = ensureConnection()
  if (!(CARD_PRODUCTS as readonly string[]).includes(product)) throw new NeedsLicense(product, '当前游戏没有对应的卡密产品')
  try {
    await conn.require(product)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new NeedsLicense(product, conn.currentUser() ? '此功能需要有效的卡密授权：' + message : '请先登录平台账号并激活卡密')
  }
}

// 常驻事件与分批执行复用最多1秒的已验签结果；换号/退出/拒绝即失效，不按礼物数逐次请求。
const recentProof=new Map<string,{epoch:number;at:number;user:string}>()
export async function cardRequireRecent(product:string):Promise<void>{
  if(!licenseEnforced())return
  const conn=ensureConnection(),epoch=cardEpoch(),user=conn.currentUser()?.id
  const cached=recentProof.get(product)
  if(user&&cached?.user===user&&cached.epoch===epoch&&performance.now()-cached.at<1000)return
  await cardRequire(product)
  if(cardEpoch()!==epoch||conn.currentUser()?.id!==user)throw new NeedsLicense(product,'登录状态已变化')
  recentProof.set(product,{epoch,at:performance.now(),user:user!})
}

// 免检模式下「用游戏功能」只剩两件事：给轮椅 mod 维持免检标记、把随包的 1.0.0.12 组件换上（每分钟最多试一次，游戏开着换不了就等）
let freePrepAt = 0
let freePrepWarned = ''
export async function freeModeGameUse(gameId = currentGameId(), force = false): Promise<void> {
  if (gameId !== '4wheel-challenge') return
  writeFreeModLease()
  if (!force && Date.now() - freePrepAt < 60_000) return
  freePrepAt = Date.now()
  try {
    await ensureCardModSupport(gameId)
    freePrepWarned = ''
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (freePrepWarned !== msg) { freePrepWarned = msg; logLine('license', `免检模式：轮椅整蛊器组件暂未换新（${msg}），稍后自动再试`) }
  }
}

export async function cardRequireGameUse(gameId=currentGameId()):Promise<void>{
  if(!licenseEnforced()){await freeModeGameUse(gameId);return}
  const epoch=cardEpoch()
  await cardRequireRecent(cardProductForGame(gameId))
  if(gameId==='4wheel-challenge'){await ensureCardModSupport(gameId);await renewCardModLease(ensureConnection())}
  if(cardEpoch()!==epoch||currentGameId()!==gameId)throw Error('账号或当前游戏已变化，操作已取消')
}

/** 通知主窗口弹卡密入口（只发给主窗口，输出窗口不收）。 */
export function notifyLicenseRequired(product: string): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(Ipc.CardLicenseRequired, product)
}

// ---- 本地卡密账号记录 ----

function localUser(id: string): CardUser | null {
  const config = loadCardProviderConfig()
  if (!config.enabled || !config.origin) return null
  return cardUsers.find((u) => u.id === id && u.origin === config.origin) ?? null
}

function toSession(u: CardUser): SessionUser {
  return { id: u.id, username: u.email, nickname: u.nickname, avatar: u.avatar, createdAt: u.createdAt, boundRooms: u.boundRooms ?? [], email: u.email }
}

/** 旧账号系统里同邮箱的本地记录（只读）：首次用平台账号登录时把昵称 / 头像接过来，原 users.json 不动。 */
function legacyEmailUser(email: string): User | undefined {
  const wanted = email.toLowerCase()
  try {
    return legacyUsers.find((u) => !!u && (String(u.email ?? '').toLowerCase() === wanted || String(u.username ?? '').toLowerCase() === wanted))
  } catch {
    return undefined
  }
}

function upsertLocal(user: { id: string; email: string }, nickname = ''): CardUser {
  const config = loadCardProviderConfig()
  const origin = config.enabled && config.origin ? config.origin : ''
  const now = Date.now()
  const exist = cardUsers.find((u) => u.id === user.id && u.origin === origin)
  if (exist) {
    cardUsers.update(exist.id, { email: user.email, lastLoginAt: now, ...(nickname.trim() ? { nickname: nickname.trim() } : {}) })
  } else {
    const legacy = legacyEmailUser(user.email)
    cardUsers.insert({
      id: user.id,
      origin,
      email: user.email,
      nickname: nickname.trim() || legacy?.nickname?.trim() || user.email.split('@')[0],
      avatar: typeof legacy?.avatar === 'string' ? legacy.avatar : '',
      createdAt: now,
      lastLoginAt: now,
      boundRooms: []
    })
  }
  return cardUsers.find((u) => u.id === user.id && u.origin === origin)!
}

/** 当前卡密账号（同步）；未登录 / 未启用 → null。 */
export function cardSession(): SessionUser | null {
  if (!connection) return null
  const user = connection.currentUser()
  if (!user) return null
  const local = localUser(user.id)
  return local ? toSession(local) : { id: user.id, username: user.email, nickname: user.email.split('@')[0], avatar: '', createdAt: 0, boundRooms: [], email: user.email }
}

function snapshotError(error: unknown): CardSnapshot {
  const config = loadCardProviderConfig()
  const base: CardSnapshot = { ok: false, enabled: true, error: error instanceof Error ? error.message : String(error) }
  if (config.enabled) {
    base.source = config.source
    if (config.origin) base.origin = config.origin
    // 读不到平台元信息时保守：正式模式一律按「注册 / 找回要验证码」，不假设是本机模式
    const meta = connection?.metaSync()
    base.identityMode = meta?.identityMode ?? config.identityMode
    base.registrationRequiresCode = meta ? meta.registrationRequiresCode : config.identityMode !== 'local'
  }
  return base
}

/** 免检模式给界面的快照：全部产品「已激活（永久）」，账号信息照常带上（登录态是身份，不是授权）。不碰网络。 */
function freeSnapshot(config: CardProviderConfig & { enabled: true }): CardSnapshot {
  let user: { id: string; email: string } | undefined
  let meta: ReturnType<LicenseConnection['metaSync']> | undefined
  try {
    const conn = ensureConnection()
    user = conn.currentUser() ?? undefined
    meta = conn.metaSync() ?? undefined
  } catch {
    /* 配置无效也照样免检，只是没有账号信息 */
  }
  const rights: CardRight[] = (CARD_PRODUCTS as readonly string[]).map((id) => ({ id, name: '', kind: 'free', status: 'active', permanent: true, expires_at: null, allowed: true, reasons: [] }))
  return {
    ok: true,
    enabled: true,
    free: true,
    origin: config.origin,
    source: config.source,
    user,
    rights,
    identityMode: meta?.identityMode ?? config.identityMode,
    registrationRequiresCode: meta ? meta.registrationRequiresCode : config.identityMode !== 'local'
  }
}

export async function cardState(): Promise<CardSnapshot> {
  const config = loadCardProviderConfig()
  if (!config.enabled) return { ok: true, enabled: false, ...(config.legacyHold ? { legacyHold: config.legacyHold, defaultAvailable: config.defaultAvailable === true } : {}) }
  if (!licenseEnforced()) return freeSnapshot(config as CardProviderConfig & { enabled: true })
  try {
    const snapshot = await ensureConnection().state()
    snapshot.source = config.source
    return snapshot
  } catch (e) {
    return snapshotError(e)
  }
}

function errorResult(err: unknown, fallback: string): { ok: false; error: string; code?: string } {
  const code = err instanceof PlatformError && err.code ? err.code : undefined
  return { ok: false, error: err instanceof Error && err.message ? err.message : fallback, ...(code ? { code } : {}) }
}

/**
 * 发邮箱验证码（注册 / 找回密码用）。正式平台（existing）复用原邮箱身份服务；本机测试平台不发验证码，明确说明。
 * 不需要登录，也不会碰当前登录态。
 */
export async function cardSendCode(email: unknown): Promise<EmailAuthResult> {
  const e = String(email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return { ok: false, error: '邮箱格式不正确，请检查后重试' }
  try {
    const conn = ensureConnection()
    const meta = await conn.meta()
    if (meta.fromServer && meta.identityMode === 'local' && !meta.registrationRequiresCode) {
      return { ok: false, error: '当前平台是本机测试模式，不发验证码：直接用邮箱和密码注册或登录', code: 'code_not_required' }
    }
    await conn.sendCode(e)
    return { ok: true, email: e }
  } catch (err) {
    // 免费模式 + 服务器连不上：收不到验证码也能进软件（注册页据此放开「验证码必填」，cardLogin 走本机登录）
    if (!licenseEnforced() && platformUnavailable(err)) {
      return { ok: false, error: SERVER_DOWN_REGISTER, code: 'platform_unavailable' }
    }
    return errorResult(err, '验证码发送失败，请稍后重试')
  }
}

const SERVER_DOWN_REGISTER = '服务器暂时连不上，收不到验证码。不填验证码直接点「注册」也能进入软件，功能照常用'
const SERVER_DOWN_LOGIN = '服务器暂时连不上，已直接进入软件，所有功能照常用'

/**
 * 找回密码：邮箱验证码 + 新密码，平台核实后直接建立会话（和登录一样），这里顺手落本地记录。
 * 只有平台说「不需要验证码」（本机测试模式）时才允许不带 code；正式模式没验证码一律不发请求。
 */
export async function cardReset(email: unknown, code: unknown, password: unknown): Promise<EmailAuthResult> {
  const e = String(email ?? '').trim().toLowerCase()
  const c = String(code ?? '').trim()
  const p = String(password ?? '')
  if (!EMAIL_RE.test(e)) return { ok: false, error: '邮箱格式不正确，请检查后重试' }
  if (!p) return { ok: false, error: '请输入新密码' }
  if (p.length < 6) return { ok: false, error: '密码至少 6 位' }
  try {
    const conn = ensureConnection()
    if (!c) {
      const meta = await conn.meta()
      if (meta.registrationRequiresCode || !meta.fromServer) return { ok: false, error: '请填写邮箱收到的验证码', code: 'code_required' }
      return { ok: false, error: '当前平台是本机测试模式，不支持自助找回密码，请联系平台管理员重置', code: 'reset_unsupported' }
    }
    const snapshot = await conn.resetPassword(e, c, p)
    if (!snapshot.user) return { ok: false, error: '重置失败' }
    const local = upsertLocal(snapshot.user)
    if (roomHooks.login) {
      await roomHooks.login().catch((error) => logLine('card', '重置密码后同步直播间名额未完成：' + (error instanceof Error ? error.message : String(error))))
    }
    prepareCardMod(snapshot)
    emitCardAccountChange()
    return { ok: true, email: e, user: toSession(localUser(local.id) ?? local) }
  } catch (err) {
    return errorResult(err, '重置失败，请检查验证码后重试')
  }
}

export async function cardLogin(email: unknown, password: unknown, register: boolean, code: unknown = '', nickname: unknown = ''): Promise<AuthResult & { code?: string }> {
  const e = String(email ?? '').trim().toLowerCase()
  const p = String(password ?? '')
  const c = String(code ?? '').trim()
  if (!EMAIL_RE.test(e)) return { ok: false, error: register ? '卡密平台账号用邮箱注册，请填写邮箱' : '请用邮箱登录卡密平台账号' }
  if (!p) return { ok: false, error: '请输入密码' }
  if (register && p.length < 6) return { ok: false, error: '密码至少 6 位' }
  try {
    const conn = ensureConnection()
    let online = register
    if (register && !c) {
      // 正式平台注册必须带邮箱验证码；平台元信息读不到时也按需要验证码处理，不让人凭邮箱抢占旧账号
      const meta = await conn.meta()
      // 免费模式 + 服务器连不上（拿不到验证码）：不注册了，直接用填的邮箱密码进软件（本机登录），服务器恢复后再补注册
      if (!licenseEnforced() && !meta.fromServer) online = false
      else if (meta.registrationRequiresCode || !meta.fromServer) return { ok: false, error: '请填写邮箱收到的验证码', code: 'code_required' }
    }
    let snapshot: CardSnapshot
    try {
      snapshot = await conn.login(e, p, online, online ? c : '')
    } catch (err) {
      // 刚才以为服务器连不上、注册改走了直接进入，结果服务器其实在、这个邮箱还没注册：还是请主播填验证码注册
      if (register && !online && err instanceof PlatformError && err.status === 401) return { ok: false, error: '请填写邮箱收到的验证码', code: 'code_required' }
      throw err
    }
    if (!snapshot.user) return { ok: false, error: '登录失败' }
    let local = upsertLocal(snapshot.user, register ? String(nickname ?? '') : '')
    // 直播间绑定列表以平台为准：登录后立刻同步一次（平台还没上这个接口就先用本机缓存）
    if (roomHooks.login) {
      await roomHooks.login().catch((error) => logLine('card', '登录后同步直播间名额未完成：' + (error instanceof Error ? error.message : String(error))))
      local = localUser(local.id) ?? local
    }
    prepareCardMod(snapshot)
    // 免费模式：本机登录时快照里没有平台权益，但一切功能本来就放开 → 照样按设置打开时间记录窗
    if(getSettings().timeLogWindow&&(!licenseEnforced()||snapshot.rights?.some(r=>r.id===CARD_PLATFORM_PRODUCT&&r.allowed))){
      const epoch=cardEpoch(),id=local.id
      void cardRequireRecent(CARD_PLATFORM_PRODUCT).then(()=>{if(cardEpoch()===epoch&&cardSession()?.id===id)timeLogOpen()}).catch(()=>{})
    }
    // 登录成功：通知轮询 / 在线心跳 / 观众记录上传立刻跑一次（平台代调原邮箱服务，见 card-compat.ts）
    emitCardAccountChange()
    return { ok: true, user: toSession(local), ...(!licenseEnforced() && conn.usingLocalLogin() ? { notice: SERVER_DOWN_LOGIN } : {}) }
  } catch (err) {
    return errorResult(err, '登录失败')
  }
}

export async function cardLogout(): Promise<{ ok: boolean }> {
  // 主播自己退出 / 切换账号：logout 走 denied('user')，免费模式下也照常关掉正在输出的东西
  if (connection) await connection.logout()
  else closeAllCardOutputs()
  return { ok: true }
}

function prepareCardMod(snapshot:CardSnapshot):void{
  if(!snapshot.user||!snapshot.rights?.some(r=>r.id==='game:4wheel-challenge'&&r.allowed))return
  const id=snapshot.user.id,epoch=cardEpoch()
  void Promise.resolve().then(async()=>{
    if(cardEpoch()!==epoch||cardSession()?.id!==id)return
    await renewCardModLease(ensureConnection())
  }).catch(error=>logLine('card','轮椅授权准备：'+(error instanceof Error?error.message:'尚未就绪')))
}

export async function cardRedeem(code: unknown): Promise<CardSnapshot> {
  if (!cardModeEnabled()) return { ok: false, enabled: false, error: '本机未启用卡密平台' }
  try {
    const snapshot=await ensureConnection().redeem(String(code ?? '').trim())
    prepareCardMod(snapshot)
    return snapshot
  } catch (e) {
    return snapshotError(e)
  }
}

export async function cardOpenPlatform(): Promise<{ ok: boolean; error?: string }> {
  const config = loadCardProviderConfig()
  if (!config.enabled) return { ok: false, error: '本机未启用卡密平台' }
  if (config.error || !config.origin) return { ok: false, error: config.error || '授权来源配置无效' }
  try {
    await shell.openExternal(config.origin + '/')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function cardListAccounts(): AuthAccount[] {
  const config = loadCardProviderConfig()
  if (!config.enabled || !config.origin) return []
  const list: AuthAccount[] = cardUsers.all()
    .filter((u) => u.origin === config.origin)
    .map((u) => ({ id: u.id, username: u.email, nickname: u.nickname, email: u.email, avatar: u.avatar, lastLoginAt: u.lastLoginAt ?? 0 }))
  // 官方平台复用原邮箱身份：旧账号系统里的邮箱账号也列出来（只读，登录一次就变成平台记录），主播不用重新想邮箱
  if (config.official) {
    const known = new Set(list.map((a) => a.username.toLowerCase()))
    try {
      for (const u of legacyUsers.all()) {
        const email = String(u.email || (EMAIL_RE.test(String(u.username ?? '')) ? u.username : '') || '').toLowerCase()
        if (!email || known.has(email)) continue
        known.add(email)
        list.push({ id: LEGACY_ID_PREFIX + u.id, username: email, nickname: u.nickname || email.split('@')[0], email, avatar: u.avatar, lastLoginAt: u.lastLoginAt ?? 0 })
      }
    } catch {
      /* 旧文件读不了就只列平台账号 */
    }
  }
  return list.sort((a, b) => b.lastLoginAt - a.lastLoginAt)
}

export async function cardDeleteAccount(id: string): Promise<{ ok: boolean; error?: string; email?: string }> {
  if (id.startsWith(LEGACY_ID_PREFIX)) return { ok: false, error: '这是旧版本地保存的邮箱账号记录，登录一次后即可在这里删除' }
  const u = localUser(id)
  if (!u) return { ok: false, error: '账号不存在' }
  cardUsers.remove(id)
  if (connection?.currentUser()?.id === id) await connection.logout()
  connection?.forgetAccount(u.email)
  return { ok: true, email: u.email }
}

export function cardUpdateAvatar(avatar: string): SessionUser | null {
  const s = cardSession()
  if (!s || !avatar) return s
  const local = localUser(s.id)
  if (!local || local.avatar === avatar) return s
  cardUsers.update(local.id, { avatar })
  return cardSession()
}

// ---- 直播间绑定：名额与改绑次数以平台为准（card-rooms.ts），本机 card_users.boundRooms 只是给界面看的缓存 ----
//   绑定不再要求娱乐助手卡（首绑免费 1 个名额），但真正使用功能仍要软件 / 游戏授权（门禁不变）。
//   旧入口 bindRoom / bindRoomWithLicense / unbindRoom / reportRoomUnbind / syncEmailRooms 全部转到平台，不能绕过扫码与额度。

/** 本机缓存的绑定列表（给绑定层比对用）。 */
export function localBoundRooms(userId: string): string[] {
  return localUser(userId)?.boundRooms ?? []
}

/** 用平台返回的 rooms 覆盖本机缓存；有变化就广播 RoomsSynced 让页面刷新。返回新列表。 */
export function setLocalBoundRooms(userId: string, rooms: string[]): string[] {
  const next = [...new Set(rooms.map((r) => String(r).trim()).filter((r) => ROOM_RE.test(r)))]
  const local = localUser(userId)
  if (!local) return next
  const cur = local.boundRooms ?? []
  if (cur.length === next.length && cur.every((r, i) => r === next[i])) return next
  cardUsers.update(local.id, { boundRooms: next })
  const restored = next.filter((r) => !cur.includes(r))
  const removed = cur.filter((r) => !next.includes(r))
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(Ipc.RoomsSynced, { boundRooms: next, restored, removed })
  return next
}

export async function cardBindRoom(room: unknown): Promise<BindRoomResult> {
  const s = cardSession()
  if (!s) return { ok: false, error: '未登录' }
  if (!roomHooks.bind) return { ok: false, error: '直播间绑定模块未加载，请重启客户端' }
  return roomHooks.bind(String(room ?? ''))
}

export async function cardUnbindRoom(room: unknown): Promise<BindRoomResult> {
  const s = cardSession()
  if (!s) return { ok: false, error: '未登录' }
  if (!roomHooks.unbind) return { ok: false, error: '直播间绑定模块未加载，请重启客户端' }
  return roomHooks.unbind(String(room ?? ''))
}

export async function cardSyncRooms(): Promise<SyncEmailRoomsResult> {
  const s = cardSession()
  if (!s) return { ok: false, error: '未登录' }
  if (!roomHooks.sync) return { ok: true, boundRooms: s.boundRooms, restored: [], removed: [] }
  return roomHooks.sync()
}

/** 把平台权益翻译成旧界面认的授权结构（licensed=娱乐助手是否可用；games=可用的游戏）。 */
export async function cardEmailLicense(email: unknown): Promise<EmailLicense> {
  const wanted = String(email ?? '').trim().toLowerCase()
  const snapshot = await cardState()
  if (!snapshot.ok) return { ok: false, licensed: 0, banned: 0, expire: '', note: snapshot.error || '授权不可用' }
  if (!snapshot.user || snapshot.user.email.toLowerCase() !== wanted) return { ok: false, licensed: 0, banned: 0, expire: '', note: '请使用当前登录账号查询授权' }
  const rights = snapshot.rights || []
  const platform = rights.find((r) => r.id === CARD_PLATFORM_PRODUCT)
  const games: Record<string, number> = {}
  for (const r of rights) {
    if (r.kind !== 'game' || !r.allowed) continue
    const gameId = Object.keys(GAME_PRODUCTS).find((g) => GAME_PRODUCTS[g] === r.id)
    if (gameId) games[gameId] = 1
  }
  return {
    ok: true,
    licensed: platform?.allowed ? 1 : 0,
    banned: rights.some((r) => r.reasons.includes('account_banned')) ? 1 : 0,
    expire: platform?.expires_at ? new Date(platform.expires_at * 1000).toISOString() : '',
    note: platform?.allowed ? '' : platform?.permanent ? '' : '未激活娱乐助手卡密',
    games,
    pendingGames: []
    // rooms 留空（undefined）：旧逻辑据此跳过「服务器绑定同步」
  }
}

type Invoke = (...args: any[]) => unknown | Promise<unknown>
const NOT_ON_PLATFORM = (what: string): { ok: false; error: string } => ({ ok: false, error: `当前使用卡密平台授权，${what}` })

/** 卡密模式下接管的账号 / 授权类通道；旧账号系统的对应实现在这个模式下不会被调用。 */
export const cardAccountHandlers: Record<string, Invoke> = {
  [Ipc.AuthRegister]: (username, password, nickname) => cardLogin(username, password, true, '', nickname),
  [Ipc.AuthLogin]: (username, password) => cardLogin(username, password, false),
  [Ipc.AuthLogout]: () => cardLogout(),
  [Ipc.AuthSession]: () => cardSession(),
  [Ipc.AuthBindRoom]: (room) => cardBindRoom(room),
  [Ipc.AuthUnbindRoom]: (room) => cardUnbindRoom(room),
  [Ipc.AuthDeleteAccount]: (id) => cardDeleteAccount(String(id ?? '')),
  [Ipc.AuthListAccounts]: () => cardListAccounts(),
  [Ipc.AuthUpdateAvatar]: (avatar) => cardUpdateAvatar(String(avatar ?? '')),
  [Ipc.CredLoad]: () => ({ last: credStore().getLast() }),
  [Ipc.CredUser]: (username) => ({ password: credStore().getUser(String(username ?? '')) }),
  [Ipc.CredSave]: (username, password) => {
    const u = String(username ?? ''), p = String(password ?? '')
    if (!u || u.length > 254 || p.length > 128) return { ok: false, error: '凭据格式不正确' }
    credStore().save(u, p)
    return { ok: true }
  },
  [Ipc.CredClearLast]: () => { credStore().clearLast(); return { ok: true } },
  [Ipc.CredClearUser]: (username) => { credStore().clearUser(String(username ?? '')); return { ok: true } },
  // 正式平台（existing）注册 / 找回密码走原邮箱身份服务的验证码；本机测试平台不发验证码、直接邮箱密码注册
  [Ipc.EmailSendCode]: (email) => cardSendCode(email),
  [Ipc.EmailRegister]: (email, code, password, nickname) => cardLogin(email, password, true, code, nickname),
  [Ipc.EmailLogin]: (email, password) => cardLogin(email, password, false),
  [Ipc.EmailReset]: (email, code, password) => cardReset(email, code, password),
  [Ipc.EmailGetLicense]: (email) => cardEmailLicense(email),
  [Ipc.EmailGameApply]: () => NOT_ON_PLATFORM('游戏授权请兑换对应游戏的卡密，不再申请审批'),
  // 通知中心 / 云配置：平台用登录时已验证的原邮箱会话代调旧接口（email-api 里按卡密模式分路到 card-compat）；
  // 邮箱必须是当前卡密账号，否则拒绝
  [Ipc.EmailNotifyList]: (email) => getNotifications(String(email ?? '')),
  [Ipc.EmailNotifyRead]: (email, id) => markNotifyRead(String(email ?? ''), String(id ?? '')),
  [Ipc.EmailNotifyReadAll]: (email) => markNotifyReadAll(String(email ?? '')),
  [Ipc.EmailConfigSave]: (email, data) => configCloudSave(String(email ?? ''), data),
  [Ipc.EmailConfigLoad]: (email) => configCloudLoad(String(email ?? '')),
  [Ipc.EmailBuyContact]: () => '',
  [Ipc.RoomBindWithLicense]: (room) => cardBindRoom(room),
  [Ipc.RoomSubmitApply]: () => NOT_ON_PLATFORM('直播间不需要申请审批，激活娱乐助手卡密后直接绑定'),
  [Ipc.RoomCancelApply]: () => ({ ok: true }),
  [Ipc.RoomUnbindReport]: (room) => cardUnbindRoom(room),
  [Ipc.RoomSyncEmail]: () => cardSyncRooms()
}

/** 给 ipc.ts 用：卡密模式走 cardAccountHandlers，否则原封不动走旧实现。 */
export function cardOr<T extends (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown>(channel: string, legacy: T): T {
  const card = cardAccountHandlers[channel]
  if (!card) throw new Error('卡密模式缺少通道实现：' + channel)
  return ((event: Electron.IpcMainInvokeEvent, ...args: any[]) => (cardModeEnabled() ? card(...args) : legacy(event, ...args))) as T
}

/** 退出程序前的收尾：停复核，关输出。 */
export function cardShutdown(): void {
  stopCardWatch()
  if (connection?.currentUser()) closeAllCardOutputs()
}
