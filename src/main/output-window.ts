// 输出窗口（绿幕 / 视频 / 转盘 / 九宫格 / 各互动挂件）的统一行为：
//   1) 层级：跟设置「输出窗口总在最前」走，默认关；采集端仍需选择正确的窗口及采集方式。
//      开着时用 screen-saver 级压在全屏游戏上面（老行为）。改设置立刻套到所有已开的输出窗口，不用重开。
//   2) 拖动：页面加载完注入一段通用拖动脚本——按住窗口任意空白处即可拖（按钮 / 输入框 / 链接 / 自带系统拖动条的区域除外），
//      不再每个挂件各写一套、漏一套。进场 / 保护计时在绿幕模式可拖动，原生透明模式保留点击穿透。
//      待机的黑色采集窗口也注入，主播能把它摆到顺手的位置。
//   3) 开哪个才有哪个窗口（用户 2026-09-10 定版）：挂件关掉 = 窗口真关掉；不再把待机窗口停到屏幕外
//      （停到屏幕外的窗口直播伴侣不再刷新，播完的最后一帧会一直挂在画面上）。
//      想留着伴侣里的来源就开设置里的「关掉挂件后留着采集来源」，留下的窗口原地显示纯绿底。
//   4) 标题：直播伴侣的来源名是「知了猴整蛊台.exe + 窗口标题」，exe 名已经把一行占满，
//      标题再带「知了猴」就只剩省略号，所以默认用短名，可在设置里切回老名字。
import { app, BrowserWindow, Menu, screen, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import type { EventEmitter } from 'node:events'
import { getSettings, saveSettings } from './settings'

// 右键菜单「关闭」走各挂件自己的关闭路径（业务状态同步、页面上的开关跟着变）；没登记的窗口退回 win.close()
const closeHandlers = new WeakMap<BrowserWindow, () => void>()
export function setOutputCloseHandler(win: BrowserWindow, handler: () => void): void { closeHandlers.set(win, handler) }
import { CHROMA_SCRIPT } from './chroma-key'
import { readJson, writeJson } from './db'
import { onScreenPosition } from './window-bounds'
import { logLine } from './crash-log'
import { markQuitReason } from './exit-diag'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Output = {
  win: BrowserWindow
  title: string
  active: boolean
  generation: number
  top?: boolean
  background: boolean
  nativeTransparent: boolean
  // 主播开过这个窗口（不是启动时恢复出来的待机窗）：只有开过的才值得下次启动恢复
  used: boolean
  // 点击穿透的窗口不注入拖动脚本（鼠标根本落不到它上面）；其余窗口每次加载都注入。
  clickThrough?: boolean
  // 收边的基准尺寸 = 主播自己调的窗口大小。每次都从基准算，避免竖屏、横屏轮着播把窗口越收越小。
  mediaBase?: { width: number; height: number }
  cleanup: Set<() => void>
  closed: Set<() => void>
}
const outputs = new Map<BrowserWindow, Output>()
const byTitle = new Map<string, Output>()
let quitting = false
let restoring = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

type SavedCapture = {
  title: string
  x: number
  y: number
  width: number
  height: number
  background: boolean
  resizable: boolean
  focusable: boolean
  hasShadow: boolean
  minWidth: number
  minHeight: number
  baseWidth?: number
  baseHeight?: number
  // 主播开过这个窗口才恢复；老存档没有这个字段 = 没开过，升级后不会凭空冒出一排窗口
  used?: boolean
}
// 只恢复产品自己的固定标题和窗口几何；不保存网页、脚本或播放内容。
// 每行：短名（内部索引 + 存档名 + 默认窗口标题）、0.3.40 及以前的老标题、生成的页面文件、默认宽高。
const CAPTURE_WINDOWS = [
  ['倒计时', '知了猴倒计时', 'time-widget.html', 252, 148], ['积分条', '知了猴积分条', 'progress-widget.html', 500, 320],
  ['抽时间记录', '知了猴抽时间记录', 'time-log-widget.html', 360, 420],
  ['心愿单', '知了猴心愿', 'wish-widget.html', 640, 320], ['礼物动画', '知了猴礼物动画', 'effects-widget.html', 640, 360],
  ['进场', '知了猴进场', 'entrance-widget.html', 640, 140], ['飘屏', '知了猴飘屏', 'marquee-widget.html', 640, 160],
  ['排队', '知了猴排队', 'queue-widget.html', 360, 400], ['键盘', '知了猴键盘显示', 'keyboard-widget.html', 640, 240],
  ['保护计时', '知了猴保护计时', 'protect-widget.html', 280, 100], ['计数挑战', '知了猴计数挑战', 'challenge-widget-challenge.html', 340, 320],
  ['加班器', '知了猴加班器', 'challenge-widget-overtime.html', 340, 320], ['转盘', '知了猴转盘', 'lottery-wheel.html', 560, 620],
  ['九宫格', '知了猴九宫格', 'lottery-nine.html', 560, 620], ['幸运转盘', '知了猴幸运转盘', 'lottery-lucky.html', 680, 720],
  ['高级转盘1', '高级转盘1', 'advanced-wheel-1.html', 680, 720], ['高级转盘2', '高级转盘2', 'advanced-wheel-2.html', 680, 720],
  ['视频', '知了猴视频', 'video-widget-main.html', 640, 360], ['视频VIP', '知了猴视频 VIP', 'video-widget-vip.html', 640, 360],
  ['绿幕1', '知了猴绿幕 1', 'green-1.html', 640, 360], ['绿幕2', '知了猴绿幕 2', 'green-2.html', 640, 360],
  ['绿幕3', '知了猴绿幕 3', 'green-3.html', 640, 360], ['绿幕4', '知了猴绿幕 4', 'green-4.html', 640, 360]
] as const
const CAPTURE_TITLES = new Set<string>(CAPTURE_WINDOWS.map(([key]) => key))
const LEGACY_TO_KEY = new Map<string, string>(CAPTURE_WINDOWS.map(([key, legacy]) => [legacy, key]))
const KEY_TO_LEGACY = new Map<string, string>(CAPTURE_WINDOWS.map(([key, legacy]) => [key, legacy]))
const remembered = new Map<string, SavedCapture>()

/** 存档里的老标题归一到短名，升级后不丢窗口位置。 */
export function captureKey(title: string): string {
  return LEGACY_TO_KEY.get(title) || title
}

/** 某个固定标题的采集窗口是否存在（含停放中的待机窗口）——排队池据此判断「主播有没有这个来源」。 */
export function captureWindowExists(title: string): boolean {
  const output = byTitle.get(captureKey(title))
  return !!output && !output.win.isDestroyed()
}

/** 调整采集窗口大小（开着或停放中都行），新尺寸即收边基准并写进存档。窗口不存在时报错。 */
export function resizeOutputWindow(title: string, width: number, height: number): { ok: boolean; error?: string } {
  const output = byTitle.get(captureKey(title))
  if (!output || output.win.isDestroyed()) return { ok: false, error: '窗口还没开（先在对应页面开一次）' }
  const w = Math.round(Number(width) || 0), h = Math.round(Number(height) || 0)
  if (w < 64 || w > 4096 || h < 64 || h > 4096) return { ok: false, error: '尺寸要在 64~4096 之间' }
  const [minW, minH] = output.win.getMinimumSize()
  output.win.setSize(Math.max(w, minW || 0), Math.max(h, minH || 0))
  output.mediaBase = { width: w, height: h }
  scheduleCaptureSave()
  return { ok: true }
}

/** 采集窗口现在的大小（开着或停放中都行；主播拖边框调过的就是调过的）。窗口不存在回 null。 */
export function outputWindowSize(title: string): { width: number; height: number } | null {
  const output = byTitle.get(captureKey(title))
  if (!output || output.win.isDestroyed()) return null
  const [width, height] = output.win.getSize()
  return { width, height }
}

/** 窗口挂到 Windows 上的真实标题：跟设置的名称风格走，采集端看到的就是它。 */
export function displayTitle(key: string): string {
  return getSettings().outputTitleStyle === 'legacy' ? KEY_TO_LEGACY.get(key) || key : key
}

function saveCaptureWindows(): void {
  clearTimeout(saveTimer)
  saveTimer = undefined
  for (const output of outputs.values()) {
    if (output.win.isDestroyed() || !CAPTURE_TITLES.has(output.title)) continue
    const win = output.win, [minWidth, minHeight] = win.getMinimumSize()
    remembered.set(output.title, {
      title: output.title, ...win.getNormalBounds(), background: output.background,
      resizable: win.isResizable(), focusable: win.isFocusable(), hasShadow: win.hasShadow(), minWidth, minHeight,
      baseWidth: output.mediaBase?.width, baseHeight: output.mediaBase?.height,
      used: output.used || remembered.get(output.title)?.used === true
    })
  }
  try { writeJson('capture-windows', [...remembered.values()]) }
  catch (error) { console.warn('保存采集窗口位置失败', error instanceof Error ? error.message : String(error)) }
}

function scheduleCaptureSave(): void {
  if (restoring || quitting) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveCaptureWindows, 250)
  saveTimer.unref()
}

