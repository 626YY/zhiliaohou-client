import { WIDGET_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
// 抽奖结果由主进程生成；页面与采集窗口共用同一次结果，中奖动作仅执行一次。
import { BrowserWindow, app } from 'electron'
import { outputsAlwaysOnTop, registerOutputWindow, createCaptureOutputWindow, captureWindowExists, captureSourceBackground, onOutputWindowClosed, onOutputWindowEvent, onOutputPageEvent } from './output-window'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Ipc, type LotteryItem, type LotteryTrigger, type LotteryKind, type LotteryEvent, type ConnectorEvent, type LotteryBulbMode, type LotterySound, type LotteryDraw, type LotteryDrawSource } from '@shared/types'

import { giftNamesEqual } from '../shared/giftName'
import { readJson, writeJson } from './db'
import { findGiftImage } from './entertainment'
import { runWithStageVideo, type StageVideoTake } from './stage-video'
import { assetUrl, captureTitle, mediaUrl, scriptJson } from './capture-output'
import { currentToolChain, runWithToolChain } from './tool-chain'

/** 没配过的抽奖：内置音效、跑马灯跟着盘跑、空闲不出现在直播画面里、中心图跟着触发礼物走。 */
function defaultTrigger(): LotteryTrigger {
  return { autoSpin: false, triggerGift: '', bulbs: 'chase', sound: normalizeSound(undefined), idleHide: true, holdSeconds: 6, centerGift: true, stageVideo: true }
}

/** 外圈灯珠模式，老配置没有这项时按「跟着盘跑」算。 */
function normalizeBulbs(value: unknown): LotteryBulbMode {
  return value === 'blink' || value === 'off' ? value : 'chase'
}

/** 抽奖声音，老配置没有这项时用内置默认音。 */
function normalizeSound(value: unknown): LotterySound {
  const raw = (value || {}) as Partial<LotterySound>
  const volume = Number(raw.volume)
  return {
    mode: raw.mode === 'off' || raw.mode === 'custom' || raw.mode === 'chime' ? raw.mode : 'preset',
    spin: String(raw.spin || ''),
    win: String(raw.win || ''),
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 70
  }
}

/** 抽中之后画面留几秒（0~120，防手滑填出个天文数字）。 */
function normalizeHold(value: unknown): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.max(0, Math.min(120, seconds)) : 6
}

type Group = 'wheel' | 'nine'
type Reply = { ok: boolean; error?: string; queued?: number }
type Request = { id: string; items: LotteryItem[]; index: number; chain: string[]; source?: LotteryDrawSource; centerImg?: string }
// 抽奖流水最多留这么多条：够查半个月的直播，也不至于把配置目录撑大。
const HISTORY_LIMIT = 800
type GroupState = { items: LotteryItem[]; centerImg?: string; trigger: LotteryTrigger; queue: Request[]; active?: Request; finishing?: boolean; epoch?: number; timer?: ReturnType<typeof setTimeout>; last?: LotteryEvent }
const windows: Partial<Record<LotteryKind, BrowserWindow>> = {}
const ready = new Set<LotteryKind>()
const groups: Record<Group, GroupState> = {
  wheel: { items: [], trigger: defaultTrigger(), queue: [] },
  nine: { items: [], trigger: defaultTrigger(), queue: [] }
}
const groupOf = (kind: LotteryKind): Group => kind === 'nine' ? 'nine' : 'wheel'
const titles: Record<LotteryKind, string> = { wheel: '转盘', nine: '九宫格', lucky: '幸运转盘' }
let loaded = false
let actionHandler: (item: LotteryItem, isCurrent: () => boolean) => Promise<Reply> = async () => ({ ok: false, error: '中奖动作未连接' })
export function setLotteryActionHandler(handler: typeof actionHandler): void { actionHandler = handler }

// ★白名单式重建：新加的字段必须在这里显式带上，否则会被静默丢掉
//   （2026-09-07 加 actions 时就踩了一次：奖项配了附加动作，存进来却没有；
//     2026-09-09 又踩一次：中奖语音 voice / voiceWait 配了存不下来，抽中永远不播）
function cleanItems(items: LotteryItem[]): LotteryItem[] {
  return (Array.isArray(items) ? items : []).map(i => ({
    name: String(i?.name || '').trim(), color: String(i?.color || ''), img: i?.img ? String(i.img) : undefined,
    action: i?.action || 'none', actionParam: String(i?.actionParam || ''),
    actionSeconds: Math.max(0, Number(i?.actionSeconds) || 0),
    voice: i?.voice ? String(i.voice) : undefined,
    voiceWait: i?.voiceWait !== false,
    // 内置绿幕抠图开关（只对播视频/项目素材的动作有意义）
    chroma: i?.chroma === true,
    // 附加动作：最多 8 个，单个延迟夹在 60 秒内（防手滑填出个把直播卡死的数）
    actions: (Array.isArray(i?.actions) ? i.actions : []).slice(0, 8).map(a => ({
      action: a?.action || 'none', actionParam: String(a?.actionParam || ''),
      actionSeconds: Math.max(0, Number(a?.actionSeconds) || 0),
      delayMs: Math.min(60_000, Math.max(0, Number(a?.delayMs) || 0)),
      chroma: a?.chroma === true
    })).filter(a => a.action !== 'none')
  }))
}
function loadConfig(): void {
  if (loaded) return
  loaded = true
  try {
    const data = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'lottery-config.json'), 'utf8'))
    for (const key of ['wheel', 'nine'] as Group[]) {
      groups[key].items = cleanItems(data[key]?.items)
      groups[key].centerImg = data[key]?.centerImg
      groups[key].trigger = { autoSpin: data[key]?.trigger?.autoSpin === true, triggerGift: String(data[key]?.trigger?.triggerGift || ''), skin: normalizeWidgetSkin(data[key]?.trigger?.skin), bulbs: normalizeBulbs(data[key]?.trigger?.bulbs), sound: normalizeSound(data[key]?.trigger?.sound), idleHide: data[key]?.trigger?.idleHide !== false, holdSeconds: normalizeHold(data[key]?.trigger?.holdSeconds), centerGift: data[key]?.trigger?.centerGift !== false, stageVideo: data[key]?.trigger?.stageVideo !== false }
    }
  } catch { /* 首次配置 */ }
}
function saveConfig(): void {
  const data = Object.fromEntries(Object.entries(groups).map(([k,g]) => [k, {items:g.items,centerImg:g.centerImg,trigger:g.trigger}]))
  const target = path.join(app.getPath('userData'), 'lottery-config.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = target + '.' + randomUUID() + '.tmp'
  try { fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, target) }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
}
/** 抽奖流水（谁、什么时候、抽中什么），转盘页和九宫格页都能翻。 */
export function lotteryHistory(limit = 200): LotteryDraw[] {
  const rows = readJson<LotteryDraw[]>('lottery-history', [])
  const list = Array.isArray(rows) ? rows : []
  return list.slice(0, Math.max(1, Math.min(HISTORY_LIMIT, limit)))
}

