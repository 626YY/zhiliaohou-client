import {useEffect,useId,useRef,useState, type ReactNode} from 'react'
import {ChevronDown} from 'lucide-react'
import {ExpandedConfiguration,useConfigurationLevel} from '../lib/configurationLevel'
import {Btn} from './ui'

/** 隐藏时保留子组件和草稿，切换不会改动业务配置。 */
export default function AdvancedSection({title,children,hint}:{title:string;children:ReactNode;hint?:string}) {
  const {level}=useConfigurationLevel()
  const id=useId()
  const [expanded,setExpanded]=useState(false)
  const root=useRef<HTMLElement>(null)
  useEffect(()=>{const reveal=(event:Event)=>{const target=(event as CustomEvent).detail;if(target instanceof Element&&root.current?.contains(target))setExpanded(true)};window.addEventListener('zl-guide-reveal',reveal);return()=>window.removeEventListener('zl-guide-reveal',reveal)},[])
  const visible=level==='advanced'||expanded
  return <section ref={root} className="my-3 border-t border-[var(--line)] pt-3" data-advanced-section={title}>
    <Btn variant="ghost" size="sm" aria-expanded={visible} aria-controls={id} onClick={()=>setExpanded(!expanded)} disabled={level==='advanced'}>
      <ChevronDown size={14} className={visible?'':'-rotate-90'}/>{title}<span className="text-[10px] text-[var(--text-4)]">更多选项</span>
    </Btn>
    {hint&&<p className="mt-1 text-xs leading-5 text-[var(--text-3)]">{hint}</p>}
    <div id={id} hidden={!visible} className="mt-3"><ExpandedConfiguration>{children}</ExpandedConfiguration></div>
  </section>
}
