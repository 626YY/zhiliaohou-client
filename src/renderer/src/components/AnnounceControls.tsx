// 整蛊台 AI 语音播报的界面（规格见 src/shared/announce.ts）：
//   · AnnounceSwitch：每个模块页头右边的小开关（齿轮里能开「配了视频的也念」、试听）
//   · AnnounceGuide：基础模式下第一次进模块时的引导卡（这是什么、怎么关、试听），看过就收起
//   · AnnounceSettings：设置页里的总设置（声音、语速、音量、各模块开关）
// 三处共用一份设置（useAnnounce），改了立刻存、立刻同步。
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Settings2, Volume2, X } from 'lucide-react'
import { ANNOUNCE_LIMITS, ANNOUNCE_MODULES, ANNOUNCE_MODULE_MAP, ANNOUNCE_VOICE_OPTIONS, normalizeAnnounce, type AnnounceConfig, type AnnounceModule } from '@shared/announce'
import { Btn, Field, Input, Select, Toggle } from './ui'
import { Modal } from './Modal'
import { useConfigurationLevel } from '../lib/configurationLevel'
import { playRevealPreview } from '../lib/specialRevealAudio'
import { useToast } from '../stores/ui'

interface AnnounceStore {
  cfg: AnnounceConfig | null
  load: () => Promise<void>
  save: (patch: Partial<AnnounceConfig>) => Promise<void>
}

export const useAnnounce = create<AnnounceStore>((set, get) => ({
  cfg: null,
  load: async () => {
    if (typeof window.api?.announceConfig !== 'function') return
    set({ cfg: normalizeAnnounce(await window.api.announceConfig()) })
  },
  save: async (patch) => {
    const cur = get().cfg ?? normalizeAnnounce({})
    // 先在界面上改（开关不等来回），再交给主进程存；主进程回来的是夹紧后的最终值
    set({ cfg: normalizeAnnounce({ ...cur, ...patch, modules: { ...cur.modules, ...(patch.modules ?? {}) } }) })
    set({ cfg: normalizeAnnounce(await window.api.announceConfigure(patch)) })
  }
}))

function useAnnounceConfig(): AnnounceConfig | null {
  const cfg = useAnnounce((s) => s.cfg)
  const load = useAnnounce((s) => s.load)
  useEffect(() => { if (!cfg) void load() }, [cfg, load])
  return cfg
}

/** 试听：模块示例句或一句话，按页面上正在调的设置念 */
function usePreview() {
  const toast = useToast((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const play = async (req: { module?: AnnounceModule; text?: string; config?: Partial<AnnounceConfig> }) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await window.api.announcePreview(req)
      if (!r.ok || !r.voiceUrl) toast(r.error || '暂时念不出来，请检查网络后再试', 'error')
      else await playRevealPreview(r)
    } finally {
      setBusy(false)
    }
  }
  return { play, busy }
}

