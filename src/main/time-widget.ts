import { captureTitle } from './capture-output'
import { onScreenPosition } from './window-bounds'
import { createCaptureOutputWindow, hideCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, onOutputWindowEvent, onceOutputPageEvent, showOutputWindow, captureWindowExists } from './output-window'
// 时间插件：原版窗口 EX1 的倒计时挂件。
// 计时状态放在主进程，设置页切换、礼物日志页面卸载都不会中断倒计时。
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { pathToFileURL } from 'url'
import type { CountdownOp, TimeGiftOp, TimeWidgetConfig, TimeWidgetGift, TimeWidgetState, TimeBlindBoxEvent, TimeBlindBoxResult, TimeGiftLogEntry, GreenScreenSlot } from '@shared/types'
import { normalizeTimeBlindBoxEvents, resolveTimeBlindBoxPool, pickTimeBlindBoxValue, applyTimeBlindBoxValue } from '../shared/timeBlindBox'
import { COUNTDOWN_ART } from '../shared/countdownArt'
import { COUNTDOWN_DECORATION_CSS, COUNTDOWN_THEMES, DEFAULT_COUNTDOWN_THEME, FRAME_H, FRAME_LAYOUT, FRAME_W, frameDataUri } from '../shared/countdownFrame'
import { countdownFormatSource } from '../shared/countdownTime'
import { drawPetTimeText } from '../shared/petTimeText'
import { PET_COUNTDOWN_CSS, PET_FRAME_W, petSkin, petWidgetMetrics, petWidgetMetricsSource, petSkinVariables, petLayoutVariables, petDisplayTime, petGiftText, petFontCss, petMascotHtml, petCharmHtml } from '../shared/countdownPets'
import { listGiftImages, sendKeys, createManagedEntertainmentSound, type ManagedEntertainmentSound } from './entertainment'
import { giftNamesEqual, normalizeGiftName } from './connector-events'
import { openGreenScreen, blankGreenScreen, greenScreenState, greenScreenWindow, pickSlotNow } from './green-screen'
import { readJson, writeJson } from './db'
import { compactTimeLogHtml, timeLogMetrics } from './time-log-view'
import { TIME_TICKER_CSS, TIME_TICKER_SCRIPT } from './time-ticker-view'
import { emojiPageScript } from './emoji-assets'

let win: BrowserWindow | null = null
let config: TimeWidgetConfig | null = null
let remaining = 0
let zeroed = false
let running = false
let pausedUntil = 0
let clock: ReturnType<typeof setInterval> | null = null
let lastTickAt = 0
let elapsedCarryMs = 0
const observedGiftImages = new Map<string, string>()

// 送时间记录：谁送的什么礼物、时间怎么变的（设置页和「抽时间记录」窗口都读它，最多留 300 条）。
// 落盘到 data/time-gift-log.json：直播中途重开客户端，记录窗口里今天的名单不能清零。
export type { TimeGiftLogEntry } from '@shared/types'
const giftLog: TimeGiftLogEntry[] = []
const LOG_STORE = 'time-gift-log'
const LOG_LIMIT = 300
const LOG_KEEP_MS = 2 * 24 * 3600 * 1000
let logLoaded = false
let logSaveTimer: ReturnType<typeof setTimeout> | undefined
function ensureLogLoaded(): void {
  if (logLoaded) return
  logLoaded = true
  try {
    const saved = readJson<unknown>(LOG_STORE, null)
    if (!Array.isArray(saved)) return
    const cutoff = Date.now() - LOG_KEEP_MS
    for (const raw of saved) {
      const item = raw as Partial<TimeGiftLogEntry> | null
      if (!item || typeof item !== 'object' || typeof item.ts !== 'number' || item.ts < cutoff) continue
      giftLog.push({
        ts: item.ts, name: String(item.name ?? ''), sender: String(item.sender ?? ''), delta: Number(item.delta) || 0,
        remaining: Number(item.remaining) || 0, source: item.source === 'test' ? 'test' : 'live',
        eventName: item.eventName ? String(item.eventName) : undefined, error: item.error ? String(item.error) : undefined,
        avatar: item.avatar ? String(item.avatar) : undefined
      })
    }
    giftLog.sort((a, b) => b.ts - a.ts)
    giftLog.splice(LOG_LIMIT)
  } catch { /* 存档坏了就从空开始 */ }
}
function persistLog(): void {
  clearTimeout(logSaveTimer)
  logSaveTimer = setTimeout(() => {
    try { writeJson(LOG_STORE, giftLog.slice(0, LOG_LIMIT)) } catch { /* 落盘失败不影响使用 */ }
  }, 800)
  logSaveTimer.unref?.()
}

type TimeBoxReply = { ok: boolean; error?: string; queued?: number }
type BoxBatch = { pool: TimeBlindBoxEvent[]; count: number; gift: string; sender: string; image: string; avatar: string; source: 'live' | 'test' }
type BoxJob = Omit<BoxBatch, 'pool' | 'count'> & { id: string; event: TimeBlindBoxEvent; epoch: number; result: TimeBlindBoxResult; sound?: ManagedEntertainmentSound; applied?: boolean; controller: AbortController }
type BoxVideo = { win: BrowserWindow; slot: GreenScreenSlot; token: string; src: string; text: string; loaded: boolean; replaced: boolean; navigation: (...args: unknown[]) => void }
const boxQueue: BoxBatch[] = []
let activeBox: BoxJob | undefined
let boxEpoch = 0
let lastBoxResult: TimeBlindBoxResult | undefined
let boxVideo: BoxVideo | undefined
let boxAction: (event: TimeBlindBoxEvent, isCurrent: () => boolean, checkOnly: boolean) => Promise<TimeBoxReply> = async event =>
  !event.action || event.action === 'none' ? { ok: true } : { ok: false, error: '附加事件未连接' }

export function setTimeBlindBoxActionHandler(handler: typeof boxAction): void { boxAction = handler }
const queuedTimeBoxes = () => boxQueue.reduce((sum, batch) => sum + batch.count, 0)
const currentBox = (job: BoxJob) => activeBox === job && job.epoch === boxEpoch && !!config?.enable && !!pageWindow()
const delayBox = () => new Promise<void>(resolve => setTimeout(resolve, 40))
function checkBox(job: BoxJob): void { if (!currentBox(job)) throw new Error('盲盒已取消') }
function awaitBox<T>(job: BoxJob, work: Promise<T>, label: string, timeout = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const signal = job.controller.signal
    const cancel = () => finish(undefined, new Error('盲盒已取消'))
    let settled = false
    const finish = (value?: T, error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve(value as T)
    }
    const timer = setTimeout(() => finish(undefined, new Error(`${label}超时`)), timeout)
    signal.addEventListener('abort', cancel, { once: true })
    // 即使已经取消，也接住原 Promise 之后的拒绝，避免迟到的媒体错误成为未处理异常。
    work.then(value => finish(value), error => finish(undefined, error instanceof Error ? error : new Error(String(error))))
    if (signal.aborted) cancel()
  })
}
function pushGiftLog(entry: TimeGiftLogEntry): void {
  ensureLogLoaded()
  giftLog.unshift(entry)
  if (giftLog.length > LOG_LIMIT) giftLog.pop()
  persistLog()
  // 记录窗口开着就顺手刷新（它自己也有 1 秒轮询兜底）
  if (logWin && !logWin.isDestroyed()) pushTimeLog()
}

/** 头像晚到（连接器下载完才打「头像:」行）：把队列里 / 正在跑的 / 已进记录 / 已上滚动条的同一昵称都补上头像 */
// 插件页是 file:// 页面：连接器给的头像是本地路径，得转成 file:/// 才能当 <img src>（和进场横幅同一处理；以前裸路径塞进去从来没显示过）
function mediaSrc(value?: string): string {
  const source = String(value || '').trim()
  if (!source || /^(?:https?|data|file):/i.test(source)) return source
  return 'file:///' + source.replace(/\\/g, '/')
}

export function setTimeWidgetAvatar(nick: string, avatar: string): void {
  const who = String(nick || '').trim()
  const src = String(avatar || '').trim()
  if (!who || !src) return
  for (const batch of boxQueue) if (batch.sender === who && !batch.avatar) batch.avatar = src
  if (activeBox && activeBox.sender === who && !activeBox.avatar) activeBox.avatar = src
  ensureLogLoaded()
  let changed = false
  for (const entry of giftLog) if (entry.sender === who && !entry.avatar) { entry.avatar = src; changed = true }
  if (changed) {
    persistLog()
    if (logWin && !logWin.isDestroyed()) pushTimeLog()
  }
  const target = pageWindow()
  if (target && config?.giftTicker) void target.webContents.executeJavaScript(`window.__tickerAvatar&&window.__tickerAvatar(${JSON.stringify(who)},${JSON.stringify(mediaSrc(src))})`).catch(() => {})
}

/** 送礼滚动条：把「谁 + 头像 + 礼物 + 时间变化」推给挂件页面（开关关着就什么都不做）。 */
function pushTicker(name: string, avatar: string, delta: number, gift = ''): void {
  const target = pageWindow()
  if (!target || !config?.giftTicker) return
  const payload = JSON.stringify({ name: String(name || ''), avatar: mediaSrc(avatar), delta: Math.round(Number(delta) || 0), gift: String(gift || '') })
  void target.webContents.executeJavaScript(`window.__ticker&&window.__ticker(${payload})`).catch(() => {})
}
// ★槽位必须跟着这一轮实际播的窗口走：以前写死 4 号，改成「盲盒视频播到哪个窗口」之后
//   选了 1~3 号的存档会一律判成「已被其他素材替换」，整轮盲盒报错、时间记成 0、视频还一直循环。
function ownsVideo(video: BoxVideo): boolean {
  const slot = greenScreenState().slots.find(row => row.slot === video.slot)
  return !video.replaced && !video.win.isDestroyed() && !!slot?.open && slot.src === video.src && slot.text === video.text
}
function releaseBoxVideo(close: boolean): void {
  const video = boxVideo
  if (!video) return
  boxVideo = undefined
  if (!video.win.isDestroyed()) video.win.webContents.removeListener('did-start-navigation', video.navigation)
  // 播完/取消：素材撤掉、窗口留着换回绿底（窗口是主播开的采集来源，不能跟着视频一起没了）
  if (close && ownsVideo(video)) blankGreenScreen(video.slot)
}

