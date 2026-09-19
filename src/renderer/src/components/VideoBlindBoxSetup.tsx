import {useEffect,useRef,useState} from 'react'
import type {EntertainmentRule,PinyouProjectInfo,PinyouProjectItem,PinyouItemActions} from '@shared/types'
import {giftNamesEqual} from '@shared/giftName'
import {FolderOpen} from 'lucide-react'
import {DOUYIN_GIFT_NAMES} from '../data/douyinGifts'
import {Btn,Field,Input,Select} from './ui'
import {Modal} from './Modal'

function mediaUrl(path:string){return 'file:///'+path.replace(/\\/g,'/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/,'$1:')}

export default function VideoBlindBoxSetup({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){
  const [projects,setProjects]=useState<PinyouProjectInfo[]>([])
  const [existing,setExisting]=useState<EntertainmentRule[]>([])
  const [projectError,setProjectError]=useState('')
  const [dir,setDir]=useState('')
  const [items,setItems]=useState<PinyouProjectItem[]>([])
  const [actions,setActions]=useState<Record<string,PinyouItemActions>>({})
  const [name,setName]=useState('')
  const [gift,setGift]=useState('')
  const [index,setIndex]=useState(0)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [previewError,setPreviewError]=useState('')
  const [saved,setSaved]=useState(false)
  const [savedEnabled,setSavedEnabled]=useState(false)
  const [uncertain,setUncertain]=useState(false)
  const [outputReady,setOutputReady]=useState('')
  const live=useRef(true)
  const generation=useRef(0)
  const submitting=useRef(false)
  useEffect(()=>{
    live.current=true
    void window.api.pinyouProjects().then(r=>{if(live.current){setProjects(r.projects);if(r.error)setProjectError('已有项目读取失败，可以直接选择视频文件夹。')}}).catch(()=>{if(live.current)setProjectError('已有项目读取失败，可以直接选择视频文件夹。')})
    void window.api.entertainmentRulesList().then(r=>{if(live.current)setExisting(r)}).catch(()=>{if(live.current)setProjectError('规则列表读取失败，保存后请检查是否有相同礼物的规则。')})
    return()=>{live.current=false;generation.current++}
  },[])
  const choose=async(path:string)=>{
    if(!path)return
    const ticket=++generation.current
    setBusy(true);setError('');setDir('');setItems([]);setPreviewError('')
    try{
      const r=await window.api.pinyouItemActionsGet(path)
      if(!live.current||ticket!==generation.current)return
      if(!r.ok||!r.items.length){setError(r.error||'这个文件夹里没有视频，请选择直接放着视频的文件夹。');return}
      setDir(r.dir||path);setItems(r.items);setActions(r.actions);setIndex(0)
      setName((r.dir||path).split(/[\\/]/).filter(Boolean).pop()||'视频盲盒')
    }catch(e){if(live.current&&ticket===generation.current)setError(`读取素材失败：${String(e)}。请重新选择文件夹。`)}
    finally{if(live.current&&ticket===generation.current)setBusy(false)}
  }
  const pick=async()=>{
    try{const r=await window.api.selectFile({title:'选择放着盲盒视频的文件夹',properties:['openDirectory']});if(live.current&&r.ok&&r.path)await choose(r.path)}
    catch{if(live.current)setError('文件夹选择失败，请重试。')}
  }
  const save=async(enabled:boolean)=>{
    if(submitting.current||uncertain||!dir||!items.length||!gift.trim()||!name.trim())return
    submitting.current=true;setBusy(true);setError('')
    try{
      const r=await window.api.entertainmentRuleAdd({id:'',name:name.trim(),group:name.trim(),giftName:gift.trim(),
        triggerType:'gift',actionType:'command',commandCmd:'project-random',commandParam:dir,
        enabled,times:1,repeat:1,multiply:true,queueMode:'normal',remark:`视频盲盒 · ${items.length} 个视频`})
      if(!live.current)return
      if(!r.ok){setError(r.error||'保存失败，请重试。');return}
      setSavedEnabled(enabled);setSaved(true);onSaved()
    }catch{if(live.current){setUncertain(true);setError('保存结果未确认，请关闭后检查规则列表，避免重复创建。');onSaved()}}
    finally{if(live.current)setBusy(false);submitting.current=false}
  }
  const item=items[index]
  const prepareOutput=async()=>{
    setBusy(true);setError('')
    try{
      const [state,{settings}]=await Promise.all([window.api.greenScreenState(),window.api.getSettings()])
      const opened=state.slots.filter(s=>s.open)
      if(opened.length){if(live.current)setOutputReady(`已开启 ${opened.map(s=>s.slot+' 号').join('、')} 绿幕窗口，在直播软件中添加对应窗口采集即可。`);return}
      const slot=([1,2,3,4].includes(Number(settings.videoDefaultSlot))?Number(settings.videoDefaultSlot):1) as 1|2|3|4
      const r=await window.api.greenScreenOpen('','image','',slot)
      if(live.current){if(r.ok)setOutputReady(`${slot} 号绿幕窗口已开启。在直播软件中添加这个窗口的采集来源，并按底色设置绿幕抠像。`);else setError(r.error||'播放窗口未能打开，请到绿幕窗口页重试。')}
    }catch{if(live.current)setError('播放窗口准备失败，请到绿幕窗口页检查。')}
    finally{if(live.current)setBusy(false)}
  }
  const scriptCount=items.filter(it=>it.hasScript&&actions[it.name]?.useScript!==false).length
  const extraCount=items.filter(it=>actions[it.name]?.actions?.length).length
  const matching=existing.filter(r=>r.enabled!==false&&(!r.triggerType||r.triggerType==='gift')&&giftNamesEqual(r.giftName,gift))
  return <Modal open closeDisabled={busy} closeOnBackdrop={false} onClose={onClose} title={saved?'视频盲盒已保存':'创建视频盲盒'} width={720}
    footer={saved?<Btn onClick={onClose}>返回规则列表</Btn>:<><Btn variant="secondary" onClick={onClose} disabled={busy}>取消</Btn><Btn variant="secondary" onClick={()=>void save(false)} disabled={busy||uncertain||!dir||!gift.trim()||!name.trim()}>保存为停用</Btn><Btn onClick={()=>void save(true)} disabled={busy||uncertain||!dir||!gift.trim()||!name.trim()}>{busy?'处理中…':'保存并启用'}</Btn></>}>
    {saved?<div className="space-y-3 text-sm leading-6 text-[var(--text-2)]"><p>「{name}」已保存{savedEnabled?'并启用':'，当前停用'}。启用后，每个「{gift}」随机抽一个视频，连续送礼会排队播放。</p><p>下一步准备播放窗口，再到直播软件添加这个窗口来源。启用规则并连接直播间后，礼物即可触发。</p><Btn variant="secondary" disabled={busy} onClick={()=>void prepareOutput()}>准备播放窗口</Btn>{outputReady&&<p role="status" className="text-sm text-[var(--ok)]">{outputReady}</p>}{error&&<p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}<p className="text-xs text-[var(--text-3)]">可在规则列表修改礼物、暂停或删除这条盲盒规则。</p></div>:<div className="space-y-5">
      <section className="space-y-2"><h3 className="text-sm font-semibold text-[var(--text)]">1. 选择视频文件夹</h3><p className="text-xs text-[var(--text-3)]">每次随机抽一条。直接使用原文件夹，请保留素材原来的位置。</p>
        <div className="flex gap-2"><Select aria-label="已有视频项目" value={projects.some(p=>p.dir===dir)?dir:''} onChange={e=>void choose(e.target.value)} disabled={busy}><option value="">选择已有项目…</option>{projects.map(p=><option key={p.dir} value={p.dir}>{p.name}（{p.videos} 个视频）</option>)}</Select><Btn variant="secondary" onClick={()=>void pick()} disabled={busy}><FolderOpen size={14}/>选择文件夹</Btn></div>
        {dir&&<p className="break-all text-xs text-[var(--text-3)]">已找到 {items.length} 个视频 · {dir}</p>}
        {projectError&&<p className="text-xs text-[var(--warn)]">{projectError}</p>}
      </section>
      {items.length>0&&<>
        <section className="grid gap-3 sm:grid-cols-2"><h3 className="col-span-full text-sm font-semibold text-[var(--text)]">2. 选择触发礼物</h3><Field label="盲盒名称"><Input value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></Field><Field label="触发礼物" hint="每送 1 个抽 1 次，多次触发按顺序播放"><Input value={gift} onChange={e=>setGift(e.target.value)} list="blind-box-gifts" placeholder="例如：小心心" disabled={busy}/><datalist id="blind-box-gifts">{DOUYIN_GIFT_NAMES.map(n=><option key={n} value={n}/>)}</datalist></Field></section>
        <section className="space-y-2"><h3 className="text-sm font-semibold text-[var(--text)]">3. 预览素材</h3><Select aria-label="预览盲盒视频" value={index} onChange={e=>{setIndex(Number(e.target.value));setPreviewError('')}}>{items.map((it,i)=><option key={it.video} value={i}>{it.name}</option>)}</Select>
          {item&&<video key={item.video} src={mediaUrl(item.video)} controls preload="metadata" className="max-h-52 w-full rounded-lg bg-[var(--bg)]" aria-label="盲盒素材预览" onError={()=>setPreviewError('这个视频无法在预览中播放，请换一条检查；建议使用 MP4 格式。')}/>}
          {previewError&&<p role="alert" className="text-xs text-[var(--warn)]">{previewError}</p>}
          <p className="text-xs leading-5 text-[var(--text-3)]">这里预览画面和声音。正式触发时还会执行素材自带的动作：{scriptCount} 条视频带脚本，{extraCount} 条配有附加动作。</p>
          {item?.script.length>0&&<p className="text-xs leading-5 text-[var(--text-2)]">当前视频的动作：{actions[item.name]?.useScript===false?'已停用自带脚本':item.script.join('；')}</p>}
        </section>
      </>}
      {error&&<p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
      {!!matching.length&&<p className="text-xs leading-6 text-[var(--warn)]">已有 {matching.length} 条启用的规则使用「{gift}」，收到这个礼物时也会执行。若要替换旧规则，请先回列表停用旧规则。</p>}
    </div>}
  </Modal>
}
