// 视频播放器：主 / VIP 两个独立的置顶播放窗口（复刻参考「主视频 / VIP 视频」双窗口同播），
// 各自记住位置和尺寸；顶部一条隐形拖动带可以拖着走；播完自动关、限时关给进场/礼物触发的一次性视频用。
import { BrowserWindow, app } from 'electron'
import { onScreenPosition } from './window-bounds'
import { outputsAlwaysOnTop, registerOutputWindow, updateOutputWindowTop, createCaptureOutputWindow, onOutputWindowClosed, onOutputWindowEvent, onceOutputPageEvent, setOutputBackgroundManaged, showOutputWindow, fitOutputWindowToMedia } from './output-window'
import { applyChromaKey } from './chroma-key'
import fs from 'fs'
import path from 'path'
import { captureTitle, mediaUrl, escapeAttr, validMedia } from './capture-output'
import type { VideoWidgetConfig, VideoWidgetSlot, VideoWidgetState } from '@shared/types'
import { takeStageVideo, stageVideoCompletion } from './stage-video'
import { optimizedMedia } from './media-optimize'

const wins = new Map<VideoWidgetSlot, BrowserWindow>()

const toFileUrl = (p: string) => escapeAttr(mediaUrl(p))
const timers = new Map<VideoWidgetSlot, ReturnType<typeof setTimeout>>()
const generations = new Map<VideoWidgetSlot, number>()
const autoClose = new Map<VideoWidgetSlot, boolean>()
const completions = new Map<VideoWidgetSlot, (error?: string) => void>()
function completeVideo(slot: VideoWidgetSlot, error?: string): void {
  const done = completions.get(slot)
  completions.delete(slot)
  done?.(error)
}