// 一批连击持有奖池快照；每份礼物出队时抽一项，避免大量连击同步创建成千上万个窗口/任务。
function enqueueTimeBox(pool: TimeBlindBoxEvent[], count: number, gift: string, sender: string, image: string, source: 'live' | 'test', avatar = ''): TimeBoxReply {
  if (!Number.isSafeInteger(queuedTimeBoxes() + count)) return { ok: false, error: '待执行礼物数量过大' }
  boxQueue.push({ pool: pool.map(event => ({ ...event })), count, gift, sender, image, avatar, source })
  void pumpTimeBoxes()
  return { ok: true, queued: queuedTimeBoxes() }
}

/** 时间插件的「指定播放窗口」：盲盒视频、礼物栏里配的视频都播到这一个绿幕（默认 4 号，避免覆盖主播自己配的 1～3）。 */
function boxSlot(): GreenScreenSlot {
  return ([1, 2, 3, 4].includes(Number(config?.boxVideoSlot)) ? Number(config?.boxVideoSlot) : 4) as GreenScreenSlot
}

/** 盲盒视频这一轮播到哪个窗口：指定窗口最优先；开着「本窗口忙时去别的窗口」就可以去别的开着的绿幕；一个都没开回 undefined */
function boxVideoTarget(): GreenScreenSlot | undefined {
  return pickSlotNow(boxSlot(), config?.boxVideoOverflow !== false)
}

async function prepareBoxVideo(job: BoxJob, slot: GreenScreenSlot): Promise<BoxVideo> {
  // 播到 boxVideoTarget 挑出来的绿幕窗口。用现有输出，同槽换片不重建窗口。由本队列接管本片结束，避免播完时先关闭 HWND。
  // ★上一轮盲盒视频如果在别的窗口（去别的窗口播过），先把那边撤掉换回绿底：不然那块素材永远挂着、
  //   窗口一直算「忙」，排队的礼物视频再也进不去（2026-09-11 压测「四个都开」复现）
  if (boxVideo && boxVideo.slot !== slot) releaseBoxVideo(true)
  // 盲盒自己排队、自己接管播放：直接顶掉这个窗口正在播的（replace），不走排队模型
  const opened = openGreenScreen(job.event.video!, 'video', job.event.name, slot, { loop: true, replace: true })
  if (!opened.ok) throw new Error(opened.error || '视频打开失败')
  releaseBoxVideo(false)
  const target = greenScreenWindow(slot)
  if (!target) throw new Error('绿幕视频窗口未创建')
  const video: BoxVideo = { win: target, slot, token: job.id, src: job.event.video!, text: job.event.name, loaded: false, replaced: false, navigation: () => { if (video.loaded) video.replaced = true } }
  boxVideo = video
  target.webContents.on('did-start-navigation', video.navigation)
  const until = Date.now() + 10_000
  // 0.3.60 起绿幕是常驻播放页 green-player-N.html（换片不导航），老的 green-N.html 也认
  const playerUrl = new RegExp(`/green-(?:player-)?${slot}\\.html$`)
  while (target.webContents.isLoadingMainFrame() || !playerUrl.test(target.webContents.getURL())) {
    checkBox(job)
    if (!ownsVideo(video)) throw new Error(`${slot} 号绿幕已被其他素材替换`)
    if (Date.now() > until) throw new Error('视频页面加载超时')
    await delayBox()
  }
  checkBox(job)
  const ready = await awaitBox(job, target.webContents.executeJavaScript(`(async()=>{
    const v=document.getElementById('v');if(!v)return {ok:false,error:'视频播放器未就绪'};
    v.pause();v.loop=false;v.currentTime=0;
    const e=window.__timeBlindBoxMedia={id:${pageJson(job.id)},status:'loading',error:'',video:v};
    v.addEventListener('ended',()=>{e.status='ended'},{once:true});
    v.addEventListener('error',()=>{e.status='error';e.error='视频无法播放，请检查文件格式或重新选择'},{once:true});
    if(v.error)return {ok:false,error:'视频无法解码，请重新选择文件'};
    if(v.readyState>=2){e.status='ready';return {ok:true}}
    return await new Promise(resolve=>{let done=false;const finish=(ok,error)=>{if(done)return;done=true;clearTimeout(timer);if(ok)e.status='ready';resolve({ok,error})};
      const timer=setTimeout(()=>finish(false,'视频加载超时'),10000);
      v.addEventListener('canplay',()=>finish(true),{once:true});v.addEventListener('error',()=>finish(false,e.error),{once:true});
    });
  })()`), '视频加载')
  if (!ready?.ok) throw new Error(ready?.error || '视频加载失败')
  checkBox(job)
  if (!ownsVideo(video)) throw new Error(`${slot} 号绿幕已被其他素材替换`)
  video.loaded = true
  return video
}

async function startBoxVideo(video: BoxVideo): Promise<void> {
  const started = await video.win.webContents.executeJavaScript(`(async()=>{const e=window.__timeBlindBoxMedia;if(e?.id!==${pageJson(video.token)})return {ok:false,error:'视频已被替换'};try{await e.video.play();e.status='playing';return {ok:true}}catch(error){return {ok:false,error:'视频播放失败：'+error.message}}})()`)
  if (!started?.ok) throw new Error(started?.error || '视频播放失败')
}

async function waitBoxMedia(job: BoxJob, video?: BoxVideo): Promise<void> {
  let videoDone = !video, soundDone = !job.sound
  let videoProgressAt = Date.now(), soundProgressAt = Date.now(), lastVideoTime = -1, lastSoundTime = -1
  while (!videoDone || !soundDone) {
    checkBox(job)
    if (video && !videoDone) {
      if (!ownsVideo(video)) throw new Error('视频已关闭或被其他素材替换')
      const state = await awaitBox(job, video.win.webContents.executeJavaScript(`(()=>{const e=window.__timeBlindBoxMedia;return e?.id===${pageJson(video.token)}?{status:e.status,currentTime:e.video.currentTime,error:e.error}:null})()`), '读取视频状态', 5000)
      if (!state) throw new Error('视频已被其他素材替换')
      if (state.status === 'error') throw new Error(state.error || '视频播放失败')
      if (state.currentTime > lastVideoTime) { lastVideoTime = state.currentTime; videoProgressAt = Date.now() }
      videoDone = state.status === 'ended'
      if (!videoDone && job.event.videoSeconds && state.currentTime >= job.event.videoSeconds) {
        await awaitBox(job, video.win.webContents.executeJavaScript(`(()=>{const e=window.__timeBlindBoxMedia;if(e?.id===${pageJson(video.token)}){e.video.pause();e.status='ended'}})()`), '停止视频', 5000)
        videoDone = true
      }
    }
    if (job.sound && !soundDone) {
      const state = await awaitBox(job, job.sound.state(), '读取音效状态', 5000)
      if (state.status === 'error') throw new Error(state.error || '音效播放失败')
      if (state.currentTime > lastSoundTime) { lastSoundTime = state.currentTime; soundProgressAt = Date.now() }
      soundDone = state.status === 'ended'
    }
    // 只判无进度，不截断正常播放的长视频/音效；0 秒始终表示自然播完。
    if ((!videoDone && Date.now() - videoProgressAt > 30_000) || (!soundDone && Date.now() - soundProgressAt > 30_000)) throw new Error('素材已停止推进，请检查文件后重试')
    if (!videoDone || !soundDone) await delayBox()
  }
}

async function pumpTimeBoxes(): Promise<void> {
  if (activeBox || !boxQueue.length || !pageWindow() || !config?.enable) return
  const batch = boxQueue[0]
  const event = { ...batch.pool[Math.floor(Math.random() * batch.pool.length)] }
  batch.count--
  if (!batch.count) boxQueue.shift()
  const id = randomUUID()
  const job: BoxJob = { id, event, gift: batch.gift, sender: batch.sender, image: batch.image, avatar: batch.avatar, source: batch.source, epoch: boxEpoch, controller: new AbortController(),
    result: { id, eventId: event.id, eventName: event.name, giftName: batch.gift, sender: batch.sender, source: batch.source, phase: 'running', op: event.op, value: event.value, before: remaining, after: remaining, ts: Date.now() } }
  activeBox = job
  lastBoxResult = { ...job.result }
  let video: BoxVideo | undefined
  try {
    job.result.value = pickTimeBlindBoxValue(event)
    // 运算、附加事件和素材先检查；文件失效不应悄悄扣掉时间。
    applyTimeBlindBoxValue(remaining, event, job.result.value, config.showNegative)
    const checked = await awaitBox(job, boxAction(event, () => currentBox(job), true), '附加事件检查')
    if (!checked.ok) throw new Error(checked.error || '附加事件检查失败')
    checkBox(job)
    if (event.sound) {
      job.sound = createManagedEntertainmentSound(pageWindow()!, event.sound, event.soundVolume ?? 100, id)
      await awaitBox(job, job.sound.ready(), '音效加载')
    }
    checkBox(job)
    // 开哪个才有哪个：指定播放窗口没开、也去不了别的窗口，就不播视频（伴侣里本来也没这个来源），时间照加、记录里写明
    const target = event.video ? boxVideoTarget() : undefined
    if (event.video && !target) {
      releaseBoxVideo(true)
      job.result.error = config?.boxVideoOverflow !== false
        ? `绿幕 ${boxSlot()} 号窗口没打开，也没有别的绿幕窗口开着，视频没播（时间已按事件结算）`
        : `绿幕 ${boxSlot()} 号窗口没打开，视频没播（它只在自己的窗口播；时间已按事件结算）`
    } else if (event.video && target) video = await prepareBoxVideo(job, target)
    else releaseBoxVideo(true)
    checkBox(job)
    // 加载期间时钟仍正常运行，结算采用真正开始播放这一刻的当前时间。
    applyTimeBlindBoxValue(remaining, event, job.result.value, config!.showNegative)
    await awaitBox(job, Promise.all([video ? startBoxVideo(video) : Promise.resolve(), job.sound?.start()]), '素材播放')
    checkBox(job)
    job.result.before = remaining
    // 媒体启动 Promise 可能跨时钟周期，最终结算再次读取当前值。
    setRemaining(applyTimeBlindBoxValue(remaining, event, job.result.value, config!.showNegative), { name: job.gift, image: job.image })
    job.result.after = remaining
    job.applied = true
    lastBoxResult = { ...job.result }
    pushTicker(job.sender, job.avatar || '', job.result.after - job.result.before, job.gift)
    const acted = await awaitBox(job, boxAction(event, () => currentBox(job), false), '附加事件执行')
    if (!acted.ok) throw new Error(acted.error || '附加事件执行失败')
    await waitBoxMedia(job, video)
    checkBox(job)
    job.result.phase = 'completed'
  } catch (error) {
    if (currentBox(job)) {
      if (!job.applied) job.result.before = job.result.after = remaining
      job.result.phase = 'error'; job.result.error = (error as Error).message
    }
  } finally {
    // Electron 建窗/加载期间也可能收到取消 IPC；晚于取消建立的资源仍按本任务 token 清理。
    if (job.epoch !== boxEpoch && boxVideo?.token === job.id) releaseBoxVideo(true)
    await job.sound?.stop()
    if (job.epoch === boxEpoch) {
      lastBoxResult = { ...job.result }
      pushGiftLog({ ts: job.result.ts, name: job.gift, sender: job.sender, source: job.source, avatar: job.avatar,
        delta: job.result.after - job.result.before, remaining: job.result.after, eventName: event.name, error: job.result.error })
      if (job.result.phase === 'error' || !boxQueue.length) releaseBoxVideo(true)
    }
    if (activeBox === job) activeBox = undefined
    // 一次无素材事件也让出事件循环，连击不会堵住计时和界面 IPC。
    if (boxQueue.length) setTimeout(() => { void pumpTimeBoxes() }, 0)
  }
}

