import { useEffect, useRef, useState } from 'react'
import EmojiText from '../components/EmojiText'
import { Sticker, RotateCcw, Gift } from 'lucide-react'
import type { StickerState } from '@shared/types'
import { Btn, Card, EmptyState, Pill } from '../components/ui'
import { useToast } from '../stores/ui'
import { mediaUrl } from '../utils/mediaUrl'

// 老版本把统计存在页面 localStorage 里；升级后第一次打开把它并进主进程，之后这个键就不用了
const LEGACY_KEY = 'ent_sticker_stats'

export default function EntertainmentSticker() {
  const toast = useToast((s) => s.toast)
  const [state, setState] = useState<StickerState | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<number>(0)

  useEffect(() => {
    let alive = true
    const boot = async () => {
      let current = await window.api.stickerState()
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null') as Record<string, number> | null
        if (legacy && typeof legacy === 'object' && Object.keys(legacy).length) {
          const r = await window.api.stickerImport(legacy)
          localStorage.removeItem(LEGACY_KEY)
          if (r.imported) toast(`已把旧版页面里的 ${r.imported} 款礼物统计并入`, 'info')
          current = await window.api.stickerState()
        }
      } catch {
        /* 旧数据坏了就不管 */
      }
      if (alive) setState(current)
    }
    void boot()
    // 累计在主进程做，页面只收推送：谁刚送了什么高亮 2 秒
    const off = window.api.onStickerChanged((next) => {
      setState(next)
      if (next.lastGift) {
        setFlash(next.lastGift)
        window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setFlash(null), 2000)
      }
    })
    return () => {
      alive = false
      off()
      window.clearTimeout(flashTimer.current)
    }
  }, [toast])

  const reset = async () => {
    await window.api.stickerReset()
    setState(await window.api.stickerState())
  }

  if (!state) return null
  const rows = state.rows

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Sticker size={16} className="text-[var(--accent-2)]" /> 礼物贴纸统计
          </div>
          <div className="flex items-center gap-2">
            <Pill tone="accent" dot>
              累计 {state.total} 次
            </Pill>
            <Btn size="sm" variant="secondary" onClick={reset}>
              <RotateCcw size={13} /> 清零
            </Btn>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Gift size={28} />}
            title="暂无礼物统计"
            desc="收到礼物后按礼物名累计，页面关着也照样记。"
            compact
          />
        ) : (
          <div className="space-y-1.5">
            {rows.map((row, i) => (
              <div
                key={row.name}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
                  flash === row.name
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--line)] bg-[var(--bg-elev)]'
                }`}
              >
                <span className="tnum w-6 text-center text-xs font-bold text-[var(--text-4)]">{i + 1}</span>
                {row.image ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-input)]">
                    <img src={mediaUrl(row.image)} alt="" className="h-full w-full object-contain" />
                  </span>
                ) : (
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent-2)' }}
                  >
                    {row.name.slice(0, 1)}
                  </span>
                )}
                <span className="flex-1 truncate text-sm font-medium text-[var(--text)]"><EmojiText text={row.name} /></span>
                <span className="tnum text-lg font-bold text-[var(--accent-2)]">{row.count}</span>
                <span className="text-[11px] text-[var(--text-4)]">次</span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-[11px] leading-4 text-[var(--text-4)]">
          每款礼物累计收到的个数（连击按真实个数算），自动保存，重启客户端仍保留。
        </p>
      </Card>
    </div>
  )
}
