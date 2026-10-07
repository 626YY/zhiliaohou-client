import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, FolderOpen, Minus, Plus, X, Zap } from 'lucide-react'
import type { TimeBlindBoxEvent, TimeWidgetGift, TimeWidgetState } from '@shared/types'
import { blindBoxGroups, resolveTimeBlindBoxPool, validateTimeBlindBoxEvent } from '@shared/timeBlindBox'
import { prankGroups, usePrankCatalog } from '../lib/pranks'
import { PRANK_GAMES, useVisibleGameIds } from './GamePrankSelect'
import { Btn, Field, Input, Pill, Select, Toggle } from './ui'

const OPERATIONS = [
  { value: 'add', label: '+', name: '加时' },
  { value: 'subtract', label: '−', name: '减时' },
  { value: 'multiply', label: '×', name: '乘时间' },
  { value: 'divide', label: '÷', name: '除时间' }
] as const

export function timeEventText(event: TimeBlindBoxEvent): string {
  const symbol = OPERATIONS.find(item => item.value === event.op)?.label || '?'
  const number = (value: number) => Number.isFinite(value) ? String(value) : '…'
  const amount = event.value2 == null ? number(event.value) : `${number(event.value)}～${number(event.value2)}`
  return `${symbol}${amount}${event.op === 'add' || event.op === 'subtract' ? ' 秒' : ' 倍'}`
}

function eventDefaultName(event: TimeBlindBoxEvent): string {
  return `时间 ${timeEventText(event)}`
}

export function TimeBlindBoxPool({ gift, events, onChange }: {
  gift: TimeWidgetGift
  events: TimeBlindBoxEvent[]
  onChange: (ids: string[]) => void
}) {
  const ids = gift.blindBoxEventIds || []
  const pool = resolveTimeBlindBoxPool(events, ids)
  const missing = ids.filter(id => !events.some(event => event.id === id))
  return <div className="basis-full space-y-2 border-t border-[var(--line)] pt-2" data-testid="time-blindbox-pool">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-[var(--text-3)]">抽奖事件 · 已选 {ids.length} 项 · 每份礼物随机抽一项</span>
      <div className="flex gap-1">
        <Btn size="sm" variant="ghost" disabled={!events.length} onClick={() => onChange(events.map(event => event.id))}>全选</Btn>
        <Btn size="sm" variant="ghost" disabled={!ids.length} onClick={() => onChange([])}>清空选择</Btn>
      </div>
    </div>
    {events.length === 0 && <div className="text-xs text-[var(--text-4)]">先在下方事件库添加事件</div>}
    <div className="flex flex-wrap gap-1.5">
      {events.map((event, index) => {
        const selected = ids.includes(event.id)
        return <Btn key={`${event.id}-${index}`} size="sm" variant={selected ? 'secondary' : 'ghost'} role="checkbox" aria-checked={selected}
          aria-label={`抽奖事件 ${event.name || '未命名事件'}`} onClick={() => onChange(selected ? ids.filter(id => id !== event.id) : [...ids, event.id])}
          className={selected ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-2)]' : ''}>
          {selected && <Check size={12} />} {event.name || '未命名事件'} <span className="tnum text-[var(--text-3)]">{timeEventText(event)}</span>
          {event.enabled === false && <span className="text-[10px] text-[var(--warn)]">已停用</span>}
        </Btn>
      })}
    </div>
    {!pool.ok && <div role="alert" className="text-xs text-[var(--danger)]">{pool.error}{missing.length > 0 && <Btn size="sm" variant="ghost" onClick={() => onChange(ids.filter(id => !missing.includes(id)))}>移除失效项</Btn>}</div>}
  </div>
}

const GROUP_NONE = '未分组'
const groupName = (event?: TimeBlindBoxEvent) => (event ? String(event.group || '').trim() || GROUP_NONE : '')

