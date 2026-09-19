import {useEffect,useMemo,useRef,useState} from 'react'
import {FolderOpen} from 'lucide-react'
import type {PinyouProjectInfo,TimeBlindBoxEvent,TimeWidgetConfig,TimeWidgetGift} from '@shared/types'
import {mergeImportedBlindBoxEvents} from '@shared/timeBlindBox'
import {giftNamesEqual} from '@shared/giftName'
import {Modal} from './Modal'
import {Btn,Field,Input,Pill} from './ui'
import {timeEventText} from './TimeBlindBoxEditor'
import {DOUYIN_GIFT_NAMES} from '../data/douyinGifts'

// 基础模式的「时间视频项目 → 时间盲盒」小白路径：
// 选项目 → 只解析预览（不写配置）→ 选一个触发礼物 → 导入并绑定。
// 全程不切高级、不填脚本/窗口编号、不起名；取消不写任何配置。
type Preview={events:TimeBlindBoxEvent[];report:{project:string;added:number;skipped:number;why:string[]}[]}
type Step='project'|'gift'|'review'|'done'

const projectPrefix=(id:string)=>String(id||'').replace(/-\d+$/,'')
const baseName=(dir:string)=>dir.split(/[\\/]/).filter(Boolean).pop()||dir

/** 把预览到的事件并进现有配置，只加本项目与选定礼物的绑定，其他一律保留。 */
export function planTimeProjectBinding(config:TimeWidgetConfig,events:TimeBlindBoxEvent[],giftName:string):{patch:Partial<TimeWidgetConfig>;ids:string[];existing?:TimeWidgetGift;groupOff:boolean}{
  const merged=mergeImportedBlindBoxEvents(config.blindBoxEvents||[],events)
  const prefixes=[...new Set(events.map(e=>projectPrefix(e.id)))].filter(Boolean)
  const belongs=(id:string)=>prefixes.some(p=>String(id).startsWith(p+'-'))
  const mergedIds=new Set(merged.map(e=>e.id))
  // ★绑定要指向合并后真正存在的 id（同项目重复导入时旧批次被整批替换，不能拿被替换的旧 id）
  const ids=merged.filter(e=>belongs(e.id)).map(e=>e.id)
  const groupOff=ids.length>0&&merged.filter(e=>belongs(e.id)).every(e=>e.enabled===false)
  // 只清掉本项目里已被替换、不再存在的旧 id；别的项目和手动事件的引用一律不动
  const prune=(list:string[]|undefined)=>(list||[]).filter(id=>!belongs(id)||mergedIds.has(id))
  const name=giftName.trim()
  const list=config.gifts||[]
  const existing=list.find(g=>giftNamesEqual(g.name,name))
  const gifts:TimeWidgetGift[]=list.map(g=>{
    if(existing&&g===existing)return {...g,mode:'blindbox',blindBoxEventIds:[...new Set([...prune(g.blindBoxEventIds),...ids])]}
    if(g.mode==='blindbox'&&(g.blindBoxEventIds||[]).some(id=>belongs(id)&&!mergedIds.has(id)))return {...g,blindBoxEventIds:prune(g.blindBoxEventIds)}
    return g
  })
  if(!existing)gifts.push({name,mode:'blindbox',blindBoxEventIds:ids,op:'加减',seconds:0,seconds2:null,text:'',img:'',video:'',videoLoop:false,videoSeconds:0,showOnPanel:true})
  const patch:Partial<TimeWidgetConfig>={blindBoxEvents:merged,gifts}
  // 盲盒触发要求倒计时功能开着（主进程 handleTimeWidgetGift 先查 enable）；已开着就不动
  if(config.enable===false)patch.enable=true
  return {patch,ids,existing,groupOff}
}