const page = (cfg: VideoWidgetConfig, generation: number) => {
  // 开抠图时页面底色交给窗口管（透明底模式=真透明、绿幕模式=绿底），否则扣掉的绿会露出底色
  const bg = cfg.chroma === true || /^(?:transparent|#00000000)$/i.test(cfg.bgColor || '') ? 'transparent' : cfg.bgColor || '#000000'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${bg};overflow:hidden;width:100vw;height:100vh}
  video{width:100vw;height:100vh;object-fit:contain;display:block;background:inherit}
  /* 顶部拖动带保持透明，避免改变采集画面。 */
  #drag{position:fixed;left:0;top:0;width:100%;height:26px;-webkit-app-region:drag;background:transparent;transition:background .2s}
  #drag:hover{background:transparent}
</style></head>
<body>
<video id="v" src="${toFileUrl(cfg.path)}" ${cfg.loop ? 'loop' : ''} ${cfg.muted ? 'muted' : ''} autoplay playsinline></video>
<div id="drag" title="按住拖动窗口"></div>
<script>
  var v = document.getElementById('v');
  v.volume = ${Math.max(0, Math.min(1, cfg.volume ?? 1))};
  v.addEventListener('click', function(){ if (v.paused) { v.play(); } else { v.pause(); } });
  v.addEventListener('dblclick', function(){ if (document.fullscreenElement) { document.exitFullscreen(); } else { document.documentElement.requestFullscreen(); } });
  // 画面尺寸到手就报给主进程收边：竖屏视频塞进横窗，两侧会留一大片黑。
  v.addEventListener('loadedmetadata', function(){ document.title = 'zl-video-size-${generation}-' + v.videoWidth + 'x' + v.videoHeight; });
  // 播完/出错用标题通知主进程（这个窗口没有 preload，标题是最省事的单向通道）
  v.addEventListener('ended', function(){ document.title = 'zl-video-ended-${generation}'; });
  v.addEventListener('error', function(){ document.title = 'zl-video-error-${generation}'; });
</script>
</body></html>`
}

function slotOf(value: unknown): VideoWidgetSlot {
  return value === 'vip' ? 'vip' : 'main'
}

export function openVideoWidget(cfg: VideoWidgetConfig, onComplete?: (error?: string) => void): { ok: boolean; error?: string; stage?: boolean } {
  try {
    if (!cfg.path) return { ok: false, error: '未选择视频文件' }
    if (!validMedia(cfg.path)) return { ok: false, error: '视频文件不存在，请重新选择' }
    // 抽奖动作里的视频交给转盘窗口自己播（项目文件夹、动作命令挑出来的都走这儿），不再另开窗口
    if (takeStageVideo(cfg.path, 'video', Math.max(0, Number(cfg.maxSeconds) || 0), cfg.chroma)) return { ok: true, stage: true }
    const slot = slotOf(cfg.slot)
    completeVideo(slot, '视频已被其他素材替换')
    const generation = (generations.get(slot) || 0) + 1
    generations.set(slot, generation)
    autoClose.set(slot, !!cfg.autoClose)
    const oldTimer = timers.get(slot)
    if (oldTimer) clearTimeout(oldTimer)
    timers.delete(slot)
    const tmp = path.join(app.getPath('userData'), `video-widget-${slot}.html`)
    fs.writeFileSync(tmp, page({ ...cfg, path: cfg.path ? optimizedMedia(cfg.path) : cfg.path }, generation))
    const hasPos = Number.isFinite(Number(cfg.x)) && Number.isFinite(Number(cfg.y)) && (cfg.x !== 0 || cfg.y !== 0)
    // 抠图 / 绿底素材要在原生层把窗口底色换成透明或绿，而原生透明属性改不了——
    // 走 createCaptureOutputWindow 让它决定复用还是重建（自己判断会留下白底窗口）
    const manage = cfg.chroma === true || /^#(?:00ff00|0f0)$/i.test(cfg.bgColor || '') || /^(?:transparent|#00000000)$/i.test(cfg.bgColor || '')
    let win = wins.get(slot)
    if (!win || win.isDestroyed() || manage) {
      win = createCaptureOutputWindow({
        width: cfg.width || 640,
        height: cfg.height || 360,
        title: `视频${slot === 'vip' ? 'VIP' : ''}`,
        ...(hasPos ? onScreenPosition(cfg.x, cfg.y, cfg.width || 640, cfg.height || 360) : {}),
        frame: false,
        // 不接管底色的窗口按自己的底色建（以前不传 = Electron 默认白底，黑底视频四周先闪一圈白）
        backgroundColor: /^#[0-9a-f]{6}$/i.test(cfg.bgColor || '') ? cfg.bgColor : '#000000',
        alwaysOnTop: cfg.topMost === true || outputsAlwaysOnTop(),
        resizable: true,
        skipTaskbar: true,
        webPreferences: { webSecurity: false, backgroundThrottling: false }
      }, manage)
      // ★每次都重新登记，不管窗口是新建的还是复用的：复用时 output-window 先 stopOutput，
      //   那一下会跑我们的 closed 回调把 wins 里的登记删掉；以前只在「换了个窗口」时才登记，
      //   于是第二条视频的状态、播完自动关、限时关、「停止视频」、抠图全部失灵，第三条又好——
      //   0.3.42 反馈的「视频停在最后一帧」真根因在这里。
      captureTitle(win, `视频${slot === 'vip' ? 'VIP' : ''}`)
      registerOutputWindow(win, { top: cfg.topMost === true ? true : undefined })
      wins.set(slot, win)
      const created = win
      onOutputWindowClosed(win, () => {
        if (wins.get(slot) !== created) return
        wins.delete(slot)
        completeVideo(slot, '视频窗口已关闭')
        const timer = timers.get(slot)
        if (timer) clearTimeout(timer)
        timers.delete(slot)
      })
      // ★每次开播都重新注册「播完/尺寸」监听：复用窗口时 output 代次 +1，老监听已作废，
      //   不补注册的话第二次起「播完了」没人听——视频永远停在最后一帧（0.3.42 用户实测卡帧）。
      //   作废的旧监听不会再触发，停止输出时统一清理，不叠加副作用。
      const current2 = win
      onOutputWindowEvent(win, 'page-title-updated', (_event, title) => {
        if (wins.get(slot) !== current2) return
        const size = /^zl-video-size-(\d+)-(\d+)x(\d+)$/.exec(String(title))
        if (size && Number(size[1]) === generations.get(slot)) {
          fitOutputWindowToMedia(current2, Number(size[2]), Number(size[3]))
          return
        }
        if (title === `zl-video-ended-${generations.get(slot)}`) {
          completeVideo(slot)
          if (autoClose.get(slot)) closeVideoWidget(slot)
        }
        if (title === `zl-video-error-${generations.get(slot)}`) {
          completeVideo(slot, '视频无法播放，请检查文件格式或重新选择')
          if (autoClose.get(slot)) closeVideoWidget(slot)
        }
      })
    } else {
      // 直接复用窗口：上一把开了抠图/绿底的话，底色还停在「接管」状态，
      // 这一把没开就撤掉，露出页面自己的底色（不然黑底视频四周糊一圈绿）。
      setOutputBackgroundManaged(win, false, cfg.bgColor || '#000000')
      if (!cfg.autoClose) {
        if (cfg.width && cfg.height) win.setSize(cfg.width, cfg.height)
        if (hasPos) win.setPosition(Math.round(Number(cfg.x)), Math.round(Number(cfg.y)))
      }
    }
    const current = win
    if (onComplete) completions.set(slot, onComplete)
    // 内置绿幕抠图：这个视频自带绿背景时，把绿扣成透明。
    // ★监听必须在 loadFile 之前挂：文件很小，加载可能在同一个 tick 就完成，挂晚了这一次就漏了。
    onceOutputPageEvent(win, 'did-finish-load', () => {
      if (wins.get(slot) === current && generations.get(slot) === generation && !current.isDestroyed()) applyChromaKey(current, cfg.chroma === true)
    })
    void win.loadFile(tmp).catch(() => {})
    updateOutputWindowTop(win, cfg.topMost === true ? true : undefined)
    showOutputWindow(win)
    const maxSeconds = Math.max(0, Number(cfg.maxSeconds) || 0)
    if (maxSeconds > 0) {
      timers.set(slot, setTimeout(() => {
        if (generations.get(slot) === generation && wins.get(slot) === current && !current.isDestroyed()) { completeVideo(slot); closeVideoWidget(slot) }
      }, Math.round(maxSeconds * 1000)))
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开视频播放器失败：' + (e as Error).message }
  }
}

// 不传 slot = 全关
export function closeVideoWidget(slot?: VideoWidgetSlot): { ok: boolean } {
  const targets = slot ? [slot] : [...wins.keys()]
  for (const key of targets) {
    completeVideo(key, '视频已停止')
    const timer = timers.get(key)
    if (timer) clearTimeout(timer)
    timers.delete(key)
    const win = wins.get(key)
    wins.delete(key)
    try { win?.close() } catch { /* ignore */ }
  }
  return { ok: true }
}

export async function playVideoWidgetAndWait(cfg: VideoWidgetConfig, isCurrent?: () => boolean): Promise<{ ok: boolean; error?: string }> {
  const slot = slotOf(cfg.slot)
  let settled = false
  let error: string | undefined
  const finish = (reason?: string) => { if (!settled) { settled = true; error = reason } }
  const opened = openVideoWidget(cfg, finish)
  if (!opened.ok) return opened
  if (opened.stage) {
    const done = stageVideoCompletion()
    if (!done) return { ok: false, error: '转盘视频未提供完成通知' }
    void done.then(() => finish(), () => finish('转盘视频播放失败'))
  }
  const started = Date.now()
  while (!settled) {
    if ((isCurrent && !isCurrent()) || Date.now() - started > 600_000) {
      finish(isCurrent && !isCurrent() ? '事件已取消' : '视频播放超时，已停止等待')
      if (completions.get(slot) === finish) closeVideoWidget(slot)
      break
    }
    await new Promise<void>(resolve => setTimeout(resolve, 40))
  }
  return error ? { ok: false, error } : { ok: true }
}

function isOpen(slot: VideoWidgetSlot): boolean {
  const win = wins.get(slot)
  return !!win && !win.isDestroyed()
}

export function videoWidgetState(): VideoWidgetState {
  const main = isOpen('main')
  const vip = isOpen('vip')
  const position = (slot: VideoWidgetSlot) => {
    const win = wins.get(slot)
    if (!win || win.isDestroyed()) return undefined
    const [x, y] = win.getPosition()
    const [width, height] = win.getSize()
    return { x, y, width, height }
  }
  return { open: main || vip, main, vip, mainBounds: position('main'), vipBounds: position('vip') }
}

app.on('before-quit', () => {
  closeVideoWidget()
})
