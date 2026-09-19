import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { createContext, forwardRef, useContext, useId } from 'react'
import { Loader2 } from 'lucide-react'
import {useConfigurationLevel} from '../lib/configurationLevel'

/* ================= 按钮 ================= */

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type BtnSize = 'sm' | 'md' | 'lg'

const btnBase =
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-45'

const btnVariants: Record<BtnVariant, string> = {
  // 主按钮：品牌橙渐变 + 发光 + 按压反馈
  primary:
    'bg-gradient-to-r from-[var(--accent-2)] to-[var(--accent)] font-semibold text-[var(--on-accent)] shadow-[0_2px_6px_var(--accent-glow)] hover:brightness-110 hover:shadow-[0_6px_22px_var(--accent-glow)] active:scale-[0.98] active:brightness-95',
  // 次按钮：描边，hover 抬升底色
  secondary:
    'border border-[var(--line-strong)] text-[var(--text-2)] hover:border-[var(--text-4)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)] active:scale-[0.98]',
  // 危险：红描边，hover 淡红底
  danger:
    'border border-[var(--danger-line)] text-[var(--danger)] hover:bg-[var(--danger-soft)] active:scale-[0.98]',
  // 幽灵：无边框，hover 淡底
  ghost: 'text-[var(--text-3)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)] active:scale-[0.98]'
}

const btnSizes: Record<BtnSize, string> = {
  sm: 'rounded-md px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-sm',
  lg: 'px-5 py-2.5 text-sm'
}

export function Btn({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return (
    <button
      {...props}
      className={`${btnBase} ${btnVariants[variant]} ${btnSizes[size]} ${className || ''}`}
    />
  )
}

/* ================= 输入控件 ================= */
const FieldContext=createContext<{labelId:string;hintId?:string}|null>(null)

export const inputCls =
  'w-full min-w-0 rounded-lg border border-[var(--line-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-4)] hover:border-[var(--text-4)] focus:border-[var(--accent)]'

// 调用方传了宽度类(w-xx)时去掉默认 w-full——Tailwind 里 w-full 的生成顺序在数字宽度之后，
// 否则「w-full w-36」永远是 w-full 赢，礼物行等横排布局会被撑成全宽竖排。
const mergeInputCls = (className?: string) =>
  `${/(^|\s)w-/.test(className || '') ? inputCls.replace('w-full ', '') : inputCls} ${className || ''}`

// forwardRef：礼物规则列表要按回车把焦点移到下一行的输入框（React 18 的函数组件不能直接收 ref）
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    const field=useContext(FieldContext)
    return <input ref={ref} {...props}
      aria-labelledby={props['aria-labelledby']||(!props['aria-label']?field?.labelId:undefined)}
      aria-describedby={[props['aria-describedby'],field?.hintId].filter(Boolean).join(' ')||undefined}
      className={mergeInputCls(className)} />
  }
)

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const field=useContext(FieldContext)
  return (
    <select {...props} aria-labelledby={props['aria-labelledby']||(!props['aria-label']?field?.labelId:undefined)}
      aria-describedby={[props['aria-describedby'],field?.hintId].filter(Boolean).join(' ')||undefined}
      className={`${mergeInputCls(className)} cursor-pointer`}>
      {children}
    </select>
  )
}

/* 表单字段：标签 + 控件 + 可选说明 */
export function Field({
  label,
  hint,
  children,
  className,
  advanced = false
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  advanced?: boolean
}) {
  const id=useId()
  const {level}=useConfigurationLevel()
  const labelId=id+'-label',hintId=hint?id+'-hint':undefined
  return (
    <FieldContext.Provider value={{labelId,hintId}}><div className={`min-w-0 ${className || ''}`} role="group" aria-labelledby={labelId} data-advanced-field={advanced||undefined} style={advanced&&level==='basic'?{display:'none'}:undefined}>
      <div id={labelId} className="mb-1.5 text-xs font-medium text-[var(--text-3)]">{label}</div>
      {children}
      {hint && <div id={hintId} className="mt-1 text-[11px] leading-4 text-[var(--text-4)]">{hint}</div>}
    </div></FieldContext.Provider>
  )
}

