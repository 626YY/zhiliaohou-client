// 整蛊台 AI 语音播报的播放端（主窗口常驻）：主进程念好一句发过来，这里排队一句一句放，不叠在一起。
// 放法和特色整蛊开奖试听同一套（可选先敲锣，人声统一响度），见 specialRevealAudio.ts。
import type { SpecialVoicePreview } from '@shared/specialGames'
import { playRevealPreview } from './specialRevealAudio'

const MAX_WAITING = 12
const queue: SpecialVoicePreview[] = []
let busy = false

export function enqueueAnnounce(item: SpecialVoicePreview): void {
  if (!item?.voiceUrl) return
  // 主进程那边已经按设置的上限挡过一次；这里再兜一层，播放端万一卡住也不会越攒越多
  if (queue.length >= MAX_WAITING) queue.shift()
  queue.push(item)
  void pump()
}

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  try {
    while (queue.length) {
      const item = queue.shift()!
      let seconds = 0
      try {
        seconds = await playRevealPreview(item)
      } catch {
        seconds = 0
      }
      // 念完再留一点空，下一句别贴着上一句
      await new Promise((r) => setTimeout(r, Math.max(0, seconds) * 1000 + 180))
    }
  } finally {
    busy = false
  }
}
