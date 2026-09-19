import { MODERN_WIDGET_SKINS } from '@shared/widgetSkins'
import { useEffect, useState } from 'react'
import { Keyboard, MonitorPlay } from 'lucide-react'
import type { KeyboardWidgetConfig, KeyboardWidgetState } from '@shared/types'
import { Btn, Card, Field, Input, Pill, Segmented, Select, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { KeyboardUnlockButton } from '../components/KeyboardUnlockButton'

export default function EntertainmentKeyboard() {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<KeyboardWidgetConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [hook, setHook] = useState<KeyboardWidgetState['hook']>({ running: false })

  const refresh = async () => {
    const s = await window.api.keyboardState()
    setCfg(s.config)
    setOpen(s.open)
    setHook(s.hook)
  }

  useEffect(() => {
    void refresh()
    // 钩子状态（有没有在收键、有没有报错）每 2 秒看一眼
    const timer = window.setInterval(() => {
      window.api.keyboardState().then((s) => {
        setOpen(s.open)
        setHook(s.hook)
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  const patch = (value: Partial<KeyboardWidgetConfig>) => {
    if (!cfg) return
    setCfg({ ...cfg, ...value })
    void window.api.keyboardConfigure(value)
  }

  const toggle = async () => {
    if (open) {
      await window.api.keyboardClose()
      setOpen(false)
      toast('键盘显示已关闭', 'info')
      return
    }
    const r = await window.api.keyboardOpen()
    if (!r.ok) return toast(r.error || '打开键盘显示失败', 'error')
    setOpen(true)
    toast(r.error ? `窗口已开，但按键监听没起来：${r.error}` : '键盘显示已开启，按几个键试试', r.error ? 'error' : 'success')
  }

  if (!cfg) return null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Keyboard size={16} className="text-[var(--accent-2)]" /> 键盘显示
            {open && (
              <Pill tone={hook.error ? 'danger' : hook.running ? 'ok' : 'warn'} dot pulse={hook.running && !hook.error}>
                {hook.error ? '监听异常' : hook.running ? (hook.lastEventAt ? '正在收键' : '等待按键') : '监听未启动'}
              </Pill>
            )}
          </div>
          <div className="flex gap-2">
            <KeyboardUnlockButton />
            <Btn onClick={toggle} variant={open ? 'secondary' : 'primary'}>
              <MonitorPlay size={14} /> {open ? '关闭窗口' : '开启窗口'}
            </Btn>
          </div>
        </div>
        {hook.error && <div className="mb-3 rounded-lg border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{hook.error}</div>}
        <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
          把主播正在按的键实时显示给观众。卡通样式只冒出按下的键，专业样式画整块键盘高亮按键；透明模式直接盖在游戏上，绿幕模式给 OBS / 直播伴侣抠像。
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-[11px] text-[var(--text-3)]">
          <span className="flex-1">游戏以管理员权限运行时收不到按键，把客户端也以管理员身份重启即可（会弹一次系统授权）。</span>
          <Btn
            size="sm"
            variant="secondary"
            onClick={async () => {
              const r = await window.api.relaunchElevated()
              if (!r.ok) toast(r.error || '重启失败', 'error')
            }}
          >
            以管理员身份重启客户端
          </Btn>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="样式">
            <Segmented size="sm" value={cfg.style} onChange={(v) => patch({ style: v })} options={[{ value: 'cartoon', label: '卡通' }, { value: 'pro', label: '专业' }]} />
          </Field>
          <Field label="配色">
            <Select aria-label="键盘皮肤" value={cfg.theme} onChange={(e) => patch({ theme: e.target.value as KeyboardWidgetConfig['theme'] })}>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="neon">霓虹</option>
              {MODERN_WIDGET_SKINS.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
            </Select>
          </Field>
          <Field label="窗口背景">
            <Segmented size="sm" value={cfg.background} onChange={(v) => patch({ background: v })} options={[{ value: 'transparent', label: '透明' }, { value: 'green', label: '绿幕' }]} />
          </Field>
          <div className="flex flex-col justify-end pb-1">
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)]"><Toggle value={cfg.showMouse} onChange={(v) => patch({ showMouse: v })} />显示鼠标</label>
          </div>
          <Field advanced label="键帽大小倍率">
            <Input type="number" min={0.4} max={3} step={0.1} value={cfg.keyScale} onChange={(e) => patch({ keyScale: Number(e.target.value) || 1 })} />
          </Field>
          <Field advanced label="整体透明度">
            <Input type="number" min={0.2} max={1} step={0.05} value={cfg.opacity} onChange={(e) => patch({ opacity: Number(e.target.value) || 1 })} />
          </Field>
          <Field advanced label="窗口宽度">
            <Input type="number" min={200} value={cfg.width} onChange={(e) => patch({ width: Number(e.target.value) || 720 })} />
          </Field>
          <Field advanced label="窗口高度">
            <Input type="number" min={60} value={cfg.height} onChange={(e) => patch({ height: Number(e.target.value) || 140 })} />
          </Field>
          {cfg.style === 'cartoon' && (
            <>
              <Field advanced label="松开后多久消失（毫秒）">
                <Input type="number" min={100} value={cfg.fadeMs} onChange={(e) => patch({ fadeMs: Number(e.target.value) || 700 })} />
                <div className="mt-1 text-xs text-[var(--text-4)]">松手后按键还停留多久，建议 600 毫秒以上。</div>
              </Field>
              <Field advanced label="最多同时显示几个键">
                <Input type="number" min={1} max={30} value={cfg.maxKeys} onChange={(e) => patch({ maxKeys: Number(e.target.value) || 8 })} />
              </Field>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
