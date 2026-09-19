// 主窗口引用：index.ts 建窗时登记，IPC/设置改动时取用。
// 单独一个模块是为了避免 ipc.ts 反向 import index.ts 成环。
import type { BrowserWindow } from 'electron'
import { getSettings } from './settings'

let ref: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  ref = win
}

export function getMainWindow(): BrowserWindow | null {
  return ref && !ref.isDestroyed() ? ref : null
}

/** 设置页改「主窗口防采集保护」立刻套到主窗口，不用重启（远程桌面管理时关掉才能看见主窗口）。 */
export function applyMainContentProtection(): void {
  const win = getMainWindow()
  if (process.platform !== 'win32' || !win) return
  win.setContentProtection(getSettings().mainContentProtection !== false)
}
