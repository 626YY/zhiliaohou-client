// 特色整蛊盲盒（照时间插件的盲盒）：
//   「盲盒礼物」：哪些礼物在抽盲盒、各自勾选奖池——就是礼物触发里动作为「特色整蛊盲盒」的规则，这里改的就是那条规则；
//   「盲盒事件库」：每个事件 = 一条特色整蛊（玩法 + 操作 + 数量，数量可以随机），可以顺带一个游戏整蛊。
// 观众每送一份，从这个礼物勾选的事件里随机抽一个执行；连送很多份就抽很多次。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Minus, Pencil, Plus, Sparkles, Trash2, Zap } from 'lucide-react'
import { Btn, Field, Input, Pill, Toggle } from '../ui'
import EmojiText from '../EmojiText'
import SpecialActionFields from '../SpecialActionFields'
import GamePrankSelect from '../GamePrankSelect'
import SpecialBoxPool from './SpecialBoxPool'
import { GiftIcon, LinkModal } from './SpecialLinks'
import { triggerText } from '../../lib/specialArt'
import { useSpecialBoxEvents } from '../../lib/useSpecialBoxEvents'
import { useToast } from '../../stores/ui'
import { ruleActions } from '@shared/entertainmentActions'
import { newSpecialBoxEventId, parseSpecialBoxParam, specialActionText, specialBoxEventDefaultName, specialDefaultParam, type SpecialBoxEvent } from '@shared/specialGames'
import type { EntertainmentRule } from '@shared/types'

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

// 盲盒事件库：改了稍等一下整份存回主进程（删掉的事件主进程会顺手从各礼物的奖池里摘掉）
function BoxEventLibrary({ rules }: { rules: EntertainmentRule[] }) {
  const toast = useToast((s) => s.toast)
  const { events, loaded, save } = useSpecialBoxEvents()
  const [draft, setDraft] = useState<SpecialBoxEvent[]>(events)
  const [open, setOpen] = useState(false)
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
  const add = () => {
    const param = specialDefaultParam('catch_duck')
    const ev: SpecialBoxEvent = { id: newSpecialBoxEventId(), name: specialBoxEventDefaultName(param), param, enabled: true, weight: 1, prank: '' }
    commit([...draft, ev])
    setOpen(true)
    setExpanded(ev.id)
  }
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
        <span className="hidden text-xs text-[var(--text-3)] sm:inline">每个事件是一条特色整蛊：玩法、操作、数量（可以随机），还能顺带一个游戏整蛊。</span>
        <Btn size="sm" variant="secondary" className="ml-auto" onClick={add}><Plus size={13} />添加事件</Btn>
      </div>
      {open && (
        <div className="mt-2 divide-y divide-[var(--line)]">
          {loaded && draft.length === 0 && <div className="py-5 text-center text-sm text-[var(--text-4)]">事件库是空的，点「添加事件」加一个</div>}
          {draft.map((e) => {
            const isOpen = expanded === e.id
            const custom = e.name !== specialBoxEventDefaultName(e.param)
            return (
              <div key={e.id} className="py-2.5" data-box-event={e.id}>
                <div className="flex items-center gap-2">
                  <Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : e.id)} aria-expanded={isOpen} aria-label={`编辑事件 ${e.name}`} className="min-w-0 flex-1 justify-start whitespace-normal text-left">
                    {isOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                    <span className={`min-w-0 flex-1 truncate font-medium ${e.enabled ? 'text-[var(--text)]' : 'text-[var(--text-4)]'}`}>{e.name}</span>
                    {custom && <span className="hidden shrink-0 text-[11px] text-[var(--text-3)] sm:inline">{specialActionText(e.param)}</span>}
                    {e.prank && <Pill tone="info">+游戏整蛊</Pill>}
                    {e.weight !== 1 && e.weight > 0 && <span className="tnum shrink-0 text-[11px] text-[var(--text-3)]">权重 {e.weight}</span>}
                  </Btn>
                  <span className="hidden w-14 shrink-0 text-right text-[11px] text-[var(--text-4)] sm:block">{uses[e.id] || 0} 个礼物</span>
                  <Toggle value={e.enabled} onChange={(v) => update(e.id, { enabled: v })} label={`启用事件 ${e.name}`} />
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
          <BoxEventLibrary rules={rules} />
        </div>
      </div>
      {editing !== undefined && (
        <LinkModal box rule={editing} images={images} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onRulesChanged() }} />
      )}
    </section>
  )
}
