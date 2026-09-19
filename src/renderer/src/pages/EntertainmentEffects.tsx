import { useEffect, useState } from 'react'
import { Sparkles, MonitorPlay, Plus, Trash2, Play } from 'lucide-react'
import type { EffectKind, EffectsConfig } from '@shared/types'
import { Btn, Card, Field, Input, Select, Segmented, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'

const EFFECTS: { value: EffectKind; label: string; desc: string }[] = [
  { value: 'parabola', label: '抛物线飞入', desc: '礼物从角落抛进来，正中央炸开再定格' },
  { value: 'bomb', label: '礼物炸弹', desc: '从天而降砸到中央，白光一闪碎片四散' },
  { value: 'car', label: '礼物小车', desc: '小车载着礼物从右往左开过去，多个礼物叠一摞' },
  { value: 'firework', label: '烟花绽放', desc: '礼物当烟花弹升空炸开，彩色火花里礼物定格' },
  { value: 'rain', label: '天上掉礼物', desc: '按礼物个数一片片往下落，边落边摇摆' }
]

// 试一试用的样例礼物：每种特效配一个有代表性的
const SAMPLE_GIFTS: Record<EffectKind, string> = {
  parabola: '小心心',
  bomb: '火箭',
  car: '跑车',
  firework: '嘉年华',
  rain: '玫瑰'
}

export default function EntertainmentEffects() {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<EffectsConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [testCount, setTestCount] = useState(1)
  const [newGift, setNewGift] = useState('')
  const [newEffect, setNewEffect] = useState<EffectKind>('bomb')

  useEffect(() => {
    window.api.effectsState().then((s) => {
      setCfg(s.config)
      setOpen(s.open)
    })
  }, [])

  // 配置存在主进程：页面只是编辑器，改一项推一项，页面切走照样按新配置播
  const patch = (value: Partial<EffectsConfig>) => {
    if (!cfg) return
    setCfg({ ...cfg, ...value })
    void window.api.effectsConfigure(value)
  }

  const toggleWindow = async () => {
    if (open) {
      await window.api.effectsClose()
      setOpen(false)
      toast('礼物动画窗口已关闭', 'info')
      return
    }
    const r = await window.api.effectsOpen()
    if (!r.ok) return toast(r.error || '打开礼物动画窗口失败', 'error')
    setOpen(true)
    toast(cfg?.background === 'green' ? '礼物动画窗口已开启（绿幕，OBS / 直播伴侣抠像上直播）' : '礼物动画窗口已开启（透明置顶）', 'success')
  }

  const test = async (kind: EffectKind) => {
    if (!open) return toast('先开启礼物动画窗口再试', 'error')
    await window.api.effectsFire(kind, SAMPLE_GIFTS[kind], testCount, '测试观众')
  }

  const addRule = () => {
    if (!cfg) return
    const gift = newGift.trim()
    if (!gift) return toast('先填礼物名', 'error')
    if (cfg.rules.some((r) => r.gift === gift)) return toast('这个礼物已经有规则了', 'error')
    patch({ rules: [...cfg.rules, { gift, effect: newEffect }] })
    setNewGift('')
  }

  if (!cfg) return null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Sparkles size={16} className="text-[var(--accent-2)]" /> 礼物动画窗口
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-3)]">{open ? '已开启' : '已关闭'}</span>
            <Btn onClick={toggleWindow} variant={open ? 'secondary' : 'primary'}>
              <MonitorPlay size={14} /> {open ? '关闭窗口' : '开启窗口'}
            </Btn>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.autoPlay} onChange={(v) => patch({ autoPlay: v })} />
              收到礼物自动播放
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.showText} onChange={(v) => patch({ showText: v })} />
              显示「谁送出了什么」
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="默认特效" hint="没单独指定的礼物都用这种">
              <Select value={cfg.defaultEffect} onChange={(e) => patch({ defaultEffect: e.target.value as EffectKind | 'none' })}>
                {EFFECTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                <option value="none">不播放（只播下面指定的礼物）</option>
              </Select>
            </Field>
            <Field label="最低钻石价" hint="只给这个价以上的礼物播动画；0=全部都播">
              <Input type="number" min={0} value={cfg.minDiamond} onChange={(e) => patch({ minDiamond: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field advanced label="礼物图大小">
              <Input type="number" min={16} max={400} value={cfg.imageSize} onChange={(e) => patch({ imageSize: Number(e.target.value) || 60 })} />
            </Field>
            <Field advanced label="动画速度" hint="1=正常，2=两倍快">
              <Input type="number" min={0.25} max={4} step={0.25} value={cfg.speed} onChange={(e) => patch({ speed: Number(e.target.value) || 1 })} />
            </Field>
            <Field advanced label="单次出图上限" hint="掉落/炸弹按礼物个数出图，超过就到此为止">
              <Input type="number" min={1} max={500} value={cfg.countCap} onChange={(e) => patch({ countCap: Number(e.target.value) || 30 })} />
            </Field>
            <Field label="窗口背景">
              <Segmented
                size="sm"
                value={cfg.background}
                onChange={(v) => patch({ background: v })}
                options={[{ value: 'green', label: '绿幕' }, { value: 'transparent', label: '透明' }]}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field advanced label="窗口宽度">
              <Input type="number" min={200} value={cfg.width} onChange={(e) => patch({ width: Number(e.target.value) || 540 })} />
            </Field>
            <Field advanced label="窗口高度">
              <Input type="number" min={200} value={cfg.height} onChange={(e) => patch({ height: Number(e.target.value) || 800 })} />
            </Field>
            <Field advanced label="连击判定（秒）" hint="同一人几秒内连送同一礼物叠出「×N 连击」；0=不显示">
              <Input type="number" min={0} step={0.5} value={cfg.comboSeconds} onChange={(e) => patch({ comboSeconds: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-2 text-sm font-semibold text-[var(--text)]">指定礼物用哪种特效</div>
        <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
          没在这里的礼物走上面的默认特效。同一个礼物送多个时，炸弹碎片、掉落数量会跟着涨。
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="礼物名" className="min-w-[160px] flex-1">
            <Input value={newGift} onChange={(e) => setNewGift(e.target.value)} list="ent-effects-gifts" placeholder="如：火箭" onKeyDown={(e) => e.key === 'Enter' && addRule()} />
            <datalist id="ent-effects-gifts">
              {DOUYIN_GIFT_NAMES.map((n) => <option key={n} value={n} />)}
            </datalist>
          </Field>
          <Field label="特效" className="w-40">
            <Select value={newEffect} onChange={(e) => setNewEffect(e.target.value as EffectKind)}>
              {EFFECTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </Select>
          </Field>
          <Btn onClick={addRule}><Plus size={14} /> 添加</Btn>
        </div>
        {cfg.rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--line-strong)] p-4 text-center text-xs text-[var(--text-4)]">
            暂无指定规则，所有礼物都用默认特效
          </div>
        ) : (
          <div className="space-y-1.5">
            {cfg.rules.map((rule, index) => (
              <div key={rule.gift} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{rule.gift}</span>
                <Select
                  value={rule.effect}
                  onChange={(e) => patch({ rules: cfg.rules.map((r, i) => i === index ? { ...r, effect: e.target.value as EffectKind } : r) })}
                  className="w-40 text-xs"
                >
                  {EFFECTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                </Select>
                <Btn size="sm" variant="ghost" onClick={() => patch({ rules: cfg.rules.filter((_, i) => i !== index) })} title="删除">
                  <Trash2 size={14} />
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[var(--text)]">试一试</div>
          <Field label="模拟礼物个数" className="w-40">
            <Select value={testCount} onChange={(e) => setTestCount(Number(e.target.value))}>
              {[1, 5, 10, 30, 99].map((n) => <option key={n} value={n}>{n} 个</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EFFECTS.map((e) => (
            <button
              key={e.value}
              onClick={() => test(e.value)}
              className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-left transition hover:border-[var(--accent)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-2)]"><Play size={14} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--text)]">{e.label}</span>
                <span className="block truncate text-[11px] text-[var(--text-4)]">{e.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-4 text-[var(--text-4)]">
          绿幕模式在 OBS / 直播伴侣里添加窗口捕获并开色度键；透明模式直接盖在游戏画面上（要压在全屏游戏上面，开「滤镜设置」页的「输出窗口总在最前」）。窗口尺寸、背景改动会立即应用。
        </p>
      </Card>
    </div>
  )
}
