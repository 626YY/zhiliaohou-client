import SkinPicker from '../components/SkinPicker'
import LotteryStageOptions, { DEFAULT_STAGE_OPTIONS, normalizeStageOptions, type StageOptions } from '../components/LotteryStageOptions'
import LotterySave, { useLotterySave } from '../components/LotterySave'
import LotteryPresets from '../components/LotteryPresets'
import LotteryHistory from '../components/LotteryHistory'
import { normalizeWidgetSkin, widgetSkin } from '@shared/widgetSkins'
﻿import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, MonitorPlay } from 'lucide-react'
import type { EntertainmentGiftImage, LotteryItem, LotteryEvent } from '@shared/types'
import { Btn, Card, Field, Input, Select, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { giftImageLabel, uniqueGiftImages } from '../utils/giftImages'
import { NINE_ORDER, nineItems } from '@shared/lottery'
import LotteryActionEditor from '../components/LotteryActionEditor'
import { lotteryImageSrc } from '../components/LotteryPreview'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'

const DEFAULT_CELLS = [
  '谢谢参与', '小礼物', '火箭', '大礼物', '转起来', '再来一次', '超级火箭', '盲盒', '谢谢参与'
]
const TRIGGER_KEY = 'ent-nine-trigger'

/** 上播表现（声音 / 空闲显隐）；九宫格没有外圈灯珠，这里不显示跑马灯那项。 */
function readStage(): StageOptions {
  try {
    return normalizeStageOptions(JSON.parse(localStorage.getItem(TRIGGER_KEY) ?? '{}') as Partial<StageOptions>)
  } catch {
    return DEFAULT_STAGE_OPTIONS
  }
}

function readTrigger(): { autoSpin: boolean; triggerGift: string; skin?: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(TRIGGER_KEY) ?? '{}') as Partial<{ autoSpin: boolean; triggerGift: string; skin: string }>
    return { autoSpin: saved.autoSpin === true, triggerGift: String(saved.triggerGift ?? ''), skin: normalizeWidgetSkin(saved.skin) }
  } catch {
    return { autoSpin: false, triggerGift: '' }
  }
}

