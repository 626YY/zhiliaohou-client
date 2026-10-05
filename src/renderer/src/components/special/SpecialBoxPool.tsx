// 特色整蛊盲盒的奖池：从「盲盒事件库」里勾选这份礼物抽哪些事件（照时间插件的「抽奖事件」）。
// 值就是动作命令 special-box 的参数：事件id,事件id,…|显示名。礼物联动、礼物触发、基础引导、转盘九宫格共用这一份。
import { Check } from 'lucide-react'
import { Btn, Input, Pill } from '../ui'
import { useSpecialBoxEvents } from '../../lib/useSpecialBoxEvents'
import { SPECIAL_BOX_DEFAULT_NAME, joinSpecialBoxParam, parseSpecialBoxParam, type SpecialBoxEvent } from '@shared/specialGames'

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

  return (
    <div className="space-y-2" data-testid="special-box-pool">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-[var(--text-3)]">抽奖事件 · 已选 {legacy ? 0 : ids.filter((id) => known.has(id)).length} 项 · 每份礼物随机抽一项</span>
        <div className="flex gap-1">
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
      <div className="flex flex-wrap gap-1.5">
        {events.map((e) => {
          const selected = !legacy && ids.includes(e.id)
          const live = selected && e.enabled && e.weight > 0
          return (
            <Btn
              key={e.id}
              size="sm"
              variant={selected ? 'secondary' : 'ghost'}
              role="checkbox"
              aria-checked={selected}
              aria-label={`抽奖事件 ${e.name}`}
              onClick={() => toggle(e.id)}
              className={`${selected ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-2)]' : ''} ${compact ? '!px-2 !py-0.5 !text-[11px]' : ''}`}
            >
              {selected && <Check size={12} />}
              {e.name}
              {live && <span className="tnum text-[10px] text-[var(--text-3)]">{percent(e.weight, total)}</span>}
              {!e.enabled && <span className="text-[10px] text-[var(--warn)]">已停用</span>}
            </Btn>
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
