// 卡密模式的直播间绑定层（契约：Tmp/live-data/rooms-contract.md）：
//   - 名额 / 改绑次数由平台事务权威扣减（GET /api/v1/rooms、POST /rooms/bind|replace|unbind）；本机只缓存 rooms 给界面；
//   - 绑定 / 改绑必须先在独立浏览器窗口扫码拿到真实抖音登录态，再用它核实直播间；输入房号不能跳过扫码；
//   - 扫码不猜房号：抖音页面不可靠给出「本人房间号」时回 needRoom=true，让主播粘贴一次链接；绝不拿首页推荐房冒充；
//   - proof = 主进程内的短效一次性凭证（账号 × 来源 × 房间 × cookie × 纪元）；取消 / 超时 / 换号 / 失败都不消耗名额；
//   - 令牌按「账号 × 房间」safeStorage 加密存本机，不覆盖别的房间；连接器启动时先向平台确认已绑定，再取该房间令牌，
//     没有有效令牌就扫码后继续；准备连接时才按旧格式写 douyin_cookie.txt 到 mod 目录；
//   - 退出 / 换号：关掉本层挂着的扫码窗口、销毁全部 proof；后台解绑后运行中的连接器在复核时停掉（只停自己的 child）。
//   ★ 免检模式（license-policy.ts enforce=false，0.3.60 随包默认）：上面这些限制全部不存在——
//     绑定 / 改绑 / 解绑只改本机列表，不问平台、不扫码、不消耗名额或次数，界面显示「不限」；
//     老版本从平台同步下来的绑定原样保留（升级不丢），登录时再把平台上还记着的绑定并进来（联系不上就算了）；
//     抖音扫码登录态仍在「连接直播间」时按需取（那是连直播间用的，不是授权）。开关拨回 enforce=true 后一切照旧走平台。
import { session as electronSession, type Session } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { cardWheelDirectory } from './card-mod-license'
import {
  cardConnection,
  cardModeEnabled,
  cardSession,
  localBoundRooms,
  originKey,
  registerCardRoomHooks,
  setLocalBoundRooms
} from './card-auth'
import { cardEpoch } from './card-epoch'
import { loadCardProviderConfig } from './card-provider'
import { PlatformError, ROOM_ID_RE } from './license-connection'
import { scanDouyinLogin } from './douyin-login'
import { douyinProfileWithCookie, lookupRoomWithCookie, parseRoomInput as parseLegacyRoomInput } from './douyin-room'
import { createRoomTokenStore, type RoomTokenStore } from './card-room-tokens'
import { connectorState, pushConnectorLog, stopConnector } from './connector'
import { logLine } from './crash-log'
import { licenseEnforced } from './license-policy'
import type {
  BindRoomResult,
  CardRoomCommitInput,
  CardRoomCommitResult,
  CardRoomVerifyResult,
  CardRoomsResult,
  RoomQuotaState,
  SyncEmailRoomsResult
} from '@shared/types'

const PROOF_TTL_MS = 10 * 60_000
function parseRoomInput(raw: unknown): string {
  const room = parseLegacyRoomInput(raw)
  return ROOM_ID_RE.test(room) ? room : ''
}
// 运行中的连接器多久向平台确认一次「房间仍绑定着」；回归用 ZL_CARD_ROOMS_RECHECK_MS 缩短
const RECHECK_ROOMS_MS = Math.max(1000, Number(process.env.ZL_CARD_ROOMS_RECHECK_MS) || 30_000)

interface Proof {
  id: string
  user: string
  origin: string
  epoch: number
  cookie: string
  room: string
  nickname: string
  avatar: string
  offline: boolean
  createdAt: number
  expiresAt: number
  /** 同一 proof 对同一动作重试用同一个 Idempotency-Key（网络抖动重发不会扣两次） */
  idempotency: Record<string, string>
}

const proofs = new Map<string, Proof>()
let scanning: { cancel: () => void; user: string } | null = null
let verificationGeneration = 0
let tokenStore: RoomTokenStore | null = null
let tokenStoreOrigin = ''
let lastRoomsRecheck = 0

function currentOrigin(): string {
  const config = loadCardProviderConfig()
  return config.enabled && config.origin ? config.origin : ''
}

