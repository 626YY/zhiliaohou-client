import fs from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { wheelLiveDir } from './bridge'
import { bindRoom, currentUser, unbindRoom } from './auth'
import { licenseEnforced } from './license-policy'
import {
  reportUnbind,
  reportBind,
  reportEmailUnbind,
  getEmailLicense,
  submitLicenseApply
} from './email-api'
import {
  Ipc,
  type BindRoomResult,
  type LicenseStatus
} from '@shared/types'

// 卡密授权门禁：绑定直播间号前，必须先拿到该直播间的卡密授权。
// 授权状态完全复用连接器的通道（license_status.json），客户端不直接联网：
//   已授权 → 允许绑定；未授权 → 引导申请（写 apply_request.json，连接器自动代发服务器）；
//   作者审批通过后连接器取回授权，客户端轮询到 licensed 即自动绑定。
// ★新规则（2026-08-04 用户）：邮箱已授权账号绑定随便绑（不限数量）；普通账号第一个直播间
//   直接绑、第二个起才需要申请卡密；解绑自由（无需审批，仅上报服务器留痕）。

let watchTimer: ReturnType<typeof setInterval> | null = null
let watchRoom = ''
let watchOwnerId = ''
let watchGeneration = 0

async function bindCurrentUser(
  room: string,
  ownerId?: string,
  isStillValid?: () => boolean
): Promise<BindRoomResult> {
  const user = currentUser()
  if (!user || (ownerId && user.id !== ownerId)) {
    return { ok: false, error: '当前登录账号已变化' }
  }

  let unlimited = false
  if (user.email) {
    const lic = await getEmailLicense(user.email)
    const activeUser = currentUser()
    if (
      !activeUser ||
      activeUser.id !== user.id ||
      (isStillValid && !isStillValid())
    ) {
      return { ok: false, error: '当前登录账号已变化' }
    }
    unlimited =
      lic.ok &&
      (lic.licensed === 1 || Object.keys(lic.games ?? {}).length > 0)
  }

  if (isStillValid && !isStillValid()) {
    return { ok: false, error: '授权申请已取消' }
  }
  const res = bindRoom(room, unlimited)
  if (res.ok && user.email) void reportBind(user.email, room.trim())
  return res
}

export function licenseStatusFor(room: string): LicenseStatus {
  const empty: LicenseStatus = {
    known: false,
    room,
    licensed: false,
    banned: false,
    applying: false,
    expire: ''
  }
  const dir = wheelLiveDir()
  if (!dir) return empty
  const path = join(dir, 'license_status.json')
  if (!fs.existsSync(path)) return empty
  try {
    const st = JSON.parse(fs.readFileSync(path, 'utf-8'))
    const roomMatch = String(st.room ?? '') === room.trim()
    return {
      known: roomMatch,
      room: String(st.room ?? ''),
      banned: String(st.banned ?? '') === '1',
      licensed:
        roomMatch &&
        Number(st.licensed ?? 0) === 1 &&
        String(st.banned ?? '') !== '1',
      applying: ['sent', 'local'].includes(String(st.apply ?? '')),
      expire: String(st.expire ?? '')
    }
  } catch {
    return empty
  }
}

// 绑定前门禁（2026-08-04 用户定规则）：
//   只有「从没绑定过」的首次直接绑；此后（含解绑后重绑、绑第二个）都要走授权/申请。
//   该房间已获卡密授权 → 直接绑；未授权 → 引导申请（写 apply_request.json，连接器代发服务器）。
export async function bindRoomWithLicense(room: string): Promise<BindRoomResult> {
  const user = currentUser()
  if (!user) return { ok: false, error: '未登录' }
  // 免检模式：旧账号系统绑直播间也不再看授权 / 申请审批，直接绑
  if (!licenseEnforced()) return bindCurrentUser(room, user.id)
  // 首次绑定（从没绑过）直接绑；解绑后再绑 / 绑更多 → 走下面的申请流程
  if (!user.everBound) return bindCurrentUser(room, user.id)
  // ★邮箱已授权账号绑定随便绑（2026-08-04 规则）：先查邮箱授权，直接放行。
  //   原顺序把 unlimited 判断放在 bindCurrentUser 里，走到那之前已被下面的
  //   房间卡密门禁（licenseStatusFor）拦去申请——邮箱已授权用户绑第二个房间被误挡。
  if (user.email) {
    const lic = await getEmailLicense(user.email)
    const activeUser = currentUser()
    if (!activeUser || activeUser.id !== user.id) {
      return { ok: false, error: '当前登录账号已变化' }
    }
    if (lic.ok && (lic.licensed === 1 || Object.keys(lic.games ?? {}).length > 0)) {
      return bindCurrentUser(room, user.id)
    }
  }
  const st = licenseStatusFor(room)
  if (st.banned) return { ok: false, error: '该直播间已被封禁，请联系作者' }
  if (st.licensed) return bindCurrentUser(room, user.id)
  if (st.applying)
    return { ok: false, pending: true, error: '该直播间申请审批中，通过后自动绑定' }
  if (st.known)
    return { ok: false, needApply: true, error: '该直播间未授权，需先申请购买' }
  return {
    ok: false,
    needApply: true,
    error: '暂无法确认授权，请先启动连接器连接该直播间'
  }
}