/** 启动时恢复主播开过的采集窗口（只在「关掉挂件后留着采集来源」开着时；老存档没有 used 字段的一律不恢复）。 */
export async function restoreCaptureOutputWindows(): Promise<void> {
  const saved = readJson<unknown>('capture-windows', null)
  if (!Array.isArray(saved)) return
  // ★先把存档里每个窗口的几何记进 remembered：下面不恢复时，第一次落盘（任一窗口一动）
  //   不能把其他挂件的位置/尺寸/收边基准冲掉。
  for (const raw of saved) {
    if (!raw || typeof raw !== 'object') continue
    const title = captureKey(String((raw as { title?: unknown }).title ?? ''))
    if (!CAPTURE_TITLES.has(title) || remembered.has(title)) continue
    remembered.set(title, { ...(raw as SavedCapture), title })
  }
  // 开哪个才有哪个窗口：默认关掉就真关掉，启动时什么都不摆出来
  if (!keepStandby()) return
  const restored: BrowserWindow[] = []
  restoring = true
  try {
    for (const raw of saved.slice(0, CAPTURE_TITLES.size)) {
      // 0.3.40 及以前存的是「知了猴倒计时」这类老标题，先归一到短名再恢复。
      const value = raw && typeof raw === 'object' ? { ...raw, title: captureKey(String(raw.title ?? '')) } : raw
      if (!value || typeof value !== 'object' || !CAPTURE_TITLES.has(value.title) || byTitle.has(value.title)) continue
      // 主播没开过的窗口不恢复（升级前的存档一律算没开过）
      if (value.used !== true) continue
      const dimension = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(64, Math.min(8192, Math.round(n))) : fallback
      const width = dimension(value.width, 320), height = dimension(value.height, 180)
      const position = onScreenPosition(value.x, value.y, width, height)
      const win = makeCaptureOutputWindow({
        title: value.title, ...position, width, height, frame: false, show: false,
        backgroundColor: standbyColor(getSettings().outputCaptureMode === 'transparent'), alwaysOnTop: false, skipTaskbar: true,
        resizable: value.resizable !== false, focusable: value.focusable !== false, hasShadow: value.hasShadow !== false,
        minWidth: Math.min(width, dimension(value.minWidth, 64)), minHeight: Math.min(height, dimension(value.minHeight, 64)),
        webPreferences: { webSecurity: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
      }, value.background !== false, false)
      const output = outputs.get(win)
      if (output) {
        output.used = true
        if (typeof value.baseWidth === 'number' && typeof value.baseHeight === 'number') {
          output.mediaBase = { width: dimension(value.baseWidth, width), height: dimension(value.baseHeight, height) }
        }
      }
      restored.push(win)
    }
    // 采集端重连时需要完整的原生渲染面；只有 HWND 的未加载窗口可能被跳过。
    await Promise.all(restored.map(win => win.loadURL(standbyPage(outputs.get(win)?.nativeTransparent === true)).catch(() => {})))
    // 整批固定标题均已创建后再显示，采集端无需等登录或打开编辑器。
    for (const win of restored) win.showInactive()
    // 恢复完就落一次盘：首次从旧版升级要记下这批窗口，老标题也在这一步换成短名存回去。
    if (restored.length) saveCaptureWindows()
  } finally {
    restoring = false
  }
}

// Windows 兼容采集会把原生透明窗口与桌面合成。采集用绿底必须同时覆盖原生窗口
// 和网页根节点：加载中、内容淡出或 body 隐藏时，也不能露出桌面。
export const OUTPUT_CHROMA_GREEN = '#00ff00'
export const OUTPUT_BLACK = '#000000'

/** 采集源的底色：绿幕模式=绿底（直播伴侣能抠掉），透明模式=真透明（OBS 那类支持 alpha 的采集端用）。 */
export function captureSourceBackground(): string {
  return getSettings().outputCaptureMode === 'transparent' ? '#00000000' : OUTPUT_CHROMA_GREEN
}

/** 关掉挂件后留不留那个采集窗口。默认不留（开哪个才有哪个窗口）；留着 = 窗口原地留一块纯绿底，伴侣里的来源不失效。 */
function keepStandby(): boolean {
  return getSettings().keepClosedSources === true
}

// 待机黑画面：整页交给系统拖动（-webkit-app-region:drag）。这页没有任何可点的东西，
// 用系统拖最靠得住——不依赖注入脚本，也不怕页面还没加载完主播就去拖。
function standbyPage(nativeTransparent: boolean): string {
  const color = nativeTransparent ? 'transparent' : OUTPUT_CHROMA_GREEN
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><html style="background:' + color + ';height:100%"><body style="margin:0;height:100%;background:' + color + ';-webkit-app-region:drag;cursor:move"></body></html>')
}

// 播放/开启时默认不抢层级：主播在电脑上干别的，弹个视频不该盖到他脸上。窗口没显示才 show 出来；
// 想要每次都跳到最前的，设置里打开「播放时窗口跳到最前」。
export function showOutputWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (!win.isVisible() || getSettings().outputRaiseOnOpen === true) win.showInactive()
}

