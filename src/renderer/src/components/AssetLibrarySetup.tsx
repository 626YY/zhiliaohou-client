import {useEffect,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {FolderOpen} from 'lucide-react'
import {Modal} from './Modal'
import {Btn} from './ui'

function AssetSetupDialog({initial,onDone}:{initial:boolean;onDone:()=>void}){
  const navigate=useNavigate()
  const [root,setRoot]=useState(''),[count,setCount]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let alive=true;void window.api.pinyouProjects().then(r=>{if(alive){setRoot(r.root);setCount(r.projects.length)}}).catch(()=>{});return()=>{alive=false}},[])
  const pick=async()=>{setBusy(true);setError('');try{const r=await window.api.pinyouAssetRootPick();if(r.ok&&r.root){setRoot(r.root);setCount(r.projects?.length??0);window.dispatchEvent(new Event('zl-assets-changed'))}else if(r.error)setError(r.error)}catch{setError('素材文件夹没有选成功，请重试。')}finally{setBusy(false)}}
  const finish=async(go:boolean)=>{if(busy)return;setBusy(true);setError('');try{await window.api.saveSettings({assetGuideSeen:true});onDone();if(go)navigate('/ent')}catch{setError('设置未保存，请重试。')}finally{setBusy(false)}}
  return <Modal open closeDisabled={busy} closeOnBackdrop={false} onClose={()=>void finish(false)} title={initial?'先把素材准备好，后面配置更轻松':'设置素材库'} width={560} footer={<><Btn variant="secondary" disabled={busy} onClick={()=>void finish(false)}>{root?'完成':'暂时跳过'}</Btn><Btn disabled={busy} onClick={()=>void finish(true)}>去配置互动</Btn></>}>
    <div className="space-y-4"><p className="text-sm leading-7 text-[var(--text-2)]">把现成的视频项目放在一个总文件夹里，在这里选一次。以后创建视频盲盒，就能直接从项目列表选择。</p><p className="text-xs leading-6 text-[var(--text-3)]">例如选“视频”文件夹，它里面可以有“抓鸭子”“翻牌子”等项目。没有素材也没关系，可以先跳过，用转盘、倒计时等功能。</p><Btn disabled={busy} onClick={()=>void pick()}><FolderOpen size={15}/>{busy?'读取中…':'选择素材总文件夹'}</Btn>{root&&<div role="status" className="text-sm leading-6 text-[var(--text-2)]"><p className="break-all">已选择：{root}</p><p>{count?`找到 ${count} 个项目，后面可以直接选。`:'暂时没有找到项目。仍可在添加规则时直接选视频文件。'}</p></div>}<p className="text-xs text-[var(--text-3)]">以后想换目录，娱乐助手首页就有“素材库”入口。</p>{error&&<p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}</div>
  </Modal>
}
export function AssetOnboarding(){
  const [open,setOpen]=useState(false)
  useEffect(()=>{let alive=true;void window.api.getSettings().then(({settings})=>{if(alive)setOpen(!settings.assetGuideSeen&&!settings.pinyouAssetRoot)}).catch(()=>{});return()=>{alive=false}},[])
  return open?<AssetSetupDialog initial onDone={()=>setOpen(false)}/>:null
}
export function AssetLibraryEntry(){
  const [open,setOpen]=useState(false),[root,setRoot]=useState('')
  useEffect(()=>{let alive=true;const refresh=()=>void window.api.getSettings().then(({settings})=>{if(alive)setRoot(settings.pinyouAssetRoot||'')}).catch(()=>{});refresh();window.addEventListener('zl-assets-changed',refresh);return()=>{alive=false;window.removeEventListener('zl-assets-changed',refresh)}},[])
  return <><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-3)]"><span>{root?`素材库：${root.split(/[\\/]/).filter(Boolean).pop()}`:'还没选素材库？先选一次视频总文件夹，后面直接挑项目。'}</span><Btn size="sm" variant="secondary" onClick={()=>setOpen(true)}><FolderOpen size={14}/>{root?'更换素材库':'设置素材库'}</Btn></div>{open&&<AssetSetupDialog initial={false} onDone={()=>setOpen(false)}/>}</>
}
