import {useSearchParams} from 'react-router-dom'
import { useEffect, useState } from 'react'
import { MonitorPlay, Video, Image as ImageIcon, X, Type, FolderOpen } from 'lucide-react'
import type { GreenScreenSlot, GreenScreenState, MediaFileInfo } from '@shared/types'
import { Btn, Card, Field, Input, Segmented, Pill, Select } from '../components/ui'
import { useToast } from '../stores/ui'

type MediaType = 'video' | 'image'
const SLOTS: GreenScreenSlot[] = [1, 2, 3, 4]
const LS = 'ent_green_slots'

interface SlotDraft {
  type: MediaType
  src: string
  text: string
  width?: number
  height?: number
}

// 窗口尺寸预设（电脑直播的画面大，往大了给）；也可以直接填宽高
const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '横屏 1280×720', w: 1280, h: 720 },
  { label: '横屏 1920×1080', w: 1920, h: 1080 },
  { label: '竖屏 1080×1920', w: 1080, h: 1920 },
  { label: '竖屏 720×1280', w: 720, h: 1280 },
  { label: '方形 1080×1080', w: 1080, h: 1080 }
]

function readDrafts(): Record<GreenScreenSlot, SlotDraft> {
  const fallback = { type: 'video' as MediaType, src: '', text: '' }
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || '{}') as Partial<Record<GreenScreenSlot, Partial<SlotDraft>>>
    return { 1: { ...fallback, ...saved[1] }, 2: { ...fallback, ...saved[2] }, 3: { ...fallback, ...saved[3] }, 4: { ...fallback, ...saved[4] } }
  } catch {
    return { 1: { ...fallback }, 2: { ...fallback }, 3: { ...fallback }, 4: { ...fallback } }
  }
}