function tokens(): RoomTokenStore {
  const origin = currentOrigin()
  if (!origin) throw new Error('本机未启用卡密平台')
  if (!tokenStore || tokenStoreOrigin !== origin) {
    tokenStore = createRoomTokenStore('room-tokens-card-' + originKey(origin))
    tokenStoreOrigin = origin
  }
  return tokenStore
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function code(error: unknown): string {
  return error instanceof PlatformError ? error.code : ''
}

function pruneProofs(): void {
  const now = Date.now()
  for (const [id, p] of proofs) if (p.expiresAt <= now) proofs.delete(id)
}

/** 取一个仍然属于「当前账号 × 当前来源 × 当前纪元」的 proof；对不上一律当失效（不销毁别人的）。 */
function takeProof(id: unknown, user: string): Proof | null {
  pruneProofs()
  const p = typeof id === 'string' ? proofs.get(id) : undefined
  if (!p) return null
  if (p.user !== user || p.origin !== currentOrigin() || p.epoch !== cardEpoch()) {
    proofs.delete(p.id)
    return null
  }
  return p
}

function newProof(user: string, cookie: string): Proof {
  const now = Date.now()
  const p: Proof = { id: randomUUID(), user, origin: currentOrigin(), epoch: cardEpoch(), cookie, room: '', nickname: '', avatar: '', offline: false, createdAt: now, expiresAt: now + PROOF_TTL_MS, idempotency: {} }
  proofs.set(p.id, p)
  return p
}

/** 退出 / 换号 / 授权被拒：关扫码窗口、销毁全部 proof（cookie 随之丢弃）。 */
export function destroyCardRoomProofs(): void {
  verificationGeneration++
  proofs.clear()
  if (scanning) {
    const s = scanning
    scanning = null
    try { s.cancel() } catch { /* 窗口已关 */ }
  }
}

function scanPartition(user: string): Session {
  // 私有的内存分区：一次扫码一份，扫完清空；不和 persist:zhiliao-douyin（旧登录 / 别的主播）混用
  return electronSession.fromPartition('card-room-scan-' + originKey(currentOrigin()) + '-' + user.slice(0, 16) + '-' + randomUUID())
}

/**
 * 打开独立浏览器扫码，拿到真实登录 cookie（只回给本模块）。
 * 期间账号 / 纪元变了、取消、超时都回 ok=false，什么都不落盘。
 */
async function scan(user: string, title: string, isCurrent: () => boolean): Promise<{ ok: true; cookie: string } | { ok: false; error: string; code: string }> {
  if (scanning) return { ok: false, error: '已有扫码窗口打开，请先完成或关闭它', code: 'scan_busy' }
  const epoch = cardEpoch(), generation = verificationGeneration
  const ses = scanPartition(user)
  const { result, cancel } = scanDouyinLogin(ses, { title })
  const mine = { cancel, user }
  scanning = mine
  let login: { ok: boolean; cookie?: string; error?: string }
  try {
    login = await result
  } finally {
    if (scanning === mine) scanning = null
    // cookie 已经在返回值里，分区本身不再留任何东西
    await ses.clearStorageData().catch(() => {})
  }
  if (verificationGeneration !== generation || cardEpoch() !== epoch || cardSession()?.id !== user || !isCurrent()) return { ok: false, error: '登录状态已变化，本次扫码结果已丢弃', code: 'session_changed' }
  if (!login.ok || !login.cookie) return { ok: false, error: login.error || '已取消扫码', code: 'scan_cancelled' }
  return { ok: true, cookie: login.cookie }
}

function applyQuota(user: string, quota: RoomQuotaState): string[] {
  return setLocalBoundRooms(user, quota.rooms)
}

// ---- 免检模式：本机列表就是绑定列表，名额 / 改绑次数给个大数让所有预检永远放行，free=true 让界面显示「不限」 ----
const FREE_QUOTA = 999
function freeQuota(user: string, rooms: string[] = localBoundRooms(user)): RoomQuotaState {
  return { capacity: FREE_QUOTA, changes_left: FREE_QUOTA, changes_used: 0, available: Math.max(1, FREE_QUOTA - rooms.length), rooms, bindings: rooms.map((room, i) => ({ slot: i + 1, room })), empty_slots: [], free: true }
}

/**
 * 免检模式下把绑定 / 解绑顺手报给平台（2026-10-07 用户：「用咱们软件，我还是要知道他们绑了什么直播间吧」）：
 * 后台账号页就能看到主播用哪些直播间。在后台按顺序报，报不上（服务器连不上 / 平台不收）只记日志，绝不影响本机绑定和使用。
 */
function reportRooms(user: string, ops: Array<{ action: 'bind' | 'unbind'; room: string }>): void {
  if (!ops.length) return
  void (async () => {
    for (const op of ops) {
      if (cardSession()?.id !== user) return
      try {
        await cardConnection().roomCommit(op.action, { room: op.room })
      } catch (error) {
        logLine('card', `免检模式：直播间${op.action === 'bind' ? '绑定' : '解绑'} ${op.room} 没报到平台（不影响使用）：` + message(error, String(error)))
        return
      }
    }
  })()
}

/** GET /api/v1/rooms → 名额；顺手把本机绑定列表同步成平台的。 */
export async function cardRooms(): Promise<CardRoomsResult> {
  if (!cardModeEnabled()) return { ok: false, error: '本机未启用卡密平台' }
  const s = cardSession()
  if (!s) return { ok: false, error: '请先登录平台账号', code: 'not_logged_in' }
  if (!licenseEnforced()) return { ok: true, quota: freeQuota(s.id) }
  try {
    const quota = await cardConnection().rooms()
    if (cardSession()?.id !== s.id) return { ok: false, error: '登录状态已变化', code: 'session_changed' }
    applyQuota(s.id, quota)
    return { ok: true, quota }
  } catch (error) {
    return { ok: false, error: message(error, '读取直播间名额失败'), code: code(error) }
  }
}

/**
 * verify(room?, proof?)：
 *   无 proof → 扫码；有 room 就核实 room，没有 room 回 needRoom=true + proof；
 *   有 proof → 复用它的 cookie 核实 room，不再扫码。
 */
export async function cardRoomVerify(roomInput?: unknown, proofId?: unknown): Promise<CardRoomVerifyResult> {
  if (!cardModeEnabled()) return { ok: false, error: '本机未启用卡密平台' }
  const s = cardSession()
  if (!s) return { ok: false, error: '请先登录平台账号', code: 'not_logged_in' }
  const rawRoom = roomInput === undefined || roomInput === null ? '' : String(roomInput).trim()
  const room = rawRoom ? parseRoomInput(rawRoom) : ''
  if (rawRoom && !room) return { ok: false, error: '直播间号或链接格式不对：请填直播间号，或粘贴 live.douyin.com/… 的直播间链接', code: 'invalid_room' }
  if (!licenseEnforced()) {
    // 免检：不扫码、不核实归属；proof 只是让向导按原流程走到确认页（cookie 留空，连接时再扫）
    const free = takeProof(proofId, s.id) ?? newProof(s.id, '')
    if (!room) return { ok: true, needRoom: true, proof: free.id }
    free.room = room
    return { ok: true, proof: free.id, room }
  }

  let proof: Proof | null = null
  if (proofId !== undefined && proofId !== null && proofId !== '') {
    proof = takeProof(proofId, s.id)
    if (!proof) return { ok: false, error: '扫码凭证已失效，请重新扫码', code: 'proof_invalid' }
  } else {
    const scanned = await scan(s.id, room ? `抖音扫码 · 核实直播间 ${room} 归属` : '抖音扫码 · 核实直播间归属', () => true)
    if (!scanned.ok) return { ok: false, error: scanned.error, code: scanned.code }
    proof = newProof(s.id, scanned.cookie)
  }

  const epoch = proof.epoch
  const stillMine = (): boolean => cardEpoch() === epoch && cardSession()?.id === proof!.user && proofs.get(proof!.id) === proof
  if (!room) {
    const profile = await douyinProfileWithCookie(proof.cookie)
    if (!stillMine()) return { ok: false, error: '登录状态已变化，请重新扫码', code: 'session_changed' }
    if (profile.needLogin) {
      proofs.delete(proof.id)
      return { ok: false, error: profile.error || '抖音登录已失效，请重新扫码', code: 'login_expired' }
    }
    if (profile.nickname) { proof.nickname = profile.nickname; proof.avatar = profile.avatar || '' }
    // 抖音不给可靠的本人房号：明确让主播粘贴一次链接，不猜首页推荐的房间
    return { ok: true, needRoom: true, proof: proof.id, nickname: proof.nickname || undefined, avatar: proof.avatar || undefined }
  }

  const lookup = await lookupRoomWithCookie(room, proof.cookie)
  if (!stillMine()) return { ok: false, error: '登录状态已变化，请重新扫码', code: 'session_changed' }
  if (lookup.needLogin) {
    proofs.delete(proof.id)
    return { ok: false, error: lookup.error || '抖音登录已失效，请重新扫码', code: 'login_expired' }
  }
  if (!lookup.ok) {
    // 房号对不上 / 网络错：登录态没问题，proof 留着让主播换个房号再试，不用重扫
    return { ok: false, proof: proof.id, room, error: lookup.error || '没解析到直播间信息，请核对房号', code: 'room_lookup_failed' }
  }
  proof.room = room
  proof.nickname = lookup.nickname || proof.nickname
  proof.avatar = lookup.avatar || proof.avatar
  proof.offline = lookup.offline === true
  return { ok: true, proof: proof.id, room, nickname: proof.nickname || undefined, avatar: proof.avatar || undefined, offline: proof.offline || undefined }
}

/** commit：再验一次 proof 与账号，交给平台事务扣名额 / 改绑次数；成功后存该房间令牌、销毁 proof。 */
export async function cardRoomCommit(input: unknown): Promise<CardRoomCommitResult> {
  if (!cardModeEnabled()) return { ok: false, error: '本机未启用卡密平台' }
  const s = cardSession()
  if (!s) return { ok: false, error: '请先登录平台账号', code: 'not_logged_in' }
  const v = (input && typeof input === 'object' ? input : {}) as Partial<CardRoomCommitInput>
  const action = v.action
  if (action !== 'bind' && action !== 'replace') return { ok: false, error: '不支持的操作', code: 'invalid_action' }
  const room = parseRoomInput(v.room)
  if (!room) return { ok: false, error: '直播间号格式不正确', code: 'invalid_room' }
  const previous = action === 'replace' ? parseRoomInput(v.previous) : ''
  if (action === 'replace' && !previous) return { ok: false, error: '请选择要改绑的原直播间', code: 'invalid_room' }
  if (!licenseEnforced()) {
    // 免检：没有名额 / 次数 / 扫码要求，proof 有就销毁、没有也照绑；原直播间的抖音登录态留着（改回去不用重扫）
    if (action === 'replace' && previous === room) return { ok: false, error: '新旧直播间相同，不需要改绑', code: 'room_same' }
    const used = takeProof(v.proof, s.id)
    if (used) proofs.delete(used.id)
    const next = (action === 'replace' ? localBoundRooms(s.id).filter((r) => r !== previous) : [...localBoundRooms(s.id)])
    if (!next.includes(room)) next.push(room)
    const boundRooms = setLocalBoundRooms(s.id, next)
    logLine('card', `免检模式：${action === 'replace' ? `改绑 ${previous} → ${room}` : `绑定 ${room}`}（本机直接生效，不消耗名额；顺手报给平台）`)
    reportRooms(s.id, [{ action: 'bind', room }, ...(action === 'replace' && previous !== room ? [{ action: 'unbind' as const, room: previous }] : [])])
    return { ok: true, boundRooms, quota: freeQuota(s.id, boundRooms) }
  }
  const proof = takeProof(v.proof, s.id)
  if (!proof || proof.room !== room) return { ok: false, error: '扫码凭证已失效或与这个直播间不符，请重新核实', code: 'proof_invalid' }
  if (action === 'replace' && previous === room) return { ok: false, error: '新旧直播间相同，不需要改绑', code: 'room_same' }

  const key = (proof.idempotency[action + ':' + room + ':' + previous] ??= randomUUID())
  let quota: RoomQuotaState
  try {
    quota = await cardConnection().roomCommit(action, { room, previous: previous || undefined }, key)
  } catch (error) {
    const c = code(error)
    if (c === 'room_slot_card_required') return { ok: false, error: message(error, '直播间名额已用完'), code: c, needCard: 'room_slot' }
    if (c === 'room_change_card_required') return { ok: false, error: message(error, '改绑次数已用完'), code: c, needCard: 'room_change' }
    return { ok: false, error: message(error, '绑定失败'), code: c }
  }
  // 平台已经落账：不管此刻会话有没有变，令牌都记在 proof 的账号名下，proof 用掉即销毁
  proofs.delete(proof.id)
  try {
    tokens().set(proof.user, room, proof.cookie, { nickname: proof.nickname })
    if (action === 'replace' && previous !== room) tokens().remove(proof.user, previous)
  } catch (error) {
    logLine('card', '直播间登录状态保存失败：' + message(error, String(error)))
  }
  const boundRooms = applyQuota(proof.user, quota)
  return { ok: true, boundRooms, quota }
}

/** 解绑：走平台（解绑不计次），删掉该房间令牌；正在连这个房的连接器立刻停掉。 */
export async function cardRoomUnbind(roomInput: string): Promise<BindRoomResult> {
  const s = cardSession()
  if (!s) return { ok: false, error: '未登录' }
  const room = parseRoomInput(roomInput)
  if (!room) return { ok: false, error: '直播间号格式不正确', code: 'invalid_room' }
  if (!licenseEnforced()) {
    const boundRooms = setLocalBoundRooms(s.id, localBoundRooms(s.id).filter((r) => r !== room))
    try { tokens().remove(s.id, room) } catch { /* 令牌文件坏了也不影响解绑 */ }
    stopConnectorIfUsing(room, '已解绑')
    logLine('card', `免检模式：解绑 ${room}（本机直接生效；顺手报给平台）`)
    reportRooms(s.id, [{ action: 'unbind', room }])
    return { ok: true, boundRooms }
  }
  try {
    const quota = await cardConnection().roomCommit('unbind', { room })
    const boundRooms = applyQuota(s.id, quota)
    try { tokens().remove(s.id, room) } catch { /* 令牌文件坏了也不影响解绑 */ }
    stopConnectorIfUsing(room, '已解绑')
    return { ok: true, boundRooms }
  } catch (error) {
    return { ok: false, error: message(error, '解绑失败'), code: code(error) }
  }
}

function stopConnectorIfUsing(room: string, why: string): void {
  const cs = connectorState()
  if (!cs.sim && (cs.running || cs.connecting) && cs.roomId === room) {
    pushConnectorLog('error', `直播间 ${room} ${why}，连接器已停止；请重新绑定后再连接`)
    stopConnector()
  }
}

/** 兼容旧入口 bindRoom / bindRoomWithLicense：完整走「扫码 → 核实 → 平台绑定」，不能跳过任何一步。 */
async function bindCompat(roomInput: string): Promise<BindRoomResult> {
  const room = parseRoomInput(roomInput)
  if (!room) return { ok: false, error: '直播间号或链接格式不对：请填直播间号，或粘贴 live.douyin.com/… 的直播间链接', code: 'invalid_room' }
  const s = cardSession()
  if (!s) return { ok: false, error: '未登录' }
  // 已经绑着的房间：平台「同房重复绑定不消耗」，也不需要再扫一次
  if (localBoundRooms(s.id).includes(room)) {
    const fresh = await cardRooms()
    if (fresh.ok && fresh.quota?.rooms.includes(room)) return { ok: true, boundRooms: fresh.quota.rooms }
  }
  const verified = await cardRoomVerify(room)
  if (!verified.ok || !verified.proof) return { ok: false, error: verified.error || '直播间核实失败', code: verified.code }
  const committed = await cardRoomCommit({ action: 'bind', room, proof: verified.proof })
  if (!committed.ok) return { ok: false, error: committed.error, code: committed.code, needCard: committed.needCard }
  return { ok: true, boundRooms: committed.boundRooms }
}

async function syncCompat(): Promise<SyncEmailRoomsResult> {
  const s = cardSession()
  if (!s) return { ok: false, error: '未登录' }
  const before = localBoundRooms(s.id)
  const r = await cardRooms()
  if (!r.ok || !r.quota) return { ok: false, error: r.error }
  const rooms = r.quota.rooms
  return { ok: true, boundRooms: rooms, restored: rooms.filter((x) => !before.includes(x)), removed: before.filter((x) => !rooms.includes(x)) }
}

/**
 * 连接器启动前（卡密模式、真实直播间）：
 *   ① 向平台确认这个房间确已绑定在当前账号名下（平台是权威，连不上就不连）；
 *   ② 取当前账号 × 该房间的令牌，用它核实一次登录态；失效就删掉；
 *   ③ 没有有效令牌 → 扫码，拿到后核实并存下来；
 *   返回 cookie 交给 connector 按旧格式写进 mod 目录。isCurrent 由调用方给（代次 / 取消）。
 */
export async function prepareCardRoomConnection(roomInput: string, isCurrent: () => boolean): Promise<{ ok: true; room: string; cookie: string } | { ok: false; error: string; code?: string }> {
  const s = cardSession()
  if (!s) return { ok: false, error: '请先登录平台账号', code: 'not_logged_in' }
  const room = parseRoomInput(roomInput)
  if (!room) return { ok: false, error: '直播间号格式不正确', code: 'invalid_room' }
  const epoch = cardEpoch()
  const mine = (): boolean => isCurrent() && cardEpoch() === epoch && cardSession()?.id === s.id
  if (licenseEnforced()) {
    let quota: RoomQuotaState
    try {
      quota = await cardConnection().rooms()
    } catch (error) {
      return { ok: false, error: '无法向平台确认直播间绑定：' + message(error, String(error)), code: code(error) }
    }
    if (!mine()) return { ok: false, error: '已取消连接' }
    applyQuota(s.id, quota)
    if (!quota.rooms.includes(room)) return { ok: false, error: `直播间 ${room} 尚未绑定到当前账号，请先在直播间管理里扫码绑定`, code: 'room_not_bound' }
  } else {
    // 免检模式：不向平台核对绑定 / 额度，任何直播间都能连；抖音扫码登录态照旧（那是连直播间用的，不是授权）
    pushConnectorLog('info', '授权检查已暂停：不向平台核对直播间绑定，直接连接')
  }

  let cookie = ''
  try { cookie = tokens().get(s.id, room) || '' } catch (error) { pushConnectorLog('warn', '读取已保存的抖音登录状态失败：' + message(error, String(error))) }
  if (cookie) {
    const check = await lookupRoomWithCookie(room, cookie)
    if (!mine()) return { ok: false, error: '已取消连接' }
    if (check.needLogin) {
      try { tokens().remove(s.id, room) } catch { /* 忽略 */ }
      cookie = ''
      pushConnectorLog('warn', '这个直播间保存的抖音登录已失效，需要重新扫码')
    } else if (!check.ok) {
      // 网页资料解析只是辅助检查，不能拦住已保存登录态的连接
      pushConnectorLog('warn', '暂未读取到直播间资料，将使用已保存的登录状态继续连接')
    }
  }
  if (!cookie) {
    pushConnectorLog('info', '正在打开抖音网页，请扫码登录后自动继续连接')
    const scanned = await scan(s.id, `抖音扫码 · 连接直播间 ${room}`, mine)
    if (!scanned.ok) return { ok: false, error: scanned.error, code: scanned.code }
    if (!mine()) return { ok: false, error: '已取消连接' }
    const check = await lookupRoomWithCookie(room, scanned.cookie)
    if (!mine()) return { ok: false, error: '已取消连接' }
    if (check.needLogin) return { ok: false, error: check.error || '抖音登录已失效，请重试', code: 'login_expired' }
    if (!check.ok) pushConnectorLog('warn', '暂未读取到直播间资料，仍用刚扫码的登录状态继续连接')
    cookie = scanned.cookie
    try { tokens().set(s.id, room, cookie, { nickname: check.nickname }) } catch (error) { pushConnectorLog('warn', '保存抖音登录状态失败：' + message(error, String(error))) }
  }
  return { ok: true, room, cookie }
}

/**
 * 主播明确选择连接直播间 B、且平台已确认 B 绑定在当前账号名下之后（prepareCardRoomConnection 通过），
 * 把轮椅 mod config.json 里的 LiveRoomId 同步成 B —— 否则 mod 授权按旧房号 A 申请会被平台拒 room_not_bound。
 *   - 只改 LiveRoomId 这一个键，其余配置（视频 / 盲盒 / 礼物规则…）逐值原样保留；写法同 saveConfig（临时文件 + 改名）；
 *   - 只在这个入口调用：静默登录、读取页面、绑定 / 改绑都不会碰房号；
 *   - 已经一致就不写文件；轮椅目录不存在 / 文件坏了只报出来，不拦连接（mod 授权那边会给准确原因）。
 */
export function syncWheelRoomIdForConnection(room: string): { ok: boolean; changed: boolean; previous?: string; error?: string } {
  if (!ROOM_ID_RE.test(room)) return { ok: false, changed: false, error: '直播间号格式不正确，未改动轮椅参数' }
  const dir = cardWheelDirectory()
  if (!dir) return { ok: false, changed: false, error: '未找到轮椅整蛊器目录，未改动轮椅参数' }
  const file = join(dir, 'config.json')
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    data = parsed
  } catch {
    return { ok: false, changed: false, error: '轮椅 config.json 无法读取，未改动轮椅参数' }
  }
  const previous = String(data.LiveRoomId ?? data.liveRoomId ?? '').trim()
  if (previous === room) return { ok: true, changed: false, previous }
  const merged: Record<string, unknown> = { ...data, LiveRoomId: room }
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(merged, null, 2), { encoding: 'utf8', flag: 'wx', flush: true })
    fs.renameSync(temp, file)
  } catch (error) {
    try { fs.unlinkSync(temp) } catch { /* 没写成 */ }
    return { ok: false, changed: false, previous, error: '写入轮椅 config.json 失败：' + message(error, String(error)) }
  }
  return { ok: true, changed: true, previous }
}

