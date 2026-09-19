import bcrypt from 'bcryptjs'
import { createCollection, uid } from './db'
import {
  emailRegister as serverRegister,
  emailLogin as serverLogin,
  writeEmailAccount,
  clearEmailAccount,
  getEmailLicense,
  getNotifications,
  reportBind,
  setEmailSession,
  onSessionRefreshed
} from './email-api'
import type {
  AppNotification,
  AuthResult,
  BindRoomResult,
  SessionUser,
  SyncEmailRoomsResult,
  User
} from '@shared/types'

const users = createCollection<User>('users')
let sessionUser: SessionUser | null = null

// 自动重登拿到的新凭证写回本地账号，重启后仍可用
onSessionRefreshed((email, token) => {
  const u = users.find((x) => x.username.toLowerCase() === email.toLowerCase())
  if (u) users.update(u.id, { emailSession: token })
})

function toSession(u: User): SessionUser {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    createdAt: u.createdAt,
    boundRooms: u.boundRooms ?? [],
    email: u.email
  }
}

const MAX_ROOMS = 2
// 抖音直播间号是字母+数字混合（不是纯数字），只约束字符集和长度
const ROOM_RE = /^[0-9A-Za-z_-]{1,64}$/

export function currentUser(): User | null {
  if (!sessionUser) return null
  return users.find((u) => u.id === sessionUser!.id) ?? null
}

function refreshSession(u: User): SessionUser {
  sessionUser = toSession(u)
  return sessionUser
}

// 绑定直播间号：默认每账号最多 2 个；邮箱已授权账号不限数量（unlimited=true 跳过上限）。
// 重复绑定忽略；格式校验放行字母+数字
export function bindRoom(
  roomId: string,
  unlimited = false
): BindRoomResult {
  const user = currentUser()
  if (!user) return { ok: false, error: '未登录' }
  const room = roomId.trim()
  if (!ROOM_RE.test(room)) return { ok: false, error: '直播间号格式不对（字母或数字）' }
  const cur = user.boundRooms ?? []
  if (cur.includes(room)) return { ok: true, boundRooms: cur }
  if (!unlimited && cur.length >= MAX_ROOMS) {
    return {
      ok: false,
      error: `最多只能绑定 ${MAX_ROOMS} 个直播间号，请先解绑一个`
    }
  }
  const next = [...cur, room]
  // 绑定成功即清掉该房的解绑墓碑（重新绑定的房允许以后再被同步恢复），并记绑定时间
  //（同步要靠它分辨「服务器漏登记 → 补报」和「后台解绑 → 本地移除」：后台动作比本地绑定新才算数）
  const unbound = (user.unboundRooms ?? []).filter((r) => r !== room)
  const bindAt = { ...(user.roomBindAt ?? {}), [room]: Date.now() }
  users.update(user.id, {
    boundRooms: next,
    everBound: true,
    unboundRooms: unbound,
    roomBindAt: bindAt
  })
  return {
    ok: true,
    boundRooms: refreshSession(users.find((u) => u.id === user.id)!).boundRooms
  }
}

// 登录页账号下拉：返回本地账号摘要（无密码哈希），按最近登录倒序
export function listAccounts() {
  return users
    .all()
    .map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      email: u.email,
      avatar: u.avatar,
      lastLoginAt: u.lastLoginAt ?? 0
    }))
    .sort((a, b) => b.lastLoginAt - a.lastLoginAt)
}

// 删除账号：删本地登录记录；邮箱账号的服务器账号需到后台「邮箱账号」区彻底删除
export function deleteAccount(
  id: string
): { ok: boolean; error?: string; email?: string } {
  const u = users.find((x) => x.id === id)
  if (!u) return { ok: false, error: '账号不存在' }
  const email = u.email
  users.remove(id)
  if (sessionUser?.id === id) {
    sessionUser = null
    clearEmailAccount()
  }
  return { ok: true, email }
}

