// 观众记录上报：连接器事件（礼物 / 关注 / 点赞 / 进场 / 弹幕）按当前登录邮箱记到本机队列，每 15 秒向服务器补传一批，
// 服务器按事件 id 去重、回 accepted 才从队列里删（live-report-queue.ts）。
// 卡密模式：账号来自卡密账号层，上传由卡密平台代调原邮箱服务（email-api.sendLiveEvents 分路）；
//   旧会话失效 / 平台未接入 / 断网都只记连接器日志，记录原样留在队列里等重登或恢复后再传；登录 / 退出立刻补传一次。
//   队列按「邮箱 + 服务器地址」隔离，换号后只传当前账号的记录。
import { app } from 'electron'
import { currentAccount } from './account-session'
import { onCardAccountChange } from './card-account-events'
import { readJson, writeJson } from './db'
import { getSettings } from './settings'
import { currentGameId } from './games'
import { readLiveSession } from './live-session'
import { subscribeConnectorEvent } from './connector-events'
import { findGiftImage } from './entertainment'
import { pushConnectorLog } from './connector'
import { sendLiveEvents } from './email-api'
import { LiveReportQueue, type PendingLiveEvent } from './live-report-queue'

let queue: LiveReportQueue | null = null
let timer: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null
let unsubscribeAccount: (() => void) | null = null
let lastError = ''
let lastErrorAt = 0
const serverUrl = (): string => getSettings().serverUrl.replace(/\/+$/, '')

function reportError(error: unknown): void {
  const message = error instanceof Error && 'code' in error
    ? '观众记录写入失败，请检查磁盘空间和目录权限'
    : error instanceof Error ? error.message : '观众记录上传失败，记录已保留待重试'
  if (message !== lastError || Date.now() - lastErrorAt >= 120_000) {
    pushConnectorLog('error', `观众记录：${message}`)
    lastError = message
    lastErrorAt = Date.now()
  }
}

async function flush(): Promise<void> {
  const user = currentAccount()
  if (!user?.email || !queue) return
  try {
    const n = await queue.flush(user.email.trim().toLowerCase(), serverUrl())
    if (n && lastError) {
      pushConnectorLog('info', '观众记录上传已恢复')
      lastError = ''
    }
  } catch (error) { reportError(error) }
}

export function startLiveReporter(): void {
  if (timer) return
  queue = new LiveReportQueue(readJson<PendingLiveEvent[]>('live-report-pending', []),
    rows => writeJson('live-report-pending', rows),
    (context, events) => sendLiveEvents(context.email, context.room, context.game, app.getVersion(), events))
  unsubscribe = subscribeConnectorEvent(event => {
    const live = readLiveSession()
    const user = currentAccount()
    if (!live?.running || !user?.email) return
    try {
      queue!.add({ email: user.email.trim().toLowerCase(), server: serverUrl(), room: live.room, game: currentGameId() },
        event, event.diamondCount ?? findGiftImage(event.giftName || '')?.diamondCount ?? 0, live.room === 'sim')
    } catch (error) { reportError(error) }
  })
  timer = setInterval(() => void flush(), 15_000)
  unsubscribeAccount = onCardAccountChange(() => { void flush() })
  void flush()
}

export function stopLiveReporter(): void {
  if (timer) clearInterval(timer)
  timer = null
  unsubscribe?.()
  unsubscribe = null
  unsubscribeAccount?.()
  unsubscribeAccount = null
  // 每条事件已原子落盘；退出不等待网络，下次同账号登录后继续补传。
}