export default function TimeProjectSetup({config,onClose,onApply}:{config:TimeWidgetConfig;onClose:()=>void;onApply:(patch:Partial<TimeWidgetConfig>)=>Promise<{ok:boolean;error?:string}>}){
  const [step,setStep]=useState<Step>('project')
  const [projects,setProjects]=useState<PinyouProjectInfo[]>([])
  const [root,setRoot]=useState('')
  const [listError,setListError]=useState('')
  const [picked,setPicked]=useState<{dir:string;name:string}|null>(null)
  const [preview,setPreview]=useState<Preview|null>(null)
  const [previewing,setPreviewing]=useState(false)
  const [previewError,setPreviewError]=useState('')
  const [gift,setGift]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [done,setDone]=useState<{ids:number;total:number;appended:boolean;groupOff:boolean}|null>(null)
  const live=useRef(true)
  const saving=useRef(false)
  const previewSeq=useRef(0)

  useEffect(()=>{
    live.current=true
    void window.api.pinyouProjects().then(r=>{if(!live.current)return;setProjects(r.projects||[]);setRoot(r.root||'');if(r.error)setListError('已有项目读取失败，可以直接浏览文件夹。')}).catch(()=>{if(live.current)setListError('已有项目读取失败，可以直接浏览文件夹。')})
    return()=>{live.current=false}
  },[])

  // 选中项目后只解析预览，不写任何配置
  const select=async(dir:string,name:string)=>{
    const seq=++previewSeq.current
    setPicked({dir,name});setPreview(null);setPreviewError('');setPreviewing(true)
    try{
      const r=await window.api.pinyouTimeImport([dir])
      if(!live.current||seq!==previewSeq.current)return
      if(!r.ok)setPreviewError('这个文件夹读取失败，请换一个试试。')
      else setPreview({events:r.events||[],report:r.report||[]})
    }catch{if(live.current&&seq===previewSeq.current)setPreviewError('这个文件夹读取失败，请换一个试试。')}
    finally{if(live.current&&seq===previewSeq.current)setPreviewing(false)}
  }
  const browse=async()=>{
    try{
      const r=await window.api.selectFile({title:'选择时间视频项目文件夹',properties:['openDirectory']})
      if(r.ok&&r.path)await select(r.path,baseName(r.path))
    }catch{setPreviewError('文件夹没有选成功，请重试。')}
  }

  const found=preview?.events.length??0
  const skipped=preview?.report.reduce((n,x)=>n+x.skipped,0)??0
  const reasons=[...new Set(preview?.report.flatMap(x=>x.why)||[])].slice(0,3)
  const validProject=!!picked&&!!preview&&found>0&&!previewing
  const giftName=gift.trim()
  const existing=useMemo(()=>(config.gifts||[]).find(g=>giftNamesEqual(g.name,giftName)),[config.gifts,giftName])
  const existingText=existing?(existing.mode==='blindbox'
    ?`「${existing.name}」已经是抽时间盲盒，本项目的 ${found} 个事件会追加到它的奖池里，原有 ${(existing.blindBoxEventIds||[]).length} 个事件保留。`
    :`「${existing.name}」现在是直接改时间（${existing.seconds>0?'+':''}${existing.seconds} 秒）。确认后会改成抽时间盲盒，原来的加减数值仍留在设置里，但不再生效。`):''
  const giftChoices=useMemo(()=>{
    const seen=new Set<string>();const out:string[]=[]
    for(const n of [...(config.gifts||[]).map(g=>g.name),'小心心','鲜花','棒棒糖','大啤酒']){const v=String(n||'').trim();if(v&&!seen.has(v)){seen.add(v);out.push(v)}}
    return out.slice(0,8)
  },[config.gifts])

  const apply=async()=>{
    if(saving.current||!validProject||!giftName||!preview)return
    saving.current=true;setBusy(true);setError('')
    try{
      const plan=planTimeProjectBinding(config,preview.events,giftName)
      const r=await onApply(plan.patch)
      if(!live.current)return
      if(r.ok){setDone({ids:plan.ids.length,total:(plan.patch.blindBoxEvents||[]).length,appended:!!plan.existing,groupOff:plan.groupOff});setStep('done')}
      else setError(r.error||'设置没有保存成功，请重试。')
    }catch{if(live.current)setError('设置没有保存成功，请重试。')}
    finally{if(live.current)setBusy(false);saving.current=false}
  }

  const question={project:'选一个时间视频项目',gift:'观众送哪个礼物来抽时间？',review:'确认一下，导入后就这样用',done:'导入完成'}[step]
  const footer=step==='done'
    ?<Btn onClick={onClose}>完成</Btn>
    :<>
      <Btn variant="secondary" disabled={busy} onClick={onClose}>取消</Btn>
      {step!=='project'&&<Btn variant="secondary" disabled={busy} onClick={()=>setStep(step==='review'?'gift':'project')}>上一步</Btn>}
      {step==='project'&&<Btn disabled={!validProject} onClick={()=>setStep('gift')}>下一步</Btn>}
      {step==='gift'&&<Btn disabled={!giftName} onClick={()=>setStep('review')}>下一步</Btn>}
      {step==='review'&&<Btn disabled={busy||!validProject||!giftName} onClick={()=>void apply()}>{busy?'导入中…':'导入并绑定'}</Btn>}
    </>
  return <Modal open onClose={onClose} closeDisabled={busy} closeOnBackdrop={false} title="导入时间视频项目" width={600} fixedFooter footer={footer}>
    <h3 className="mb-3 text-base font-semibold text-[var(--text)]" data-testid="time-project-question">{question}</h3>
    <div className="space-y-4" data-time-project-step={step}>
      {step==='project'&&<>
        <p className="text-sm leading-6 text-[var(--text-3)]">时间视频项目是一个文件夹：每个视频旁边有同名脚本写着加多少、减多少时间。观众送礼物时随机抽一条，播视频并改时间。</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]"><span className="min-w-0 flex-1 truncate">{root?`素材库：${root}`:'还没设置素材库，可以直接浏览文件夹。'}</span><Btn size="sm" variant="secondary" onClick={()=>void browse()}><FolderOpen size={13}/>浏览文件夹</Btn></div>
        {listError&&<p className="text-xs text-[var(--warn)]">{listError}</p>}
        {projects.length>0&&<div role="radiogroup" aria-label="已有项目" className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-[var(--line)] p-1">
          {projects.map(p=>{const on=picked?.dir===p.dir;return <button key={p.dir} type="button" role="radio" aria-checked={on} onClick={()=>void select(p.dir,p.name)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-[var(--bg-elev)] ${on?'bg-[var(--accent-soft)] text-[var(--accent-2)]':'text-[var(--text)]'}`}>
            <span className="min-w-0 flex-1 truncate">{p.name}</span><span className="tnum text-xs text-[var(--text-3)]">{p.videos} 个视频</span>{p.paired?<Pill tone="ok">{p.paired} 个带动作</Pill>:<Pill tone="muted">纯视频</Pill>}
          </button>})}
        </div>}
        {!projects.length&&!listError&&<p className="text-xs text-[var(--text-4)]">{root?'素材库里没有找到项目。':''}点「浏览文件夹」选一个装着视频和脚本的文件夹。</p>}
        {picked&&<div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3 text-sm" data-testid="time-project-preview">
          <div className="mb-1 font-medium text-[var(--text)]">已选：{picked.name}</div>
          {previewing&&<p role="status" className="text-[var(--text-3)]">正在识别…</p>}
          {previewError&&<p role="alert" className="text-[var(--danger)]">{previewError}</p>}
          {preview&&!previewing&&(found>0
            ?<><p role="status" className="text-[var(--text-2)]">识别到 {found} 个时间事件{skipped?`，跳过 ${skipped} 个`:''}。{reasons.length>0&&<span className="text-[var(--text-4)]">（跳过原因：{reasons.join('；')}）</span>}</p>
              <ul className="mt-2 grid gap-1 text-xs text-[var(--text-3)] sm:grid-cols-2">{preview.events.slice(0,8).map(e=><li key={e.id} className="truncate">{e.name} · <span className="tnum text-[var(--accent-2)]">{timeEventText(e)}</span></li>)}</ul>
              {found>8&&<p className="mt-1 text-xs text-[var(--text-4)]">…还有 {found-8} 个</p>}</>
            :<p role="alert" className="text-[var(--danger)]">这个文件夹里没有识别到时间事件{reasons.length?`（${reasons.join('；')}）`:''}。请换一个时间类项目：视频旁边要有写着「加班增加:60秒」这类的脚本。</p>)}
        </div>}
      </>}
      {step==='gift'&&<>
        <p className="text-sm leading-6 text-[var(--text-3)]">观众每送一个这个礼物，就从「{picked?.name}」的 {found} 个事件里随机抽一条。可以直接点一个，也可以输入别的礼物名称。</p>
        <div className="flex flex-wrap gap-2">{giftChoices.map(n=><Btn key={n} variant={gift===n?'primary':'secondary'} onClick={()=>setGift(n)}>{n}</Btn>)}</div>
        <Field label="礼物名称"><Input aria-label="抽时间的礼物" value={gift} onChange={e=>setGift(e.target.value)} list="time-project-gifts" placeholder="例如：小心心"/><datalist id="time-project-gifts">{DOUYIN_GIFT_NAMES.map(n=><option key={n} value={n}/>)}</datalist></Field>
        {existingText&&<p role="note" className="text-xs leading-6 text-[var(--warn)]">{existingText}</p>}
      </>}
      {step==='review'&&<>
        <div className="border-l-2 border-[var(--accent)] pl-4 text-sm leading-8 text-[var(--text)]">
          <p>项目：{picked?.name}（{found} 个时间事件）</p>
          <p>礼物：每个「{giftName}」随机抽一条，播视频并改时间</p>
          <p>{existing?(existing.mode==='blindbox'?'追加到这个礼物原有的奖池':'这个礼物改成抽时间盲盒'):'新增一个礼物格，其他礼物不变'}</p>
        </div>
        {existingText&&<p role="note" className="text-xs leading-6 text-[var(--warn)]">{existingText}</p>}
        <p className="text-xs leading-6 text-[var(--text-3)]">已有的事件和别的礼物设置全部保留。{config.enable===false?'倒计时功能会一并打开。':''}同一个项目再导入一次不会重复增加事件。</p>
      </>}
      {step==='done'&&done&&<>
        <p role="status" className="text-sm leading-7 text-[var(--text-2)]">已导入 {done.ids} 个时间事件，{done.appended?`追加到「${giftName}」的奖池`:`绑定到「${giftName}」`}。事件库现在共 {done.total} 个事件。</p>
        {done.groupOff&&<p className="text-xs leading-6 text-[var(--warn)]">这个项目之前被整组停用，本次保持停用；要用的时候在「时间盲盒与更多设置」里把项目开关打开。</p>}
        <p className="text-xs leading-6 text-[var(--text-3)]">接下来开启倒计时窗口并连接直播间，观众送「{giftName}」就会随机播一条视频并改时间。想看或调整每条事件，点「时间盲盒与更多设置」。</p>
      </>}
    </div>
    {error&&<p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
  </Modal>
}