export default function TimeBlindBoxEditor({ events, gifts, state, busy, error, onChange, onRemove, onTest, onCancel }: {
  events: TimeBlindBoxEvent[]
  gifts: TimeWidgetGift[]
  state: TimeWidgetState
  busy: boolean
  error: string
  onChange: (events: TimeBlindBoxEvent[]) => void
  onRemove: (id: string) => void
  onTest: (id: string) => void
  onCancel: () => void
}) {
  usePrankCatalog() // 整蛊下拉来自定义包，刷新时重渲染
  // 游戏整蛊下拉只列能用的游戏（mod 下架且没装的不列）；事件里已经选着的那款照常列出
  const visibleGameIds = useVisibleGameIds()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [fileError, setFileError] = useState('')
  const update = (id: string, patch: Partial<TimeBlindBoxEvent>) => {
    onChange(events.map(event => {
      if (event.id !== id) return event
      const next = { ...event, ...patch }
      if (patch.name == null && event.name === eventDefaultName(event)) next.name = eventDefaultName(next)
      return next
    }))
  }
  // 整组开关：一个组 = 一个品游项目。停用的事件真触发时抽不到（resolveTimeBlindBoxPool 跳过），
  // 但奖池里的勾选保持不动 —— 主播只是「今晚不开这个项目」，不是删掉它。
  const toggleGroup = (name: string, on: boolean) => {
    onChange(events.map((event) => (groupName(event) === name ? { ...event, enabled: on } : event)))
  }
  // 有项目的排前面、同项目挨着（sort 稳定，组内保持原顺序）
  const ordered = [...events].sort((a, b) => {
    const ga = groupName(a)
    const gb = groupName(b)
    if (ga === gb) return 0
    if (ga === GROUP_NONE) return 1
    if (gb === GROUP_NONE) return -1
    return ga.localeCompare(gb, 'zh')
  })
  const stats = new Map(blindBoxGroups(events).map((row) => [row.group, row]))
  const add = () => {
    const event: TimeBlindBoxEvent = { id: crypto.randomUUID(), name: '', op: 'add', value: 30, value2: null, video: '', videoSeconds: 0, sound: '', soundVolume: 100, action: 'none', actionParam: '' }
    event.name = eventDefaultName(event)
    onChange([...events, event])
    setExpanded(event.id)
  }
  const pick = async (event: TimeBlindBoxEvent, kind: 'video' | 'sound') => {
    try {
      setFileError('')
      const result = await window.api.selectFile({
        title: kind === 'video' ? '选择时间事件视频' : '选择时间事件音效',
        filters: [{ name: kind === 'video' ? '视频' : '音频', extensions: kind === 'video' ? ['mp4', 'webm', 'mov', 'm4v', 'mkv'] : ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
        properties: ['openFile']
      })
      if (result.ok && result.path) update(event.id, { [kind]: result.path })
    } catch (cause) { setFileError(cause instanceof Error ? cause.message : '无法选择文件，请重试') }
  }
  const result = state.lastResult
  const phase = result && ({ running: '执行中', completed: '已完成', error: '执行失败', cancelled: '已取消' } as const)[result.phase]
  return <section className="mt-5 border-t border-[var(--line)] pt-4" aria-label="时间盲盒事件库">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-[var(--text)]">盲盒事件库 <span className="ml-1 font-normal text-[var(--text-4)]">{events.length}</span></h3>
        <p className="mt-1 text-xs text-[var(--text-3)]">为每个事件设置时间、视频、音效和整蛊动作。</p></div>
      <Btn size="sm" variant="secondary" onClick={add}><Plus size={13} /> 添加事件</Btn>
    </div>
    <div className="divide-y divide-[var(--line)]">
      {events.length === 0 && <div className="py-5 text-center text-sm text-[var(--text-4)]">暂无盲盒事件，点击加号添加</div>}
      {ordered.map((event, index) => {
        const group = groupName(event)
        const groupHead = group !== groupName(ordered[index - 1])
        const stat = stats.get(group) || { total: 1, enabled: 1 }
        const invalid = validateTimeBlindBoxEvent(event)
        const isOpen = expanded === event.id
        const uses = gifts.filter(gift => gift.mode === 'blindbox' && gift.blindBoxEventIds?.includes(event.id)).length
        const isSeconds = event.op === 'add' || event.op === 'subtract'
        const invalidVideoDuration = !Number.isFinite(event.videoSeconds ?? 0) || (event.videoSeconds ?? 0) < 0 || (event.videoSeconds ?? 0) > 2_147_483
        const invalidVolume = !Number.isFinite(event.soundVolume ?? 100) || (event.soundVolume ?? 100) < 0 || (event.soundVolume ?? 100) > 100
        return <div key={`${event.id}-${index}`} className="py-3" data-testid="time-blindbox-event">
          {groupHead && (
            <div className="mb-2 flex items-center justify-between gap-2" data-testid="time-blindbox-group" aria-label={`项目 ${group}`}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-semibold text-[var(--text-2)]">{group}</span>
                <span className="tnum shrink-0 text-[11px] text-[var(--text-4)]">{stat.enabled}/{stat.total} 启用</span>
                {stat.enabled === 0 && <Pill tone="muted">整组停用</Pill>}
              </div>
              <Toggle value={stat.enabled > 0} onChange={(on) => toggleGroup(group, on)} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : event.id)} aria-expanded={isOpen} aria-label={`编辑事件 ${event.name || '未命名事件'}`} className="min-w-0 flex-1 justify-start whitespace-normal text-left">
              {isOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">{event.name || '未命名事件'}</span>
              <span className="tnum shrink-0 text-[var(--accent-2)]">{timeEventText(event)}</span>
            </Btn>
            {event.enabled === false && <Pill tone="muted">停用</Pill>}
            <span className="hidden text-[11px] text-[var(--text-4)] sm:block">{uses} 个礼物</span>
            <Btn size="sm" variant="secondary" onClick={() => onTest(event.id)} disabled={busy || !!invalid} aria-label={`测试事件 ${event.name || '未命名事件'}`}><Zap size={12} /> 测试</Btn>
            <Btn size="sm" variant="ghost" onClick={() => onRemove(event.id)} aria-label={`删除事件 ${event.name || '未命名事件'}`} title={uses ? `删除事件，并从 ${uses} 个礼物奖池移除` : '删除事件'}><Minus size={13} /></Btn>
          </div>
          {invalid && <div role="alert" className="mt-1 pl-3 text-xs text-[var(--danger)]">{invalid}</div>}
          {isOpen && <div className="mt-3 space-y-3 pl-3" data-testid="time-blindbox-fields">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="事件名称"><Input aria-label="事件名称" value={event.name} onChange={e => update(event.id, { name: e.target.value })} placeholder="例如 时间翻三倍" /></Field>
              <Field label="时间运算"><div className="flex gap-1" role="group" aria-label="时间运算">{OPERATIONS.map(op => <Btn key={op.value} size="sm" variant={event.op === op.value ? 'primary' : 'secondary'} className="h-9 w-10 text-base" aria-pressed={event.op === op.value} aria-label={op.name} onClick={() => update(event.id, { op: op.value })}>{op.label}</Btn>)}</div></Field>
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <Field label={isSeconds ? '秒数' : '倍数'} className="w-28"><Input aria-label="事件数值" type="number" min={0} step="any" value={Number.isFinite(event.value) ? event.value : ''} onChange={e => update(event.id, { value: e.target.value === '' ? NaN : Number(e.target.value) })} /></Field>
              <div className="pt-7"><label className="flex items-center gap-2 text-xs text-[var(--text-3)]"><Toggle value={event.value2 != null} onChange={enabled => update(event.id, { value2: enabled ? event.value : null })} />随机范围</label></div>
              {event.value2 != null && <Field label={isSeconds ? '到（秒）' : '到（倍）'} className="w-28"><Input aria-label="事件范围终点" type="number" min={0} step="any" value={Number.isFinite(event.value2) ? event.value2 : ''} onChange={e => update(event.id, { value2: e.target.value === '' ? NaN : Number(e.target.value) })} /></Field>}
              <p className="min-w-[180px] flex-1 pt-7 text-xs text-[var(--text-4)]">{event.value2 != null ? '每次抽中后，从范围内随机取值' : `抽中后${isSeconds ? (event.op === 'add' ? '增加' : '减少') : (event.op === 'multiply' ? '乘以' : '除以')} ${Number.isFinite(event.value) ? event.value : '…'} ${isSeconds ? '秒' : '倍'}`}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="绿幕视频" hint="抽中时播放，0 秒表示播完关闭">
                <div className="flex gap-1"><Input aria-label="事件视频路径" value={event.video || ''} onChange={e => update(event.id, { video: e.target.value })} placeholder="选择或粘贴视频路径" className="min-w-0 flex-1 text-xs" /><Btn size="sm" variant="secondary" onClick={() => void pick(event, 'video')} aria-label="选择事件视频"><FolderOpen size={13} /></Btn>{event.video && <Btn size="sm" variant="ghost" onClick={() => update(event.id, { video: '' })} aria-label="清除事件视频"><X size={12} /></Btn>}</div>
                {(event.video || invalidVideoDuration) && <div className="mt-2 flex items-center gap-2"><span className="text-xs text-[var(--text-3)]">播放秒数</span><Input aria-label="事件视频秒数" type="number" min={0} step={0.1} value={Number.isFinite(event.videoSeconds) ? event.videoSeconds : ''} onChange={e => update(event.id, { videoSeconds: e.target.value === '' ? NaN : Number(e.target.value) })} className="w-24" /></div>}
              </Field>
              <Field label="音效" hint="与视频、时间运算一起执行">
                <div className="flex gap-1"><Input aria-label="事件音效路径" value={event.sound || ''} onChange={e => update(event.id, { sound: e.target.value })} placeholder="选择或粘贴音效路径" className="min-w-0 flex-1 text-xs" /><Btn size="sm" variant="secondary" onClick={() => void pick(event, 'sound')} aria-label="选择事件音效"><FolderOpen size={13} /></Btn>{event.sound && <Btn size="sm" variant="ghost" onClick={() => update(event.id, { sound: '' })} aria-label="清除事件音效"><X size={12} /></Btn>}</div>
                {(event.sound || invalidVolume) && <div className="mt-2 flex items-center gap-2"><span className="text-xs text-[var(--text-3)]">音量 %</span><Input aria-label="事件音效音量" type="number" min={0} max={100} value={Number.isFinite(event.soundVolume) ? event.soundVolume : ''} onChange={e => update(event.id, { soundVolume: e.target.value === '' ? NaN : Number(e.target.value) })} className="w-24" /></div>}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="附加事件"><Select aria-label="附加事件类型" value={event.action || 'none'} onChange={e => update(event.id, { action: e.target.value as TimeBlindBoxEvent['action'], actionParam: '' })}><option value="none">不附加</option><option value="prank">游戏整蛊</option><option value="effect">礼物动画</option></Select></Field>
              {event.action === 'effect' && <Field label="礼物动画"><Select aria-label="事件礼物动画" value={event.actionParam || ''} onChange={e => update(event.id, { actionParam: e.target.value })}><option value="">选择动画</option><option value="parabola">抛物线</option><option value="bomb">炸弹</option><option value="car">跑车</option><option value="firework">烟花</option><option value="rain">礼物雨</option></Select></Field>}
              {event.action === 'prank' && <Field label="游戏整蛊"><Select aria-label="事件游戏整蛊" value={event.actionParam || ''} onChange={e => update(event.id, { actionParam: e.target.value })}><option value="">选择事件</option>{PRANK_GAMES.filter(([game]) => !visibleGameIds || visibleGameIds.has(game) || String(event.actionParam || '').split('|')[0] === game).map(([game, label]) => <optgroup key={game} label={label}>{prankGroups(game).flatMap(group => group.items).filter(prank => !prank.danger).map(prank => <option key={prank.id} value={`${game}|${prank.id}`}>{prank.name}</option>)}</optgroup>)}</Select></Field>}
            </div>
          </div>}
        </div>
      })}
    </div>
    <div className="mt-3 border-t border-[var(--line)] pt-3" aria-label="盲盒执行状态">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span role="status" className="text-[var(--text-3)]">{state.activeEvent ? `正在执行「${state.activeEvent.name}」` : '盲盒待命'} · 排队 {state.queueLength || 0} 项</span><Btn size="sm" variant="ghost" disabled={busy || (!state.activeEvent && !state.queueLength)} onClick={onCancel}>停止盲盒并清空队列</Btn></div>
      {result && <div className="mt-2 text-xs text-[var(--text-3)]">{result.source === 'test' ? '测试' : result.sender || '观众'} · {result.eventName} · {phase}<span className="tnum ml-2">{result.before} → {result.after} 秒</span></div>}
      {(error || fileError || result?.error) && <div role="alert" className="mt-2 break-words text-xs text-[var(--danger)]">{error || fileError || result?.error}</div>}
    </div>
  </section>
}
