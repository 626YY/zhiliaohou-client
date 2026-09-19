// 邮箱验证码/账号/授权：直连服务器 /api/email/*（主进程 fetch，无 CORS 限制）。
// 服务器是新补丁模块 emailauth.py，成功标记 ok:1；连不上时给友好错误，绝不影响游戏。
import fs from 'fs'
import { join } from 'path'
import { net } from 'electron'
import { credGetUser } from './cred-store'
import { cardModeEnabled } from './card-provider'
import { compatLegacy } from './card-compat'
import { getSettings } from './settings'
import { wheelLiveDir } from './bridge'
import type { LiveReportEvent, LiveReportReply } from './live-report-queue'
import type {
  EmailAuthResult,
  EmailLicense,
  EmailGameApplyResult,
  AppNotification,
  NotifyListResult,
  ConfigCloudResult
} from '@shared/types'

const REQUEST_TIMEOUT_MS = 10_000

// 邮箱账号的会话凭证（登录/注册/重置时服务器发的 session）：所有带 email 的请求自动附上，
// 服务器据此认「真的是这个账号在操作」——以前只凭 email 字符串，知道邮箱就能解绑/改绑/覆盖别人的云配置
const emailSessions = new Map<string, string>()
export function setEmailSession(email: string, token: string | undefined): void {
  const key = String(email || '').trim().toLowerCase()
  if (!key) return
  if (token) emailSessions.set(key, token)
  else emailSessions.delete(key)
}
// 自动重登：服务器说凭证失效（relogin=1）时，用「记住密码」里存的密码静默登录一次拿新凭证，再把原请求重发一次。
// 主播换机/清数据/凭证过期都无感；没记住密码才需要手动重新登录。auth.ts 注册 onSessionRefreshed 把新凭证写回 users.json。
let sessionRefreshedHook: ((email: string, token: string) => void) | null = null
export function onSessionRefreshed(fn: (email: string, token: string) => void): void {
  sessionRefreshedHook = fn
}
async function tryRelogin(email: string): Promise<boolean> {
  const password = credGetUser(email)
  if (!password) return false
  const r = await post('/api/email/login', { email, password, want_session: 1 }, true)
  const token = r && Number(r.ok ?? 0) === 1 && typeof r.session === 'string' ? r.session : ''
  if (!token) return false
  setEmailSession(email, token)
  try { sessionRefreshedHook?.(email, token) } catch { /* 写回失败不影响本次 */ }
  return true
}

function withSession(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const b = body as Record<string, unknown>
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const token = email ? emailSessions.get(email) : undefined
  return token && !b.session ? { ...b, session: token } : body
}

async function post(
  path: string,
  body: unknown,
  noRelogin = false
): Promise<Record<string, unknown> | null> {
  // 卡密平台模式：旧服务器的邮箱 / 授权 / 绑定 / 申请接口一律不发（也不会拿记住的密码去重登）。
  // 通知 / 云配置 / 心跳 / 观众记录这几项辅助能力不走这里，而是由卡密平台代调（下面各函数里的 compatLegacy 分路）。
  // 没有卡密配置时这一行不生效，下面全是原来的行为。
  if (cardModeEnabled()) return { ok: 0, error: '当前客户端使用卡密平台授权，不连接旧服务器' }
  const r = await postOnce(path, withSession(body))
  // 凭证失效 → 自动重登一次再重试（登录接口本身不重试）
  if (!noRelogin && r && Number(r.relogin ?? 0) === 1 && body && typeof body === 'object') {
    const email = String((body as Record<string, unknown>).email || '').trim().toLowerCase()
    if (email && (await tryRelogin(email))) return postOnce(path, withSession(body))
  }
  return r
}