// 提交购买申请：① 客户端直发服务器（2026-08-13 修复：原实现只写 apply_request.json 等连接器
// 代发，但代发逻辑只有轮椅连接器有——当前游戏是 DS/图书馆、或连接器没在跑时，申请永远到不了后台）；
// ② 文件照写，连接器在跑时代发做双通道（服务端按房间幂等，重复申请只更新时间，不会出重复条目）。
// 服务器回 already=1（作者已批过）→ 不干等审批，直接完成绑定。
export async function submitRoomApply(room: string): Promise<BindRoomResult> {
  const user = currentUser()
  if (!user) return { ok: false, error: '未登录' }
  const requestedRoom = room.trim()
  if (!requestedRoom) return { ok: false, error: '直播间号不能为空' }

  const r = await submitLicenseApply(requestedRoom, user.email || user.username)
  if (r.ok && r.already) {
    const bound = await bindCurrentUser(requestedRoom, user.id)
    if (bound.ok) return { ok: true, bound: true, boundRooms: bound.boundRooms }
    if (!bound.ok && bound.error !== '当前登录账号已变化') {
      return { ok: false, error: bound.error }
    }
    return bound
  }

  // 文件通道照走（连接器代发做兜底/双发，服务端幂等）
  const dir = wheelLiveDir()
  if (dir) {
    try {
      fs.writeFileSync(
        join(dir, 'apply_request.json'),
        JSON.stringify({ room: requestedRoom, note: '' }),
        'utf-8'
      )
    } catch {
      // 写失败不阻断：直发已经成功
    }
  }
  if (!r.ok && !dir) {
    return { ok: false, error: r.error || '未找到 Mod 目录，且无法连接服务器' }
  }
  startWatching(requestedRoom, user.id)
  return { ok: true }
}

export function cancelRoomApply(): { ok: boolean } {
  stopWatching()
  // 把待代发的申请文件一并删掉，否则连接器仍会把它发到服务器，「取消」形同虚设
  const dir = wheelLiveDir()
  if (dir) {
    try {
      const p = join(dir, 'apply_request.json')
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      // 删不掉也照常返回成功，本地已停止轮询
    }
  }
  return { ok: true }
}

function startWatching(room: string, ownerId: string): void {
  stopWatching()
  watchRoom = room.trim()
  watchOwnerId = ownerId
  const generation = ++watchGeneration
  watchTimer = setInterval(() => {
    void pollForApprovedRoom(watchRoom, watchOwnerId, generation)
  }, 3000)
}

async function pollForApprovedRoom(
  room: string,
  ownerId: string,
  generation: number
): Promise<void> {
  if (generation !== watchGeneration || !room || !ownerId) return
  const user = currentUser()
  if (!user || user.id !== ownerId) {
    stopWatching()
    return
  }
  const st = licenseStatusFor(room)
  if (!st.licensed) return

  // 已进入异步授权检查，先停掉定时器以免同一批准结果重复绑定。
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
  const res = await bindCurrentUser(room, ownerId, () => generation === watchGeneration)
  if (generation !== watchGeneration) return
  stopWatching()
  if (!res.ok) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(Ipc.RoomAutoBound, {
        room,
        boundRooms: res.boundRooms ?? []
      })
    }
  }
}

function stopWatching(): void {
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
  watchRoom = ''
  watchOwnerId = ''
  watchGeneration++
}

// ===== 自由解绑（无需审批，解绑后上报服务器留痕） =====
// 本地直接解除绑定；解绑记录上报服务器 /api/license/unbind_log（后台可查，纯留痕，不影响本地解绑）。
export async function unbindRoomWithLog(
  room: string
): Promise<{ ok: boolean; boundRooms?: string[]; error?: string }> {
  const res = unbindRoom(room.trim())
  if (!res.ok) return res
  const u = currentUser()
  // 两路上报各 10 秒超时，服务器不通时串行等 20 秒才回按钮 —— 本地已经解绑，上报在后台跑就行
  void Promise.allSettled([
    reportUnbind(room.trim(), u ? u.email || u.username : ''),
    u?.email ? reportEmailUnbind(u.email, room.trim()) : Promise.resolve()
  ])
  return res
}
