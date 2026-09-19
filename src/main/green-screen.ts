// 绿幕采集窗口：普通原生窗口播放视频/图片，由直播软件抠除统一绿底。
// 最多 4 个窗口同时开，各自独立内容；按住素材区域即可拖动。
import { BrowserWindow, app } from 'electron'
import { memoryHold, memoryLevel } from './memory-guard'
import { outputsAlwaysOnTop, registerOutputWindow, createCaptureOutputWindow, onOutputWindowClosed, onOutputWindowEvent, onOutputPageEvent, onceOutputPageEvent, showOutputWindow, fitOutputWindowToMedia, captureWindowExists, setOutputCloseHandler } from './output-window'
import { applyChromaKey } from './chroma-key'
import fs from 'fs'
import path from 'path'
import { captureTitle, mediaUrl, validMedia } from './capture-output'
import type { GreenScreenSlot, GreenScreenState } from '@shared/types'
import { takeStageVideo, stageVideoCompletion } from './stage-video'
import { getSettings } from './settings'
import { readJson, writeJson } from './db'
import { randomUUID } from 'node:crypto'
import { optimizedMedia } from './media-optimize'

export const GREEN_SLOTS: GreenScreenSlot[] = [1, 2, 3, 4]

// ---- 每个绿幕窗口的尺寸：主进程自己记一份（data/green-screen-sizes.json） ----
// ★以前尺寸只存在绿幕页的 localStorage 里：礼物规则 / 抽奖 / 时间盲盒触发播放时不带尺寸，
//   复用窗口那一下 setSize(640,360) 把主播配好的 1080×1920 打回默认。现在：
//   · 绿幕页配的宽高（或调尺寸）记在这里，下次新建窗口按它来；
//   · 窗口已经在（含停放中的待机窗口）就不再传尺寸，保持主播拖过/调过的大小。
const SIZE_STORE = 'green-screen-sizes'
const DEFAULT_SIZE = { width: 640, height: 360 }
const sizes = new Map<GreenScreenSlot, { width: number; height: number }>()
let sizesLoaded = false
function validSize(width: unknown, height: unknown): { width: number; height: number } | null {
  const w = Math.round(Number(width) || 0), h = Math.round(Number(height) || 0)
  return w >= 64 && w <= 4096 && h >= 64 && h <= 4096 ? { width: w, height: h } : null
}
function ensureSizesLoaded(): void {
  if (sizesLoaded) return
  sizesLoaded = true
  try {
    const saved = readJson<Record<string, { width?: unknown; height?: unknown }> | null>(SIZE_STORE, null)
    if (!saved || typeof saved !== 'object') return
    for (const n of GREEN_SLOTS) {
      const size = validSize(saved[String(n)]?.width, saved[String(n)]?.height)
      if (size) sizes.set(n, size)
    }
  } catch { /* 存档坏了就用默认 */ }
}
/** 记住某个绿幕窗口的尺寸（绿幕页配宽高 / 调尺寸时调用）；窗口没开也记，下次开按它来。 */
export function rememberGreenScreenSize(slotValue: unknown, width: unknown, height: unknown): boolean {
  const size = validSize(width, height)
  if (!size) return false
  ensureSizesLoaded()
  sizes.set(slotOf(slotValue), size)
  try { writeJson(SIZE_STORE, Object.fromEntries([...sizes.entries()].map(([n, s]) => [String(n), s]))) } catch { /* 落盘失败不影响使用 */ }
  return true
}
/** 建窗口用什么尺寸：调用方明确给了就用它（并记住）；窗口已经在就保持现状；否则用记住的 / 默认。 */
function windowSize(slot: GreenScreenSlot, options?: { width?: number; height?: number }): { width?: number; height?: number } {
  ensureSizesLoaded()
  const wanted = validSize(options?.width, options?.height)
  if (wanted) { rememberGreenScreenSize(slot, wanted.width, wanted.height); return wanted }
  if (captureWindowExists(`绿幕${slot}`)) return {}
  return { ...(sizes.get(slot) || DEFAULT_SIZE) }
}
// 原生窗口与页面共用抠像底色，素材透明区域及比例留白也保持绿色。
const GREEN_BACKGROUND = '#00ff00'
const wins = new Map<GreenScreenSlot, BrowserWindow>()
// origin=command：礼物规则 / 动作命令 / 项目开的素材；「停止视频」只停这些，不动主播在绿幕页自己开的
const sources = new Map<GreenScreenSlot, { src: string; type: 'video' | 'image'; text: string; origin?: 'command'; requestId?: string; onComplete?: (error?: string) => void; onStarted?: (slot: GreenScreenSlot) => void; options?: GreenOpenOptions }>()
// 礼物/进场视频可配置为一次性播放或限时播放。计时器与窗口按槽位绑定，
// 替换同一槽位时先清掉旧计时器，避免旧视频把新视频提前关掉。
const closeTimers = new Map<GreenScreenSlot, ReturnType<typeof setTimeout>>()
// 视频停住看门狗：非循环视频 8 秒没有进度（既没播完也没在走）就当播完撤掉，让排队的接上。
// 兜底用：正常情况下 Chromium 的后台暂停已在 app-setup 里关掉；解码器卡死之类的仍靠它把队伍疏通。
const watchdogs = new Map<GreenScreenSlot, ReturnType<typeof setInterval>>()
// 没进度多久先「推一下」（暂停再播 / 原地 seek，能把卡住的解码管线叫醒）、多久放弃撤掉
const NUDGE_MS = 2500
const STALL_MS = 6000
// 被看门狗处理过的次数（推醒的 / 撤掉的），放进 greenScreenState 给回归和日志看
let rescued = 0
let nudged = 0
function stopWatchdog(slot: GreenScreenSlot): void {
  const timer = watchdogs.get(slot)
  if (timer) clearInterval(timer)
  watchdogs.delete(slot)
}
const watchState = new Map<GreenScreenSlot, { time: number; idleMs: number; nudges: number; ready: number }>()
function startWatchdog(slot: GreenScreenSlot, win: BrowserWindow, generation: number): void {
  stopWatchdog(slot)
  watchState.delete(slot)
  let lastTime = -1
  let lastProgress = Date.now()
  let nudges = 0
  let endedSince: number | undefined
  const timer = setInterval(() => {
    if (wins.get(slot) !== win || generations.get(slot) !== generation || win.isDestroyed()) { stopWatchdog(slot); watchState.delete(slot); return }
    // 页面没准备好 / 测试桩返回非 Promise 时别把定时器炸了：一律包成 Promise
    let probe: Promise<unknown>
    try { probe = Promise.resolve(win.webContents.executeJavaScript(`(()=>{const v=document.getElementById('v');return v?[v.currentTime,v.ended,v.readyState,v.duration]:null})()`, true)) } catch { return }
    probe.then((state) => {
      if (!Array.isArray(state) || wins.get(slot) !== win || generations.get(slot) !== generation) return
      const [time, ended, ready, duration] = state as [number, boolean, number, number]
      // 已经 ended 却还挂着素材（ended 事件没送到 / 被跳到末尾）：给 2 秒，没人撤就撤
      if (ended) { endedSince ??= Date.now(); if (Date.now() - endedSince > 2000) { stopWatchdog(slot); watchState.delete(slot); rescued++; blankGreenScreen(slot) } return }
      endedSince = undefined
      // 「有进度」= 至少走了 0.05 秒：卡住的解码管线 currentTime 也会一点点蠕动，按任何增长算进度就永远抓不到
      const atEnd = Number.isFinite(duration) && duration > 0 && time >= duration - 0.05
      if (time >= lastTime + 0.05 && !atEnd) { lastTime = time; lastProgress = Date.now(); watchState.set(slot, { time, idleMs: 0, nudges, ready }); return }
      if (lastTime < 0) { lastTime = time }
      const idle = Date.now() - lastProgress
      watchState.set(slot, { time, idleMs: idle, nudges, ready })
      // 还没开始播（currentTime=0 且数据没到）不算卡：大文件读盘要时间；但 20 秒都没起来也当卡
      if (time === 0 && ready < 2 && idle < 20_000) return
      if (idle > STALL_MS) {
        stopWatchdog(slot)
        watchState.delete(slot)
        rescued++
        console.warn(`[green] 绿幕 ${slot} 的视频 ${Math.round(idle / 1000)} 秒没进度（停在 ${Number(time).toFixed(2)}s${atEnd ? '，已到末尾却没报播完' : ''}），当播完撤掉`)
        blankGreenScreen(slot, atEnd ? undefined : '视频停住没播完，已撤掉')
        return
      }
      if (idle > NUDGE_MS * (nudges + 1) && nudges < 2) {
        nudges++
        nudged++
        // 推一下：先暂停再播；第二次再原地 seek 一下（两招都能把停住的媒体管线叫醒）；到了末尾的直接跳到末尾让它报播完
        const js = atEnd
          ? `(()=>{const v=document.getElementById('v');if(!v)return;try{v.currentTime=v.duration;void v.play()}catch(e){}})()`
          : `(()=>{const v=document.getElementById('v');if(!v)return;try{v.pause();${nudges > 1 ? 'v.currentTime=Math.max(0,v.currentTime-0.05);' : ''}void v.play()}catch(e){}})()`
        void win.webContents.executeJavaScript(js, true).catch(() => {})
      }
    }).catch(() => {})
  }, 500)
  watchdogs.set(slot, timer)
}