async function postOnce(
  path: string,
  body: unknown
): Promise<Record<string, unknown> | null> {
  const url = getSettings().serverUrl.replace(/\/+$/, '') + path
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    // net.fetch：走 Electron 网络栈，服务器自签证书的指纹校验（server-tls.ts）才生效；Node 的 fetch 会直接拒掉自签证书
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!res.ok) {
      // 401 的 relogin 与 403 的绑定/授权原因要保留；只返回状态码会阻断自动重登并让记录永久积压。
      const errorBody = await res.json().catch(() => null) as Record<string, unknown> | null
      return { ...(errorBody && typeof errorBody === 'object' ? errorBody : {}), ok: 0,
        error: typeof errorBody?.error === 'string' ? errorBody.error : `服务器返回 ${res.status}` }
    }
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function norm(r: Record<string, unknown> | null): EmailAuthResult {
  if (!r) return { ok: false, error: '无法连接服务器，请检查网络' }
  const ok = Number(r.ok ?? 0) === 1
  return {
    ok,
    email: typeof r.email === 'string' ? r.email : undefined,
    licensed: Number(r.licensed ?? 0),
    banned: Number(r.banned ?? 0),
    session: typeof r.session === 'string' && r.session ? r.session : undefined,
    error: ok ? undefined : String(r.error ?? '操作失败')
  }
}

export async function sendEmailCode(email: string): Promise<EmailAuthResult> {
  return norm(await post('/api/email/code', { email }))
}

export async function emailRegister(
  email: string,
  code: string,
  password: string
): Promise<EmailAuthResult> {
  return norm(await post('/api/email/register', { email, code, password, want_session: 1 }, true))
}

export async function emailLogin(
  email: string,
  password: string
): Promise<EmailAuthResult> {
  return norm(await post('/api/email/login', { email, password, want_session: 1 }, true))
}

export async function resetPassword(
  email: string,
  code: string,
  password: string
): Promise<EmailAuthResult> {
  return norm(await post('/api/email/reset', { email, code, password, want_session: 1 }, true))
}

export async function getEmailLicense(email: string): Promise<EmailLicense> {
  const r = await post('/api/email/license', { email })
  if (!r) {
    return { ok: false, licensed: 0, banned: 0, expire: '', note: '无法连接服务器' }
  }
  const games: Record<string, number> = {}
  const rg = r.games
  if (rg && typeof rg === 'object') {
    for (const [k, v] of Object.entries(rg as Record<string, unknown>)) {
      // 兼容两种结构：老 {game:1} 与 新 {game:{licensed,expire}}（服务器已滤过期）
      const lv =
        typeof v === 'object' && v
          ? Number((v as { licensed?: unknown }).licensed ?? 0)
          : Number(v ?? 0)
      if (lv === 1) games[k] = 1
    }
  }
  const pendingGames: string[] = Array.isArray(r.pending_games)
    ? (r.pending_games as unknown[]).map(String).filter(Boolean)
    : []
  // 服务器侧登记的绑定直播间（老服务器没这个字段时保持 undefined，调用方据此跳过恢复）
  const rooms: string[] | undefined = Array.isArray(r.rooms)
    ? (r.rooms as unknown[]).map(String).filter(Boolean)
    : undefined
  return {
    ok: Number(r.ok ?? 0) === 1,
    licensed: Number(r.licensed ?? 0),
    banned: Number(r.banned ?? 0),
    expire: String(r.expire ?? ''),
    note: String(r.note ?? ''),
    games,
    pendingGames,
    rooms
  }
}

// 申请某个游戏的授权（首个直通 / 其余进待审批，后台批准后自动解锁）
export async function gameApply(
  email: string,
  game: string
): Promise<EmailGameApplyResult> {
  const r = await post('/api/email/game_apply', {
    email: email.trim().toLowerCase(),
    game
  })
  if (!r) return { ok: false, error: '无法连接服务器，请检查网络' }
  const ok = Number(r.ok ?? 0) === 1
  if (!ok) return { ok: false, error: String(r.error ?? '申请失败') }
  const status = ['granted', 'pending', 'already'].includes(String(r.status ?? ''))
    ? (String(r.status) as EmailGameApplyResult['status'])
    : undefined
  return { ok: true, status }
}

// 上报自由解绑记录：客户端解绑直播间号后直连服务器留痕（/api/license/unbind_log，无需审批）。
// 失败不影响本地解绑，只少一条后台可查的记录。
export async function reportUnbind(room: string, by: string): Promise<void> {
  try {
    await post('/api/license/unbind_log', { room: room.trim(), by: by || '' })
  } catch {
    // 忽略
  }
}

