// 通知轮询：已登录邮箱账号时，每 60s 拉一次 /api/email/notify，
// 新出现的未读通知推给渲染层弹 toast。首次 baseline 只记录不弹，
// 避免一登录就把历史未读全部弹一遍（历史见通知中心页）。
// 卡密模式：账号来自卡密账号层，通知由卡密平台代调原邮箱服务（email-api → card-compat）；
//   登录 / 退出立刻跑一次；后台的解绑 / 换绑通知只弹提示，绝不反向改平台上的直播间绑定（名额只信新平台）。
import { BrowserWindow } from 'electron'
import { syncEmailRooms } from './auth'
import { currentAccount } from './account-session'
import { cardModeEnabled } from './card-provider'
import { onCardAccountChange } from './card-account-events'
import { getNotifications } from './email-api'
import { Ipc, type AppNotification } from '@shared/types'

const POLL_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null
let baselined = false
let baselineEmail = ''
let activeGeneration: number | null = null
let watchGeneration = 0
let subscribed = false
const seen = new Set<string>()

export function startNotifyWatch(): void {
  stopNotifyWatch()
  baselined = false
  const generation = watchGeneration
  timer = setInterval(() => void poll(watchGeneration), POLL_MS)
  if (!subscribed) {
    subscribed = true
    // 卡密账号登录 / 退出：不等下一个周期，立刻按当前账号跑一次（退出时只是清掉基线）
    onCardAccountChange(() => {
      watchGeneration++
      seen.clear()
      baselined = false
      baselineEmail = ''
      if (timer) void poll(watchGeneration)
    })
  }
  void poll(generation)
}

export function stopNotifyWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  seen.clear()
  baselined = false
  baselineEmail = ''
  watchGeneration++
}

async function poll(generation: number): Promise<void> {
  if (generation !== watchGeneration || activeGeneration !== null) return
  const u = currentAccount()
  const email = u?.email?.trim().toLowerCase() ?? ''
  if (!email) {
    seen.clear()
    baselined = false
    baselineEmail = ''
    return
  }
  if (email !== baselineEmail) {
    seen.clear()
    baselined = false
    baselineEmail = email
  }
  activeGeneration = generation
  try {
    const res = await getNotifications(email)
    // 请求期间切换账号时，旧账号的结果不能影响新会话。
    if (
      generation !== watchGeneration ||
      currentAccount()?.id !== u?.id ||
      currentAccount()?.email?.trim().toLowerCase() !== email
    ) {
      return
    }
    if (!res.ok || !res.list) return
    if (!baselined) {
      for (const n of res.list) seen.add(n.id)
      baselined = true
      // 基线即同步一次绑定：后台有本地没有 → 恢复；后台解绑/换绑过 → 本地跟随（卡密模式不做：绑定只信平台）
      if (!cardModeEnabled()) void syncFromNotifications(res.list, generation)
      return
    }
    let needSync = false
    for (const n of res.list) {
      if (n.read || seen.has(n.id)) continue
      seen.add(n.id)
      if (n.type === 'unbind' || n.type === 'replace') needSync = true
      emit(n)
    }
    // 后台解绑/换绑通知到了 → 立即对齐本地绑定（不等用户开设置页）；卡密模式下旧后台的绑定记录不改平台名额
    if (needSync && !cardModeEnabled()) void syncFromNotifications(res.list, generation)
  } finally {
    if (activeGeneration === generation) activeGeneration = null
    // 新会话的首次请求若被旧请求占用，在旧请求结束后立即补发。
    if (generation !== watchGeneration && timer) void poll(watchGeneration)
  }
}

function emit(n: AppNotification): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Ipc.NotifyNew, n)
  }
}

// 用通知流水对齐一次邮箱绑定；有实际变动（恢复/移除）就广播给渲染层刷新房间列表
async function syncFromNotifications(
  list: AppNotification[],
  generation: number
): Promise<void> {
  const res = await syncEmailRooms(list)
  if (generation !== watchGeneration || !res.ok) return
  const changed = (res.restored?.length ?? 0) + (res.removed?.length ?? 0) > 0
  if (!changed) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(Ipc.RoomsSynced, {
        boundRooms: res.boundRooms ?? [],
        restored: res.restored ?? [],
        removed: res.removed ?? []
      })
    }
  }
}
