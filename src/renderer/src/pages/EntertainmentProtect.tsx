import { useEffect, useState } from 'react'
import { Shield, Timer, Video, FolderOpen } from 'lucide-react'
import { Btn, Card, Field, Input, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'

const STORAGE_KEY = 'ent-protect-config'

export default function EntertainmentProtect() {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState({
    skipPrank: true, // 保护时跳过当前整蛊
    rejectGift: false, // 保护时拒绝礼物
    clearQueue: false, // 保护时清空排队礼物
    clearSpecial: false, // 保护时清掉特色整蛊画面（鸭子、锁链、蚊子…）
    showTimer: true, // 显示保护计时
    playVideo: false, // 保护时播放视频
    videoPath: '' // 保护视频（参考：保护主播.mp4）
  })
  const [protecting, setProtecting] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // 保护状态在主进程（规则暂停 + 计时牌）里，页面切走再回来要按真值显示，否则按钮写「开启保护」而规则其实还停着
  useEffect(() => {
    let alive = true
    window.api.entertainmentProtectState().then((st) => {
      if (!alive) return
      if (st.paused || st.protectOpen) {
        setProtecting(true)
        setElapsed(st.startedAt ? Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000)) : 0)
      }
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      setCfg((p) => ({ ...p, ...saved }))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  }, [cfg])

  // 保护计时
  useEffect(() => {
    if (!protecting) return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [protecting])

  const set = (patch: Partial<typeof cfg>) => setCfg((p) => ({ ...p, ...patch }))
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const toggleProtect = async () => {
    if (!protecting) {
      setProtecting(true)
      setElapsed(0)
      // 拒绝礼物：主进程暂停全部礼物规则（进场/关注/点赞规则一并停）
      if (cfg.rejectGift) await window.api.entertainmentRulesPause(true)
      // 清空排队：把还没执行的排队礼物全丢掉
      if (cfg.clearQueue) await window.api.queueClear()
      if (cfg.clearSpecial) await window.api.specialClearAll()
      // 计时牌：屏幕右上角挂「主播保护中 00:00」
      if (cfg.showTimer) await window.api.protectWidgetOpen(Date.now())
      // 保护时播放视频（参考：保护主播.mp4）
      if (cfg.playVideo && cfg.videoPath) {
        const vr = await window.api.videoWidgetOpen({
          path: cfg.videoPath, loop: true, muted: false, volume: 1, topMost: true,
          width: 480, height: 270, bgColor: '#000000'
        })
        if (!vr.ok) toast(vr.error || '视频打开失败', 'error')
      }
      // 联动 mod：protect on（mod 端已支持，默认开 30 秒）
      const r = await window.api.liveCmd('protect on')
      if (r.ok) toast('保护已开启：观众整蛊将被跳过（已同步游戏）', 'success')
      else toast('保护已开启（游戏未运行，连接后自动生效）', 'success')
    } else {
      setProtecting(false)
      await window.api.entertainmentRulesPause(false)
      if (cfg.clearQueue) await window.api.queueClear()
      await window.api.protectWidgetClose()
      if (cfg.playVideo && cfg.videoPath) await window.api.videoWidgetClose('main')
      await window.api.liveCmd('protect off')
      toast(`保护结束，共保护 ${fmt(elapsed)}`, 'info')
    }
  }

  const pickVideo = async () => {
    const res = await window.api.selectFile({
      title: '选择保护视频',
      filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }],
      properties: ['openFile']
    })
    if (res.ok && res.path) set({ videoPath: res.path })
  }

  const Row = ({ label, desc, checked, on }: { label: string; desc: string; checked: boolean; on: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--text)]">{label}</div>
        <div className="mt-0.5 text-xs text-[var(--text-3)]">{desc}</div>
      </div>
      <Toggle value={checked} onChange={on} />
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Shield size={16} className="text-[var(--ok)]" />
            主播保护
          </div>
          {protecting && (
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--ok-soft)] px-3 py-1 text-xs text-[var(--ok)]">
              <Timer size={12} /> 保护中 {fmt(elapsed)}
            </span>
          )}
        </div>
        <p className="mb-4 text-xs leading-5 text-[var(--text-3)]">
          保护开启期间，暂停观众触发的整蛊，让主播专心操作。游戏内整蛊由 mod 联动跳过，礼物触发规则由客户端自己暂停。
        </p>
        <div className="space-y-2">
          <Row label="保护时跳过当前整蛊" desc="游戏里观众触发的整蛊动作在保护期间被跳过" checked={cfg.skipPrank} on={(v) => set({ skipPrank: v })} />
          <Row label="保护时暂停礼物互动" desc="保护期间收到的礼物/关注/点赞不触发任何礼物规则" checked={cfg.rejectGift} on={(v) => set({ rejectGift: v })} />
          <Row label="保护时清空排队礼物" desc="开启和结束保护时都清掉还没执行的排队礼物" checked={cfg.clearQueue} on={(v) => set({ clearQueue: v })} />
          <Row label="保护时清掉特色整蛊画面" desc="开启保护时把鸭子、锁链、蚊子等特色整蛊一次清空，窗口保留" checked={cfg.clearSpecial} on={(v) => set({ clearSpecial: v })} />
          <Row label="显示保护计时界面" desc="保护期间屏幕右上角挂一块「主播保护中」计时牌" checked={cfg.showTimer} on={(v) => set({ showTimer: v })} />
          <Row label="保护时播放视频" desc="开启保护时视频窗口播放视频（参考：保护主播.mp4）" checked={cfg.playVideo} on={(v) => set({ playVideo: v })} />
        </div>
        {cfg.playVideo && (
          <div className="mt-3">
            <Field label="保护视频">
              <div className="flex gap-2">
                <Input value={cfg.videoPath} readOnly placeholder="选择视频（如 保护主播.mp4）" className="flex-1 text-[11px]" />
                <Btn size="sm" variant="secondary" onClick={pickVideo}><FolderOpen size={12} /> 选视频</Btn>
              </div>
            </Field>
          </div>
        )}
        <div className="mt-4">
          <Btn onClick={toggleProtect} variant={protecting ? 'danger' : 'primary'} className="w-full">
            {protecting ? '结束保护' : '开启保护'}
          </Btn>
        </div>
      </Card>
    </div>
  )
}