export function timeWidgetTestEvent(id: string): TimeBoxReply {
  if (!pageWindow()) return { ok: false, error: '先开启倒计时挂件' }
  if (!config?.enable) return { ok: false, error: '倒计时功能已关闭，请先开启' }
  const pool = resolveTimeBlindBoxPool(config.blindBoxEvents || [], [String(id || '')])
  if (!pool.ok) return { ok: false, error: pool.error }
  return enqueueTimeBox(pool.events!, 1, '事件测试', '测试', '', 'test')
}

/**
 * 从外部开一次盲盒（礼物规则的「开时间盲盒」动作命令、转盘/九宫格奖项都走这里）。
 * 2026-09-07 之前时间盲盒只认它自己那份礼物表，别处一概触发不了它。
 * @param nameOrId 盲盒事件名或 id；留空 = 从全部启用的事件里随机抽
 */
export function timeWidgetOpenBox(nameOrId = ''): TimeBoxReply {
  if (!pageWindow()) return { ok: false, error: '先开启倒计时挂件' }
  if (!config?.enable) return { ok: false, error: '倒计时功能已关闭，请先开启' }
  const all = config.blindBoxEvents || []
  const want = String(nameOrId || '').trim()
  // 名字和 id 都认：主播在规则里填的多半是他自己起的事件名
  // ★留空 = 从全部启用的事件里抽。以前这里传 undefined，resolveTimeBlindBoxPool
  //   一律回「盲盒奖池为空」，所以「开时间盲盒」不填名字从来没抽成过。
  const ids = want
    ? all.filter((e) => e.id === want || String(e.name || '').trim() === want).map((e) => e.id)
    : all.filter((e) => e.enabled !== false).map((e) => e.id)
  if (want && !ids.length) return { ok: false, error: `没有找到盲盒事件「${want}」` }
  if (!ids.length) return { ok: false, error: '事件库里没有启用的盲盒事件' }
  const pool = resolveTimeBlindBoxPool(all, ids, { skipDisabled: true })
  if (!pool.ok) return { ok: false, error: pool.error }
  return enqueueTimeBox(pool.events!, 1, want || '盲盒', '触发', '', 'test')
}

export function timeWidgetCancelQueue(): { ok: boolean; cancelled: number } {
  const cancelled = queuedTimeBoxes() + (activeBox && activeBox.epoch === boxEpoch ? 1 : 0)
  boxQueue.length = 0
  const job = activeBox
  boxEpoch++
  // 停止后立即允许新事件入队执行；旧任务的迟到回调只持有旧 token/epoch。
  activeBox = undefined
  job?.controller.abort()
  if (job && job.result.phase === 'running') {
    job.result.phase = 'cancelled'
    job.result.error = '已取消；已结算的时间不回退'
    lastBoxResult = { ...job.result }
    pushGiftLog({ ts: Date.now(), name: job.gift, sender: job.sender, source: job.source, avatar: job.avatar, delta: job.result.after - job.result.before,
      remaining: job.result.after, eventName: job.event.name, error: job.result.error })
    void job.sound?.stop()
  }
  releaseBoxVideo(true)
  return { ok: true, cancelled }
}

export function timeWidgetLog(): TimeGiftLogEntry[] {
  ensureLogLoaded()
  return [...giftLog]
}

export function timeWidgetLogClear(): { ok: boolean } {
  ensureLogLoaded()
  giftLog.length = 0
  persistLog()
  if (logWin && !logWin.isDestroyed()) pushTimeLog()
  return { ok: true }
}

const DEFAULT_CONFIG: TimeWidgetConfig = {
  on: false,
  enable: true,
  title: '禁言倒计时',
  initial: 300,
  clockSpeed: 1000,
  addGift: '请吃鸡',
  addSeconds: 60,
  subGift: '棒棒糖',
  subSeconds: 30,
  autoHide: false,
  showGift: true,
  showNegative: false,
  showSeconds: false,
  zeroText: '时间到',
  bgImage: '',
  theme: DEFAULT_COUNTDOWN_THEME,
  titleColor: '#ffffff',
  timeColor: '#ffffff',
  boxVideoSlot: 4,
  giftTicker: false,
  startHotkey: { enabled: false, func: '无', key: '' },
  endHotkey: { enabled: false, func: '无', key: '' },
  posX: 200,
  posY: 30
}

// 主题面板：矢量重画（可无限放大不糊），另留三张原版位图当「经典」主题。
type ThemeEntry = { art: string; w: number; h: number; titleSize: number; timeSize: number; color: string }

const THEMES: Record<string, ThemeEntry> = {
  ...Object.fromEntries(
    COUNTDOWN_THEMES.map((theme) => [
      theme.id,
      {
        art: frameDataUri(theme.style),
        w: petSkin(theme.id) ? PET_FRAME_W : FRAME_W,
        h: FRAME_H,
        titleSize: 20,
        timeSize: petSkin(theme.id) ? 64 : 58,
        color: theme.timeColor
      } as ThemeEntry
    ])
  ),
  legacy_cyan: { art: COUNTDOWN_ART.mode1_cyan, w: 252, h: 103, titleSize: 18, timeSize: 58, color: '#ffffff' },
  legacy_orange: { art: COUNTDOWN_ART.mode1_orange, w: 252, h: 103, titleSize: 17, timeSize: 64, color: '#bc0d40' },
  legacy_frame: { art: COUNTDOWN_ART.mode2_frame, w: 716, h: 294, titleSize: 17, timeSize: 64, color: '#ffffff' }
}

function numberOr(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) ? value : fallback
}