const generations = new Map<GreenScreenSlot, number>()

// 常驻播放页（0.3.60）：每个绿幕窗口只加载一次，之后来素材只换 <video>/<img> 的源、播完清源。
// 以前每条视频都是「生成新 HTML → 整页导航 → 建新文档和解码管线 → 播完整页销毁」，礼物一密页面进程里全是正在建、正在拆的文档，
// 内存峰值和 CPU 都耗在拆建上（还有 executeJavaScript 等加载的监听器堆积）。现在：文档常驻、元素复用、事件照旧靠 document.title 报给主进程，
// 每次 __zlPlay 带 generation，旧素材的事件对不上号就被忽略。窗口 / 句柄 / 标题一律不变，直播伴侣采集源不受影响。
const PLAYER_VERSION = 1
const playerPage = (slot: GreenScreenSlot) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>绿幕${slot}</title><style>
  html, body { background:${GREEN_BACKGROUND}; }
  body { margin:0; overflow:hidden; font-family:sans-serif; -webkit-app-region:no-drag; user-select:none; }
  video, img { width:100vw; height:100vh; object-fit:contain; display:block; pointer-events:none; -webkit-app-region:no-drag; }
  .hidden { display:none !important; }
  .label { position:fixed; left:50%; bottom:12px; transform:translateX(-50%); pointer-events:none; z-index:4;
    color:#fff; text-shadow:0 0 6px #000; font-size:28px; white-space:nowrap; }
  #drag{position:fixed;inset:0;width:100%;height:100%;z-index:99;-webkit-app-region:no-drag;pointer-events:auto;background:transparent;cursor:move;transition:background .2s}
  #drag:hover{background:transparent}
</style></head>
<body>
<video id="v" class="hidden" autoplay playsinline></video>
<img id="i" class="hidden" alt="">
<div id="label" class="label hidden"></div>
<div id="drag" title="按住拖动窗口"></div>
<script>
(function(){
  var v=document.getElementById('v'), i=document.getElementById('i'), label=document.getElementById('label');
  var gen=0, playing=false, loopWanted=false;
  function title(t){ document.title=t }
  function size(el){ var w=el.videoWidth||el.naturalWidth, h=el.videoHeight||el.naturalHeight; if(w&&h) title('zl-media-size-'+gen+'-'+w+'x'+h) }
  v.addEventListener('loadedmetadata', function(){ if(playing) size(v) });
  v.addEventListener('playing', function(){ if(playing) title('zl-green-playing-'+gen) });
  v.addEventListener('ended', function(){ if(playing && !loopWanted) title('zl-green-ended-'+gen) });
  v.addEventListener('error', function(){ if(playing && v.getAttribute('src')) title('zl-green-error-'+gen) });
  i.addEventListener('load', function(){ if(playing) size(i) });
  window.__zlPlayer = ${PLAYER_VERSION};
  window.__zlPlay = function(o){
    gen = o.generation || 0; playing = true; loopWanted = !!o.loop;
    if (o.text) { label.textContent = o.text; label.classList.remove('hidden'); } else { label.textContent = ''; label.classList.add('hidden'); }
    if (o.type === 'video') {
      i.classList.add('hidden'); i.removeAttribute('src');
      v.loop = !!o.loop; v.classList.remove('hidden');
      try { v.pause(); } catch (e) {}
      v.src = o.src; v.load();
      var p = v.play(); if (p && p.catch) p.catch(function(){});
    } else {
      try { v.pause(); } catch (e) {}
      v.removeAttribute('src'); v.load(); v.classList.add('hidden');
      i.src = o.src; i.classList.remove('hidden');
    }
    return true;
  };
  window.__zlBlank = function(){
    playing = false; gen = 0;
    try { v.pause(); } catch (e) {}
    v.removeAttribute('src'); v.load(); v.classList.add('hidden');
    i.removeAttribute('src'); i.classList.add('hidden');
    label.textContent = ''; label.classList.add('hidden');
    return true;
  };
})();
</script>
</body>
</html>`
const playerWritten = new Set<GreenScreenSlot>()
function playerFile(slot: GreenScreenSlot): string {
  const file = path.join(app.getPath('userData'), `green-player-${slot}.html`)
  if (!playerWritten.has(slot)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, playerPage(slot))
    playerWritten.add(slot)
  }
  return file
}
function playerLoaded(win: BrowserWindow, slot: GreenScreenSlot): boolean {
  try { return !win.isDestroyed() && !win.webContents.isLoading() && win.webContents.getURL().endsWith(`/green-player-${slot}.html`) } catch { return false }
}
/** 播放页就绪就立刻执行，否则（首次 / 被别的页面顶掉 / 还在加载）加载完再执行。 */
function withPlayer(win: BrowserWindow, slot: GreenScreenSlot, then: () => void): void {
  if (playerLoaded(win, slot)) { then(); return }
  onceOutputPageEvent(win, 'did-finish-load', then)
  let url = ''
  try { url = win.webContents.getURL() } catch { /* 取不到就当没加载 */ }
  if (!url.endsWith(`/green-player-${slot}.html`)) void win.loadFile(playerFile(slot)).catch(() => {})
}

function slotOf(value: unknown): GreenScreenSlot {
  const n = Number(value)
  return (n === 2 || n === 3 || n === 4 ? n : 1) as GreenScreenSlot
}

// ---- 视频排队（用户 2026-09-10 定版）----
//   · 只在开着的绿幕窗口里排：没开的窗口一律不算数（直播伴侣里没来源，播了观众也看不见）；
//   · 每个项目自己指定的窗口是它的最优先窗口，没指定的用设置里的「默认播放窗口」；
//   · 每项一个「本窗口忙时去别的窗口」开关（默认开）：开着 → 最优先窗口忙就去其他开着的空闲窗口，
//     全忙再排队；关着 → 只在自己那个窗口排队等；
//   · 该去的窗口一个都没开：这条视频不播、明说原因（窗口不存在，直播伴侣本来也采不到）。
//   replace=true 是老的「直接顶掉这个窗口正在播的」语义：时间盲盒 / 进场视频 / 绿幕页自己点播用它。
export type GreenOpenOptions = {
  loop?: boolean; maxSeconds?: number; chroma?: boolean; width?: number; height?: number; origin?: 'command'
  overflow?: boolean; replace?: boolean
  // onStarted 带上真正落地的窗口号：排队的素材要等 drainPool 挑到窗口才知道播在哪，
  // 项目脚本里的「再来一次」就是靠它接着在同一个窗口播（2026-09-11 用户：「能否是本窗口的再来一次」）
  requestId?: string; onComplete?: (error?: string) => void; onStarted?: (slot: GreenScreenSlot) => void
}
type PoolRequest = { src: string; type: 'video' | 'image'; text: string; preferred: GreenScreenSlot; overflow: boolean; options?: GreenOpenOptions }
const poolQueue: PoolRequest[] = []
/** 内存守卫用：告急时报排着几条（只停不丢）；恢复时把停着的接着播。 */
export function greenQueueLength(): number { return poolQueue.length }
export function resumeGreenQueue(): void { setTimeout(drainPool, 0) }
/** 排队上限：默认不限（设置项 0）。用户 2026-09-11：「不排除有人送一千个一万个」——连击多少条就排多少条；主播想限再在设置页填个数 */
function poolLimit(): number {
  const n = Math.round(Number(getSettings().videoQueueLimit) || 0)
  return n >= 1 ? n : Infinity
}

/** 主播选的默认播放窗口（1~4，默认 1 号） */
function defaultSlotSetting(): GreenScreenSlot {
  const raw = Math.round(Number(getSettings().videoDefaultSlot) || 1)
  return (raw >= 1 && raw <= 4 ? raw : 1) as GreenScreenSlot
}
function slotBusy(slot: number): boolean {
  const win = wins.get(slot as GreenScreenSlot)
  if (!win || win.isDestroyed()) return false
  // 空窗口（只铺绿底、还没素材）不算占用：它是给直播伴侣留的采集源，不该占着排队池
  return !!String(sources.get(slot as GreenScreenSlot)?.src || '').trim()
}
/** 这个槽位主播有没有开着：窗口存在就算（含播完后留着的空绿窗）。 */
function windowOpen(slot: number): boolean {
  const win = wins.get(slot as GreenScreenSlot)
  return !!win && !win.isDestroyed()
}
function anyGreenOpen(): boolean {
  return GREEN_SLOTS.some((n) => windowOpen(n))
}
/** 按「最优先窗口 → 其他开着的空闲窗口（允许溢出时）」挑一个现在就能播的窗口；挑不到回 undefined */
function pickSlot(preferred: GreenScreenSlot, overflow: boolean): GreenScreenSlot | undefined {
  if (windowOpen(preferred) && !slotBusy(preferred)) return preferred
  if (!overflow) return undefined
  for (const n of GREEN_SLOTS) {
    if (n === preferred) continue
    if (windowOpen(n) && !slotBusy(n)) return n
  }
  return undefined
}
/**
 * 给「现在就要播、不排队」的素材（时间盲盒开箱视频）挑窗口：
 * 最优先窗口开着且空闲 → 它；允许去别的窗口 → 其他开着的空闲窗口；都忙 → 最优先窗口开着就顶掉它；
 * 最优先窗口没开而允许去别的窗口 → 顶掉任一开着的；一个都没开 → undefined（调用方按「没播」记录）。
 * 2026-09-11 用户实测：指定 4 号没开、只开了 1 号、开关开着，盲盒视频却没去 1 号——盲盒这条路以前写死指定窗口。
 */
export function pickSlotNow(preferred: GreenScreenSlot, overflow: boolean): GreenScreenSlot | undefined {
  const idle = pickSlot(preferred, overflow)
  if (idle) return idle
  if (windowOpen(preferred)) return preferred
  if (overflow) return GREEN_SLOTS.find((n) => windowOpen(n))
  return undefined
}
/** 有窗口空出来就把排队的素材接上：按先来后到，谁能落地谁先走（落不了地的不挡后面能落地的） */
function drainPool(): void {
  if (!poolQueue.length) return
  // 内存告急：停着不开播，礼物留在队里，回落后 memory-guard 调 resumeGreenQueue 接着放
  if (memoryLevel() === 'critical') return
  for (let i = 0; i < poolQueue.length; i++) {
    const item = poolQueue[i]
    const slot = pickSlot(item.preferred, item.overflow)
    if (!slot) continue
    poolQueue.splice(i, 1)
    const opened = openGreenScreen(item.src, item.type, item.text, slot, { ...item.options, replace: true })
    if (!opened.ok) item.options?.onComplete?.(opened.error || '排队视频未能播放')
    if (poolQueue.length) setTimeout(drainPool, 0)
    return
  }
}

/** 「停止视频」：清掉排队、把规则/动作/项目开出来的绿幕素材撤掉（窗口留着，换回绿底）；主播在绿幕页自己播的不动。 */
export function stopCommandGreenScreens(): { ok: boolean; stopped: number } {
  for (const request of poolQueue) request.options?.onComplete?.('视频已停止')
  poolQueue.length = 0
  let stopped = 0
  for (const [slot, source] of [...sources.entries()]) {
    if (source.origin !== 'command') continue
    blankGreenScreen(slot, '视频已停止')
    stopped++
  }
  return { ok: true, stopped }
}

/**
 * 空绿底页（没选素材时的空窗口 / 播完换回的绿底）：写成本地文件，和视频页同目录、同 file:// 来源。
 * ★以前是 data: 页——Chromium 给 data: 页另起一个渲染进程，换绿底那次跳转要 0.45～0.5 秒才提交，
 *   画面就停在视频最后一帧（2026-09-11 用户「播完总卡一小会儿」的根因，探针里每次都换了渲染进程号）；
 *   开空窗口后第一条视频进来也同样多等 0.3 秒。同来源的文件页几十毫秒就换过去。
 */
/** 换成空绿底：常驻播放页清掉素材（同一文档，不导航）；页面还不是播放页就加载它（新页本身就是空绿底）。 */
function loadBlank(win: BrowserWindow, slot: GreenScreenSlot): void {
  if (playerLoaded(win, slot)) { void win.webContents.executeJavaScript('window.__zlBlank&&window.__zlBlank()', true).catch(() => {}); return }
  withPlayer(win, slot, () => { /* 新加载的播放页本来就是空绿底 */ })
}

/** 素材播完 / 到秒数：窗口留着（它是主播开的采集来源），只把素材撤掉、换回纯绿底，排队的接上。 */
export function blankGreenScreen(slotValue: unknown, error?: string): { ok: boolean } {
  const slot = slotOf(slotValue)
  stopWatchdog(slot)
  const timer = closeTimers.get(slot)
  if (timer) clearTimeout(timer)
  closeTimers.delete(slot)
  const win = wins.get(slot)
  if (win && !win.isDestroyed()) {
    generations.set(slot, (generations.get(slot) || 0) + 1)
    sources.get(slot)?.onComplete?.(error)
    sources.delete(slot)
    loadBlank(win, slot)
  }
  setTimeout(drainPool, 50)
  return { ok: true }
}

/** 两条开窗路径（空窗口 / 播素材）共用的监听：素材尺寸报上来就收边、播完换回绿底、关窗清理。
 *  ★以前空窗口那条路只挂了「播完」监听：先开空窗口再让礼物视频流进来（0.3.42 起推荐的流程）就不收边。 */
function attachSlotListeners(win: BrowserWindow, slot: GreenScreenSlot): void {
  const created = win
  wins.set(slot, win)
  // 主播在窗口上右键「关闭」：走绿幕自己的关闭，页面上的开关同步变灰
  setOutputCloseHandler(win, () => { closeGreenScreen(slot) })
  onOutputWindowEvent(win, 'page-title-updated', (_event, title) => {
    if (wins.get(slot) !== created) return
    const size = /^zl-media-size-(\d+)-(\d+)x(\d+)$/.exec(String(title))
    if (size && Number(size[1]) === generations.get(slot)) {
      fitOutputWindowToMedia(created, Number(size[2]), Number(size[3]))
      return
    }
    if (title === `zl-green-ended-${generations.get(slot)}`) blankGreenScreen(slot)
    if (title === `zl-green-error-${generations.get(slot)}`) blankGreenScreen(slot, '视频无法播放，请检查文件格式或重新选择')
    if (title === `zl-green-playing-${generations.get(slot)}`) sources.get(slot)?.onStarted?.(slot)
  })
  // 页面进程崩了（exit-diag 会在同一窗口里自动重载）：正在播的那条礼物视频不能白送，页面回来后从头补播一次
  onOutputPageEvent(win, 'render-process-gone', (_event: unknown, details: { reason?: string } | undefined) => {
    if (!details || details.reason === 'clean-exit' || wins.get(slot) !== created) return
    const current = sources.get(slot)
    if (!current) return
    setTimeout(() => {
      if (wins.get(slot) !== created || sources.get(slot) !== current || created.isDestroyed()) return
      sources.delete(slot)  // 不触发 onComplete：这条还没播完，下面重新开
      console.warn(`[green] 绿幕 ${slot} 页面崩溃后恢复，补播被打断的素材`)
      const r = openGreenScreen(current.src, current.type, current.text, slot, { ...current.options, replace: true, origin: current.origin, requestId: current.requestId, onComplete: current.onComplete, onStarted: current.onStarted })
      if (!r.ok) current.onComplete?.(r.error || '页面崩溃后补播失败')
    }, 1500)
  })
  onOutputWindowClosed(win, () => {
    if (wins.get(slot) !== created) return
    wins.delete(slot)
    sources.get(slot)?.onComplete?.('视频窗口已关闭')
    sources.delete(slot)
    const timer = closeTimers.get(slot)
    if (timer) clearTimeout(timer)
    closeTimers.delete(slot)
  })
}

export function openGreenScreen(
  src: string,
  type: 'video' | 'image',
  text = '',
  slotValue: unknown = 1,
  options?: GreenOpenOptions
): { ok: boolean; error?: string; queued?: boolean; slot?: GreenScreenSlot; stage?: boolean } {
  try {
    // ★空窗口：只铺绿底，给直播伴侣留采集源（以前这里直接报「未选择绿幕素材」，
    //   主播没法把还没配素材的绿幕窗口加进伴侣，那条通道的视频也就永远放不出来）
    if (!String(src || '').trim()) {
      const slot = slotOf(slotValue)
      const generation = (generations.get(slot) || 0) + 1
      generations.set(slot, generation)
      const previousTimer = closeTimers.get(slot)
      if (previousTimer) clearTimeout(previousTimer)
      closeTimers.delete(slot)
      let win = wins.get(slot)
      if (!win || win.isDestroyed()) {
        win = createCaptureOutputWindow({
          ...windowSize(slot, options), title: `绿幕${slot}`,
          x: 80 + (slot - 1) * 60, y: 80 + (slot - 1) * 60,
          frame: false, transparent: false, backgroundColor: GREEN_BACKGROUND,
          alwaysOnTop: outputsAlwaysOnTop(), show: false, resizable: true, skipTaskbar: true,
          webPreferences: { webSecurity: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
        }, false)
        captureTitle(win, `绿幕${slot}`)
        registerOutputWindow(win)
        attachSlotListeners(win, slot)
        loadBlank(win, slot)
        showOutputWindow(win)
      } else {
        sources.get(slot)?.onComplete?.('视频已被其他素材替换')
        sources.delete(slot)
        loadBlank(win, slot)
        showOutputWindow(win)
      }
      // 主播新开了一个空窗口 = 池子多了一个能用的，排队的素材立刻补上去
      setTimeout(drainPool, 50)
      return { ok: true }
    }
    if (!validMedia(src)) return { ok: false, error: '绿幕素材不存在，请重新选择文件' }
    // 「没指定窗口」= 传 0 / 空 / 不传：用设置里的默认播放窗口当最优先窗口
    const auto = slotValue == null || slotValue === '' || Number(slotValue) === 0
    // 抽奖动作里没指定窗口的视频交给转盘窗口自己播，就不再另开一个绿幕窗口了；
    // 主播明确写了「|绿幕N」的照他的意思去那个窗口，不被转盘截走
    if (auto && takeStageVideo(src, type, Math.max(0, Number(options?.maxSeconds) || 0), options?.chroma)) return { ok: true, stage: true }
    let slot = auto ? defaultSlotSetting() : slotOf(slotValue)
    // 排队模型只管礼物规则 / 动作命令 / 奖项 / 项目开出来的素材（origin=command）；
    // 主播自己点播（绿幕页、挂件总控）、时间盲盒、进场视频照旧「现在就播、顶掉正在播的」
    if (options?.origin === 'command' && !options?.replace) {
      // 最优先窗口空着就上；忙了看这一项允不允许去别的窗口；都忙就排队；该去的窗口没开就不播（明说）
      // 内存告急：礼物规则 / 动作命令来的视频只排队不开播（一条不丢），回落后按顺序补播；主播亲手点的、时间盲盒、进场视频不走这里
      const overflow = options?.overflow !== false
      const picked = memoryHold() ? undefined : pickSlot(slot, overflow)
      if (picked) slot = picked
      else {
        const usable = overflow ? GREEN_SLOTS.some((n) => windowOpen(n)) : windowOpen(slot)
        if (!usable) {
          return { ok: false, error: overflow
            ? '没有打开的绿幕窗口，这条视频没播：先在绿幕页打开一个窗口并加进直播伴侣'
            : `绿幕 ${slot} 号窗口没打开，这条视频没播（它只在自己的窗口播）` }
        }
        const limit = poolLimit()
        if (Number.isFinite(limit) && poolQueue.length >= limit) return { ok: false, error: `排队的素材已经有 ${limit} 条（设置页设的上限），这条先不播` }
        poolQueue.push({ src, type, text, preferred: slot, overflow, options })
        return { ok: true, queued: true }
      }
    }
    const generation = (generations.get(slot) || 0) + 1
    generations.set(slot, generation)
    const previousTimer = closeTimers.get(slot)
    if (previousTimer) clearTimeout(previousTimer)
    closeTimers.delete(slot)
    const loop = options?.loop !== false
    let win = wins.get(slot)
    let createdNow = false
    if (!win || win.isDestroyed()) {
      win = createCaptureOutputWindow({
        // 尺寸：调用方给了就用（绿幕页），窗口本来就在就保持，否则用记住的 / 默认
        ...windowSize(slot, options),
        // 直播伴侣按固定窗口标题列出采集源。
        title: `绿幕${slot}`,
        // 四个窗口错开一点，别叠成一摞看不出开了几个
        x: 80 + (slot - 1) * 60,
        y: 80 + (slot - 1) * 60,
        frame: false,
        transparent: false,
        backgroundColor: GREEN_BACKGROUND,
        alwaysOnTop: outputsAlwaysOnTop(),
        show: false,
        resizable: true,
        skipTaskbar: true,
        webPreferences: { webSecurity: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
      }, false)
      captureTitle(win, `绿幕${slot}`)
      registerOutputWindow(win)
      createdNow = true
      attachSlotListeners(win, slot)
    }
    const current = win
    sources.get(slot)?.onComplete?.('视频已被其他素材替换')
    sources.set(slot, { src, type, text, origin: options?.origin, requestId: options?.requestId, onComplete: options?.onComplete, onStarted: options?.onStarted, options })
    // 内置绿幕抠图：这个素材带绿背景时，把绿扣成透明（常驻页每次播放都重新设一次，不带绿的就关掉）
    const chroma = options?.chroma === true && type === 'video'
    withPlayer(current, slot, () => {
      if (wins.get(slot) !== current || generations.get(slot) !== generation || current.isDestroyed()) return
      void current.webContents
        // 播瘦身副本（有就用，没有先播原片并后台压制）；sources 里记的仍是原路径，时间盲盒 / 状态对比都按原路径
        .executeJavaScript(`window.__zlPlay(${JSON.stringify({ type, src: mediaUrl(type === 'video' ? optimizedMedia(src) : src), text, loop, generation })})`, true)
        .then(() => { if (wins.get(slot) === current && generations.get(slot) === generation && !current.isDestroyed()) applyChromaKey(current, chroma) })
        .catch(() => {})
    })
    if (type === 'video' && options?.loop !== true) startWatchdog(slot, current, generation)
    // 首次展示不抢焦点；换素材只更新内容，保留用户当前的前后层级和最小化状态。
    if (createdNow) showOutputWindow(win)
    const maxSeconds = Math.max(0, Number(options?.maxSeconds) || 0)
    if (maxSeconds > 0) {
      const timer = setTimeout(() => {
        if (generations.get(slot) === generation && wins.get(slot) === current && !current.isDestroyed()) blankGreenScreen(slot)
      }, maxSeconds * 1000)
      closeTimers.set(slot, timer)
    }
    return { ok: true, slot }
  } catch (e) {
    return { ok: false, error: '打开绿幕失败：' + (e as Error).message }
  }
}

// 主播关窗口（不传 slot = 全关）：窗口真关掉（开着「留着采集来源」时留一块绿底）。
// clearQueue：主播亲手点的关闭，排队的素材也一起清掉（不然 50 毫秒后下一条又冒出来）
export function closeGreenScreen(slotValue?: unknown, extra?: { clearQueue?: boolean }): { ok: boolean } {
  if (extra?.clearQueue) {
    for (const request of poolQueue) request.options?.onComplete?.('视频队列已清空')
    poolQueue.length = 0
  }
  const targets = slotValue == null ? [...wins.keys()] : [slotOf(slotValue)]
  for (const slot of targets) {
    stopWatchdog(slot)
    const timer = closeTimers.get(slot)
    if (timer) clearTimeout(timer)
    closeTimers.delete(slot)
    const win = wins.get(slot)
    wins.delete(slot)
    sources.get(slot)?.onComplete?.('视频窗口已关闭')
    sources.delete(slot)
    try { win?.close() } catch { /* ignore */ }
  }
  // 有窗口空出来：排队的素材立刻补上
  setTimeout(drainPool, 50)
  return { ok: true }
}

/** 等待本次请求完成，覆盖排队、播放和取消；同一文件在别处播放不会干扰。 */
export function playGreenScreenAndWait(src: string, slot: unknown, options: GreenOpenOptions = {}, isCurrent?: () => boolean): Promise<{ ok: boolean; error?: string; slot?: GreenScreenSlot }> {
  return awaitGreenScreenRequest(src, slot, options, isCurrent, false)
}

export function startQueuedGreenVideo(src: string, slot: unknown, options: GreenOpenOptions = {}, isCurrent?: () => boolean): Promise<{ ok: boolean; error?: string; slot?: GreenScreenSlot }> {
  return awaitGreenScreenRequest(src, slot, options, isCurrent, true)
}

async function awaitGreenScreenRequest(src: string, slot: unknown, options: GreenOpenOptions, isCurrent: (() => boolean) | undefined, waitForStart: boolean): Promise<{ ok: boolean; error?: string; slot?: GreenScreenSlot }> {
  const requestId = randomUUID()
  let settled = false
  let error: string | undefined
  // 真正播在哪个窗口：直接落地时 openGreenScreen 就给了；排队的要等 drainPool 挑到窗口、渲染层报「开始播」才知道
  let landed: GreenScreenSlot | undefined
  const finish = (reason?: string) => { if (!settled) { settled = true; error = reason } }
  const opened = openGreenScreen(src, 'video', '', slot, {
    ...options, requestId, onComplete: finish,
    onStarted: waitForStart ? (n) => { landed = n; finish() } : (n) => { landed = n }
  })
  if (!opened.ok) return opened
  if (opened.slot) landed = opened.slot
  if (opened.stage) {
    if (waitForStart) return { ok: true }
    const completion = stageVideoCompletion()
    if (!completion) return { ok: false, error: '转盘视频未提供完成通知' }
    void completion.then(() => finish(), () => finish('转盘视频播放失败'))
  }
  const started = Date.now()
  while (!settled) {
    if ((isCurrent && !isCurrent()) || Date.now() - started > 600_000) {
      const reason = isCurrent && !isCurrent() ? '事件已取消' : '视频播放超时，已停止等待'
      const queued = poolQueue.findIndex(item => item.options?.requestId === requestId)
      if (queued >= 0) poolQueue.splice(queued, 1)
      for (const [n, source] of sources) if (source.requestId === requestId) blankGreenScreen(n, reason)
      finish(reason)
      break
    }
    await new Promise<void>(resolve => setTimeout(resolve, 40))
  }
  return error ? { ok: false, error } : { ok: true, slot: landed }
}

// 内部组合事件只取当前槽位实例；关闭中的旧窗口可能仍有同名标题，不能靠标题查找。
export function greenScreenWindow(slotValue: unknown): BrowserWindow | null {
  const win = wins.get(slotOf(slotValue))
  return win && !win.isDestroyed() ? win : null
}

export function greenScreenState(): GreenScreenState {
  const slots = GREEN_SLOTS.map((slot) => {
    const win = wins.get(slot)
    const open = !!win && !win.isDestroyed()
    const source = sources.get(slot)
    return { slot, open, src: open ? source?.src || '' : '', type: open ? source?.type || 'video' : 'video', text: open ? source?.text || '' : '' }
  })
  const watchdog = Object.fromEntries([...watchState.entries()].map(([slot, w]) => [String(slot), w]))
  return { open: slots.some((s) => s.open), slots, queued: poolQueue.length, rescued, nudged, watchdog }
}

app.on('before-quit', () => {
  closeGreenScreen()
})
