// 「特色整蛊」动作的参数编辑：选玩法 → 选操作 → 填数量 → 选大小/种类。
// 礼物规则的动作编辑、转盘/九宫格/时间盲盒的中奖动作、特色整蛊页的「礼物联动」、基础引导共用这一份，
// 参数格式（玩法|操作|数量|选项）只在 shared/specialGames.ts 里拆合。
// simple：基础模式用——只露数量，操作和大小/种类收进「更多选项」（展开即可改，已选的不会丢）。
import { Field, Input, Segmented, Select } from './ui'
import AdvancedSection from './AdvancedSection'
import {
  SPECIAL_GAMES,
  SPECIAL_GAME_MAP,
  joinSpecialParam,
  parseSpecialParam,
  specialActionText,
  specialDefaultParam,
  type SpecialGameId
} from '@shared/specialGames'

// 数量：固定一个数，或者一个随机范围（每次触发在范围里随机，比如 5~15）。参数里就是「5」或「5~15」。
const RANGE = /^(\d+)\s*[~～,，-]\s*(\d+)$/
export function CountInput({ value, def, range, onChange, idp }: { value: string; def: number; range?: string; onChange: (v: string) => void; idp: string }) {
  const m = RANGE.exec(value.trim())
  const digits = (v: string) => v.replace(/\D/g, '')
  return (
    <div className="space-y-1.5">
      <Segmented
        size="sm"
        value={m ? 'range' : 'fixed'}
        onChange={(mode) => {
          if (mode === 'range' && !m) {
            const n = Math.max(1, Number(value) || def)
            onChange(range && !value.trim() ? range : `${Math.max(1, Math.round(n * 0.6))}~${Math.max(n + 1, Math.round(n * 2))}`)
          } else if (mode === 'fixed' && m) onChange(String(Math.max(1, Math.round((Number(m[1]) + Number(m[2])) / 2))))
        }}
        options={[{ value: 'fixed', label: '固定数量' }, { value: 'range', label: '随机范围' }]}
      />
      {m ? (
        <div className="flex items-center gap-1.5">
          <Input id={`${idp}-count`} aria-label="特色整蛊数量最少" className="w-20" inputMode="numeric" value={m[1]} onChange={(e) => onChange(`${digits(e.target.value)}~${m[2]}`)} />
          <span className="text-xs text-[var(--text-4)]">到</span>
          <Input aria-label="特色整蛊数量最多" className="w-20" inputMode="numeric" value={m[2]} onChange={(e) => onChange(`${m[1]}~${digits(e.target.value)}`)} />
        </div>
      ) : (
        <Input id={`${idp}-count`} aria-label="特色整蛊数量" inputMode="numeric" value={value} placeholder={String(def)} onChange={(e) => onChange(digits(e.target.value))} />
      )}
    </div>
  )
}

export default function SpecialActionFields({
  value,
  onChange,
  fixedId,
  idp = 'special',
  simple = false
}: {
  /** 动作参数串（玩法|操作|数量|选项） */
  value: string | undefined
  onChange: (param: string) => void
  /** 固定玩法（特色整蛊页里绑定时、基础引导里已在卡片上选过时不让换玩法） */
  fixedId?: SpecialGameId
  /** 控件 id 前缀：同一个弹窗里可能有好几个 */
  idp?: string
  simple?: boolean
}): React.JSX.Element {
  const parsed = parseSpecialParam(value)
  const id = (fixedId || parsed.id || SPECIAL_GAMES[0].id) as SpecialGameId
  const meta = SPECIAL_GAME_MAP[id]
  const op = meta.ops.find((o) => o.value === parsed.op) ?? meta.ops[0]
  const current = { id, op: op.value, count: parsed.count, fields: parsed.fields }
  const emit = (patch: Partial<typeof current>) => onChange(joinSpecialParam({ ...current, ...patch }))
  const needsCount = op.count !== false
  const showFields = (meta.fields ?? []).length > 0 && op.value !== 'clear' && op.value !== 'reset'

  const opField = (
    <Field label="操作" hint={op.hint}>
      <Select aria-label="特色整蛊操作" value={op.value} onChange={(e) => emit({ op: e.target.value })}>
        {meta.ops.map((o) => (
          <option key={o.value} value={o.value}>{o.sign && o.sign !== '+' ? `${o.label}（${o.sign}）` : o.label}</option>
        ))}
      </Select>
    </Field>
  )
  const countField = needsCount ? (
    <Field label={`${op.countLabel || '数量'}${op.countLabel === '倍数' ? '' : `（${meta.unit}）`}`} hint="随机范围：每次触发在里面随机挑一个数">
      <CountInput value={parsed.count} def={meta.countDef} range={op.countLabel === '倍数' ? undefined : meta.countRange} onChange={(count) => emit({ count })} idp={idp} />
    </Field>
  ) : null
  const fieldsGrid = showFields ? (
    <div className="grid grid-cols-2 gap-2">
      {(meta.fields ?? []).map((f) => (
        <Field key={f.key} label={f.label}>
          <Select
            aria-label={`特色整蛊${f.label}`}
            value={parsed.fields[f.key] || f.def}
            onChange={(e) => emit({ fields: { ...parsed.fields, [f.key]: e.target.value } })}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      ))}
    </div>
  ) : null
  const summary = (
    <p className="text-[11px] leading-4 text-[var(--text-4)]">
      效果：{specialActionText(joinSpecialParam(current))}。玩法窗口没开会自动打开（可在特色整蛊里关掉）。
    </p>
  )

  return (
    <div className="space-y-3">
      {!fixedId && (
        <Field label="玩法">
          <Select
            aria-label="特色整蛊玩法"
            value={id}
            onChange={(e) => {
              const next = SPECIAL_GAME_MAP[e.target.value]
              // 换玩法：操作和选项各玩法不一样，回到新玩法的默认值；数量用它的常用值
              onChange(specialDefaultParam(next.id))
            }}
          >
            {SPECIAL_GAMES.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </Field>
      )}
      {simple ? (
        <>
          {countField}
          <AdvancedSection title="操作和选项">
            <div className="space-y-3">
              {opField}
              {fieldsGrid}
            </div>
          </AdvancedSection>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {opField}
            {countField ?? <div />}
          </div>
          {fieldsGrid}
        </>
      )}
      {summary}
    </div>
  )
}
