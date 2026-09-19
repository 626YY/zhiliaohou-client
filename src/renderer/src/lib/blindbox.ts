// 盲盒通用：礼物名与 Id 生成，与 mod 内 PRESET_GIFTS / CustomBox.Id 保持一致
export const PRESET_GIFTS = [
  '小心心',
  '玫瑰',
  '抖音',
  '加油鸭',
  '西瓜',
  '扭蛋机',
  '红包',
  '大啤酒',
  '棒棒糖',
  '热气球',
  '保时捷',
  '直升机',
  '嘉年华',
  '独角兽'
]

export function genBoxId(): string {
  const hex = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 6; i++) s += hex[Math.floor(Math.random() * 16)]
  return s
}
