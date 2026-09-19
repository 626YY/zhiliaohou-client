import { CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react'
import { useToast } from '../stores/ui'
import type { ToastKind } from '../stores/ui'

const tones: Record<ToastKind, string> = {
  success: 'border-[var(--ok-line)] bg-[var(--ok-soft)] text-[var(--ok)]',
  error: 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)]',
  info: 'border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]'
}

const icons: Record<ToastKind, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info
}

export function ToastHost() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => {
        const Icon = icons[t.kind]
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`zl-toast-in pointer-events-auto flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur ${tones[t.kind]}`}
          >
            <Icon size={15} className="shrink-0" />
            {t.text}
          </button>
        )
      })}
    </div>
  )
}
