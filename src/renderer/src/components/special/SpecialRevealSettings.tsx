// 盲盒开奖画面与配音（照时间盲盒那批视频）：抽中时窗口里敲一声锣、蹦出「锁链+5」，晓伊接着念「锁链加5」。
// 设置项的规格在 shared/specialGames.ts 的 SPECIAL_REVEAL_PARAMS，这里用通用控件摆；改了立刻存，开着的直播窗口跟着变。
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Volume2 } from 'lucide-react'
import { Btn, Input } from '../ui'
import SpecialParamField from './SpecialParamField'
import { playRevealPreview } from '../../lib/specialRevealAudio'
import { useToast } from '../../stores/ui'
import { DEFAULT_SPECIAL_REVEAL, SPECIAL_REVEAL_PARAMS, SPECIAL_VOICE_OPTIONS, type SpecialRevealConfig } from '@shared/specialGames'

const GROUPS: { key: 'look' | 'sound' | 'other'; title: string }[] = [
  { key: 'look', title: '画面' },
  { key: 'sound', title: '声音' },
  { key: 'other', title: '其他' }
]
const groupOf = (key: string): 'look' | 'sound' | 'other' => {
  const g = SPECIAL_REVEAL_PARAMS.find((p) => p.key === key)?.group
  return g === 'look' ? 'look' : g === 'sound' || g === 'media' ? 'sound' : 'other'
}

export default function SpecialRevealSettings() {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<SpecialRevealConfig>(DEFAULT_SPECIAL_REVEAL)
  const [open, setOpen] = useState(false)
  const [sample, setSample] = useState('锁链加5')
  const [busy, setBusy] = useState(false)
  // 拖滑块会连着改很多下：界面立刻跟着动，存盘攒一下（停手 250 毫秒再存一次）
  const pending = useRef<Partial<SpecialRevealConfig>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length) void window.api.specialRevealConfigure(patch)
  }
  useEffect(() => {
    let alive = true
    void window.api.specialState().then((st) => { if (alive && st.reveal) setCfg(st.reveal) }).catch(() => undefined)
    return () => { alive = false; flush() }
  }, [])
  const change = (key: string, value: number | string | boolean) => {
    setCfg((c) => ({ ...c, [key]: value }))
    pending.current = { ...pending.current, [key]: value }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 250)
  }
  const listen = async () => {
    flush()
    setBusy(true)
    try {
      const r = await window.api.specialVoicePreview({ text: sample.trim() || '锁链加5', config: cfg })
      if (!r.ok && r.error) toast(r.error, 'error')
      await playRevealPreview(r)
    } finally {
      setBusy(false)
    }
  }
  const voiceLabel = SPECIAL_VOICE_OPTIONS.find((o) => o.value === cfg.voiceName)?.label.split(' · ')[0] ?? cfg.voiceName
  const summary = !cfg.enabled
    ? '关着：开出来直接生效'
    : [cfg.gong ? '锣声' : '', cfg.voice ? `${voiceLabel}配音${cfg.rate ? `（语速 ${cfg.rate > 0 ? '+' : ''}${cfg.rate}%）` : ''}` : '不念'].filter(Boolean).join(' + ')

  return (
    <div data-testid="special-reveal-settings">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="flex min-w-0 items-center gap-1.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={15} className="text-[var(--text-3)]" /> : <ChevronRight size={15} className="text-[var(--text-3)]" />}
          <span className="text-sm font-medium text-[var(--text)]">开奖画面与配音</span>
          <span className="text-xs text-[var(--text-4)]">{summary}</span>
        </button>
        <span className="hidden text-xs text-[var(--text-3)] sm:inline">抽中时敲一声锣、蹦出「锁链+5」，再念出来，和时间盲盒的视频一样。</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Input aria-label="试听的句子" value={sample} onChange={(e) => setSample(e.target.value)} className="h-8 w-28 text-xs" />
          <Btn size="sm" variant="secondary" disabled={busy} onClick={() => void listen()} title="用现在的声音和语速念一遍（先敲锣）"><Volume2 size={13} />{busy ? '生成中…' : '试听'}</Btn>
        </div>
      </div>
      {open && (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.key} className="space-y-3">
              <div className="text-xs font-semibold text-[var(--text-2)]">{g.title}</div>
              {SPECIAL_REVEAL_PARAMS.filter((p) => groupOf(p.key) === g.key).map((p) => (
                <SpecialParamField key={p.key} spec={p} value={(cfg as unknown as Record<string, number | string | boolean>)[p.key]} onChange={(v) => change(p.key, v)} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
