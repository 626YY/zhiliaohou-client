// 特色整蛊的直播窗口（17 个玩法共用一个「特色整蛊」窗口，各玩各的）：开关、横竖屏、底色、全部清屏、下次启动自动开；
// 高级模式里还有分辨率、自定义尺寸、联动时自动开窗。宫格页和详情页顶上都是这一条。
import { useEffect, useState } from 'react'
import { Eraser, MonitorPlay, Square } from 'lucide-react'
import { Btn, Input, Pill, Segmented, Select, Toggle } from '../ui'
import { AdvancedFields } from '../../lib/configurationLevel'
import { SPECIAL_WIDGET_ID, readAutoOpenIds, writeAutoOpenIds } from '../../lib/widgetLaunchers'
import { useToast } from '../../stores/ui'
import { SPECIAL_FPS_OPTIONS, SPECIAL_SCREEN_PRESETS, SPECIAL_WINDOW_TITLE, specialOrientation, specialSizeFor, type SpecialWindowConfig } from '@shared/specialGames'

export default function SpecialWindowBar({ win, onChange, compact = false }: { win: SpecialWindowConfig & { open: boolean }; onChange: () => void; compact?: boolean }) {
  const toast = useToast((s) => s.toast)
  const [auto, setAuto] = useState(() => readAutoOpenIds().includes(SPECIAL_WIDGET_ID))
  const [size, setSize] = useState({ w: String(win.width), h: String(win.height) })
  useEffect(() => { setSize({ w: String(win.width), h: String(win.height) }) }, [win.width, win.height])

  const configure = async (patch: Partial<SpecialWindowConfig>) => {
    await window.api.specialWindowConfigure(patch)
    onChange()
  }
  const open = async () => {
    const r = await window.api.specialWindowOpen()
    if (!r.ok) toast(r.error ?? '打开失败', 'error')
    else toast(`「${SPECIAL_WINDOW_TITLE}」窗口已开：直播伴侣里添加窗口采集选它，所有玩法都在这一个窗口里`, 'success')
    onChange()
  }
  const close = async () => {
    await window.api.specialWindowClose()
    onChange()
  }
  const toggleAuto = (on: boolean) => {
    const list = readAutoOpenIds()
    writeAutoOpenIds(on ? [...new Set([...list, SPECIAL_WIDGET_ID])] : list.filter((id) => id !== SPECIAL_WIDGET_ID))
    setAuto(on)
  }
  const commitSize = () => {
    const w = Math.trunc(Number(size.w)), h = Math.trunc(Number(size.h))
    if (w >= 160 && h >= 160 && (w !== win.width || h !== win.height)) void configure({ width: w, height: h })
    else setSize({ w: String(win.width), h: String(win.height) })
  }
  const preset = SPECIAL_SCREEN_PRESETS.find((p) => p.w === win.width && p.h === win.height)?.value ?? 'custom'

  return (
    <div className="zl-card mb-4 p-3" data-testid="special-window-bar">
      <div className="flex flex-wrap items-center gap-2">
        <MonitorPlay size={16} className="text-[var(--accent-2)]" />
        <span className="text-sm font-semibold text-[var(--text)]">直播窗口「{SPECIAL_WINDOW_TITLE}」</span>
        {win.open ? <Pill tone="ok" dot pulse>窗口开着</Pill> : <Pill tone="muted" dot>窗口没开</Pill>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-3)]">直播画面</span>
          <Segmented
            size="sm"
            value={specialOrientation(win.width, win.height)}
            onChange={(v) => void configure(specialSizeFor(v, win.width, win.height))}
            options={[{ value: 'landscape' as const, label: '横屏 16:9' }, { value: 'portrait' as const, label: '竖屏 9:16' }]}
          />
          <Segmented
            size="sm"
            value={win.background}
            onChange={(v) => void configure({ background: v })}
            options={[{ value: 'green' as const, label: '绿幕' }, { value: 'transparent' as const, label: '透明' }]}
          />
          {win.open && (
            <Btn size="sm" variant="ghost" title="把场上的东西全部清掉，窗口留着" onClick={() => void window.api.specialClearAll().then((r) => toast(r.cleared ? `已清屏 ${r.cleared} 个玩法` : '画面上没有东西', 'success'))}>
              <Eraser size={13} />全部清屏
            </Btn>
          )}
          {win.open ? (
            <Btn size="sm" variant="secondary" onClick={() => void close()}><Square size={12} />关闭窗口</Btn>
          ) : (
            <Btn size="sm" onClick={() => void open()}><MonitorPlay size={13} />开启窗口</Btn>
          )}
        </div>
      </div>
      {!compact && (
        <p className="mt-2 text-xs leading-5 text-[var(--text-3)]">
          17 个玩法都在这一个窗口里，各玩各的：直播伴侣添加一次「窗口采集 → {SPECIAL_WINDOW_TITLE}」就行，
          {win.background === 'green' ? '绿幕记得加「色度键」抠掉。' : '透明底色直接叠加。'}收到联动时窗口没开会自动打开。
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--text-3)]">
        <label className="flex items-center gap-2"><Toggle value={auto} onChange={toggleAuto} label="下次启动自动开启特色整蛊窗口" />下次启动自动开启</label>
        <AdvancedFields>
          <label className="flex items-center gap-2"><Toggle value={win.autoOpen} onChange={(v) => void configure({ autoOpen: v })} label="联动时自动开窗" />收到联动时窗口没开就自动打开</label>
          <label className="flex items-center gap-2">
            分辨率
            <Select aria-label="窗口分辨率" value={preset} className="h-8 w-40 text-xs" onChange={(e) => { const p = SPECIAL_SCREEN_PRESETS.find((x) => x.value === e.target.value); if (p) void configure({ width: p.w, height: p.h }) }}>
              {SPECIAL_SCREEN_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              <option value="custom" disabled>自定义 {win.width}×{win.height}</option>
            </Select>
          </label>
          <span className="flex items-center gap-1.5">
            自定义
            <Input type="number" aria-label="窗口宽" value={size.w} min={160} max={3840} className="h-8 w-20 text-xs" onChange={(e) => setSize((s) => ({ ...s, w: e.target.value }))} onBlur={commitSize} onKeyDown={(e) => { if (e.key === 'Enter') commitSize() }} />
            ×
            <Input type="number" aria-label="窗口高" value={size.h} min={160} max={2160} className="h-8 w-20 text-xs" onChange={(e) => setSize((s) => ({ ...s, h: e.target.value }))} onBlur={commitSize} onKeyDown={(e) => { if (e.key === 'Enter') commitSize() }} />
          </span>
          <label className="flex items-center gap-2" title="画面动起来时每秒画几帧；直播推流一般 30 帧，帧数越高越吃电脑">
            动画帧率
            <Select aria-label="动画帧率" value={String(SPECIAL_FPS_OPTIONS.some((o) => o.value === win.fps) ? win.fps : 'custom')} className="h-8 w-52 text-xs" onChange={(e) => void configure({ fps: Number(e.target.value) })}>
              {SPECIAL_FPS_OPTIONS.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
              {!SPECIAL_FPS_OPTIONS.some((o) => o.value === win.fps) && <option value="custom" disabled>{win.fps} 帧</option>}
            </Select>
          </label>
        </AdvancedFields>
      </div>
    </div>
  )
}
