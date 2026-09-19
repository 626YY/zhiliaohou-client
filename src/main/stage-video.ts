// 「奖品视频在转盘窗口里播」的接管点。
//
// 抽中之后要播的视频可能来自好几条路：奖项直接选的视频、动作命令、导入项目里的
// 「触发项目（文件夹）」随机挑一个……它们最后都会走 green-screen 开一个绿幕窗口。
// 主播的痛点是这样直播伴侣得再加一个来源，而且那个窗口会挡在转盘前面。
//
// 用 AsyncLocalStorage 而不是全局开关：只有抽奖动作那条调用链里的绿幕请求会被接管，
// 同一时刻观众送礼物触发的普通视频规则照旧开自己的窗口，不会被顺手吸进转盘里。
import { AsyncLocalStorage } from 'node:async_hooks'
import { optimizedMedia } from './media-optimize'

/** 返回 true = 这个视频已经被转盘窗口接管，绿幕窗口不用开了 */
export type StageVideoTake = (src: string, type: 'video' | 'image', seconds: number, chroma?: boolean) => boolean

type StageScope = { take: StageVideoTake; wait?: () => Promise<void> | undefined; active: boolean }
const context = new AsyncLocalStorage<StageScope>()

/** 在这段执行里，绿幕视频交给转盘窗口播 */
export function runWithStageVideo<T>(take: StageVideoTake, fn: () => Promise<T>, wait?: StageScope['wait']): Promise<T> {
  const scope: StageScope = { take, wait, active: true }
  return context.run(scope, async () => {
    try { return await fn() } finally { scope.active = false }
  })
}

export function stageVideoCompletion(): Promise<void> | undefined {
  const scope = context.getStore()
  return scope?.active ? scope.wait?.() : undefined
}

/** green-screen 在开窗口前问一句：这个视频是不是该在转盘窗口里播 */
export function takeStageVideo(src: string, type: 'video' | 'image', seconds: number, chroma?: boolean): boolean {
  const scope = context.getStore()
  if (!scope?.active) return false
  try { return scope.take(type === 'video' ? optimizedMedia(src) : src, type, seconds, chroma) } catch { return false }
}
