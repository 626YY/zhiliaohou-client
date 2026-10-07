// 特色整蛊盲盒（照时间插件的盲盒）：
//   「盲盒礼物」：哪些礼物在抽盲盒、各自勾选奖池——就是礼物触发里动作为「特色整蛊盲盒」的规则，这里改的就是那条规则；
//   「开奖画面与配音」：抽中时敲锣、蹦出「锁链+5」、AI 念「锁链加5」（照时间盲盒那批视频）；
//   「盲盒事件库」：每个事件 = 一条特色整蛊（玩法 + 操作 + 数量，数量可以随机），可以顺带一个游戏整蛊、自己改配音台词。
// 观众每送一份，从这个礼物勾选的事件里随机抽一个执行；连送很多份就抽很多次，逐条开奖。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Film, Minus, Pencil, Plus, Sparkles, Trash2, Volume2, Zap } from 'lucide-react'
import { Btn, Field, Input, Pill, Toggle } from '../ui'
import EmojiText from '../EmojiText'
import SpecialActionFields from '../SpecialActionFields'
import GamePrankSelect from '../GamePrankSelect'
import SpecialBoxPool, { groupSpecialBoxEvents, specialBoxEventLabel } from './SpecialBoxPool'
import SpecialRevealSettings from './SpecialRevealSettings'
import SpecialParamField from './SpecialParamField'
import { GiftIcon, LinkModal } from './SpecialLinks'
import { triggerText } from '../../lib/specialArt'
import { playRevealPreview } from '../../lib/specialRevealAudio'
import { useSpecialBoxEvents } from '../../lib/useSpecialBoxEvents'
import { useToast } from '../../stores/ui'
import { mediaUrl } from '../../utils/mediaUrl'
import { ruleActions } from '@shared/entertainmentActions'
import {
  SPECIAL_GAMES,
  SPECIAL_GAME_MAP,
  joinSpecialParam,
  newSpecialBoxEventId,
  parseSpecialBoxParam,
  parseSpecialParam,
  resolveSpecialCount,
  specialActionText,
  specialBoxEventDefaultName,
  specialVoiceLine,
  type SpecialBoxEvent,
  type SpecialGameId
} from '@shared/specialGames'
import type { EntertainmentRule } from '@shared/types'

// 试听一个事件开出来的声音（锣 + 配音）；没有数量的只有锣
async function previewEvent(e: Pick<SpecialBoxEvent, 'param' | 'voice' | 'silent' | 'video' | 'voiceWithVideo'>, toast: (msg: string, tone?: 'success' | 'error' | 'info') => void): Promise<void> {
  if (e.video && !e.voiceWithVideo) { toast('这个事件开出来放它自己的视频（展开能预览），不敲锣也不念', 'info'); return }
  const r = await window.api.specialVoicePreview({ param: e.param, voice: e.voice, silent: e.silent })
  if (!r.ok && r.error) toast(r.error, 'error')
  else if (!r.line) toast(e.silent ? '这个事件设成了不念，只敲锣' : '这个事件没有数量，开出来只敲锣、不念', 'info')
  await playRevealPreview(r)
}

/** 礼物触发里以「特色整蛊盲盒」为主动作的规则 */
export function boxRulesOf(rules: EntertainmentRule[]): EntertainmentRule[] {
  return rules.filter((r) => r.actionType === 'command' && r.commandCmd === 'special-box')
}