export function unbindRoom(roomId: string): BindRoomResult {
  const user = currentUser()
  if (!user) return { ok: false, error: '未登录' }
  const room = roomId.trim()
  const next = (user.boundRooms ?? []).filter((r) => r !== room)
  // 记解绑墓碑：若解绑上报服务器失败，服务器还留着这个房，
  // 没有墓碑的话下次邮箱同步会把它「复活」回本地
  const tomb = new Set(user.unboundRooms ?? [])
  if ((user.boundRooms ?? []).includes(room)) tomb.add(room)
  const bindAt = { ...(user.roomBindAt ?? {}) }
  delete bindAt[room]
  users.update(user.id, {
    boundRooms: next,
    unboundRooms: [...tomb],
    roomBindAt: bindAt
  })
  return {
    ok: true,
    boundRooms: refreshSession(users.find((u) => u.id === user.id)!).boundRooms
  }
}

// 邮箱 ↔ 直播间绑定双向对齐（2026-09-06：「后台显示已绑定、客户端没绑」「后台换绑客户端没反应」
// 的根因 = 服务器 email_binds 与本地 boundRooms 是两套数据，之前没有任何同步）：
//   下行恢复：服务器有、本地没有、且不在解绑墓碑里的房 → 邮箱已授权账号直接本地补绑；
//   上行补报：本地有、服务器没登记、且没有更新的后台解绑动作 → reportBind 补登（失败静默）；
//   后台动作：通知流水里该房最近一次后台解绑/换绑时间 > 本地绑定时间 → 本地跟着解绑
//            （后台操作赢；本地重绑过则本地赢，转而走上行补报）。
// 服务器还没升级返回 rooms 字段时（undefined）整轮跳过，绝不拿空列表当「服务器没房」误判。
// notifs 由通知轮询顺手传入（省一次请求）；不传则自己拉。
export async function syncEmailRooms(
  notifs?: AppNotification[]
): Promise<SyncEmailRoomsResult> {
  const user = currentUser()
  if (!user) return { ok: false, error: '未登录' }
  if (!user.email) return { ok: false, error: '非邮箱账号' }
  const email = user.email
  const lic = await getEmailLicense(email)
  const list = notifs ?? (await getNotifications(email)).list
  const active = currentUser()
  if (!active || active.id !== user.id) {
    return { ok: false, error: '当前登录账号已变化' }
  }
  if (!lic.ok) return { ok: false, error: lic.note || '无法连接服务器' }
  if (!Array.isArray(lic.rooms)) {
    return { ok: true, boundRooms: active.boundRooms ?? [], restored: [] }
  }
  const serverRooms = lic.rooms

  // 通知流水 → 每个房最近一次「后台移除」时间（unbind=解绑；replace 的旧房=换绑移除）
  const adminRemovedAt: Record<string, number> = {}
  for (const n of list ?? []) {
    const room = String(n.room ?? '')
    if (!room) continue
    if (n.type !== 'unbind' && n.type !== 'replace') continue
    const ts = Number(n.ts ?? 0) * 1000
    if (ts > (adminRemovedAt[room] ?? 0)) adminRemovedAt[room] = ts
  }

  const unlimited =
    lic.licensed === 1 || Object.keys(lic.games ?? {}).length > 0

  // 本地有、服务器没有：看后台移除时间 vs 本地绑定时间决定跟谁
  const removed: string[] = []
  for (const r of [...(active.boundRooms ?? [])]) {
    if (serverRooms.includes(r)) continue
    const bindAt = (active.roomBindAt ?? {})[r] ?? 0
    if ((adminRemovedAt[r] ?? 0) > bindAt) {
      // 后台解绑/换绑比这几次本地绑定都新 → 跟后台（unbindRoom 只动本地+墓碑，不上报）
      if (unbindRoom(r).ok) removed.push(r)
    } else {
      // 服务器只是漏登记（比如绑定时断网）→ 补报留痕
      void reportBind(email, r)
    }
  }

  // 服务器有、本地没有：仅邮箱已授权账号自动补绑（未授权账号受上限约束，不替用户做选择）
  const restored: string[] = []
  if (unlimited) {
    const tomb = new Set(currentUser()?.unboundRooms ?? [])
    for (const s of serverRooms) {
      const cur = currentUser()?.boundRooms ?? []
      if (cur.includes(s) || tomb.has(s) || restored.includes(s)) continue
      if (bindRoom(s, true).ok) restored.push(s)
    }
  }
  const after = currentUser()
  return {
    ok: true,
    boundRooms: after?.boundRooms ?? [],
    restored,
    removed
  }
}