function normalizeColor(input: unknown, fallback: string): string {
  const value = String(input ?? '').trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function normalize(value: Partial<TimeWidgetConfig>): TimeWidgetConfig {
  const hotkey = (item: Partial<TimeWidgetConfig['startHotkey']> | undefined) => ({
    enabled: !!item?.enabled,
    func: ['无', 'Alt', 'Ctrl', 'Ctrl+Alt', 'Shift'].includes(String(item?.func)) ? String(item?.func) : '无',
    key: String(item?.key || '').trim()
  })
  return {
    ...DEFAULT_CONFIG,
    ...value,
    on: !!value.on,
    enable: value.enable !== false,
    title: String(value.title ?? DEFAULT_CONFIG.title),
    initial: Math.trunc(numberOr(value.initial, DEFAULT_CONFIG.initial)),
    clockSpeed: Math.max(50, Math.trunc(numberOr(value.clockSpeed, DEFAULT_CONFIG.clockSpeed))),
    addGift: String(value.addGift ?? DEFAULT_CONFIG.addGift).trim(),
    addSeconds: Math.max(0, numberOr(value.addSeconds, DEFAULT_CONFIG.addSeconds)),
    subGift: String(value.subGift ?? DEFAULT_CONFIG.subGift).trim(),
    subSeconds: Math.max(0, numberOr(value.subSeconds, DEFAULT_CONFIG.subSeconds)),
    autoHide: !!value.autoHide,
    showGift: value.showGift !== false,
    showNegative: !!value.showNegative,
    showSeconds: !!value.showSeconds,
    zeroText: String(value.zeroText ?? DEFAULT_CONFIG.zeroText),
    bgImage: String(value.bgImage ?? DEFAULT_CONFIG.bgImage),
    theme: THEMES[String(value.theme)] ? String(value.theme) : DEFAULT_CONFIG.theme,
    titleColor: normalizeColor(value.titleColor, DEFAULT_CONFIG.titleColor),
    timeColor: normalizeColor(value.timeColor, DEFAULT_CONFIG.timeColor),
    startHotkey: hotkey(value.startHotkey),
    endHotkey: hotkey(value.endHotkey),
    // 08-18 之前的存档/调用方只有 加时礼物/减时礼物 两个字段，没有 gifts 数组：
    // 按原样迁成两行礼物栏（加减 +N / 加减 -N），否则老存档一升级礼物栏就空了。
    gifts: Array.isArray(value.gifts)
      ? normalizeGifts(value.gifts)
      : normalizeGifts([
        { name: String(value.addGift ?? DEFAULT_CONFIG.addGift), op: '加减', seconds: Math.abs(numberOr(value.addSeconds, DEFAULT_CONFIG.addSeconds)) },
        { name: String(value.subGift ?? DEFAULT_CONFIG.subGift), op: '加减', seconds: -Math.abs(numberOr(value.subSeconds, DEFAULT_CONFIG.subSeconds)) }
      ].filter((row) => row.name.trim())),
    blindBoxEvents: normalizeTimeBlindBoxEvents(value.blindBoxEvents),
    // 指定播放窗口（1~4 号绿幕，默认 4）；滚动条开关；记录窗口标题/条数
    boxVideoSlot: [1, 2, 3, 4].includes(Number(value.boxVideoSlot)) ? Number(value.boxVideoSlot) : 4,
    giftTicker: value.giftTicker === true,
    boxVideoOverflow: value.boxVideoOverflow !== false,
    logTitle: String(value.logTitle ?? '抽时间记录').trim().slice(0, 40) || '抽时间记录',
    logRows: Math.max(1, Math.min(30, Math.trunc(numberOr(value.logRows, 8)))),
    giftPanel: value.giftPanel !== false,
    giftColumns: [1, 2, 3].includes(Number(value.giftColumns)) ? Number(value.giftColumns) : 2,
    // 1.35/1.6 是两个历史版本的默认宽（礼物栏比时间框宽，用户定版不要超边界）。
    // 存档里撞上这两个值按「没调过」迁移回 1；用户自己调的其他值原样保留。
    giftPanelWidth: (() => {
      const raw = numberOr(value.giftPanelWidth, 1)
      return Math.max(1, Math.min(2.5, raw === 1.35 || raw === 1.6 ? 1 : raw))
    })(),
    giftNameColor: normalizeColor(value.giftNameColor, '#ffffff'),
    addColor: normalizeColor(value.addColor, '#ff9a3c'),
    subColor: normalizeColor(value.subColor, '#3fe0d0'),
    boxColor: normalizeColor(value.boxColor, '#f5c542'),
    cellBg: normalizeColor(value.cellBg, '#242428'),
    cellBorder: normalizeColor(value.cellBorder, '#3a3a40'),
    cellAlpha: Math.max(0, Math.min(1, numberOr(value.cellAlpha, 0.92))),
    petMotion: value.petMotion !== false,
    giftNameSize: Math.max(8, Math.min(40, Math.trunc(numberOr(value.giftNameSize, 16)))),
    giftTextSize: Math.max(8, Math.min(40, Math.trunc(numberOr(value.giftTextSize, 16)))),
    giftIconSize: Math.max(16, Math.min(96, Math.trunc(numberOr(value.giftIconSize, 42)))),
    scale: Math.max(0.4, Math.min(4, numberOr(value.scale, 1))),
    posX: Math.trunc(numberOr(value.posX, DEFAULT_CONFIG.posX)),
    posY: Math.trunc(numberOr(value.posY, DEFAULT_CONFIG.posY))
  }
}

// 时间插件配置在主进程留一份底：开机自动开「抽时间记录」窗口时，皮肤配色立刻就是主播配的那套，
// 不用等打开时间插件页面（0.3.42 时 config 只在内存里，开机恢复的记录窗口一直是默认皮肤）。
// 注意：页面 localStorage 里的配置才是最新版，页面一同步就盖过这份底（ensure 只填空仓）。
const CONFIG_STORE = 'time-widget-config'
let persistedLoaded = false
let persistTimer: ReturnType<typeof setTimeout> | undefined
function ensurePersistedConfig(): void {
  if (persistedLoaded) return
  persistedLoaded = true
  if (config) return
  try {
    const saved = readJson<Partial<TimeWidgetConfig> | null>(CONFIG_STORE, null)
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) config = normalize(saved)
  } catch { /* 存档坏了就用默认 */ }
}
function persistConfig(): void {
  if (!config) return
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try { writeJson(CONFIG_STORE, config) } catch { /* 落盘失败不影响使用 */ }
  }, 400)
  persistTimer.unref?.()
}

// 礼物栏格子数没有上限（0.3.43 用户要求）：配几个显示几个，窗口跟着长高。
// 原版「组合框_计时_增减N」的运算方式（逆向 0x430c55：加减 / 范围 / 清零 / 乘以 / 除以）
const TIME_GIFT_OPS: TimeGiftOp[] = ['加减', '乘以', '除以', '范围', '清零']

// 老存档运算方式迁移：以前的 加/减/盲盒/设为 对齐原版的 加减/范围
function migrateGiftOp(op: unknown): TimeGiftOp {
  const value = String(op ?? '')
  if (value === '盲盒') return '加减'
  if (value === '设为') return '范围'
  if (value === '加') return '加减'
  if (TIME_GIFT_OPS.includes(value as TimeGiftOp)) return value as TimeGiftOp
  return '加减'
}

function normalizeGifts(value: unknown): TimeWidgetGift[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Partial<TimeWidgetGift> => !!item && typeof item === 'object')
    .map((item) => {
      const op = migrateGiftOp(item.op)
      // 老「减」= 负向加减
      const seconds = String(item.op) === '减' ? -Math.abs(Math.trunc(numberOr(item.seconds, 30))) : Math.trunc(numberOr(item.seconds, 30))
      return {
        name: String(item.name ?? '').trim(),
        mode: item.mode === 'blindbox' ? 'blindbox' as const : 'direct' as const,
        blindBoxEventIds: Array.isArray(item.blindBoxEventIds) ? [...new Set(item.blindBoxEventIds.map(String))] : [],
        op,
        seconds,
        seconds2: item.seconds2 == null || item.seconds2 === ('' as unknown) ? null : Math.trunc(numberOr(item.seconds2, 0)),
        text: String(item.text ?? '').trim(),
        img: String(item.img ?? '').trim(),
        video: String(item.video ?? '').trim(),
        // 一次性播放是更安全的默认值；勾选循环后由 videoSeconds 控制限时，0=一直循环。
        videoLoop: item.videoLoop === true,
        videoSeconds: Math.max(0, Math.trunc(numberOr(item.videoSeconds, 0))),
        // 屏幕显示：关掉照样触发，只是不上挂件礼物栏
        showOnPanel: item.showOnPanel !== false
      }
    })
    .filter((item) => !!item.name)
}

// 礼物格下行文字：没填自定义文字就按运算方式自动生成（+30 / -20~50 / ×2~3 / 范围 …）。
export function giftEffectText(gift: TimeWidgetGift): string {
  if (gift.text) return gift.text
  if (gift.mode === 'blindbox') return '盲盒'
  const value = Math.trunc(Number(gift.seconds) || 0)
  const end = gift.seconds2 == null ? null : Math.trunc(Number(gift.seconds2) || 0)
  const signed = (v: number) => (v > 0 ? `+${v}` : String(v))
  const range = end != null && end !== value ? `${signed(value)}~${end}` : signed(value)
  switch (gift.op) {
    case '乘以':
      return `×${end != null && end !== value ? `${value}~${end}` : value}`
    case '除以':
      return `÷${end != null && end !== value ? `${value}~${end}` : value}`
    case '范围':
      return `=${end != null && end !== value ? `${value}~${end}` : value}`
    case '清零':
      return '清零'
    default:
      return range
  }
}

// 效果文字取色：加时/减时/盲盒各一色，全部可调。
function giftEffectColor(gift: TimeWidgetGift, cfg: TimeWidgetConfig): string {
  if (gift.mode === 'blindbox') return cfg.boxColor || '#f5c542'
  if (gift.op === '范围') return cfg.boxColor || '#f5c542'
  if (gift.op === '除以' || gift.op === '清零') return cfg.subColor || '#3fe0d0'
  if (gift.op === '加减') {
    const value = Math.trunc(Number(gift.seconds) || 0)
    if (value < 0) return cfg.subColor || '#3fe0d0'
  }
  return cfg.addColor || '#ff9a3c'
}

function source(value: string): string {
  if (!value) return ''
  if (/^(?:https?:|data:|file:)/i.test(value)) return value
  return pathToFileURL(value).toString()
}

function pageJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function localGiftImages(): Record<string, string> {
  const images: Record<string, string> = {}
  for (const item of listGiftImages()) {
    const key = normalizeGiftName(item.name)
    if (key && !images[key]) images[key] = source(item.path)
  }
  return images
}

function pageConfig(cfg: TimeWidgetConfig): TimeWidgetConfig {
  return { ...cfg, bgImage: source(cfg.bgImage) }
}

function themeFor(cfg: TimeWidgetConfig) {
  return THEMES[cfg.theme as keyof typeof THEMES] || THEMES[DEFAULT_COUNTDOWN_THEME]
}

// 挂件礼物栏的行数/格高/总尺寸：配几个礼物就摆几格，窗口跟着长高。
export function widgetMetrics(cfg: TimeWidgetConfig): {
  w: number; h: number; rows: number; cellH: number; scale: number; panelW: number; headW: number
} {
  if (petSkin(cfg.theme)) return petWidgetMetrics(cfg)
  const theme = THEMES[cfg.theme as keyof typeof THEMES] || THEMES[DEFAULT_COUNTDOWN_THEME]
  // 「屏幕显示」关掉的礼物不占格子（照样触发计时）
  const list = Array.isArray(cfg.gifts) ? cfg.gifts.filter((item) => item?.name && item.showOnPanel !== false) : []
  const columns = [1, 2, 3].includes(Number(cfg.giftColumns)) ? Number(cfg.giftColumns) : 2
  const rows = cfg.giftPanel === false || list.length === 0 ? 0 : Math.ceil(list.length / columns)
  const cellH = Math.max(44, (Number(cfg.giftIconSize) || 40) + 14)
  const scale = Math.max(0.4, Math.min(4, Number(cfg.scale) || 1))
  // 礼物栏比标题条宽（原版就是这个比例），窄了礼物名会被挤成「花开…」。
  const widen = rows ? Math.max(1, Math.min(2.5, Number(cfg.giftPanelWidth) || 1)) : 1
  const panelW = Math.round(theme.w * widen)
  // 礼物栏顶着时间牌长（无缝），只在格子之间留缝
  const height = theme.h - ART_TOP + (rows ? rows * cellH + (rows - 1) * GIFT_GAP : 0) + (cfg.giftTicker ? TICKER_H : 0)
  return {
    w: Math.round(panelW * scale),
    h: Math.round(height * scale),
    rows,
    cellH,
    scale,
    panelW,
    headW: theme.w
  }
}

const GIFT_GAP = 1
// 送礼滚动条高度（开着「送礼滚动条」时窗口在礼物栏下面多出这一条）
const TICKER_H = 30
// 面板美术顶部留的 9px 空档（原图 252×103 里标题牌从 y=9 才开始画）。
// ★窗口必须贴着画面走：留着这 9px，采集软件（直播伴侣的窗口捕获）会把透明区渲染成黑边，
//   绿幕模式下则是一条绿带。0.3.42 起整块舞台往上挪 9px、窗口同步减高，上下都不留透明条。
const ART_TOP = 9

