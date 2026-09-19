import InlineEditor from '../components/InlineEditor'
import { MODERN_WIDGET_SKINS, normalizeWidgetSkin } from '@shared/widgetSkins'
import { usePolling } from '../lib/usePolling'
import { useEffect, useMemo, useState } from 'react'
import { Timer, MonitorPlay, Save, RotateCcw, FolderOpen } from 'lucide-react'
import type { ConnectorLogLine, CountChallengeConfig } from '@shared/types'
import { Btn, Card, Field, Input, Select, Segmented, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'
import { PlanBar } from '../components/PlanBar'
import { OVERTIME_LS as LS, defaultOvertimeCfg as defaultCfg, overtimeToChallengeCfg, type OvertimeConfig, type OvertimeGift } from '../lib/overtimeConfig'

// 加班器（复刻参考软件「加班器」插件，逆向 0x4e2965+0x4e32ff）：
// 加班文字/加班初始/归零文字 + 加班礼物1~6×(加班时间前+加班时间后+加减选择)
// + 自定义文字2~6 + 是否自定文字 + 礼物展示/礼物数量2·4·6 + 是否显示秒数·负数
// + 加班挑战样式 + 保存加班/重置时间/打开图片目录
// 类型/默认值/换算在 lib/overtimeConfig.ts（挂件总控也用同一套）

function parseLiveGift(line: ConnectorLogLine): string | null {
  const counted = line.text.match(/(?:^|\s)(?:模拟)?礼物\s*[:：]\s*(.*?)\s*[×x*]\s*\d+(?=\s|$)/)
  if (counted?.[1]) return counted[1].trim()
  const single = line.text.match(/(?:^|\s)(?:模拟)?礼物\s*[:：]\s*(.+?)(?:\s+by\s+.*)?\s*$/)
  return single?.[1]?.trim() || null
}

// 时间插件三页互通导航（倒计时 / 计时·计数挑战 / 加班器）
type TimePluginTarget = 'countdown' | 'challenge' | 'overtime'

export default function EntertainmentOvertime({ onNavigate }: { onNavigate?: (target: TimePluginTarget) => void }) {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<OvertimeConfig>(() => {
    try {
      const c = JSON.parse(localStorage.getItem(LS) || '{}') as Partial<OvertimeConfig>
      return { ...defaultCfg, ...c, gifts: Array.isArray(c.gifts) ? c.gifts : defaultCfg.gifts }
    } catch { return defaultCfg }
  })
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState(cfg.initial)
  const [cachedGifts, setCachedGifts] = useState<string[]>([])
  const [liveGifts, setLiveGifts] = useState<string[]>([])

  useEffect(() => {
    let active = true
    void window.api.entertainmentListGiftImages().then((list) => {
      if (active) setCachedGifts([...new Set(list.map((gift) => gift.name).filter(Boolean))])
    })
    const off = window.api.onConnectorLog((line) => {
      const gift = parseLiveGift(line)
      if (!gift) return
      setLiveGifts((current) => current.includes(gift) ? current : [gift, ...current].slice(0, 120))
    })
    return () => {
      active = false
      off()
    }
  }, [])

  const giftNames = useMemo(() => [...new Set([...liveGifts, ...cachedGifts, ...DOUYIN_GIFT_NAMES])], [cachedGifts, liveGifts])

  usePolling(() => window.api.challengeState('overtime'), (state) => {
    setOpen(state.open)
    if (state.open && typeof state.value === 'number') setLeft(state.value)
  }, 1000)

  // 礼物触发由主进程统一处理。设置页卸载后，已打开的挂件仍然继续接收直播礼物。

  const set = (patch: Partial<OvertimeConfig>) => {
    const next = { ...cfg, ...patch }
    setCfg(next); localStorage.setItem(LS, JSON.stringify(next))
  }
  const setGift = (i: number, patch: Partial<OvertimeGift>) => {
    set({ gifts: cfg.gifts.map((g, idx) => (idx === i ? { ...g, ...patch } : g)) })
  }

  // 加班器复用计数挑战 H5；换算在 lib/overtimeConfig.ts
  const toChallengeCfg = (): CountChallengeConfig => overtimeToChallengeCfg(cfg)

  useEffect(() => {
    if (open) void window.api.challengeUpdate(toChallengeCfg())
  }, [cfg, open])

  const toggle = async () => {
    if (open) {
      await window.api.challengeClose('overtime'); setOpen(false); set({ on: false }); toast('加班器已关闭', 'info')
    } else {
      const r = await window.api.challengeOpen(toChallengeCfg())
      if (!r.ok) { toast(r.error || '打开加班器失败', 'error'); return }
      setOpen(true); set({ on: true }); toast('加班器已开启（我爱加班！礼物触发加减）', 'success')
    }
  }

  const resetTime = async () => {
    setLeft(cfg.initial)
    await window.api.challengeClose('overtime')
    const r = await window.api.challengeOpen(toChallengeCfg())
    if (r.ok) {
      setOpen(true)
      set({ on: true })
      toast('加班时间已重置', 'success')
    }
  }

  const openGiftDir = async () => {
    const list = await window.api.entertainmentListGiftImages()
    if (list.length > 0) {
      const dir = list[0].path.replace(/\\[^\\]+$/, '')
      const r = await window.api.openPath(dir)
      if (!r.ok) toast(r.error || '打开目录失败', 'error')
    } else {
      toast('暂无已下载礼物图', 'info')
    }
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const previewValue = open ? left : cfg.initial
  const previewVal = cfg.showSeconds ? String(previewValue) : `${pad(Math.floor(Math.max(0, previewValue) / 60))}:${pad(Math.max(0, previewValue) % 60)}`

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Segmented
        value="overtime"
        onChange={(target) => { if (target !== 'overtime') onNavigate?.(target as TimePluginTarget) }}
        options={[
          { value: 'countdown', label: '倒计时' },
          { value: 'challenge', label: '计时/计数挑战' },
          { value: 'overtime', label: '加班器' }
        ]}
      />
      <Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Timer size={16} className="text-[var(--accent-2)]" /> 加班器（我爱加班！我要996！）
        </div>
        <PlanBar ns="overtime" current={cfg} onLoad={(v) => set(v)} toast={toast} />
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-[var(--text-3)]">状态：{open ? '已开启（可拖动）' : '已关闭'}</span>
          <div className="flex items-center gap-2">
            <Btn size="sm" variant="secondary" onClick={resetTime}><RotateCcw size={12} /> 重置时间</Btn>
            <Btn size="sm" variant="secondary" onClick={() => { localStorage.setItem(LS, JSON.stringify(cfg)); toast('加班配置已保存', 'success') }}><Save size={12} /> 保存加班</Btn>
            <Btn size="sm" variant="secondary" onClick={openGiftDir}><FolderOpen size={12} /> 打开图片目录</Btn>
            <Btn onClick={toggle} variant={open ? 'secondary' : 'primary'}>
              <MonitorPlay size={14} /> {open ? '关闭' : '开启'}
            </Btn>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2" aria-label="基础配置">
          <Field label="加班文字（标题）"><Input value={cfg.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="加班初始（秒）"><Input type="number" value={cfg.initial} onChange={(e) => set({ initial: Number(e.target.value) || 0 })} /></Field>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
          <div className="mb-2 text-[11px] text-[var(--text-4)]">实时预览（原 H5 内容区 320×300，外框 340×320）</div>
          <div data-widget-skin={normalizeWidgetSkin(cfg.style)} className="challenge-skin-preview widget-preview-stage flex justify-center overflow-hidden py-3">
            <div className="skin-motion-panel rounded-xl" style={{ width: 320, height: 300, padding: 10, boxSizing: 'content-box', backgroundColor: cfg.style === '透明背景' ? 'transparent' : 'rgba(0,0,0,0.7)' }}>
              <div className="flex items-center justify-center text-2xl font-bold text-white" style={{ height: 50, padding: 6, boxSizing: 'content-box', textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>{cfg.title}</div>
              <div className="flex items-center justify-center text-[48px] font-bold text-white" style={{ height: 58, padding: 6, boxSizing: 'content-box', textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>{previewVal}</div>
              <div className="flex items-center justify-center text-[28px] font-bold text-white" style={{ height: 36, padding: 6, boxSizing: 'content-box', textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>{cfg.showRecord ? '±记录' : ''}</div>
              {cfg.giftShow && (
                <div className="flex gap-2.5" style={{ height: 66, padding: 6, boxSizing: 'content-box' }}>
                  {cfg.gifts.slice(0, 2).map((g, i) => (
                    <div key={i} className="flex min-w-0 flex-1 items-center gap-2 p-1.5">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-black/20" />
                      <div className="min-w-0 flex-1 text-[15px] font-bold leading-[1.2]" style={{ textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>
                        <div className="truncate text-white">{g.name}</div>
                        <div className="my-0.5 h-px bg-[#ddd]" />
                        <div className="truncate text-[15px] font-bold text-[#fafafa]">{cfg.useCustomText && g.customText ? g.customText : `${g.mode} ${g.timeBefore}~${g.timeAfter}`}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-center text-[20px] font-bold text-white" style={{ height: 30, padding: 6, boxSizing: 'content-box', textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>{cfg.third}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field advanced label="方案名"><Input value={cfg.plan} onChange={(e) => set({ plan: e.target.value })} /></Field>
          <Field label="加班挑战样式">
            <Select aria-label="加班皮肤" value={cfg.style} onChange={(e) => set({ style: e.target.value })}>
              <option value="蓝黑梯形">蓝黑梯形</option><option value="橙色梯形">橙色梯形</option><option value="粉色萌仔">粉色萌仔</option><option value="透明背景">透明背景</option>
              {MODERN_WIDGET_SKINS.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
            </Select>
          </Field>


          <Field label="归零文字"><Input value={cfg.zeroText} onChange={(e) => set({ zeroText: e.target.value })} /></Field>
          <Field advanced label="第三行文字（面板最下面那行）"><Input value={cfg.third} onChange={(e) => set({ third: e.target.value })} /></Field>
          <Field advanced label="时钟速度(毫秒/次)"><Input type="number" value={cfg.clockSpeed} onChange={(e) => set({ clockSpeed: Math.max(50, Number(e.target.value) || 1000) })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.clockOn} onChange={(v) => set({ clockOn: v })} />加班挑战(走秒)</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.showSeconds} onChange={(v) => set({ showSeconds: v })} />显示秒数</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.showNegative} onChange={(v) => set({ showNegative: v })} />显示负数</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.showRecord} onChange={(v) => set({ showRecord: v })} />显示增减记录</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.giftShow} onChange={(v) => set({ giftShow: v })} />显示礼物</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.useCustomText} onChange={(v) => set({ useCustomText: v })} />是否自定文字</label>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-3)]">礼物触发规则（点击编辑调整时间）</span>
            <Segmented size="sm" value={String(cfg.giftCount)} onChange={(v) => set({ giftCount: Number(v) })} options={[{ value: '2', label: '2个' }, { value: '4', label: '4个' }, { value: '6', label: '6个' }]} />
          </div>
          <div className="space-y-2">
            {cfg.gifts.map((g, i) => (
              <InlineEditor key={i} title={`${i+1}. ${g.name||"未设置礼物"}`} summary={`${g.mode} ${g.timeBefore} ~ ${g.timeAfter}${g.mode==="加减"?" 秒":""}`}><div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-center text-[11px] font-bold text-[var(--text-4)]">{i + 1}</span>
                <Input value={g.name} onChange={(e) => setGift(i, { name: e.target.value })} list="ent-ot-gifts" placeholder="礼物名" className="w-28" />
                <Select value={g.mode} onChange={(e) => setGift(i, { mode: e.target.value as OvertimeGift['mode'] })} className="w-16">
                  <option value="加减">加减</option><option value="乘以">乘以</option><option value="除以">除以</option><option value="范围">范围</option><option value="清零">清零</option>
                </Select>
                <Input type="number" value={g.timeBefore} onChange={(e) => setGift(i, { timeBefore: Number(e.target.value) || 0 })} placeholder="时间前(秒)" className="w-24" />
                <Input type="number" value={g.timeAfter} onChange={(e) => setGift(i, { timeAfter: Number(e.target.value) || 0 })} placeholder="时间后(秒)" className="w-24" />
                {i >= 1 && (
                  <Input value={g.customText} onChange={(e) => setGift(i, { customText: e.target.value })} placeholder="自定义文字" className="w-32" />
                )}
                <span className="w-24 text-right text-[11px] text-[var(--text-4)]">{g.mode} {g.timeBefore}~{g.timeAfter}</span>
              </div></InlineEditor>
            ))}
          </div>
          <datalist id="ent-ot-gifts">{giftNames.map((n) => <option key={n} value={n} />)}</datalist>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field advanced label="位置 X"><Input type="number" value={cfg.posX} onChange={(e) => set({ posX: Number(e.target.value) || 0 })} /></Field>
          <Field advanced label="位置 Y"><Input type="number" value={cfg.posY} onChange={(e) => set({ posY: Number(e.target.value) || 0 })} /></Field>
        </div>
      </Card>
    </div>
  )
}
