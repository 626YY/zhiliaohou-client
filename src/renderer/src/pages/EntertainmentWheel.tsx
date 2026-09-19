import SkinPicker from '../components/SkinPicker'
import { normalizeWidgetSkin, widgetSkin } from '@shared/widgetSkins'
﻿import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Play, MonitorPlay } from 'lucide-react'
import type { EntertainmentGiftImage, LotteryItem, LotteryEvent } from '@shared/types'
import { Btn, Card, Field, Input, Select, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { giftImageLabel, uniqueGiftImages } from '../utils/giftImages'
import LotteryActionEditor from '../components/LotteryActionEditor'
import LotteryStageOptions, { DEFAULT_STAGE_OPTIONS, normalizeStageOptions, type StageOptions } from '../components/LotteryStageOptions'
import LotterySave, { useLotterySave } from '../components/LotterySave'
import LotteryPresets from '../components/LotteryPresets'
import LotteryHistory from '../components/LotteryHistory'
import LotteryPreview, { lotteryImageSrc } from '../components/LotteryPreview'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'

const DEFAULT_ITEMS: LotteryItem[] = [
  { name: '谢谢参与', color: '#3a4456' },
  { name: '小礼物', color: '#e6a23c' },
  { name: '火箭', color: '#f56c6c' },
  { name: '再来一次', color: '#409eff' },
  { name: '大礼物', color: '#67c23a' },
  { name: '超级火箭', color: '#ff9d00' },
  { name: '谢谢参与', color: '#909399' },
  { name: '盲盒', color: '#9c6cff' }
]

const ITEMS_KEY = 'ent-wheel-items'
const TRIGGER_KEY = 'ent-wheel-trigger'

function readTrigger(): { autoSpin: boolean; triggerGift: string; skin?: string; centerGift: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(TRIGGER_KEY) ?? '{}') as Partial<{ autoSpin: boolean; triggerGift: string; skin: string; centerGift: boolean }>
    return { autoSpin: saved.autoSpin === true, triggerGift: String(saved.triggerGift ?? ''), skin: normalizeWidgetSkin(saved.skin), centerGift: saved.centerGift !== false }
  } catch {
    return { autoSpin: false, triggerGift: '', centerGift: true }
  }
}

/** 上播表现（跑马灯 / 声音 / 空闲显隐）。老版本只存过一个转动音效路径，升上来当自定义音效用。 */
function readStage(): StageOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(TRIGGER_KEY) ?? '{}') as Partial<StageOptions>
    const legacySpin = localStorage.getItem('ent-wheel-sound') || ''
    if (!saved.sound && legacySpin) return normalizeStageOptions({ ...saved, sound: { mode: 'custom', spin: legacySpin, win: '', volume: 70 } })
    return normalizeStageOptions(saved)
  } catch {
    return DEFAULT_STAGE_OPTIONS
  }
}

