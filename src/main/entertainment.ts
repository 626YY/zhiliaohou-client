import {cardModeEnabled} from './card-provider'
import {cardEpoch} from './card-epoch'
// 娱乐助手：礼物触发规则存储 + 动作执行。
// 规则用 createCollection 存 userData/data/entertainment_rules.json；
// 键鼠模拟用 powershell WScript.Shell SendKeys + user32 mouse_event（免 robotjs 原生依赖）；
// 脚本用 child_process spawn。失败静默，绝不影响直播。
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { app, dialog, BrowserWindow, clipboard, nativeImage, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'
import { isRealGift } from '../shared/giftFilter'
import { createCollection } from './db'
import { wheelLiveDir } from './bridge'
import { getSettings } from './settings'
import {
  Ipc,
  type ConnectorEvent,
  type EntertainmentAction,
  type EntertainmentGiftImage,
  type EntertainmentPreset,
  type EntertainmentRule,
  type EntertainmentSystemCmd,
  type ExecQueueItem,
  type ExecQueueSnapshot,
  type GreenScreenSlot,
  type MouseActionType
} from '@shared/types'
import { ruleActionLabel, actionLabel, SYSTEM_LABELS } from '../shared/entertainmentLabels'
import { announce } from './announce'
import { spokenDuration } from '../shared/announce'
import { runPowerShell } from './ps-runner'
import { parseSpecialParam, type SpecialViewer } from '../shared/specialGames'
import { actionDelayMs, normalizeExtraActions, ruleActions, withActionDefaults } from '../shared/entertainmentActions'
import { giftNamesEqual } from './connector-events'
import { runObsAction } from './obs-service'
import { applyPinyouRules } from './pinyou-rules'

const rules = createCollection<EntertainmentRule>('entertainment_rules')
const giftAccumulators = new Map<string, number>()

export interface ManagedEntertainmentSound {
  ready: () => Promise<void>
  start: () => Promise<void>
  state: () => Promise<{ status: string; currentTime: number; error?: string }>
  stop: () => Promise<void>
}

// 组合事件需要知道音效何时开始/结束，不能只广播后忽略播放错误。
// 音频放在调用方已有挂件里，不创建新窗口；token 只停止本次事件的音效。
export function createManagedEntertainmentSound(target: BrowserWindow, file: string, volume: number, token: string): ManagedEntertainmentSound {
  const raw = String(file || '').trim()
  if (!raw) throw new Error('音效文件未选择')
  if (!/^(?:https?:|data:)/i.test(raw)) {
    const local = /^file:/i.test(raw) ? fileURLToPath(raw) : raw
    if (!fs.existsSync(local) || !fs.statSync(local).isFile()) throw new Error('音效文件不存在，请重新选择')
  }
  const url = /^(?:https?:|file:|data:)/i.test(raw) ? raw : pathToFileURL(raw).href
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
  const key = json(token)
  const run = (body: string) => {
    if (target.isDestroyed()) return Promise.reject(new Error('时间窗口已关闭'))
    return target.webContents.executeJavaScript(body)
  }
  return {
    ready: async () => {
      const result = await run(`(async()=>{
        const sounds=window.__zlManagedSounds||(window.__zlManagedSounds={}),id=${key};
        const audio=new Audio(),entry={audio,status:'loading',error:'',abort:null};sounds[id]=entry;
        audio.preload='auto';audio.volume=${Math.max(0, Math.min(1, volume / 100))};
        audio.addEventListener('ended',()=>{entry.status='ended'});
        audio.addEventListener('error',()=>{entry.status='error';entry.error='音效无法播放，请检查文件格式或重新选择'});
        const ready=new Promise(resolve=>{let done=false;const finish=(ok)=>{if(done)return;done=true;clearTimeout(timer);resolve({ok,error:entry.error})};
          const timer=setTimeout(()=>{entry.error='音效加载超时';entry.status='error';finish(false)},10000);
          entry.abort=()=>{entry.error='已取消';finish(false)};
          audio.addEventListener('canplay',()=>{entry.status='ready';finish(true)},{once:true});
          audio.addEventListener('error',()=>finish(false),{once:true});
        });audio.src=${json(url)};audio.load();return ready;
      })()`)
      if (!result?.ok) throw new Error(result?.error || '音效加载失败')
    },
    start: async () => {
      const result = await run(`(async()=>{const e=window.__zlManagedSounds?.[${key}];if(!e)return {ok:false,error:'音效已取消'};try{await e.audio.play();e.status='playing';return {ok:true}}catch(error){e.status='error';e.error='音效播放失败：'+error.message;return {ok:false,error:e.error}}})()`)
      if (!result?.ok) throw new Error(result?.error || '音效播放失败')
    },
    state: async () => run(`(()=>{const e=window.__zlManagedSounds?.[${key}];return e?{status:e.status,currentTime:e.audio.currentTime,error:e.error}:{status:'error',currentTime:0,error:'音效已被停止'}})()`),
    stop: async () => {
      if (target.isDestroyed()) return
      await run(`(()=>{const e=window.__zlManagedSounds?.[${key}];if(e){e.abort?.();e.audio.pause();e.audio.removeAttribute('src');e.audio.load();delete window.__zlManagedSounds[${key}]}})()`).catch(() => {})
    }
  }
}
// 保护主播「拒绝接受礼物」：暂停期间收到的事件不触发任何规则（也不累计）
let rulesPaused = false

export function setRulesPaused(paused: boolean): { ok: boolean; paused: boolean } {
  rulesPaused = !!paused
  return { ok: true, paused: rulesPaused }
}

export function rulesPausedState(): boolean {
  return rulesPaused
}

export function listRules(): EntertainmentRule[] {
  return rules.all()
}

// 仅礼物触发要求绑定礼物名；关注、点赞、进场及全量弹幕规则允许为空。
function hasRuleTrigger(rule: EntertainmentRule): boolean {
  return (rule.triggerType || 'gift') !== 'gift' || !!String(rule.giftName || '').trim()
}

export function addRule(rule: EntertainmentRule): { ok: boolean; id?: string; error?: string } {
  // ★礼物名允许留空：导入品游项目建的规则就是「有规则名、还没绑礼物」的状态。
  //   但它必须是停用的（下面 enabled 强制 false），而且触发匹配会跳过 —— 空礼物名绝不能匹配所有礼物。
  if (!rule || (!hasRuleTrigger(rule) && !rule.name?.trim())) {
    return { ok: false, error: '规则名和礼物名不能都为空' }
  }
  const id = rule.id || randomUUID()
  rules.insert({
    ...withActionDefaults(rule),
    id,
    giftName: String(rule.giftName || '').trim(),
    times: Math.max(1, Math.trunc(Number(rule.times) || 1)),
    extraActions: normalizeExtraActions(rule.extraActions),
    // 未绑定礼物的导入规则保持停用；非礼物规则按主播选择的开关保存。
    enabled: hasRuleTrigger(rule) && rule.enabled !== false
  })
  rulesCache = null
  return { ok: true, id }
}

export function updateRule(rule: EntertainmentRule): { ok: boolean; error?: string } {
  if (!rule?.id) return { ok: false, error: '缺少规则 id' }
  // 没绑礼物就想启用：直说，不然主播会以为开了却一直不触发（空礼物名在匹配时是跳过的）
  if (rule.enabled !== false && !hasRuleTrigger(rule)) {
    return { ok: false, error: '先填礼物名再启用：这条规则还没绑触发的礼物' }
  }
  // extraActions 永远整个数组覆盖：编辑器删光附加动作时也要把旧的清掉（集合 update 是合并写）
  rules.update(rule.id, { ...withActionDefaults(rule), extraActions: normalizeExtraActions(rule.extraActions) })
  rulesCache = null
  // 改了数量/倍数/触发方式后累计从零算：规则 ×100 已攒 99 再改成 ×1，下一个小心心不能按 100 次触发
  giftAccumulators.delete(rule.id)
  return { ok: true }
}

/** 规则分组一览：每组几条、开着几条 —— 界面按组显示、组开关要用 */
export function ruleGroups(): { group: string; total: number; enabled: number }[] {
  const map = new Map<string, { total: number; enabled: number }>()
  for (const r of allRules()) {
    const g = String(r.group || '').trim()
    if (!g) continue
    const cur = map.get(g) || { total: 0, enabled: 0 }
    cur.total += 1
    if (r.enabled !== false) cur.enabled += 1
    map.set(g, cur)
  }
  return [...map].map(([group, v]) => ({ group, ...v })).sort((a, b) => a.group.localeCompare(b.group, 'zh'))
}

/**
 * 整组开关。
 * ★礼物规则必须绑定礼物名；非礼物规则按各自触发来源启用，
 *   并把「因为没填礼物名而没能开起来」的条数报回去 —— 否则主播会以为开了却不触发。
 */
export function toggleRuleGroup(group: string, on: boolean): { ok: boolean; changed: number; skipped: number } {
  const g = String(group || '').trim()
  if (!g) return { ok: false, changed: 0, skipped: 0 }
  let changed = 0
  let skipped = 0
  for (const r of allRules()) {
    if (String(r.group || '').trim() !== g) continue
    if (on && !hasRuleTrigger(r)) {
      skipped += 1
      continue
    }
    if ((r.enabled !== false) === on) continue
    rules.update(r.id, { enabled: on })
    changed += 1
  }
  if (changed) rulesCache = null
  return { ok: true, changed, skipped }
}

// ---- 预设：「今晚开哪几个组」----
const presets = createCollection<EntertainmentPreset>('ent-presets')

export function listPresets(): EntertainmentPreset[] {
  return presets.all()
}

export function savePreset(value: Partial<EntertainmentPreset>): { ok: boolean; id?: string; error?: string } {
  const name = String(value?.name || '').trim()
  if (!name) return { ok: false, error: '预设名不能为空' }
  const groups = [...new Set((Array.isArray(value?.groups) ? value.groups : []).map((g) => String(g || '').trim()).filter(Boolean))]
  const existing = presets.all().find((p) => p.id === value?.id || p.name === name)
  const id = existing?.id || randomUUID()
  const row = { id, name, groups, updatedAt: Date.now() }
  if (existing) presets.update(id, row)
  else presets.insert(row)
  return { ok: true, id }
}

export function removePreset(id: string): { ok: boolean } {
  presets.remove(String(id || ''))
  return { ok: true }
}

/** 应用预设：预设里的组全开，其它有分组的全关。没分组的规则不动（主播手建的别乱改） */
export function applyPreset(id: string): { ok: boolean; error?: string; on: number; off: number; skipped: number } {
  const preset = presets.all().find((p) => p.id === String(id || ''))
  if (!preset) return { ok: false, error: '找不到这个预设', on: 0, off: 0, skipped: 0 }
  const want = new Set(preset.groups.map((g) => String(g || '').trim()).filter(Boolean))
  let on = 0
  let off = 0
  let skipped = 0
  for (const r of allRules()) {
    const g = String(r.group || '').trim()
    if (!g) continue
    const shouldOn = want.has(g)
    if (shouldOn && !hasRuleTrigger(r)) {
      skipped += 1
      if (r.enabled !== false) { rules.update(r.id, { enabled: false }); off += 1 }
      continue
    }
    if ((r.enabled !== false) === shouldOn) continue
    rules.update(r.id, { enabled: shouldOn })
    if (shouldOn) on += 1
    else off += 1
  }
  rulesCache = null
  return { ok: true, on, off, skipped }
}

export function removeRule(id: string): { ok: boolean } {
  rules.remove(id)
  rulesCache = null
  giftAccumulators.delete(id)
  return { ok: true }
}

export function importPinyouRules(incoming: EntertainmentRule[], replace: boolean) {
  const result = applyPinyouRules(incoming, replace)
  rulesCache = null
  if (result.ok) for (const id of result.removedIds || []) giftAccumulators.delete(id)
  return result
}

// 规则表缓存：每条连接器事件（弹幕风暴时每秒几十条）都 readFileSync+JSON.parse 一遍规则文件太浪费；写入处统一置空
let rulesCache: EntertainmentRule[] | null = null
function allRules(): EntertainmentRule[] {
  if (!rulesCache) rulesCache = rules.all()
  return rulesCache
}

// options：项目脚本 / 项目条目动作里再触发项目时带着（当前项目目录、嵌套层数、取消判断、接着播的窗口）；
// viewer：触发这条规则的观众（特色整蛊的提示条/来电卡片要显示昵称和头像）
// specialTimes：特色整蛊「增加」类动作合并执行的次数（见 enqueueRuns）
async function executeAction(action: EntertainmentAction, options?: { chroma?: boolean; isCurrent?: () => boolean; projectBase?: string; projectDepth?: number; videoSlot?: GreenScreenSlot; viewer?: SpecialViewer; specialTimes?: number }): Promise<void> {
  if (action.actionType === 'key' && action.keySeq) {
    sendKeys(action.keySeq)
  } else if (action.actionType === 'script' && action.scriptPath) {
    runScript(action.scriptPath)
  } else if (action.actionType === 'sound' && action.soundPath) {
    // 播放由常驻 App 根组件负责，页面切换不会截断规则；主进程只负责调度。
    for (const target of BrowserWindow.getAllWindows()) {
      if (!target.isDestroyed()) target.webContents.send(Ipc.EntertainmentSound, { path: action.soundPath, mode: action.soundMode === 'unique' ? 'unique' : 'sync', volume: action.soundVolume })
    }
  } else if (action.actionType === 'system' && action.systemCmd) {
    systemAction(action.systemCmd, action.systemParam)
  } else if (action.actionType === 'command' && action.commandCmd) {
    // chroma：这条动作自己勾了就按它来，没勾则沿用带出它的那条（项目视频扣了绿背景，它带出来的也该扣）
    const result = await entertainmentCommand(action.commandCmd, action.commandParam, {
      chroma: action.chroma === true || options?.chroma === true,
      isCurrent: options?.isCurrent, projectBase: options?.projectBase, projectDepth: options?.projectDepth, videoSlot: options?.videoSlot,
      viewer: options?.viewer, specialTimes: options?.specialTimes
    })
    if (!result.ok && result.error) console.warn(`[entertainment] 动作「${action.commandCmd}」没执行成功：${result.error}`)
  } else if (action.actionType === 'obs') {
    const result = await runObsAction(action)
    if (!result.ok) console.warn('[entertainment] OBS 动作失败：', result.error)
  }
}

// 一条规则 = 主动作 + 若干附加动作，按顺序执行；每个动作可带 delayMs（先等多久再做）。
// 一个动作失败不影响后面的：主播要的是「视频照放、按键照按」，不是整条规则一起哑掉。
async function executeRule(rule: EntertainmentRule, viewer?: SpecialViewer, specialTimes = 1): Promise<void> {
  const epoch=cardEpoch()
  for (const action of ruleActions(rule)) {
    const wait = actionDelayMs(action)
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait))
    try {
      if(cardModeEnabled()){
        if(cardEpoch()!==epoch)return
        await (await import('./card-auth')).cardRequireRecent('platform:assistant')
        if(cardEpoch()!==epoch)return
      }
      await executeAction(action,{isCurrent:()=>!cardModeEnabled()||cardEpoch()===epoch,viewer,specialTimes})
    } catch (e) {
      console.warn(`[entertainment] 规则「${rule.giftName}」的动作执行失败：`, (e as Error)?.message || e)
    }
  }
}