export function clearLotteryHistory(): Reply {
  try { writeJson('lottery-history', []) } catch (error) { return { ok: false, error: '清空抽奖记录失败：' + (error as Error).message } }
  return { ok: true }
}

function recordDraw(group: Group, req: Request, item: LotteryItem): void {
  try {
    const rows = lotteryHistory(HISTORY_LIMIT)
    // 新的放最前面，翻记录一眼看到最近的
    rows.unshift({
      id: req.id,
      at: Date.now(),
      kind: group,
      prize: item.name || '',
      prizeImg: item.img || '',
      source: req.source?.kind || 'manual',
      user: req.source?.user || '',
      gift: req.source?.gift || '',
      action: item.action && item.action !== 'none' ? item.action : ''
    })
    writeJson('lottery-history', rows.slice(0, HISTORY_LIMIT))
  } catch (error) {
    console.warn('写抽奖记录失败', error instanceof Error ? error.message : String(error))
  }
}

// 页面播完语音或奖品视频会回一条消息，这里等它；卡住了也有兜底超时，绝不吊死抽奖流程。
const stageWaiters = new Map<string, { group: Group; finish: (error?: string) => void }>()
function waitStage(group: Group, key: string, timeoutMs: number): Promise<void> {
  const waiting = new Promise<void>((resolve, reject) => {
    let done = false
    // 只删自己登记的那一份：同一轮里视频换了一次（同 key 重新登记），老的超时不能把新的等待也删掉
    const finishOnce = (error?: string): void => { if (done) return; done = true; clearTimeout(timer); if (stageWaiters.get(key)?.finish === finishOnce) stageWaiters.delete(key); if (error) reject(new Error(error)); else resolve() }
    const timer = setTimeout(() => finishOnce(key.startsWith('prize:') ? '视频播放超时，已停止等待' : undefined), timeoutMs)
    stageWaiters.get(key)?.finish()
    stageWaiters.set(key, { group, finish: finishOnce })
    // 窗口没开就别等了
    if (!Object.keys(windows).some(k => groupOf(k as LotteryKind) === group)) finishOnce()
  })
  void waiting.catch(() => {})
  return waiting
}