export default function EntertainmentWheel() {
  const toast = useToast((s) => s.toast)
  const [items, setItems] = useState<LotteryItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ITEMS_KEY) ?? 'null')
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_ITEMS
    } catch {
      return DEFAULT_ITEMS
    }
  })
  const [skin, setSkin] = useState(() => normalizeWidgetSkin(readTrigger().skin))
  const [autoSpin, setAutoSpin] = useState(() => readTrigger().autoSpin)
  const [triggerGift, setTriggerGift] = useState(() => readTrigger().triggerGift)
  const [centerGift, setCenterGift] = useState(() => readTrigger().centerGift)
  const [stage, setStage] = useState<StageOptions>(() => readStage())
  const patchStage = (patch: Partial<StageOptions>) => setStage((prev) => normalizeStageOptions({ ...prev, ...patch }))
  const [result, setResult] = useState('')
  const [drawEvent, setDrawEvent] = useState<LotteryEvent>()
  const [editing, setEditing] = useState<number | null>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const [centerImg, setCenterImg] = useState(() => localStorage.getItem('ent-wheel-center') || '')
  // 转盘窗口大小（含铺在里面的奖品视频）：改了当场生效。
  // 以窗口真实大小为准：主播拖边框调过的，输入框跟着显示；重开窗口不会被输入框里的旧值打回去。
  const [winSize, setWinSize] = useState<{ w: number; h: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ent-wheel-winsize') || 'null')
      if (saved && Number(saved.w) >= 260 && Number(saved.h) >= 300) return { w: Number(saved.w), h: Number(saved.h) }
    } catch { /* 损坏用默认 */ }
    return { w: 680, h: 720 }
  })
  const syncWinSize = useCallback(async () => {
    const size = await window.api.outputWindowSize('幸运转盘').catch(() => null)
    if (size) setWinSize({ w: size.width, h: size.height })
  }, [])
  const applyWinSize = (w: number, h: number) => {
    setWinSize({ w, h })
    if (w >= 260 && h >= 300 && w <= 4096 && h <= 4096) {
      localStorage.setItem('ent-wheel-winsize', JSON.stringify({ w, h }))
      void window.api.outputWindowResize('幸运转盘', w, h)
    }
  }
  useEffect(() => { void syncWinSize() }, [syncWinSize])
  const [giftImgs, setGiftImgs] = useState<EntertainmentGiftImage[]>([])
  const giftImageOptions = useMemo(() => uniqueGiftImages(giftImgs), [giftImgs])
  // 保存反馈：改动自动存，状态灯让主播看得见存没存上
  const { state: saveState, run: saveNow } = useLotterySave(() =>
    window.api.lotteryConfigure('wheel', { autoSpin, triggerGift, skin, centerGift, ...stage }, items, centerImg)
  )

  useEffect(() => {
    window.api.lotteryState().then((s) => {
      setWindowOpen(s.lucky)
      setDrawEvent(s.draws?.wheel)
      if (s.draws?.wheel?.phase === 'result' || s.draws?.wheel?.phase === 'error') setResult(s.draws.wheel.item?.name || '')
    })
    window.api.entertainmentListGiftImages().then((list) => setGiftImgs(list))
    return window.api.onLotteryEvent(event => {
      if(event.kind !== 'wheel') return
      setDrawEvent(event)
      if(event.phase === 'result') { setResult(event.item?.name || ''); toast(`抽中：${event.item?.name || ''}`, 'success') }
      if(event.phase === 'started') setResult('')
      if(event.phase === 'configured' || event.phase === 'closed') setResult('')
      if(event.phase === 'error') toast(event.error || '中奖动作执行失败', 'error')
      if(event.phase === 'closed') setWindowOpen(false)
    })
  }, [toast])

  useEffect(() => {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items))
  }, [items])

  const spin = async () => {
    if (!items.length || items.some(i => !i.name.trim())) return toast('请先填好奖项', 'error')
    const saved = await saveNow()
    if (!saved.ok) return toast(saved.error || '保存奖项失败', 'error')
    const r = await window.api.lotterySpin('wheel')
    if (!r.ok) toast(r.error || '启动抽奖失败', 'error')
    else if (r.queued) toast(`已排队，前面还有 ${r.queued} 轮`, 'info')
  }

  const toggleWindow = async () => {
    if (windowOpen) {
      await window.api.lotteryClose('lucky')
      setWindowOpen(false)
      toast('已关闭转盘窗口', 'info')
    } else {
      // 窗口从没开过：开完套上输入框里的尺寸；本来就在（含待机）：以窗口现在的大小为准，输入框跟着它
      const existed = !!(await window.api.outputWindowSize('幸运转盘').catch(() => null))
      const r = await window.api.lotteryOpen('lucky', items, centerImg || undefined)
      if (r.ok) {
        setWindowOpen(true)
        if (existed) void syncWinSize()
        else void window.api.outputWindowResize('幸运转盘', winSize.w, winSize.h).then(() => syncWinSize())
        toast('转盘窗口已开启', 'success')
      } else toast(r.error ?? '开启失败', 'error')
    }
  }

  const pendingSave = useRef(false)
  useEffect(() => {
    localStorage.setItem(TRIGGER_KEY, JSON.stringify({ autoSpin, triggerGift, skin, centerGift, ...stage }))
    localStorage.setItem('ent-wheel-center', centerImg)
    // 打字的每一击都发一次 IPC 太浪费，攒 350 毫秒再存；状态灯随后显示存上了没有
    pendingSave.current = true
    const timer = setTimeout(() => {
      pendingSave.current = false
      void saveNow().then(r => { if (!r.ok) toast(r.error || '保存抽奖配置失败', 'error') })
    }, 350)
    return () => clearTimeout(timer)
  }, [skin, autoSpin, triggerGift, centerGift, stage, items, centerImg, toast, saveNow])
  // 离开页面时还没攒到 350 毫秒的那次改动也要存：否则改完触发礼物立刻切页，主进程拿到的还是旧礼物名
  useEffect(() => () => { if (pendingSave.current) { pendingSave.current = false; void saveNow() } }, [saveNow])

  const setItem = (i: number, patch: Partial<LotteryItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  // 手动保存：点一下立刻存盘并给确认提示（顶部和动作区各有一个入口）
  const saveAndToast = () => void saveNow().then(r => toast(r.ok ? '已保存' : r.error || '保存失败', r.ok ? 'success' : 'error'))
  // 方案：把这一整套（奖项+动作+上播表现+中心图）存下来/切回来/导出带走
  const presetSnapshot = (): Record<string, unknown> => ({ items, autoSpin, triggerGift, skin, centerGift, stage, centerImg })
  const applyPreset = (config: Record<string, unknown>): void => {
    if (Array.isArray(config.items)) setItems((config.items as LotteryItem[]).map((it) => ({ ...it, name: String(it?.name ?? '') })))
    if (typeof config.autoSpin === 'boolean') setAutoSpin(config.autoSpin)
    if (typeof config.triggerGift === 'string') setTriggerGift(config.triggerGift)
    if (typeof config.skin === 'string') setSkin(normalizeWidgetSkin(config.skin))
    if (typeof config.centerGift === 'boolean') setCenterGift(config.centerGift)
    if (config.stage && typeof config.stage === 'object') setStage(normalizeStageOptions(config.stage as Partial<StageOptions>))
    if (typeof config.centerImg === 'string') setCenterImg(config.centerImg)
  }
  const addItem = () => setItems((prev) => [...prev, { name: '奖项', color: '#409eff' }])
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <div className="space-y-3">
          <LotteryPresets
            storageKey="ent-wheel-plans"
            exportKind="zhiliao-wheel-cfg"
            fileName="幸运转盘设置"
            snapshot={presetSnapshot}
            apply={applyPreset}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[var(--text)]">转盘奖项</span>
            <div className="flex items-center gap-2">
              <LotterySave state={saveState} onSave={saveAndToast} />
              <Btn size="sm" onClick={addItem} disabled={items.length >= 64} title="最多 64 个奖项">
                <Plus size={13} /> 添加
              </Btn>
            </div>
          </div>
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="min-w-0 space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={it.color}
                  onChange={(e) => setItem(i, { color: e.target.value })}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent"
                />
                <Input aria-label={`奖项 ${i + 1} 名称`} value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} className="min-w-0 flex-1" />
                {giftImageOptions.length > 0 && (
                  <Select
                    value={it.img ?? ''}
                    onChange={(e) => setItem(i, { img: e.target.value || undefined })}
                    className="w-20 shrink-0 text-[11px]"
                    title="奖项礼物图（窗口内展示）"
                  >
                    <option value="">无图</option>
                    {giftImageOptions.map((g) => (
                      <option key={`${g.name}\u0000${g.path}`} value={g.path}>{giftImageLabel(g)}</option>
                    ))}
                  </Select>
                )}
                <Btn size="sm" variant="secondary" onClick={() => setEditing(editing === i ? null : i)}>动作</Btn>
                <Btn size="sm" variant="ghost" onClick={() => removeItem(i)}>
                  <Trash2 size={13} />
                </Btn>
              </div>
              {editing === i && (
                <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2">
                  <LotteryActionEditor item={it} onChange={patch => setItem(i, patch)} />
                  <LotterySave state={saveState} onSave={saveAndToast} note="动作改动会自动保存" />
                </div>
              )}
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 pt-1 text-sm text-[var(--text-2)]">
            <Toggle value={autoSpin} onChange={setAutoSpin} />
            收到礼物自动转
          </label>
          {/* 触发礼物常驻显示：藏在开关后面时，开关一旦被方案/误触关掉，这项就跟着消失（0.3.42 用户反馈选不了礼物） */}
          <Field label="触发礼物" hint="留空=任何礼物都转；填了只认这一种。开着「收到礼物自动转」才生效">
            <Input value={triggerGift} onChange={(e) => setTriggerGift(e.target.value)} list="ent-wheel-gift-presets" placeholder="如：火箭" />
            <datalist id="ent-wheel-gift-presets">
              {DOUYIN_GIFT_NAMES.map((n) => <option key={n} value={n} />)}
            </datalist>
          </Field>
          <LotteryStageOptions value={stage} onChange={patchStage} />
          <div className="flex gap-2">
            <Btn onClick={spin} className="flex-1">
              <Play size={14} /> 转起来
            </Btn>
            <Btn variant={windowOpen ? 'secondary' : 'primary'} onClick={toggleWindow} title="打开绿幕转盘窗口">
              <MonitorPlay size={14} /> {windowOpen ? '关闭窗口' : '转盘窗口'}
            </Btn>
          </div>
          <Field advanced label="窗口大小" hint="改了当场生效；拖窗口边框调的也算">
            <div className="flex items-center gap-2">
              <Input type="number" min={260} max={4096} value={winSize.w} aria-label="转盘窗口宽度" onChange={(e) => applyWinSize(Number(e.target.value) || 0, winSize.h)} onBlur={() => void syncWinSize()} />
              <span className="text-xs text-[var(--text-4)]">×</span>
              <Input type="number" min={300} max={4096} value={winSize.h} aria-label="转盘窗口高度" onChange={(e) => applyWinSize(winSize.w, Number(e.target.value) || 0)} onBlur={() => void syncWinSize()} />
            </div>
          </Field>
          <Field advanced label="中心图片（可选）">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[11px] text-[var(--text-4)]">中心图</span>
              <Select value={centerImg} onChange={(e) => setCenterImg(e.target.value)} className="flex-1 text-[11px]">
                <option value="">无（显示"开始"）</option>
                {giftImageOptions.map((g) => (
                  <option key={`${g.name}\u0000${g.path}`} value={g.path}>{giftImageLabel(g)}</option>
                ))}
              </Select>
            </div>
          </Field>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-[var(--text-2)]">中心图跟着触发礼物走</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">谁送礼物转的，中心就换成那个礼物的图；图库里没有或手动转时用固定图。</p>
            </div>
            <Toggle label="中心图跟着触发礼物走" value={centerGift} onChange={setCenterGift} />
          </div>
          {result && (
            <div className="rounded-lg border border-[var(--ok-line)] bg-[var(--ok-soft)] px-3 py-2 text-sm text-[var(--ok)]">
              抽中：{result}
            </div>
          )}
          <p className="text-[11px] leading-4 text-[var(--text-4)]">
            在抖音直播伴侣中采集「幸运转盘」，设置绿色色度键。
          </p>
        </div>
      </Card>
      <Card className="h-fit overflow-hidden" pad={false}>
        <div className="border-b border-[var(--line)] p-4"><SkinPicker label="转盘皮肤" value={skin} onChange={(value) => {
          setSkin(value)
          if(value !== 'classic') {
            const colors = widgetSkin(value)
            setItems((current) => current.map((item, index) => ({...item, color: index % 2 ? colors.surface : colors.accent})))
          }
        }} /></div>
        <div className="p-5"><LotteryPreview items={items} event={drawEvent} centerImg={drawEvent?.center || centerImg} skin={skin} /></div>
        <div className="border-t border-[var(--line)] p-4"><LotteryHistory kind="wheel" event={drawEvent} /></div>
        <p className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--text-4)]">幸运转盘。页面和直播窗口显示同一次抽奖结果。</p>
      </Card>
    </div>
  )
}