// ===== 整蛊排队（参考软件「整蛊排队」：即时 / 插队）=====
// 观众一次可以点 99、999 个，数量不设上限（用户铁律：任何东西都不要有上限）。
// 但同一瞬间甩出上千次 SendKeys / spawn 会把机器打死，所以改成 FIFO 队列匀速执行：
// 全部入队、只延后不丢弃。老实现把礼物数钳 500、单次触发钳 50 次，多出来的直接吞掉。
interface QueuedExec {
  rule: EntertainmentRule
  queueMode: 'normal' | 'jump'
  priority: number
  seq: number
  count: number // 同一批还剩多少次；不为大额连击逐份创建对象。
  // 排队展示窗口要看的：谁送的什么、要执行什么
  gift: string
  sender: string
  image: string
  // 送礼人头像（特色整蛊的提示条/来电卡片用）
  avatar: string
}
const execQueue: QueuedExec[] = []
let execTimer: ReturnType<typeof setInterval> | null = null
let execSeq = 0
// 出队节拍（毫秒）。可调，0 = 不排队全速执行。
let execIntervalMs = 120
// 正在执行的那条（排队窗口高亮用），执行完一个节拍后清掉
let running: QueuedExec | null = null
let runningTimer: ReturnType<typeof setTimeout> | null = null
const queueListeners = new Set<(snapshot: ExecQueueSnapshot) => void>()

function toQueueItem(item: QueuedExec): ExecQueueItem {
  return { id: item.seq, gift: item.gift, sender: item.sender, image: item.image, action: ruleActionLabel(item.rule), priority: item.priority }
}

// 快照只带前 60 条（挂件/页面最多显示 30 条），total 给「排队 N 条」用：以前每次入队/出队都把整队（连击 9999 条）序列化并广播到十几个窗口
const SNAPSHOT_ROWS = 60
const MAX_INSTANT = 30
export function execQueueSnapshot(): ExecQueueSnapshot {
  const pending: ExecQueueItem[] = []
  for (const batch of execQueue) {
    const take = Math.min(batch.count, SNAPSHOT_ROWS - pending.length)
    for (let i = 0; i < take; i++) pending.push(toQueueItem({ ...batch, seq: batch.seq + i }))
    if (pending.length >= SNAPSHOT_ROWS) break
  }
  return { running: running ? toQueueItem(running) : null, pending, total: execQueueLength() }
}

export function onExecQueueChange(handler: (snapshot: ExecQueueSnapshot) => void): () => void {
  queueListeners.add(handler)
  return () => queueListeners.delete(handler)
}

function emitQueueNow(): void {
  const snapshot = execQueueSnapshot()
  for (const handler of [...queueListeners]) {
    try { handler(snapshot) } catch { /* 一个订阅方出错不能拖垮执行队列 */ }
  }
}
// 广播节流：100ms 内多次变化只发一次（尾沿），礼物成串来时不至于每毫秒都在序列化+跨进程发
let emitTimer: ReturnType<typeof setTimeout> | null = null
let emitPending = false
function emitQueue(): void {
  if (emitTimer) {
    emitPending = true
    return
  }
  emitQueueNow()
  emitTimer = setTimeout(() => {
    emitTimer = null
    if (emitPending) {
      emitPending = false
      emitQueue()
    }
  }, 100)
}

