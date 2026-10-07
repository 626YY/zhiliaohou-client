import './app-setup'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { initCrashLog, logLine, registerCrashNotice } from './crash-log'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { initDb } from './db'
import { registerIpc } from './ipc'
import { pushConnectorLog, stopConnector } from './connector'
import { scheduleGiftImageSync } from './gift-image-sync'
import { flushGiftLog } from './gift-log'
import { flushViewers } from './viewer-directory'
import { detectAllGames, correctSavedGamePathsAtStartup, primeSteamLibraries } from './game-launcher'
import { autoRepairAtStartup } from './mod-health'
import { installServerCertPin } from './server-tls'
import { getSettings } from './settings'
import { timeLogOpen } from './time-widget'
import { initUpdater } from './updater'
import { startNotifyWatch } from './notifications'
import { startHeartbeatWatch } from './heartbeat'
import { startLiveReporter, stopLiveReporter } from './live-report'
import { Ipc } from '@shared/types'
import { registerConnectorRuntime } from './connector-runtime'
import { initObsService } from './obs-service'
import { closeAllOutputWindows, closeIdleOutputWindows, restoreCaptureOutputWindows } from './output-window'
import { setMainWindow, getMainWindow } from './main-window-ref'
import { cardModeEnabled, cardShutdown, startCardWatch, freeModeGameUse } from './card-auth'
import { initExitDiag, markQuitReason, noteSessionEnd } from './exit-diag'
import { licenseEnforced, logLicensePolicy, refreshLicensePolicyFromRemote } from './license-policy'
import { registerMemoryGuardHooks, startMemoryGuard } from './memory-guard'
import { greenQueueLength, resumeGreenQueue } from './green-screen'
import { SPECIAL_SCHEME_PRIVILEGES, registerSpecialProtocol } from './special-assets'
import { migrateLegacySpecialTriggers, specialPreviewHtml } from './special-gameplay'
import { initMediaOptimize, prewarmMedia } from './media-optimize'
import { listRules, splitVideoTarget } from './entertainment'

let mainWin: BrowserWindow | null = null
const APP_USER_MODEL_ID = 'com.zhiliao.client'

// 主窗口页面在开发期是 http://localhost，直接引用 file:// 的礼物图会被浏览器安全策略拦掉
// （表现为透明图工具里所有礼物图都是空白方块）。走自建协议读本地文件，开发和打包后行为一致。
const MEDIA_SCHEME = 'zlmedia'
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } },
  // 特色整蛊详情页的预览舞台（页面 + 素材 + 主播自选文件同源），见 special-assets.ts
  SPECIAL_SCHEME_PRIVILEGES
])

