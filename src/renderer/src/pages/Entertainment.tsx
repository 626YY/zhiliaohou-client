import { lazy, Suspense, useEffect, useState } from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import { ChevronLeft, Gift, Wand2, Image as ImageIcon, Disc3, LayoutGrid, Sparkles, TrendingUp, MonitorPlay, Radio, Shield, Wrench, Gamepad2, Clock, Clapperboard, Sticker, MessageSquare, Crown, Keyboard, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { Btn, Input, Loading, PageHeader } from '../components/ui'
import {FEATURE_GROUPS,FEATURE_GUIDES} from '../lib/featureGuides'
import FeatureIntroduction from '../components/FeatureIntroduction'
import { AnnounceGuide, AnnounceSwitch } from '../components/AnnounceControls'
import {AssetLibraryEntry} from '../components/AssetLibrarySetup'
const EntertainmentGiftRules = lazy(() => import('./EntertainmentGiftRules'))
const EntertainmentTransparent = lazy(() => import('./EntertainmentTransparent'))
const EntertainmentWheel = lazy(() => import('./EntertainmentWheel'))
const EntertainmentNineGrid = lazy(() => import('./EntertainmentNineGrid'))
const EntertainmentEffects = lazy(() => import('./EntertainmentEffects'))
const EntertainmentProgress = lazy(() => import('./EntertainmentProgress'))
const EntertainmentGreenScreen = lazy(() => import('./EntertainmentGreenScreen'))
const EntertainmentDanmaku = lazy(() => import('./EntertainmentDanmaku'))
const EntertainmentProtect = lazy(() => import('./EntertainmentProtect'))
const EntertainmentTools = lazy(() => import('./EntertainmentTools'))
const EntertainmentConsole = lazy(() => import('./EntertainmentConsole'))
const EntertainmentTime = lazy(() => import('./EntertainmentTime'))
const EntertainmentVideo = lazy(() => import('./EntertainmentVideo'))
const EntertainmentSticker = lazy(() => import('./EntertainmentSticker'))
const EntertainmentMarquee = lazy(() => import('./EntertainmentMarquee'))
const EntertainmentChallenge = lazy(() => import('./EntertainmentChallenge'))
const EntertainmentOvertime = lazy(() => import('./EntertainmentOvertime'))
const EntertainmentEntrance = lazy(() => import('./EntertainmentEntrance'))
const EntertainmentKeyboard = lazy(() => import('./EntertainmentKeyboard'))
const EntertainmentObs = lazy(() => import('./EntertainmentObs'))
import WidgetDashboard from '../components/WidgetDashboard'

type Tab =
  | 'special'
  | 'gift'
  | 'entrance'
  | 'keyboard'
  | 'obs'
  | 'transparent'
  | 'wheel'
  | 'nine'
  | 'effects'
  | 'progress'
  | 'green'
  | 'danmaku'
  | 'protect'
  | 'tools'
  | 'console'
  | 'time'
  | 'video'
  | 'sticker'
  | 'marquee'
  | 'challenge'
  | 'overtime'

interface Mod {
  id: Tab
  label: string
  desc: string
  icon: LucideIcon
}

const MODULES: Mod[] = [
  // 特色整蛊是独立菜单（/special），这里放个入口：它的触发就是下面「礼物触发」里的规则
  { id: 'special', label: '特色整蛊', desc: '锁链、抓鸭子、粉丝来电等 17 个画面小游戏', icon: Wand2 },
  { id: 'gift', label: '礼物触发', desc: '收到礼物，播放视频、音效或触发动作', icon: Gift },
  { id: 'transparent', label: '透明图合成', desc: '文字+图片 → 透明 PNG', icon: ImageIcon },
  { id: 'wheel', label: '转盘抽奖', desc: '填写奖项，让观众送礼抽奖', icon: Disc3 },
  { id: 'nine', label: '九宫格转盘', desc: '3×3 网格抽奖', icon: LayoutGrid },
  { id: 'effects', label: '礼物动画', desc: '抛物/炸弹/小车/烟花', icon: Sparkles },
  { id: 'progress', label: '积分心愿', desc: '积分进度条 · 心愿达成', icon: TrendingUp },
  { id: 'green', label: '绿幕窗口', desc: '绿底窗口播视频/图片，窗口捕获抠像', icon: MonitorPlay },
  { id: 'danmaku', label: '弹幕平台', desc: '多平台弹幕连接', icon: Radio },
  { id: 'protect', label: '保护主播', desc: '跳过/拒收 · 保护计时', icon: Shield },
  { id: 'tools', label: '互动工具', desc: '功德/弹幕转发/测试', icon: Wrench },
  { id: 'console', label: '操作台', desc: '暂停整蛊 · 计数器 · 鼠标', icon: Gamepad2 },
  { id: 'time', label: '时间插件', desc: '倒计时 · 时间盲盒 · 礼物加减时间', icon: Clock },
  { id: 'video', label: '视频播放器', desc: '播放视频，可设置循环和声音', icon: Clapperboard },
  { id: 'sticker', label: '贴纸统计', desc: '礼物贴纸效果统计', icon: Sticker },
  { id: 'marquee', label: '飘屏', desc: '礼物/弹幕滚动显示', icon: MessageSquare },
  { id: 'entrance', label: '大哥进场', desc: '进场横幅 · 视频 · 音效', icon: Crown },
  { id: 'keyboard', label: '键盘显示', desc: '按键实时上屏 · 卡通/专业', icon: Keyboard },
  { id: 'obs', label: '滤镜设置', desc: 'OBS 滤镜开关 · 抖音直播伴侣快速入口', icon: SlidersHorizontal },
  { id: 'challenge', label: '计数挑战', desc: '挑战计时 · 礼物加减', icon: Clock },
  { id: 'overtime', label: '加班器', desc: '观众送礼，增加或减少加班时间', icon: Clock }
]

export default function Entertainment() {
  const [params,setParams]=useSearchParams()
  const navigate=useNavigate()
  const active=MODULES.find(m=>m.id===params.get('tool')&&m.id!=='special')?.id??null
  const [query,setQuery]=useState('')
  const setActive=(tab:Tab|null)=>{
    if(tab==='special'){navigate('/special');return}
    const next=new URLSearchParams(params)
    if(tab)next.set('tool',tab);else next.delete('tool')
    next.delete('setup')
    next.delete('slot')
    setParams(next)
  }

  // 切换模块回到顶部（否则表单 autofocus 等会把页面滚到中间，顶部按钮被裁一半）
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [active])

  const render = (tab: Tab) => {
    switch (tab) {
      case 'gift':
        return <EntertainmentGiftRules />
      case 'transparent':
        return <EntertainmentTransparent />
      case 'wheel':
        return <EntertainmentWheel />
      case 'nine':
        return <EntertainmentNineGrid />
      case 'effects':
        return <EntertainmentEffects />
      case 'progress':
        return <EntertainmentProgress />
      case 'green':
        return <EntertainmentGreenScreen />
      case 'danmaku':
        return <EntertainmentDanmaku />
      case 'protect':
        return <EntertainmentProtect />
      case 'tools':
        return <EntertainmentTools />
      case 'console':
        return <EntertainmentConsole />
      case 'time':
        return <EntertainmentTime />
      case 'video':
        return <EntertainmentVideo />
      case 'sticker':
        return <EntertainmentSticker />
      case 'marquee':
        return <EntertainmentMarquee />
      case 'entrance':
        return <EntertainmentEntrance />
      case 'keyboard':
        return <EntertainmentKeyboard />
      case 'obs':
        return <EntertainmentObs />
      case 'challenge':
        return <EntertainmentChallenge onNavigate={(target) => setActive(target === 'countdown' ? 'time' : target)} />
      case 'overtime':
        return <EntertainmentOvertime onNavigate={(target) => setActive(target === 'countdown' ? 'time' : target)} />
      default:
        return <EntertainmentGiftRules />
    }
  }

  // 宫格主页
  if (active === null) {
    return (
      <div className="p-6">
        <div className="mb-5">
          <PageHeader
            title="娱乐助手"
            desc="选择要做的互动，配置后即可先预览效果"
            actions={<Input aria-label="查找互动功能" placeholder="搜索功能，例如视频、时间、抽奖" value={query} onChange={e=>setQuery(e.target.value)} className="w-72" />}
          />
        </div>
        <div className="mb-4">
          <AssetLibraryEntry />
          <WidgetDashboard />
        </div>
        <div className="space-y-5">
          {FEATURE_GROUPS.map(group=>{
            const rows=MODULES.filter(m=>FEATURE_GUIDES[m.id].group===group&&`${m.label} ${m.desc} ${FEATURE_GUIDES[m.id].steps.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
            if(!rows.length)return null
            return <section key={group}><h3 className="mb-2 text-xs font-semibold text-[var(--text-3)]">{group}</h3><div className="grid grid-cols-1 gap-2 min-[850px]:grid-cols-2 min-[1180px]:grid-cols-3">
          {rows.map((m) => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                data-feature={m.id}
                onClick={() => setActive(m.id)}
                className="group grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--line)] bg-[var(--bg-card)] px-3 py-2.5 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elev)]"
              >
                <div className="row-span-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-2)] transition group-hover:bg-[var(--accent-soft-2)]">
                  <Icon size={19} strokeWidth={1.8} />
                </div>
                <div className="text-sm font-semibold text-[var(--text)]">{m.label}</div>
                <div className="text-[11px] leading-4 text-[var(--text-3)]">{m.desc}</div>
              </button>
            )
          })}</div></section>})}
          {query.trim()&&!MODULES.some(m=>`${m.label} ${m.desc} ${FEATURE_GUIDES[m.id].steps.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))&&<p className="py-8 text-sm text-[var(--text-3)]">没有找到对应功能，试试视频、礼物、抽奖或计时。</p>}
        </div>
      </div>
    )
  }

  const cur = MODULES.find((m) => m.id === active)
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Btn variant="ghost" size="sm"
          onClick={() => setActive(null)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-3)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
        >
          <ChevronLeft size={14} /> 返回功能列表
        </Btn>
        <span className="text-sm font-semibold text-[var(--text)]">{cur?.label}</span>
        {cur && <AnnounceSwitch module={cur.id} />}
      </div>
      {cur && <AnnounceGuide module={cur.id} />}
      {cur&&<FeatureIntroduction feature={cur.id} title={cur.label}/>}
      <div data-feature-content={active}><Suspense fallback={<Loading text="正在加载挂件编辑器…" />}>{render(active)}</Suspense></div>
    </div>
  )
}
