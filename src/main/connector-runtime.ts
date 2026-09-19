import {cardModeEnabled} from './card-provider'
import {cardEpoch} from './card-epoch'
import { subscribeConnectorEvent } from './connector-events'
import { handleAdvancedWheelGift } from './advanced-wheel'
import { handleChallengeGift, setChallengeGiftImage } from './challenge-widget'
import { handleConnectorGift } from './entertainment'
import { handleTimeWidgetGift, setTimeWidgetAvatar, setTimeWidgetGiftImage } from './time-widget'
import { handleMarqueeEvent } from './marquee-widget'
import { handleLotteryGift } from './lottery-widget'
import { handleEffectsGift } from './effects-widget'
import { handleEntranceEvent } from './entrance-widget'
import { handleStickerGift } from './sticker-stats'
import { handleGiftLog } from './gift-log'
import { handleProgressGift } from './progress-widget'
import { handleWishGift } from './wish-widget'
import { noteViewerEvent, viewerAvatar } from './viewer-directory'
import type { ConnectorEvent } from '@shared/types'

let registered = false

// 每个挂件单独兜异常：上游只对整个 run 包了一层 try/catch，
// 谁先抛错后面排队的挂件就全被静默跳过（倒计时排在最后，最容易被连累）。
function safely(label: string, action: () => void): void {
  try {
    action()
  } catch (error) {
    console.error(`[connector-runtime] ${label} 处理事件失败：`, error)
  }
}

// 连接器把观众头像下到本地后单独打一行「头像: 昵称 -> 路径」（礼物行本身不带头像）：
// 记住它，之后同一昵称的礼物 / 进场事件都配上；已经上了滚动条 / 记录的也回填（第一份礼物时头像多半还没下完）
const avatars = new Map<string, string>()
const AVATAR_LIMIT = 3000
const avatarKey = (name: string): string => String(name || '').replace(/\s+/g, ' ').trim()

function run(event: ConnectorEvent): void {
  if (event.type === 'avatar') {
    const who = avatarKey(event.sender || '')
    const src = String(event.avatar || '').trim()
    if (who && src) {
      if (avatars.size >= AVATAR_LIMIT) avatars.delete(avatars.keys().next().value as string)
      avatars.set(who, src)
      safely('time-widget-avatar', () => setTimeWidgetAvatar(who, src))
      safely('viewer-avatar', () => noteViewerEvent(event))
    }
    return
  }
  if (!event.avatar && event.sender) {
    const known = avatars.get(avatarKey(event.sender))
    if (known) event.avatar = known
    // 客户端重开后内存表是空的，但连接器早就把头像下到 <Mod 目录>/avatars/ 了：按昵称去磁盘找一次
    else safely('viewer-avatar-probe', () => { const cached = viewerAvatar(event.sender!, event.uid); if (cached) event.avatar = cached })
  }
  // 「已出现的观众」名单（大哥进场下拉）：带昵称的事件都记一笔
  safely('viewers', () => noteViewerEvent(event))
  if (event.type === 'gift-image' && event.giftName && event.giftImage) {
    safely('time-widget-image', () => setTimeWidgetGiftImage(event.giftName!, event.giftImage!))
    safely('challenge-image', () => setChallengeGiftImage(event.giftName!, event.giftImage!))
    return
  }
  // 飘屏要吃弹幕（原版「文字开启」按关键词飘），礼物规则也能由关注/点赞/进场/弹幕触发，
  // 所以非礼物事件必须往下走——老实现在这里直接 return，弹幕飘屏和关注触发全是死代码。
  safely('marquee', () => handleMarqueeEvent(event))
  safely('gift-rules', () => handleConnectorGift(event))
  safely('entrance', () => handleEntranceEvent(event))
  if (event.type !== 'gift' || !event.giftName) return
  // 礼物个数不设上限（用户铁律），挂件自己按需要节流，绝不在入口把数量吞掉。
  const count = Math.max(1, Math.trunc(Number(event.count) || 1))
  const image = event.giftImage || ''
  const name = event.giftName
  // 所有常驻挂件在同一个主进程入口执行，页面切换不改变行为。
  safely('advanced-wheel', () => handleAdvancedWheelGift(name))
  safely('time-widget', () => handleTimeWidgetGift(name, count, image, event.sender || '', 'live', event.avatar || ''))
  safely('challenge', () => handleChallengeGift(name, count, image))
  safely('lottery', () => handleLotteryGift(event))
  safely('effects', () => handleEffectsGift(event))
  safely('progress', () => handleProgressGift(event))
  safely('wish', () => handleWishGift(event))
  safely('sticker', () => handleStickerGift(event))
  safely('gift-log', () => handleGiftLog(event))
}

export function registerConnectorRuntime(): void {
  if (registered) return
  registered = true
  let pending:Promise<void>=Promise.resolve()
  subscribeConnectorEvent(event=>{
    if(!cardModeEnabled()){run(event);return}
    const epoch=cardEpoch()
    pending=pending.then(async()=>{
      if(epoch!==cardEpoch())return
      const {cardRequireRecent}=await import('./card-auth')
      await cardRequireRecent('platform:assistant')
      if(epoch===cardEpoch())run(event)
    }).catch(()=>{/* 失效由授权层关闭输出；旧账号事件不回放。 */})
  })
}
