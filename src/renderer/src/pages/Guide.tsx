import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, ChevronRight, Rocket } from 'lucide-react'
import { useAuth } from '../stores/auth'
import { Btn, Loading } from '../components/ui'
import type { EmailLicense } from '@shared/types'

// 首次使用向导：三步走（装 Mod → 绑直播间 → 授权），全部完成或手动跳过即不再弹
export default function Guide() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const [gameReady, setGameReady] = useState(false)
  const [lic, setLic] = useState<EmailLicense | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { settings } = await window.api.getSettings()
      const gid = settings.currentGameId ?? ''
      setGameReady(!!(settings.gamePaths?.[gid] || (gid === '4wheel-challenge' ? settings.gamePath : '')))   // 与设置页/连接器页同一口径，别只认轮椅旧字段
      if (user?.email) {
        const r = await window.api.emailGetLicense(user.email)
        setLic(r.ok ? r : null)
      }
      setBusy(false)
    })()
  }, [user?.email])

  const roomBound = (user?.boundRooms?.length ?? 0) > 0
  const authed = lic ? Object.keys(lic.games ?? {}).length > 0 : false
  const needAuthedStep = !!user?.email

  // 三件套都齐了 → 之后不再自动弹引导（写 settings 持久化 + 兼容旧 localStorage）
  useEffect(() => {
    if (busy) return
    if (gameReady && roomBound && (!needAuthedStep || authed)) {
      localStorage.setItem('zl-guide-seen', '1')
      window.api.saveSettings({ guideSeen: true })
    }
  }, [busy, gameReady, roomBound, authed, needAuthedStep])

  const finish = (to='/') => {
    localStorage.setItem('zl-guide-seen', '1')
    window.api.saveSettings({ guideSeen: true })
    navigate(to)
  }

  if (busy) return <Loading text="正在检查引导进度…" />

  const steps: {
    title: string
    desc: string
    ok: boolean
    action: string
    to: string
  }[] = [
    {
      title: '找到本机游戏',
      desc: '自动查找已安装的游戏，再检查对应的整蛊组件。',
      ok: gameReady,
      action: '去查找',
      to: '/launch'
    },
    {
      title: '绑定直播间号',
      desc: '绑定后连接器才能连接你的抖音直播间，也决定授权归属。',
      ok: roomBound,
      action: '去绑定',
      to: '/settings'
    },
    {
      title: '获得游戏授权',
      desc: needAuthedStep
        ? '申请对应游戏的授权，通过后即可启动整蛊。'
        : '所有游戏已开放，直接启动整蛊即可。',
      ok: needAuthedStep ? authed : true,
      action: '去申请',
      to: '/launch'
    }
  ]

  return (
    <div className="drag-region mx-auto max-w-lg p-8">
      <div className="no-drag">
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white"
            style={{
              background: 'linear-gradient(135deg, var(--accent-2), var(--accent))',
              boxShadow: '0 8px 28px var(--accent-glow)'
            }}
          >
            知
          </div>
          <h2 className="text-xl font-bold text-[var(--text)]">欢迎使用知了猴整蛊台</h2>
          <p className="mt-1 text-xs text-[var(--text-3)]">三步开启你的第一场互动直播。</p>
        </div>

        <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
          {steps.map((s, i) => (
            <div
              key={s.title}
              className={`flex items-center gap-3 rounded-xl border p-4 transition ${
                s.ok
                  ? 'border-[var(--ok-line)] bg-[var(--ok-soft)]'
                  : 'border-[var(--line-strong)] bg-[var(--bg-elev)]'
              }`}
            >
              {s.ok ? (
                <CheckCircle2 size={22} className="shrink-0 text-[var(--ok)]" />
              ) : (
                <Circle size={22} className="shrink-0 text-[var(--accent-2)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--text)]">
                  {i + 1}. {s.title}
                </div>
                <div className="mt-0.5 text-xs leading-5 text-[var(--text-3)]">{s.desc}</div>
              </div>
              {s.ok ? (
                <span className="shrink-0 text-xs font-medium text-[var(--ok)]">已完成</span>
              ) : (
                <Btn size="sm" onClick={() => navigate(s.to)} className="shrink-0">
                  {s.action} <ChevronRight size={13} />
                </Btn>
              )}
            </div>
          ))}

          <div className="border-t border-[var(--line)] pt-3"><p className="mb-2 text-xs leading-5 text-[var(--text-3)]">想先配置视频、转盘或计时？可以直接进入娱乐助手。</p><Btn variant="secondary" onClick={()=>finish('/ent')}>先配置娱乐互动</Btn></div>
          <div className="flex items-center justify-between pt-2">
            <Btn variant="ghost" size="sm" onClick={()=>finish()}>
              跳过，直接开始使用
            </Btn>
            <Btn size="lg" onClick={()=>finish()}>
              <Rocket size={15} /> 开始使用
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