// 收边：竖屏视频塞进横窗，contain 会在两侧留一大片底色（视频窗口是黑的，直播里就是大黑边）。
// 把窗口收成画面本身的比例——画面在屏幕上的大小不变，只把多出来的边去掉。
let fitting = false
export function fitOutputWindowToMedia(win: BrowserWindow, mediaWidth: number, mediaHeight: number): void {
  const output = outputs.get(win)
  if (!output || win.isDestroyed() || !(mediaWidth > 0) || !(mediaHeight > 0)) return
  if (getSettings().outputFitMedia === false) return
  const [width, height] = win.getSize()
  const base = output.mediaBase ?? { width, height }
  output.mediaBase = base
  const scale = Math.min(base.width / mediaWidth, base.height / mediaHeight)
  const [minWidth, minHeight] = win.getMinimumSize()
  const next = {
    width: Math.max(minWidth || 1, 64, Math.round(mediaWidth * scale)),
    height: Math.max(minHeight || 1, 64, Math.round(mediaHeight * scale))
  }
  if (next.width === width && next.height === height) return
  fitting = true
  try { win.setSize(next.width, next.height) } finally { setImmediate(() => { fitting = false }) }
}

/** 设置里改名称风格后立刻改所有采集窗口的原生标题；直播伴侣里需要重新选一次来源。 */
export function applyOutputTitleStyle(): void {
  for (const output of outputs.values()) if (!output.win.isDestroyed()) output.win.setTitle(displayTitle(output.title))
}