// 一个抽盲盒的礼物：抬头是触发和开关，下面直接勾奖池（改完稍等一下自动存进那条礼物规则）
function BoxGiftRow({ rule, images, onChanged, onEdit }: { rule: EntertainmentRule; images: Record<string, string>; onChanged: () => void; onEdit: () => void }) {
  const toast = useToast((s) => s.toast)
  const [param, setParam] = useState(rule.commandParam || '')
  const [confirm, setConfirm] = useState(false)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(rule)
  latest.current = rule
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const next = pending.current
    pending.current = null
    if (next == null) return Promise.resolve()
    return window.api.entertainmentRuleUpdate({ ...latest.current, commandParam: next }).then(() => onChanged())
  }
  useEffect(() => { if (pending.current == null) setParam(rule.commandParam || '') }, [rule.commandParam])
  useEffect(() => () => { void flush() }, [])
  const change = (next: string) => {
    setParam(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 450)
  }
  const draw = async () => {
    await flush()
    const r = await window.api.specialBoxDraw(param)
    if (!r.ok) toast(r.error || '没抽出来', 'error')
    else toast(`开出：${(r.opened ?? []).join('、')}`, 'success')
  }
  const toggle = async (on: boolean) => {
    await flush()
    await window.api.entertainmentRuleUpdate({ ...latest.current, commandParam: param, enabled: on })
    onChanged()
  }
  const remove = async () => {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return }
    pending.current = null
    await window.api.entertainmentRuleRemove(rule.id)
    onChanged()
  }
  const gift = (rule.triggerType || 'gift') === 'gift'
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3" data-box-rule={rule.id}>
      <div className="flex flex-wrap items-center gap-2">
        {gift ? <GiftIcon name={rule.giftName} images={images} size={30} /> : <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-[var(--info-soft)] text-[11px] font-semibold text-[var(--info)]">{triggerText(rule).slice(0, 2)}</span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            <EmojiText text={triggerText(rule)} />
            {(rule.times ?? 1) > 1 && <span className="ml-1 text-xs text-[var(--text-3)]">每 {rule.times} 个</span>}
          </div>
          <div className="text-[11px] text-[var(--text-4)]">每份抽一次{rule.multiply === false ? '（一次送礼只算一次）' : '，送几份抽几次'}</div>
        </div>
        <Toggle value={rule.enabled !== false} onChange={(v) => void toggle(v)} label={`启用盲盒 ${rule.giftName || triggerText(rule)}`} />
        <Btn size="sm" variant="secondary" onClick={() => void draw()} title="按现在勾选的奖池抽一次，发到直播窗口（没开会先打开）"><Sparkles size={13} />抽一次</Btn>
        <Btn size="sm" variant="ghost" aria-label="编辑触发方式" title="换礼物 / 触发方式 / 更多选项" onClick={() => void flush().then(onEdit)}><Pencil size={14} /></Btn>
        <Btn size="sm" variant={confirm ? 'danger' : 'ghost'} aria-label="删除这个盲盒礼物" onClick={() => void remove()}>{confirm ? '再点删除' : <Trash2 size={14} />}</Btn>
      </div>
      <div className="mt-2.5 border-t border-[var(--line)] pt-2.5">
        <SpecialBoxPool value={param} onChange={change} idp={`box-${rule.id}`} />
      </div>
    </div>
  )
}