/** 模块页头右边：🔊 AI 播报 [开关] [⚙] */
export function AnnounceSwitch({ module }: { module: string }) {
  const meta = ANNOUNCE_MODULE_MAP[module]
  const cfg = useAnnounceConfig()
  const save = useAnnounce((s) => s.save)
  const [open, setOpen] = useState(false)
  const { play, busy } = usePreview()
  if (!meta || !cfg) return null
  const m = cfg.modules[meta.id]
  const on = cfg.enabled && m.on
  const setOn = (v: boolean) => void save(v ? { enabled: true, modules: { [meta.id]: { ...m, on: true } } as AnnounceConfig['modules'] } : { modules: { [meta.id]: { ...m, on: false } } as AnnounceConfig['modules'] })
  return (
    <div className="ml-auto flex items-center gap-1.5" data-testid="announce-switch">
      <span className="inline-flex items-center gap-1 text-xs text-[var(--text-3)]" title={`${meta.label}出结果时用 AI 念一句，比如「${meta.example}」`}>
        <Volume2 size={14} className={on ? 'text-[var(--accent-2)]' : ''} />AI 播报
      </span>
      <Toggle value={on} onChange={setOn} label={`${meta.label} AI 语音播报`} />
      <Btn size="sm" variant="ghost" aria-label="AI 播报设置" title="AI 播报设置" onClick={() => setOpen(true)}><Settings2 size={14} /></Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={`AI 播报 · ${meta.label}`} width={460} footer={<Btn variant="secondary" onClick={() => setOpen(false)}>好了</Btn>}>
        <div className="space-y-4 text-sm">
          <p className="leading-6 text-[var(--text-2)]">{meta.label}出结果时用 AI 念一句，比如「{meta.example}」。声音、语速、音量在「设置 → AI 语音播报」里统一调。</p>
          <label className="flex items-center justify-between gap-3">
            <span className="text-[var(--text)]">念这个模块</span>
            <Toggle value={on} onChange={setOn} label={`念${meta.label}`} />
          </label>
          {meta.media && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-[var(--text)]">
                配了视频 / 声音的也念
                <span className="mt-0.5 block text-xs text-[var(--text-4)]">{meta.media}默认不念，免得和它自带的声音撞在一起</span>
              </span>
              <Toggle value={m.withMedia} onChange={(v) => void save({ modules: { [meta.id]: { ...m, withMedia: v } } as AnnounceConfig['modules'] })} label="配了视频的也念" />
            </label>
          )}
          <Btn size="sm" variant="secondary" disabled={busy} onClick={() => void play({ module: meta.id })}><Volume2 size={13} />{busy ? '正在念…' : `试听「${meta.example}」`}</Btn>
        </div>
      </Modal>
    </div>
  )
}

const GUIDE_KEY = 'zl-announce-guide-seen'

/** 基础模式：第一次进支持播报的模块时，告诉主播这是什么、怎么关，可以试听；点「知道了」以后各模块都不再出 */
export function AnnounceGuide({ module }: { module: string }) {
  const meta = ANNOUNCE_MODULE_MAP[module]
  const { level } = useConfigurationLevel()
  const cfg = useAnnounceConfig()
  const save = useAnnounce((s) => s.save)
  const { play, busy } = usePreview()
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(GUIDE_KEY) === '1' } catch { return false } })
  if (!meta || !cfg || level !== 'basic' || seen) return null
  const on = cfg.enabled && cfg.modules[meta.id].on
  const dismiss = () => { try { localStorage.setItem(GUIDE_KEY, '1') } catch { /* 存不了就只这次收起 */ } setSeen(true) }
  return (
    <section className="mb-4 flex items-start gap-3 rounded-lg border border-[var(--accent-soft-2)] bg-[var(--accent-soft)] px-3 py-2.5" data-testid="announce-guide">
      <Volume2 size={18} className="mt-0.5 shrink-0 text-[var(--accent-2)]" />
      <div className="min-w-0 flex-1 text-sm leading-6 text-[var(--text-2)]">
        <div className="font-semibold text-[var(--text)]">新功能：AI 语音播报</div>
        打开后，{meta.label}出结果时用 AI 念一句给观众听，比如「{meta.example}」。{meta.media ? `${meta.media}不念。` : ''}右上角「AI 播报」开关随时能开关，齿轮里能单独调。
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn size="sm" variant="secondary" disabled={busy} onClick={() => void play({ module: meta.id })}><Volume2 size={13} />{busy ? '正在念…' : '试听'}</Btn>
          {!on && <Btn size="sm" onClick={() => void save({ enabled: true, modules: { [meta.id]: { ...cfg.modules[meta.id], on: true } } as AnnounceConfig['modules'] })}>打开播报</Btn>}
          <Btn size="sm" variant="ghost" onClick={dismiss}>知道了</Btn>
        </div>
      </div>
      <Btn size="sm" variant="ghost" aria-label="关闭引导" onClick={dismiss}><X size={14} /></Btn>
    </section>
  )
}

