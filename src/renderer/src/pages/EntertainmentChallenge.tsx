import InlineEditor from '../components/InlineEditor'
import AdvancedSection from '../components/AdvancedSection'
import { MODERN_WIDGET_SKINS, normalizeWidgetSkin } from '@shared/widgetSkins'
import { usePolling } from '../lib/usePolling'
import { useEffect, useMemo, useState } from 'react'
import { Clock, MonitorPlay, FolderOpen, Save } from 'lucide-react'
import type { ConnectorLogLine, CountChallengeConfig } from '@shared/types'
import { Btn, Card, Field, Input, Select, Segmented, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'
import { PlanBar } from '../components/PlanBar'
import { COUNTDOWN_ART } from '../../../shared/countdownArt'
import {CHALLENGE_MODE_KEY} from '../lib/widgetLaunchers'

// 原版分别保存“插件配置计时”和“插件配置计数”。保留旧键只做一次兼容读取。
const LEGACY_LS = 'ent_challenge_cfg'
const TIMER_LS = 'ent_challenge_timer_cfg'
const COUNTER_LS = 'ent_challenge_counter_cfg'

const defaultCfg: CountChallengeConfig = {
  mode: 'timer',
  on: false,
  title: '挑战',
  initial: 60,
  zeroText: '挑战失败',
  clockSpeed: 1000,
  clockOn: true,
  countColor: 0,
  third: '',
  pauseText: '暂停',
  gifts: [
    { name: '头号神枪手', delta: '+5', img: '', op: '加减', before: -1000, after: 1000, text: '盲盒' },
    { name: '苟住', delta: '-5', img: '', op: '加减', before: 100, after: 300, text: '盲盒' },
    { name: '爱的纸鹤', delta: '+50', img: '', op: '加减', before: 200, after: 2000, text: '盲盒' },
    { name: '比心兔兔', delta: '-50', img: '', op: '加减', before: -500, after: 500, text: '盲盒' },
    { name: '礼花筒', delta: '+200', img: '', op: '加减', before: -600, after: 600, text: '盲盒' },
    { name: '捏捏小脸', delta: '-200', img: '', op: '加减', before: -1000, after: 6000, text: '盲盒' }
  ],
  giftShow: true,
  giftCount: 2,
  showLock: true,
  showNegative: false,
  showSeconds: true,
  zeroHide: false,
  pauseAdjust: false,
  pauseGift: '',
  pauseTime: 0,
  hotkeys: [
    { enabled: false, func: '无', key: '', value: 1 },
    { enabled: false, func: '无', key: '', value: -1 },
    { enabled: false, func: '无', key: '', value: 0 },
    { enabled: false, func: '无', key: '', value: 0 }
  ],
  mouseValue: 0,
  mouseEnabled: false,
  mouseAction: '左键单击',
  autoSpeed: 1,
  autoToggleHotkey: '无',
  bgColor: '#000000',
  bgAlpha: 0.7,
  bgTransparent: false,
  posX: 500,
  posY: 30
}

// 原版颜色表（逆向 0x475830，8 色，顺序即下拉顺序）
const COLORS = ['白色', '天蓝', '橙黄', '黄色', '红色', '绿色', '黑色', '蓝色']
const COLOR_HEX = ['#ffffff', '#4fc3f7', '#2196f3', '#ffa726', '#f44336', '#000000', '#d2691e']
const HOTKEY_FUNCS = ['无', 'Alt', 'Ctrl', 'Ctrl+Alt', 'Shift']
const AUTO_SPEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

function parseDelta(delta: string): number {
  const n = Number(String(delta || '').replace(/[＋+]/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function parseLiveGift(line: ConnectorLogLine): string | null {
  const counted = line.text.match(/(?:^|\s)(?:模拟)?礼物\s*[:：]\s*(.*?)\s*[×x*]\s*\d+(?=\s|$)/)
  if (counted?.[1]) return counted[1].trim()
  const single = line.text.match(/(?:^|\s)(?:模拟)?礼物\s*[:：]\s*(.+?)(?:\s+by\s+.*)?\s*$/)
  return single?.[1]?.trim() || null
}

// 原始“计数(28)”组的可见默认值：六礼物与数字、自动数字 -5、鼠标数字 -1、四组热键数值。
const counterDefault: CountChallengeConfig = {
  ...defaultCfg,
  mode: 'counter',
  title: '计数挑战',
  initial: 0,
  clockOn: false,
  gifts: [
    { name: '头号神枪手', delta: '+5', img: '' },
    { name: '苟住', delta: '-5', img: '' },
    { name: '爱的纸鹤', delta: '+50', img: '' },
    { name: '比心兔兔', delta: '-50', img: '' },
    { name: '礼花筒', delta: '+200', img: '' },
    { name: '捏捏小脸', delta: '-200', img: '' }
  ],
  hotkeys: [
    { enabled: false, func: '无', key: '', value: 100 },
    { enabled: false, func: '无', key: '', value: -100 },
    { enabled: false, func: '无', key: '', value: 500 },
    { enabled: false, func: '无', key: '', value: -500 }
  ],
  mouseValue: -1,
  autoValue: -5
}

function loadConfig(key: string, mode: 'timer' | 'counter'): CountChallengeConfig | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as Partial<CountChallengeConfig> | null
    if (!saved) return null
    const base = mode === 'counter' ? counterDefault : defaultCfg
    return { ...base, ...saved, mode, gifts: Array.isArray(saved.gifts) ? saved.gifts : base.gifts, hotkeys: Array.isArray(saved.hotkeys) ? saved.hotkeys : base.hotkeys }
  } catch {
    return null
  }
}

// 时间插件三页互通导航（倒计时 / 计时·计数挑战 / 加班器）
type TimePluginTarget = 'countdown' | 'challenge' | 'overtime'

export default function EntertainmentChallenge({ onNavigate }: { onNavigate?: (target: TimePluginTarget) => void }) {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<CountChallengeConfig>(() => {
    const timer = loadConfig(TIMER_LS, 'timer')
    const counter = loadConfig(COUNTER_LS, 'counter')
    if (timer || counter) return localStorage.getItem(CHALLENGE_MODE_KEY)==='counter'?(counter||counterDefault):(timer||counter||defaultCfg)
    const legacy = loadConfig(LEGACY_LS, 'timer')
    if (!legacy) return defaultCfg
    const mode: 'timer' | 'counter' = legacy.mode === 'counter' ? 'counter' : 'timer'
    const migrated = { ...legacy, mode }
    localStorage.setItem(mode === 'counter' ? COUNTER_LS : TIMER_LS, JSON.stringify(migrated))
    return migrated
  })
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState(cfg.initial)
  const [localImgs, setLocalImgs] = useState<Record<string, string>>({})
  const [liveGifts, setLiveGifts] = useState<string[]>([])

  useEffect(() => {
    window.api.entertainmentListGiftImages().then((list) => {
      const m: Record<string, string> = {}
      for (const g of list) if (!m[g.name]) m[g.name] = g.path
      setLocalImgs(m)
    })
  }, [])

  useEffect(() => window.api.onConnectorLog((line) => {
    const gift = parseLiveGift(line)
    if (!gift) return
    setLiveGifts((current) => current.includes(gift) ? current : [gift, ...current].slice(0, 120))
  }), [])

  const giftNames = useMemo(() => {
    const names = new Set<string>()
    liveGifts.forEach((name) => names.add(name))
    Object.keys(localImgs).forEach((name) => names.add(name))
    DOUYIN_GIFT_NAMES.forEach((name) => names.add(name))
    return [...names]
  }, [liveGifts, localImgs])

  usePolling(() => window.api.challengeState('challenge'), (state) => {
    setOpen(state.open)
    if (state.open && typeof state.value === 'number') setLeft(state.value)
  }, 1000)

  // 礼物触发由主进程统一处理。设置页卸载后，已打开的挂件仍然继续接收直播礼物。

  // 打开已下载礼物图目录（原版：按钮_计数挑战_打开图片目录）
  const openGiftDir = async () => {
    const list = await window.api.entertainmentListGiftImages()
    if (!list.length) return toast('暂无已下载礼物图', 'info')
    const dir = list[0].path.replace(/[\\/][^\\/]+$/, '')   // 去掉最后一段文件名（反斜杠曾被工具吞掉，正则永不匹配，打开的是单张图）
    const r = await window.api.openPath(dir)
    if (!r.ok) toast(r.error || '打开目录失败', 'error')
  }

  const set = (patch: Partial<CountChallengeConfig>) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    localStorage.setItem(next.mode === 'counter' ? COUNTER_LS : TIMER_LS, JSON.stringify(next))
    localStorage.setItem(CHALLENGE_MODE_KEY,next.mode||'timer')
  }

  useEffect(() => {
    if (open) void window.api.challengeUpdate({ ...cfg, slot: 'challenge' })
  }, [cfg, open])
  const switchMode = (mode: 'timer' | 'counter') => {
    if (mode === cfg.mode) return
    const next = loadConfig(mode === 'counter' ? COUNTER_LS : TIMER_LS, mode) || { ...(mode === 'counter' ? counterDefault : defaultCfg) }
    setCfg(next)
    setLeft(next.initial)
    localStorage.setItem(next.mode==='counter'?COUNTER_LS:TIMER_LS,JSON.stringify(next))
    localStorage.setItem(CHALLENGE_MODE_KEY,next.mode||'timer')
  }
  const setGift = (i: number, patch: Partial<CountChallengeConfig['gifts'][number]>) => {
    const gifts = cfg.gifts.map((g, idx) => (idx === i ? { ...g, ...patch } : g))
    set({ gifts })
  }
  const setHotkey = (i: number, patch: Partial<{ enabled: boolean; func: string; key: string; value: number }>) => {
    const hotkeys = cfg.hotkeys.map((h, idx) => (idx === i ? { ...h, ...patch } : h))
    set({ hotkeys })
  }
  const pickGiftImg = async (i: number) => {
    const res = await window.api.selectFile({
      title: '选择礼物图',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile']
    })
    if (res.ok && res.path) setGift(i, { img: res.path })
  }
  const toggle = async () => {
    if (open) {
      await window.api.challengeClose('challenge')
      setOpen(false)
      set({ on: false })
      toast('计数挑战已关闭', 'info')
    } else {
      const r = await window.api.challengeOpen({ ...cfg, slot: 'challenge' })
      if (!r.ok) { toast(r.error || '打开计数挑战失败', 'error'); return }
      setOpen(true)
      set({ on: true })
      toast('计数挑战已开启（礼物触发加减，OBS / 直播伴侣捕获叠加）', 'success')
    }
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const timerMode = cfg.mode !== 'counter'
  const previewValue = open ? left : cfg.initial
  const previewVal = !timerMode || cfg.showSeconds ? String(previewValue) : `${pad(Math.floor(Math.max(0, previewValue) / 60))}:${pad(Math.max(0, previewValue) % 60)}`
  const previewColor = (index: number | undefined) => COLOR_HEX[index ?? cfg.countColor] ?? '#ffffff'
  const timerGiftText = (gift: CountChallengeConfig['gifts'][number]) => {
    if (gift.text) return gift.text
    if (gift.before != null || gift.after != null) {
      const op = gift.op === '加' || gift.op === '减' ? '加减' : gift.op || '加减'
      return `${op} ${Number(gift.before) || 0}~${Number(gift.after) || 0}`
    }
    return gift.delta
  }
  // 挑战样式底图（与挂件同一套：蓝黑梯形/橙色梯形/粉色萌仔）
  const styleArt = cfg.style === '蓝黑梯形' ? COUNTDOWN_ART.mode1_cyan
    : cfg.style === '橙色梯形' ? COUNTDOWN_ART.mode1_orange
    : cfg.style === '粉色萌仔' ? COUNTDOWN_ART.mode2_frame : ''
  const bgRgb = (() => {
    const h = String(cfg.bgColor || '#000000').replace('#', '')
    const n = Number.parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
    return Number.isFinite(n) ? `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}` : '0,0,0'
  })()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Segmented
        value="challenge"
        onChange={(target) => { if (target !== 'challenge') onNavigate?.(target as TimePluginTarget) }}
        options={[
          { value: 'countdown', label: '倒计时' },
          { value: 'challenge', label: '计时/计数挑战' },
          { value: 'overtime', label: '加班器' }
        ]}
      />
      <Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Clock size={16} className="text-[var(--accent-2)]" /> 计数与计时挑战
        </div>
        <PlanBar ns="challenge" current={cfg} onLoad={(v) => set(v)} toast={toast} />
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-[var(--text-3)]">状态：{open ? '已开启（可拖动）' : '已关闭'}</span>
          <div className="flex items-center gap-2">
            <Btn size="sm" variant="secondary" onClick={() => { localStorage.setItem(cfg.mode === 'counter' ? COUNTER_LS : TIMER_LS, JSON.stringify(cfg)); toast('计数配置已保存', 'success') }}><Save size={12} /> 保存计数</Btn>
            <Btn size="sm" variant="secondary" onClick={openGiftDir}><FolderOpen size={12} /> 打开图片目录</Btn>
            <Btn onClick={toggle} variant={open ? 'secondary' : 'primary'}>
              <MonitorPlay size={14} /> {open ? '关闭' : '开启'}
            </Btn>
          </div>
        </div>

        <div className="mb-4">
          <Segmented
            value={timerMode ? 'timer' : 'counter'}
            onChange={(mode) => switchMode(mode as 'timer' | 'counter')}
            options={[{ value: 'timer', label: '计时设置' }, { value: 'counter', label: '计数设置' }]}
          />
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2" aria-label="基础配置">
          <Field label={timerMode ? '标题' : '标题'}><Input value={cfg.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label={timerMode ? '初始时间（秒）' : '初始数字'}><Input type="number" value={cfg.initial} onChange={(e) => set({ initial: Number(e.target.value) || 0 })} /></Field>
        </div>

        {/* 实时预览：320×300 H5 面板 */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
          <div className="mb-2 text-[11px] text-[var(--text-4)]">效果预览</div>
          <div data-widget-skin={normalizeWidgetSkin(cfg.style)} className="challenge-skin-preview widget-preview-stage flex justify-center overflow-hidden py-3">
            <div className="skin-motion-panel shrink-0" style={{ width: 320, height: 300, padding: 10, boxSizing: 'content-box', borderRadius: 12, backgroundColor: styleArt || cfg.bgTransparent ? 'transparent' : `rgba(${bgRgb},${cfg.bgAlpha})`, backgroundImage: styleArt ? `url(${styleArt})` : undefined, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' }}>
              <div className="flex items-center justify-center text-[24px] font-bold" style={{ height: 50, padding: 6, boxSizing: 'content-box', color: previewColor(timerMode ? cfg.countColor : cfg.titleColor), textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>{cfg.title}</div>
              <div className="relative flex items-center justify-center text-[48px] font-bold" style={{ height: 58, padding: 6, boxSizing: 'content-box', color: previewColor(timerMode ? cfg.countColor : cfg.numColor), textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>
                {previewVal}
                {cfg.showLock && <span className="absolute right-2 top-1.5 text-[16px] opacity-90" aria-hidden="true">🔒</span>}
              </div>
              <div className="flex items-center justify-center text-[28px] font-bold text-white" style={{ height: 36, padding: 6, boxSizing: 'content-box', textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>{cfg.pauseText}</div>
              {cfg.giftShow && (
                <div className="flex gap-2.5" style={{ height: 66, padding: 6, boxSizing: 'content-box' }}>
                  {[0, 1].map((i) => {
                    const g = cfg.gifts[i] || { name: '', delta: '', img: '' }
                    let gsrc = g.img ? (/^https?:\/\//i.test(g.img) ? g.img : 'file:///' + g.img.replace(/\\/g, '/')) : ''
                    if (!gsrc && g.name && localImgs[g.name]) gsrc = 'file:///' + localImgs[g.name].replace(/\\/g, '/')
                    return (
                      <div key={i} className="flex min-w-0 flex-1 items-center gap-2" style={{ padding: 5 }}>
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-black/20">
                          {gsrc ? <img src={gsrc} alt="" className="h-12 w-12 object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1 text-[15px] font-bold leading-[1.2]" style={{ textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>
                        <div className="truncate" style={{ color: previewColor(timerMode ? cfg.countColor : cfg.giftNameColor) }}>{g.name}</div>
                        <div className="my-0.5 h-px bg-[#ddd]" />
                        <div className="truncate text-[15px] font-bold" style={{ color: previewColor(timerMode ? cfg.countColor : cfg.deltaColor) }}>{timerMode ? timerGiftText(g) : g.delta}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex items-center justify-center text-[20px] font-bold" style={{ height: 30, padding: 6, boxSizing: 'content-box', color: previewColor(timerMode ? cfg.countColor : cfg.titleColor), textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000' }}>{cfg.third}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">


          {timerMode && <><Field label="归零文字"><Input value={cfg.zeroText} onChange={(e) => set({ zeroText: e.target.value })} /></Field><Field advanced label="时钟速度(毫秒/次)"><Input type="number" value={cfg.clockSpeed} onChange={(e) => set({ clockSpeed: Math.max(50, Number(e.target.value) || 1000) })} /></Field></>}
          <Field advanced label="第三行文字"><Input value={cfg.third} onChange={(e) => set({ third: e.target.value })} /></Field>
          <Field advanced label="暂停文字"><Input value={cfg.pauseText} onChange={(e) => set({ pauseText: e.target.value })} /></Field>
          {!timerMode && <AdvancedSection title="文字与数字配色"><div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
            <div className="mb-1.5 text-xs font-medium text-[var(--text-3)]">文字与数字配色</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['titleColor', '文字颜色（标题/第三行）'],
                ['numColor', '数字颜色（大数字）'],
                ['giftNameColor', '礼物名称颜色'],
                ['deltaColor', '加减数字颜色']
              ] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Select
                    value={String(cfg[key] ?? cfg.countColor)}
                    onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<CountChallengeConfig>)}
                  >
                    {COLORS.map((c, i) => (
                      <option key={i} value={String(i)}>{c}</option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </div></AdvancedSection>}

          {!timerMode && <AdvancedSection title="自动加减"><div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-3)]">每隔一段时间自动加减</span>
              <Toggle value={!!cfg.autoAdjust} onChange={(v) => set({ autoAdjust: v })} />
            </div>
            {cfg.autoAdjust && (
              <div className="grid grid-cols-2 gap-2">
                <Field advanced label="自动加减速度">
                  <Select value={String(cfg.autoSpeed ?? 1)} onChange={(e) => set({ autoSpeed: Number(e.target.value) })}>{AUTO_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed === 1 ? '正常' : `X${speed}`}</option>)}</Select>
                </Field>
                <Field advanced label="自动数字（每次 ±N）">
                  <Input type="number" value={cfg.autoValue ?? 0} onChange={(e) => set({ autoValue: Number(e.target.value) || 0 })} />
                </Field>
              </div>
            )}
          </div></AdvancedSection>}

          {!timerMode && <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5"><Field advanced label="自动加减启停热键"><Select value={cfg.autoToggleHotkey ?? '无'} onChange={(e) => set({ autoToggleHotkey: e.target.value })}><option value="无">无</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={`F${i + 1}`}>F{i + 1}</option>)}</Select></Field></div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.clockOn} onChange={(v) => set({ clockOn: v })} />时钟开启</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.showSeconds} onChange={(v) => set({ showSeconds: v })} />显示秒数</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.showNegative} onChange={(v) => set({ showNegative: v })} />显示负数</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.zeroHide} onChange={(v) => set({ zeroHide: v })} />归零隐藏</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.showLock} onChange={(v) => set({ showLock: v })} />锁图标</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.pauseAdjust} onChange={(v) => set({ pauseAdjust: v })} />暂停加减</label>
          </div>
          {!timerMode && <div className="grid grid-cols-2 gap-3"><label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={!!cfg.mouseEnabled} onChange={(v) => set({ mouseEnabled: v })} />鼠标加减</label><Field advanced label="鼠标数字"><Input type="number" value={cfg.mouseValue} onChange={(e) => set({ mouseValue: Number(e.target.value) || 0 })} /></Field></div>}
          <Field label="计数挑战样式">
            <Select aria-label="挑战皮肤" value={cfg.style || ''} onChange={(e) => set({ style: e.target.value })}>
              <option value="">默认（纯色背景）</option>
              <option value="蓝黑梯形">蓝黑梯形</option>
              <option value="橙色梯形">橙色梯形</option>
              <option value="粉色萌仔">粉色萌仔</option>
              <option value="透明背景">透明背景</option>
              {MODERN_WIDGET_SKINS.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
            </Select>
          </Field>
          <Field advanced label="背景颜色">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.bgColor || '#000000'} onChange={(e) => set({ bgColor: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-[var(--line)] bg-transparent" />
              <Input value={cfg.bgColor || '#000000'} onChange={(e) => set({ bgColor: e.target.value })} className="flex-1 text-xs" />
            </div>
          </Field>
          <Field label="去掉背景（透明）">
            <Toggle value={!!cfg.bgTransparent} onChange={(v) => set({ bgTransparent: v })} />
          </Field>
          <Field advanced label="背景透明度">
            <input type="range" min={0} max={100} value={Math.round(cfg.bgAlpha * 100)} onChange={(e) => set({ bgAlpha: Number(e.target.value) / 100 })} className="w-full accent-[var(--accent)]" />
          </Field>
        </div>

        <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-3)]">计数礼物 1~6（礼物 → 增减数值）</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)]"><Toggle value={cfg.giftShow} onChange={(v) => set({ giftShow: v })} />礼物展示</label>
              <Segmented size="sm" value={String(cfg.giftCount)} onChange={(v) => set({ giftCount: Number(v) })} options={[{ value: '2', label: '2个' }, { value: '4', label: '4个' }, { value: '6', label: '6个' }]} />
            </div>
          </div>
          <div className="space-y-2">
            {cfg.gifts.map((g, i) => {
              const range = `${Number(g.before) || 0} ~ ${Number(g.after) || 0}`
              return (
                <InlineEditor key={i} title={`${i+1}. ${g.name||"未设置礼物"}`} summary={timerMode?timerGiftText(g):`每个礼物 ${g.delta||0}`}><div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-5 text-center text-[11px] font-bold text-[var(--text-4)]">{i + 1}</span>
                  <Input value={g.name} onChange={(e) => setGift(i, { name: e.target.value })} list="ent-chal-gifts" placeholder="礼物名" className="w-28" />
                  {timerMode ? <><Select value={g.op === '加' || g.op === '减' ? '加减' : g.op ?? '加减'} onChange={(e) => setGift(i, { op: e.target.value as '加减' | '乘以' | '除以' | '范围' | '清零' })} className="w-16" title="运算方式"><option value="加减">加减</option><option value="乘以">乘以</option><option value="除以">除以</option><option value="范围">范围</option><option value="清零">清零</option></Select><Input type="number" value={g.before ?? 0} onChange={(e) => setGift(i, { before: Number(e.target.value) || 0 })} placeholder="区间前" title="区间起点" className="w-16" /><Input type="number" value={g.after ?? 0} onChange={(e) => setGift(i, { after: Number(e.target.value) || 0 })} placeholder="区间后" title="区间终点" className="w-16" /><Input value={g.text ?? ''} onChange={(e) => setGift(i, { text: e.target.value })} placeholder="自定义文字" title="留空自动生成" className="w-24" /></> : <Input type="number" value={g.delta} onChange={(e) => setGift(i, { delta: e.target.value })} placeholder="数字（如 +5）" title="加减多少，可填负数" className="w-28" />}
                  <Btn size="sm" variant="secondary" onClick={() => pickGiftImg(i)} title={g.img || '选择礼物图'}><FolderOpen size={12} /> 图</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => timerMode ? window.api.challengeApplyGift(g.op ?? '加减', Number(g.before) || 0, Number(g.after) || 0) : window.api.challengeAdjust(parseDelta(g.delta))}>测试</Btn>
                  <span className="tnum text-[10px] text-[var(--text-4)]">{timerMode ? `${g.op === '加' || g.op === '减' ? '加减' : g.op ?? '加减'}：${range}` : g.delta ? `数值 ${g.delta}` : ''}</span>
                </div></InlineEditor>
              )
            })}
          </div>
          <datalist id="ent-chal-gifts">{giftNames.map((n) => <option key={n} value={n} />)}</datalist>
        </div>

        {cfg.pauseAdjust && (
          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
            <div className="mb-2 text-xs font-medium text-[var(--text-3)]">暂停加减</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="暂停礼物"><Input value={cfg.pauseGift} onChange={(e) => set({ pauseGift: e.target.value })} list="ent-chal-gifts" /></Field>
              <Field label="暂停时间(秒)"><Input type="number" value={cfg.pauseTime} onChange={(e) => set({ pauseTime: Number(e.target.value) || 0 })} /></Field>
            </div>
          </div>
        )}

        <AdvancedSection title="快捷键"><div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <div className="mb-2 text-xs font-medium text-[var(--text-3)]">热键 1~4</div>
          <div className="space-y-2">
            {cfg.hotkeys.map((h, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-card)] px-2 py-1.5">
                <span className="w-10 text-[11px] font-bold text-[var(--text-4)]">热键{i + 1}</span>
                <Toggle value={h.enabled} onChange={(v) => setHotkey(i, { enabled: v })} />
                <Select value={h.func} onChange={(e) => setHotkey(i, { func: e.target.value })} className="w-20">{HOTKEY_FUNCS.map((f) => <option key={f} value={f}>{f}</option>)}</Select>
                <Input value={h.key} onChange={(e) => setHotkey(i, { key: e.target.value })} placeholder="主键" className="w-16" />
                <Input type="number" value={h.value} onChange={(e) => setHotkey(i, { value: Number(e.target.value) || 0 })} placeholder="数值" className="w-20" />
              </div>
            ))}
          </div>
        </div></AdvancedSection>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field advanced label="位置 X"><Input type="number" value={cfg.posX} onChange={(e) => set({ posX: Number(e.target.value) || 0 })} /></Field>
          <Field advanced label="位置 Y"><Input type="number" value={cfg.posY} onChange={(e) => set({ posY: Number(e.target.value) || 0 })} /></Field>
        </div>
      </Card>
    </div>
  )
}
