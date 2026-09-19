import { app, type BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { displayTitle, onOutputWindowEvent } from './output-window'

export function captureTitle(win: BrowserWindow, title: string): void {
  // 传进来的是短名（内部索引）；挂到窗口上的按设置的名称风格来。
  win.setTitle(displayTitle(title))
  // 标题同时被旧挂件用作消息通道；阻止消息覆盖原生标题，保留窗口捕获的匹配名。
  onOutputWindowEvent(win, 'page-title-updated', (event) => event.preventDefault())
}

export function mediaUrl(source: string): string {
  return /^(?:https?:|file:|data:)/i.test(source) ? source : pathToFileURL(source).href
}

export function validMedia(source: string): boolean {
  return !!source.trim() && (/^(?:https?:|file:|data:)/i.test(source) || existsSync(source))
}

export const escapeAttr = (value: string) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

/** 内置素材（转盘实录音效、盘面底图）在开发和打包后位置不同，挨个找；找不到返回空串，调用方退回合成音。 */
export function assetUrl(file: string): string {
  const candidates = [
    join(app.getAppPath(), 'out', 'renderer', 'entertainment-assets', file),
    join(app.getAppPath(), 'src', 'renderer', 'public', 'entertainment-assets', file),
    join(process.resourcesPath, 'entertainment-assets', file)
  ]
  const found = candidates.find(candidate => existsSync(candidate))
  return found ? mediaUrl(found) : ''
}
