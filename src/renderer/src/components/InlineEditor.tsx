import {useId,useState,type ReactNode} from 'react'
import {useConfigurationLevel} from '../lib/configurationLevel'
import {Btn} from './ui'

/** 列表先显示当前规则摘要，一次编辑一条；高级模式直接展开全部。 */
export default function InlineEditor({title,summary,children}:{title:string;summary:string;children:ReactNode}){
  const {level}=useConfigurationLevel(),id=useId()
  const [editing,setEditing]=useState(false)
  const show=editing||level==='advanced'
  return <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-card)] p-2">
    {level==='basic'&&<div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-medium text-[var(--text)]">{title}</div><div className="mt-0.5 text-xs text-[var(--text-3)]">{summary}</div></div><Btn variant="secondary" size="sm" aria-expanded={show} aria-controls={id} onClick={()=>setEditing(!editing)}>{show?'收起':'编辑'}</Btn></div>}
    <div id={id} hidden={!show} className={level==='basic'?'mt-2':''}>{children}</div>
  </div>
}
