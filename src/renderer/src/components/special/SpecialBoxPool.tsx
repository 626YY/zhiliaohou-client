// 特色整蛊盲盒的奖池：从「盲盒事件库」里勾选这份礼物抽哪些事件（照时间插件的「抽奖事件」）。
// 值就是动作命令 special-box 的参数：事件id,事件id,…|显示名。礼物联动、礼物触发、基础引导、转盘九宫格共用这一份。
// 事件按玩法分组（每个玩法十几二十档加减，全铺开太长）：收起时一个玩法一个小标签「锁链特效 38/38」，
// 点开铺出这一组的小格子（只写「+5环」「×3」，玩法名在组头上）；组名点一下 = 这一组全选 / 全不选。
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Btn, Input, Pill } from '../ui'
import { useSpecialBoxEvents } from '../../lib/useSpecialBoxEvents'
import { SPECIAL_BOX_DEFAULT_NAME, SPECIAL_GAMES, joinSpecialBoxParam, parseSpecialBoxParam, sortSpecialBoxEvents, specialActionShort, specialBoxEventDefaultName, type SpecialBoxEvent } from '@shared/specialGames'

export interface SpecialBoxGroup { id: string; name: string; events: SpecialBoxEvent[] }

/** 事件按玩法分组（玩法顺序同特色整蛊卡片顺序；组里先加后减再乘除、数量从小到大） */
export function groupSpecialBoxEvents(events: SpecialBoxEvent[]): SpecialBoxGroup[] {
  const map = new Map<string, SpecialBoxEvent[]>()
  for (const e of sortSpecialBoxEvents(events)) {
    const id = parseSpecialBoxEventGame(e)
    const list = map.get(id)
    if (list) list.push(e)
    else map.set(id, [e])
  }
  const out: SpecialBoxGroup[] = []
  for (const g of SPECIAL_GAMES) {
    const list = map.get(g.id)
    if (list) out.push({ id: g.id, name: g.name, events: list })
  }
  const other = map.get('')
  if (other) out.push({ id: '', name: '其他', events: other })
  return out
}
function parseSpecialBoxEventGame(e: SpecialBoxEvent): string {
  const id = String(e.param || '').split('|')[0].trim()
  return SPECIAL_GAMES.some((g) => g.id === id) ? id : ''
}

/** 小格子 / 列表上显示的字：自己起过名字的用名字，没起的只写动作（玩法名在组头上） */
export function specialBoxEventLabel(e: SpecialBoxEvent): string {
  return e.name && e.name !== specialBoxEventDefaultName(e.param) ? e.name : specialActionShort(e.param)
}

/** 新建盲盒时的默认奖池：事件库里所有启用的事件 */
export function defaultSpecialBoxParam(events: SpecialBoxEvent[], name = ''): string {
  return joinSpecialBoxParam({ ids: events.filter((e) => e.enabled).map((e) => e.id), all: false, name })
}

/** 奖池里能抽的事件（停用的、权重 0 的不算） */
export function specialBoxUsable(param: string | undefined, events: SpecialBoxEvent[]): SpecialBoxEvent[] {
  const p = parseSpecialBoxParam(param)
  return events.filter((e) => (p.all || p.ids.includes(e.id)) && e.enabled && e.weight > 0)
}

