// 特色整蛊玩法参数的通用控件：数字=滑块+输入框，开关，下拉，颜色，文字，
// 单个文件 / 多个文件（自定义图片、音效、视频、音乐），麦克风选择。规格来自 shared/specialGames.ts。
import { useEffect, useState } from 'react'
import { FolderOpen, Plus, X } from 'lucide-react'
import { Btn, Field, Input, Segmented, Select, Toggle } from '../ui'
import type { SpecialParamSpec } from '@shared/specialGames'
import { useConfigurationLevel } from '../../lib/configurationLevel'

type Value = number | string | boolean

const FILE_FILTERS: Record<NonNullable<SpecialParamSpec['fileKind']>, { name: string; extensions: string[] }> = {
  image: { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
  audio: { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] },
  video: { name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v'] }
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p

// 麦克风列表：Electron 默认放行媒体权限，设备名直接可读；读不到名字时先借一次麦克风拿授权再读
async function listMics(): Promise<string[]> {
  const read = async () =>
    (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.label && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => d.label)
  try {
    let names = await read()
    if (!names.length) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      names = await read()
    }
    return [...new Set(names)]
  } catch {
    return []
  }
}

function NumberParam({ spec, value, onChange }: { spec: SpecialParamSpec; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const min = spec.min ?? 0
  const max = spec.max ?? 100
  // 滑杆只到常用范围（sliderMax），手填可以一直填到 max（防爆上限；「数值不设上限」的项 max 给得很大）
  const sliderMax = Math.min(max, spec.sliderMax ?? max)
  const commit = (text: string) => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) return
    onChange(Math.min(max, Math.max(min, n)))
  }
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={sliderMax}
        step={spec.step ?? 1}
        value={Math.min(sliderMax, Math.max(min, value))}
        aria-label={spec.label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
      />
      <div className="relative w-[92px] shrink-0">
        <Input
          aria-label={`${spec.label}数值`}
          value={draft}
          inputMode="decimal"
          onChange={(e) => { setDraft(e.target.value); commit(e.target.value) }}
          onBlur={() => setDraft(String(value))}
          className={`tnum py-1.5 text-right text-xs ${spec.unit ? 'pr-9' : ''}`}
        />
        {spec.unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-4)]">{spec.unit}</span>}
      </div>
    </div>
  )
}

function FileParam({ spec, value, onChange }: { spec: SpecialParamSpec; value: string; onChange: (v: string) => void }) {
  const multi = spec.type === 'files'
  const list = multi ? value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : value ? [value] : []
  const pick = async () => {
    const r = await window.api.selectFile({
      title: `选择${spec.label}`,
      filters: spec.fileKind ? [FILE_FILTERS[spec.fileKind]] : undefined,
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
    })
    if (!r.ok) return
    const picked = r.paths?.length ? r.paths : r.path ? [r.path] : []
    if (!picked.length) return
    onChange(multi ? [...new Set([...list, ...picked])].join('\n') : picked[0])
  }
  return (
    <div className="space-y-1.5">
      {list.length > 0 ? (
        <div className="space-y-1">
          {list.map((p) => (
            <div key={p} className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-input)] px-2 py-1" title={p}>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-2)]">{baseName(p)}</span>
              <button
                type="button"
                aria-label={`移除 ${baseName(p)}`}
                onClick={() => onChange(list.filter((x) => x !== p).join('\n'))}
                className="rounded p-0.5 text-[var(--text-4)] hover:bg-[var(--bg-elev)] hover:text-[var(--danger)]"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--line-strong)] px-2 py-1.5 text-xs text-[var(--text-4)]">用内置素材</div>
      )}
      <div className="flex gap-2">
        <Btn size="sm" variant="secondary" onClick={() => void pick()}>
          {multi ? <Plus size={13} /> : <FolderOpen size={13} />}
          {multi ? (list.length ? '再添加' : '选择文件') : list.length ? '换一个' : '选择文件'}
        </Btn>
        {list.length > 0 && <Btn size="sm" variant="ghost" onClick={() => onChange('')}>恢复内置</Btn>}
      </div>
    </div>
  )
}