// 盲盒事件库：改了稍等一下整份存回主进程（删掉的事件主进程会顺手从各礼物的奖池里摘掉）。
// 事件按玩法分组（一组可以整组开关、折叠），每个事件能试听开出来的锣声和配音。
function BoxEventLibrary({ rules }: { rules: EntertainmentRule[] }) {
  const toast = useToast((s) => s.toast)
  const { events, loaded, save } = useSpecialBoxEvents()
  const [draft, setDraft] = useState<SpecialBoxEvent[]>(events)
  const [open, setOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirm, setConfirm] = useState('')
  const gen = useRef(0)
  const pending = useRef<SpecialBoxEvent[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { if (!pending.current) setDraft(events) }, [events])
  const flush = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const next = pending.current
    if (!next) return
    const mine = gen.current
    const saved = await save(next)
    if (mine === gen.current) { pending.current = null; setDraft(saved) }
  }
  useEffect(() => () => { void flush() }, [])
  const commit = (next: SpecialBoxEvent[]) => {
    gen.current++
    setDraft(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 450)
  }
  // 名字还是默认的（= 动作描述）就跟着动作改；自己起过名字的不动
  const update = (id: string, patch: Partial<SpecialBoxEvent>) =>
    commit(draft.map((e) => {
      if (e.id !== id) return e
      const next = { ...e, ...patch }
      if (patch.param && patch.name == null && e.name === specialBoxEventDefaultName(e.param)) next.name = specialBoxEventDefaultName(patch.param)
      return next
    }))
  // 在哪个玩法组里点「加一档」就加在哪个玩法里（2026-10-07 用户：「应该是在单独的整蛊里面加吧，现在都不知道加到哪里去了」）。
  // 新加的那条直接展开、滚到眼前，数量先给一个固定的常用值，主播再改。
  const add = (game: SpecialGameId) => {
    const meta = SPECIAL_GAME_MAP[game]
    const param = joinSpecialParam({ id: game, op: meta.ops[0].value, count: String(meta.countDef), fields: {} })
    const ev: SpecialBoxEvent = { id: newSpecialBoxEventId(), name: specialBoxEventDefaultName(param), param, enabled: true, weight: 1, prank: '' }
    commit([...draft, ev])
    setOpen(true)
    setOpenGroups((s) => new Set(s).add(game))
    setExpanded(ev.id)
    setTimeout(() => document.querySelector(`[data-box-event="${ev.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
  }
  const flipGroup = (id: string) => setOpenGroups((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  // 整组开关：停用的事件真触发时抽不到，礼物奖池里的勾选不动（今晚不开这个玩法而已）
  const toggleGroup = (ids: string[], on: boolean) => commit(draft.map((e) => (ids.includes(e.id) ? { ...e, enabled: on } : e)))
  // 17 个玩法一个不落都列出来（一个事件都没有的也在，好往里加）
  const groups = useMemo(() => {
    const have = new Map(groupSpecialBoxEvents(draft).map((g) => [g.id, g]))
    const out = SPECIAL_GAMES.map((m) => have.get(m.id) ?? { id: m.id, name: m.name, events: [] })
    const other = have.get('')
    return other ? [...out, other] : out
  }, [draft])
  const remove = (id: string) => {
    if (confirm !== id) { setConfirm(id); setTimeout(() => setConfirm((c) => (c === id ? '' : c)), 3000); return }
    commit(draft.filter((e) => e.id !== id))
    setConfirm('')
  }
  const test = async (id: string) => {
    await flush()
    const r = await window.api.specialBoxEventTest(id)
    if (!r.ok) toast(r.error || '测试失败', 'error')
  }
  // 给一个玩法导入开奖视频（一次选多个）：文件名里的数就是数量，同数量的事件直接挂上，没有的新建
  const importVideos = async (game: SpecialGameId, name: string) => {
    await flush()
    const r = await window.api.specialBoxImportVideos(game)
    if (!r.ok) { toast(r.error || '导入失败', 'error'); return }
    if (!r.attached && !r.added) { if (r.skipped) toast(`没有导入：${r.skipped} 个文件认不出数量或已经导过了`, 'info'); return }
    gen.current++
    pending.current = null
    setDraft(r.events)
    setOpen(true)
    setOpenGroups((s) => new Set(s).add(game))
    toast(`「${name}」导入开奖视频：挂到已有事件 ${r.attached} 个，新建 ${r.added} 个${r.skipped ? `，跳过 ${r.skipped} 个` : ''}`, 'success')
  }
  // 每个事件在几个礼物的奖池里（勾的是「事件库全部」的也算）
  const uses = useMemo(() => {
    const out: Record<string, number> = {}
    for (const rule of rules) {
      for (const a of ruleActions(rule)) {
        if (a.actionType !== 'command' || a.commandCmd !== 'special-box') continue
        const p = parseSpecialBoxParam(a.commandParam)
        for (const e of draft) if (p.all ? e.enabled : p.ids.includes(e.id)) out[e.id] = (out[e.id] || 0) + 1
      }
    }
    return out
  }, [rules, draft])
  const enabledCount = draft.filter((e) => e.enabled).length

  return (
    <div data-testid="special-box-events">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="flex min-w-0 items-center gap-1.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={15} className="text-[var(--text-3)]" /> : <ChevronRight size={15} className="text-[var(--text-3)]" />}
          <span className="text-sm font-medium text-[var(--text)]">盲盒事件库</span>
          <span className="tnum text-xs text-[var(--text-4)]">{loaded ? `${enabledCount}/${draft.length} 启用` : '读取中…'}</span>
        </button>
        <span className="hidden text-xs text-[var(--text-3)] sm:inline">每个事件是一条特色整蛊：玩法、操作、数量（可以随机），还能顺带一个游戏整蛊。在哪个玩法里点「加一档」就加在哪个玩法里。</span>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          {groups.map((g) => {
            const gid = g.id || 'other'
            const groupOpen = openGroups.has(gid)
            const on = g.events.filter((e) => e.enabled).length
            return (
              <div key={gid} className="rounded-lg border border-[var(--line)]" data-box-group={gid}>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={groupOpen} onClick={() => flipGroup(gid)}>
                    {groupOpen ? <ChevronDown size={14} className="shrink-0 text-[var(--text-3)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--text-3)]" />}
                    <span className="truncate text-sm font-medium text-[var(--text)]">{g.name}</span>
                    <span className="tnum shrink-0 text-xs text-[var(--text-4)]">{g.events.length ? `${on}/${g.events.length} 启用` : '还没有事件'}</span>
                    {!groupOpen && <span className="hidden min-w-0 truncate text-[11px] text-[var(--text-4)] md:inline">{g.events.map(specialBoxEventLabel).join('　')}</span>}
                  </button>
                  {g.id && (
                    <>
                      <Btn size="sm" variant="ghost" onClick={() => void importVideos(g.id as SpecialGameId, g.name)} aria-label={`给 ${g.name} 导入视频`} title={`一次选多个视频：文件名里的数就是数量（抓5只 = +5），开到这个事件就放这段视频`}>
                        <Film size={13} />导入视频
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => add(g.id as SpecialGameId)} aria-label={`在 ${g.name} 里加一档`} title={`给「${g.name}」加一个事件（加完在下面改操作和数量）`}>
                        <Plus size={13} />加一档
                      </Btn>
                    </>
                  )}
                  <Toggle value={on > 0} disabled={!g.events.length} onChange={(v) => toggleGroup(g.events.map((e) => e.id), v)} label={`整组启用 ${g.name}`} />
                </div>
                {groupOpen && (
                  <div className="divide-y divide-[var(--line)] border-t border-[var(--line)] px-2">
                    {g.events.map((e) => {
                      const isOpen = expanded === e.id
                      const custom = e.name !== specialBoxEventDefaultName(e.param)
                      const p = parseSpecialParam(e.param)
                      const autoLine = specialVoiceLine(e.param, resolveSpecialCount(p.count, 1))
                      return (
                        <div key={e.id} className="py-2" data-box-event={e.id}>
                          <div className="flex items-center gap-2">
                            <Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : e.id)} aria-expanded={isOpen} aria-label={`编辑事件 ${e.name}`} className="min-w-0 flex-1 justify-start whitespace-normal text-left">
                              {isOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                              <span className={`min-w-0 flex-1 truncate font-medium ${e.enabled ? 'text-[var(--text)]' : 'text-[var(--text-4)]'}`}>{custom ? e.name : specialBoxEventLabel(e)}</span>
                              {custom && <span className="hidden shrink-0 text-[11px] text-[var(--text-3)] sm:inline">{specialActionText(e.param)}</span>}
                              {e.video && <Pill tone="accent"><Film size={11} />视频</Pill>}
                              {e.video && !e.voiceWithVideo ? null : e.silent ? <span className="shrink-0 text-[11px] text-[var(--text-4)]">不念</span> : e.voice ? <span className="hidden max-w-[10rem] shrink-0 truncate text-[11px] text-[var(--text-3)] sm:inline">念「{e.voice}」</span> : null}
                              {e.prank && <Pill tone="info">+游戏整蛊</Pill>}
                              {e.weight !== 1 && e.weight > 0 && <span className="tnum shrink-0 text-[11px] text-[var(--text-3)]">权重 {e.weight}</span>}
                            </Btn>
                            <span className="hidden w-14 shrink-0 text-right text-[11px] text-[var(--text-4)] sm:block">{uses[e.id] || 0} 个礼物</span>
                            <Toggle value={e.enabled} onChange={(v) => update(e.id, { enabled: v })} label={`启用事件 ${e.name}`} />
                            <Btn size="sm" variant="ghost" onClick={() => void previewEvent(e, toast)} aria-label={`试听事件 ${e.name}`} title="在这里听一遍开出来的锣声和配音（不用开直播窗口）"><Volume2 size={13} /></Btn>
                            <Btn size="sm" variant="secondary" onClick={() => void test(e.id)} aria-label={`测试事件 ${e.name}`} title="发到直播窗口开一次（窗口没开会先打开）"><Zap size={12} />测试</Btn>
                            <Btn size="sm" variant={confirm === e.id ? 'danger' : 'ghost'} onClick={() => remove(e.id)} aria-label={`删除事件 ${e.name}`} title={uses[e.id] ? `删除事件，并从 ${uses[e.id]} 个礼物的奖池里去掉` : '删除事件'}>
                              {confirm === e.id ? '再点删除' : <Minus size={13} />}
                            </Btn>
                          </div>
                          {isOpen && (
                            <div className="mt-3 space-y-3 pl-3" data-box-event-fields>
                              <Field label="事件名称" hint="奖池和开出提示里显示；留空用动作描述">
                                <Input aria-label="事件名称" value={e.name} placeholder={specialBoxEventDefaultName(e.param)} onChange={(ev) => update(e.id, { name: ev.target.value })} />
                              </Field>
                              <SpecialActionFields value={e.param} onChange={(v) => update(e.id, { param: v })} idp={`sbe-${e.id}`} />
                              <SpecialParamField
                                spec={{ key: 'video', label: '开奖视频（可选）', type: 'file', fileKind: 'video', def: '', hint: '开到这个事件就在直播窗口里放这段视频（自动抠掉绿幕底），不敲锣、不出大字；视频一般自带配音，默认不再念' }}
                                value={e.video ?? ''}
                                onChange={(v) => update(e.id, { video: String(v) })}
                              />
                              {e.video && (
                                <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto]" data-box-event-video>
                                  <video src={mediaUrl(e.video)} controls preload="metadata" className="max-h-36 w-full rounded-md bg-black/60" />
                                  <SpecialParamField
                                    spec={{ key: 'videoVolume', label: '视频音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 100 }}
                                    value={e.videoVolume ?? 100}
                                    onChange={(v) => update(e.id, { videoVolume: Number(v) })}
                                  />
                                  <Field label="放视频时也念">
                                    <div className="flex h-9 items-center">
                                      <Toggle value={e.voiceWithVideo === true} onChange={(v) => update(e.id, { voiceWithVideo: v })} label={`事件 ${e.name} 放视频时也念`} />
                                    </div>
                                  </Field>
                                </div>
                              )}
                              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <Field label="配音台词" hint="开出来 AI 念的那句；留空按玩法和数量自动念，写 {数量} 会换成这次开出的数量">
                                  <Input aria-label="配音台词" value={e.voice ?? ''} disabled={e.silent === true} placeholder={autoLine || '这个事件没有数量，默认不念'} onChange={(ev) => update(e.id, { voice: ev.target.value })} />
                                </Field>
                                <Field label="不念">
                                  <div className="flex h-9 items-center gap-2">
                                    <Toggle value={e.silent === true} onChange={(v) => update(e.id, { silent: v })} label={`事件 ${e.name} 开出来不念`} />
                                    <Btn size="sm" variant="ghost" onClick={() => void previewEvent(e, toast)}><Volume2 size={13} />试听</Btn>
                                  </div>
                                </Field>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                                <Field label="同时触发游戏整蛊（可选）" hint="抽中这个事件时游戏里也来一下；游戏开着、选中的就是这款游戏时才会发出">
                                  <GamePrankSelect value={e.prank} onChange={(v) => update(e.id, { prank: v })} allowNone label="事件附带的游戏整蛊" />
                                </Field>
                                <Field label="抽中权重" hint="默认 1 大家一样；调大更容易抽到，0 = 暂时不抽" advanced>
                                  <Input aria-label="抽中权重" type="number" min={0} step="any" value={e.weight} onChange={(ev) => update(e.id, { weight: Math.max(0, Number(ev.target.value) || 0) })} />
                                </Field>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function SpecialBoxes({ rules, images, onRulesChanged }: { rules: EntertainmentRule[]; images: Record<string, string>; onRulesChanged: () => void }) {
  const [editing, setEditing] = useState<EntertainmentRule | null | undefined>(undefined)
  const boxRules = boxRulesOf(rules)
  return (
    <section className="mb-6" data-testid="special-boxes">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">🎁 特色整蛊盲盒</h3>
        <span className="text-xs text-[var(--text-3)]">和时间盲盒一样：观众每送一份，从这个礼物勾选的事件里随机抽一个</span>
        <Btn size="sm" className="ml-auto" onClick={() => setEditing(null)}><Plus size={13} />添加盲盒礼物</Btn>
      </div>
      <div className="zl-card space-y-3 p-3">
        {boxRules.length ? (
          boxRules.map((r) => <BoxGiftRow key={r.id} rule={r} images={images} onChanged={onRulesChanged} onEdit={() => setEditing(r)} />)
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--line)] px-3 py-4 text-center text-xs text-[var(--text-4)]">
            还没有礼物抽盲盒。点「添加盲盒礼物」选一个礼物，再在下面勾选它的奖池。
          </p>
        )}
        <div className="border-t border-[var(--line)] pt-3">
          <SpecialRevealSettings />
        </div>
        <div className="border-t border-[var(--line)] pt-3">
          <BoxEventLibrary rules={rules} />
        </div>
      </div>
      {editing !== undefined && (
        <LinkModal box rule={editing} images={images} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onRulesChanged() }} />
      )}
    </section>
  )
}
