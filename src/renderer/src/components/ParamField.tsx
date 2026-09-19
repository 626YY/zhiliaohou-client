import { useState, useEffect } from 'react'
import { X, ChevronDown } from 'lucide-react'
import type { CustomBox, ParamField as ParamFieldDef } from '@shared/types'
import { prankGroups, usePrankCatalog } from '../lib/pranks'
import { useGameAuth } from '../lib/useGameAuth'
import { Btn, Input, Select, Toggle } from './ui'

interface ParamFieldProps {
  field: ParamFieldDef
  value: unknown
  onChange: (value: unknown) => void
  boxes?: CustomBox[]
}

export function ParamField({ field, value, onChange, boxes }: ParamFieldProps) {
  const controlId = `pf-${field.key}`

  // 开关型：label+描述在左、开关固定在右，单行紧凑，不再出现标题被描述挤换行
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-4 py-3">
        <div className="min-w-0">
          <label htmlFor={controlId} className="block text-sm font-medium text-[var(--text)]">
            {field.label}
          </label>
          {field.desc && (
            <div className="mt-0.5 text-xs leading-5 text-[var(--text-3)]">{field.desc}</div>
          )}
        </div>
        <span id={controlId} className="shrink-0">
          <Toggle value={!!value} onChange={onChange} />
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-4 py-3">
      <label htmlFor={controlId} className="block text-sm font-medium text-[var(--text)]">
        {field.label}
      </label>
      {field.desc && (
        <div className="mt-0.5 text-xs leading-5 text-[var(--text-3)]">{field.desc}</div>
      )}
      <div className="mt-2">
        <Control field={field} value={value} onChange={onChange} boxes={boxes} controlId={controlId} />
      </div>
    </div>
  )
}