export default function EntertainmentNineGrid() {
  const toast = useToast((s) => s.toast)
  const timerRef = useRef(0)
  // 奖项和礼物图持久化，挂件总控按这份配置开窗口
  const [cells, setCells] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ent-nine-cells') || 'null')
      return Array.isArray(saved) && saved.length === 9 ? saved.map((c) => String(c ?? '')) : DEFAULT_CELLS
    } catch {
      return DEFAULT_CELLS
    }
  })
  const [cellImgs, setCellImgs] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ent-nine-imgs') || 'null')
      return Array.isArray(saved) && saved.length === 9 ? saved.map((c) => String(c ?? '')) : Array(9).fill('')
    } catch {
      return Array(9).fill('')
    }
  })
  const [actions, setActions] = useState<Partial<LotteryItem>[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem('ent-nine-actions') || '[]'); return Array.isArray(saved) ? saved : [] } catch { return [] }
  })
  const [editing, setEditing] = useState<number | null>(null)
  const items = useMemo(() => nineItems(cells,cellImgs,actions), [cells,cellImgs,actions])
  useEffect(() => {
    localStorage.setItem('ent-nine-cells', JSON.stringify(cells))
    localStorage.setItem('ent-nine-imgs', JSON.stringify(cellImgs))
    localStorage.setItem('ent-nine-actions', JSON.stringify(actions))
  }, [cells, cellImgs, actions])
  const [active, setActive] = useState(-1)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState('')
  const [drawEvent, setDrawEvent] = useState<LotteryEvent>()
  const [skin, setSkin] = useState(() => normalizeWidgetSkin(readTrigger().skin))
  const [autoSpin, setAutoSpin] = useState(() => readTrigger().autoSpin)
  const [triggerGift, setTriggerGift] = useState(() => readTrigger().triggerGift)
  const [stage, setStage] = useState<StageOptions>(() => readStage())
  const patchStage = (patch: Partial<StageOptions>) => setStage((prev) => normalizeStageOptions({ ...prev, ...patch }))
  const [windowOpen, setWindowOpen] = useState(false)
  // 九宫格窗口大小（含铺在里面的奖品视频）：改了当场生效。
  // 以窗口真实大小为准：主播拖边框调过的，输入框跟着显示；重开窗口不会被输入框里的旧值打回去。
  const [winSize, setWinSize] = useState<{ w: number; h: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ent-nine-winsize') || 'null')
      if (saved && Number(saved.w) >= 260 && Number(saved.h) >= 300) return { w: Number(saved.w), h: Number(saved.h) }
    } catch { /* 损坏用默认 */ }
    return { w: 560, h: 620 }
  })
  const syncWinSize = useCallback(async () => {
    const size = await window.api.outputWindowSize('九宫格').catch(() => null)
    if (size) setWinSize({ w: size.width, h: size.height })
  }, [])
  const applyWinSize = (w: number, h: number) => {
    setWinSize({ w, h })
    if (w >= 260 && h >= 300 && w <= 4096 && h <= 4096) {
      localStorage.setItem('ent-nine-winsize', JSON.stringify({ w, h }))
      void window.api.outputWindowResize('九宫格', w, h)
    }
  }
  useEffect(() => { void syncWinSize() }, [syncWinSize])
  const [giftImgs, setGiftImgs] = useState<EntertainmentGiftImage[]>([])
  const giftImageOptions = useMemo(() => uniqueGiftImages(giftImgs), [giftImgs])
  // 保存反馈：改动自动存，状态灯让主播看得见存没存上
  const { state: saveState, run: saveNow } = useLotterySave(() =>
    window.api.lotteryConfigure('nine', { autoSpin, triggerGift, skin, ...stage }, items)
  )

  useEffect(() => {
    window.api.lotteryState().then((s) => setWindowOpen(s.nine))
    window.api.entertainmentListGiftImages().then((list) => setGiftImgs(list))
  }, [])

  const toggleWindow = async () => {
    if (windowOpen) {
      await window.api.lotteryClose('nine')
      setWindowOpen(false)
      toast('已关闭九宫格窗口', 'info')
    } else {
      // 窗口从没开过：开完套上输入框里的尺寸；本来就在（含待机）：以窗口现在的大小为准，输入框跟着它
      const existed = !!(await window.api.outputWindowSize('九宫格').catch(() => null))
      const r = await window.api.lotteryOpen('nine', items)
      if (r.ok) {
        setWindowOpen(true)
        if (existed) void syncWinSize()
        else void window.api.outputWindowResize('九宫格', winSize.w, winSize.h).then(() => syncWinSize())
        toast('九宫格窗口已开启', 'success')
      } else toast(r.error ?? '开启失败', 'error')
    }
  }

  const spin = async () => {
    if (items.some(c => !c.name.trim())) return toast('请先填好 8 个外圈奖项', 'error')
    const saved = await saveNow()
    if (!saved.ok) return toast(saved.error || '保存奖项失败', 'error')
    const r = await window.api.lotterySpin('nine')
    if (!r.ok) toast(r.error || '启动抽奖失败', 'error')
    else if (r.queued) toast(`已排队，前面还有 ${r.queued} 轮`, 'info')
  }

  const pendingSave = useRef(false)
  // 打开旧配置只读取；仅用户实际修改后才写回，避免把新增默认项灌入主播存档。
  const lastTriggerDraft = useRef(JSON.stringify({ autoSpin, triggerGift, skin, ...stage }))
  useEffect(() => {
    const draft = { autoSpin, triggerGift, skin, ...stage }
    const packed = JSON.stringify(draft)
    if (packed !== lastTriggerDraft.current) {
      let previous: Record<string, unknown> = {}
      try { previous = JSON.parse(localStorage.getItem(TRIGGER_KEY) || '{}') } catch { /* 损坏存档由本次修改修复 */ }
      localStorage.setItem(TRIGGER_KEY, JSON.stringify({ ...previous, ...draft }))
      lastTriggerDraft.current = packed
    }
    // 打字的每一击都发一次 IPC 太浪费，攒 350 毫秒再存；状态灯随后显示存上了没有
    pendingSave.current = true
    const timer = setTimeout(() => {
      pendingSave.current = false
      void saveNow().then(r => { if (!r.ok) toast(r.error || '保存抽奖配置失败', 'error') })
    }, 350)
    return () => clearTimeout(timer)
  }, [skin, autoSpin, triggerGift, stage, items, toast, saveNow])
  // 离开页面时还没攒到 350 毫秒的那次改动也要存：否则改完触发礼物立刻切页，主进程拿到的还是旧礼物名
  useEffect(() => () => { if (pendingSave.current) { pendingSave.current = false; void saveNow() } }, [saveNow])
  useEffect(() => {
    const off = window.api.onLotteryEvent(event => {
      if(event.kind !== 'nine')return
      setDrawEvent(event)
      clearInterval(timerRef.current)
      if(event.phase === 'started') {
        setResult(''); setSpinning(true)
        const tick = () => {
          const t=Math.min(1,Math.max(0,(Date.now()-event.startedAt)/event.duration))
          const slot=t===1?event.index:Math.floor((1-Math.pow(1-t,3))*(event.items.length*4+event.index))%event.items.length
          setActive(NINE_ORDER[slot])
        }
        tick();timerRef.current=window.setInterval(tick,40)
      } else {
        setSpinning(false)
        if(event.phase === 'closed')setWindowOpen(false)
        if(event.phase === 'closed' || event.phase === 'configured') { setResult(''); setActive(-1) }
        if(event.index >= 0)setActive(NINE_ORDER[event.index])
        if(event.phase === 'result') { setResult(event.item?.name || ''); toast(`抽中：${event.item?.name || ''}`,'success') }
        if(event.phase === 'error')toast(event.error || '中奖动作执行失败','error')
      }
    })
    return () => { off(); clearInterval(timerRef.current) }
  }, [toast])

  const setCell = (i: number, v: string) =>
    setCells((prev) => prev.map((c, idx) => (idx === i ? v : c)))
  // 方案：九宫格整盘（格子文字+图+动作+上播表现）存下来/切回来/导出带走
  const presetSnapshot = (): Record<string, unknown> => ({ cells, cellImgs, actions, autoSpin, triggerGift, skin, stage })
  const applyPreset = (config: Record<string, unknown>): void => {
    if (Array.isArray(config.cells) && config.cells.length === 9) setCells(config.cells.map((c) => String(c ?? '')))
    if (Array.isArray(config.cellImgs) && config.cellImgs.length === 9) setCellImgs(config.cellImgs.map((c) => String(c ?? '')))
    if (Array.isArray(config.actions)) setActions(config.actions as Partial<LotteryItem>[])
    if (typeof config.autoSpin === 'boolean') setAutoSpin(config.autoSpin)
    if (typeof config.triggerGift === 'string') setTriggerGift(config.triggerGift)
    if (typeof config.skin === 'string') setSkin(normalizeWidgetSkin(config.skin))
    if (config.stage && typeof config.stage === 'object') setStage(normalizeStageOptions(config.stage as Partial<StageOptions>))
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--text)]">九宫格转盘（3×3）</span>
          <LotterySave state={saveState} onSave={() => void saveNow().then(r => toast(r.ok ? '已保存' : r.error || '保存失败', r.ok ? 'success' : 'error'))} />
        </div>
        <div className="mb-4">
          <LotteryPresets
            storageKey="ent-nine-plans"
            exportKind="zhiliao-nine-cfg"
            fileName="九宫格设置"
            snapshot={presetSnapshot}
            apply={applyPreset}
          />
        </div>
        <div className="mb-4"><SkinPicker label="九宫格皮肤" value={skin} onChange={setSkin} /></div>
        <div className="mb-4"><LotteryStageOptions value={stage} onChange={patchStage} showBulbs={false} /></div>
        <div className="mb-4 border-t border-[var(--line)] pt-4"><LotteryHistory kind="nine" event={drawEvent} /></div>
        <div data-widget-skin={skin} className="lottery-nine-board grid grid-cols-3 gap-2">
          {cells.map((c, i) => (
            <div
              key={i}
              className={`lottery-nine-cell relative flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border p-1 text-center text-sm font-medium transition ${
                active === i
                  ? 'scale-105 border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-2)]'
                  : 'border-[var(--line)] bg-[var(--bg-elev)] text-[var(--text-2)]'
              }`}
            >
              {i === 4 ? <Btn onClick={() => spin()} className="lottery-nine-start h-full w-full">{spinning ? '转动中…' : '开始'}</Btn> : spinning && drawEvent ? (
                <>
                  {drawEvent.items[NINE_ORDER.indexOf(i)]?.img && <img src={lotteryImageSrc(drawEvent.items[NINE_ORDER.indexOf(i)].img!)} alt="" className="h-10 w-10 object-contain" />}
                  <span className="break-all">{drawEvent.items[NINE_ORDER.indexOf(i)]?.name}</span>
                </>
              ) : (
                <>
                  {cellImgs[i] && (
                    <img src={lotteryImageSrc(cellImgs[i])} alt="" className="h-10 w-10 object-contain" />
                  )}
                  <Input
                    aria-label={`九宫格奖项 ${i+1}`}
                    value={c}
                    onChange={(e) => setCell(i, e.target.value)}
                    className="bg-transparent text-center text-sm"
                  />
                  {giftImageOptions.length > 0 && (
                    <Select
                      value={cellImgs[i]}
                      onChange={(e) =>
                        setCellImgs((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                      }
                      className="w-full text-[10px]"
                      title="格子礼物图（窗口内 96×96 展示）"
                    >
                      <option value="">无图</option>
                      {giftImageOptions.map((g) => (
                        <option key={`${g.name}\u0000${g.path}`} value={g.path}>{giftImageLabel(g)}</option>
                      ))}
                    </Select>
                  )}
                  <Btn size="sm" variant="ghost" onClick={() => setEditing(editing === i ? null : i)}>动作</Btn>
                </>
              )}
            </div>
          ))}
        </div>
        {editing != null && <div className="mt-3 space-y-2">
          <p className="text-sm text-[var(--text-2)]">{cells[editing]} · 中奖动作</p>
          <LotteryActionEditor item={{...actions[editing],name:cells[editing],color:''}} onChange={patch=>setActions(prev=>{const next=[...prev];next[editing]={...next[editing],...patch};return next})}/>
          <LotterySave state={saveState} onSave={() => void saveNow().then(r => toast(r.ok ? '已保存' : r.error || '保存失败', r.ok ? 'success' : 'error'))} note="动作改动会自动保存" />
        </div>}
        {/* 触发礼物常驻显示：藏在开关后面时，开关一关这项就消失（0.3.42 用户反馈选不了礼物） */}
        <div className="mt-3">
          <Field label="触发礼物" hint="留空=任何礼物都转；填了只认这一种。开着「收到礼物自动转」才生效">
            <Input value={triggerGift} onChange={(e) => setTriggerGift(e.target.value)} list="ent-nine-gift-presets" placeholder="如：火箭" />
            <datalist id="ent-nine-gift-presets">
              {DOUYIN_GIFT_NAMES.map((n) => <option key={n} value={n} />)}
            </datalist>
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
            <Toggle value={autoSpin} onChange={setAutoSpin} />
            收到礼物自动转
          </label>
          <div className="flex gap-2">
            <Btn variant={windowOpen ? 'secondary' : 'primary'} onClick={toggleWindow} title="打开绿幕九宫格窗口">
              <MonitorPlay size={14} /> {windowOpen ? '关闭窗口' : '九宫格窗口'}
            </Btn>
            <Btn onClick={() => spin()}>
              <Play size={14} /> {spinning ? '转动中…' : '转起来'}
            </Btn>
          </div>
        </div>
        <Field advanced label="窗口大小" hint="改了当场生效；拖窗口边框调的也算">
          <div className="flex items-center gap-2">
            <Input type="number" min={260} max={4096} value={winSize.w} aria-label="九宫格窗口宽度" onChange={(e) => applyWinSize(Number(e.target.value) || 0, winSize.h)} onBlur={() => void syncWinSize()} />
            <span className="text-xs text-[var(--text-4)]">×</span>
            <Input type="number" min={300} max={4096} value={winSize.h} aria-label="九宫格窗口高度" onChange={(e) => applyWinSize(winSize.w, Number(e.target.value) || 0)} onBlur={() => void syncWinSize()} />
          </div>
        </Field>
        {result && (
          <div className="mt-3 rounded-lg border border-[var(--ok-line)] bg-[var(--ok-soft)] px-3 py-2 text-sm text-[var(--ok)]">
            抽中：{result}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-4 text-[var(--text-4)]">
          在抖音直播伴侣中采集「九宫格」，设置绿色色度键。中间按钮不参与抽奖，修改奖项在下一轮生效。
        </p>
      </Card>
    </div>
  )
}