// 待机也要用抠得掉的底色：待机页输出黑色的话，直播伴侣采到的就是一块黑挡在画面上。
// 绿底被色度键抠掉 = 直播里什么都没有；原生透明模式下就真透明。
function standbyColor(nativeTransparent: boolean): string {
  return nativeTransparent ? '#00000000' : OUTPUT_CHROMA_GREEN
}

function background(output: Output): string {
  return standbyColor(output.nativeTransparent)
}

async function paintBackground(output: Output): Promise<void> {
  if (output.win.isDestroyed()) return
  // 不接管底色的活动窗口（比如没开抠图的视频窗口）：把之前注入的底色撤掉，
  // 露出页面自己的背景——否则上一把抠图留下的绿底会糊在这一把的页面上。
  if (output.active && !output.background) {
    await output.win.webContents.executeJavaScript(`document.getElementById('zl-output-background')?.remove()`).catch(() => {})
    return
  }
  const color = background(output)
  output.win.setBackgroundColor(color)
  // 单个 style 节点即时更新，避免切换十几次后遗留多层 insertCSS。
  await output.win.webContents.executeJavaScript(`(() => {
    let style = document.getElementById('zl-output-background');
    if (!style) { style = document.createElement('style'); style.id = 'zl-output-background'; document.documentElement.appendChild(style); }
    style.textContent = ${JSON.stringify(`html, body { background: ${color} !important; }`)};
  })()`).catch(() => {})
}