/* ================= 开关 ================= */

export function Toggle({
  value,
  onChange,
  disabled,
  label
}: {
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  const field=useContext(FieldContext)
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-labelledby={!label?field?.labelId:undefined}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className="relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40"
      style={{ background: value ? 'var(--accent)' : 'var(--line-strong)' }}
    >
      <span
        className="absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: value ? 'translateX(18px)' : 'translateX(0)' }}
      />
    </button>
  )
}

/* ================= 状态徽标 ================= */

type PillTone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'accent'

const pillTones: Record<PillTone, string> = {
  ok: 'bg-[var(--ok-soft)] text-[var(--ok)]',
  warn: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
  muted: 'bg-[var(--bg-elev)] text-[var(--text-3)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-2)]'
}

const dotTones: Record<PillTone, string> = {
  ok: 'bg-[var(--ok)]',
  warn: 'bg-[var(--warn)]',
  danger: 'bg-[var(--danger)]',
  info: 'bg-[var(--info)]',
  muted: 'bg-[var(--text-4)]',
  accent: 'bg-[var(--accent)]'
}

export function Pill({
  tone = 'muted',
  pulse,
  dot,
  children,
  className
}: {
  tone?: PillTone
  /** 圆点呼吸动画（连接中/审批中等进行态） */
  pulse?: boolean
  /** 是否显示状态圆点 */
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${pillTones[tone]} ${className || ''}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotTones[tone]} ${pulse ? 'animate-pulse' : ''}`} />}
      {children}
    </span>
  )
}

/* 小标签（分类/版本号等） */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-2)] ${className || ''}`}
    >
      {children}
    </span>
  )
}

/* ================= 页面骨架 ================= */

export function PageHeader({
  icon,
  title,
  desc,
  actions
}: {
  icon?: ReactNode
  title: ReactNode
  desc?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tight text-[var(--text)]">
          {icon}
          {title}
        </h2>
        {desc && <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">{desc}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* 标准卡片 */
export function Card({
  title,
  actions,
  children,
  className,
  pad = true
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <div className={`zl-card ${className || ''}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
          {actions}
        </div>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </div>
  )
}

/* 空态：虚框 + 图标 + 说明 + 可选操作 */
export function EmptyState({
  icon,
  title,
  desc,
  action,
  compact
}: {
  icon?: ReactNode
  title: ReactNode
  desc?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] text-center ${
        compact ? 'gap-1.5 p-6' : 'gap-2 p-12'
      }`}
    >
      {icon && <div className="mb-1 text-[var(--text-4)]">{icon}</div>}
      <div className="text-sm font-medium text-[var(--text-3)]">{title}</div>
      {desc && <div className="max-w-sm text-xs leading-5 text-[var(--text-4)]">{desc}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* 加载占位 */
export function Loading({ text = '加载中…', className }: { text?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-3)] ${className || ''}`}>
      <Loader2 size={15} className="animate-spin text-[var(--accent)]" />
      {text}
    </div>
  )
}

/* ================= 分段切换（胶囊页签） ================= */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md'
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`whitespace-nowrap rounded-md font-medium transition ${
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
          } ${
            value === o.value
              ? 'bg-[var(--accent-soft)] text-[var(--accent-2)]'
              : 'text-[var(--text-3)] hover:text-[var(--text)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ================= 下拉浮层（遮罩点击关闭） ================= */

export function PopLayer({
  open,
  onClose,
  children,
  className
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        className={`zl-pop absolute z-20 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-card)] ${className || ''}`}
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        {children}
      </div>
    </>
  )
}

/* 快捷键提示 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 font-sans text-[10px] text-[var(--text-3)]">
      {children}
    </kbd>
  )
}