function notify(event: LotteryEvent): void {
  groups[event.kind].last = event
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(Ipc.LotteryEvent, event)
}
function displayItems(items: LotteryItem[]): LotteryItem[] { return items.map(i => ({...i, img: i.img ? mediaUrl(i.img) : undefined})) }
function callWindows(group: Group, code: string): void {
  for (const kind of Object.keys(windows) as LotteryKind[]) {
    const win = windows[kind]
    if (groupOf(kind) === group && win && !win.isDestroyed() && ready.has(kind)) void win.webContents.executeJavaScript(code).catch(() => {})
  }
}
function packet(group: Group, req: Request): LotteryEvent {
  // 中心图跟着触发礼物走：这轮是哪个礼物触发的，就把那个礼物的图带上（礼物图库里没这张就不带，
  // 窗口那边继续显示固定中心图）。手动点「转起来」没有礼物，也就没有 center。
  return {kind:group,id:req.id,phase:'started',index:req.index,item:req.items[req.index],items:req.items,duration:group === 'nine' ? 3400 : 4200,startedAt:Date.now(),queued:groups[group].queue.length,center:req.centerImg ? mediaUrl(req.centerImg) : undefined}
}
function startNext(group: Group): void {
  const state = groups[group]
  if (state.active || state.finishing || !state.queue.length) return
  const req = state.queue.shift()!
  state.active = req
  const event = packet(group, req)
  notify(event)
  callWindows(group, `window.__startSpin(${scriptJson({...event,items:displayItems(event.items)})})`)
  state.timer = setTimeout(() => { void finish(group,req.id) }, event.duration + 250)
}
async function finish(group: Group, id: string): Promise<void> {
  const state = groups[group], req = state.active
  if (!req || req.id !== id) return
  // 在 await 动作之前摘掉本次任务，重复的 renderer 完成信号不可能再次执行。
  clearTimeout(state.timer)
  state.timer = undefined
  state.active = undefined
  state.finishing = true
  const epoch = state.epoch || 0
  const stillCurrent = (): boolean => (state.epoch || 0) === epoch && state.finishing === true && state.last?.id === id
  const item = req.items[req.index]
  recordDraw(group, req, item)
  const event = {...state.last!,phase:'result' as const,queued:state.queue.length}
  notify(event)
  callWindows(group, `window.__complete(${scriptJson({...event,items:displayItems(event.items)})})`)
  // 先播「恭喜抽中…」的语音；默认等它播完再执行动作，免得语音和整蛊同时开始
  if (item.voice) {
    const voiceKey = 'voice:' + id
    const voiceDone = item.voiceWait !== false ? waitStage(group, voiceKey, 30_000) : undefined
    callWindows(group, `window.__playVoice&&window.__playVoice(${scriptJson(mediaUrl(item.voice))},${scriptJson(id)})`)
    if (voiceDone) await voiceDone
  }
  if (!stillCurrent()) return
  let result: Reply = {ok:true}
  // 这一轮里被转盘接管的视频；等它播完再算这次抽奖结束
  let stageVideoDone: Promise<void> | undefined
  const takeStageVideo: StageVideoTake = (src, type, seconds, chroma) => {
    if (type !== 'video' || state.trigger.stageVideo === false) return false
    // 换了一轮就不接管了（时间盲盒等别处的视频顺着回调链漏过来时别抢到转盘上）
    if ((state.epoch || 0) !== epoch || state.last?.id !== id) return false
    // ★先登记等待、再叫页面播：视频很短或文件坏了时「播完了」的信号会在附加动作跑完之前到，
    //   没人接就丢了，后面 await 就要干等 5 分钟超时，整条抽奖队列跟着卡住。
    const playId = randomUUID()
    stageVideoDone = waitStage(group, 'prize:' + playId, 300_000)
    callWindows(group, `window.__playPrizeVideo&&window.__playPrizeVideo(${scriptJson(mediaUrl(src))},${scriptJson(seconds)},${scriptJson(playId)},${chroma === true})`)
    return true
  }
  const runAction = (fn: () => Promise<Reply>): Promise<Reply> =>
    runWithToolChain(req.chain, () => state.trigger.stageVideo === false ? fn() : runWithStageVideo(takeStageVideo, fn, () => stageVideoDone))
  try {
    if (item.action === 'stage-video') {
      const path = String(item.actionParam || '').trim()
      if (!path) result = {ok:false,error:'请先选择奖品视频'}
      else {
        const key = 'prize:' + id
        const completed = waitStage(group, key, 300_000)
        callWindows(group, `window.__playPrizeVideo&&window.__playPrizeVideo(${scriptJson(mediaUrl(path))},${scriptJson(item.actionSeconds || 0)},${scriptJson(id)},${item.chroma === true})`)
        // 视频最长等 5 分钟，之后不再占着队列
        await completed
      }
    } else if (item.action === 'wheel-spin' || item.action === 'nine-spin') {
      const target = item.action === 'nine-spin' ? 'nine' : 'wheel'
      result = chainFull(req.chain, target) ? chainFullReply : enqueue(target, [...req.chain,target], {kind:'chain',user:req.source?.user||'',gift:req.source?.gift||''})
    } else if (item.action && item.action !== 'none') {
      result = await runAction(() => actionHandler(item, () => (state.epoch || 0) === epoch && state.finishing === true && state.last?.id === id))
    }
    // 附加动作：一个奖项可以「播视频 + 加班 +30 秒 + 锁键盘」，按顺序来，各自可带延迟。
    // 主动作失败也照跑（视频坏了不该连带把加班动作吞掉）；奖项被取消/换了一轮就停。
    for (const extra of item.actions || []) {
      if (!stillCurrent()) break
      if (!extra?.action || extra.action === 'none') continue
      if (extra.delayMs && extra.delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(60_000, extra.delayMs || 0)))
        if (!stillCurrent()) break
      }
      // 「触发转盘 / 触发九宫格」是抽奖自己的联动，不走动作命令（走了只会回「不支持的中奖动作」）
      if (extra.action === 'wheel-spin' || extra.action === 'nine-spin') {
        const target = extra.action === 'nine-spin' ? 'nine' : 'wheel'
        const r = chainFull(req.chain, target) ? chainFullReply : enqueue(target, [...req.chain,target], {kind:'chain',user:req.source?.user||'',gift:req.source?.gift||''})
        if (!r.ok && result.ok) result = r
        continue
      }
      try {
        const r = await runAction(() => actionHandler(
          { name: item.name, color: item.color, img: item.img, action: extra.action, actionParam: extra.actionParam, actionSeconds: extra.actionSeconds, chroma: extra.chroma === true },
          stillCurrent
        ))
        if (!r.ok && result.ok) result = r
      } catch (error) { if (result.ok) result = {ok:false,error:(error as Error).message} }
    }
  } catch (error) { result = {ok:false,error:(error as Error).message} }
  // 视频还在转盘上放着就等它放完，别急着开下一轮
  if (stageVideoDone) {
    try { await stageVideoDone } catch (error) { if (result.ok) result = { ok: false, error: (error as Error).message } }
  }
  if ((state.epoch || 0) !== epoch) return
  if (!result.ok) notify({...event,phase:'error',error:result.error || '中奖动作执行失败'})
  state.finishing = false
  // 连着抽下一轮（抽中「再抽一次」这类联动）之前，先让中奖画面停留够：
  // 盘刚停在「再抽一次」上、下一秒就又转起来的话，观众根本看不清抽中了什么，主播设的「抽中后停留几秒」也等于白设。
  // 停留秒数用的就是转盘设置里那一项，设成 0 就是不等、立刻接着抽。
  // 定时器存在 state.timer 上：关掉转盘窗口时 releaseWindow 会一并清掉它和整条队列。
  const holdMs = state.queue[0]?.source?.kind === 'chain' ? normalizeHold(state.trigger.holdSeconds) * 1000 : 0
  if (holdMs > 0) state.timer = setTimeout(() => { state.timer = undefined; startNext(group) }, holdMs)
  else startNext(group)
}
/**
 * 抽奖联动最多接着抽几轮。
 * ★2026-09-11 主播：「转盘工具我设置再抽一次，然后设置的是触发转盘，但是目前是触发不了的」——
 *   原来的写法是「这个转盘在本次调用链上出现过就拒绝」，可转盘自己抽奖时链上必然已经有它自己，
 *   于是「抽中再抽一次 → 再转一次」这种最常见的玩法从来就没生效过，每次都回「已停止循环抽奖联动」。
 *   改成按次数拦：接着抽是允许的，只是不能没完没了（奖项互相指来指去会转不停）。
 *   和项目「再来一次」的嵌套上限保持一致，都是 6。
 */
const CHAIN_LIMIT = 6
function chainFull(chain: readonly string[], target: Group): boolean {
  let n = 0
  for (const g of chain) if (g === target) n++
  return n >= CHAIN_LIMIT
}
const chainFullReply: Reply = { ok: false, error: `连着抽了 ${CHAIN_LIMIT} 轮，这次先不接着抽了（防止奖项互相触发转不停）` }

function enqueue(group: Group, chain: string[], source?: LotteryDrawSource): Reply {
  loadConfig()
  const state = groups[group]
  if (!state.items.length || state.items.some(i => !i.name)) return {ok:false,error:'请先填好奖项'}
  // 每次抽奖持有配置快照，编辑下一轮奖项不会改变正在播放的结果。
  const items = state.items.map(i => ({...i}))
  // 中心图跟触发礼物走（默认开）：礼物图库里有这张就换上去，没有就沿用固定中心图。
  const giftImg = source?.kind === 'gift' && state.trigger.centerGift !== false && source.gift
    ? findGiftImage(source.gift)?.path
    : undefined
  state.queue.push({id:randomUUID(),items,index:Math.floor(Math.random()*items.length),chain,source,centerImg:giftImg})
  startNext(group)
  return {ok:true,queued:state.queue.length}
}

