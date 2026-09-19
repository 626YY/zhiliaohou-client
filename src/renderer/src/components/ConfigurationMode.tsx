import {useConfigurationLevel} from '../lib/configurationLevel'
import {Btn} from './ui'

export default function ConfigurationMode(){
  const {level,setLevel}=useConfigurationLevel()
  return <div className="mr-3 inline-flex items-center rounded-lg border border-[var(--line)] p-0.5" role="group" aria-label="配置模式" title="基础显示常用选项，高级显示全部设置；已有配置始终保留">
    <Btn size="sm" variant={level==='basic'?'secondary':'ghost'} aria-pressed={level==='basic'} onClick={()=>setLevel('basic')}>基础</Btn>
    <Btn size="sm" variant={level==='advanced'?'secondary':'ghost'} aria-pressed={level==='advanced'} onClick={()=>setLevel('advanced')}>高级</Btn>
  </div>
}