function Control({ field, value, onChange, boxes, controlId }: ParamFieldProps & { controlId: string }) {
  if (field.prankPicker) {
    return <PrankPoolPicker value={value} onChange={onChange} controlId={controlId} />
  }
  switch (field.type) {
    case 'boolean':
      return (
        <span id={controlId}>
          <Toggle value={!!value} onChange={onChange} />
        </span>
      )
    case 'select': {
      const isEnum = (field.options?.length ?? 0) > 0
      const opts = field.boxPicker
        ? [
            { value: '', label: '纯机选大盲盒' },
            ...(boxes ?? []).map((b) => ({ value: b.Id, label: b.Name }))
          ]
        : (field.options ?? [])
      return (
        <Select
          id={controlId}
          value={String(value ?? '')}
          onChange={(e) => onChange(isEnum ? Number(e.target.value) : e.target.value)}
        >
          {opts.map((o) => (
            <option key={String(o.value)} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )
    }
    case 'list':
      return <ListEditor field={field} value={value} onChange={onChange} controlId={controlId} />
    case 'number':
      return <NumberControl field={field} value={value} onChange={onChange} controlId={controlId} />
    default:
      return (
        <Input
          id={controlId}
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )
  }
}

// 数字框用文本草稿：<input type=number> 敲「-」时浏览器给的 value 是空串，Number('')=0 立刻写回 0，负数（重力 Y 这类）永远打不进去；
// 草稿合法（能 Number 且有限）才往上抛，失焦再把草稿格式化成当前值
function NumberBox({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(Number.isFinite(value) ? value : ''))
  useEffect(() => {
    // 外部改了值（切游戏/云端恢复/滑块）才同步草稿；用户打到一半的「-」「3.」不动
    if (draft === '' || draft === '-' || draft === '.' || draft === '-.') return
    if (Number(draft) !== value) setDraft(String(Number.isFinite(value) ? value : ''))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        const s = e.target.value.trim()
        setDraft(s)
        if (s === '' || s === '-' || s === '.' || s === '-.') return
        const n = Number(s)
        if (Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => setDraft(String(Number.isFinite(value) ? value : ''))}
      className="tnum w-24 px-2 py-1.5"
    />
  )
}

function NumberControl({
  field,
  value,
  onChange,
  controlId
}: ParamFieldProps & { controlId: string }) {
  const hasRange =
    typeof field.min === 'number' && typeof field.max === 'number'
  const num = typeof value === 'number' ? value : Number(value ?? 0)
  return (
    <div className="flex items-center gap-3">
      {hasRange && (
        <input
          type="range"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={num}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={field.label}
          className="flex-1 accent-[var(--accent)]"
        />
      )}
      <NumberBox id={controlId} value={num} onChange={onChange} />
    </div>
  )
}

function ListEditor({
  field,
  value,
  onChange,
  controlId
}: ParamFieldProps & { controlId: string }) {
  const [draft, setDraft] = useState('')
  const list = Array.isArray(value) ? (value as string[]) : []
  const add = () => {
    const v = draft.trim()
    if (!v) return
    onChange([...list, v])
    setDraft('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && (
          <span className="text-xs text-[var(--text-3)]">（空，添加一项开始）</span>
        )}
        {list.map((item, i) => (
          <span
            key={`${i}-${item}`}
            className="group inline-flex items-center gap-1 rounded bg-[var(--bg-card)] px-2 py-0.5 text-xs text-[var(--text-2)]"
          >
            {item}
            <button
              type="button"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
              aria-label={`删除 ${item}`}
              className="text-[var(--text-4)] transition hover:text-[var(--danger)]"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          id={controlId}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={field.desc ?? '输入内容后回车添加'}
          spellCheck={false}
          className="flex-1"
        />
        <Btn size="sm" onClick={add} className="px-3">
          添加
        </Btn>
      </div>
    </div>
  )
}

// 整蛊勾选面板，绑定 mod 的 BoxExclude（排除名单）：勾上=在盲盒池=从名单移除，取消=进名单。
// 永不进池的项（RandomPrankId 硬跳过）：毁局类 / 整对手专属 / 送武器给对手 / 救场工具。
function PrankPoolPicker({
  value,
  onChange,
  controlId
}: {
  value: unknown
  onChange: (value: unknown) => void
  controlId: string
}) {
  const { gameId } = useGameAuth()
  usePrankCatalog() // 定义包刷新时重渲染
  const groups = prankGroups(gameId)
  const [open, setOpen] = useState(false)
  const exclude = Array.isArray(value) ? (value as string[]) : []
  const NEVER_IN_BOX = new Set(
    gameId === 'librarian'
      ? ['nuke']
      : [
          'lv_restart', 'lv_first', 'lv_menu',
          'sys_unstuck',
          'w_give_rpg', 'w_give_bomb',
          'v_blast', 'v_spin', 'v_tip', 'v_launch', 'v_scatter', 'v_shake', 'v_kill', 'c_randversus'
        ]
  )

  let inN = 0
  let exN = 0
  for (const g of groups)
    for (const p of g.items) {
      if (NEVER_IN_BOX.has(p.id)) continue
      if (exclude.includes(p.id)) exN++
      else inN++
    }

  const toggle = (id: string) => {
    const inPool = !exclude.includes(id)
    onChange(inPool ? exclude.filter((x) => x !== id) : [...exclude, id])
  }

  return (
    <div>
      <button
        id={controlId}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg border border-[var(--line-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-2)] transition hover:border-[var(--text-4)] hover:bg-[var(--bg-elev)]"
      >
        <span>
          勾选盲盒能抽到的整蛊
          <span className="tnum ml-2 text-xs text-[var(--text-3)]">
            在池 {inN} · 已排除 {exN}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="zl-scroll mt-2 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--bg-card)] p-3">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="mb-1 text-xs font-semibold text-[var(--text)]">
                {group.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((p) => {
                  const never = NEVER_IN_BOX.has(p.id)
                  if (never) {
                    return (
                      <span
                        key={p.id}
                        title="这类整蛊不会进点赞/关注/灯牌盲盒"
                        className="cursor-default rounded-md border border-dashed border-[var(--line-strong)] px-2 py-1 text-xs text-[var(--text-4)]"
                      >
                        {p.name}（不进盲盒）
                      </span>
                    )
                  }
                  const on = !exclude.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(p.id)}
                      className={`rounded-md px-2 py-1 text-xs transition ${
                        on
                          ? 'bg-[var(--accent-soft-2)] text-[var(--accent-2)]'
                          : 'bg-[var(--bg-elev)] text-[var(--text-3)] hover:text-[var(--text)]'
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
