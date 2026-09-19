import { MODERN_WIDGET_SKINS, widgetSkin } from '@shared/widgetSkins'
import { useEffect, useState } from 'react'
import { MessageSquare, MonitorPlay, Play } from 'lucide-react'
import type { MarqueeConfig, MarqueePosition, MarqueeStyle } from '@shared/types'
import { Btn, Card, Field, Input, Segmented, Select, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'

// 老版本把筛选存在页面 localStorage；升级后第一次打开并进主进程配置
const LEGACY_KEY = 'ent_marquee_cfg'

export default function EntertainmentMarquee() {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<MarqueeConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [giftListText, setGiftListText] = useState('')

  useEffect(() => {
    let alive = true
    const boot = async () => {
      let state = await window.api.marqueeState()
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null') as Partial<MarqueeConfig> | null
        if (legacy && typeof legacy === 'object') {
          await window.api.marqueeConfigure({ giftOn: legacy.giftOn, chatOn: legacy.chatOn, gifts: Array.isArray(legacy.gifts) ? legacy.gifts : undefined, chatKeywords: legacy.chatKeywords })
          localStorage.removeItem(LEGACY_KEY)
          state = await window.api.marqueeState()
        }
      } catch {
        /* ignore */
      }
      if (!alive) return
      setCfg(state.config)
      setOpen(state.open)
      setGiftListText(state.config.gifts.join(', '))
    }
    void boot()
    return () => {
      alive = false
    }
  }, [])

  if (!cfg) return null

  // 配置存主进程：改一项推一项，窗口开着立即生效（位置/尺寸也会跟着挪）
  const patch = (value: Partial<MarqueeConfig>) => {
    setCfg({ ...cfg, ...value })
    void window.api.marqueeConfigure(value)
  }

  const toggle = async () => {
    if (open) {
      await window.api.marqueeClose()
      setOpen(false)
      toast('飘屏已关闭', 'info')
      return
    }
    const r = await window.api.marqueeOpen()
    if (!r.ok) return toast(r.error || '打开飘屏失败', 'error')
    setOpen(true)
    toast('飘屏已开启', 'success')
  }

  const applyGiftList = (v: string) => {
    setGiftListText(v)
    patch({ gifts: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })
  }

  const test = async () => {
    if (!open) return toast('先开启飘屏再试', 'error')
    await window.api.connectorSimulate('礼物: 玫瑰 ×3  by 测试观众')
    if (cfg.chatOn) await window.api.connectorSimulate('弹幕: 测试观众 主播今天真好看')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <MessageSquare size={16} className="text-[var(--accent-2)]" /> 飘屏
            <span className="text-xs font-normal text-[var(--text-3)]">{open ? '已开启' : '已关闭'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="secondary" onClick={test} title="发一条模拟礼物/弹幕看看效果"><Play size={14} /> 试一试</Btn>
            <Btn onClick={toggle} variant={open ? 'secondary' : 'primary'}>
              <MonitorPlay size={14} /> {open ? '关闭飘屏' : '开启飘屏'}
            </Btn>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.giftOn} onChange={(v) => patch({ giftOn: v })} />礼物</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={cfg.chatOn} onChange={(v) => patch({ chatOn: v })} />弹幕</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={!!cfg.followOn} onChange={(v) => patch({ followOn: v })} />关注 / 灯牌</label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]"><Toggle value={!!cfg.memberOn} onChange={(v) => patch({ memberOn: v })} />进场</label>
          </div>
          {cfg.giftOn && (
            <Field label="只飘这些礼物" hint="逗号分隔；留空=所有礼物都飘">
              <Input value={giftListText} onChange={(e) => applyGiftList(e.target.value)} list="ent-marquee-gifts" placeholder="小心心, 玫瑰, 火箭" />
              <datalist id="ent-marquee-gifts">
                {DOUYIN_GIFT_NAMES.map((n) => <option key={n} value={n} />)}
              </datalist>
            </Field>
          )}
          {cfg.chatOn && (
            <Field advanced label="弹幕关键词过滤" hint="留空=全部弹幕都飘">
              <Input value={cfg.chatKeywords} onChange={(e) => patch({ chatKeywords: e.target.value })} placeholder="如：666 / 关注" />
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field advanced label="礼物文案" hint="可用 {name} 送礼人、{gift} 礼物、{count} 个数">
              <Input value={cfg.giftTemplate ?? ''} onChange={(e) => patch({ giftTemplate: e.target.value })} placeholder="{name}：{gift}{count}" />
            </Field>
            <Field advanced label="弹幕文案" hint="可用 {name} 昵称、{text} 内容">
              <Input value={cfg.chatTemplate ?? ''} onChange={(e) => patch({ chatTemplate: e.target.value })} placeholder="{name}：{text}" />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold text-[var(--text)]">外观</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="样式">
            <Select aria-label="飘屏皮肤" value={cfg.style ?? 'pill'} onChange={(e) => patch({ style: e.target.value as MarqueeStyle, color: MODERN_WIDGET_SKINS.some((skin) => skin.id === e.target.value) ? widgetSkin(e.target.value).text : '#ffffff' })}>
              <option value="pill">黑底胶囊</option>
              <option value="danmu">弹幕描边</option>
              <option value="neon">霓虹</option>
              {MODERN_WIDGET_SKINS.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
            </Select>
          </Field>
          <Field label="贴在屏幕">
            <Select value={cfg.position ?? 'bottom-left'} onChange={(e) => patch({ position: e.target.value as MarqueePosition })}>
              <option value="bottom-left">左下角</option>
              <option value="bottom-right">右下角</option>
              <option value="top-left">左上角</option>
              <option value="top-right">右上角</option>
            </Select>
          </Field>
          <Field label="字号">
            <Input type="number" min={10} max={120} value={cfg.fontSize ?? 18} onChange={(e) => patch({ fontSize: Number(e.target.value) || 18 })} />
          </Field>
          <Field label="文字颜色">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.color ?? '#ffffff'} onChange={(e) => patch({ color: e.target.value })} className="h-9 w-10 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent p-1" />
              <Input value={cfg.color ?? '#ffffff'} onChange={(e) => patch({ color: e.target.value })} />
            </div>
          </Field>
          <Field advanced label="每条停留（毫秒）">
            <Input type="number" min={300} value={cfg.keepMs ?? 3500} onChange={(e) => patch({ keepMs: Number(e.target.value) || 3500 })} />
          </Field>
          <Field advanced label="最多同时几条">
            <Input type="number" min={1} max={50} value={cfg.maxLines ?? 6} onChange={(e) => patch({ maxLines: Number(e.target.value) || 6 })} />
          </Field>
          <Field label={`底色不透明度 ${Math.round((cfg.bgOpacity ?? 0.55) * 100)}%`}>
            <input type="range" min={0} max={100} value={Math.round((cfg.bgOpacity ?? 0.55) * 100)} onChange={(e) => patch({ bgOpacity: Number(e.target.value) / 100 })} className="mt-2 w-full accent-[var(--accent)]" />
          </Field>
          <div className="flex flex-col justify-end pb-1">
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)]"><Toggle value={cfg.showImage !== false} onChange={(v) => patch({ showImage: v })} />显示礼物图 / 头像</label>
          </div>
          <Field advanced label="窗口宽度">
            <Input type="number" min={160} value={cfg.width ?? 420} onChange={(e) => patch({ width: Number(e.target.value) || 420 })} />
          </Field>
          <Field advanced label="窗口高度">
            <Input type="number" min={80} value={cfg.height ?? 300} onChange={(e) => patch({ height: Number(e.target.value) || 300 })} />
          </Field>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-[var(--text-4)]">
          透明窗贴在屏幕角落，消息从角落冒出、到点淡出；改了任何一项，开着的飘屏立刻跟着变。
        </p>
      </Card>
    </div>
  )
}