function percent(weight: number, total: number): string {
  if (total <= 0) return ''
  const v = (weight / total) * 100
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`
}

export default function SpecialBoxPool({
  value,
  onChange,
  compact = false,
  idp = 'special-box'
}: {
  value: string | undefined
  onChange: (param: string) => void
  /** 转盘/九宫格这类窄的地方：事件小一点、不显示说明 */
  compact?: boolean
  idp?: string
}) {
  const { events, loaded } = useSpecialBoxEvents()
  const p = parseSpecialBoxParam(value)
  const known = new Set(events.map((e) => e.id))
  const ids = p.all ? events.filter((e) => e.enabled).map((e) => e.id) : p.ids
  const missing = p.all ? [] : p.ids.filter((id) => !known.has(id))
  // 0.3.63 那版的盲盒（参数是旧盒子的 id）：照旧能开，勾选事件就换成新的奖池
  const legacy = loaded && !p.all && p.ids.length === 1 && missing.length === 1 && !p.ids[0].startsWith('sbe-')
  const usable = events.filter((e) => ids.includes(e.id) && e.enabled && e.weight > 0)
  const total = usable.reduce((sum, e) => sum + e.weight, 0)
  const emit = (patch: { ids?: string[]; name?: string }) =>
    onChange(joinSpecialBoxParam({ ids: patch.ids ?? (p.all ? ids : p.ids), all: false, name: patch.name ?? p.name }))
  const toggle = (id: string) => {
    const base = legacy ? [] : ids.filter((x) => known.has(x))
    emit({ ids: base.includes(id) ? base.filter((x) => x !== id) : [...base, id] })
  }
  const groups = useMemo(() => groupSpecialBoxEvents(events), [events])
  const idsKey = legacy ? '' : ids.join(',')
  const chosen = useMemo(() => new Set(idsKey ? idsKey.split(',') : []), [idsKey])
  // 组头点一下：这组全勾着就全取消，不然把这组全勾上
  const toggleGroup = (g: SpecialBoxGroup) => {
    const base = legacy ? [] : ids.filter((x) => known.has(x))
    const mine = g.events.map((e) => e.id)
    const all = mine.every((id) => base.includes(id))
    emit({ ids: all ? base.filter((id) => !mine.includes(id)) : [...base, ...mine.filter((id) => !base.includes(id))] })
  }
  // 展开哪些组：第一次拿到事件库时，只勾了一部分的组展开（全勾 / 全没勾的看组头上的数就够了）
  const [open, setOpen] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (open || !loaded || !events.length) return
    setOpen(new Set(groups.filter((g) => {
      const n = g.events.filter((e) => chosen.has(e.id)).length
      return n > 0 && n < g.events.length
    }).map((g) => g.id || 'other')))
  }, [open, loaded, events.length, groups, chosen])
  const flip = (gid: string) => setOpen((s) => {
    const next = new Set(s ?? [])
    if (next.has(gid)) next.delete(gid)
    else next.add(gid)
    return next
  })
  const allOpen = groups.length > 0 && groups.every((g) => open?.has(g.id || 'other'))

  return (
    <div className="space-y-2" data-testid="special-box-pool">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-[var(--text-3)]">抽奖事件 · 已选 {legacy ? 0 : ids.filter((id) => known.has(id)).length} 项 · 每份礼物随机抽一项</span>
        <div className="flex gap-1">
          <Btn size="sm" variant="ghost" disabled={!groups.length} onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.id || 'other')))}>{allOpen ? '全部收起' : '全部展开'}</Btn>
          <Btn size="sm" variant="ghost" disabled={!events.length} onClick={() => emit({ ids: events.map((e) => e.id) })}>全选</Btn>
          <Btn size="sm" variant="ghost" disabled={!ids.length} onClick={() => emit({ ids: [] })}>清空选择</Btn>
        </div>
      </div>
      {legacy && (
        <p className="rounded-md bg-[var(--warn-soft)] px-2 py-1.5 text-[11px] leading-4 text-[var(--warn)]">
          这是旧版盲盒「{p.name || p.ids[0]}」，照旧能开。在下面勾选事件，就换成自己选的奖池。
        </p>
      )}
      {loaded && events.length === 0 && <p className="text-xs text-[var(--text-4)]">盲盒事件库还是空的，先到「特色整蛊」页的盲盒事件库添加事件。</p>}
      <div className="flex flex-wrap items-start gap-1.5">
        {groups.map((g) => {
          const gid = g.id || 'other'
          const picked = g.events.filter((e) => chosen.has(e.id)).length
          const isOpen = !!open?.has(gid)
          const head = (
            <div className="flex shrink-0 items-center rounded-md border border-[var(--line)] bg-[var(--bg-elev)]">
              <button type="button" onClick={() => flip(gid)} aria-expanded={isOpen} aria-label={`${isOpen ? '收起' : '展开'} ${g.name}`} className="px-1 py-1 text-[var(--text-3)] hover:text-[var(--text)]">
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <button
                type="button"
                onClick={() => toggleGroup(g)}
                title={picked === g.events.length ? '这一组全不选' : '这一组全选'}
                aria-label={`${g.name}：${picked === g.events.length ? '全不选' : '全选'}`}
                className={`${compact ? 'text-[10px]' : 'text-[11px]'} whitespace-nowrap py-0.5 pr-2 text-left font-medium transition hover:text-[var(--text)] ${picked ? 'text-[var(--text-2)]' : 'text-[var(--text-4)]'}`}
              >
                {g.name}
                <span className={`tnum ml-1 font-normal ${picked === g.events.length ? 'text-[var(--accent-2)]' : 'text-[var(--text-4)]'}`}>{picked}/{g.events.length}</span>
              </button>
            </div>
          )
          if (!isOpen) return <div key={gid} data-pool-group={gid}>{head}</div>
          return (
            <div key={gid} className="flex basis-full flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-[var(--line)] p-1.5" data-pool-group={gid}>
              {head}
              {g.events.map((e) => {
                const selected = chosen.has(e.id)
                const live = selected && e.enabled && e.weight > 0
                return (
                  <Btn
                    key={e.id}
                    size="sm"
                    variant={selected ? 'secondary' : 'ghost'}
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={`抽奖事件 ${e.name}`}
                    title={e.name}
                    onClick={() => toggle(e.id)}
                    className={`${selected ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-2)]' : ''} ${compact ? '!px-2 !py-0.5 !text-[11px]' : '!px-2.5'}`}
                  >
                    {selected && <Check size={12} />}
                    {specialBoxEventLabel(e)}
                    {live && <span className="tnum text-[10px] text-[var(--text-3)]">{percent(e.weight, total)}</span>}
                    {!e.enabled && <span className="text-[10px] text-[var(--warn)]">已停用</span>}
                  </Btn>
                )
              })}
            </div>
          )
        })}
      </div>
      {!legacy && loaded && events.length > 0 && !ids.length && <div role="alert" className="text-xs text-[var(--danger)]">奖池是空的，勾选要抽的事件</div>}
      {!legacy && ids.length > 0 && !usable.length && <div role="alert" className="text-xs text-[var(--danger)]">勾选的事件都停用了，到盲盒事件库打开</div>}
      {!legacy && missing.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-[var(--warn)]">
          有 {missing.length} 个事件已经从事件库删掉了
          <Btn size="sm" variant="ghost" onClick={() => emit({ ids: p.ids.filter((id) => known.has(id)) })}>移除失效项</Btn>
        </div>
      )}
      <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
        盲盒名字
        <Input
          id={`${idp}-name`}
          aria-label="盲盒名字"
          value={p.name}
          placeholder={SPECIAL_BOX_DEFAULT_NAME}
          onChange={(e) => emit({ name: e.target.value })}
          className={compact ? 'h-7 w-32 text-xs' : 'w-40'}
        />
        {!compact && <Pill tone="muted">开出时画面上显示「某某的{p.name || SPECIAL_BOX_DEFAULT_NAME}开出：…」</Pill>}
      </label>
    </div>
  )
}