export function setExecInterval(ms: number): void {
  execIntervalMs = Math.max(0, Math.trunc(Number(ms) || 0))
  if (execTimer) {
    clearInterval(execTimer)
    execTimer = null
    pumpQueue()
  }
}

export function execQueueLength(): number {
  return execQueue.reduce((total, batch) => total + batch.count, 0)
}

// 清空排队礼物（保护主播「清空排队礼物」/ 排队窗口的清空按钮）：正在执行的不管，后面的全丢
export function clearExecQueue(): { ok: boolean; cleared: number } {
  const cleared = execQueueLength()
  execQueue.length = 0
  emitQueue()
  return { ok: true, cleared }
}

// 跳过下一条（参考「拯救主播：跳过当前动作 / 继续下个操作」）：丢掉队头 n 条，不执行
export function skipExecQueue(count = 1): { ok: boolean; skipped: number } {
  const n = Math.max(1, Math.trunc(Number(count) || 1))
  let skipped = 0
  while (execQueue.length && skipped < n) {
    const batch = execQueue[0]
    const take = Math.min(batch.count, n - skipped)
    batch.count -= take
    batch.seq += take
    skipped += take
    if (!batch.count) execQueue.shift()
  }
  emitQueue()
  return { ok: true, skipped }
}

function drainOne(): void {
  const batch = execQueue[0]
  if (!batch) {
    if (execTimer) {
      clearInterval(execTimer)
      execTimer = null
    }
    return
  }
  const next = { ...batch, count: 1 }
  batch.count--
  batch.seq++
  if (!batch.count) execQueue.shift()
  running = next
  if (runningTimer) clearTimeout(runningTimer)
  // 「正在执行」至少亮 0.8 秒，节拍太快时观众才看得清
  runningTimer = setTimeout(() => {
    if (running === next) {
      running = null
      emitQueue()
    }
  }, Math.max(800, execIntervalMs))
  emitQueue()
  void executeRule(next.rule, { name: next.sender, avatar: next.avatar, gift: next.gift })
}

function pumpQueue(): void {
  if (execTimer) return
  drainOne() // 头一次立刻执行，观众看得到即时反馈
  if (!execQueue.length) return
  execTimer = setInterval(drainOne, execIntervalMs || 1)
}

const MERGEABLE_SPECIAL_OPS = new Set(['add', 'show', 'reduce', 'tornado'])
function mergeableSpecialRule(rule: EntertainmentRule): boolean {
  const actions = ruleActions(rule)
  if (actions.length !== 1) return false
  const a = actions[0]
  if (a.actionType !== 'command' || actionDelayMs(a) > 0) return false
  // 盲盒：N 份 = 抽 N 次，一次算好一次下发（同一事件抽中几次自己会合并）
  if (a.commandCmd === 'special-box') return true
  if (a.commandCmd !== 'special-play') return false
  return MERGEABLE_SPECIAL_OPS.has(parseSpecialParam(a.commandParam).op)
}

// ===== AI 语音播报（announce.ts）：一批（一次送礼）只念一句 =====
// 特色整蛊 / 盲盒、转盘、时间盲盒自己会念，这里不重复；按键 / 脚本 / 鼠标这类技术动作只在主播给规则起了名字时念名字；
// 会播视频 / 放音效的规则算「自己配了声音」（默认不念）。
const MEDIA_COMMANDS = new Set(['video-play', 'video-play-wait', 'video-random', 'sound-random', 'video-gif', 'project-random'])
const SELF_ANNOUNCING = new Set(['special-play', 'special-box', 'wheel-spin', 'nine-spin', 'blindbox-open'])
function signedSpoken(param: string | undefined, unit: 'time' | 'plain'): string {
  const text = String(param ?? '').trim()
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return ''
  const n = Number(text)
  if (!n) return ''
  const body = unit === 'time' ? spokenDuration(Math.abs(n)) : String(Math.abs(n))
  return `${n > 0 ? '加' : '减'}${body}`
}
function spokenAction(a: EntertainmentAction): string {
  if (a.actionType === 'system' && a.systemCmd) return SYSTEM_LABELS[a.systemCmd] || ''
  if (a.actionType !== 'command' || !a.commandCmd) return ''
  const p = a.commandParam
  switch (a.commandCmd) {
    case 'game-prank': { const [, id = '', name = ''] = String(p || '').split('|'); return name || id }
    case 'mobile': return actionLabel(a).replace(/^手游动作\s*/, '')
    case 'key-lock': return '锁住键盘'
    case 'key-unlock': return '解锁键盘'
    case 'countdown-adjust': { const s = signedSpoken(p, 'time'); return s ? `倒计时${s}` : '' }
    case 'countdown-clear': return '倒计时清零'
    case 'count-adjust': { const s = signedSpoken(p, 'plain'); return s ? `计时${s}` : '' }
    case 'count-clear': return '计时清零'
    case 'count-mul': return p ? `计时乘${p}` : ''
    case 'count-div': return p ? `计时除以${p}` : ''
    case 'overtime-adjust': { const s = signedSpoken(p, 'plain'); return s ? `加班${s}` : '' }
    case 'overtime-clear': return '加班清零'
    case 'overtime-mul': return p ? `加班乘${p}` : ''
    case 'overtime-div': return p ? `加班除以${p}` : ''
    default: return ''
  }
}
function announceRule(rule: EntertainmentRule, runs: number): void {
  const actions = ruleActions(rule)
  if (actions.some((a) => a.actionType === 'command' && SELF_ANNOUNCING.has(a.commandCmd || ''))) return
  const media = actions.some((a) => a.actionType === 'sound' || (a.actionType === 'command' && MEDIA_COMMANDS.has(a.commandCmd || '')))
  const named = String(rule.name || '').trim()
  const useName = !!named && !/^特色整蛊|→/.test(named) && named !== String(rule.giftName || '').trim()
  const text = useName ? named : actions.map(spokenAction).filter(Boolean).join('，')
  if (text) announce('gift', runs > 1 ? `${text}，${runs}次` : text, { hasOwnMedia: media })
}

// 入队：priority 大的先执行；同优先级按先来后到（seq 递增）。
function enqueueRuns(rule: EntertainmentRule, runs: number, event?: ConnectorEvent): void {
  if (runs <= 0) return
  announceRule(rule, runs)
  if (!Number.isSafeInteger(runs) || !Number.isSafeInteger(execQueueLength() + runs)) {
    console.warn('[entertainment] 执行次数超出可精确表示范围，请检查规则数值')
    return
  }
  let mode = rule.queueMode || 'normal'
  const gift = event?.type === 'gift' ? String(event.giftName || '') : event?.type === 'follow' ? '关注' : event?.type === 'like' ? '点赞' : event?.type === 'member' ? '进场' : event?.type === 'comment' ? '弹幕' : rule.giftName
  const sender = String(event?.sender || '')
  const image = String(event?.giftImage || '')
  const avatar = String(event?.avatar || '')
  // 特色整蛊「增加」类动作（加鸭子、来电、减锁链…）重复 N 次 = 数量 ×N 执行一次：
  // 连送 999 个小心心就是一次放 999 份，而不是排 999 次队、来回 999 次跨进程。乘除倍数这种叠乘的不合并。
  if (mode === 'instant' && runs > 1 && mergeableSpecialRule(rule)) {
    void executeRule(rule, { name: sender, avatar, gift }, runs)
    return
  }
  if (mode === 'instant') {
    // 先即时执行一批，剩余优先排队补完；不能同时启动数千个系统动作，也不能吞掉次数。
    const immediate = Math.min(runs, MAX_INSTANT)
    for (let i = 0; i < immediate; i++) void executeRule(rule, { name: sender, avatar, gift })
    runs -= immediate
    if (runs <= 0) return
    mode = 'jump'
  }
  const priority = Math.trunc(Number(rule.priority) || 0)
  execQueue.push({ rule, queueMode: mode === 'jump' ? 'jump' : 'normal', priority, seq: execSeq, count: runs, gift, sender, image, avatar })
  execSeq += runs
  // 插队始终越过普通队列；同类再按数字优先级，最后按到达顺序。
  execQueue.sort((a, b) => ((b.queueMode === 'jump' ? 1 : 0) - (a.queueMode === 'jump' ? 1 : 0)) || (b.priority - a.priority) || (a.seq - b.seq))
  emitQueue()
  pumpQueue()
}

