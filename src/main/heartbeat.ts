// 在线心跳：已登录邮箱时每 30s 上报一次当前房间 + 连接器/游戏状态，
// 后台在线面板据此展示「谁在开播、连接器/游戏是否正常」。失败静默。
// 卡密模式：账号来自卡密账号层，心跳由卡密平台代调原邮箱服务（邮箱按登录账号、房间只报平台承认的绑定）；
//   登录 / 退出立刻跑一次。
import { currentAccount } from './account-session'
import { onCardAccountChange } from './card-account-events'
import { queryGameState } from './game-launcher'
import { connectorState } from './connector'
import { readConfig } from './config-editor'
import { sendHeartbeat } from './email-api'

const HEARTBEAT_MS = 30_000
let timer: ReturnType<typeof setInterval> | null = null
let activeGeneration: number | null = null
let watchGeneration = 0
let subscribed = false

export function startHeartbeatWatch(): void {
  stopHeartbeatWatch()
  const generation = watchGeneration
  timer = setInterval(() => void tick(watchGeneration), HEARTBEAT_MS)
  if (!subscribed) {
    subscribed = true
    onCardAccountChange(() => {
      watchGeneration++
      if (timer) void tick(watchGeneration)
    })
  }
  void tick(generation)
}

export function stopHeartbeatWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  watchGeneration++
}

async function tick(generation: number): Promise<void> {
  if (generation !== watchGeneration || activeGeneration !== null) return
  const u = currentAccount()
  if (!u?.email) return
  activeGeneration = generation
  try {
    const cs = connectorState()
    let room = cs.roomId ?? ''
    if (!room) {
      const cfg = readConfig()
      if (cfg.ok) room = String(cfg.values.LiveRoomId ?? '')
    }
    const st = await queryGameState()
    if (generation !== watchGeneration || currentAccount()?.id !== u.id) return
    await sendHeartbeat(u.email, room, cs.running, st.running)
  } catch {
    // 心跳失败不影响主流程
  } finally {
    if (activeGeneration === generation) activeGeneration = null
    // 新会话的首次 tick 曾被旧请求占用时，旧请求结束后立即补发。
    if (generation !== watchGeneration && timer) void tick(watchGeneration)
  }
}