export default function EntertainmentGreenScreen() {
  const toast = useToast((s) => s.toast)
  const [params]=useSearchParams()
  const requestedSlot=([1,2,3,4].includes(Number(params.get('slot')))?Number(params.get('slot')):1) as GreenScreenSlot
  const [slot, setSlot] = useState<GreenScreenSlot>(requestedSlot)
  useEffect(()=>setSlot(requestedSlot),[requestedSlot])
  const [drafts, setDrafts] = useState(readDrafts)
  const [state, setState] = useState<GreenScreenState>({ open: false, slots: [] })
  const draft = drafts[slot]
  const opened = (s: GreenScreenSlot) => !!state.slots.find((item) => item.slot === s)?.open

  const refresh = () => window.api.greenScreenState().then(setState)
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  // 素材文件夹：选一次文件夹，里面的视频/图片列出来点一下就用
  const [folder, setFolder] = useState('')
  const [media, setMedia] = useState<MediaFileInfo[]>([])
  const [mediaErr, setMediaErr] = useState('')
  const [mediaFilter, setMediaFilter] = useState('')

  const set = (patch: Partial<SlotDraft>) => {
    const next = { ...drafts, [slot]: { ...draft, ...patch } }
    setDrafts(next)
    localStorage.setItem(LS, JSON.stringify(next))
  }

  // 调尺寸：记下来；窗口开着就当场改（新尺寸就是收边基准）
  const applySize = (w: number, h: number) => {
    set({ width: w || undefined, height: h || undefined })
    if (w >= 64 && h >= 64 && opened(slot)) {
      void window.api.greenScreenResize(slot, w, h).then((r) => { if (!r.ok) toast(r.error || '调整尺寸失败', 'error') })
    }
  }

  const pick = async () => {
    const res = await window.api.selectFile({
      title: draft.type === 'video' ? '选择视频' : '选择图片',
      filters:
        draft.type === 'video'
          ? [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'avi'] }]
          : [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    })
    if (res.ok && res.path) set({ src: res.path })
  }

  const doOpen = async () => {
    // 没选素材也能开：只铺绿底，先让主播把来源加进直播伴侣（素材以后再配）
    const r = await window.api.greenScreenOpen(draft.src, draft.type, draft.text, slot, { width: draft.width, height: draft.height })
    if (!r.ok) return toast(r.error ?? '打开失败', 'error')
    await refresh()
    toast(draft.src
      ? `绿幕 ${slot} 号窗口已打开（按住窗口任意处可拖动，可放到游戏后面）`
      : `绿幕 ${slot} 号空窗口已打开：现在可以在直播伴侣里把它加成采集来源，选好素材再播进来`, 'success')
  }

  const doClose = async (s: GreenScreenSlot) => {
    await window.api.greenScreenClose(s)
    await refresh()
    toast(`绿幕 ${s} 号窗口已关闭`, 'info')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <MonitorPlay size={16} className="text-[var(--info)]" /> 绿幕窗口
          </div>
          <Segmented size="sm" value={String(slot)} onChange={(v) => setSlot(Number(v) as GreenScreenSlot)} options={SLOTS.map((s) => ({ value: String(s), label: `${s} 号${opened(s) ? ' ●' : ''}` }))} />
        </div>
        <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
          最多 4 个窗口同时开，各放各的视频或图片；4 号窗兼作大哥进场的进场视频窗口。
        </p>
        <div className="space-y-3">
          <Segmented
            value={draft.type}
            onChange={(v) => set({ type: v })}
            size="sm"
            options={[
              { value: 'video', label: '视频' },
              { value: 'image', label: '图片' }
            ]}
          />
          <Field label={draft.type === 'video' ? '视频文件' : '图片文件'}>
            <div className="flex gap-2">
              <Input value={draft.src} readOnly placeholder={draft.type === 'video' ? '选择视频文件' : '选择图片文件'} className="flex-1" />
              <Btn variant="secondary" onClick={pick}>
                {draft.type === 'video' ? <Video size={14} /> : <ImageIcon size={14} />} 选择
              </Btn>
              {draft.src ? (
                <Btn variant="ghost" size="sm" onClick={() => set({ src: '' })} title="清除素材">
                  <X size={14} />
                </Btn>
              ) : null}
            </div>
          </Field>
          <Field advanced label="窗口尺寸" hint="开着的窗口当场改，没开的下次打开生效">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="尺寸预设"
                value={SIZE_PRESETS.find((p) => p.w === draft.width && p.h === draft.height) ? `${draft.width}x${draft.height}` : ''}
                onChange={(e) => {
                  const preset = SIZE_PRESETS.find((p) => `${p.w}x${p.h}` === e.target.value)
                  if (preset) applySize(preset.w, preset.h)
                }}
                className="min-w-[160px]"
              >
                <option value="">自定义</option>
                {SIZE_PRESETS.map((p) => (
                  <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>{p.label}</option>
                ))}
              </Select>
              <Input type="number" min={64} max={4096} value={draft.width ?? ''} placeholder="宽" className="w-20" aria-label="窗口宽度"
                onChange={(e) => applySize(Number(e.target.value) || 0, draft.height || 0)} />
              <span className="text-xs text-[var(--text-4)]">×</span>
              <Input type="number" min={64} max={4096} value={draft.height ?? ''} placeholder="高" className="w-20" aria-label="窗口高度"
                onChange={(e) => applySize(draft.width || 0, Number(e.target.value) || 0)} />
            </div>
          </Field>
          <Field label="附加文字" hint="显示在画面底部的文字，可不填">
            <div className="flex items-center gap-2">
              <Type size={14} className="text-[var(--text-4)]" />
              <Input value={draft.text} onChange={(e) => set({ text: e.target.value })} placeholder="如：欢迎来到直播间" />
            </div>
          </Field>
          <div className="flex gap-2">
            {opened(slot) ? (
              <Btn variant="danger" onClick={() => doClose(slot)} className="flex-1">
                <X size={14} /> 关闭 {slot} 号窗口
              </Btn>
            ) : (
              <Btn onClick={doOpen} className="flex-1">
                <MonitorPlay size={14} /> 打开 {slot} 号窗口
              </Btn>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[var(--text)]">素材文件夹</div>
          <div className="flex items-center gap-2">
            {folder ? (
              <span className="max-w-[42ch] truncate text-xs text-[var(--text-4)]" title={folder}>{folder}</span>
            ) : null}
            <Btn
              size="sm"
              variant="secondary"
              onClick={async () => {
                const r = await window.api.mediaFolderPick()
                if (r.ok) { setFolder(r.dir); setMedia(r.files); setMediaErr(r.error || '') }
              }}
            >
              <FolderOpen size={14} /> {folder ? '换文件夹' : '选择文件夹'}
            </Btn>
            {folder ? (
              <Btn
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await window.api.mediaList(folder)
                  setMedia(r.files); setMediaErr(r.error || '')
                }}
                title="重新读一遍这个文件夹"
              >
                刷新
              </Btn>
            ) : null}
          </div>
        </div>
        {!folder ? (
          <p className="text-xs text-[var(--text-4)]">
            选一个放绿幕素材的文件夹，里面的视频和图片会列在这里，点一下就能用——不用一个个去挑文件。
          </p>
        ) : mediaErr ? (
          <p className="text-xs text-[var(--warn)]">{mediaErr}</p>
        ) : !media.length ? (
          <p className="text-xs text-[var(--text-4)]">这个文件夹里没有视频或图片。</p>
        ) : (
          <>
            <div className="mb-1.5 flex items-center gap-2 text-xs text-[var(--text-4)]">
              <span>{media.length} 个素材</span>
              <Input
                value={mediaFilter}
                onChange={(e) => setMediaFilter(e.target.value)}
                placeholder="按名字筛选"
                className="h-7 max-w-[200px] text-xs"
              />
            </div>
            <div className="max-h-[320px] space-y-1 overflow-y-auto">
              {media
                .filter((m) => !mediaFilter.trim() || m.name.toLowerCase().includes(mediaFilter.trim().toLowerCase()))
                .map((m) => (
                  <div
                    key={m.path}
                    className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2.5 py-1.5 text-xs"
                  >
                    {m.type === 'video' ? (
                      <Video size={13} className="shrink-0 text-[var(--text-4)]" />
                    ) : (
                      <ImageIcon size={13} className="shrink-0 text-[var(--text-4)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[var(--text-2)]" title={m.path}>{m.name}</span>
                    <Btn
                      size="sm"
                      variant="ghost"
                      title={`填进 ${slot} 号窗口的素材栏`}
                      onClick={() => set({ src: m.path, type: m.type })}
                    >
                      选用
                    </Btn>
                    {([1, 2, 3, 4] as const).map((n) => (
                      <Btn
                        key={n}
                        size="sm"
                        variant="secondary"
                        title={`直接播到 ${n} 号绿幕窗口`}
                        onClick={async () => {
                          const r = await window.api.greenScreenOpen(m.path, m.type, draft.text, n)
                          if (!r.ok) toast(r.error || '打开失败', 'error')
                        }}
                      >
                        {n}
                      </Btn>
                    ))}
                  </div>
                ))}
            </div>
          </>
        )}
      </Card>

      {state.open && (
        <Card>
          <div className="mb-2 text-sm font-semibold text-[var(--text)]">正在显示的绿幕窗口</div>
          <div className="space-y-1.5">
            {state.slots.filter((s) => s.open).map((s) => (
              <div key={s.slot} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-xs">
                <Pill tone="ok" dot>{s.slot} 号</Pill>
                <span className="min-w-0 flex-1 truncate text-[var(--text-2)]" title={s.src}>{s.type === 'video' ? '视频' : '图片'} · {s.src.split(/[/\\]/).pop()}{s.text ? ` · ${s.text}` : ''}</span>
                <Btn size="sm" variant="ghost" onClick={() => doClose(s.slot)} title="关闭"><X size={13} /></Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-[11px] leading-4 text-[var(--text-4)]">
        绿底窗口播放视频/图片，可在 OBS / 直播伴侣中作为「窗口捕获」叠加到直播画面；按住窗口任意处可以拖动；默认不置顶，能放到游戏后面（要压在最前面，开「滤镜设置」页的「输出窗口总在最前」）。
      </p>
      <p className="text-[11px] leading-4 text-[var(--text-4)]">
        先在这里把窗口开好，再开直播伴侣（伴侣已经开着的，切一下场景再切回来，来源才会认到新窗口）；直播中不要关窗口，关掉后伴侣的来源会跳到整蛊台主界面。
      </p>
    </div>
  )
}
