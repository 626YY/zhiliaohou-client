import { useEffect, useState } from 'react'
import { Stethoscope, RefreshCw, CheckCircle2, AlertTriangle, XCircle, FolderOpen } from 'lucide-react'
import type { SelfCheckItem, SelfCheckResult } from '@shared/types'
import { Btn, Pill } from './ui'

const ICON: Record<SelfCheckItem['level'], { icon: typeof CheckCircle2; cls: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-[var(--ok)]' },
  warn: { icon: AlertTriangle, cls: 'text-[var(--warn)]' },
  error: { icon: XCircle, cls: 'text-[var(--danger)]' }
}

// 环境自检：进设置页自动跑一遍，红黄绿灯 + 每项怎么修
export default function SelfCheckCard() {
  const [result, setResult] = useState<SelfCheckResult | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      setResult(await window.api.selfCheck())
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void run()
  }, [])

  const errors = result?.items.filter((i) => i.level === 'error').length ?? 0
  const warns = result?.items.filter((i) => i.level === 'warn').length ?? 0

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Stethoscope size={16} className="text-[var(--accent-2)]" /> 环境自检
          {result && (
            errors ? <Pill tone="danger" dot>{errors} 项要处理</Pill>
              : warns ? <Pill tone="warn" dot>{warns} 项提醒</Pill>
                : <Pill tone="ok" dot>全部正常</Pill>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="secondary" onClick={() => void window.api.openLogs()} title="客户端运行日志，出问题时把这里的 main.log 发给我们">
            <FolderOpen size={13} /> 打开日志目录
          </Btn>
          <Btn size="sm" variant="secondary" onClick={run} disabled={busy}>
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? '检查中…' : '重新检查'}
          </Btn>
        </div>
      </div>
      {!result ? (
        <div className="text-xs text-[var(--text-4)]">正在检查 python、连接器、游戏、mod、服务器、OBS / 直播伴侣、权限、磁盘…</div>
      ) : (
        <div className="space-y-1.5">
          {result.items.map((it) => {
            const Icon = ICON[it.level].icon
            return (
              <div key={it.id} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${it.level === 'error' ? 'bg-[var(--danger-soft)]' : it.level === 'warn' ? 'bg-[var(--warn-soft)]' : 'bg-[var(--bg-elev)]'}`}>
                <Icon size={15} className={`mt-0.5 shrink-0 ${ICON[it.level].cls}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-[var(--text)]">{it.label}</span>
                    <span className="min-w-0 break-all text-[var(--text-3)]">{it.detail}</span>
                  </div>
                  {it.hint && it.level !== 'ok' && <div className="mt-0.5 text-[11px] leading-4 text-[var(--text-2)]">怎么办：{it.hint}</div>}
                  {it.hint && it.level === 'ok' && <div className="mt-0.5 text-[11px] leading-4 text-[var(--text-4)]">{it.hint}</div>}
                </div>
              </div>
            )
          })}
          <div className="pt-1 text-[11px] text-[var(--text-4)]">
            客户端 {result.version} · 检查时间 {new Date(result.at).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  )
}
