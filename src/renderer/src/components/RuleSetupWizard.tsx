import {useEffect,useRef,useState} from 'react'
import type {EntertainmentAction,EntertainmentRule,PinyouItemActions,PinyouProjectInfo,PinyouProjectItem} from '@shared/types'
import {actionLabel,splitVideoParam} from '@shared/entertainmentLabels'
import {giftNamesEqual} from '@shared/giftName'
import {FolderOpen,ArrowLeft,ArrowRight,Check} from 'lucide-react'
import {Btn,Field,Input,Select,Segmented} from './ui'
import {Modal} from './Modal'
import {SHORTCUT_OPTIONS} from './KeySequencePicker'
import {DOUYIN_GIFT_NAMES} from '../data/douyinGifts'
import {fileName,mediaFileUrl,SETUP_KINDS,setupKind,setupRule,setupSource,type SetupKind} from '../lib/ruleSetup'
import {splitTargetSuffix} from '../utils/videoTarget'
import SpecialPicker from './special/SpecialPicker'
import GamePrankSelect from './GamePrankSelect'
import {parseSpecialParam,specialActionText,specialBoxText,SPECIAL_GAME_MAP} from '@shared/specialGames'

type Stage='kind'|'material'|'extra-choice'|'extra-type'|'extra-value'|'gift'|'review'|'done'
type ExtraKind='key'|'countdown-adjust'|'count-adjust'|'overtime-adjust'
const EXTRA_TYPES:{id:ExtraKind;label:string}[]=[{id:'key',label:'按一个快捷键'},{id:'countdown-adjust',label:'倒计时加减时间'},{id:'count-adjust',label:'计数挑战加减数字'},{id:'overtime-adjust',label:'加班器加减时间'}]

