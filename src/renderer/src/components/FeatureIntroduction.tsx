import {useEffect,useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {HelpCircle} from 'lucide-react'
import {FEATURE_GUIDES} from '../lib/featureGuides'
import {Btn} from './ui'
import {Modal} from './Modal'
import {FEATURE_WALKTHROUGHS} from '../lib/featureWalkthroughs'
import {findGuideTarget,revealGuideTarget} from '../lib/guideNavigation'
import {useConfigurationLevel} from '../lib/configurationLevel'
import {useToast} from '../stores/ui'

// 有些页面要等主进程状态回来才渲染表单（滤镜设置/礼物动画等），点得早就先等一小会再说找不到
const LOCATE_RETRY_MS=150,LOCATE_TIMEOUT_MS=2500

export default function FeatureIntroduction({feature,title}:{feature:string;title:string}){
  const [open,setOpen]=useState(false)
  const [expanded,setExpanded]=useState(true),[step,setStep]=useState(0)
  const {level}=useConfigurationLevel(),navigate=useNavigate(),toast=useToast(s=>s.toast)
  const marked=useRef<HTMLElement|null>(null),timer=useRef<ReturnType<typeof setTimeout>>(),pending=useRef<ReturnType<typeof setTimeout>>()
  const hasWindow=['gift','green','video','wheel','nine','time','challenge','overtime','effects','progress','marquee','entrance','keyboard','obs'].includes(feature)
  const guide=FEATURE_GUIDES[feature]
  const walk=FEATURE_WALKTHROUGHS[feature]
  useEffect(()=>{setStep(0);setExpanded(true);return()=>{if(timer.current)clearTimeout(timer.current);if(pending.current)clearTimeout(pending.current);marked.current?.removeAttribute('data-guide-focus')}},[feature])
  // 只定位：展开折叠区、滚过去、描个框、把焦点放到控件上。不点按钮、不改任何配置、不切高级。
  const locate=()=>{
    marked.current?.removeAttribute('data-guide-focus')
    if(pending.current)clearTimeout(pending.current)
    const target=walk?.[step]?.target
    if(!target)return
    if('route' in target){navigate(target.route);return}
    const started=Date.now()
    const attempt=()=>{
      const scope=document.querySelector(`[data-feature-content="${feature}"]`)
      const match=scope?findGuideTarget(scope,target):null
      if(!match){
        if(Date.now()-started<LOCATE_TIMEOUT_MS){pending.current=setTimeout(attempt,LOCATE_RETRY_MS);return}
        toast('先完成前面的选择，这项设置才会出现。可以按本页引导从第一步开始。','info');return
      }
      revealGuideTarget(match)
      const {highlight,control}=match
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(!highlight.isConnected)return
        marked.current?.removeAttribute('data-guide-focus');if(timer.current)clearTimeout(timer.current)
        highlight.setAttribute('data-guide-focus','true');marked.current=highlight
        highlight.scrollIntoView({block:'center',behavior:'smooth'})
        control?.focus({preventScroll:true})
        timer.current=setTimeout(()=>highlight.removeAttribute('data-guide-focus'),8000)
      }))
    }
    attempt()
  }
  if(!guide)return null
  return <>
    {level==='basic'&&walk&&<section className="mb-4 border-b border-[var(--line)] pb-4" data-testid="basic-feature-guide">
      <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-semibold text-[var(--text)]">第一次用{title}？从这里开始</span><div className="flex gap-2"><Btn variant="ghost" size="sm" aria-label="怎么设置" onClick={()=>setOpen(true)}><HelpCircle size={14}/></Btn><Btn variant="ghost" size="sm" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{expanded?'收起引导':'展开引导'}</Btn></div></div>
      {expanded&&<><ol className="mb-3 flex flex-wrap gap-2" aria-label={`${title}操作引导`}>{guide.steps.map((label,i)=><li key={label}><Btn size="sm" variant={step===i?'secondary':'ghost'} aria-current={step===i?'step':undefined} onClick={()=>setStep(i)}>{i+1}. {label}</Btn></li>)}</ol><p className="mb-3 max-w-3xl text-sm leading-7 text-[var(--text-2)]">{walk[step].instruction}</p><div className="flex flex-wrap gap-2"><Btn size="sm" onClick={locate}>{step===0?'带我开始配置':step===1?'带我找到设置':'带我找到操作按钮'}</Btn><Btn size="sm" variant="ghost" onClick={()=>navigate(hasWindow?'/ent?manage=1':'/ent')}>{hasWindow?'查看窗口在哪开启':'返回功能列表'}</Btn></div></>}
    </section>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3" style={level==='basic'?{display:'none'}:undefined}>
      <ol className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--text-3)]" aria-label={`${title}设置步骤`}>
        {guide.steps.map((step,index)=><li key={step} className="flex items-center gap-2"><span className="tnum flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-semibold text-[var(--accent-2)]">{index+1}</span>{step}</li>)}
      </ol>
      <Btn variant="ghost" size="sm" onClick={()=>setOpen(true)}><HelpCircle size={14}/>怎么设置</Btn>
    </div>
    <Modal open={open} onClose={()=>setOpen(false)} title={`${title} · 使用说明`} width={480} footer={<Btn variant="secondary" onClick={()=>setOpen(false)}>知道了</Btn>}>
      <ol className="space-y-3 text-sm text-[var(--text-2)]">{guide.steps.map((step,index)=><li key={step}><span className="mr-3 text-[var(--accent-2)]">{index+1}.</span>{step}</li>)}</ol>
      {guide.tip&&<p className="mt-4 text-sm leading-6 text-[var(--text-3)]">{guide.tip}</p>}
      <p className="mt-4 text-xs leading-6 text-[var(--text-4)]">基础模式就能完成常用配置、开启和窗口管理。折叠的设置可以按需要展开，不必切换高级。已有设置不会因为收起而改变。</p>
      <p className="mt-2 text-xs leading-6 text-[var(--text-4)]">{hasWindow?'要在直播中显示效果，先开启对应窗口，再到直播软件添加窗口采集来源。':feature==='transparent'?'导出图片后，到直播软件添加图片素材即可，无需开启独立窗口。':'这个功能不需要单独开启采集窗口，按页面上的操作按钮使用即可。'}</p>
    </Modal>
  </>
}
