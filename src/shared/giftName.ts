// 礼物名是用户配置和平台事件之间的协议键：统一全角字符、空白和大小写。
// 主进程（连接器事件匹配）和渲染进程（页面预览过滤）共用同一份判断，避免两边对不上。
export function normalizeGiftName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('zh-CN')
}

export function giftNamesEqual(a: unknown, b: unknown): boolean {
  const left = normalizeGiftName(a)
  const right = normalizeGiftName(b)
  return !!left && left === right
}