/** 业务复用窗口时改「底色接不接管」：视频窗口上一把开了抠图、这一把没开，就要撤掉绿底。 */
export function setOutputBackgroundManaged(win: BrowserWindow, managed: boolean, nativeColor?: string): void {
  const output = outputs.get(win)
  if (!output || win.isDestroyed()) return
  output.background = managed
  if (nativeColor && /^#[0-9a-f]{6}$/i.test(nativeColor)) win.setBackgroundColor(nativeColor)
  void paintBackground(output)
}

/** 同一挂件复用原生采集窗口；关闭只清空内容，避免采集端退回主窗口。 */
export function createCaptureOutputWindow(options: BrowserWindowConstructorOptions, manageBackground = true): BrowserWindow {
  return makeCaptureOutputWindow(options, manageBackground, true)
}

function makeCaptureOutputWindow(options: BrowserWindowConstructorOptions, manageBackground: boolean, active: boolean): BrowserWindow {
  const title = options.title ? captureKey(options.title) : ''
  if (!title) throw new Error('采集窗口必须提供固定标题')
  const nativeTransparent = manageBackground && getSettings().outputCaptureMode === 'transparent'
  const old = byTitle.get(title)
  // Electron 不能原地改变原生透明属性；切换绿底 / 透明底后重开挂件时重建。
  // 重建时沿用旧窗口的位置和大小：调用方按「窗口还在」没传尺寸的话，新窗口不能掉成 Electron 默认的 800×600。
  let inherited: Partial<BrowserWindowConstructorOptions> = {}
  if (old && !old.win.isDestroyed() && old.nativeTransparent !== nativeTransparent) {
    const bounds = old.win.getNormalBounds()
    inherited = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    old.win.destroy()
  }
  // 窗口从没开过、这次也没给位置：用存档里主播上次摆的位置和大小（关掉就真关掉的模式下窗口每次都是新建的）
  const memory = remembered.get(title)
  if ((!old || old.win.isDestroyed()) && memory && options.x == null && options.y == null) {
    inherited = { ...inherited, ...onScreenPosition(memory.x, memory.y, options.width || memory.width, options.height || memory.height) }
    if (!options.width && !options.height && memory.width && memory.height) inherited = { ...inherited, width: memory.width, height: memory.height }
  }
  // 主播关了「留着采集来源」时 stopOutput 会直接销毁窗口：销毁了就别再复用，往下走新建
  if (old && !old.win.isDestroyed() && old.active) stopOutput(old)
  if (old && !old.win.isDestroyed()) {
    old.active = true
    old.used = true
    old.generation++
    old.background = manageBackground
    old.win.webContents.stop()
    if (old.win.isMinimized()) old.win.restore()
    old.win.setMinimumSize(options.minWidth || 0, options.minHeight || 0)
    old.win.setResizable(options.resizable !== false)
    old.win.setFocusable(options.focusable !== false)
    old.win.setHasShadow(options.hasShadow !== false)
    // 保留主播已摆好的位置；挂件配置仍可按原逻辑调整尺寸。
    if (options.width && options.height) old.win.setSize(options.width, options.height)
    old.win.setBackgroundColor(manageBackground ? background(old) : options.backgroundColor || standbyColor(old.nativeTransparent))
    showOutputWindow(old.win)
    scheduleCaptureSave()
    return old.win
  }
  // 挂件页面没有输入框：拼写检查词典每个渲染进程都要加载一份，纯浪费，一律关
  const win = new BrowserWindow({ ...inherited, ...options, title: displayTitle(title), webPreferences: { spellcheck: false, ...(options.webPreferences || {}) }, ...(manageBackground ? { transparent: nativeTransparent } : {}),
    backgroundColor: !active ? standbyColor(nativeTransparent) : manageBackground ? nativeTransparent ? '#00000000' : OUTPUT_CHROMA_GREEN : options.backgroundColor })
  const output: Output = { win, title, active, used: active, generation: 1, background: manageBackground, nativeTransparent, cleanup: new Set(), closed: new Set() }
  outputs.set(win, output)
  byTitle.set(title, output)
  win.on('page-title-updated', event => event.preventDefault())
  // 主播在采集窗口上右键 → 「关闭这个窗口」（2026-09-11 用户要的：不用回整蛊台点，页面上的状态也跟着变）。
  // 页面里都是 no-drag + 拖动脚本，右键能收到 context-menu；系统自带的右键菜单不会再弹。
  win.webContents.on('context-menu', (event) => {
    event.preventDefault()
    if (win.isDestroyed()) return
    Menu.buildFromTemplate([{
      label: `关闭「${displayTitle(title)}」`,
      click: () => { const handler = closeHandlers.get(win); try { if (handler) handler(); else win.close() } catch { /* ignore */ } }
    }]).popup({ window: win })
  })
  // 挂 did-stop-loading 而不是 did-finish-load：那时页面还在 loading，executeJavaScript 会先排一个等待监听器，
  // 礼物连发每条视频一次加载就堆起来（MaxListenersExceededWarning 的另一个来源）；did-stop-loading 时立刻执行
  win.webContents.on('did-stop-loading', () => {
    void paintBackground(output)
    // 每次加载都注入：待机黑画面没有业务页面，复用窗口再开一次挂件时业务也不一定会重新
    // 注册（绿幕换素材就不会），只挂在 registerOutputWindow 上会漏掉这两种情况。
    if (!output.clickThrough && !win.isDestroyed()) void win.webContents.executeJavaScript(DRAG_SCRIPT).catch(() => {})
    // 抠图脚本本身什么都不做，等业务调 window.__zlChromaSet 才生效（只有视频类挂件会调）
    if (!win.isDestroyed()) void win.webContents.executeJavaScript(CHROMA_SCRIPT).catch(() => {})
  })
  win.on('move', () => scheduleCaptureSave())
  win.on('resize', () => {
    // 主播自己拖大拖小 = 新的收边基准；收边自己改的尺寸不算。
    if (!fitting) output.mediaBase = { width: win.getSize()[0], height: win.getSize()[1] }
    scheduleCaptureSave()
  })
  win.on('close', event => {
    if (quitting) return
    event.preventDefault()
    stopOutput(output)
  })
  win.on('closed', () => {
    finishOutput(output)
    outputs.delete(win)
    if (byTitle.get(title) === output) byTitle.delete(title)
  })
  scheduleCaptureSave()
  return win
}

function finishOutput(output: Output): void {
  for (const cleanup of output.cleanup) cleanup()
  output.cleanup.clear()
  const callbacks = [...output.closed]
  output.closed.clear()
  for (const callback of callbacks) callback()
}

function stopOutput(output: Output): void {
  if (!output.active || output.win.isDestroyed()) return
  output.active = false
  output.generation++
  finishOutput(output)
  const win = output.win
  // 默认：关挂件就是真关窗口（开哪个才有哪个窗口）。伴侣里那条来源下次开挂件时按同名窗口自动接回。
  if (!keepStandby()) { saveCaptureWindows(); win.destroy(); return }
  win.webContents.stop()
  win.setIgnoreMouseEvents(false)
  win.setAlwaysOnTop(false)
  win.setBackgroundColor(standbyColor(output.nativeTransparent))
  if (!win.isVisible()) win.showInactive()
  // 换为空页会停止视频、声音、动画与页面定时器；HWND/标题保持不变，窗口原地留一块纯绿底。
  void win.loadURL(standbyPage(output.nativeTransparent)).catch(() => {})
  if (!BrowserWindow.getAllWindows().some(w => !outputs.has(w))) closeIdleOutputWindows()
}

/** 业务的关闭通知也在停止输出时触发，正常释放计时器、快捷键和引用。 */
export function onOutputWindowClosed(win: BrowserWindow, callback: () => void): void {
  const output = outputs.get(win)
  if (output) output.closed.add(callback)
  else win.on('closed', callback)
}

// 监听器归本次开启所有，停止时全部解绑；重复开关不叠加事件处理。
function listen(win: BrowserWindow, target: BrowserWindow | WebContents, event: string, listener: (...args: any[]) => void, once = false): void {
  const output = outputs.get(win), generation = output?.generation
  const emitter = target as EventEmitter
  const cleanup = () => { emitter.removeListener(event, wrapped); output?.cleanup.delete(cleanup) }
  const wrapped = (...args: any[]) => {
    if (once) cleanup()
    if (!output || (output.active && output.generation === generation)) listener(...args)
  }
  output?.cleanup.add(cleanup)
  emitter.on(event, wrapped)
}
export function onOutputWindowEvent(win: BrowserWindow, event: string, listener: (...args: any[]) => void): void { listen(win, win, event, listener) }
export function onOutputPageEvent(win: BrowserWindow, event: string, listener: (...args: any[]) => void): void { listen(win, win.webContents, event, listener) }
export function onceOutputPageEvent(win: BrowserWindow, event: string, listener: (...args: any[]) => void): void { listen(win, win.webContents, event, listener, true) }

export async function applyOutputCaptureMode(): Promise<boolean> {
  const nativeTransparent = getSettings().outputCaptureMode === 'transparent'
  const needsReopen = [...outputs.values()].some(o => o.active && o.background && !o.win.isDestroyed() && o.nativeTransparent !== nativeTransparent)
  // 已开的窗口保持当前原生底色与运行状态；在不透明窗口上写 alpha=0 只会变黑。
  await Promise.all([...outputs.values()].map(paintBackground))
  return needsReopen
}

/** 主窗口退出时清掉待机窗口，不能留下持有单实例锁的后台空进程。 */
export function closeIdleOutputWindows(): void {
  saveCaptureWindows()
  for (const output of [...outputs.values()]) if (!output.active && !output.win.isDestroyed()) output.win.destroy()
  // Win10 上在主窗口 closed 回调里批量销毁透明待机窗口，偶尔不再触发
  // window-all-closed；确认窗口确实清空后补退出，释放单实例锁。
  setImmediate(() => {
    if (!quitting && process.platform !== 'darwin' && BrowserWindow.getAllWindows().length === 0) {
      markQuitReason('待机窗口清空后没有任何窗口了')
      logLine('quit', '待机窗口清空后没有任何窗口了，补退出')
      app.quit()
    }
  })
}

/** 主窗口被关掉 = 主播要收工：所有输出窗口（含正在播的）一起关，程序退出。
 *  原来只清待机窗口，正在播的绿幕全留在桌面上、进程也不退（0.3.43 用户反馈）。 */
export function closeAllOutputWindows(): void {
  saveCaptureWindows()
  for (const output of [...outputs.values()]) if (!output.win.isDestroyed()) output.win.destroy()
  setImmediate(() => {
    if (!quitting && process.platform !== 'darwin') {
      markQuitReason('主窗口已关闭（收工）')
      logLine('quit', '主窗口关闭，挂件已全部销毁，退出程序')
      app.quit()
    }
  })
}

app.on('before-quit', () => {
  saveCaptureWindows()
  quitting = true
  for (const output of [...outputs.values()]) if (!output.win.isDestroyed()) output.win.destroy()
})

// 归零自动隐藏内容时仍保留采集源；原生透明模式保持原行为。
export function hideCaptureOutputWindow(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed() && outputs.get(win)?.nativeTransparent) win.hide()
}