// 上报邮箱 ↔ 直播间绑定关系（后台邮箱账号表显示绑定主播/房号）。失败不影响本地绑定。
export async function reportBind(email: string, room: string): Promise<void> {
  try {
    await post('/api/email/bind', { email: email.trim(), room: room.trim() })
  } catch {
    // 忽略
  }
}

// 解绑时同步解除邮箱 ↔ 直播间绑定
export async function reportEmailUnbind(email: string, room: string): Promise<void> {
  try {
    await post('/api/email/unbind', { email: email.trim(), room: room.trim() })
  } catch {
    // 忽略
  }
}

// 购买申请直发服务器（/api/license/apply）。2026-08-13 修复：原流程只写 apply_request.json
// 等连接器代发，但代发逻辑只有轮椅连接器有——当前游戏是 DS/图书馆、或连接器没在跑时，
// 申请永远到不了后台。服务端按房间幂等（重复申请只更新时间/机器码），与连接器代发双通道安全。
// already=1 表示该房已授权（作者已批过），调用方应直接绑定而不是干等审批。
export async function submitLicenseApply(
  room: string,
  by: string
): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const r = await post('/api/license/apply', {
    room: room.trim(),
    anchor_name: '',
    machine_id: '',
    note: by ? `客户端直发(${by})` : '客户端直发'
  })
  if (!r) return { ok: false, error: '无法连接服务器，请检查网络' }
  const ok = Number(r.ok ?? 0) === 1
  return {
    ok,
    already: Number(r.already ?? 0) === 1,
    error: ok ? undefined : String(r.err ?? r.error ?? '申请提交失败')
  }
}

// 辅助能力分路：卡密模式 → 平台代调原邮箱服务（邮箱由平台按登录账号决定，这里只核对调用方给的邮箱是当前账号）；
// 否则 → 原样直连旧服务器。两条路的返回都是旧接口风格，下面的归一化代码不用分开写。
function aux(
  operation: 'notify' | 'config-save' | 'config-get' | 'heartbeat' | 'live-events',
  email: string,
  legacyPath: string,
  legacyBody: Record<string, unknown>,
  compatBody: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  return cardModeEnabled() ? compatLegacy(operation, compatBody, email) : post(legacyPath, legacyBody)
}

// 通知中心：拉取当前邮箱的通知列表 / 标记已读。新通知由主进程轮询监听，NotNotifyNew 推送渲染层弹 toast。
export async function getNotifications(email: string): Promise<NotifyListResult> {
  const e = email.trim().toLowerCase()
  const r = await aux('notify', e, '/api/email/notify', { email: e, op: 'list' }, { op: 'list' })
  if (!r) return { ok: false, error: '无法连接服务器，请检查网络' }
  const raw = Array.isArray(r.list) ? r.list : []
  const list: AppNotification[] = raw
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>
      return {
        id: String(o.id ?? ''),
        type: String(o.type ?? ''),
        text: String(o.text ?? ''),
        ts: Number(o.ts ?? 0),
        read: Number(o.read ?? 0),
        room: o.room ? String(o.room) : undefined,
        newRoom: o.new_room ? String(o.new_room) : undefined
      }
    })
    .filter((n) => n.id)
  const ok = Number(r.ok ?? 0) === 1
  return ok ? { ok: true, list } : { ok: false, list, error: String(r.error ?? '通知拉取失败') }
}

export async function markNotifyRead(email: string, id: string): Promise<void> {
  try {
    const e = email.trim().toLowerCase()
    const nid = String(id ?? '')
    await aux('notify', e, '/api/email/notify', { email: e, op: 'read', id: nid }, { op: 'read', id: nid })
  } catch {
    // 忽略
  }
}

export async function markNotifyReadAll(email: string): Promise<void> {
  try {
    const e = email.trim().toLowerCase()
    await aux('notify', e, '/api/email/notify', { email: e, op: 'read_all' }, { op: 'read_all' })
  } catch {
    // 忽略
  }
}

