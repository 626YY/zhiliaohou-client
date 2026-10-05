import { usePolling } from '../lib/usePolling'
import { useEffect, useRef, useState } from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import type { Settings } from '@shared/types'
import { LayoutDashboard, PowerOff, Rocket } from 'lucide-react'
import { Btn, Card, Pill, Toggle } from './ui'
import { useToast } from '../stores/ui'
import { WIDGET_GROUPS, WIDGET_LAUNCHERS, openWidgets, readAutoOpenIds, readWidgetOpenState, widgetConfigRoute, writeAutoOpenIds, type WidgetGroup, type WidgetOpenState } from '../lib/widgetLaunchers'
import CaptureBackgroundToggle from './CaptureBackgroundToggle'
import {useConfigurationLevel} from '../lib/configurationLevel'

// 挂件总控：一眼看到哪些直播挂件开着，一键开启开播要用的那几个 / 全部关闭；勾上「启动时自动开」下次开客户端自动就位。
// 特色整蛊 17 个玩法共用一个窗口，这里是一行；它的横竖屏、底色在特色整蛊页顶部的「直播窗口」里设，两处是同一份开关和自动开启名单。
export default function WidgetDashboard({ groups = WIDGET_GROUPS }: { groups?: WidgetGroup[] }) {
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
  const mounted = useRef(false)
  const launchers = WIDGET_LAUNCHERS.filter((w) => groups.includes(w.group))
  const scopedAuto = auto.filter((id) => launchers.some((w) => w.id === id))
  const what = '效果'

  useEffect(() => {
    mounted.current = true
    void window.api.getSettings().then(({ settings }) => {
      if (mounted.current) setCaptureMode(settings.outputCaptureMode || 'green')
    }).catch(() => { if (mounted.current) toast('读取采集设置失败，请重新打开娱乐助手', 'error') })
    return () => { mounted.current = false }
  }, [toast])
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
    else toast(`已开启 ${scopedAuto.length} 个挂件`, 'success')
  }

  const closeAll = async () => {
    setBusy(true)
    for (const w of launchers) if (state[w.id]) await w.close().catch(() => {})
    setBusy(false)
    await refresh()
    toast('已关闭全部挂件', 'info')
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

  // 基础模式一律先给摘要条，点「管理播放窗口」再展开
  const collapsedByDefault=level==='basic'
  if(collapsedByDefault&&!managerOpen)return <div className="border-b border-[var(--line)] pb-3" data-testid="active-output-summary">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Pill tone={openCount?'ok':'muted'} dot>{openCount?`${openCount} 个${what}正在显示`:`还没有开启${what}`}</Pill>
      <div className="flex items-center gap-2">
        {scopedAuto.length>0&&<Btn size="sm" onClick={openChecked} disabled={busy}>开启已选效果（{scopedAuto.length}）</Btn>}
        {openCount>0&&<Btn size="sm" variant="secondary" onClick={closeAll} disabled={busy}>全部关闭</Btn>}
        <Btn size="sm" variant="ghost" onClick={()=>setManagerOpen(true)}>管理播放窗口</Btn>
      </div>
    </div>
    <p className="mt-2 text-xs leading-5 text-[var(--text-3)]">第一次使用：先在下面选一个功能完成配置，再点它的「开启窗口」。也可以点「管理播放窗口」统一开启、关闭和设置自动开启。</p>
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
    <ol className="mb-4 space-y-1 text-xs leading-6 text-[var(--text-3)]" aria-label="窗口管理使用步骤"><li>1. 没设置过的功能先点「去配置」，设置好后回来点「开启」。</li><li>2. 窗口开好后，到直播软件添加这个窗口的采集来源。</li><li>3. 想下次打开软件时省事，再勾选「下次启动自动开启」；勾选不会立刻打开窗口。</li></ol>
    <div className="mb-4 border-y border-[var(--line)] py-2"><CaptureBackgroundToggle mode={captureMode} onChange={changeCaptureMode} disabled={!captureMode||captureBusy}/></div>
    <div className="space-y-4">{groups.map(group=>{
      const rows=launchers.filter(w=>w.group===group)
      if(!rows.length)return null
      return <section key={group}>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--text-3)]">{group}</h3>
        <div className="divide-y divide-[var(--line)]">{rows.map(row)}</div>
      </section>
    })}</div>
    <div className="mt-4 border-t border-[var(--line)] pt-3"><p className="mb-2 text-xs leading-6 text-[var(--text-3)]">自动开启名单：{scopedAuto.length?launchers.filter(w=>scopedAuto.includes(w.id)).map(w=>w.label).join('、'):'还没有选择。手动开启也能正常使用。'}</p><Btn size="sm" disabled={busy||!scopedAuto.length} onClick={openChecked}><Rocket size={13}/>现在开启名单中的窗口（{scopedAuto.length}）</Btn></div>
  </Card>
}
