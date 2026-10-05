import { usePolling } from '../lib/usePolling'
import { useEffect, useRef, useState } from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import type { Settings } from '@shared/types'
import { ChevronDown, LayoutDashboard, PowerOff, Rocket } from 'lucide-react'
import { Btn, Card, Pill, Segmented, Toggle } from './ui'
import { useToast } from '../stores/ui'
import { WIDGET_GROUPS, WIDGET_LAUNCHERS, openWidgets, readAutoOpenIds, readWidgetOpenState, widgetConfigRoute, writeAutoOpenIds, type WidgetGroup, type WidgetOpenState } from '../lib/widgetLaunchers'
import CaptureBackgroundToggle from './CaptureBackgroundToggle'
import {useConfigurationLevel} from '../lib/configurationLevel'

// 挂件总控：一眼看到哪些直播挂件开着，一键开启开播要用的那几个 / 全部关闭；勾上「启动时自动开」下次开客户端自动就位。
// 娱乐助手首页管全部挂件（特色整蛊那组默认折叠，只露开着的 / 勾了自动开的）；特色整蛊页只管特色整蛊这一组。
// 两处用的是同一份开关和自动开启名单。
export default function WidgetDashboard({ groups = WIDGET_GROUPS, scope = 'all' }: { groups?: WidgetGroup[]; scope?: 'all' | 'special' }) {
  const {level}=useConfigurationLevel()
  const navigate=useNavigate()
  const [params]=useSearchParams()
  const [managerOpen,setManagerOpen]=useState(()=>params.get('manage')==='1')
  const [rowBusy,setRowBusy]=useState('')
  const [rowError,setRowError]=useState<Record<string,string>>({})
  const toast = useToast((s) => s.toast)
  const [state, setState] = useState<WidgetOpenState>({})
  const [auto, setAuto] = useState<string[]>(readAutoOpenIds)
  const [busy, setBusy] = useState(false)
  const [captureMode, setCaptureMode] = useState<Settings['outputCaptureMode']>()
  const [captureBusy, setCaptureBusy] = useState(false)
  const [specialExpanded, setSpecialExpanded] = useState(scope === 'special')
  const [specialBg, setSpecialBg] = useState<'green' | 'transparent' | 'mixed'>()
  const mounted = useRef(false)
  const launchers = WIDGET_LAUNCHERS.filter((w) => groups.includes(w.group))
  const scopedAuto = auto.filter((id) => launchers.some((w) => w.id === id))
  const what = scope === 'special' ? '特色整蛊窗口' : '效果'

  useEffect(() => {
    mounted.current = true
    void window.api.getSettings().then(({ settings }) => {
      if (mounted.current) setCaptureMode(settings.outputCaptureMode || 'green')
    }).catch(() => { if (mounted.current) toast('读取采集设置失败，请重新打开娱乐助手', 'error') })
    return () => { mounted.current = false }
  }, [toast])
  // 特色整蛊每个玩法有自己的底色；这里是「一键统一」，各玩法详情页里仍可单独改
  const readSpecialBg = () => window.api.specialState().then((st) => {
    const set = new Set(st.games.map((g) => g.config.background))
    if (mounted.current) setSpecialBg(set.size === 1 ? [...set][0] : 'mixed')
  }).catch(() => {})
  useEffect(() => { if (scope === 'special') void readSpecialBg() }, [scope])
  const changeSpecialBg = async (bg: 'green' | 'transparent') => {
    setCaptureBusy(true)
    try {
      const st = await window.api.specialState()
      for (const g of st.games) if (g.config.background !== bg) await window.api.specialConfigure(g.id, { background: bg })
      setSpecialBg(bg)
      toast(bg === 'green' ? '特色整蛊全部改成绿幕底色' : '特色整蛊全部改成透明底色', 'success')
    } finally {
      if (mounted.current) setCaptureBusy(false)
    }
  }
  const changeCaptureMode = async (mode: 'green' | 'transparent') => {
    setCaptureBusy(true)
    try {
      const { settings, outputWindowsNeedReopen } = await window.api.saveSettings({ outputCaptureMode: mode })
      if (mounted.current) {
        setCaptureMode(settings.outputCaptureMode)
        if (outputWindowsNeedReopen) toast('底色已保存，重新打开已开启的挂件后生效', 'info')
      }
    } catch {
      if (mounted.current) toast('切换底色失败，请重试', 'error')
    } finally {
      if (mounted.current) setCaptureBusy(false)
    }
  }

  const refresh = () => readWidgetOpenState().then(setState)
  usePolling(readWidgetOpenState, (next) => {
    setState((current) => Object.keys(next).every((id) => current[id] === next[id]) ? current : next)
  }, 2000)

  const toggleAuto = (id: string, on: boolean) => {
    const next = on ? [...new Set([...auto, id])] : auto.filter((x) => x !== id)
    setAuto(next)
    writeAutoOpenIds(next)
  }

  const openChecked = async () => {
    if (!scopedAuto.length) return toast('还没勾选任何挂件，先在右侧勾「启动时自动开」', 'info')
    setBusy(true)
    const failed = await openWidgets(scopedAuto)
    setBusy(false)
    await refresh()
    if (failed.length) toast(`有 ${failed.length} 个没开起来：${failed.map((f) => `${WIDGET_LAUNCHERS.find((w) => w.id === f.id)?.label}（${f.error}）`).join('；')}`, 'error')
    else toast(`已开启 ${scopedAuto.length} 个${scope === 'special' ? '特色整蛊窗口' : '挂件'}`, 'success')
  }

  const closeAll = async () => {
    setBusy(true)
    for (const w of launchers) if (state[w.id]) await w.close().catch(() => {})
    setBusy(false)
    await refresh()
    toast(scope === 'special' ? '已关闭全部特色整蛊窗口' : '已关闭全部挂件', 'info')
  }

  const one = async (id: string) => {
    if(rowBusy)return
    setRowBusy(id);setRowError(e=>({...e,[id]:''}))
    try {
    const w = WIDGET_LAUNCHERS.find((x) => x.id === id)
    if (!w) return
    if (state[id]) await w.close().catch(() => {})
    else {
      const r = await w.open()
      if (!r.ok) {setRowError(e=>({...e,[id]:r.error||'窗口没能打开，请先配置'}));toast(r.error||'窗口没能打开，请先配置','error')}
    }
    await refresh()
    } catch {setRowError(e=>({...e,[id]:'操作失败，请重试'}))} finally {setRowBusy('')}
  }

  const openCount = launchers.filter((w) => state[w.id]).length

  // 基础模式一律先给摘要条；特色整蛊页高级模式也先收起（17 个窗口摊开会把玩法卡片挤到下面去），点「管理播放窗口」再展开
  const collapsedByDefault=level==='basic'||scope==='special'
  if(collapsedByDefault&&!managerOpen)return <div className="border-b border-[var(--line)] pb-3" data-testid="active-output-summary">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Pill tone={openCount?'ok':'muted'} dot>{openCount?`${openCount} 个${what}正在显示`:`还没有开启${what}`}</Pill>
      <div className="flex items-center gap-2">
        {scopedAuto.length>0&&<Btn size="sm" onClick={openChecked} disabled={busy}>开启已选{scope==='special'?'窗口':'效果'}（{scopedAuto.length}）</Btn>}
        {openCount>0&&<Btn size="sm" variant="secondary" onClick={closeAll} disabled={busy}>全部关闭</Btn>}
        <Btn size="sm" variant="ghost" onClick={()=>setManagerOpen(true)}>管理播放窗口</Btn>
      </div>
    </div>
    <p className="mt-2 text-xs leading-5 text-[var(--text-3)]">{scope==='special'?'点一个玩法进去，先在预览里试，再开启它的窗口；也可以点「管理播放窗口」统一开启、关闭和设置下次自动开启。':'第一次使用：先在下面选一个功能完成配置，再点它的「开启窗口」。也可以点「管理播放窗口」统一开启、关闭和设置自动开启。'}</p>
    {openCount>0&&<div className="mt-2 flex flex-wrap gap-2">{launchers.filter(w=>state[w.id]).map(w=><Btn key={w.id} size="sm" variant="secondary" onClick={()=>one(w.id)} aria-label={`关闭${w.label}`}><PowerOff size={12}/>{w.label}</Btn>)}</div>}
  </div>

  const row = (w: (typeof launchers)[number]) => <div key={w.id} className="py-2" data-output-row={w.id}>
    <div className="flex flex-wrap items-center gap-3"><span className="min-w-[112px] flex-1 text-sm text-[var(--text)]">{w.label}</span><Pill tone={state[w.id]?'ok':'muted'}>{state[w.id]?'已开启':'未开启'}</Pill><Btn size="sm" variant={state[w.id]?'secondary':'primary'} aria-label={`${state[w.id]?'关闭':'开启'}${w.label}`} disabled={!!rowBusy||busy} onClick={()=>void one(w.id)}>{rowBusy===w.id?'处理中…':state[w.id]?'关闭':'开启'}</Btn><Btn size="sm" variant="ghost" aria-label={`配置${w.label}`} onClick={()=>navigate(widgetConfigRoute(w.id))}>{w.group==='特色整蛊'?'预览和设置':'去配置'}</Btn><label className="flex items-center gap-2 text-xs text-[var(--text-3)]"><Toggle label={`${w.label}下次启动自动开启`} value={auto.includes(w.id)} onChange={v=>toggleAuto(w.id,v)}/>下次启动自动开启</label></div>
    {rowError[w.id]&&<p role="alert" className="mt-2 text-xs text-[var(--warn)]">{rowError[w.id]}。可点这行的「{w.group==='特色整蛊'?'预览和设置':'去配置'}」。</p>}
  </div>

  return <Card>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]"><LayoutDashboard size={16}/>管理播放窗口<Pill tone={openCount?'ok':'muted'}>{openCount} 个已开启</Pill></div>
      <div className="flex gap-2"><Btn variant="secondary" size="sm" disabled={busy||!openCount} onClick={closeAll}>全部关闭</Btn>{collapsedByDefault&&<Btn variant="ghost" size="sm" onClick={()=>setManagerOpen(false)}>收起窗口管理</Btn>}</div>
    </div>
    <ol className="mb-4 space-y-1 text-xs leading-6 text-[var(--text-3)]" aria-label="窗口管理使用步骤">{scope==='special'
      ?<><li>1. 没玩过的玩法先点「预览和设置」，在预览里试好、绑上礼物，再回来点「开启」。</li><li>2. 窗口开好后，到直播软件添加这个窗口的采集来源。</li><li>3. 想下次打开软件时省事，再勾选「下次启动自动开启」；勾选不会立刻打开窗口。</li></>
      :<><li>1. 没设置过的功能先点「去配置」，设置好后回来点「开启」。</li><li>2. 窗口开好后，到直播软件添加这个窗口的采集来源。</li><li>3. 想下次打开软件时省事，再勾选「下次启动自动开启」；勾选不会立刻打开窗口。</li></>}</ol>
    <div className="mb-4 border-y border-[var(--line)] py-2">{scope==='special'
      ?<div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm text-[var(--text)]">特色整蛊底色</div><div className="text-xs text-[var(--text-3)]">一键统一全部玩法：绿幕给直播伴侣抠绿，透明直接叠加。单个玩法可在它的设置里另改。</div></div><Segmented size="sm" value={specialBg==='mixed'||!specialBg?'mixed':specialBg} onChange={v=>{if(v!=='mixed'&&!captureBusy)void changeSpecialBg(v)}} options={[{value:'green',label:'全部绿幕'},{value:'transparent',label:'全部透明'},...(specialBg==='mixed'?[{value:'mixed' as const,label:'各自设置'}]:[])]}/></div>
      :<CaptureBackgroundToggle mode={captureMode} onChange={changeCaptureMode} disabled={!captureMode||captureBusy}/>}</div>
    <div className="space-y-4">{groups.map(group=>{
      const rows=launchers.filter(w=>w.group===group)
      if(!rows.length)return null
      // 娱乐助手首页里特色整蛊有 17 个，默认只露开着的和勾了自动开的，展开才列全
      const foldable=scope==='all'&&group==='特色整蛊'
      const shown=foldable&&!specialExpanded?rows.filter(w=>state[w.id]||auto.includes(w.id)):rows
      return <section key={group}>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--text-3)]">{group}{foldable&&<><span className="font-normal text-[var(--text-4)]">{rows.filter(w=>state[w.id]).length} 个开着</span><Btn size="sm" variant="ghost" aria-expanded={specialExpanded} onClick={()=>setSpecialExpanded(!specialExpanded)}><ChevronDown size={13} className={specialExpanded?'':'-rotate-90'}/>{specialExpanded?'收起':`展开全部 ${rows.length} 个`}</Btn></>}</h3>
        <div className="divide-y divide-[var(--line)]">{shown.map(row)}</div>
        {foldable&&!specialExpanded&&!shown.length&&<p className="text-xs text-[var(--text-4)]">还没开特色整蛊窗口。展开后可以逐个开启，或去「特色整蛊」页先预览。</p>}
      </section>
    })}</div>
    <div className="mt-4 border-t border-[var(--line)] pt-3"><p className="mb-2 text-xs leading-6 text-[var(--text-3)]">自动开启名单：{scopedAuto.length?launchers.filter(w=>scopedAuto.includes(w.id)).map(w=>w.label).join('、'):'还没有选择。手动开启也能正常使用。'}</p><Btn size="sm" disabled={busy||!scopedAuto.length} onClick={openChecked}><Rocket size={13}/>现在开启名单中的窗口（{scopedAuto.length}）</Btn></div>
  </Card>
}
