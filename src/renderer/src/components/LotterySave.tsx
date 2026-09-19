// 抽奖页（转盘 / 九宫格）的保存反馈。
// 页面改动是自动保存的，但主播看不到「到底存上了没有」，所以这里挂一个一直显示的状态灯 +
// 一个手动「保存」按钮：改完立刻看到「已保存 12:34:56」，失败了直接看到原因。
import { useCallback, useRef, useState } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { Btn } from './ui'

export type SaveState = { phase: 'idle' | 'saving' | 'saved' | 'error'; at?: number; error?: string }

/** 把一个「保存」动作包成带状态的东西；连点只会留下最后一次的结果。 */
export function useLotterySave(save: () => Promise<{ ok: boolean; error?: string }>): {
  state: SaveState
  run: () => Promise<{ ok: boolean; error?: string }>
} {
  const latest = useRef(save)
  latest.current = save
  const [state, setState] = useState<SaveState>({ phase: 'idle' })
  const run = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setState((prev) => ({ ...prev, phase: 'saving' }))
    let result: { ok: boolean; error?: string }
    try {
      result = await latest.current()
    } catch (error) {
      result = { ok: false, error: (error as Error).message }
    }
    setState(result.ok ? { phase: 'saved', at: Date.now() } : { phase: 'error', error: result.error || '保存失败', at: Date.now() })
    return result
  }, [])
  return { state, run }
}

function clock(at?: number): string {
  const date = new Date(at || Date.now())
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export default function LotterySave({ state, onSave, note = '改完自动保存' }: {
  state: SaveState
  onSave: () => void
  note?: string
}) {
  const text = state.phase === 'saving'
    ? '保存中…'
    : state.phase === 'saved'
      ? `已保存 ${clock(state.at)}`
      : state.phase === 'error'
        ? `保存失败：${state.error || '未知原因'}`
        : note
  const tone = state.phase === 'error' ? 'text-[var(--danger)]' : state.phase === 'saved' ? 'text-[var(--ok)]' : 'text-[var(--text-4)]'
  return (
    <div className="flex items-center gap-2">
      <span role="status" aria-live="polite" data-testid="lottery-save-state" className={`flex items-center gap-1 text-xs ${tone}`}>
        {state.phase === 'saving' ? <Loader2 size={12} className="animate-spin" /> : null}
        {state.phase === 'saved' ? <Check size={12} /> : null}
        {state.phase === 'error' ? <TriangleAlert size={12} /> : null}
        {text}
      </span>
      <Btn size="sm" variant="secondary" onClick={onSave} title="立即保存当前设置">保存</Btn>
    </div>
  )
}
