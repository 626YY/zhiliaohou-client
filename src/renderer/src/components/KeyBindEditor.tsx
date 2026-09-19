import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw } from 'lucide-react'
import type { NativeKeybinds, PrankDef } from '@shared/types'
import { Btn, Kbd } from './ui'

interface KeyBindEditorProps {
  binds: Record<string, string>
  menuKey: string
  leaderboardKey: string
  pranks: PrankDef[]
  defaults?: NativeKeybinds
  onChange: (field: string, value: unknown) => void
  onReset?: () => void
  // 「主菜单开关 / 大榜单」是轮椅 mod 的系统键；DON'T SCREAM、图书管理员没有这两项，
  // 由参数页按 schema 是否声明 MenuKey/LeaderboardKey 决定显不显示。
  showSystemKeys?: boolean
}

// DOM event.code -> Unity KeyCode 名（mod 的 Binds 存的是后者）
function mapKey(code: string): string | null {
  const m: Record<string, string> = {}
  for (let i = 0; i <= 9; i++) m[`Digit${i}`] = `Alpha${i}`
  for (let i = 0; i <= 9; i++) m[`Numpad${i}`] = `Keypad${i}`
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = String.fromCharCode(65 + i)
  for (let i = 1; i <= 12; i++) m[`F${i}`] = `F${i}`
  m['Escape'] = 'Escape'
  return m[code] ?? null
}

function buildCombo(e: KeyboardEvent): string | null {
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null
  const key = mapKey(e.code)
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.shiftKey) mods.push('Shift')
  if (e.altKey) mods.push('Alt')
  return [...mods, key].join('+')
}

// mod 菜单同款紧凑键名：Alpha1→1、Keypad3→小3、C+/S+/A+
export function keyLabel(combo: string): string {
  if (!combo) return '未绑定'
  let mods = ''
  let main = ''
  for (const p of combo.split('+')) {
    if (p === 'Ctrl') mods += 'C+'
    else if (p === 'Shift') mods += 'S+'
    else if (p === 'Alt') mods += 'A+'
    else main = p
  }
  if (!main) return mods || '—'
  if (main.startsWith('Alpha')) main = main.slice(5)
  else if (main.startsWith('Keypad')) main = '小' + main.slice(6)
  else if (main === 'BackQuote') main = '`'
  else if (main === 'Minus') main = '-'
  else if (main === 'Space') main = '空格'
  else if (main === 'Return' || main === 'Enter') main = '回车'
  return mods + main
}

export function KeyBindEditor({
  binds,
  menuKey,
  leaderboardKey,
  pranks,
  defaults,
  onChange,
  onReset,
  showSystemKeys
}: KeyBindEditorProps) {
  const [capture, setCapture] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!capture) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCapture(null)
        setPending(null)
        return
      }
      const combo = buildCombo(e)
      if (combo) {
        e.preventDefault()
        setPending(combo)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [capture])

  const startCapture = (key: string) => {
    setCapture(key)
    setPending(null)
  }
  const cancelCapture = () => {
    setCapture(null)
    setPending(null)
  }
  const confirmBind = () => {
    if (!capture || !pending) return
    if (capture === 'MenuKey' || capture === 'LeaderboardKey') {
      onChange(capture, pending)
    } else {
      onChange('Binds', { ...binds, [capture]: pending })
    }
    setCapture(null)
    setPending(null)
  }

  const sysKeys = [
    { key: 'MenuKey', label: '主菜单开关', hint: '打开 / 收起 mod 主菜单', value: menuKey || defaults?.menu || '' },
    { key: 'LeaderboardKey', label: '大榜单', hint: '弹出 / 收起「大榜单」', value: leaderboardKey || defaults?.leaderboard || '' }
  ]

  const cats: { cat: string; items: PrankDef[] }[] = []
  for (const c of Array.from(new Set(pranks.map((p) => p.cat)))) {
    cats.push({ cat: c, items: pranks.filter((p) => p.cat === c) })
  }

  const renderRow = (rowKey: string, label: string, hint: string | undefined, value: string) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[var(--text)]">{label}</div>
        {hint && <div className="truncate text-xs text-[var(--text-3)]">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {capture === rowKey ? (
          pending ? (
            <>
              <span className="rounded bg-[var(--accent-soft-2)] px-2.5 py-1 text-sm font-semibold text-[var(--accent-2)]">
                {keyLabel(pending)}
              </span>
              <Btn size="sm" onClick={confirmBind}>
                确定
              </Btn>
              <Btn size="sm" variant="secondary" onClick={cancelCapture}>
                取消
              </Btn>
            </>
          ) : (
            <span className="animate-pulse text-sm text-[var(--accent-2)]">请按下按键…</span>
          )
        ) : (
          <>
            <span className="flex w-16 justify-end">
              <Kbd>{keyLabel(value)}</Kbd>
            </span>
            <Btn size="sm" variant="secondary" onClick={() => startCapture(rowKey)}>
              更换
            </Btn>
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-[var(--text-3)]">
          <Keyboard size={14} className="text-[var(--accent-2)]" />
          点「更换」后按下想用的按键组合（可带 Ctrl / Shift / Alt），再点确定生效；Esc 或取消放弃。
        </div>
        {onReset && (
          <Btn
            size="sm"
            variant="secondary"
            onClick={onReset}
            title="把全部快捷键恢复成 mod 原生默认键位"
          >
            <RotateCcw size={12} /> 恢复默认键位
          </Btn>
        )}
      </div>

      {showSystemKeys !== false && (
        <div className="space-y-2">
          {sysKeys.map((s) => (
            <div key={s.key}>{renderRow(s.key, s.label, s.hint, s.value)}</div>
          ))}
        </div>
      )}

      {cats.map(({ cat, items }) => (
        <div key={cat}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-4)]">
            {cat}
          </h4>
          <div className="space-y-1.5">
            {items.map((p) => (
              <div key={p.id}>
                {renderRow(
                  p.id,
                  p.name,
                  undefined,
                  binds[p.id] ?? defaults?.binds[p.id] ?? ''
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