// 连接器事件总线的唯一规则入口。规则存主进程，设置页卸载后仍然有效。
// times（礼物数量）= 累计收到多少个才触发一次，余数跨事件保留，避免连击被吞。
// multiply（执行倍数）= 送 N 个就执行 N 次；关掉则一次事件最多执行一次。
// repeat（执行次数）= 每次触发连续执行几次。
export function handleConnectorGift(event: ConnectorEvent): void {
  const kind = event.type
  if (kind !== 'gift' && kind !== 'follow' && kind !== 'like' && kind !== 'member' && kind !== 'comment') return
  if (rulesPaused) return
  // 送礼按个数累计；关注/进场一次算 1；点赞带次数；弹幕算 1 条。
  const amount = kind === 'gift' || kind === 'like'
    ? Math.max(0, Math.trunc(Number(event.count ?? 1)))
    : 1
  if (!Number.isSafeInteger(amount) || amount <= 0) return
  for (const rule of allRules()) {
    if (rule.enabled === false) continue
    const trigger = rule.triggerType || 'gift'
    if (trigger !== kind) continue
    // 礼物名留空的规则（导入后还没绑礼物）永不匹配，否则会被所有礼物触发
    if (trigger === 'gift' && !String(rule.giftName || '').trim()) continue
    if (trigger === 'gift' && !giftNamesEqual(rule.giftName, event.giftName)) continue
    // 弹幕关键词：规则的 giftName 当关键词，留空=任何弹幕都算
    if (trigger === 'comment') {
      const keyword = (rule.giftName || '').trim()
      if (keyword && !String(event.text || '').includes(keyword)) continue
    }
    const threshold = Math.max(1, Math.trunc(Number(rule.times) || 1))
    const total = (giftAccumulators.get(rule.id) || 0) + amount
    if (total < threshold) {
      giftAccumulators.set(rule.id, total)
      continue
    }
    const multiply = rule.multiply !== false // 默认按数量倍数执行，和老版本行为一致
    const hits = multiply ? Math.floor(total / threshold) : 1
    giftAccumulators.set(rule.id, multiply ? total % threshold : 0)
    const repeat = Math.max(1, Math.trunc(Number(rule.repeat) || 1))
    enqueueRuns(rule, hits * repeat, event)
  }
}

// 键鼠模拟：powershell WScript.Shell.SendKeys。keySeq 形如 "{F1}"、"{ENTER}"、"abc"、"^s"。
// 注意单引号转义；失败静默。
export function sendKeys(keySeq: string): { ok: boolean; error?: string } {
  if (!keySeq) return { ok: false, error: '键序列为空' }
  try {
    const safe = keySeq.replace(/'/g, "''")
    const ps = `(New-Object -ComObject WScript.Shell).SendKeys('${safe}')`
    // 排队执行（ps-runner.ts）：连击时不再一口气冒出几十个 PowerShell
    runPowerShell(ps)
    return { ok: true }
  } catch {
    return { ok: false, error: '发送按键失败' }
  }
}

// 「80%」→ 主屏物理像素（SetCursorPos 用的是物理像素，Electron 的尺寸是 DIP，要乘缩放）；「100」→ 100；空/非数 → undefined
export function resolveMouseCoord(raw: string | undefined, axis: 'x' | 'y'): number | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  const pct = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/)
  if (pct) {
    try {
      const { screen } = require('electron') as typeof import('electron')
      const display = screen.getPrimaryDisplay()
      const size = axis === 'x' ? display.size.width : display.size.height
      return Math.round((size * (display.scaleFactor || 1) * Number(pct[1])) / 100)
    } catch {
      return undefined
    }
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

// 鼠标模拟：PowerShell user32 mouse_event / SetCursorPos。
// action=move 或带坐标的点击会先把光标移过去；坐标用屏幕绝对坐标（0,0 = 左上角）。
export function mouseAction(
  action: MouseActionType,
  x?: number,
  y?: number
): { ok: boolean; error?: string } {
  try {
    const parts: string[] = []
    parts.push(
      `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int X,int Y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,uint e);}'`
    )
    if (x != null && y != null) {
      parts.push(`[M]::SetCursorPos(${Math.round(x)},${Math.round(y)})`)
    }
    const down = (f: number) => `[M]::mouse_event(${f},0,0,0,0)`
    const up = (f: number) => `[M]::mouse_event(${f},0,0,0,0)`
    switch (action) {
      case 'click-left':
        parts.push(down(0x02), up(0x04))
        break
      case 'click-right':
        parts.push(down(0x08), up(0x10))
        break
      case 'dblclick-left':
        parts.push(down(0x02), up(0x04), down(0x02), up(0x04))
        break
      case 'down-left':
        parts.push(down(0x02))
        break
      case 'up-left':
        parts.push(up(0x04))
        break
      case 'down-right':
        parts.push(down(0x08))
        break
      case 'up-right':
        parts.push(up(0x10))
        break
      case 'move':
        break
    }
    const ps = parts.join('; ')
    runPowerShell(ps)
    return { ok: true }
  } catch {
    return { ok: false, error: '鼠标模拟失败' }
  }
}

// 发送/粘贴文本：先写剪贴板再 Ctrl+V，保证中文/emoji 都能进直播间输入框。
// mode=send 纯 ASCII 时直接按键敲出（更接近真人打字）；mode=paste 一律剪贴板粘贴。
// enterAfter=true 发送后补一个回车（立即发出）。
export function sendText(
  text: string,
  mode: 'send' | 'paste',
  enterAfter = false
): { ok: boolean; error?: string } {
  if (!text) return { ok: false, error: '文本为空' }
  try {
    const asciiOnly = /^[\x20-\x7E]+$/.test(text)
    if (mode === 'send' && asciiOnly) {
      // SendKeys 特殊字符需转义
      const esc = text.replace(/([+^%~(){}\[\]])/g, '{$1}')
      sendKeys(esc)
    } else {
      clipboard.writeText(text)
      runPowerShell(`(New-Object -ComObject WScript.Shell).SendKeys('^v')`)
    }
    if (enterAfter) sendKeys('{ENTER}')
    return { ok: true }
  } catch {
    return { ok: false, error: '发送文本失败' }
  }
}

function builtInGiftImageDir(): string {
  // 开发环境从源码目录读取；打包后由 electron-builder extraResources 放在 resources 下。
  return app.isPackaged
    ? path.join(process.resourcesPath, 'gift-assets', 'douyin')
    : path.join(app.getAppPath(), 'gift-assets', 'douyin')
}

function giftImageKey(value: string): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}

interface BuiltInGiftCatalog {
  schema: number
  images: {
    name: string
    label?: string
    file: string
    variant?: number
    canonical?: boolean
    giftIds?: string[]
    giftMeta?: { id?: unknown; diamondCount?: unknown }[]
    diamondCount?: number
    pages?: string[]
    current?: boolean
  }[]
}

function imageFiles(dir: string, sourceType: EntertainmentGiftImage['source']): EntertainmentGiftImage[] {
  try {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter((file) => /\.(png|webp|jpg|jpeg|gif|bmp)$/i.test(file))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((file) => {
        const name = file.replace(/\.[^.]+$/, '')
        return { name, label: name, path: path.join(dir, file), variant: 0, canonical: true, source: sourceType }
      })
  } catch {
    return []
  }
}

function catalogImages(dir: string): EntertainmentGiftImage[] | null {
  try {
    const catalogPath = path.join(dir, 'catalog.json')
    if (!fs.existsSync(catalogPath)) return null
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as BuiltInGiftCatalog
    if (![1, 2].includes(catalog.schema) || !Array.isArray(catalog.images)) return null
    const base = path.resolve(dir)
    const prefix = `${base}${path.sep}`
    const items: EntertainmentGiftImage[] = []
    for (const image of catalog.images) {
      const name = String(image?.name || '').trim()
      const file = String(image?.file || '').trim()
      const filePath = path.resolve(base, file)
      if (!name || !file || !filePath.startsWith(prefix) || !fs.existsSync(filePath)) continue
      const variant = Math.max(0, Math.trunc(Number(image.variant) || 0))
      const giftIds = Array.isArray(image.giftIds)
        ? image.giftIds.map((id) => String(id || '').trim()).filter(Boolean)
        : []
      const firstGift = Array.isArray(image.giftMeta) && image.giftMeta[0] && typeof image.giftMeta[0] === 'object'
        ? image.giftMeta[0] as { id?: unknown; diamondCount?: unknown }
        : null
      const giftId = giftIds[0] || String(firstGift?.id || '').trim()
      const diamondCount = Number(firstGift?.diamondCount ?? image.diamondCount)
      items.push({
        name,
        label: String(image.label || (variant ? `${name} · 图变体 ${variant + 1}` : name)),
        path: filePath,
        variant,
        canonical: image.canonical !== false && variant === 0,
        source: 'builtin',
        giftId: giftId || undefined,
        giftIds: giftIds.length ? giftIds : undefined,
        diamondCount: Number.isFinite(diamondCount) ? diamondCount : undefined,
        pages: Array.isArray(image.pages) ? image.pages.map((page) => String(page || '').trim()).filter(Boolean) : undefined,
        current: image.current === true
      })
    }
    return items
  } catch {
    return null
  }
}

// 扫一遍内置目录（解析 catalog + 1400 个文件 existsSync）要 160ms 左右，
// 而一个礼物事件会让特效/心愿/贴纸/倒计时/积分各查一次图——礼物连击时主进程直接被拖慢。
// 所以这里做短缓存 + 按名字的索引：默认 5 秒内复用；连接器新落一张图立刻失效。
let giftImageCache: { at: number; items: EntertainmentGiftImage[]; index: Map<string, EntertainmentGiftImage> } | null = null
const GIFT_IMAGE_CACHE_MS = 5000

export function invalidateGiftImageCache(): void {
  giftImageCache = null
}

function buildGiftImageIndex(items: EntertainmentGiftImage[]): Map<string, EntertainmentGiftImage> {
  const index = new Map<string, EntertainmentGiftImage>()
  for (const item of items) {
    const key = giftImageKey(item.name)
    if (!key) continue
    const current = index.get(key)
    // 连接器实抓的图 > 内置标准图 > 变体图
    if (!current || (item.source === 'connector' && current.source !== 'connector') || (current.source !== 'connector' && item.canonical && !current.canonical)) {
      index.set(key, item)
    }
  }
  return index
}