/** 复核钩子：连接器在连真实直播间时，每 30 秒向平台确认一次该房仍在绑定列表里，不在就停掉连接器。 */
async function recheckRunningRoom(): Promise<void> {
  if (!licenseEnforced()) return
  const cs = connectorState()
  if (cs.sim || !cs.running || !cs.roomId) return
  if (performance.now() - lastRoomsRecheck < RECHECK_ROOMS_MS) return
  lastRoomsRecheck = performance.now()
  const s = cardSession()
  if (!s) return
  const quota = await cardConnection().rooms()
  if (cardSession()?.id !== s.id) return
  applyQuota(s.id, quota)
  if (!quota.rooms.includes(cs.roomId)) stopConnectorIfUsing(cs.roomId, '已在后台解绑')
}

registerCardRoomHooks({
  deny: destroyCardRoomProofs,
  login: async () => {
    const s = cardSession()
    if (!s) return
    if (!licenseEnforced()) {
      // 免检：登录不等平台，本机列表就是绑定列表。后台对一次账：
      //   · 本机一个都没有（换机 / 重装）→ 拿回平台上记着的；
      //   · 本机有 → 以本机为准，平台缺的补报上去（后台看得到）。不再把平台多出来的并回本机：
      //     平台那边还会记下心跳里正在连的直播间，并回来会让主播自己删掉的房间又冒出来。
      // 平台联系不上或拒绝就只用本机记录。
      void (async () => {
        try {
          const quota = await cardConnection().rooms()
          if (cardSession()?.id !== s.id) return
          const local = localBoundRooms(s.id)
          const remote = Array.isArray(quota.rooms) ? quota.rooms : []
          if (!local.length) {
            if (remote.length) setLocalBoundRooms(s.id, remote)
            return
          }
          reportRooms(s.id, local.filter((r) => !remote.includes(r)).map((room) => ({ action: 'bind' as const, room })))
        } catch (error) {
          logLine('card', '免检模式：平台绑定列表没对上账（用本机记录）：' + message(error, String(error)))
        }
      })()
      return
    }
    const quota = await cardConnection().rooms()
    if (cardSession()?.id === s.id) applyQuota(s.id, quota)
  },
  recheck: recheckRunningRoom,
  bind: bindCompat,
  unbind: cardRoomUnbind,
  sync: syncCompat
})