export function outputsAlwaysOnTop(): boolean {
  return getSettings().outputsAlwaysOnTop === true
}

// 页面里能点的东西不拖；自带 -webkit-app-region:drag 的区域交给系统拖，避免两套一起动。
// 用 Pointer Events + setPointerCapture：鼠标快一点甩出窗口时事件照样送到本页，
// 不会拖两下就断开（老的 mousemove 版本一脱离窗口就收不到事件，主播的手感就是「拖不动」）。
const DRAG_SCRIPT = `(function(){
  if (window.__zlOutputDrag) return; window.__zlOutputDrag = true;
  var dragging = false, ox = 0, oy = 0, root = document.documentElement, pointer = null;
  function skip(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.matches('button,input,select,textarea,a,[contenteditable],[data-nodrag]')) return true;
      var region = getComputedStyle(e).webkitAppRegion;
      if (region === 'drag') return true;
    }
    return false;
  }
  function stop() {
    if (!dragging) return;
    dragging = false;
    try { if (pointer !== null) root.releasePointerCapture(pointer); } catch (_err) {}
    pointer = null;
  }
  document.addEventListener('pointerdown', function(e){
    if (e.button !== 0 || e.pointerType === 'touch' || skip(e.target)) return;
    dragging = true; pointer = e.pointerId;
    ox = e.screenX - window.screenX; oy = e.screenY - window.screenY;
    try { root.setPointerCapture(e.pointerId); } catch (_err) {}
  }, true);
  document.addEventListener('pointermove', function(e){
    if (!dragging) return;
    try { window.moveTo(e.screenX - ox, e.screenY - oy); } catch (_err) {}
  }, true);
  document.addEventListener('pointerup', stop, true);
  document.addEventListener('pointercancel', stop, true);
  window.addEventListener('blur', stop);
})();`