// 保留原有盘面，按窗口短边缩放。结果区预留高度，长奖名和礼物图不再越界。
const MORANDI = ['#E0D8B0','#D9C7B8','#C9C0D3','#B5C7C4','#D8C3A5','#B8C4BB','#CBB8B1','#AEBFC5']
function premiumWheelBackground(): string {
  const candidates = [
    path.join(app.getAppPath(), 'out', 'renderer', 'entertainment-assets', 'wheel-premium-bg.png'),
    path.join(app.getAppPath(), 'src', 'renderer', 'public', 'entertainment-assets', 'wheel-premium-bg.png'),
    path.join(process.resourcesPath, 'entertainment-assets', 'wheel-premium-bg.png')
  ]
  const file = candidates.find(candidate => fs.existsSync(candidate))
  return file ? mediaUrl(file) : ''
}
function page(kind: LotteryKind, items: LotteryItem[], centerImg?: string): string {
  // 底色跟采集模式走：绿幕模式是抠得掉的绿，原生透明模式是真透明（写死绿色的话，透明模式下奖品视频两侧会露出绿条）
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${titles[kind]}</title>
<style>
:root{--key:${captureSourceBackground()};--ink:#333;--paper:#fff;--border:#ddd;--plate:#008080;--active:#25b1ff;--button:#ff9800;--shadow:rgba(0,0,0,.45);--lucky-red:#ff4444;--lucky-deep:#cc0000;--lucky-gold:#ffd700}
#drag{position:fixed;left:0;top:0;width:100%;height:18px;-webkit-app-region:drag}
/* 奖品视频就铺在转盘上，占满窗口；底色仍是抠得掉的绿，视频比例不同的地方不会露出桌面 */
#prize{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:var(--key);display:none;z-index:120;pointer-events:none}
#prize.on{display:block}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--key);font-family:'Microsoft YaHei',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
#stage{position:relative;flex:none;width:min(calc(100vw - 40px),calc(100vh - 116px));aspect-ratio:1}#wheel{width:100%;height:100%;border:2px solid var(--border);border-radius:50%}
#spin{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:13%;aspect-ratio:1;border:2px solid var(--border);border-radius:50%;background:var(--paper);color:var(--ink);font-size:clamp(12px,3vw,20px);font-weight:bold;cursor:pointer;padding:0}
#pointer{position:absolute;top:1%;left:50%;transform:translateX(-50%);width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-top:26px solid var(--paper);filter:drop-shadow(0 1px 2px var(--shadow));pointer-events:none}
#result{flex:none;min-height:48px;max-width:100%;padding:7px 16px;border-radius:10px;background:var(--shadow);color:var(--paper);font-size:clamp(14px,3.5vw,25px);font-weight:bold;text-align:center;overflow-wrap:anywhere;max-height:88px;overflow:hidden;visibility:hidden}
#grid{width:100%;height:100%;padding:2%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:2%;background:var(--plate);border-radius:8px}.cell{min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5%;padding:5%;border-radius:8px;color:var(--ink);font-size:clamp(12px,3vw,24px);text-align:center;overflow:hidden}.cell img{width:70%;height:56%;object-fit:contain;flex-shrink:1}.cell span{max-width:100%;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.2}.cell.active{outline:3px solid var(--paper);outline-offset:-3px;background:var(--active)!important;color:var(--paper)}.cell.empty{opacity:.55}#grid #spin{position:static;transform:none;width:100%;height:100%;border-radius:8px;background:var(--button);color:var(--paper);border:none}
.lucky{padding:7%;border-radius:50%;background:linear-gradient(135deg,var(--lucky-red),var(--lucky-deep));background-image:url(${scriptJson(premiumWheelBackground())});background-size:cover;background-position:center;box-shadow:0 0 22px rgba(255,190,40,.5)}.lucky canvas{border:2px solid var(--lucky-gold)}.dot{position:absolute;width:1.6%;height:1.6%;border-radius:50%;background:#fff7c8;box-shadow:0 0 5px #ffe394;pointer-events:none;animation:blink 1s infinite}.dot:nth-child(even){animation-delay:.5s}@keyframes blink{50%{opacity:.35}}.lucky #spin{width:30%;background:radial-gradient(circle,#2a2035,#14101c);color:#ffe6a1;border:3px solid #d6ad4e;box-shadow:0 0 18px var(--shadow);overflow:hidden}.lucky #spin img{width:100%;height:100%;object-fit:contain}.lucky #pointer{left:auto;top:50%;right:-5px;transform:translateY(-50%);border-top:18px solid transparent;border-bottom:18px solid transparent;border-left:none;border-right:32px solid #e72d20}.lucky #pointer:after{content:'';position:absolute;right:-33px;top:-10px;border-top:10px solid transparent;border-bottom:10px solid transparent;border-right:20px solid #ffe381}
#stage.nine #grid{padding:4%;gap:2%;border:2px solid #efb84e;border-radius:24px;background:radial-gradient(circle at 50% 45%,#1d4853,#071421 68%);box-shadow:0 0 0 4px #0a1a27,0 0 24px rgba(239,184,78,.35),inset 0 0 34px rgba(0,0,0,.55)}#stage.nine .cell{border:1px solid rgba(255,225,150,.4);border-radius:14px;background:linear-gradient(145deg,color-mix(in srgb,var(--cell-color,#244c58) 60%,#244c58),#102a3a 88%);color:#fff7df;font-weight:700;text-shadow:0 2px 5px rgba(0,0,0,.75);box-shadow:0 6px 14px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.16)}#stage.nine .cell.active{background:linear-gradient(145deg,#ffd66b,#c65a22)!important;border-color:#fff2b0;outline:none;box-shadow:0 0 20px rgba(255,196,75,.95),inset 0 0 18px rgba(255,248,200,.28)}#stage.nine #spin{color:#321507;background:linear-gradient(145deg,#fff0a7,#f4a62a 58%,#bd4e1d);border:2px solid #ffe59a;border-radius:14px;box-shadow:0 6px 16px rgba(0,0,0,.4),inset 0 1px rgba(255,255,255,.8)}
${WIDGET_SKIN_CSS}
body[data-widget-skin]:not([data-widget-skin="classic"]) .lucky {background:var(--ws-bg);background-image:none;box-shadow:inset 0 0 0 2px var(--ws-line),0 0 0 4px var(--ws-bg)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .lucky #wheel {border-color:var(--ws-accent)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .dot {background:var(--ws-accent);box-shadow:none;animation:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) #spin {background:var(--ws-surface);color:var(--ws-text);border-color:var(--ws-accent);box-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) #pointer {border-right-color:var(--ws-accent)}
body[data-widget-skin]:not([data-widget-skin="classic"]) #pointer:after {border-right-color:var(--ws-bg)}
body[data-widget-skin]:not([data-widget-skin="classic"]) #stage.nine #grid {background:var(--ws-bg);border-color:var(--ws-accent);border-radius:var(--ws-radius);box-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) #stage.nine .cell {background:var(--ws-surface);color:var(--ws-text);border-color:var(--ws-line);border-radius:var(--ws-radius);text-shadow:none;box-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) #stage.nine .cell.active {background:var(--ws-accent)!important;color:var(--ws-bg);outline:2px solid var(--ws-text);outline-offset:-3px;box-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) #stage.nine #spin {background:var(--ws-accent);color:var(--ws-bg);border-color:var(--ws-line);box-shadow:none;border-radius:var(--ws-radius)}
body[data-widget-skin]:not([data-widget-skin="classic"]) {--bulb-glow:var(--ws-accent)}
/* 空闲时不出现在直播画面里：整块内容藏起来，窗口只剩纯底色，抠像后直播里干干净净。 */
#stage.idle{visibility:hidden}
#result.idle{visibility:hidden!important}
/* 外圈跑马灯：待机慢闪，转起来时亮点顺着盘跑（盘减速灯也跟着慢），抽中后整圈齐闪几下。
   转动时一帧一换，不能加 transition——补间还没走完就换下一颗，看着就是全程不亮。 */
body[data-bulbs="off"] .dot{animation:none;opacity:.8}
body[data-bulbs="chase"] #stage.spin .dot{animation:none}
body[data-bulbs="chase"] #stage.cheer .dot{animation:cheer .24s steps(1,end) 6}
body[data-bulbs="chase"] #stage.cheer .dot:nth-child(even){animation-delay:.12s}
@keyframes cheer{0%,49%{opacity:1;transform:scale(1.65);box-shadow:0 0 15px 4px var(--bulb-glow,#ffe07a)}50%,100%{opacity:.18;transform:scale(.9);box-shadow:none}}
</style><div id="stage" class="skin-motion-panel ${kind === 'nine' ? 'nine' : 'lucky'}"></div><div id="result" role="status"></div><video id="prize" playsinline></video><div id="drag" title="拖动窗口"></div>
<script>
const kind=${scriptJson(kind === 'wheel' ? 'lucky' : kind)}, palette=${scriptJson(MORANDI)};let items=${scriptJson(displayItems(items))},center=${scriptJson(centerImg ? mediaUrl(centerImg) : '')},fixedCenter=center;
let spinId='',rotation=0,raf=0,active=-1,images=[],seq=0,cells=[],dots=[],cheerTimer=0;
const stage=document.getElementById('stage'),result=document.getElementById('result');
window.__setSkin=skin=>{document.body.dataset.widgetSkin=skin||'classic'};window.__setSkin(${scriptJson(normalizeWidgetSkin(groups[groupOf(kind)].trigger.skin))});
window.__setBulbs=mode=>{document.body.dataset.bulbs=mode||'chase'};window.__setBulbs(${scriptJson(normalizeBulbs(groups[groupOf(kind)].trigger.bulbs))});
// 灯的位置直接从盘的转角推：盘转得快灯就跑得快，盘停下来灯也停，不用另外配一套速度。
// 乘 2 = 灯绕的圈数是盘的两倍，看着更像真抽奖机。
const BULB_GLOW=['none','0 0 8px 1px var(--bulb-glow,#ffd873)','0 0 13px 3px var(--bulb-glow,#ffe07a)'];
const BULB_ALPHA=['.22','.7','1'],BULB_SCALE=['scale(.9)','scale(1.3)','scale(1.75)'];
// 每帧只动状态变了的那几颗（16 颗里通常就 6 颗），阴影是最贵的一笔，不能全量重写
function lightBulb(d,level){if(d.__lv===level)return;d.__lv=level;d.style.opacity=BULB_ALPHA[level];d.style.transform=BULB_SCALE[level];d.style.boxShadow=BULB_GLOW[level]}
// 三个亮点均匀分布着一起跑，每个后面拖一颗次亮的尾巴——单个亮点转太快，眼睛跟不住。
function paintBulbs(rot){if(!dots.length)return;const n=dots.length,head=((Math.round(rot/(Math.PI*2)*n)%n)+n)%n,step=Math.max(1,Math.round(n/3));
  dots.forEach((d,i)=>{let level=0;
    for(let k=0;k<3;k++){const back=((head+k*step-i)%n+n)%n;if(back===0){level=2;break}if(back===1&&level<1)level=1}
    if(d.__lv!==level){d.classList.toggle('lit',level===2);d.classList.toggle('trail',level===1)}
    lightBulb(d,level)})}
function clearBulbs(){dots.forEach(d=>{d.__lv=undefined;d.classList.remove('lit','trail');d.style.removeProperty('opacity');d.style.removeProperty('transform');d.style.removeProperty('box-shadow')})}
// ---- 空闲显隐：平时不出现在直播画面里，礼物触发抽奖才亮出来，抽完留几秒再收 ----
let idleHide=${scriptJson(groups[groupOf(kind)].trigger.idleHide !== false)},holdSec=${scriptJson(normalizeHold(groups[groupOf(kind)].trigger.holdSeconds))},idleTimer=0;
function setIdle(on){const hide=on&&idleHide;stage.classList.toggle('idle',hide);result.classList.toggle('idle',hide)}
window.__setIdle=(hide,hold)=>{idleHide=hide!==false;holdSec=Number(hold)>=0?Number(hold):holdSec;if(!idleHide)setIdle(false);else if(!spinId)setIdle(true)};
// ---- 声音：不配也有内置默认音（转动哒哒声 + 抽中上扬音），也可以指定自己的文件 ----
const sound=${scriptJson(normalizeSound(groups[groupOf(kind)].trigger.sound))};
// 转盘实录：真转盘的转动声（循环）与中奖声，切自素材视频，尾巴的人声播报已经去掉
// 转盘实录：从素材里切出的单声「哒」和中奖声。整段循环会跟画面对不上（素材有它自己的
// 减速节奏），所以只取一声，转盘每过一格触发一次——快慢永远跟着盘走。
const PRESET={tick:${scriptJson(assetUrl('wheel-tick.mp3'))},win:${scriptJson(assetUrl('wheel-win.mp3'))}};
const buffers={};
function loadBuffer(key,url){if(!url||key in buffers)return;buffers[key]=null;
  fetch(url).then(r=>r.arrayBuffer()).then(raw=>{const c=ac();return c?c.decodeAudioData(raw):null}).then(buf=>{buffers[key]=buf||null}).catch(()=>{buffers[key]=null})}
function playBuffer(key,gain){const c=ac(),buf=buffers[key];if(!c||!buf)return false;
  const src=c.createBufferSource();src.buffer=buf;const g=c.createGain();g.gain.value=Math.max(.0001,vol()*(gain||1));
  src.connect(g);g.connect(c.destination);src.start();return true}
function primePreset(){if(sound.mode!=='preset')return;loadBuffer('tick',PRESET.tick);loadBuffer('win',PRESET.win)}
let audioCtx=null,spinAudio=null,lastSector=null;
function ac(){try{if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();return audioCtx}catch(_){return null}}
function vol(){const v=Number(sound.volume);return Math.max(0,Math.min(1,(isNaN(v)?70:v)/100))}
// 转动声：真转盘是指针拨过一格格挡片的「嗒」，用一小段噪声过带通做，比蜂鸣器耐听
function noiseBurst(freqCenter,dur,gain){const c=ac();if(!c)return;const n=Math.max(1,Math.floor(c.sampleRate*dur)),buf=c.createBuffer(1,n,c.sampleRate),data=buf.getChannelData(0);for(let i=0;i<n;i++){const fade=1-i/n;data[i]=(Math.random()*2-1)*fade*fade}const src=c.createBufferSource();src.buffer=buf;const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=freqCenter;bp.Q.value=6;const g=c.createGain();g.gain.value=Math.max(.0001,vol()*gain);src.connect(bp);bp.connect(g);g.connect(c.destination);src.start()}
// 中奖声：颁奖那种钟琴琶音，正弦打底加两个泛音，慢慢化开
function chime(freq,delay,dur,gain){const c=ac();if(!c)return;const t=c.currentTime+delay;[[1,gain],[2,gain*.35],[3,gain*.12]].forEach(pair=>{const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(freq*pair[0],t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,vol()*pair[1]),t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+dur+.05)})}
function playFile(src,loop){if(!src)return null;try{const a=new Audio(src);a.loop=!!loop;a.volume=vol();a.play().catch(()=>{});return a}catch(_){return null}}
function stopSpinAudio(){if(spinAudio){try{spinAudio.pause()}catch(_){}spinAudio=null}}
function soundStart(){lastSector=null;if(sound.mode==='off')return;primePreset();
  // 自定义的整段转动音才循环播；实录是一声一声跟着格子走的
  if(sound.mode==='custom'&&sound.spin){stopSpinAudio();spinAudio=playFile(sound.spin,true)}}
// 自定义转动音是一整段声音，就不要再叠内置的哒哒声
// 转盘每过一格响一下：实录用切出来的那声「哒」，没有素材才退回合成音；
// 自定义的整段转动音在放就不叠了。
function soundTick(){if(sound.mode==='off')return;if(sound.mode==='custom'&&sound.spin)return;
  if(sound.mode==='preset'&&playBuffer('tick',1))return;
  if(sound.mode==='preset'&&PRESET.tick)return;
  noiseBurst(1800,.035,.5);noiseBurst(320,.05,.18)}
// C-E-G-高C 上行，最后一颗留长一点，听着像「中奖啦」而不是警报
function soundWin(){stopSpinAudio();if(sound.mode==='off')return;
  if(sound.mode==='custom'&&sound.win){playFile(sound.win,false);return}
  if(sound.mode==='preset'){if(playBuffer('win',1))return;if(PRESET.win){playFile(PRESET.win,false);return}}
  [[523.25,0,.9],[659.25,.09,.9],[783.99,.18,1],[1046.5,.27,1.6]].forEach(pair=>chime(pair[0],pair[1],pair[2],.16))}
window.__setSound=next=>{Object.assign(sound,next||{});stopSpinAudio();primePreset()};
function report(type,id){document.title='zl-lottery:'+JSON.stringify({type,id,seq:++seq})}
// ---- 奖品视频 / 中奖语音：都在这个窗口里出，直播伴侣只要采这一个来源 ----
const prize=document.getElementById('prize');let prizeTimer=0,chromaTimer=0,voiceAudio=null;
function stopPrizeVideo(){clearTimeout(prizeTimer);prizeTimer=0;clearTimeout(chromaTimer);chromaTimer=0;prize.classList.remove('on');try{prize.pause()}catch(_){}prize.removeAttribute('src');prize.load&&prize.load();if(window.__zlChromaSet)window.__zlChromaSet({enabled:false})}
window.__playPrizeVideo=(url,seconds,id,chroma)=>{if(!url)return;clearTimeout(idleTimer);setIdle(false);stopPrizeVideo();
  prize.src=url;prize.classList.add('on');prize.currentTime=0;prize.play().catch(()=>{});
  // 奖品视频自带绿背景时走内置抠图（参数在设置页），窗口底色就透出来。
  // 延迟开启要能被 stopPrizeVideo 取消：文件打不开时 onerror 会先把抠图关掉，这个定时器再开就留下上一次的画面。
  if(chroma&&window.__zlChromaSet)chromaTimer=setTimeout(function(){chromaTimer=0;if(prize.classList.contains('on'))window.__zlChromaSet({enabled:true})},60);
  const done=()=>{stopPrizeVideo();report('prize-video-done',id);clearTimeout(idleTimer);idleTimer=setTimeout(()=>setIdle(true),Math.max(0,holdSec)*1000)};
  prize.onended=done;prize.onerror=()=>{stopPrizeVideo();report('prize-video-error',id)};
  const max=Number(seconds)||0;if(max>0)prizeTimer=setTimeout(done,max*1000)};
window.__stopPrizeVideo=()=>stopPrizeVideo();
// 语音在放的时候别收盘：语音比停留秒数长的话，转盘先收走、视频一来又冒出来，看着一闪一闪
window.__playVoice=(url,id)=>{if(!url){report('voice-done',id);return}
  try{if(voiceAudio){voiceAudio.pause();voiceAudio=null}
    clearTimeout(idleTimer);
    const a=new Audio(url);voiceAudio=a;a.volume=vol()||1;
    const done=()=>{if(voiceAudio===a)voiceAudio=null;report('voice-done',id);
      if(!prize.classList.contains('on')){clearTimeout(idleTimer);idleTimer=setTimeout(()=>setIdle(true),Math.max(0,holdSec)*1000)}};
    a.onended=done;a.onerror=done;a.play().catch(done)}
  catch(_){report('voice-done',id)}};
function imageFor(src){const im=new Image();im.onload=()=>draw(rotation);im.src=src;return im}
function contrast(c){const m=/^#([a-f0-9]{6})$/i.exec(c||'');if(!m)return '#333';const n=parseInt(m[1],16);return ((n>>16)*.299+((n>>8)&255)*.587+(n&255)*.114)>155?'#252525':'#ffffff'}
function fit(ctx,text,max){while(ctx.measureText(text).width>max&&text.length>1)text=text.slice(0,-2)+'…';return text}
function draw(rot){if(kind==='nine')return;const canvas=document.getElementById('wheel');if(!canvas)return;const ctx=canvas.getContext('2d'),R=300,arc=Math.PI*2/Math.max(1,items.length),base=kind==='lucky'?0:-Math.PI/2-arc/2;ctx.clearRect(0,0,600,600);items.forEach((it,i)=>{const a=base+i*arc+rot;ctx.beginPath();ctx.moveTo(R,R);ctx.arc(R,R,R-3,a,a+arc);ctx.closePath();ctx.fillStyle=it.color||palette[i%8];ctx.fill();ctx.save();ctx.clip();ctx.translate(R,R);ctx.rotate(a+arc/2);const im=images[i];if(im&&im.complete&&im.naturalWidth){const s=Math.min(60/im.naturalWidth,60/im.naturalHeight);ctx.save();ctx.translate(R*.78,0);ctx.rotate(-a-arc/2);ctx.drawImage(im,-im.naturalWidth*s/2,-im.naturalHeight*s/2,im.naturalWidth*s,im.naturalHeight*s);ctx.restore()}ctx.fillStyle=contrast(it.color||palette[i%8]);ctx.textAlign='center';ctx.font='bold 20px "Microsoft YaHei"';const textR=R*(im?.52:.64),max=items.length>2?Math.min(im?106:155,2*textR*Math.sin(arc/2)*.94):155;ctx.translate(textR,0);ctx.rotate(-a-arc/2);ctx.fillText(fit(ctx,it.name,max),0,7);ctx.restore()})}
function build(){cancelAnimationFrame(raf);spinId='';images=items.map(i=>i.img?imageFor(i.img):null);stage.replaceChildren();if(kind==='nine'){const grid=document.createElement('div');grid.id='grid';[0,1,2,7,-1,3,6,5,4].forEach(i=>{if(i===-1){const b=document.createElement('button');b.id='spin';b.textContent='开始';b.onclick=()=>report('spin','');grid.appendChild(b);return}const c=document.createElement('div');c.className='cell'+(items[i]?'':' empty');c.dataset.idx=i;c.style.setProperty('--cell-color',items[i]?.color||palette[i]);if(items[i]?.img){const im=document.createElement('img');im.src=items[i].img;c.appendChild(im)}const label=document.createElement('span');label.textContent=items[i]?.name||'—';c.appendChild(label);grid.appendChild(c)});stage.appendChild(grid);cells=Array.from(grid.querySelectorAll('.cell'));dots=[]}else{const c=document.createElement('canvas');c.id='wheel';c.width=c.height=600;stage.appendChild(c);const b=document.createElement('button');b.id='spin';b.textContent='开始';if(kind==='lucky'&&center){b.textContent='';const im=document.createElement('img');im.src=center;b.appendChild(im)}b.onclick=()=>report('spin','');stage.appendChild(b);const p=document.createElement('div');p.id='pointer';stage.appendChild(p);if(kind==='lucky'){for(let i=0;i<16;i++){const d=document.createElement('i'),a=i/16*Math.PI*2;d.className='dot';d.style.left=(49.1+Math.cos(a)*48)+'%';d.style.top=(49.1+Math.sin(a)*48)+'%';stage.appendChild(d)}}dots=Array.from(stage.querySelectorAll('.dot'));draw(rotation)}}
window.__setItems=(next,img)=>{items=next;fixedCenter=img||'';center=fixedCenter;rotation=0;result.style.visibility='hidden';result.textContent='';build()};
window.__complete=p=>{if(spinId!==p.id)return;cancelAnimationFrame(raf);stage.classList.remove('spin');clearBulbs();if(dots.length){stage.classList.add('cheer');clearTimeout(cheerTimer);cheerTimer=setTimeout(()=>stage.classList.remove('cheer'),1500)}if(kind!=='nine'){const arc=Math.PI*2/p.items.length;rotation=kind==='lucky'?-(p.index+.5)*arc:-p.index*arc;draw(rotation)}result.textContent='抽中：'+p.items[p.index].name;result.style.visibility='visible';if(kind==='nine'){cells.forEach(el=>el.classList.toggle('active',Number(el.dataset.idx)===p.index))}spinId='';soundWin();clearTimeout(idleTimer);idleTimer=setTimeout(()=>setIdle(true),Math.max(0,holdSec)*1000)};
window.__startSpin=p=>{items=p.items;center=p.center!==undefined?p.center:fixedCenter;build();spinId=p.id;result.style.visibility='hidden';clearTimeout(cheerTimer);clearTimeout(idleTimer);setIdle(false);soundStart();stage.classList.remove('cheer');stage.classList.add('spin');const from=rotation,arc=Math.PI*2/items.length,target=kind==='lucky'?-(p.index+.5)*arc:-p.index*arc,norm=x=>(x%(Math.PI*2)+Math.PI*2)%(Math.PI*2),to=from+Math.PI*2*5+norm(target-from);const t0=performance.now()-Math.max(0,Date.now()-p.startedAt);function tick(now){if(spinId!==p.id)return;const t=Math.min(1,(now-t0)/p.duration),u=1-Math.pow(1-t,3);if(kind==='nine'){const next=t===1?p.index:Math.floor(u*(items.length*4+p.index))%items.length;if(next!==active&&lastSector!==null)soundTick();if(lastSector===null)lastSector=0;active=next;cells.forEach(el=>el.classList.toggle('active',Number(el.dataset.idx)===active))}else{rotation=from+(to-from)*u;draw(rotation);paintBulbs(rotation);
    // 「哒」声按外圈 16 颗灯珠的固定间隔响（真转盘是指针拨过一根根挡片），不按奖项格算：
    // 奖项少（2 个）时按格响一圈只响两下、越转越慢越稀，听着一卡一卡的
    const sector=Math.floor(rotation/(Math.PI*2/16));if(sector!==lastSector){if(lastSector!==null)soundTick();lastSector=sector}}if(t<1)raf=requestAnimationFrame(tick);else{window.__complete(p);report('done',p.id)}}raf=requestAnimationFrame(tick)};
build();setIdle(true);
</script></html>`
}

function openWidget(kind: LotteryKind, items: LotteryItem[], centerImg?: string): Reply {
  loadConfig()
  const group=groupOf(kind), state=groups[group]
  const updated=configureLottery(kind,state.trigger,items,centerImg)
  if(!updated.ok)return updated
  if(!state.items.length||state.items.some(i=>!i.name))return {ok:false,error:'请先填好奖项'}
  const old=windows[kind]
  if(old&&!old.isDestroyed()){old.show();return {ok:true}}
  try{
    const tmp=path.join(app.getPath('userData'),`lottery-${kind}.html`)
    fs.writeFileSync(tmp,page(kind,state.items,state.centerImg))
    // 窗口已经存在（含停放中的待机窗）就不强写默认尺寸：主播调过的大小要保住（复用分支会跳过 setSize）
    const exists=captureWindowExists(titles[kind])
    const win=createCaptureOutputWindow({...(exists?{}:{width:kind==='lucky'?680:560,height:kind==='lucky'?720:620}),title:titles[kind],frame:false,alwaysOnTop:outputsAlwaysOnTop(),resizable:true,skipTaskbar:true,minWidth:260,minHeight:300,webPreferences:{webSecurity:false,backgroundThrottling:false}})
    windows[kind]=win
    captureTitle(win,titles[kind]);registerOutputWindow(win)
    onOutputWindowEvent(win, 'page-title-updated',(_event,title)=>{
      if(windows[kind]!==win)return
      if(!title.startsWith('zl-lottery:'))return
      try{const message=JSON.parse(title.slice('zl-lottery:'.length))
        if(message.type==='spin')lotterySpin(kind)
        else if(message.type==='done')void finish(group,String(message.id))
        else if(message.type==='voice-done')stageWaiters.get('voice:'+String(message.id))?.finish()
        else if(message.type==='prize-video-done')stageWaiters.get('prize:'+String(message.id))?.finish()
        else if(message.type==='prize-video-error')stageWaiters.get('prize:'+String(message.id))?.finish('视频无法播放，请检查文件格式或重新选择')
      }catch{/* 无效消息 */}
    })
    onOutputPageEvent(win, 'did-finish-load',()=>{if(windows[kind]!==win)return;ready.add(kind);if(state.active&&state.last?.phase==='started')void win.webContents.executeJavaScript(`window.__startSpin(${scriptJson({...state.last,items:displayItems(state.last.items)})})`).catch(()=>{})})
    onOutputWindowClosed(win,()=>releaseWindow(kind,win))
    void win.loadFile(tmp)
    return {ok:true}
  }catch(error){return {ok:false,error:'打开抽奖窗口失败：'+(error as Error).message}}
}
function releaseWindow(kind: LotteryKind, win: BrowserWindow): void {
  if (windows[kind] !== win) return
  ready.delete(kind)
  delete windows[kind]
  const group = groupOf(kind), state = groups[group]
  if (!Object.keys(windows).some(k => groupOf(k as LotteryKind) === group)) {
    clearTimeout(state.timer)
    state.active = undefined
    state.queue = []
    state.finishing = false
    state.epoch = (state.epoch || 0) + 1
    for (const waiter of [...stageWaiters.values()]) if (waiter.group === group) waiter.finish()
    notify({kind:group,id:randomUUID(),phase:'closed',index:-1,items:state.items,duration:0,startedAt:Date.now(),queued:0})
  }
}
export function openWheelWindow(items:LotteryItem[]):Reply{return openWidget('lucky',items)}
export function openNineGridWindow(items:LotteryItem[]):Reply{return openWidget('nine',items)}
export function openLuckyWindow(items:LotteryItem[],centerImg?:string):Reply{return openWidget('lucky',items,centerImg)}
export function closeLotteryWindow(kind:LotteryKind):Reply{const canonical=kind==='wheel'?'lucky':kind,win=windows[canonical];if(win){releaseWindow(canonical,win);win.close()}return {ok:true}}
export function lotterySpin(kind:LotteryKind):Reply{
  const group=groupOf(kind), chain=currentToolChain()
  return chainFull(chain, group) ? chainFullReply : enqueue(group,[...chain,group])
}
export function lotteryState(){loadConfig();const wheel=!!windows.lucky&&!windows.lucky.isDestroyed();return {wheel,nine:!!windows.nine&&!windows.nine.isDestroyed(),lucky:wheel,draws:{wheel:groups.wheel.last,nine:groups.nine.last}}}
export function configureLottery(kind:LotteryKind,value?:Partial<LotteryTrigger>,items?:LotteryItem[],centerImg?:string):Reply{
  loadConfig();const group=groupOf(kind),state=groups[group]
  if(items && items.length > (group==='nine'?8:64)) return {ok:false,error:group==='nine'?'九宫格最多设置 8 个奖项':'转盘最多设置 64 个奖项'}
  const previous={items:state.items,centerImg:state.centerImg,trigger:state.trigger}
  try{
    if(value)state.trigger={
      autoSpin:value.autoSpin===true,
      triggerGift:String(value.triggerGift||'').trim(),
      skin:normalizeWidgetSkin(value.skin ?? state.trigger.skin),
      // 外观/声音/显隐这几项没传就沿用原来的，别被只改触发礼物的保存顺手清掉
      bulbs:normalizeBulbs(value.bulbs ?? state.trigger.bulbs),
      sound:normalizeSound(value.sound ?? state.trigger.sound),
      idleHide:(value.idleHide ?? state.trigger.idleHide) !== false,
      holdSeconds:normalizeHold(value.holdSeconds ?? state.trigger.holdSeconds),
      // ★这两项以前漏在白名单外：关掉「视频铺在转盘窗口里播」后重启客户端又变回开着
      stageVideo:(value.stageVideo ?? state.trigger.stageVideo) !== false,
      centerGift:(value.centerGift ?? state.trigger.centerGift) !== false
    }
    if(items)state.items=cleanItems(items)
    if(centerImg!==undefined)state.centerImg=centerImg
    saveConfig()
    if(previous.trigger.skin !== state.trigger.skin) callWindows(group,`window.__setSkin&&window.__setSkin(${scriptJson(state.trigger.skin)})`)
    if(previous.trigger.bulbs !== state.trigger.bulbs) callWindows(group,`window.__setBulbs&&window.__setBulbs(${scriptJson(state.trigger.bulbs)})`)
    if(JSON.stringify(previous.trigger.sound) !== JSON.stringify(state.trigger.sound)) callWindows(group,`window.__setSound&&window.__setSound(${scriptJson(state.trigger.sound)})`)
    if(previous.trigger.idleHide !== state.trigger.idleHide || previous.trigger.holdSeconds !== state.trigger.holdSeconds) callWindows(group,`window.__setIdle&&window.__setIdle(${scriptJson(state.trigger.idleHide !== false)},${scriptJson(state.trigger.holdSeconds)})`)
    const changed=JSON.stringify(previous.items)!==JSON.stringify(state.items)||previous.centerImg!==state.centerImg
    if(!state.active&&!state.finishing&&changed){
      notify({kind:group,id:randomUUID(),phase:'configured',index:-1,items:state.items,duration:0,startedAt:Date.now(),queued:state.queue.length})
      callWindows(group,`window.__setItems(${scriptJson(displayItems(state.items))},${scriptJson(state.centerImg?mediaUrl(state.centerImg):'')})`)
    }
    return {ok:true}
  }catch(error){Object.assign(state,previous);return {ok:false,error:'保存抽奖配置失败：'+(error as Error).message}}
}
export function handleLotteryGift(event:ConnectorEvent):void{
  if(event.type!=='gift'||!event.giftName)return
  loadConfig()
  for(const group of ['wheel','nine'] as Group[]){const trigger=groups[group].trigger;if(trigger.autoSpin&&(!trigger.triggerGift||giftNamesEqual(trigger.triggerGift,event.giftName))&&Object.keys(windows).some(k=>groupOf(k as LotteryKind)===group)){
    // 连接器已经将连击转成增量；一份礼物一轮，忙时顺序排队。
    const received=Number(event.count)
    const count=Number.isFinite(received)?Math.max(1,Math.floor(received)):1
    for(let i=0;i<count;i++)enqueue(group,[group],{kind:'gift',user:String(event.sender||''),gift:String(event.giftName||'')})
  }}
}
app.on('before-quit',()=>{for(const state of Object.values(groups))clearTimeout(state.timer);for(const win of Object.values(windows))win?.close()})
