// 视频类参数的「指定播放窗口」后缀：<参数>|绿幕N（最优先窗口，忙了可去别的开着的窗口）、
// <参数>|绿幕N固定 / <参数>|固定（只在这个窗口排队）、<参数>|视频（老的视频窗口）；不写 = 默认窗口。
// 主进程 entertainment.splitVideoTarget、shared/entertainmentLabels 认同一套格式，两边别各写各的。
export type VideoTarget = '0' | '1' | '2' | '3' | '4' | 'v'

export function splitTargetSuffix(value: string): { rest: string; target: VideoTarget; overflow: boolean } {
  const m = /^(.*?)\s*\|\s*(?:绿幕\s*([1-4])(固定)?|(固定)|视频)$/.exec(String(value || '').trim())
  if (!m) return { rest: String(value || '').trim(), target: '0', overflow: true }
  if (m[4]) return { rest: m[1].trim(), target: '0', overflow: false }
  return { rest: m[1].trim(), target: m[2] ? (m[2] as VideoTarget) : 'v', overflow: !m[3] }
}

export function joinTargetSuffix(rest: string, target: VideoTarget, overflow = true): string {
  const base = String(rest || '').trim()
  if (target === 'v') return `${base}|视频`
  if (target === '1' || target === '2' || target === '3' || target === '4') return `${base}|绿幕${target}${overflow ? '' : '固定'}`
  return overflow ? base : `${base}|固定`
}