export default function RuleSetupWizard({initialKind,initialRule,onClose,onSaved,onAdvanced}:{
  initialKind?:SetupKind;initialRule?:EntertainmentRule;onClose:()=>void;onSaved:()=>void;onAdvanced:(rule:EntertainmentRule)=>void
}){
  const initial=initialKind||setupKind(initialRule)
  const fixedKind=!!initial
  const [kind,setKind]=useState<SetupKind>(initial||'video')
  const [stage,setStage]=useState<Stage>(initial?'material':'kind')
  const [history,setHistory]=useState<Stage[]>([])
  const [sources,setSources]=useState<Record<SetupKind,string>>(()=>({special:'',game:'',video:'',box:'',sound:'',key:'',...(initial?{[initial]:setupSource(initialRule)}:{})}))
  const source=sources[kind]
  const [projects,setProjects]=useState<PinyouProjectInfo[]>([])
  const [items,setItems]=useState<PinyouProjectItem[]>([])
  const [itemActions,setItemActions]=useState<Record<string,PinyouItemActions>>({})
  const [sample,setSample]=useState(0)
  const [gift,setGift]=useState(initialRule?.giftName||'')
  const [existing,setExisting]=useState<EntertainmentRule[]>([])
  const [wantExtra,setWantExtra]=useState(false)
  const [extraKind,setExtraKind]=useState<ExtraKind>('key')
  const [extraKey,setExtraKey]=useState('')
  const [amount,setAmount]=useState('30')
  const [direction,setDirection]=useState<'add'|'subtract'>('add')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [mediaError,setMediaError]=useState('')
  const [previewReady,setPreviewReady]=useState(false),[previewVersion,setPreviewVersion]=useState(0)
  const [notice,setNotice]=useState('')
  const [uncertain,setUncertain]=useState(false)
  const [savedEnabled,setSavedEnabled]=useState(false)
  const [outputReady,setOutputReady]=useState('')
  const live=useRef(true),generation=useRef(0),saving=useRef(false)
  const heading=useRef<HTMLHeadingElement>(null)
  const numeric=Number(amount)
  const extraValid=extraKind==='key'?!!extraKey:amount.trim()!==''&&Number.isFinite(numeric)&&numeric>0
  const addition:EntertainmentAction|undefined=wantExtra&&extraValid?(extraKind==='key'?{actionType:'key',keySeq:extraKey}:{actionType:'command',commandCmd:extraKind,commandParam:String((direction==='add'?1:-1)*numeric)}):undefined
  const draft=setupRule(initialRule,kind,source,gift,addition)
  const unsupported=!!initialRule&&(!setupKind(initialRule)||(initialRule.triggerType&&initialRule.triggerType!=='gift'))
  const mediaPath=kind==='box'?items[sample]?.video:source
  const originalExtras=initialRule?.extraActions||[]
  const paired=items.filter(it=>it.hasScript&&itemActions[it.name]?.useScript!==false).length
  const custom=items.filter(it=>itemActions[it.name]?.actions?.length).length
  const matching=existing.filter(r=>r.id!==initialRule?.id&&r.enabled!==false&&(!r.triggerType||r.triggerType==='gift')&&giftNamesEqual(r.giftName,gift))
  const chosen=SETUP_KINDS.find(k=>k.id===kind)!
  // 特色整蛊 / 游戏整蛊不用选文件：选中玩法 / 整蛊就算选好
  const specialBox=kind==='special'&&source.startsWith('box:')&&!!source.slice(4).split('|')[0]
  const specialId=kind==='special'&&!specialBox?parseSpecialParam(source).id:''
  const gamePrankName=kind==='game'?(source.split('|')[2]||source.split('|')[1]||''):''
  const materialValid=kind==='key'?!!source:kind==='special'?(!!specialId||specialBox):kind==='game'?!!source.split('|')[1]:!!source.trim()&&previewReady&&(kind!=='box'||items.length>0)

  const readFolder=async(dir:string)=>{
    const ticket=++generation.current
    setBusy(true);setError('');setMediaError('');setPreviewReady(false);setPreviewVersion(v=>v+1);setItems([]);setSources(s=>({...s,box:dir}))
    try{
      const r=await window.api.pinyouItemActionsGet(dir)
      if(!live.current||ticket!==generation.current)return
      if(!r.ok||!r.items.length){setError(r.error||'这个文件夹里没有视频，请选择直接放着视频的文件夹。');return}
      setSources(s=>({...s,box:r.dir||dir}));setItems(r.items);setItemActions(r.actions);setSample(0)
    }catch{if(live.current&&ticket===generation.current)setError('视频没有读出来，请重新选择文件夹。')}
    finally{if(live.current&&ticket===generation.current)setBusy(false)}
  }
  useEffect(()=>{
    live.current=true
    void window.api.pinyouProjects().then(r=>{if(live.current){setProjects(r.projects);if(r.error)setNotice('已有项目读取失败，可以直接选择视频文件夹。')}}).catch(()=>{if(live.current)setNotice('已有项目读取失败，可以直接选择视频文件夹。')})
    void window.api.entertainmentRulesList().then(r=>{if(live.current)setExisting(r)}).catch(()=>{})
    if(initial==='box'&&setupSource(initialRule))void readFolder(setupSource(initialRule))
    return()=>{live.current=false;generation.current++}
  },[])
  useEffect(()=>{heading.current?.focus({preventScroll:true});const dialog=heading.current?.closest('[data-modal-scroll]');if(dialog)dialog.scrollTop=0},[stage])
  const go=(next:Stage)=>{setHistory(h=>[...h,stage]);setStage(next);setError('')}
  const back=()=>{const next=history.at(-1);if(next){setHistory(h=>h.slice(0,-1));setStage(next);setError('')}}
  const pick=async()=>{
    if(busy)return
    setBusy(true);setError('')
    try{
      const r=await window.api.selectFile({title:kind==='box'?'选择放着视频的文件夹':kind==='sound'?'选择一个音效文件':'选择一个视频文件',properties:[kind==='box'?'openDirectory':'openFile'],...(kind==='box'?{}:{filters:[{name:kind==='sound'?'音效':'视频',extensions:kind==='sound'?['mp3','wav','ogg','m4a','aac']:['mp4','webm','mov','mkv','avi','flv','m4v']}]})})
      if(!live.current||!r.ok||!r.path)return
      if(kind==='box')await readFolder(r.path)
      else{setSources(s=>({...s,[kind]:r.path!}));setMediaError('');setPreviewReady(false);setPreviewVersion(v=>v+1)}
    }catch{if(live.current)setError('文件没有选成功，请重试。')}
    finally{if(live.current)setBusy(false)}
  }
  const save=async(enabled:boolean)=>{
    if(stage!=='review'||saving.current||uncertain||!materialValid||!gift.trim())return
    saving.current=true;setBusy(true);setError('')
    try{
      const rule={...draft,enabled}
      const r=rule.id?await window.api.entertainmentRuleUpdate(rule):await window.api.entertainmentRuleAdd(rule)
      if(!live.current)return
      if(!r.ok){setError(r.error||'没有保存成功，请重试。');return}
      setSavedEnabled(enabled);setStage('done');onSaved()
    }catch{if(live.current){setUncertain(true);setError('保存结果尚未确认，请返回列表检查，避免重复创建。');onSaved()}}
    finally{if(live.current)setBusy(false);saving.current=false}
  }
  const prepareOutput=async()=>{
    setBusy(true);setError('')
    try{
      // 特色整蛊：开它自己的玩法窗口（窗口名就是玩法名）
      if(kind==='special'&&specialId){
        const name=SPECIAL_GAME_MAP[specialId]?.name||'玩法'
        const r=await window.api.specialOpen(specialId)
        if(live.current){if(r.ok)setOutputReady(`「${name}」窗口已开启。到直播软件添加窗口采集，选「${name}」，绿幕底色记得开抠像。`);else setError(r.error||'窗口没能打开，请重试。')}
        return
      }
      const target=splitTargetSuffix(draft.commandParam||'').target
      if(target==='v'){setOutputReady('这条旧规则使用独立视频播放器，请在「视频播放器」中开启主窗口。');return}
      const [state,{settings}]=await Promise.all([window.api.greenScreenState(),window.api.getSettings()])
      const slot=(target!=='0'?Number(target):[1,2,3,4].includes(Number(settings.videoDefaultSlot))?Number(settings.videoDefaultSlot):1) as 1|2|3|4
      const open=state.slots.filter(s=>s.open)
      if(open.some(s=>s.slot===slot)||(target==='0'&&open.length)){if(live.current)setOutputReady('播放窗口已经开好。到直播软件添加它的窗口采集来源即可。');return}
      const r=await window.api.greenScreenOpen('','image','',slot)
      if(live.current){if(r.ok)setOutputReady(`${slot} 号绿幕窗口已开启。到直播软件添加这个窗口，并开启绿幕抠像。`);else setError(r.error||'窗口没能打开，请重试。')}
    }catch{if(live.current)setError('播放窗口没能打开，请重试。')}
    finally{if(live.current)setBusy(false)}
  }
  const steps=[...(!fixedKind?['选效果']:[]),kind==='key'?'选快捷键':kind==='special'?'选玩法':kind==='game'?'选整蛊':'选素材',...(kind==='key'?[]:['要不要加动作']),'选礼物','确认完成']
  const index=stage==='kind'?0:stage==='material'?(fixedKind?0:1):stage.startsWith('extra')?(fixedKind?1:2):stage==='gift'?steps.length-2:steps.length-1
  const questions:Record<Stage,string>={kind:'收到礼物后，你想做什么？',material:kind==='key'?'要按哪个快捷键？':kind==='special'?'要放哪个特色整蛊？':kind==='game'?'要触发哪个游戏整蛊？':kind==='box'?'把哪些视频放进盲盒？':kind==='sound'?'要播放哪个声音？':'要播放哪个视频？','extra-choice':kind==='sound'?'声音响起时，要不要顺便触发动作？':kind==='special'||kind==='game'?'触发时，要不要顺便做点别的？':'视频开始时，要不要顺便触发动作？','extra-type':'你想顺便触发什么？','extra-value':extraKind==='key'?'要按哪个快捷键？':extraKind==='count-adjust'?'数字要增加还是减少？':'时间要增加还是减少？',gift:'观众送哪个礼物时触发？',review:'这样设置，对吗？',done:savedEnabled?'设置完成，已启用':'设置已保存，暂未启用'}
  const next=()=>{if(stage==='material')go(kind==='key'?'gift':'extra-choice');else if(stage==='extra-value')go('gift');else if(stage==='gift')go('review')}
  const canNext=stage==='material'?materialValid:stage==='extra-value'?extraValid:!!gift.trim()
  const unfinished=stage==='material'?(kind==='key'?'先选择一个快捷键。':kind==='special'?'先点一个玩法。':kind==='game'?'先选一个游戏整蛊。':`先${kind==='box'?'选择一个有视频的文件夹':'选择要使用的文件'}。`):stage==='gift'?'先选择或填写一个礼物。':'先填好要触发的动作。'
  const keyPicker=(value:string,onChange:(v:string)=>void)=><Field label="要按的快捷键" hint="选游戏或直播软件里已经设置好的快捷键；这里不会真的按键。"><Select value={value} onChange={e=>onChange(e.target.value)}><option value="">请选择…</option>{value&&!SHORTCUT_OPTIONS.some(k=>k.value===value)&&<option value={value}>已有快捷键：{value}</option>}{SHORTCUT_OPTIONS.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>

  return <Modal open fixedFooter onClose={onClose} closeDisabled={busy} closeOnBackdrop={false} title={initialRule?.id?'修改礼物互动':initialKind==='box'?'创建视频盲盒':'添加礼物互动'} width={620}
    footer={<div className="w-full border-t border-[var(--line)] pt-3">
      {!unsupported&&stage!=='done'&&<div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--text-3)]"><span>{!canNext&&['material','extra-value','gift'].includes(stage)?unfinished:'可以随时上一步，已选内容会保留。'}</span><Btn variant="ghost" size="sm" disabled={busy} onClick={()=>onAdvanced(draft)}>高级设置</Btn></div>}
      <div className="flex items-center justify-between gap-2"><Btn variant="ghost" disabled={busy} onClick={onClose}>{stage==='done'?'返回规则列表':'取消'}</Btn><div className="flex gap-2">
        {!!history.length&&stage!=='done'&&<Btn variant="secondary" disabled={busy} onClick={back}><ArrowLeft size={14}/>上一步</Btn>}
        {['material','extra-value','gift'].includes(stage)&&!unsupported&&<Btn onClick={next} disabled={busy||!canNext}>下一步<ArrowRight size={14}/></Btn>}
        {stage==='review'&&!unsupported&&<><Btn variant="secondary" disabled={busy||uncertain} onClick={()=>void save(false)}>先保存，不启用</Btn><Btn disabled={busy||uncertain} onClick={()=>void save(initialRule?.id?initialRule.enabled!==false:true)}>{busy?'保存中…':initialRule?.id?'保存修改':'完成并启用'}</Btn></>}
        {stage==='done'&&(kind==='video'||kind==='box')&&<Btn disabled={busy} onClick={()=>void prepareOutput()}>准备播放窗口</Btn>}
        {stage==='done'&&kind==='special'&&!specialBox&&<Btn disabled={busy} onClick={()=>void prepareOutput()}>开启玩法窗口</Btn>}
      </div></div>
    </div>}>
    {unsupported?<div className="space-y-4"><p className="text-sm leading-6 text-[var(--text-2)]">这条已有规则使用了特殊触发方式或动作，完整配置会保留。可到高级设置继续调整。</p><Btn onClick={()=>onAdvanced(initialRule!)}>调整这条规则（高级）</Btn></div>:<>
      {stage!=='done'&&<p className="mb-2 text-xs text-[var(--text-3)]" aria-live="polite">第 {index+1} 步 / 共 {steps.length} 步 · {steps[index]}</p>}
      <h3 ref={heading} tabIndex={-1} className="mb-3 text-lg font-semibold text-[var(--text)] outline-none" data-testid="setup-question">{questions[stage]}</h3>
      <div className="space-y-4" data-setup-step={stage}>
        {stage==='kind'&&<><p className="text-sm text-[var(--text-3)]">选一个就行，接下来会一步一步带你设置。</p><div className="grid grid-cols-2 gap-3">{SETUP_KINDS.map(k=><Btn key={k.id} aria-label={k.label} variant="secondary" className="!block !whitespace-normal !p-4 !text-left" onClick={()=>{setKind(k.id);setPreviewReady(false);go('material')}}><span className="flex items-center gap-1.5 text-sm font-semibold">{k.label}{(k.id==='special'||k.id==='game')&&<span className="rounded bg-[var(--accent-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--accent-2)]">整蛊</span>}</span><span className="mt-2 block text-xs font-normal leading-5 text-[var(--text-3)]">{k.hint}</span></Btn>)}</div></>}
        {stage==='material'&&kind==='special'&&<><p className="text-sm leading-6 text-[var(--text-3)]">点一个玩法再填数量，或者选一个盲盒（随机开出一种）。想先看看效果，可以去「特色整蛊」里预览。</p><SpecialPicker value={source} onChange={v=>setSources(s=>({...s,special:v}))}/></>}
        {stage==='material'&&kind==='game'&&<><p className="text-sm leading-6 text-[var(--text-3)]">选一个游戏里的整蛊。收到礼物时游戏要开着，并且当前选中的就是这款游戏，才会触发。</p><Field label="游戏整蛊"><GamePrankSelect value={source} onChange={v=>setSources(s=>({...s,game:v}))}/></Field></>}
        {stage==='material'&&kind!=='special'&&kind!=='game'&&(kind==='key'?keyPicker(source,v=>setSources(s=>({...s,key:v}))):<>
          <p className="text-sm leading-6 text-[var(--text-3)]">{kind==='box'?'选一个放着视频的文件夹，收到礼物时从里面随机抽一个。':kind==='sound'?'点下面的按钮，选择电脑上的音效。选好后可以先听一听。':'点下面的按钮，选择电脑上的视频。默认完整播放一遍，播完就结束。'}</p>
          {kind==='box'&&projects.length>0&&<Field label="也可以选择已有项目"><Select aria-label="已有视频项目" value={projects.some(p=>p.dir===source)?source:''} disabled={busy} onChange={e=>{if(e.target.value)void readFolder(e.target.value)}}><option value="">选择已有项目…</option>{projects.map(p=><option key={p.dir} value={p.dir}>{p.name}（{p.videos} 个视频）</option>)}</Select></Field>}
          <Btn variant={source?'secondary':'primary'} disabled={busy} onClick={()=>void pick()}><FolderOpen size={15}/>{busy?'读取中…':kind==='box'?'选择文件夹':kind==='sound'?'选择音效':'选择视频'}</Btn>
          {source&&<p className="text-sm text-[var(--text-2)]">已选择：{fileName(source)}{kind==='box'?` · 找到 ${items.length} 个视频`:''}</p>}
          {kind==='box'&&items.length>0&&<Select aria-label="预览盲盒视频" value={sample} onChange={e=>{setSample(Number(e.target.value));setMediaError('');setPreviewReady(false);setPreviewVersion(v=>v+1)}}>{items.map((it,i)=><option key={it.video} value={i}>{it.name}</option>)}</Select>}
          {mediaPath&&(kind==='sound'?<audio key={mediaPath+'-'+previewVersion} src={mediaFileUrl(mediaPath)} controls preload="metadata" aria-label="试听音效" className="w-full" onLoadedMetadata={()=>setPreviewReady(true)} onError={()=>{setPreviewReady(false);setMediaError('这个音效无法试听，请重新选择文件。')}}/>:<video key={mediaPath+'-'+previewVersion} src={mediaFileUrl(mediaPath)} controls preload="metadata" aria-label="素材预览" className="max-h-44 w-full rounded-lg bg-[var(--bg)]" onLoadedMetadata={()=>setPreviewReady(true)} onError={()=>{setPreviewReady(false);setMediaError('这个视频无法预览，请尝试 MP4 格式或重新选择文件。')}}/>)}
          {!!mediaError&&<p role="alert" className="text-xs text-[var(--warn)]">{mediaError}</p>}
          {kind==='box'&&!!(paired||custom)&&<p className="text-xs leading-5 text-[var(--warn)]">素材自带整蛊效果：{paired} 个视频带脚本，{custom} 个视频配了动作。这里只预览视频；真正触发时，自带效果也会执行。</p>}
          {kind==='box'&&notice&&<p className="text-xs text-[var(--text-3)]">{notice}</p>}
        </>)}
        {stage==='extra-choice'&&<><p className="text-sm leading-6 text-[var(--text-3)]">{kind==='special'||kind==='game'?'例如同时给倒计时增加 30 秒，或按一个快捷键。不需要就直接跳过。':'例如视频开始时按 F1，或给倒计时增加 30 秒。不需要就直接跳过。'}</p>{(originalExtras.length>0||paired+custom>0)&&<p className="text-xs leading-5 text-[var(--warn)]">已有和素材自带的动作会保留。“跳过”表示这次不再添加新动作。</p>}<div className="grid grid-cols-2 gap-3"><Btn variant="secondary" onClick={()=>{setWantExtra(true);go('extra-type')}}>设置动作</Btn><Btn onClick={()=>{setWantExtra(false);go('gift')}}>跳过，不加新动作</Btn></div></>}
        {stage==='extra-type'&&<><p className="text-sm text-[var(--text-3)]">选一个动作，下一步再设置具体内容。</p><div className="grid grid-cols-2 gap-3">{EXTRA_TYPES.map(k=><Btn key={k.id} variant="secondary" onClick={()=>{setExtraKind(k.id);go('extra-value')}}>{k.label}</Btn>)}</div></>}
        {stage==='extra-value'&&(extraKind==='key'?keyPicker(extraKey,setExtraKey):<><p className="text-sm text-[var(--text-3)]">{extraKind==='countdown-adjust'?'调整「时间插件」里的倒计时。':extraKind==='overtime-adjust'?'调整「加班器」里的剩余时间。':'调整「计数挑战」里的数字。'}对应功能需要先开启。</p><Segmented value={direction} onChange={setDirection} options={[{value:'add',label:'增加'},{value:'subtract',label:'减少'}]}/><Field label={extraKind==='count-adjust'?'加减多少':'加减多少秒'} hint={extraKind==='count-adjust'?'例如填 5，就是增加或减少 5。':'例如填 30，就是 30 秒；1 分钟是 60 秒。'}><Input aria-label="动作数值" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></Field></>)}
        {stage==='gift'&&<><p className="text-sm text-[var(--text-3)]">选一个常用礼物，或者输入你想用的礼物名。</p><div className="flex flex-wrap gap-2">{['小心心','鲜花','棒棒糖','大啤酒','玫瑰','火箭'].map(n=><Btn key={n} variant={gift===n?'primary':'secondary'} aria-pressed={gift===n} onClick={()=>setGift(n)}>{n}</Btn>)}</div><Field label="也可以自己填写礼物"><Input aria-label="触发礼物" list="setup-gift-options" value={gift} onChange={e=>setGift(e.target.value)} placeholder="例如：小心心"/><datalist id="setup-gift-options">{DOUYIN_GIFT_NAMES.map(n=><option key={n} value={n}/>)}</datalist></Field><p className="text-xs text-[var(--text-3)]">每收到 {draft.times||1} 个这个礼物，就触发一次。{draft.multiply!==false?'连续送礼会按数量触发。':'一组连送只触发一次。'}</p>{!!matching.length&&<p className="text-xs leading-5 text-[var(--warn)]">已有 {matching.length} 条启用的规则使用「{gift}」，它们也会一起触发。如需替换，请先在规则列表停用旧规则。</p>}</>}
        {stage==='review'&&<><div className="border-l-2 border-[var(--accent)] pl-4 text-sm leading-7 text-[var(--text-2)]"><p>观众每送 {draft.times||1} 个「{gift}」</p><p className="font-semibold text-[var(--text)]">→ {chosen.label}：{kind==='key'?SHORTCUT_OPTIONS.find(k=>k.value===source)?.label||source:kind==='special'?(specialBox?'盲盒'+specialBoxText(source.slice(4)):specialActionText(source)):kind==='game'?gamePrankName:fileName(source)}</p><p>{addition?`同时：${actionLabel(addition)}`:'这次不添加额外动作。'}</p></div>{kind==='video'&&<p className="text-xs text-[var(--text-3)]">{Number(splitVideoParam(draft.commandParam).seconds)>0?`沿用设置：最多播放 ${splitVideoParam(draft.commandParam).seconds} 秒。`:splitVideoParam(draft.commandParam).target==='视频'&&splitVideoParam(draft.commandParam).seconds===undefined?'沿用原有循环播放设置。':'视频播放一遍后结束。'}</p>}{!!originalExtras.length&&<p className="text-xs text-[var(--warn)]">原规则的 {originalExtras.length} 个附加动作继续保留：{originalExtras.map(actionLabel).join('、')}</p>}{kind==='box'&&!!(paired+custom)&&<p className="text-xs text-[var(--warn)]">抽中视频自带的整蛊效果也会执行。</p>}{initialRule&&<p className="text-xs text-[var(--text-3)]">原有延迟、执行次数和播放位置保持原设置，可在高级里调整。</p>}<p className="text-xs text-[var(--text-3)]">{initialRule?.name?'规则名称':'已自动命名'}：{draft.name}</p><p className="text-sm leading-6 text-[var(--text-3)]">确认无误后完成。还不想让它触发，可以选“先保存，不启用”。</p></>}
        {stage==='done'&&<><Check size={32} className="text-[var(--ok)]"/><p className="text-sm leading-7 text-[var(--text-2)]">「{draft.name}」{savedEnabled?'已启用':'已保存，当前停用'}。{kind==='video'||kind==='box'?'接下来点“准备播放窗口”，再到直播软件添加窗口采集。':kind==='special'?'收到礼物时玩法窗口会自动打开；也可以现在点“开启玩法窗口”，先到直播软件添加窗口采集。':kind==='game'?'游戏开着、当前选中的是这款游戏时，收到礼物就会触发。':kind==='sound'?'声音会从电脑播放，请确认直播软件已采集电脑声音。':'触发时会向当前操作的软件发送快捷键。'}</p><p className="text-xs text-[var(--text-3)]">{savedEnabled?'连接直播间后，收到选定礼物就会触发。':'需要使用时，在规则列表打开这条规则的开关。'}</p>{outputReady&&<p role="status" className="text-sm leading-6 text-[var(--ok)]">{outputReady}</p>}</>}
      </div>
      {error&&<p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </>}
  </Modal>
}