/** 设置页：AI 语音播报总设置 */
export function AnnounceSettings() {
  const cfg = useAnnounceConfig()
  const save = useAnnounce((s) => s.save)
  const { level } = useConfigurationLevel()
  const { play, busy } = usePreview()
  const [text, setText] = useState('')
  if (!cfg) return null
  const L = ANNOUNCE_LIMITS
  const num = (key: 'rate' | 'volume' | 'gongVolume' | 'gapMs' | 'maxQueue', label: string, unit: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Input type="number" min={L[key].min} max={L[key].max} step={L[key].step} value={cfg[key]} onChange={(e) => void save({ [key]: Number(e.target.value) } as Partial<AnnounceConfig>)} className="w-28" aria-label={label} />
        <span className="text-xs text-[var(--text-3)]">{unit}</span>
      </div>
    </Field>
  )
  return (
    <section className="space-y-3" data-testid="announce-settings">
      <h3 className="flex items-center justify-between border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">
        <span className="inline-flex items-center gap-1.5"><Volume2 size={15} className="text-[var(--accent-2)]" />AI 语音播报</span>
        <span className="text-xs font-normal text-[var(--text-4)]">整蛊台各模块出结果时念一句给观众听</span>
      </h3>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-[var(--text)]">打开 AI 语音播报<span className="mt-0.5 block text-xs text-[var(--text-4)]">关掉后整个整蛊台一句 AI 语音都不念（包括特色整蛊的开奖配音）；开着时，下面打开了的模块才念</span></span>
        <Toggle value={cfg.enabled} onChange={(v) => void save({ enabled: v })} label="打开 AI 语音播报" />
      </label>
      <Field label="声音" hint="每句话第一次念的时候要联网，念过的存在这台电脑上，之后断网也能念">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={cfg.voiceName} onChange={(e) => void save({ voiceName: e.target.value })} aria-label="播报声音" className="w-56">
            {ANNOUNCE_VOICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="试听一句，如：加30秒" className="w-48" aria-label="试听的句子" />
          <Btn size="sm" variant="secondary" disabled={busy} onClick={() => void play({ text: text.trim() || '加30秒' })}><Volume2 size={13} />{busy ? '正在念…' : '试听'}</Btn>
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {num('volume', '音量', '%')}
        {num('rate', '语速', '%', '0 是正常语速，往负调更慢')}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-semibold text-[var(--text-2)]">各模块</div>
        <div className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
          {ANNOUNCE_MODULES.map((meta) => {
            const m = cfg.modules[meta.id]
            return (
              <div key={meta.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-announce-module={meta.id}>
                <span className="w-24 shrink-0 font-medium text-[var(--text)]">{meta.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-4)]">如「{meta.example}」</span>
                {meta.media && level !== 'basic' && (
                  <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-3)]" title={`${meta.media}默认不念`}>
                    配了视频的也念
                    <Toggle value={m.withMedia} onChange={(v) => void save({ modules: { [meta.id]: { ...m, withMedia: v } } as AnnounceConfig['modules'] })} label={`${meta.label} 配了视频的也念`} />
                  </label>
                )}
                <Toggle value={m.on} onChange={(v) => void save({ modules: { [meta.id]: { ...m, on: v } } as AnnounceConfig['modules'] })} label={`念${meta.label}`} />
              </div>
            )
          })}
        </div>
      </div>
      {level !== 'basic' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="念之前敲一声锣" hint="和特色整蛊开奖同一面锣">
            <Toggle value={cfg.gong} onChange={(v) => void save({ gong: v })} label="念之前敲锣" />
          </Field>
          {num('gongVolume', '锣声音量', '%')}
          {num('gapMs', '锣后停顿', '毫秒', '锣响后过多久开始念')}
          {num('maxQueue', '排队上限', '句', '等着念的超过这么多句，新来的就不念了（连击时不攒一长串）')}
        </div>
      )}
    </section>
  )
}