function applyTop(win: BrowserWindow, override?: boolean): void {
  if (win.isDestroyed()) return
  const on = override === undefined ? outputsAlwaysOnTop() : override
  // 已经是目标状态就不动它（换素材复用窗口时不该有任何抬前/层级调用，绿幕回归盯着这个）
  if (!on && !win.isAlwaysOnTop()) return
  if (on) win.setAlwaysOnTop(true, 'screen-saver')
  else win.setAlwaysOnTop(false)
}

/**
 * 新建的输出窗口都从这里过一遍。
 * top：某个窗口自己的置顶开关（视频窗口有单独的「置顶」），给了就压过全局设置；不给就跟全局。
 * clickThrough：原生透明模式下点击穿透；绿幕采集必须保持普通窗口，否则 GDI 仍会采成黑屏。
 */
export function registerOutputWindow(win: BrowserWindow, opts: { top?: boolean; drag?: boolean; clickThrough?: boolean } = {}): void {
  const output = outputs.get(win)
  if (output) output.top = opts.top
  applyTop(win, opts.top)
  const clickThrough = opts.clickThrough === true && output?.nativeTransparent === true
  // setIgnoreMouseEvents(true) 会加 WS_EX_LAYERED；即便已关 GPU，BitBlt 仍然全黑。
  if (opts.clickThrough) win.setIgnoreMouseEvents(clickThrough)
  if (output) output.clickThrough = clickThrough || opts.drag === false
  if (opts.drag !== false && !clickThrough) {
    // 挂 did-stop-loading 而不是 did-finish-load：did-finish-load 时页面还在 loading，executeJavaScript 会先 once('did-stop-loading') 等着；
    // 礼物连发时绿幕每条视频都是一次 loadFile，上一条的等待还没落地下一条又开始加载，等待就一条条堆起来
    // （主播 main.log 与 tools/soak-stress.mjs 都复现「11 did-stop-loading listeners added」），直到队列跑空才一起注入。
    // did-stop-loading 时不在 loading，脚本立刻执行、不留监听器；DRAG_SCRIPT 自带重复注入保护。
    onOutputPageEvent(win, 'did-stop-loading', () => {
      if (!win.isDestroyed()) void win.webContents.executeJavaScript(DRAG_SCRIPT).catch(() => {})
    })
  }
}

/** 窗口复用（换素材不重建）时，自己的置顶开关可能变了，重新套一遍。 */
export function updateOutputWindowTop(win: BrowserWindow, top?: boolean): void {
  const output = outputs.get(win)
  if (output) output.top = top
  applyTop(win, top)
}

/** 设置改过之后重新套到所有已开的输出窗口。 */
export function applyOutputsAlwaysOnTop(): void {
  for (const [win, o] of outputs) if (o.active) applyTop(win, o.top)
}

export function setOutputsAlwaysOnTop(flag: boolean): void {
  saveSettings({ outputsAlwaysOnTop: !!flag })
  applyOutputsAlwaysOnTop()
}