/** 按礼物名找一张图（连接器实抓优先，其次内置标准图）；O(1)，给每个礼物事件都要查图的挂件用 */
export function findGiftImage(name: string): EntertainmentGiftImage | undefined {
  listGiftImages()
  return giftImageCache?.index.get(giftImageKey(name))
}

// 连接器抓到的当前直播礼物图优先；内置清单同时保留同名礼物的所有不同图片变体。
// 返回项按 (真实礼物名, 文件路径) 去重，别把共享同一图片的不同礼物别名误删掉。
export function listGiftImages(): EntertainmentGiftImage[] {
  if (giftImageCache && Date.now() - giftImageCache.at < GIFT_IMAGE_CACHE_MS) return giftImageCache.items
  const items = scanGiftImages()
  giftImageCache = { at: Date.now(), items, index: buildGiftImageIndex(items) }
  return items
}

function scanGiftImages(): EntertainmentGiftImage[] {
  const externalDir = wheelLiveDir() ? path.join(wheelLiveDir(), '礼物图', '抖音') : ''
  const builtInDirs = [builtInGiftImageDir(), path.join(process.resourcesPath, 'gift-assets', 'douyin')]
    .filter((dir, index, all) => !!dir && all.indexOf(dir) === index)
  const found: EntertainmentGiftImage[] = []
  const pairKeys = new Set<string>()
  const add = (item: EntertainmentGiftImage) => {
    const nameKey = giftImageKey(item.name)
    const pairKey = `${nameKey}\u0000${path.resolve(item.path).toLocaleLowerCase('zh-CN')}`
    // 加成卡/助力票这类道具观众送不出来，别混进礼物图库污染各处下拉
    if (!nameKey || pairKeys.has(pairKey) || !isRealGift(item.name)) return
    pairKeys.add(pairKey)
    found.push(item)
  }

  if (externalDir) imageFiles(externalDir, 'connector').forEach(add)
  for (const dir of builtInDirs) {
    const catalog = catalogImages(dir)
    const items = catalog || imageFiles(dir, 'builtin')
    for (const item of items) add(item)
    if (catalog?.length) {
      // 同一安装包中的第二个候选目录只用于兼容旧打包路径，不重复扫描散落文件。
      continue
    }
  }
  return found
}

