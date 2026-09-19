import { Check, ChevronDown } from 'lucide-react'
import {useState} from 'react'
import {useConfigurationLevel} from '../lib/configurationLevel'
import { WIDGET_SKINS, type WidgetSkinId } from '@shared/widgetSkins'
import { Btn } from './ui'

export default function SkinPicker({ value, onChange, label = '挂件皮肤' }: {
  value?: string
  onChange: (value: WidgetSkinId) => void
  label?: string
}) {
  const [expanded,setExpanded]=useState(false)
  const {level}=useConfigurationLevel()
  const show=expanded||level==='advanced'
  const current=WIDGET_SKINS.find(s=>s.id===(value||'classic'))||WIDGET_SKINS[0]
  return <fieldset className="min-w-0 space-y-2">
    <legend className="mb-1 text-xs font-medium text-[var(--text-2)]">{label}</legend>
    {level==='basic'&&<Btn variant="secondary" size="sm" className="w-full !justify-between" aria-label={`更换${label}`} aria-expanded={show} onClick={()=>setExpanded(v=>!v)}>
      <span className="inline-flex items-center gap-2"><span data-widget-skin={current.id} aria-hidden="true" className="skin-swatch"><i/><i/><i/></span>{current.name}</span><ChevronDown size={13}/>
    </Btn>}
    <div className="grid grid-cols-2 gap-2 min-[1180px]:grid-cols-3" style={!show?{display:'none'}:undefined}>
      {WIDGET_SKINS.map((skin) => <Btn key={skin.id} variant="secondary" size="sm"
        aria-label={`${label}：${skin.name}`} aria-pressed={(value || 'classic') === skin.id}
        onClick={() => {onChange(skin.id);setExpanded(false)}} className={`skin-choice !justify-start !gap-2.5 !px-2.5 !py-2 ${(value || 'classic') === skin.id ? '!border-[var(--accent)] !bg-[var(--accent-soft)]' : ''}`}>
        <span data-widget-skin={skin.id} aria-hidden="true" className="skin-swatch"><i /><i /><i /></span>
        <span className="min-w-0 flex-1 truncate text-left text-xs" title={skin.note}>{skin.name}{'motion' in skin && <span className="ml-1 text-[10px] font-normal text-[var(--text-3)]">{skin.motion ? '动态' : '静态'}</span>}</span>
        {(value || 'classic') === skin.id && <Check size={12} className="shrink-0 text-[var(--accent)]" />}
      </Btn>)}
    </div>
  </fieldset>
}