function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      // zlmedia://local/F:/路径/礼物.png —— host 固定 local，pathname 是真实路径
      const raw = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!raw) return new Response('not found', { status: 404 })
      // 只放行图片/音视频/字体：这个协议对渲染层等于「读任意本地文件」，挂件里渲染观众昵称/弹幕，一旦有注入点就能把配置/凭据文件读走
      if (!/\.(?:png|jpe?g|gif|webp|bmp|svg|ico|apng|avif|mp4|webm|mov|mkv|avi|m4v|mp3|wav|ogg|m4a|flac|aac|ttf|otf|woff2?)$/i.test(raw)) {
        return new Response('forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(raw).toString())
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}

function windowIconPath(): string {
  // 安装包的图标和运行中的窗口统一使用同一份 ICO；开发时直接读源码，
  // 打包后读 extraResources，避免 Windows 任务栏回退到 Electron 默认图标。
  return app.isPackaged
    ? join(process.resourcesPath, 'build', 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // 初始小窗（登录/引导用，参考 Steam 登录窗：躺着的长方形）；登录成功后由 renderer 调 window:resize 放大
    width: 840,
    height: 500,
    minWidth: 780,
    minHeight: 460,
    show: false,
    frame: false,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    title: '知了猴整蛊台',
    icon: windowIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const sendMaximized = () =>
    win.webContents.send(Ipc.WindowMaximized, win.isMaximized())
  // Electron 33 / Win10 在首次显示窗口时会清掉 ready 前设置的原生采集保护。
  // 必须覆盖实际显示、还原的生命周期，不能只验证隐藏窗口上的标记。
  // 每次重新读设置：「主窗口防采集保护」关掉时（远程桌面管理）这些钩子把保护维持在关。
  if (process.platform === 'win32') {
    const protect = () => { if (!win.isDestroyed()) win.setContentProtection(getSettings().mainContentProtection !== false) }
    protect()
    win.on('show', protect)
    win.on('restore', protect)
    win.on('maximize', protect)
    win.on('unmaximize', protect)
  }
  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)

  mainWin = win
  setMainWindow(win)
  // 出错提示发到主窗口里（不弹系统框、不抢直播中的前台）
  registerCrashNotice((title, body) => {
    const target = getMainWindow()
    if (!target || target.webContents.isDestroyed() || target.webContents.isCrashed()) return false
    target.webContents.send(Ipc.AppNotice, { level: 'error', text: `${title}：${body.split('\n\n')[0]}` })
    return true
  })
  // 主窗口关闭 = 整个程序退出的入口之一，必须留痕：前一行有 [window] 标题栏关闭 = 主播自己点的；没有 = Alt+F4 / 任务栏 / 别的程序关的
  win.on('close', () => logLine('window', '主窗口 close（接下来会收掉全部挂件并退出）'))
  win.on('session-end', noteSessionEnd)
  win.on('closed', () => {
    markQuitReason('主窗口已关闭（收工）')
    if (mainWin === win) { mainWin = null; setMainWindow(null) }
    // 关主窗口 = 收工：正在播的挂件也一起关，程序退出（原来只清待机窗口，绿幕全留在桌面上）
    closeAllOutputWindows()
  })

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  win.setAlwaysOnTop(getSettings().alwaysOnTop)
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 只把网页/Steam 链接交给系统；file:/ms-msdt: 这类协议不放行（渲染层里任何一处 HTML 注入都不该能拉起本地程序）
    if (/^(?:https?|steam|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function showMainWindow(): void {
  // 主窗口关闭后，绿幕等挂件可能仍让进程保留单实例锁。
  if (!mainWin || mainWin.isDestroyed()) {
    const win = createWindow()
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.focus()
    })
    return
  }
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
}

// 单实例：多开会共用 userData，抢不到 leveldb 锁的实例 localStorage 全程内存态
// （记住密码/配置退出即丢），且会出现双连接器抢占。二次启动改为聚焦已有窗口。
// 崩溃日志与中文错误提示要在其他任何逻辑之前挂上，启动期的异常才不会无声退出
initCrashLog()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 这里只退出尚未运行的第二实例，不触发主实例业务模块的 before-quit 保存。
  // 留一行：日志里紧跟 [start] 的这句 = 主播双击了第二次，不是程序重启
  logLine('start', '已有一个整蛊台在运行，本次只是把它唤到前台，这个实例立即退出')
  app.exit(0)
} else {
  app.on('second-instance', () => {
    void app.whenReady().then(showMainWindow)
  })
}

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)

// 启动期每一步都单独兜住：一步抛错只记日志，窗口照样开、别的模块照样起（以前 createWindow 之前任何一步同步抛错 = 双击没反应、进程后台常驻）
function safeInit(name: string, fn: () => void): void {
  try {
    fn()
  } catch (e) {
    logLine('startup', `${name} 初始化失败：${e instanceof Error ? e.stack || e.message : String(e)}`)
  }
}

