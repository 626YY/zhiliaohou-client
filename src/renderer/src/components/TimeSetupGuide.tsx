import {useRef,useState} from 'react'
import type {TimeWidgetConfig,TimeWidgetGift,TimeWidgetState} from '@shared/types'
import {giftNamesEqual} from '@shared/giftName'
import {Btn,Card,Field,Input,Segmented} from './ui'
import {DOUYIN_GIFT_NAMES} from '../data/douyinGifts'

// onImportProject：基础模式里「时间视频项目 → 时间盲盒」的入口（弹 TimeProjectSetup 向导），不传就不显示按钮
export default function TimeSetupGuide({config,state,hasSavedSettings,onApply,onOpen,onClose,onMore,onImportProject}:{config:TimeWidgetConfig;state:TimeWidgetState;hasSavedSettings:boolean;onApply:(patch:Partial<TimeWidgetConfig>)=>Promise<{ok:boolean;error?:string}>;onOpen:()=>Promise<{ok:boolean;error?:string}>;onClose:()=>Promise<void>;onMore:()=>void;onImportProject?:()=>void}){
  const [step,setStep]=useState<'time'|'ask-gift'|'gift'|'change'|'review'|'ready'>('time')
  const [minutes,setMinutes]=useState(String(config.initial/60))
  const [useGift,setUseGift]=useState(false),[gift,setGift]=useState(''),[seconds,setSeconds]=useState('30')
  const [direction,setDirection]=useState<'add'|'subtract'>('add')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const saving=useRef(false)
  const duration=Number(minutes),change=Number(seconds)
  const validTime=minutes.trim()!==''&&Number.isFinite(duration)&&duration>=0
  const validChange=seconds.trim()!==''&&Number.isFinite(change)&&change>0
  const existing=hasSavedSettings?(config.gifts||[]).find(g=>giftNamesEqual(g.name,gift)):undefined
  const apply=async()=>{
    if(saving.current||!validTime||(useGift&&(!gift.trim()||!validChange)))return
    saving.current=true;setBusy(true);setError('')
    const patch:Partial<TimeWidgetConfig>={initial:Math.round(duration*60),...(!hasSavedSettings?{gifts:[],addGift:'',subGift:''}:{})}
    if(useGift){
      const updated:TimeWidgetGift={...(existing||{name:gift.trim(),op:'加减',seconds:0}),name:gift.trim(),mode:'direct',op:'加减',seconds:(direction==='add'?1:-1)*change,seconds2:null}
      const kept=hasSavedSettings?config.gifts||[]:[]
      patch.gifts=existing?kept.map(g=>g===existing?updated:g):[...kept,updated]
    }
    try{const r=await onApply(patch);if(r.ok)setStep('ready');else setError(r.error||'设置没有保存成功，请重试。')}
    catch{setError('设置没有保存成功，请重试。')}
    finally{setBusy(false);saving.current=false}
  }
  const open=async()=>{setBusy(true);setError('');try{const r=await onOpen();if(!r.ok)setError(r.error||'倒计时没有打开，请重试。')}catch{setError('倒计时没有打开，请重试。')}finally{setBusy(false)}}
  const question={time:'先设置多长时间？','ask-gift':'需要观众送礼物来加减时间吗？',gift:'用哪个礼物来改变时间？',change:'这个礼物要加时间还是减时间？',review:'确认一下，你要这样用吗？',ready:'配置完成，接下来开启倒计时'}[step]
  const back=()=>setStep(step==='ask-gift'?'time':step==='gift'?'ask-gift':step==='change'?'gift':step==='review'?(useGift?'change':'ask-gift'):'time')
  return <Card>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold text-[var(--accent-2)]">跟着设置倒计时</span><div className="flex gap-2">{!state.open&&<Btn size="sm" variant="secondary" disabled={busy} onClick={()=>void open()}>开启现有倒计时</Btn>}{state.open&&<Btn size="sm" variant="secondary" onClick={()=>void onClose()}>关闭倒计时窗口</Btn>}{onImportProject&&<Btn size="sm" variant="secondary" onClick={onImportProject} title="选一个时间视频项目文件夹，绑定到一个礼物，观众送礼随机抽一条视频并改时间">导入时间视频项目</Btn>}<Btn size="sm" variant="ghost" onClick={onMore}>时间盲盒与更多设置</Btn></div></div>
    <h3 className="mb-3 text-lg font-semibold text-[var(--text)]" data-testid="time-setup-question">{question}</h3>
    <div className="space-y-4" data-time-setup={step}>
      {step==='time'&&<><p className="text-sm text-[var(--text-3)]">点一个常用时长，或者自己填分钟。选好后点下一步。</p><div className="flex flex-wrap gap-2">{[5,10,30,60].map(n=><Btn key={n} variant={Number(minutes)===n?'primary':'secondary'} onClick={()=>setMinutes(String(n))}>{n} 分钟</Btn>)}</div><Field label="自己填写分钟" hint="例如 5 就是 5 分钟；填 0 可以从零开始累计。"><Input aria-label="倒计时分钟" inputMode="decimal" value={minutes} onChange={e=>setMinutes(e.target.value)}/></Field></>}
      {step==='ask-gift'&&<><p className="text-sm leading-6 text-[var(--text-3)]">想做纯倒计时就跳过。想让一个礼物增加或减少时间，就点“设置礼物”。{hasSavedSettings?'已有礼物设置会保留。':'跳过后就是纯倒计时，不启用示例礼物。'}</p><div className="flex gap-3"><Btn variant="secondary" onClick={()=>{setUseGift(true);setStep('gift')}}>设置礼物</Btn><Btn onClick={()=>{setUseGift(false);setStep('review')}}>{hasSavedSettings?'跳过，保留已有礼物':'跳过，先用倒计时'}</Btn></div></>}
      {step==='gift'&&<><p className="text-sm text-[var(--text-3)]">可以直接点一个，也可以输入别的礼物名称。</p><div className="flex flex-wrap gap-2">{['小心心','鲜花','棒棒糖','大啤酒'].map(n=><Btn key={n} variant={gift===n?'primary':'secondary'} onClick={()=>setGift(n)}>{n}</Btn>)}</div><Field label="礼物名称"><Input aria-label="倒计时触发礼物" value={gift} onChange={e=>setGift(e.target.value)} list="time-setup-gifts" placeholder="例如：小心心"/><datalist id="time-setup-gifts">{DOUYIN_GIFT_NAMES.map(n=><option key={n} value={n}/>)}</datalist></Field></>}
      {step==='change'&&<><Segmented value={direction} onChange={setDirection} options={[{value:'add',label:'增加时间'},{value:'subtract',label:'减少时间'}]}/><Field label="每个礼物改变多少秒" hint="例如 30 就是半分钟，60 就是 1 分钟。"><Input aria-label="礼物改变秒数" inputMode="decimal" value={seconds} onChange={e=>setSeconds(e.target.value)}/></Field></>}
      {step==='review'&&<><div className="border-l-2 border-[var(--accent)] pl-4 text-sm leading-8 text-[var(--text)]"><p>初始时间：{minutes} 分钟</p><p>{useGift?`每个「${gift}」${direction==='add'?'增加':'减少'} ${seconds} 秒`:'先用倒计时，不新增礼物设置。'}</p></div>{existing&&useGift&&<p className="text-xs leading-6 text-[var(--warn)]">「{gift}」已有设置，确认后将改成上述固定加减时间；其他礼物不变，已有的视频等设置保留。</p>}<p className="text-sm text-[var(--text-3)]">保存后还有一步：开启播放窗口。软件不会自动开始直播。</p></>}
      {step==='ready'&&<><p className="text-sm leading-7 text-[var(--text-2)]">{state.open?'倒计时窗口已经开启。':'点下面的按钮，倒计时窗口就会出现在电脑上。'}然后在直播软件里添加这个窗口的采集来源，观众才能看到。</p>{state.open?<p role="status" className="text-sm text-[var(--ok)]">倒计时已开启 · 当前剩余 {Math.round(state.remaining)} 秒。当前计时不会被引导重置。</p>:<Btn onClick={()=>void open()} disabled={busy}>开启倒计时窗口</Btn>}<p className="text-xs leading-6 text-[var(--text-3)]">用直播伴侣时，添加窗口捕获，选择“倒计时”，并对绿底开启绿幕抠像。需要礼物触发时，再连接直播间。</p><Btn variant="ghost" size="sm" onClick={()=>setStep('time')}>重新走一遍设置</Btn></>}
    </div>
    {error&&<p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    {step!=='ready'&&<div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-3">{step==='time'?<span className="text-xs text-[var(--text-3)]">这里开始，三件事就能用起来。</span>:<Btn variant="secondary" disabled={busy} onClick={back}>上一步</Btn>}{step==='time'&&<Btn disabled={!validTime} onClick={()=>setStep('ask-gift')}>下一步</Btn>}{step==='gift'&&<Btn disabled={!gift.trim()} onClick={()=>setStep('change')}>下一步</Btn>}{step==='change'&&<Btn disabled={!validChange} onClick={()=>setStep('review')}>下一步</Btn>}{step==='review'&&<Btn disabled={busy} onClick={()=>void apply()}>{busy?'保存中…':'保存，去开启窗口'}</Btn>}</div>}
  </Card>
}