function giftRowsHtml(cfg: TimeWidgetConfig, images: Record<string, string>): string {
  // 「屏幕显示」关掉的礼物不上屏（照样触发计时）
  const list = (Array.isArray(cfg.gifts) ? cfg.gifts : []).filter((item) => item?.name && item.showOnPanel !== false)
  if (cfg.giftPanel === false || list.length === 0) return ''
  const cells = list
    .map((gift, index) => {
      const src = gift.img ? source(gift.img) : images[normalizeGiftName(gift.name)] || ''
      const icon = Number(cfg.giftIconSize) || 40
      return `<div class="gift-cell" data-gift="${index}">
  <div class="gift-icon" style="width:${icon}px;height:${icon}px">${src ? `<img src="${esc(src)}" alt="">` : ''}</div>
  <div class="gift-text">
    <div class="gift-name" style="color:${cfg.giftNameColor || '#fff'};font-size:${cfg.giftNameSize || 15}px">${esc(gift.name)}</div>
    <div class="gift-divider"></div>
    <div class="gift-effect" style="color:${giftEffectColor(gift, cfg)};font-size:${cfg.giftTextSize || 15}px">${esc(giftEffectText(gift))}</div>
  </div>
</div>`
    })
    .join('')
  return `<div id="gift-panel" style="grid-template-columns:repeat(${cfg.giftColumns || 2},1fr);background:${cfg.cellBorder || '#3a3a40'};gap:1px">${cells}</div>`
}

function esc(value: string): string {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
}

// 倒计时面板、标题和礼物格样式；紧凑记录窗口独立排版，颜色由同一份配置传入。
function widgetBaseCss(theme: ThemeEntry, metrics: { scale: number; panelW: number; cellH: number }): string {
  return `html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font-family:"Microsoft YaHei",sans-serif}
#stage{transform-origin:0 0;transform:translateY(${(-ART_TOP * metrics.scale).toFixed(2)}px) scale(${metrics.scale})}
#panel{position:relative;width:${metrics.panelW}px;-webkit-app-region:drag;user-select:none}
#head{position:relative;width:${theme.w}px;height:${theme.h}px;margin:0 auto}
#frame{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
#title{position:absolute;left:18%;right:18%;top:${FRAME_LAYOUT.titleTop}%;height:${FRAME_LAYOUT.titleHeight}%;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#fff;font-weight:700;white-space:nowrap;text-overflow:ellipsis;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000}
#time{position:absolute;left:4%;right:4%;top:${FRAME_LAYOUT.timeTop}%;height:${FRAME_LAYOUT.timeHeight}%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000}
#time[data-zeroed="true"]{top:${FRAME_LAYOUT.zeroTimeTop}%;height:${FRAME_LAYOUT.zeroTimeHeight}%}
#gift-panel,#log-panel{display:grid;gap:${GIFT_GAP}px;margin-top:0;background:#3a3a40}
.gift-cell{display:flex;align-items:center;gap:8px;padding:5px 7px;box-sizing:border-box;min-width:0;height:var(--gift-cell-h,${metrics.cellH}px);background:rgba(36,36,40,.92);border:0}
.gift-cell.hit{animation:cellhit .45s ease-out}
@keyframes cellhit{0%{filter:brightness(1.8)}100%{filter:none}}
.gift-icon{flex:0 0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden}
.gift-icon img{width:100%;height:100%;object-fit:contain}
.gift-text{flex:1 1 auto;min-width:0}
.gift-name,.gift-effect{font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000}
body:is([data-theme="paper"],[data-theme="sakura"],[data-theme="ticket"],[data-theme="glacier"]) :is(#title,#time,.gift-name,.gift-effect,#ticker .tk,.lg-time,.lg-face){text-shadow:none}
.gift-divider{height:1px;background:#d8d8d8;opacity:.75;margin:2px 0}
/* 观众头像的形状跟皮肤走：像素/终端类方角，纸质/仪表类小圆角，其余圆头像 */
body{--avatar-radius:50%}
body:is([data-theme="arcade"],[data-theme="terminal"]){--avatar-radius:0}
body:is([data-theme="paper"],[data-theme="ticket"],[data-theme="graphite"],[data-theme="theatre"]){--avatar-radius:4px}
body:is([data-theme="aurora"],[data-theme="terminal"]) #head::after {content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 40%,rgb(135 221 234 / .12) 50%,transparent 60%);animation:countdown-flow 6s ease-in-out infinite}
@keyframes countdown-flow {0%,10%{transform:translateX(-100%);opacity:0}30%{opacity:1}80%,100%{transform:translateX(100%);opacity:0}}
${COUNTDOWN_DECORATION_CSS}
${petFontCss(pathToFileURL(path.join(__dirname, '../renderer/pet-skins')).href)}
${PET_COUNTDOWN_CSS}`
}

// 倒计时页面里换主题要用到的面板表（美术 / 尺寸 / 字号 / 默认时间色）
function pageThemes() {
  return Object.fromEntries(Object.entries(THEMES).map(([key, value]) => {
    const skin = petSkin(key)
    const atlas = skin ? pathToFileURL(path.join(__dirname, '../renderer/pet-skins', skin.atlas)).href : ''
    const material = skin?.material ? pathToFileURL(path.join(__dirname, '../renderer/pet-skins', skin.material)).href : ''
    const charms=pathToFileURL(path.join(__dirname,'../renderer/pet-skins/charms.png')).href
    return [key, { ...value, pet:skin ? { variables:petSkinVariables(skin),mascot:petMascotHtml(skin,atlas,material),charm:petCharmHtml(skin,charms),material:!!material,menu:skin.menu } : null }]
  }))
}

