// 挂件窗口的持久化坐标：拔掉副屏 / 换分辨率后存档坐标可能落在屏幕外，Electron 对显式 x/y 不做夹紧，窗口开在看不见的地方。
// 只要窗口与任一显示器工作区还有一块重叠就照用；否则返回空对象让 BrowserWindow 走默认位置。
import { screen } from 'electron'

export function onScreenPosition(x: unknown, y: unknown, w: number, h: number): { x: number; y: number } | Record<string, never> {
  const px = Number(x)
  const py = Number(y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return {}
  try {
    for (const d of screen.getAllDisplays()) {
      const a = d.workArea
      const ix = Math.min(px + Math.max(w, 1), a.x + a.width) - Math.max(px, a.x)
      const iy = Math.min(py + Math.max(h, 1), a.y + a.height) - Math.max(py, a.y)
      if (ix >= 40 && iy >= 30) return { x: Math.round(px), y: Math.round(py) }
    }
  } catch {
    return { x: Math.round(px), y: Math.round(py) }
  }
  return {}
}