// 系统动作：自动关机 / 锁定屏幕 / 显示器息屏 / 结束进程（对应参考软件礼物触发「动作分类」的系统项）。
export function systemAction(
  cmd: EntertainmentSystemCmd,
  param?: string
): { ok: boolean; error?: string } {
  try {
    let ps: string
    switch (cmd) {
      case 'shutdown':
        ps = 'shutdown /s /t 5 /c "知了猴整蛊台·礼物触发自动关机"'
        break
      case 'lock':
        ps = 'rundll32 user32.dll LockWorkStation'
        break
      case 'displayoff':
        ps =
          `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
          `public class D{[DllImport("user32.dll")]public static extern int SendMessage(int h,int m,int w,int l);}'; ` +
          `[D]::SendMessage(0xffff,0x0112,0xF170,2)`
        break
      case 'kill': {
        const name = String(param || '').trim()
        if (!name) return { ok: false, error: '请填写进程名' }
        // 只认「文件名.exe」这种名字，参数数组直传 taskkill，不再拼进 PowerShell -Command：
        // 以前只删 ;&| 三个字符，$()/反引号/换行都能进去 —— 导入群里传的「礼物规则包」就等于远程执行
        if (!/^[^\\/:*?"<>|\r\n;&$`]{1,120}$/.test(name)) return { ok: false, error: '进程名只能是文件名，如 notepad.exe' }
        const killer = spawn('taskkill', ['/IM', name, '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => { /* taskkill 起不来只当没杀到 */ })
        killer.unref()
        return { ok: true }
      }
      default:
        return { ok: false, error: '未知系统动作' }
    }
    runPowerShell(ps)
    return { ok: true }
  } catch {
    return { ok: false, error: '系统动作执行失败' }
  }
}

// 保存透明图 PNG：渲染层 toDataURL 的 base64 → 弹出保存框写文件。
// targetDir 已设置（透明图「合成图片目录」）时直接写入该目录，不弹框（复刻参考软件行为）。
// 复制成品图到剪贴板：不落盘直接 Ctrl+V 贴进 OBS/聊天窗，主播最快的用法
export function copyImageToClipboard(dataUrl: string): { ok: boolean; error?: string } {
  try {
    const image = nativeImage.createFromDataURL(String(dataUrl || ''))
    if (image.isEmpty()) return { ok: false, error: '图片数据为空' }
    clipboard.writeImage(image)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '复制失败：' + (e as Error).message }
  }
}

export async function savePng(
  dataUrl: string,
  defaultName: string,
  targetDir?: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    // 支持 PNG / GIF / JSON（透明图导出、GIF 动画、配置备份共用这一条保存通道）。
    // base64 前缀必须按通用格式剥：老写法只认 image/png|gif，
    // 传 application/json 时前缀剥不掉，写出去的文件整个是乱码。
    const mime = String(dataUrl).match(/^data:([^;]+);base64,/)?.[1] || 'image/png'
    const isGif = mime === 'image/gif'
    const ext = isGif ? 'gif' : mime === 'application/json' ? 'json' : 'png'
    const name = defaultName || `transparent.${ext}`
    const base64 = String(dataUrl).replace(/^data:[^;]+;base64,/, '')
    if (targetDir && fs.existsSync(targetDir)) {
      const outPath = path.join(targetDir, name)
      fs.writeFileSync(outPath, Buffer.from(base64, 'base64'))
      return { ok: true, path: outPath }
    }
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showSaveDialog(win!, {
      title: ext === 'json' ? '保存配置' : isGif ? '保存 GIF 动画' : '保存透明图',
      defaultPath: name,
      filters: [{ name: ext === 'json' ? '配置文件' : isGif ? 'GIF 动画' : 'PNG 图片', extensions: [ext] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: '已取消' }
    fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'))
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: '保存失败：' + (e as Error).message }
  }
}

// 执行脚本/程序：exe/com 直接起进程（不经 shell，路径里的 & | 等不会被 cmd 解释成命令）；
// .bat/.cmd/.py/.lnk 等交给系统关联程序打开。以前 shell:true 等于 `cmd /c <路径>`，规则参数里塞 `calc.exe & ...` 就能执行任意命令。
export function runScript(path: string): { ok: boolean; error?: string } {
  const target = String(path || '').trim().replace(/^"|"$/g, '')
  if (!target) return { ok: false, error: '脚本路径为空' }
  if (!fs.existsSync(target)) return { ok: false, error: '脚本文件不存在：' + target }
  try {
    if (/\.(exe|com)$/i.test(target)) {
      const child = spawn(target, [], { detached: true, windowsHide: true, stdio: 'ignore' })
      child.on('error', () => { /* 起不来只当这次没跑 */ })
      child.unref()
      return { ok: true }
    }
    void shell.openPath(target)
    return { ok: true }
  } catch {
    return { ok: false, error: '启动脚本失败' }
  }
}

// ===== 动作命令（复刻参考软件「动作命令」子执行器 0x4d8942）=====
// param 支持 "a,b" 范围内随机（参考：-1000,1000 表示范围内随机）
function parseRangeOrNum(param: string): number {
  const s = String(param ?? '').trim()
  // 「1.5,2.5」这类小数区间也要认（品游倒计时加减允许小数；以前只认整数，小数区间会静默变 0）
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a > b) return Math.round(b + Math.random() * (a - b))
    return Math.round(a + Math.random() * (b - a))
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// 键盘按住用的虚拟键码表：字母/数字直接用 ASCII 大写码；其余按名字查，中文别名一并认
const HOLD_VK: Record<string, number> = {
  SPACE: 0x20, 空格: 0x20, ENTER: 0x0d, 回车: 0x0d, TAB: 0x09, ESC: 0x1b, ESCAPE: 0x1b,
  SHIFT: 0x10, CTRL: 0x11, CONTROL: 0x11, ALT: 0x12, CAPSLOCK: 0x14, BACKSPACE: 0x08,
  LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, 左: 0x25, 上: 0x26, 右: 0x27, 下: 0x28,
  INSERT: 0x2d, DELETE: 0x2e, HOME: 0x24, END: 0x23, PAGEUP: 0x21, PAGEDOWN: 0x22,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7a, F12: 0x7b,
  F13: 0x7c, F14: 0x7d, F15: 0x7e, F16: 0x7f, F17: 0x80, F18: 0x81, F19: 0x82, F20: 0x83, F21: 0x84, F22: 0x85, F23: 0x86, F24: 0x87,
  NUM0: 0x60, NUM1: 0x61, NUM2: 0x62, NUM3: 0x63, NUM4: 0x64, NUM5: 0x65, NUM6: 0x66, NUM7: 0x67, NUM8: 0x68, NUM9: 0x69
}

async function lockKeyboard(param: string): Promise<{ ok: boolean; error?: string }> {
  const [rawKeys, rawMs, extra] = param.split('|')
  const ms = Number(rawMs)
  const adjust = rawKeys?.trim() === '调整'
  if (extra !== undefined || !rawMs?.trim() || !Number.isSafeInteger(ms) || Math.abs(ms) > 2147483647 || (!adjust && ms <= 0)) {
    return { ok: false, error: '锁定参数应为 全部|3000、W,A,S,D|5000 或 调整|-1000（时长为毫秒）' }
  }
  const { commandKeyboardLock } = await import('./keyboard-hook')
  if (adjust) return commandKeyboardLock('adjust', ms)
  let keys = '*'
  if (rawKeys.trim() !== '全部') {
    const codes = new Set<number>()
    for (const name of rawKeys.split(/[,，]/)) {
      const key = name.trim().toUpperCase()
      const vk = HOLD_VK[key] ?? (/^[A-Z0-9]$/.test(key) ? key.charCodeAt(0) : undefined)
      if (!vk || vk === 27) return { ok: false, error: `不能锁定键「${name}」；Esc 专用于紧急解锁` }
      codes.add(vk)
      // 低级钩子上报左右修饰键，通用 Ctrl/Shift/Alt 应覆盖两侧。
      if (vk >= 0x10 && vk <= 0x12) { codes.add(0xa0 + (vk - 0x10) * 2); codes.add(0xa1 + (vk - 0x10) * 2) }
    }
    keys = [...codes].join(',')
  }
  return commandKeyboardLock('lock', ms, keys)
}

// 键盘按住（参考「键盘按住」动作）：keybd_event 按下 → 等 N 毫秒 → 抬起。
// SendKeys 只能敲一下，游戏里长按走路/蓄力必须靠真按住。参数「键名,毫秒」，毫秒可写 1000~3000 随机。
export function holdKey(keyName: string, ms: number): { ok: boolean; error?: string } {
  const key = String(keyName || '').trim().toUpperCase()
  if (!key) return { ok: false, error: '键名为空' }
  const vk = HOLD_VK[key] ?? (/^[A-Z0-9]$/.test(key) ? key.charCodeAt(0) : undefined)
  if (!vk) return { ok: false, error: `不认识的键名：${keyName}` }
  // 时长不设上限（用户铁律），只防 0/负数；10 分钟以上基本是手滑，夹到 10 分钟
  const hold = Math.max(10, Math.min(600_000, Math.trunc(ms) || 1000))
  try {
    const ps = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo);}'; [K]::keybd_event(${vk},0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds ${hold}; [K]::keybd_event(${vk},0,2,[UIntPtr]::Zero)`
    // 按住要跑很久，走单独的道（不占短动作的位置）；超时按 按住时长 + 30 秒算
    runPowerShell(ps, { long: true, timeoutMs: hold + 30_000 })
    return { ok: true }
  } catch {
    return { ok: false, error: '按住按键失败' }
  }
}

/** 品游脚本的「弹起」动作；与键盘按住配对，避免脚本结束后按键卡住。 */
export function releaseKey(keyName: string): { ok: boolean; error?: string } {
  const key = String(keyName || '').trim().toUpperCase()
  const vk = HOLD_VK[key] ?? (/^[A-Z0-9]$/.test(key) ? key.charCodeAt(0) : undefined)
  if (!vk) return { ok: false, error: `不认识的键名：${keyName}` }
  try {
    const ps = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K2{[DllImport("user32.dll")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo);}'; [K2]::keybd_event(${vk},0,2,[UIntPtr]::Zero)`
    runPowerShell(ps)
    return { ok: true }
  } catch { return { ok: false, error: '弹起按键失败' } }
}

function parseHoldParam(param: string): { key: string; ms: number } {
  const [rawKey = '', rawMs = ''] = String(param || '').split(/[,，]/)
  const key = rawKey.trim()
  const range = rawMs.trim().match(/^(\d+)\s*[~～-]\s*(\d+)$/)
  const ms = range
    ? Math.round(Math.min(Number(range[1]), Number(range[2])) + Math.random() * Math.abs(Number(range[2]) - Number(range[1])))
    : Number(rawMs.trim()) || 1000
  return { key, ms }
}

// 随机执行脚本（参考「随机执行脚本」）：从目录里随机挑一个脚本/程序跑
const SCRIPT_EXT = /\.(bat|cmd|exe|ps1|vbs|py|lnk)$/i
export function runRandomScript(dir: string): { ok: boolean; error?: string; picked?: string } {
  const folder = String(dir || '').trim()
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: '脚本目录不存在' }
  let files: string[] = []
  try {
    files = fs.readdirSync(folder).filter((name) => SCRIPT_EXT.test(name))
  } catch {
    return { ok: false, error: '读取脚本目录失败' }
  }
  if (!files.length) return { ok: false, error: '目录里没有 bat/cmd/exe/ps1/vbs/py 脚本' }
  const picked = path.join(folder, files[Math.floor(Math.random() * files.length)])
  const result = runScript(picked)
  return { ...result, picked }
}

// 视频类命令的「播到哪里」后缀：参数尾部 |绿幕N（N=1~4）= 指定绿幕窗口；|视频 = 视频窗口（老行为）；
// 不写 = 走「默认窗口 + 排队」模型（设置页选的默认窗口最优先，忙了按排队开关等它或分流到其他开着的窗口）。
// ★必须最先剥这个后缀：video-play 的参数还有「路径|秒数」语义，顺序是 <路径>[|秒数][|绿幕N]。
/** 视频类参数尾部的「指定播放窗口」：|绿幕N（最优先窗口，忙了可去别的窗口）、|绿幕N固定 / |固定（只在这个窗口排）、|视频（老的视频窗口）。
 *  渲染层 utils/videoTarget.ts、shared/entertainmentLabels.ts 认同一套格式，改要一起改。 */
export function splitVideoTarget(raw: string): { rest: string; target: 0 | 1 | 2 | 3 | 4 | 'video'; overflow: boolean } {
  const m = /^(.*?)\s*\|\s*(?:绿幕\s*([1-4])(固定)?|(固定)|视频)$/.exec(String(raw || '').trim())
  if (!m) return { rest: String(raw || '').trim(), target: 0, overflow: true }
  if (m[4]) return { rest: m[1].trim(), target: 0, overflow: false }
  return { rest: m[1].trim(), target: m[2] ? (Number(m[2]) as 1 | 2 | 3 | 4) : 'video', overflow: !m[3] }
}

/**
 * 「接着在同一个窗口播」：项目脚本 / 条目动作里带出来的视频，跟着刚才那条视频真正落地的窗口走，
 * 并且不许再去别的窗口——这一串本来就是同一次整蛊的延续（2026-09-11 用户：「能否是本窗口的再来一次」）。
 *
 * ★为什么是「实际落地的窗口」而不是规则里配的窗口：规则配「绿幕1」时，「再来一次」触发的那一刻
 *   1 号正被上一条视频占着，按配置去挑窗口照样会溢出到 2 号；而且规则配「默认窗口」时默认窗口可能根本没开，
 *   按配置走会变成「这条视频没播」。跟着上一条真正播在哪走，两种情况都对。
 * ★品游 .脚本 里写死的 [绿幕N] 一律让位：那是旧软件那台机器上的窗口编号，主播在整蛊台里根本改不到它。
 */
function continuePlayback<T extends { target: 0 | 1 | 2 | 3 | 4 | 'video'; overflow: boolean }>(
  parsed: T,
  options?: { videoSlot?: GreenScreenSlot }
): T {
  return options?.videoSlot ? { ...parsed, target: options.videoSlot, overflow: false } : parsed
}

export async function entertainmentCommand(
  cmd: string,
  param?: string,
  // projectBase / projectDepth：项目脚本里再触发项目时带着——相对项目名按当前项目所在目录找，嵌套最多 6 层
  // videoSlot：上一条视频真正播在哪个绿幕窗口，带出来的视频接着在那儿播（见 continuePlayback）
  options?: { chroma?: boolean; isCurrent?: () => boolean; projectBase?: string; projectDepth?: number; videoSlot?: GreenScreenSlot; viewer?: SpecialViewer; specialTimes?: number }
): Promise<{ ok: boolean; error?: string }> {
  if (options?.isCurrent && !options.isCurrent()) return { ok: false, error: '事件已取消' }
  if(cardModeEnabled()&&!['key-unlock','key-up','video-stop'].includes(cmd)){
    const epoch=cardEpoch()
    try{await (await import('./card-auth')).cardRequireRecent('platform:assistant')}catch(error){return {ok:false,error:error instanceof Error?error.message:'卡密授权不可用'}}
    if(cardEpoch()!==epoch)return {ok:false,error:'登录状态已变化'}
    const previous=options?.isCurrent
    options={...options,isCurrent:()=>cardEpoch()===epoch&&(!previous||previous())}
  }
  switch (cmd) {
    case 'key-lock':
      return lockKeyboard(param ?? '')
    case 'key-unlock': {
      const { commandKeyboardLock } = await import('./keyboard-hook')
      return commandKeyboardLock('unlock')
    }
    case 'key-sequence':
      return sendKeys(param ?? '')
    case 'key-up':
      return releaseKey(param ?? '')
    case 'key-hold': {
      const { key, ms } = parseHoldParam(param ?? '')
      return holdKey(key, ms)
    }
    case 'random-script':
      return runRandomScript(param ?? '')
    case 'countdown-adjust': {
      // 倒计时加减（联动时间插件挂件）
      const { timeWidgetAdjust } = await import('./time-widget')
      return timeWidgetAdjust(parseRangeOrNum(param ?? ''))
    }
    case 'countdown-clear': {
      const { timeWidgetClear } = await import('./time-widget')
      return timeWidgetClear()
    }
    case 'send-text':
      if (!param) return { ok: false, error: '文本为空' }
      return sendText(param, 'send', false)
    case 'paste-text':
      if (!param) return { ok: false, error: '文本为空' }
      return sendText(param, 'paste', false)
    case 'run-file':
      return runScript(param ?? '')
    case 'kill':
      return systemAction('kill', param)
    case 'mouse': {
      // 坐标可以是像素「click-left|100|200」，也可以是屏幕百分比「click-left|80%|66%」（品游的坐标拾取器给的就是百分比，换分辨率也不跑偏）
      const [rawAction = 'click-left', rawX, rawY] = String(param || 'click-left').split('|')
      const x = resolveMouseCoord(rawX, 'x')
      const y = resolveMouseCoord(rawY, 'y')
      return mouseAction(rawAction as MouseActionType, x, y)
    }
    case 'video-play':
    case 'video-gif': {
      if (!param) return { ok: false, error: '视频路径为空' }
      // 尾部「|绿幕N / |绿幕N固定 / |视频」先剥掉，剩下的才是「路径|秒数」
      const { rest, target, overflow } = continuePlayback(splitVideoTarget(param), options)
      // 参数「路径」= 循环播到 video-stop；「路径|秒数」= 一次性播 N 秒自动关（品游导过来的礼物视频都是这种，视频时间就是它的「视频时间」）
      const bar = rest.lastIndexOf('|')
      const secs = bar > 0 ? Number(rest.slice(bar + 1).trim()) : NaN
      const once = bar > 0 && Number.isFinite(secs)
      const file = once ? rest.slice(0, bar).trim() : rest
      // 播到绿幕（指定 N 号或默认窗口排队模型）；「|视频」才走老的视频窗口。
      // ★绿幕里一律播一遍就收：不写秒数 = 整段播完自动收，写了秒数 = 只播这几秒。
      //   循环会把默认窗口永远占住，后面排队的素材一条都播不出来（老的视频窗口那条路才保留「循环到停止视频」）
      if (target !== 'video') {
        const { openGreenScreen } = await import('./green-screen')
        return openGreenScreen(file, 'video', '', target, { loop: false, maxSeconds: once ? Math.max(0, secs) : 0, chroma: options?.chroma === true, origin: 'command', overflow })
      }
      const { openVideoWidget } = await import('./video-widget')
      const { captureSourceBackground } = await import('./output-window')
      return openVideoWidget({
        path: file, loop: once ? false : true, muted: false, volume: 1, topMost: true,
        // 底色跟采集模式走：绿幕模式=绿底（直播伴侣能抠掉），透明模式=真透明
        width: 480, height: 270, bgColor: captureSourceBackground(), chroma: options?.chroma === true,
        ...(once ? { autoClose: true, maxSeconds: Math.max(0, secs) } : {})
      })
    }
    case 'video-play-wait': {
      // 和「播放视频」同一套参数：尾部 |绿幕N / |视频 选窗口，抠图开关也认（以前这条路两样都不接）
      const { rest: waitRest, target: waitTarget, overflow: waitOverflow } = continuePlayback(splitVideoTarget(String(param || '')), options)
      const separator = waitRest.lastIndexOf('|')
      const duration = separator > 0 ? Number(waitRest.slice(separator + 1).trim()) : NaN
      const waitFile = Number.isFinite(duration) ? waitRest.slice(0, separator).trim() : waitRest
      const maxSeconds = Number.isFinite(duration) ? Math.max(0, duration) : 0
      if (!waitFile) return { ok: false, error: '视频路径为空' }
      if (waitTarget !== 'video') {
        const { playGreenScreenAndWait } = await import('./green-screen')
        return playGreenScreenAndWait(waitFile, waitTarget, { loop: false, maxSeconds, chroma: options?.chroma === true, origin: 'command', overflow: waitOverflow }, options?.isCurrent)
      }
      const { playVideoWidgetAndWait } = await import('./video-widget')
      const { captureSourceBackground } = await import('./output-window')
      return playVideoWidgetAndWait({ path: waitFile, loop: false, maxSeconds, muted: false, volume: 1, topMost: true, width: 480, height: 270, bgColor: captureSourceBackground(), autoClose: true, chroma: options?.chroma === true }, options?.isCurrent)
    }
    case 'video-random': {
      // 尾部可带「|绿幕N / |视频」选播到哪里（不写 = 默认窗口排队模型）
      const { rest, target, overflow } = continuePlayback(splitVideoTarget(String(param || '')), options)
      const folder = rest
      if (!folder || !fs.existsSync(folder)) return { ok: false, error: '视频目录不存在' }
      let files: string[] = []
      try { files = fs.readdirSync(folder).filter((name) => /\.(mp4|webm|mov|mkv|avi)$/i.test(name)) } catch { return { ok: false, error: '读取视频目录失败' } }
      if (!files.length) return { ok: false, error: '视频目录为空' }
      const picked = path.join(folder, files[Math.floor(Math.random() * files.length)])
      const suffix = target === 'video' ? '|视频' : target ? `|绿幕${target}${overflow ? '' : '固定'}` : overflow ? '' : '|固定'
      return entertainmentCommand('video-play', picked + suffix, options)
    }
    case 'special-play': {
      // 特色整蛊（锁链/抓鸭子/粉丝来电…）：param = 玩法|操作|数量|选项。
      // 礼物规则、转盘、九宫格、时间盲盒、项目脚本都从这一个出口进来，玩法本身不再单独认礼物。
      const { runSpecialAction } = await import('./special-gameplay')
      return runSpecialAction(String(param || ''), options?.viewer, options?.specialTimes)
    }
    case 'special-box': {
      // 特色整蛊盲盒（照时间插件）：param = 事件id,…|显示名，每份从勾选的事件里随机抽一个；
      // specialTimes = 礼物规则合并的份数（连送 99 个就抽 99 次，一次下发）
      const { runSpecialBox } = await import('./special-gameplay')
      return runSpecialBox(String(param || ''), options?.viewer, options?.specialTimes)
    }
    case 'game-prank': {
      // 游戏整蛊（整蛊器）：param = 游戏id|整蛊id|显示名。礼物规则里能和特色整蛊、视频一起配，
      // 一个礼物既整游戏又整画面。只在当前选中的就是这款游戏时推，免得轮椅的整蛊发进 DS。
      const [game = '', id = ''] = String(param || '').split('|').map((s) => s.trim())
      if (!game || !id) return { ok: false, error: '没有选择游戏整蛊' }
      const { currentGameId } = await import('./games')
      if (currentGameId() !== game) return { ok: false, error: '当前选中的不是这款游戏，游戏整蛊没发出' }
      const { livePrank } = await import('./live-api')
      return livePrank(id, options?.isCurrent)
    }
    case 'blindbox-open': {
      // 开一次时间盲盒。param 填事件名或 id；留空 = 从全部启用事件里随机抽一个。
      // 时间盲盒原来只认它自己那份礼物表，礼物规则/转盘/九宫格都触发不了它。
      const { timeWidgetOpenBox } = await import('./time-widget')
      return timeWidgetOpenBox(String(param || '').trim())
    }
    case 'project-random': {
      // ★品游式「项目」：一个文件夹就是一个项目，触发时随机抽一条视频播放，
      //   旁边有同名 .脚本 就把里面的动作也执行掉（用户原话：「盲盒可以触发这个文件夹里面的东西」）。
      //   param: <目录>[|绿幕N]。目录既可以是绝对路径，也可以是品游脚本里那种相对项目名
      //   （「哈喽体力转盘」），后者在设置的「品游素材目录」下找。
      const raw = String(param || '').trim()
      if (!raw) return { ok: false, error: '没有指定项目文件夹' }
      // 尾部「|绿幕N / |视频」选播到哪里；不写 = 默认窗口排队模型
      const { rest: dirRaw, target, overflow } = continuePlayback(splitVideoTarget(raw), options)
      const { resolveProjectDir, pickProjectItem, readScript } = await import('./pinyou-project')
      const dir = resolveProjectDir(dirRaw, options?.projectBase ? [options.projectBase] : [])
      if (!dir) return { ok: false, error: `找不到项目文件夹「${dirRaw}」：在设置里指定品游素材目录，或改用完整路径` }
      const picked = pickProjectItem(dir)
      if (!picked) return { ok: false, error: `项目「${path.basename(dir)}」里没有视频文件` }
      // 1) 播视频：|绿幕N 播到指定窗口；|视频 走视频窗口；不写走默认窗口排队模型
      let played: { ok: boolean; error?: string; slot?: GreenScreenSlot }
      if (target === 'video') {
        played = await entertainmentCommand('video-play', `${picked.video}|0|视频`, options)
      } else {
        const { startQueuedGreenVideo } = await import('./green-screen')
        played = await startQueuedGreenVideo(picked.video, target, { loop: false, chroma: options?.chroma === true, origin: 'command', overflow }, options?.isCurrent)
      }
      if (!played.ok) return played
      // 这条视频真正播在哪个绿幕窗口：脚本和条目动作里带出来的视频（品游的「再来一次」）接着在这儿播，不去别的窗口
      const here: GreenScreenSlot | undefined = played.slot
      // 整蛊台里给这条视频配的动作（规则编辑器「项目里的视频」那一块）：可以关掉品游脚本、只跑这里配的
      const { itemActionsFor } = await import('./pinyou-item-actions')
      const custom = itemActionsFor(dir, picked.name)
      // 2) 同名脚本里的动作。视频照播，动作失败不影响它（纯视频项目本来就没有脚本）
      if (picked.script && custom?.useScript !== false) {
        const { parsePinyouScript } = await import('../shared/pinyou')
        const { commands } = parsePinyouScript(readScript(picked.script))
        for (const c of commands) {
          if (options?.isCurrent && !options.isCurrent()) return { ok: false, error: '事件已取消' }
          if (c.cmd === 'delay') {
            await new Promise<void>((resolve) => setTimeout(resolve, Math.min(60_000, Number(c.param) || 0)))
            continue
          }
          // 脚本里再触发项目（品游「再来一次」= 「播放视频:本项目\随机播放」再抽一条）：允许，最多套 6 层——
          //   只有「再来一次」一条的项目会一直抽自己，不设上限就没完了。以前这里直接跳过，主播的「再来一次」从来没触发过（2026-09-11）
          const depth = Number(options?.projectDepth) || 0
          if (c.cmd === 'project-random' && depth >= 6) {
            console.warn(`[entertainment] 项目脚本嵌套已到 6 层，不再往下：${c.param}`)
            continue
          }
          try {
            // videoSlot：脚本里的视频（含「再来一次」）接着在刚才那条视频的窗口播。
            //   脚本里写死的 [绿幕N] 就此让位——主播在整蛊台里改不到 .脚本，能改的是规则，规则说了算
            await entertainmentCommand(c.cmd, c.param, { ...options, projectBase: path.dirname(dir), projectDepth: depth + 1, videoSlot: here })
          } catch {
            /* 单个动作失败不影响后面的 */
          }
        }
      }
      // 3) 整蛊台里配的动作：和规则附加动作同一套（按顺序、可先等几秒）；再触发项目同样最多套 6 层
      if (custom?.actions?.length) {
        const depth = Number(options?.projectDepth) || 0
        for (const action of custom.actions) {
          if (options?.isCurrent && !options.isCurrent()) return { ok: false, error: '事件已取消' }
          if (action.actionType === 'command' && action.commandCmd === 'project-random' && depth >= 6) {
            console.warn(`[entertainment] 项目条目动作嵌套已到 6 层，不再往下：${action.commandParam}`)
            continue
          }
          const wait = actionDelayMs(action)
          if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait))
          try {
            // 这一格在界面上有「指定播放窗口」下拉，主播自己选了就听他的；没选（裸参数）才接着在本窗口播。
            //   和品游 .脚本 不一样：脚本是磁盘上的只读文件，界面里改不到，所以脚本里的窗口一律让位
            const own = action.actionType === 'command' && typeof action.commandParam === 'string' ? splitVideoTarget(action.commandParam) : null
            const picksOwnWindow = !!own && (own.target !== 0 || own.overflow === false)
            await executeAction(action, {
              chroma: options?.chroma, isCurrent: options?.isCurrent,
              projectBase: path.dirname(dir), projectDepth: depth + 1,
              videoSlot: picksOwnWindow ? undefined : here
            })
          } catch (e) {
            console.warn(`[entertainment] 项目「${path.basename(dir)}」条目「${picked.name}」的动作执行失败：`, (e as Error)?.message || e)
          }
        }
      }
      return played.ok ? { ok: true } : played
    }
    case 'sound-random': {
      const folder = String(param || '').trim()
      if (!folder || !fs.existsSync(folder)) return { ok: false, error: '音效目录不存在' }
      let files: string[] = []
      try { files = fs.readdirSync(folder).filter((name) => /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) } catch { return { ok: false, error: '读取音效目录失败' } }
      if (!files.length) return { ok: false, error: '音效目录为空' }
      const picked = path.join(folder, files[Math.floor(Math.random() * files.length)])
      for (const target of BrowserWindow.getAllWindows()) {
        if (!target.isDestroyed()) target.webContents.send(Ipc.EntertainmentSound, { path: picked, mode: 'sync', volume: 1 })
      }
      return { ok: true }
    }
    case 'video-stop': {
      // 停掉规则/动作/项目触发的视频：视频窗口的主窗（VIP 窗是主播自己开的，不动）+ 绿幕里由命令开出来的素材 + 排队中的
      const { closeVideoWidget } = await import('./video-widget')
      const { stopCommandGreenScreens } = await import('./green-screen')
      stopCommandGreenScreens()
      return closeVideoWidget('main')
    }
    case 'count-adjust': {
      // 计时加减：打计数挑战挂件（它没开就退回开着的那个，见 preferSlot）
      const { challengeAdjust, preferSlot } = await import('./challenge-widget')
      return challengeAdjust(parseRangeOrNum(param ?? ''), preferSlot('challenge'))
    }
    case 'overtime-adjust': {
      // ★加班加减要打【加班器】：原来和「计时加减」一样不带槽位，两个都开着时会改错挂件
      const { challengeAdjust, preferSlot } = await import('./challenge-widget')
      return challengeAdjust(parseRangeOrNum(param ?? ''), preferSlot('overtime'))
    }
    case 'count-clear': {
      const { challengeSetValue, preferSlot } = await import('./challenge-widget')
      return challengeSetValue(0, preferSlot('challenge'))
    }
    case 'overtime-clear': {
      const { challengeSetValue, preferSlot } = await import('./challenge-widget')
      return challengeSetValue(0, preferSlot('overtime'))
    }
    case 'count-mul': {
      const { challengeMul, preferSlot } = await import('./challenge-widget')
      return challengeMul(param == null || param.trim() === '' ? 2 : Number(param), preferSlot('challenge'))
    }
    case 'overtime-mul': {
      const { challengeMul, preferSlot } = await import('./challenge-widget')
      return challengeMul(param == null || param.trim() === '' ? 2 : Number(param), preferSlot('overtime'))
    }
    case 'count-div': {
      const { challengeDiv, preferSlot } = await import('./challenge-widget')
      return challengeDiv(param == null || param.trim() === '' ? 2 : Number(param), preferSlot('challenge'))
    }
    case 'overtime-div': {
      const { challengeDiv, preferSlot } = await import('./challenge-widget')
      return challengeDiv(param == null || param.trim() === '' ? 2 : Number(param), preferSlot('overtime'))
    }
    case 'wheel-spin': {
      // 转盘抽奖（参考命令分发表「转盘抽奖/高级转盘」）：联动绿幕转盘窗口
      const { lotterySpin } = await import('./lottery-widget')
      return lotterySpin('lucky')
    }
    case 'nine-spin': {
      const { lotterySpin } = await import('./lottery-widget')
      return lotterySpin('nine')
    }
    case 'mobile': {
      // 手游动作（参考软件：自动抬头/低头/转圈/蹦迪/前进/后退/左右移动）→ SendKeys 模拟
      const [rawAction, rawDuration] = String(param || 'up').split('|')
      const a = rawAction || 'up'
      const SEQ: Record<string, string> = {
        up: '{W}', down: '{S}', turn: '{D}', turnfire: '^d', dance: '{A}{D}{A}{D}',
        dance2: '{W}{S}{W}{S}', fwd: '{W}{W}', back: '{S}{S}', lmove: '{A}{A}', rmove: '{D}{D}'
      }
      const HOLD: Record<string, string> = { up: 'W', down: 'S', turn: 'D', turnfire: 'D', fwd: 'W', back: 'S', lmove: 'A', rmove: 'D' }
      const duration = Number(rawDuration)
      if (Number.isFinite(duration) && duration > 0 && HOLD[a]) return holdKey(HOLD[a], duration)
      return sendKeys(SEQ[a] || '{W}')
    }
    case 'script-sequence': {
      let sequence: Array<{ cmd: string; param?: string }> = []
      try { sequence = JSON.parse(String(param || '[]')) } catch { return { ok: false, error: '脚本序列格式无效' } }
      if (!Array.isArray(sequence)) return { ok: false, error: '脚本序列格式无效' }
      for (const step of sequence) {
        if (options?.isCurrent && !options.isCurrent()) return { ok: false, error: '事件已取消' }
        if (!step || typeof step.cmd !== 'string') continue
        if (step.cmd === 'delay') {
          const ms = Math.max(0, Math.min(600_000, Number(step.param) || 0))
          if (ms) await new Promise<void>((resolve) => setTimeout(resolve, ms))
          continue
        }
        const result = await entertainmentCommand(step.cmd, step.param, options)
        if (!result.ok) return result
        // 键鼠/长按底层调用通过隐藏 PowerShell 进程发送；脚本宏必须等这一步完成，
        // 否则“按住→延时→弹起”会在子进程尚未执行时互相穿插。
        if (step.cmd === 'key-hold') {
          const rawMs = String(step.param || '').split(/[,，]/)[1] || '1000'
          const range = rawMs.match(/^(\d+)\s*[~～-]\s*(\d+)$/)
          const waitMs = range ? Math.max(Number(range[1]), Number(range[2])) : Math.max(10, Number(rawMs) || 1000)
          await new Promise<void>((resolve) => setTimeout(resolve, Math.min(600_000, waitMs) + 25))
        } else if (step.cmd === 'key-sequence' || step.cmd === 'key-up' || step.cmd === 'mouse' || step.cmd === 'send-text' || step.cmd === 'paste-text') {
          await new Promise<void>((resolve) => setTimeout(resolve, 35))
        }
      }
      return { ok: true }
    }
    default:
      return { ok: false, error: '未知动作命令' }
  }
}
