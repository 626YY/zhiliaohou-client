import {useSearchParams} from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Clapperboard, Play, Square, FolderOpen, Crosshair, X } from 'lucide-react'
import type { VideoWidgetConfig, VideoWidgetSlot, VideoWidgetState } from '@shared/types'
import { Btn, Card, Field, Input, Toggle, Segmented, Pill } from '../components/ui'
import { useToast } from '../stores/ui'

const LS_LEGACY = 'ent_video_cfg'
const LS = (slot: VideoWidgetSlot) => `ent_video_cfg_${slot}`

const defaultCfg: VideoWidgetConfig = {
  path: '',
  loop: true,
  muted: false,
  volume: 1,
  topMost: false,
  width: 640,
  height: 360,
  bgColor: '#000000',
  x: 0,
  y: 0
}

function readCfg(slot: VideoWidgetSlot): VideoWidgetConfig {
  try {
    // 老版本只有一个窗口的配置，升级后当主窗口的
    const raw = localStorage.getItem(LS(slot)) || (slot === 'main' ? localStorage.getItem(LS_LEGACY) : null) || '{}'
    return { ...defaultCfg, ...JSON.parse(raw), slot }
  } catch {
    return { ...defaultCfg, slot }
  }
}

export default function EntertainmentVideo() {
  const toast = useToast((s) => s.toast)
  const [params]=useSearchParams()
  const requestedSlot=params.get('slot')==='vip'?'vip':'main'
  const [slot, setSlot] = useState<VideoWidgetSlot>(requestedSlot)
  useEffect(()=>setSlot(requestedSlot),[requestedSlot])
  const [cfgs, setCfgs] = useState<Record<VideoWidgetSlot, VideoWidgetConfig>>(() => ({ main: readCfg('main'), vip: readCfg('vip') }))
  const [state, setState] = useState<VideoWidgetState>({ open: false, main: false, vip: false })
  const cfg = cfgs[slot]
  const open = slot === 'main' ? state.main : state.vip

  const refresh = () => window.api.videoWidgetState().then(setState)
  useEffect(() => {
    void refresh()
    // 窗口被主播手动关掉、拖走了，这里 2 秒看一眼跟上
    const timer = window.setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  const set = (patch: Partial<VideoWidgetConfig>) => {
    const next = { ...cfg, ...patch, slot }
    setCfgs((prev) => ({ ...prev, [slot]: next }))
    localStorage.setItem(LS(slot), JSON.stringify(next))
  }

  const pick = async () => {
    const res = await window.api.selectFile({
      title: '选择视频文件',
      filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv'] }],
      properties: ['openFile']
    })
    if (res.ok && res.path) set({ path: res.path })
  }

  const toggle = async () => {
    if (open) {
      await window.api.videoWidgetClose(slot)
      await refresh()
      toast(`${slot === 'main' ? '主' : 'VIP'}视频窗口已关闭`, 'info')
      return
    }
    if (!cfg.path) return toast('请先选择视频文件', 'info')
    const r = await window.api.videoWidgetOpen({ ...cfg, slot })
    if (!r.ok) return toast(r.error || '打开视频播放器失败', 'error')
    await refresh()
    toast(`${slot === 'main' ? '主' : 'VIP'}视频窗口已开启（置顶，顶部一条可拖动）`, 'success')
  }

  // 把窗口当前拖到的位置/尺寸记下来，下次开还在这
  const useCurrentBounds = async () => {
    const s = await window.api.videoWidgetState()
    const b = slot === 'main' ? s.mainBounds : s.vipBounds
    if (!b) return toast('窗口没开着，拖好位置后再点', 'info')
    set({ x: b.x, y: b.y, width: b.width, height: b.height })
    toast(`已记住位置 ${b.x},${b.y} 和尺寸 ${b.width}×${b.height}`, 'success')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Clapperboard size={16} className="text-[var(--accent-2)]" /> 视频播放器
            <Pill tone={state.main ? 'ok' : 'muted'} dot>主{state.main ? '播放中' : '未开'}</Pill>
            <Pill tone={state.vip ? 'ok' : 'muted'} dot>VIP{state.vip ? '播放中' : '未开'}</Pill>
          </div>
          <Segmented size="sm" value={slot} onChange={setSlot} options={[{ value: 'main', label: '主窗口' }, { value: 'vip', label: 'VIP 窗口' }]} />
        </div>
        <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
          主 / VIP 两个窗口互不影响，可以同时播。礼物规则里的「播放视频 / 停止视频」走主窗口，VIP 窗口留给主播自己放循环暖场视频。
        </p>

        <div className="space-y-3">
          <Field label="视频文件">
            <div className="flex gap-2">
              <Input value={cfg.path} readOnly placeholder="未选择视频" className="flex-1" />
              <Btn variant="secondary" onClick={pick}>
                <FolderOpen size={14} /> 选择
              </Btn>
              {cfg.path ? <Btn variant="ghost" onClick={() => set({ path: '' })} title="清除视频"><X size={14} /></Btn> : null}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field advanced label="窗口宽度">
              <Input type="number" value={cfg.width} onChange={(e) => set({ width: Math.max(160, Number(e.target.value) || 640) })} />
            </Field>
            <Field advanced label="窗口高度">
              <Input type="number" value={cfg.height} onChange={(e) => set({ height: Math.max(90, Number(e.target.value) || 360) })} />
            </Field>
            <Field advanced label="位置 X" hint="0,0 = 居中">
              <Input type="number" value={cfg.x ?? 0} onChange={(e) => set({ x: Number(e.target.value) || 0 })} />
            </Field>
            <Field advanced label="位置 Y">
              <Input type="number" value={cfg.y ?? 0} onChange={(e) => set({ y: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <Btn size="sm" variant="secondary" onClick={useCurrentBounds} title="窗口开着时把它现在的位置和大小记下来">
            <Crosshair size={13} /> 用窗口当前位置和大小
          </Btn>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.loop} onChange={(v) => set({ loop: v })} />
              循环播放
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.muted} onChange={(v) => set({ muted: v })} />
              静音
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.topMost} onChange={(v) => set({ topMost: v })} />
              这个窗口总在最前（关掉则跟「输出窗口总在最前」的总开关）
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.chroma === true} onChange={(v) => set({ chroma: v })} />
              绿幕抠图（视频自带绿背景时扣成透明，参数在设置页）
            </label>
            <Field label={`音量 ${Math.round((cfg.volume ?? 1) * 100)}%`}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((cfg.volume ?? 1) * 100)}
                onChange={(e) => set({ volume: Number(e.target.value) / 100 })}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
          </div>

          <Field label="背景颜色">
            <div className="flex gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(cfg.bgColor) ? cfg.bgColor : '#000000'}
                onChange={(e) => set({ bgColor: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--line-strong)] bg-[var(--bg-input)]"
              />
              <Input value={cfg.bgColor} onChange={(e) => set({ bgColor: e.target.value })} className="flex-1" />
            </div>
          </Field>

          <Btn onClick={toggle} variant={open ? 'secondary' : 'primary'} disabled={!cfg.path && !open} className="w-full">
            {open ? <Square size={14} /> : <Play size={14} />}
            {open ? `关闭${slot === 'main' ? '主' : 'VIP'}窗口` : `开启${slot === 'main' ? '主' : 'VIP'}窗口`}
          </Btn>
        </div>

        <p className="mt-4 text-[11px] leading-4 text-[var(--text-4)]">
          窗口内单击暂停/继续，双击全屏，按住顶部一条可以拖动；改了尺寸和位置要重开窗口生效。
        </p>
      </Card>
    </div>
  )
}
