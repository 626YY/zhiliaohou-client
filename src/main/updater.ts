import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { Ipc, type UpdateCheckResult, type UpdateStatusPayload } from '@shared/types'
import { markQuitReason } from './exit-diag'

// 更新源地址：2026-09-06 起默认指向阿里云 OSS 北京（国内下载快十倍；发版脚本 tools/publish-update-oss.py 同步到这里），
//   作者服务器的 /updates/ 也会 302 到 OSS，老版本照样能更新。可用环境变量覆盖。
const FEED_URL =
  (process.env.WL_UPDATER_FEED as string) ||
  'https://zhiliaohou.oss-cn-beijing.aliyuncs.com/updates/'

let configured = false
// 启动时的后台自动检查不打扰主播：失败/已是最新都不弹提示；手动检查才提示
let silentCheck = false

function send(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Ipc.UpdateStatus, payload)
  }
}

// 更新服务器的英文报错（含堆栈）不能直接给主播看，收成一行友好文案
function friendlyError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (msg.includes('404')) return '更新服务器暂未发布更新包'
  const first = msg.split('\n')[0].trim()
  return first.length > 80 ? first.slice(0, 80) + '…' : first
}

export function initUpdater(): void {
  if (!app.isPackaged) return
  // useMultipleRangeRequest:false 必须在这里给（setFeedURL 会整个盖掉 app-update.yml 里的配置）：
  // OSS 不支持 electron-updater 默认的多段 Range（multipart/byteranges，本机 main.log 实录 416 / Content-Type 不对），
  // 但单段 Range 是支持的 —— 关掉多段后差分下载每块单独一个 Range 请求，能在 OSS 上跑通。
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL, useMultipleRangeRequest: false })
  configured = true
  // 不自动下载：检查到新版本先弹窗问主播，确认后再下载（避免占带宽/流量）
  autoUpdater.autoDownload = false
  // 差分下载（2026-09-14 起打开）：安装包 240MB 里绝大部分是 Electron / 运行库，版本间不变，
  // 差分只下变化的块，省主播流量也省 OSS 流出费用。差分失败 electron-updater 自动退回整包，且装前照样验 sha512。
  autoUpdater.disableDifferentialDownload = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    send({ state: 'available', detail: info?.version })
  )
  autoUpdater.on('update-not-available', () => {
    if (!silentCheck) send({ state: 'not-available' })
  })
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', progress: Math.round(p?.percent ?? 0) })
  )
  autoUpdater.on('update-downloaded', () => send({ state: 'downloaded' }))
  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err?.message ?? err)
    if (!silentCheck) send({ state: 'error', detail: friendlyError(err) })
  })
}

export async function checkForUpdates(silent = false): Promise<UpdateCheckResult> {
  if (!configured) return { ok: false, error: '暂未配置更新源，无法检查更新' }
  silentCheck = silent
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '检查更新失败：' + friendlyError(e) }
  }
}

// 主播在弹窗里点了「立即更新」才开始下载，下载进度走 UpdateStatus 推进度条
export async function downloadUpdate(): Promise<UpdateCheckResult> {
  if (!configured) return { ok: false, error: '暂未配置更新源' }
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '下载更新失败：' + friendlyError(e) }
  }
}

export function installUpdate(): void {
  if (!configured) return
  try {
    markQuitReason('安装更新')
    autoUpdater.quitAndInstall()
  } catch (e) {
    // 没下载完就点安装等情况：以前直接 reject 到渲染层还没人接；改成走状态推送让弹窗显示原因
    send({ state: 'error', detail: '安装更新失败：' + friendlyError(e) })
  }
}