// 带预览图的选项（皮肤之类）：一排小卡片，图片缺了就只显示名字
function ImageOptions({ spec, value, onChange }: { spec: SpecialParamSpec; value: string; onChange: (v: string) => void }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  return (
    <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4" role="radiogroup" aria-label={spec.label}>
      {(spec.options ?? []).map((o) => {
        const on = o.value === value
        const img = spec.optionImages?.[o.value]
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            onClick={() => onChange(o.value)}
            className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 transition ${on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-elev)]'}`}
          >
            <span className="flex h-14 w-full items-center justify-center overflow-hidden rounded-md" style={{ background: 'linear-gradient(160deg, #1d2633, #0c1016)' }}>
              {img && !broken[o.value] ? (
                <img src={`zlspecial://app/assets/${img}`} alt="" draggable={false} className="h-full w-full object-contain p-1" onError={() => setBroken((b) => ({ ...b, [o.value]: true }))} />
              ) : (
                <span className="text-xs text-white/70">{o.label}</span>
              )}
            </span>
            <span className={`text-xs ${on ? 'font-semibold text-[var(--accent-2)]' : 'text-[var(--text-2)]'}`}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function DeviceParam({ spec, value, onChange }: { spec: SpecialParamSpec; value: string; onChange: (v: string) => void }) {
  const [mics, setMics] = useState<string[] | null>(null)
  useEffect(() => { void listMics().then(setMics) }, [])
  const options = mics ?? []
  return (
    <Select aria-label={spec.label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">系统默认麦克风</option>
      {value && !options.includes(value) && <option value={value}>{value}（未连接）</option>}
      {options.map((m) => <option key={m} value={m}>{m}</option>)}
    </Select>
  )
}

export default function SpecialParamField({ spec, value, onChange }: { spec: SpecialParamSpec; value: Value | undefined; onChange: (v: Value) => void }) {
  const v = value ?? spec.def
  const { level } = useConfigurationLevel()
  if (spec.type === 'toggle') {
    return (
      <div data-advanced-field={spec.advanced || undefined} className="flex items-start justify-between gap-3" style={spec.advanced && level === 'basic' ? { display: 'none' } : undefined}>
        <div className="min-w-0">
          <div className="text-xs font-medium text-[var(--text-2)]">{spec.label}</div>
          {spec.hint && <div className="mt-0.5 text-[11px] leading-4 text-[var(--text-4)]">{spec.hint}</div>}
        </div>
        <Toggle value={v === true} onChange={onChange} label={spec.label} />
      </div>
    )
  }
  if (spec.type === 'number') {
    return (
      <Field label={spec.label} hint={spec.hint} advanced={spec.advanced}>
        <NumberParam spec={spec} value={Number(v)} onChange={onChange} />
      </Field>
    )
  }
  if (spec.type === 'select') {
    const options = spec.options ?? []
    return (
      <Field label={spec.label} hint={spec.hint} advanced={spec.advanced} className={spec.optionImages ? 'min-[1360px]:col-span-2' : undefined}>
        {spec.optionImages ? (
          <ImageOptions spec={spec} value={String(v)} onChange={onChange} />
        ) : options.length <= 3 ? (
          <Segmented size="sm" value={String(v)} onChange={onChange} options={options} />
        ) : (
          <Select value={String(v)} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )}
      </Field>
    )
  }
  if (spec.type === 'file' || spec.type === 'files') {
    return (
      <Field label={spec.label} hint={spec.hint} advanced={spec.advanced}>
        <FileParam spec={spec} value={String(v)} onChange={onChange} />
      </Field>
    )
  }
  if (spec.type === 'device') {
    return (
      <Field label={spec.label} hint={spec.hint} advanced={spec.advanced}>
        <DeviceParam spec={spec} value={String(v)} onChange={onChange} />
      </Field>
    )
  }
  if (spec.type === 'color') {
    return (
      <Field label={spec.label} hint={spec.hint} advanced={spec.advanced}>
        <input type="color" value={String(v)} onChange={(e) => onChange(e.target.value)} className="h-9 w-16 cursor-pointer rounded-lg border border-[var(--line-strong)] bg-[var(--bg-input)]" />
      </Field>
    )
  }
  return (
    <Field label={spec.label} hint={spec.hint} advanced={spec.advanced}>
      <Input value={String(v)} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}