app.whenReady().then(async () => {
  if (!gotLock) return
  // 退出诊断最先起：上次是不是异常退出、有没有新崩溃转储、退出码记录员、每分钟资源曲线
  safeInit('exit-diag', initExitDiag)
  // 授权总开关：启动记一行当前策略；再去更新源看有没有新策略（下次启动生效）
  safeInit('license-policy', logLicensePolicy)
  // 内存守卫：告急时清绿幕排队、连接器面板提示
  safeInit('memory-guard', () => { registerMemoryGuardHooks({ onCritical: greenQueueLength, onRecover: resumeGreenQueue, notify: (level, text) => pushConnectorLog(level, text) }); startMemoryGuard() })
  safeInit('license-policy-remote', () => { void refreshLicensePolicyFromRemote() })
  // 素材瘦身：启动 15 秒后把礼物规则里配的视频先排队压制（一次一条、低优先级），主播开播前就换成小副本
  safeInit('media-optimize', () => {
    initMediaOptimize()
    setTimeout(() => {
      try {
        const files: string[] = []
        for (const rule of listRules()) {
          const actions = [rule as { actionType?: string; commandCmd?: string; commandParam?: unknown }, ...(((rule as { extraActions?: unknown[] }).extraActions || []) as { actionType?: string; commandCmd?: string; commandParam?: unknown }[])]
          for (const a of actions) if (a && a.actionType === 'command' && a.commandCmd === 'video-play' && typeof a.commandParam === 'string') files.push(splitVideoTarget(a.commandParam).rest)
        }
        prewarmMedia(files)
      } catch (e) { logLine('media', `预热失败：${String(e)}`) }
    }, 15_000)
  })
  safeInit('server-tls', installServerCertPin)
  safeInit('media-protocol', registerMediaProtocol)
  safeInit('special-protocol', () => registerSpecialProtocol(specialPreviewHtml))
  safeInit('db', initDb)
  safeInit('ipc', registerIpc)
  // 0.3.63 测试版玩法自带的礼物触发搬进礼物规则（只搬一次）
  safeInit('special-migrate', () => { void migrateLegacySpecialTriggers().catch(error => logLine('startup', `特色整蛊触发迁移失败：${String(error)}`)) })
  // 卡密平台模式：有输出在跑时每 2 秒向平台复核授权（没有 license-provider.json 时什么都不做）
  safeInit('card-license', startCardWatch)
  safeInit('connector-runtime', registerConnectorRuntime)
  safeInit('obs', initObsService)
  safeInit('updater', initUpdater)
  // 主界面出现前先提供上次的固定采集标题；无需登录，也不会自动播放素材。
  await restoreCaptureOutputWindows().catch(error => logLine('startup', `capture-restore 初始化失败：${String(error)}`))
  // 「抽时间记录」窗口：上次开着就开机自动恢复（内容是主进程内存里的送礼记录，自己推给窗口）
  if (!cardModeEnabled() && getSettings().timeLogWindow === true) safeInit('time-log', () => { timeLogOpen() })
  if (!mainWin || mainWin.isDestroyed()) safeInit('window', () => { createWindow() })
  // 通知轮询：未登录时静默；登录后 60s 拉一次，新通知弹 toast
  safeInit('notify-watch', startNotifyWatch)
  // 在线心跳：登录邮箱后每 30s 上报一次（后台在线面板用），未登录静默
  safeInit('heartbeat', startHeartbeatWatch)
  safeInit('live-reporter', startLiveReporter)
  // 抖音礼物图自动缓存：启动 15 秒后跑一次、之后每小时检查（6 小时节流），新上的礼物不用等观众送过
  safeInit('gift-image-sync', () => scheduleGiftImageSync(pushConnectorLog))

  // 游戏路径校验 + 扫全部游戏路径放到窗口出来之后：注册表/全盘扫 Steam 库是同步 IO，放在 createWindow 前会让窗口晚出来甚至白屏
  setTimeout(() => {
    void primeSteamLibraries().finally(() => {
      try {
        for (const f of correctSavedGamePathsAtStartup()) logLine('gamepath', `启动校验纠正 ${f.gameId}: ${f.from} -> ${f.to}`)
      } catch {
        /* 校验失败不拦启动 */
      }
      try {
        const r = detectAllGames()
        console.log('[auto-detect] 已定位:', Object.keys(r.found || {}).join(', ') || '无')
      } catch (e) {
        console.warn('[auto-detect] 自动搜索失败:', e)
      }
      // 整蛊器健康自检：文件不全 / 装错位置 → 游戏没在跑就自动重装到正确位置（结果记 main.log [modhealth]）
      // 卡密模式下重装也是「安装」，要先登录并持有对应游戏卡，启动期没人登录，所以不自动跑（主播点「修复」会过门禁）
      if (cardModeEnabled()) logLine('card', '卡密模式：启动期不自动重装整蛊器，请登录后在游戏库点「修复」')
      else setTimeout(() => { void autoRepairAtStartup() }, 2500)
      // 免检模式：不等主播用功能，启动就把轮椅整蛊器换成认免检标记的组件并写好标记（游戏一般还没开，换得上）
      if (!licenseEnforced()) setTimeout(() => { void freeModeGameUse('4wheel-challenge', true) }, 3000)
    })
  }, 1500)

  app.on('activate', () => {
    showMainWindow()
  })
})

// app.quit()（更新安装、以管理员重启）不会走 window-all-closed：连接器子进程会成孤儿，
// 还握着单实例互斥量，之后再启动都被它顶掉；这里统一收尾
app.on('before-quit', () => {
  cardShutdown()
  stopLiveReporter()
  stopConnector()
  flushGiftLog()
  flushViewers()
})

app.on('window-all-closed', () => {
  markQuitReason('所有窗口都已关闭')
  logLine('quit', 'window-all-closed')
  stopConnector()
  // 礼物记录写盘是攒着的，关窗前把最后那点落盘
  flushGiftLog()
  flushViewers()
  if (process.platform !== 'darwin') app.quit()
})
