// 抽奖流水：什么时候、谁送的礼物、抽中了什么。转盘和九宫格各看各的。
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { LotteryDraw, LotteryEvent } from '@shared/types'
import { Btn, Loading } from './ui'
import { useToast } from '../stores/ui'

const SOURCE_LABEL: Record<LotteryDraw['source'], string> = {
  gift: '礼物触发',
  manual: '手动开',
  chain: '连抽'
}

function stamp(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function LotteryHistory({ kind, event }: { kind: 'wheel' | 'nine'; event?: LotteryEvent }) {
  const toast = useToast((s) => s.toast)
  const [rows, setRows] = useState<LotteryDraw[] | null>(null)

  const load = useCallback(async () => {
    const list = await window.api.lotteryHistory(200)
    setRows(Array.isArray(list) ? list.filter((row) => row.kind === kind) : [])
  }, [kind])

  useEffect(() => { void load() }, [load])
  // 每抽完一次自动刷新，不用手点
  useEffect(() => { if (event?.phase === 'result') void load() }, [event?.id, event?.phase, load])

  const clear = async () => {
    const res = await window.api.lotteryHistoryClear()
    if (!res.ok) return toast(res.error || '清空失败', 'error')
    toast('抽奖记录已清空', 'success')
    void load()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text)]">抽奖记录</div>
          <div className="mt-0.5 text-xs text-[var(--text-4)]">
            {rows === null ? '读取中…' : rows.length ? `最近 ${rows.length} 次，留最新 800 条` : '还没有抽过'}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Btn variant="secondary" onClick={() => void load()} title="刷新"><RefreshCw size={14} /></Btn>
          <Btn variant="ghost" onClick={() => void clear()} title="清空记录"><Trash2 size={14} /></Btn>
        </div>
      </div>
      {rows === null ? <Loading className="py-8" /> : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--text-4)]">抽一次就有记录了。</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--line)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--bg-card)] text-[var(--text-3)]">
              <tr>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">抽中</th>
                <th className="px-3 py-2 font-medium">来源</th>
                <th className="px-3 py-2 font-medium">观众 / 礼物</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id + row.at} className="border-t border-[var(--line)] text-[var(--text-2)]">
                  <td className="tnum whitespace-nowrap px-3 py-2 text-[var(--text-3)]">{stamp(row.at)}</td>
                  <td className="px-3 py-2 font-medium text-[var(--text)]">{row.prize || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{SOURCE_LABEL[row.source] || row.source}</td>
                  <td className="px-3 py-2">
                    {row.user || row.gift ? `${row.user || '—'}${row.gift ? ` · ${row.gift}` : ''}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
