import type { LotteryItem } from './types'

// 存储/页面是九格行序，抽奖窗口是外圈顺时针序；中心索引 4 永不参与抽奖。
export const NINE_ORDER: readonly number[] = [0, 1, 2, 5, 8, 7, 6, 3]
export const NINE_COLORS = ['#E0D8B0', '#D9C7B8', '#C9C0D3', '#B5C7C4', '#D8C3A5', '#B8C4BB', '#CBB8B1', '#AEBFC5']
export function nineItems(cells: string[], imgs: string[], actions: Partial<LotteryItem>[] = []): LotteryItem[] {
  return NINE_ORDER.map((cell, index) => ({ ...actions[cell], name: String(cells[cell] || ''), color: NINE_COLORS[index], img: imgs[cell] || undefined }))
}