function page(cfg: TimeWidgetConfig, images: Record<string, string>): string {
  const theme = themeFor(cfg)
  const initialBg = cfg.bgImage ? source(cfg.bgImage) : theme.art
  const themes = pageThemes()
  const pageCfg = pageConfig(cfg)
  const metrics = widgetMetrics(cfg)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${widgetBaseCss(theme, metrics)}
${TIME_TICKER_CSS}
#gift-pop{position:fixed;left:50%;top:8px;transform:translateX(-50%) translateY(-8px) scale(.92);display:flex;align-items:center;gap:8px;max-width:90%;padding:6px 12px;border:1px solid rgba(255,255,255,.35);border-radius:999px;background:rgba(10,10,14,.9);box-shadow:0 4px 18px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .18s,transform .22s;color:#fff;font-size:14px;font-weight:700;z-index:5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gift-pop.on{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}
#gift-pop img{width:28px;height:28px;object-fit:contain}
</style>${emojiPageScript()}</head><body><div id="stage"><div id="panel" class="pet-panel"><div id="pet-art" class="pet-art"></div><div id="pet-surface" class="pet-surface">
<div id="head" class="pet-clock"><img id="frame" src="${pageJson(initialBg).slice(1, -1)}" alt=""><div id="title" class="pet-title"></div><div id="time" class="pet-time"></div></div>
${giftRowsHtml(cfg, images)}
${cfg.giftTicker ? '<div id="ticker"><div id="ticker-track"></div></div>' : ''}
</div><div id="pet-charms"></div>
<div id="gift-pop"></div>
</div></div><script>
var cfg=${pageJson(pageCfg)},images=${pageJson(images)},themes=${pageJson(themes)};
// 文字都走 zlText：昵称 / 礼物名里的 emoji 贴图（emoji-assets 注入），没图就退回纯文字
var zlText=window.__zlText||function(el,t){el.textContent=t;return el};
var ART_TOP=${ART_TOP}, petMetrics=${petWidgetMetricsSource()};
var petLayoutVars=${petLayoutVariables.toString()},petTimeText=${petDisplayTime.toString()},petGiftLabel=${petGiftText.toString()};
var drawPetDigits=${drawPetTimeText.toString()},petTextContext=document.createElement('canvas').getContext('2d');
var stage=document.getElementById('stage'),frame=document.getElementById('frame'),panel=document.getElementById('panel'),head=document.getElementById('head'),titleEl=document.getElementById('title'),timeEl=document.getElementById('time'),giftPop=document.getElementById('gift-pop'),giftPopTimer=0;
function pad(n){return n<10?'0'+n:String(n)}
function giftKey(n){return String(n||'').normalize('NFKC').replace(/\\s+/g,' ').trim().toLocaleLowerCase('zh-CN')}
${countdownFormatSource()}
// 时间文字自适应：字数多了（带天/小时、归零文字）就自动缩号，绝不撑出时间框。
var lastFitKey='';
function fitTime(base,force){if(themes[cfg.theme]?.pet&&petTextContext){drawPetDigits(timeEl,timeEl.textContent,base,petTextContext,!!force);return}var key=timeEl.textContent.replace(/[0-9]/g,'0')+'|'+timeEl.clientWidth+'|'+timeEl.clientHeight+'|'+base;if(key===lastFitKey)return;lastFitKey=key;var size=base;timeEl.style.fontSize=size+'px';var guard=0;
  while((timeEl.scrollWidth>timeEl.clientWidth||timeEl.scrollHeight>timeEl.clientHeight)&&size>10&&guard++<60){size-=1;timeEl.style.fontSize=size+'px'}}
// 一行文字装不下就慢慢缩号（礼物名/效果文字共用）；缩到下限还装不下才由 CSS 省略号兜底。
function fitRow(el,base,min){var size=base;el.style.fontSize=size+'px';var guard=0;
  while(el.scrollWidth>el.clientWidth&&size>min&&guard++<40){size-=1;el.style.fontSize=size+'px'}}
function effectText(g){if(g.text)return g.text;if(g.mode==='blindbox')return '盲盒';var v=Math.trunc(Number(g.seconds)||0);
  var end=g.seconds2==null?null:Math.trunc(Number(g.seconds2)||0);
  var signed=function(x){return x>0?'+'+x:String(x)};
  var range=(end!=null&&end!==v)?signed(v)+'~'+end:signed(v);
  if(g.op==='乘以')return '×'+(end!=null&&end!==v?v+'~'+end:v);
  if(g.op==='除以')return '÷'+(end!=null&&end!==v?v+'~'+end:v);
  if(g.op==='范围')return '='+(end!=null&&end!==v?v+'~'+end:v);
  if(g.op==='清零')return '清零';return range}
function effectColor(g){if(g.mode==='blindbox'||g.op==='范围')return cfg.boxColor||'#f5c542';
  if(g.op==='除以'||g.op==='清零')return cfg.subColor||'#3fe0d0';
  if(g.op==='加减'&&Math.trunc(Number(g.seconds)||0)<0)return cfg.subColor||'#3fe0d0';return cfg.addColor||'#ff9a3c'}
function rgba(hex,alpha){var h=String(hex||'#242428').replace('#','');var n=parseInt(h.length===3?h.split('').map(function(c){return c+c}).join(''):h,16);
  if(!isFinite(n))return 'rgba(36,36,40,'+alpha+')';return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')'}
// 礼物栏按配置的礼物数量重建：加几个显示几个，删完就整条收起来（窗口同步变矮）。
// 整块板设计：面板底色=边框色，格与格之间留 1px 缝透出边框色当分隔线，格内是 cellBg。
function buildGifts(){var old=document.getElementById('gift-panel');if(old)old.remove();
  var list=visibleGifts();
  if(cfg.giftPanel===false||!list.length)return;
  var box=document.createElement('div');box.id='gift-panel';box.className='pet-gifts';box.dataset.columns=String(cfg.giftColumns||2);box.style.gridTemplateColumns='repeat('+(cfg.giftColumns||2)+',1fr)';
  box.style.background=cfg.cellBorder||'#3a3a40';box.style.gap='1px';
  list.forEach(function(g,i){var cell=document.createElement('div');cell.className='gift-cell';cell.dataset.gift=String(i);cell.dataset.lastRow=String(Math.floor(i/(cfg.giftColumns||2))===Math.floor((list.length-1)/(cfg.giftColumns||2)));
    cell.style.background=rgba(cfg.cellBg,cfg.cellAlpha==null?0.92:cfg.cellAlpha);
    var icon=document.createElement('div');icon.className='gift-icon';var size=cfg.giftIconSize||40;icon.style.width=size+'px';icon.style.height=size+'px';
    var src=g.img||images[giftKey(g.name)]||'';if(src){var im=document.createElement('img');im.src=src;im.onerror=function(){this.remove()};icon.appendChild(im)}
    var text=document.createElement('div');text.className='gift-text';
    var name=document.createElement('div');name.className='gift-name';zlText(name,g.name);name.style.color=cfg.giftNameColor||'#fff';name.style.fontSize=(cfg.giftNameSize||15)+'px';
    var line=document.createElement('div');line.className='gift-divider';
    var eff=document.createElement('div');eff.className='gift-effect';eff.textContent=themes[cfg.theme]?.pet?petGiftLabel(g,effectText(g)):effectText(g);eff.style.color=effectColor(g);eff.style.fontSize=(cfg.giftTextSize||15)+'px';
    text.appendChild(name);text.appendChild(line);text.appendChild(eff);cell.appendChild(icon);cell.appendChild(text);box.appendChild(cell)});
  // 滚动条在礼物栏下面：重建礼物栏时要插到它前面，不能把顺序打乱
  var tickerEl=document.getElementById('ticker');
  var surface=document.getElementById('pet-surface');
  if(tickerEl)surface.insertBefore(box,tickerEl);else surface.appendChild(box);
  // 礼物名/效果文字整行显示：装不下就自动缩号，不截成「为你…」。
  // 必须在挂进 DOM 之后量，否则 scrollWidth/clientWidth 都是 0。
  box.querySelectorAll('.gift-name').forEach(function(el){fitRow(el,cfg.giftNameSize||15,10)});
  box.querySelectorAll('.gift-effect').forEach(function(el){fitRow(el,cfg.giftTextSize||15,10)})}
// 上屏的礼物 = 有名字且「屏幕显示」开着的；格子编号、命中闪烁、加宽判断都按这份算（三处必须一致）
function visibleGifts(){return (cfg.gifts||[]).filter(function(g){return g&&g.name&&g.showOnPanel!==false})}
function applyConfig(next,nextImages){cfg=next||cfg;images=nextImages||images;document.body.dataset.theme=cfg.theme;var t=themes[cfg.theme]||themes['theatre'];
  var pet=t.pet,art=document.getElementById('pet-art'),charms=document.getElementById('pet-charms');
  stage.dataset.petSkin=pet?cfg.theme:'';stage.dataset.petMotion=cfg.petMotion===false?'off':'on';
  stage.dataset.petMaterial=pet?.material?'painted':'';stage.dataset.petMenuArt=pet?.material&&cfg.cellBg===pet.menu?'on':'off';
  if(art.dataset.skin!==cfg.theme){art.innerHTML=pet?pet.mascot:'';charms.innerHTML=pet?pet.charm:'';art.dataset.skin=cfg.theme}
  if(pet){Object.keys(pet.variables).forEach(function(key){stage.style.setProperty(key,pet.variables[key])});stage.style.setProperty('--pet-line',cfg.cellBorder||pet.variables['--pet-line'])}
  // 送礼滚动条配色跟着礼物栏/皮肤走
  document.body.style.setProperty('--tk-text',cfg.giftNameColor||'#fff');
  document.body.style.setProperty('--tk-add',cfg.addColor||'#ff9a3c');
  document.body.style.setProperty('--tk-sub',cfg.subColor||'#3fe0d0');
  document.body.style.setProperty('--tk-muted','color-mix(in srgb,var(--tk-text) 68%,transparent)');
  document.body.style.setProperty('--tk-bg',rgba(cfg.cellBg,cfg.cellAlpha==null?0.92:cfg.cellAlpha));
  document.body.style.setProperty('--tk-line','color-mix(in srgb,'+(cfg.cellBorder||cfg.giftNameColor)+' 45%,transparent)');
  document.body.style.setProperty('--tk-size',Math.max(10,Math.min(16,Math.round((cfg.giftNameSize||16)*.75)))+'px');
  var rows=(visibleGifts().length&&cfg.giftPanel!==false)?1:0;
  var widen=rows?Math.max(1,Math.min(2.5,Number(cfg.giftPanelWidth)||1.6)):1;
  var pm=pet?petMetrics(cfg):null;
  document.body.style.setProperty('--gift-cell-h',(pm?pm.cellH:Math.max(44,(Number(cfg.giftIconSize)||40)+14))+'px');
  panel.style.width=(pm?pm.panelW:Math.round(t.w*widen))+'px';head.style.width=t.w+'px';head.style.height=t.h+'px';frame.src=cfg.bgImage||t.art;frame.hidden=!!pet&&!cfg.bgImage;
  if(pm){var layout=petLayoutVars(pm);Object.keys(layout).forEach(function(key){stage.style.setProperty(key,layout[key])})}
  stage.style.transform='translateY('+((pet?0:-ART_TOP)*(cfg.scale||1))+'px) scale('+(cfg.scale||1)+')';
  titleEl.style.fontSize=t.titleSize+'px';titleEl.style.color=cfg.titleColor||'#fff';timeEl.style.color=cfg.timeColor||t.color;
  zlText(titleEl,cfg.title||'');buildGifts();fitTime(t.timeSize);
  // 送礼滚动条开关：开着就补一条，关掉就撤掉（窗口高度由主进程按 metrics 同步）
  var tick=document.getElementById('ticker');
  if(cfg.giftTicker&&!tick){tick=document.createElement('div');tick.id='ticker';tick.innerHTML='<div id="ticker-track"></div>';document.getElementById('pet-surface').appendChild(tick)}
  else if(!cfg.giftTicker&&tick)tick.remove();
  fitTicker()}
function hitGift(name){var list=visibleGifts();var key=giftKey(name);
  for(var i=0;i<list.length;i++){if(giftKey(list[i].name)===key){var cell=document.querySelector('.gift-cell[data-gift="'+i+'"]');
    if(cell){cell.classList.remove('hit');void cell.offsetWidth;cell.classList.add('hit')}return}}}
function showGift(name,image){hitGift(name);if(!cfg.showGift||!giftPop)return;giftPop.textContent="";if(image){var im=document.createElement("img");im.src=image;im.onerror=function(){this.remove()};giftPop.appendChild(im)}var tx=document.createElement("span");zlText(tx,String(name||""));giftPop.appendChild(tx);giftPop.classList.remove("on");void giftPop.offsetWidth;giftPop.classList.add("on");clearTimeout(giftPopTimer);giftPopTimer=setTimeout(function(){giftPop.classList.remove("on")},2200)}
// 时间变化按人话显示：满 60 秒进「分」、满 60 分进「小时」，不再一律写成秒
function fmtDelta(value){
  var neg=value<0,v=Math.abs(Math.round(value));
  var h=Math.floor(v/3600),m=Math.floor((v%3600)/60),s=v%60,text='';
  if(h)text=h+'小时'+(m?m+'分':'');
  else if(m)text=m+'分'+(s?s+'秒':'');
  else text=s+'秒';
  return (neg?'-':'+')+text;
}
${TIME_TICKER_SCRIPT}
function render(state){var value=Number(state.remaining)||0;var t=themes[cfg.theme]||themes['theatre'];
  timeEl.dataset.zeroed=String(!!(state.zeroed&&cfg.zeroText));
  var displayed=state.zeroed&&cfg.zeroText?cfg.zeroText:(cfg.showSeconds?String(value):fmt(value,cfg.showNegative));
  if(t.pet&&!cfg.showSeconds&&!state.zeroed)displayed=petTimeText(displayed);
  timeEl.textContent='';String(displayed).split(/(:)/).forEach(function(part){if(t.pet&&part===':'){var colon=document.createElement('span');colon.className='pet-colon';colon.textContent=part;timeEl.appendChild(colon)}else timeEl.appendChild(document.createTextNode(part))});
  fitTime(t.timeSize);document.body.style.visibility=state.hidden?'hidden':'visible';if(state.gift)showGift(state.gift.name,state.gift.image)}
window.__setConfig=applyConfig;window.__render=render;applyConfig(cfg,images)
document.fonts.ready.then(function(){lastFitKey='';fitTime((themes[cfg.theme]||themes['theatre']).timeSize,true)})
</script></body></html>`
}

function pageWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

function isHidden(): boolean {
  return !!config?.autoHide && zeroed
}

function render(gift?: { name: string; image: string }): void {
  const target = pageWindow()
  if (!target) return
  const payload = { remaining, running, zeroed, hidden: isHidden(), gift }
  void target.webContents.executeJavaScript(`window.__render&&window.__render(${pageJson(payload)})`).catch(() => {})
}

function stopClock(): void {
  if (clock) clearInterval(clock)
  clock = null
  lastTickAt = 0
  elapsedCarryMs = 0
}

function startClock(): void {
  stopClock()
  // 原版时钟周期默认 1000ms 走一格；这里做成真可调项（用户铁律：能调的都要能调）。
  // 结算仍按真实经过时间折算格数，系统忙或窗口休眠都不会让倒计时失真。
  const period = Math.max(50, config?.clockSpeed || 1000)
  const interval = Math.min(250, period)
  lastTickAt = Date.now()
  clock = setInterval(() => {
    const now = Date.now()
    if (!config?.enable || !running || now < pausedUntil) {
      lastTickAt = now
      elapsedCarryMs = 0
      return
    }
    const elapsed = Math.max(0, now - (lastTickAt || now))
    lastTickAt = now
    const total = elapsedCarryMs + elapsed
    const steps = Math.floor(total / period)
    elapsedCarryMs = total % period
    if (steps > 0) setRemaining(remaining - steps)
  }, interval)
}

function setRemaining(value: number, gift?: { name: string; image: string }): void {
  const before = remaining
  const next = Math.trunc(numberOr(value, 0))
  const entersPositive = before <= 0 && next > 0
  const reachesZero = before > 0 && next <= 0
  if (config?.showNegative) {
    remaining = next
    zeroed = false
  } else if (next <= 0) {
    remaining = 0
    zeroed = true
    running = false
    stopClock()
  } else {
    remaining = next
    zeroed = false
  }

  if (entersPositive && config?.enable) {
    running = true
    startClock()
    pageWindow()?.showInactive()
    sendConfiguredHotkey(config.startHotkey)
  }
  if (reachesZero) {
    sendConfiguredHotkey(config?.endHotkey || DEFAULT_CONFIG.endHotkey)
    if (!config?.showNegative) stopClock()
  }
  if (config?.autoHide && zeroed && !config.showNegative) hideCaptureOutputWindow(pageWindow())
  else if (remaining > 0) pageWindow()?.showInactive()
  render(gift)
}

function keySequence(hotkey: TimeWidgetConfig['startHotkey']): string | null {
  if (!hotkey.enabled) return null
  const key = String(hotkey.key || '').trim()
  if (!key) return null
  const special = /^(?:F(?:[1-9]|1[0-2])|ENTER|ESC|TAB|SPACE|HOME|END|PGUP|PGDN|LEFT|RIGHT|UP|DOWN|DELETE|DEL|INSERT|INS|BACKSPACE|BACK)$/i
  const main = special.test(key) ? `{${key.toUpperCase()}}` : key
  const prefix: Record<string, string> = { '无': '', Alt: '%', Ctrl: '^', 'Ctrl+Alt': '^%', Shift: '+' }
  return (prefix[hotkey.func] ?? '') + main
}

// 原版的“开始/结束是否执行热键”是向当前前台程序送键，不是监听全局热键。
function sendConfiguredHotkey(hotkey: TimeWidgetConfig['startHotkey']): void {
  const sequence = keySequence(hotkey)
  if (!sequence) return
  sendKeys(sequence)
}

function stopAtZero(): void {
  const before = remaining
  remaining = 0
  zeroed = true
  running = false
  stopClock()
  render()
  if (before > 0 && config) sendConfiguredHotkey(config.endHotkey)
}

function syncConfig(value: Partial<TimeWidgetConfig>): TimeWidgetConfig {
  const next = normalize({ ...(config || DEFAULT_CONFIG), ...value })
  const previous = config
  const wasEnabled = config?.enable
  config = next
  persistConfig()
  // 记录窗口跟倒计时同一套皮肤/外观，改了就一起变
  syncLogConfig(next)
  if (!next.enable) timeWidgetCancelQueue()
  if (!next.enable) running = false
  else if (wasEnabled === false && remaining > 0) running = true
  const target = pageWindow()
  if (target) {
    const images = localGiftImages()
    void target.webContents.executeJavaScript(`window.__setConfig&&window.__setConfig(${pageJson(pageConfig(next))},${pageJson(images)})`).catch(() => {})
    // 礼物增删/换列数会改变挂件高矮。窗口建成不可缩放的，setSize 得先临时解锁才生效。
    const metrics = widgetMetrics(next)
    try {
      const [width, height] = target.getSize()
      if (width !== metrics.w || height !== metrics.h) {
        target.setResizable(true)
        target.setSize(metrics.w, metrics.h)
        target.setResizable(false)
      }
    } catch { /* ignore */ }
    render()
    if (!next.enable) stopClock()
    else if (!clock || previous?.clockSpeed !== next.clockSpeed || wasEnabled !== next.enable) startClock()
    if (next.autoHide && zeroed && !next.showNegative) hideCaptureOutputWindow(target)
    else if (remaining > 0 || !zeroed) target.showInactive()
  }
  return next
}

export function openTimeWidget(value: Partial<TimeWidgetConfig>): { ok: boolean; error?: string } {
  try {
    const cfg = normalize({ ...(config || DEFAULT_CONFIG), ...value })
    config = cfg
    persistConfig()
    const existing = pageWindow()
    if (existing) {
      existing.showInactive()
      syncConfig(cfg)
      return { ok: true }
    }
    syncLogConfig(cfg)
    remaining = cfg.showNegative ? cfg.initial : Math.max(0, cfg.initial)
    zeroed = !cfg.showNegative && remaining <= 0
    running = cfg.enable && (remaining > 0 || (cfg.showNegative && remaining === 0))
    pausedUntil = 0
    const file = path.join(app.getPath('userData'), 'time-widget.html')
    fs.writeFileSync(file, page(cfg, localGiftImages()), 'utf8')
    const metrics = widgetMetrics(cfg)
    const created = createCaptureOutputWindow({
      title: '倒计时',
      width: metrics.w,
      height: metrics.h,
      ...onScreenPosition(cfg.posX, cfg.posY, metrics.w, metrics.h),
      frame: false,
      transparent: true,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    win = created
    registerOutputWindow(created)
    captureTitle(created, '倒计时')
    created.loadFile(file)
    onceOutputPageEvent(created, 'did-finish-load', () => render())
    onOutputWindowEvent(created, 'move', () => {
      if (win === created && config) {
        const [x, y] = created.getPosition()
        config = { ...config, posX: x, posY: y }
        persistConfig()
      }
    })
    onOutputWindowClosed(created, () => {
      if (win === created) {
        timeWidgetCancelQueue()
        win = null
        running = false
        stopClock()
      }
    })
    startClock()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: '打开倒计时挂件失败：' + (error as Error).message }
  }
}

/** 当前盲盒事件池的副本。导入品游时间项目要【合并】而不是覆盖主播已经配好的事件 */
export function timeBlindBoxEvents(): TimeBlindBoxEvent[] {
  return (config?.blindBoxEvents || []).map((e) => ({ ...e }))
}

export function timeWidgetUpdate(value: Partial<TimeWidgetConfig>): { ok: boolean } {
  syncConfig(value)
  return { ok: true }
}

export function timeWidgetAdjust(delta: number): { ok: boolean } {
  if (!pageWindow()) return { ok: false }
  setRemaining(remaining + numberOr(delta, 0))
  return { ok: true }
}

export function timeWidgetClear(): { ok: boolean } {
  if (!pageWindow()) return { ok: false }
  stopAtZero()
  return { ok: true }
}

// 区间随机：填了秒数2 就在 [秒数, 秒数2] 里随机取（原版「-1000,1000 范围内随机」）。
function pickSeconds(a: number, b: number | null | undefined): number {
  const lo = Math.trunc(numberOr(a, 0))
  if (b == null || b === ('' as unknown as number)) return lo
  const hi = Math.trunc(numberOr(b, lo))
  const min = Math.min(lo, hi)
  const max = Math.max(lo, hi)
  return min + Math.floor(Math.random() * (max - min + 1))
}

// 按运算方式结算一次。加减=±秒数；范围=直接设成该值；清零=归零；乘以/除以=对当前值运算。
function applyCountdownOp(op: CountdownOp | undefined, value: number, sign: 1 | -1): number {
  const action = op || '加减'
  if (action === '清零') return 0
  if (action === '范围') return value
  if (action === '乘以') return Math.round(remaining * (value || 1))
  if (action === '除以') return Math.round(remaining / (value || 1))
  return remaining + sign * value
}

// 挂件礼物栏那一行的结算：加减（区间随机，值可负）/ 乘除 / 范围（设为）/ 清零。
function applyGiftRow(row: TimeWidgetGift): number {
  const value = pickSeconds(row.seconds, row.seconds2)
  switch (row.op) {
    case '乘以':
      return Math.round(remaining * (value || 1))
    case '除以':
      return Math.round(remaining / (value || 1))
    case '范围':
      return value
    case '清零':
      return 0
    default:
      return remaining + value
  }
}

function playGiftVideo(row: TimeWidgetGift): string | undefined {
  const video = String(row.video || '').trim()
  if (!video) return
  // ★播到时间插件里选的「指定播放窗口」——和盲盒视频同一个。以前这里写死 4 号：
  //   主播把指定窗口改成 1 号、直播伴侣也只采了 1 号，礼物栏里配的视频却跑到 4 号去播，看着就是「没播」。
  // 礼物栏视频走排队模型：指定窗口最优先，忙了看「本窗口忙时去别的窗口」开关（默认开）
  const opened = openGreenScreen(video, 'video', '', boxSlot(), {
    loop: row.videoLoop === true,
    maxSeconds: Math.max(0, Math.trunc(Number(row.videoSeconds) || 0)),
    origin: 'command',
    overflow: config?.boxVideoOverflow !== false
  })
  return opened.ok ? undefined : opened.error || '礼物视频未播放，请检查素材和指定窗口'
}

export function handleTimeWidgetGift(name: string, count = 1, image = '', sender = '', logSource: 'live' | 'test' = 'live', avatar = ''): TimeBoxReply {
  const gift = String(name || '').trim()
  if (!pageWindow()) return { ok: false, error: '先开启倒计时挂件' }
  if (!config?.enable) return { ok: false, error: '倒计时功能已关闭，请先开启' }
  if (!gift) return { ok: false, error: '请选择礼物' }
  // 数量不设上限（用户铁律）：加减时间按真实连击数全额生效。
  const amount = Math.max(1, Math.trunc(numberOr(count, 1)))
  if (!Number.isSafeInteger(amount)) return { ok: false, error: '礼物数量无效' }
  // 先查挂件礼物栏（配几个匹配几个），没命中再回落到老的加时/减时两个礼物字段。
  const row = (config.gifts || []).find((item) => item?.name && giftNamesEqual(item.name, gift))
  const isAdd = !row && giftNamesEqual(config.addGift, gift)
  const isSub = !row && !isAdd && giftNamesEqual(config.subGift, gift)
  if (!row && !isAdd && !isSub) return { ok: false, error: '该礼物尚未绑定时间动作' }
  const key = normalizeGiftName(gift)
  const local = localGiftImages()
  const resolved =
    source(row?.img || '') || source(image) || source(observedGiftImages.get(key) || '') || local[key] || ''
  if (row?.mode === 'blindbox') {
    const pool = resolveTimeBlindBoxPool(config.blindBoxEvents || [], row.blindBoxEventIds, { skipDisabled: true })
    if (!pool.ok) {
      pushGiftLog({ ts: Date.now(), name: gift, sender, delta: 0, remaining, source: logSource, error: pool.error })
      return { ok: false, error: pool.error }
    }
    return enqueueTimeBox(pool.events!, amount, gift, sender, resolved, logSource, avatar)
  }
  // 连击 N 次逐次结算：区间随机每次重新抽，乘除也按次复利，跟原版一次一算一致。
  const startRemaining = remaining
  let next = remaining
  for (let i = 0; i < amount; i++) {
    remaining = next
    if (row) {
      next = applyGiftRow(row)
      continue
    }
    const seconds = isAdd
      ? pickSeconds(config.addSeconds, config.addSeconds2)
      : pickSeconds(config.subSeconds, config.subSeconds2)
    next = applyCountdownOp(isAdd ? config.addOp : config.subOp, seconds, isAdd ? 1 : -1)
  }
  setRemaining(next, { name: gift, image: resolved })
  // 一个礼物事件只播放一次对应视频；连击数量仍按 amount 逐次结算数值。
  const videoError = row?.video ? playGiftVideo(row) : undefined
  // 记一笔：按结算后的真实总变化记（连击算整次，含夹到 0 的情况）
  pushGiftLog({ ts: Date.now(), name: gift, sender: String(sender || ''), delta: remaining - startRemaining, remaining, source: logSource, avatar, ...(videoError ? { error: videoError } : {}) })
  // 送礼滚动条：一条礼物记一条（连击按整次的时间变化）
  pushTicker(sender, avatar, remaining - startRemaining, gift)
  return { ok: true }
}

export function setTimeWidgetGiftImage(name: string, image: string): void {
  const gift = String(name || '').trim()
  const imagePath = String(image || '').trim()
  if (!gift || !imagePath) return
  const key = normalizeGiftName(gift)
  if (!key) return
  observedGiftImages.set(key, imagePath)
  if (observedGiftImages.size > 800) observedGiftImages.delete(observedGiftImages.keys().next().value as string)
}

export function timeWidgetPause(ms: number): { ok: boolean } {
  if (!pageWindow()) return { ok: false }
  pausedUntil = Date.now() + Math.max(0, numberOr(ms, 0))
  return { ok: true }
}

export function timeWidgetShowGift(name: string, image: string): { ok: boolean } {
  if (!pageWindow()) return { ok: false }
  const gift = String(name || '')
  const key = normalizeGiftName(gift)
  const local = localGiftImages()
  const resolved = source(String(image || '')) || source(observedGiftImages.get(key) || '') || local[key] || ''
  render({ name: gift, image: resolved })
  return { ok: true }
}

export function closeTimeWidget(): { ok: boolean } {
  timeWidgetCancelQueue()
  stopClock()
  try { pageWindow()?.close() } catch { /* ignore */ }
  win = null
  running = false
  return { ok: true }
}

export function timeWidgetState(): TimeWidgetState {
  return { open: !!pageWindow(), remaining, running: !!config?.enable && running, zeroed, hidden: isHidden(), queueLength: queuedTimeBoxes(),
    activeEvent: activeBox ? { id: activeBox.event.id, name: activeBox.event.name } : undefined,
    lastResult: lastBoxResult ? { ...lastBoxResult } : undefined }
}

// ---- 「抽时间记录」窗口：今天粉丝送礼抽到的时间，单独一个采集窗口 ----
// 单行明细沿用倒计时的配色和缩放，不显示标题、汇总或装饰面板。
// 设置里的开关（settings.timeLogWindow）决定开机要不要自动开，页面上的开关调 timeLogOpen/timeLogClose。
const TIME_LOG_TITLE = '抽时间记录'
let logWin: BrowserWindow | null = null
let logTimer: ReturnType<typeof setInterval> | null = null

/** 今天的记录（本地日期，只留送礼抽时间那一批） */
export function timeLogToday(): TimeGiftLogEntry[] {
  ensureLogLoaded()
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return giftLog.filter((entry) => entry.ts >= start.getTime())
}

/** 紧凑送礼记录：窗口只占实际行高，至少一行空态，最多 logRows 行。 */
export function logMetrics(cfg: TimeWidgetConfig, count: number): {
  w: number; h: number; rows: number; maxRows: number; cellH: number; scale: number; panelW: number
} {
  return timeLogMetrics(cfg, count, themeFor(cfg).w)
}

type LogRow = { ts: number; sender: string; name: string; delta: number; avatar: string }
/** 推给记录窗口的数据：今天最近的 N 条 + 今日汇总（人数按条数、时间按净变化） */
function logPayload(cfg: TimeWidgetConfig): { rows: LogRow[]; count: number; total: number } {
  const today = timeLogToday()
  const max = logMetrics(cfg, today.length).maxRows
  return {
    rows: today.slice(0, max).map((entry) => ({ ts: entry.ts, sender: entry.sender, name: entry.name, delta: entry.delta, avatar: mediaSrc(entry.avatar) })),
    count: today.length,
    total: today.reduce((sum, entry) => sum + (Number(entry.delta) || 0), 0)
  }
}

function timeLogHtml(cfg: TimeWidgetConfig): string {
  return compactTimeLogHtml(pageConfig(cfg), themeFor(cfg).w)
}

/** 记录窗口的高度跟今天的条数走（最少 1 格，最多 logRows 格）；窗口不可缩放，改尺寸得先临时解锁。 */
function fitLogWindow(cfg: TimeWidgetConfig, count: number): void {
  const target = logWin
  if (!target || target.isDestroyed()) return
  const metrics = logMetrics(cfg, count)
  try {
    const [width, height] = target.getSize()
    if (width !== metrics.w || height !== metrics.h) {
      target.setResizable(true)
      target.setSize(metrics.w, metrics.h)
      target.setResizable(false)
    }
  } catch { /* ignore */ }
}

function pushTimeLog(): void {
  const target = logWin
  if (!target || target.isDestroyed()) return
  ensurePersistedConfig()
  const cfg = config || normalize({})
  const data = logPayload(cfg)
  void target.webContents.executeJavaScript(`window.__log&&window.__log(${pageJson(data.rows)},${pageJson({ count: data.count, total: data.total })})`).catch(() => {})
  fitLogWindow(cfg, data.rows.length)
}

/** 换皮肤、字号、缩放或条数时同步记录窗口，不用重开。 */
function syncLogConfig(cfg: TimeWidgetConfig): void {
  const target = logWin
  if (!target || target.isDestroyed()) return
  void target.webContents.executeJavaScript(`window.__setConfig&&window.__setConfig(${pageJson(pageConfig(cfg))},${themeFor(cfg).w})`).catch(() => {})
  pushTimeLog()
}

export function timeLogOpen(): { ok: boolean; error?: string } {
  try {
    ensurePersistedConfig()
    const cfg = config || normalize({})
    if (logWin && !logWin.isDestroyed()) {
      showOutputWindow(logWin)
      syncLogConfig(cfg)
      return { ok: true }
    }
    const file = path.join(app.getPath('userData'), 'time-log-widget.html')
    fs.writeFileSync(file, timeLogHtml(cfg), 'utf8')
    const metrics = logMetrics(cfg, timeLogToday().length)
    const win = createCaptureOutputWindow({
      width: metrics.w,
      height: metrics.h,
      title: TIME_LOG_TITLE,
      x: 120,
      y: 120,
      frame: false,
      transparent: true,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    logWin = win
    captureTitle(win, TIME_LOG_TITLE)
    registerOutputWindow(win)
    onceOutputPageEvent(win, 'did-finish-load', () => { if (logWin === win) pushTimeLog() })
    onOutputWindowClosed(win, () => { if (logWin === win) logWin = null })
    void win.loadFile(file)
    // 每秒刷一次兜底（跨天、别处清空记录时窗口也跟上）；数据没变页面不重画
    if (logTimer) clearInterval(logTimer)
    logTimer = setInterval(pushTimeLog, 1000)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: '打开抽时间记录窗口失败：' + (error as Error).message }
  }
}

export function timeLogClose(): { ok: boolean } {
  if (logTimer) { clearInterval(logTimer); logTimer = null }
  const target = logWin
  logWin = null
  if (target && !target.isDestroyed()) target.close()
  return { ok: true }
}

export function timeLogState(): { open: boolean } {
  return { open: !!logWin && !logWin.isDestroyed() }
}

app.on('before-quit', () => {
  timeWidgetCancelQueue()
  stopClock()
  try { pageWindow()?.close() } catch { /* ignore */ }
  win = null
  running = false
})

// 设置页「点一下测试」：按这格礼物的真实运算走一遍（和直播收到时同一条路径）
export function timeWidgetTestGift(name: string): TimeBoxReply {
  return handleTimeWidgetGift(name, 1, '', '测试', 'test')
}