export function register(
  username: string,
  password: string,
  nickname: string
): AuthResult {
  const uname = username.trim()
  const nick = nickname.trim() || uname
  if (uname.length < 3) return { ok: false, error: '用户名至少 3 个字符' }
  if (!/^[a-zA-Z0-9_一-龥]+$/.test(uname))
    return { ok: false, error: '用户名只能包含中文、字母、数字、下划线' }
  if (password.length < 6) return { ok: false, error: '密码至少 6 个字符' }
  const exist = users.find(
    (u) => u.username.toLowerCase() === uname.toLowerCase()
  )
  if (exist) return { ok: false, error: '该用户名已被注册' }

  const user: User = {
    id: uid(),
    username: uname,
    passwordHash: bcrypt.hashSync(password, 10),
    nickname: nick,
    avatar: '',
    createdAt: Date.now(),
    lastLoginAt: Date.now()
  }
  users.insert(user)
  sessionUser = toSession(user)
  clearEmailAccount()
  return { ok: true, user: sessionUser }
}

export function login(username: string, password: string): AuthResult {
  const user = users.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase()
  )
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { ok: false, error: '用户名或密码不正确' }
  }
  if (user.email) {
    // 邮箱账号由服务器校验（含封禁/授权），不能走本地绕过
    return { ok: false, error: '邮箱账号请通过邮箱登录' }
  }
  users.update(user.id, { lastLoginAt: Date.now() })
  sessionUser = toSession(user)
  clearEmailAccount()
  return { ok: true, user: sessionUser }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// 邮箱账号本地落账（会话缓存），用户名就是邮箱
function upsertEmailUser(email: string, password: string, nickname?: string, session?: string): User {
  const uname = email.trim().toLowerCase()
  const now = Date.now()
  const exist = users.find((u) => u.username.toLowerCase() === uname)
  if (exist) {
    users.update(exist.id, {
      passwordHash: bcrypt.hashSync(password, 10),
      lastLoginAt: now,
      nickname: nickname?.trim() || exist.nickname || uname.split('@')[0],
      ...(session ? { emailSession: session } : {})
    })
  } else {
    users.insert({
      id: uid(),
      username: uname,
      passwordHash: bcrypt.hashSync(password, 10),
      nickname: nickname?.trim() || uname.split('@')[0],
      avatar: '',
      email: uname,
      createdAt: now,
      lastLoginAt: now,
      ...(session ? { emailSession: session } : {})
    })
  }
  const user = users.find((u) => u.username.toLowerCase() === uname)!
  setEmailSession(uname, user.emailSession)
  return user
}

// 邮箱注册：服务器真验证码 + 服务器建号，本地留会话缓存
export async function registerEmail(
  email: string,
  code: string,
  password: string,
  nickname?: string
): Promise<AuthResult> {
  const e = email.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return { ok: false, error: '邮箱格式不对' }
  const res = await serverRegister(e, code, password)
  if (!res.ok) return { ok: false, error: res.error ?? '注册失败' }
  const user = upsertEmailUser(e, password, nickname, res.session)
  sessionUser = toSession(user)
  writeEmailAccount(e)
  return { ok: true, user: sessionUser }
}

// 邮箱登录：服务器校验密码/封禁，登录后把邮箱写给连接器
export async function loginEmail(
  email: string,
  password: string
): Promise<AuthResult> {
  const e = email.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return { ok: false, error: '邮箱格式不对' }
  const res = await serverLogin(e, password)
  if (!res.ok) return { ok: false, error: res.error ?? '登录失败' }
  const user = upsertEmailUser(e, password, undefined, res.session)
  sessionUser = toSession(user)
  writeEmailAccount(e)
  return { ok: true, user: sessionUser }
}

export function logout(): void {
  sessionUser = null
  clearEmailAccount()
}

// 更新当前用户头像（主播抖音头像，绑定直播间/启动刷新时写入）
export function updateAvatar(avatar: string): SessionUser | null {
  const user = currentUser()
  if (!user || !avatar) return sessionUser
  if (user.avatar === avatar) return sessionUser
  users.update(user.id, { avatar })
  return refreshSession(users.find((u) => u.id === user.id)!)
}

export function session(): SessionUser | null {
  return sessionUser
}