// 配置云同步：mod 参数备份/恢复到服务器（按邮箱隔离）。备份是当前 config values 整包。
export async function configCloudSave(
  email: string,
  data: unknown
): Promise<ConfigCloudResult> {
  const e = email.trim().toLowerCase()
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: '配置数据格式不对' }
  const r = await aux('config-save', e, '/api/email/config_save', { email: e, data }, { data })
  if (!r) return { ok: false, error: '无法连接服务器，请检查网络' }
  const ok = Number(r.ok ?? 0) === 1
  return ok ? { ok: true } : { ok: false, error: String(r.error ?? '备份失败') }
}

export async function configCloudLoad(
  email: string
): Promise<ConfigCloudResult> {
  const e = email.trim().toLowerCase()
  const r = await aux('config-get', e, '/api/email/config_get', { email: e }, {})
  if (!r) return { ok: false, error: '无法连接服务器，请检查网络' }
  const ok = Number(r.ok ?? 0) === 1
  if (!ok) return { ok: false, error: String(r.error ?? '拉取失败') }
  const data =
    r.data && typeof r.data === 'object'
      ? (r.data as Record<string, unknown>)
      : null
  if (!data) return { ok: true, has: false }
  return { ok: true, has: true, data }
}

// 购买授权联系方式：公开接口，返回作者填的联系方式。空串 = 后台没设置 → 客户端不显示购买入口。
export async function getBuyContact(): Promise<string> {
  const r = await post('/api/email/buy_contact', {})
  if (!r) return ''
  return String(r.contact ?? '')
}

// 在线心跳：客户端定时上报当前邮箱 + 房间 + 连接器/游戏状态（后台在线面板用）。失败静默。
export async function sendLiveEvents(email: string, room: string, game: string, version: string, events: LiveReportEvent[]): Promise<LiveReportReply> {
  // 只传观众记录的七个字段：昵称 / 礼物 / 数量 / 抖币 / 时间 / 类型 / 编号；不带 cookie、令牌、本机用户名之类的东西
  const clean = events.map(({ id, ts, type, nick, gift, count, coins }) => ({ id, ts, type, nick, gift, count, coins }))
  const e = email.trim().toLowerCase()
  const r = await aux('live-events', e, '/api/email/live-events', { email: e, room, game, v: version, events: clean }, { room, game, v: version, events: clean })
  return {
    ok: Number(r?.ok) === 1,
    accepted: Array.isArray(r?.accepted) ? r.accepted.filter((id): id is string => typeof id === 'string') : [],
    error: r ? String(r.error || r.err || '服务器未接收观众记录，请确认服务已更新') : '无法连接服务器，记录已保留待重试'
  }
}

export async function sendHeartbeat(
  email: string,
  room: string,
  connector: boolean,
  game: boolean
): Promise<void> {
  try {
    const e = email.trim().toLowerCase()
    const body = { room: room || '', connector: connector ? 1 : 0, game: game ? 1 : 0 }
    await aux('heartbeat', e, '/api/email/heartbeat', { email: e, ...body }, body)
  } catch {
    // 忽略
  }
}

// 登录成功后把当前邮箱写给连接器读（合并进 license_status.json 供 mod 显示授权）
export function writeEmailAccount(email: string): void {
  const dir = wheelLiveDir()
  if (!dir) return
  try {
    fs.writeFileSync(
      join(dir, 'email_account.json'),
      JSON.stringify({ email: email.trim().toLowerCase(), ts: Date.now() }),
      'utf-8'
    )
  } catch {
    // 写失败不影响登录，连接器最多拿不到邮箱授权
  }
}

// 连接器通过该文件识别当前邮箱账号。切换到本地账号或注销时必须移除它，
// 否则后续连接会把已退出的邮箱继续带给 Mod。
export function clearEmailAccount(): void {
  const dir = wheelLiveDir()
  if (!dir) return
  try {
    fs.unlinkSync(join(dir, 'email_account.json'))
  } catch {
    // 文件不存在或暂时无法删除都不影响注销主流程
  }
}
