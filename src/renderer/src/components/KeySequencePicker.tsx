import {Field,Input,Select} from './ui'
import {useConfigurationLevel} from '../lib/configurationLevel'

export const SHORTCUT_OPTIONS=[...Array.from({length:12},(_,i)=>({value:`{F${i+1}}`,label:`F${i+1}`})),
  {value:' ',label:'空格'},{value:'{ENTER}',label:'回车'},{value:'{ESC}',label:'Esc'},
  {value:'^c',label:'Ctrl + C'},{value:'^v',label:'Ctrl + V'},{value:'^s',label:'Ctrl + S'}]
export default function KeySequencePicker({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const KEYS=SHORTCUT_OPTIONS
  const {level}=useConfigurationLevel()
  return level==='basic'?<Field label="要按的快捷键" hint="选择游戏或直播软件中已经设置好的快捷键。更多组合可在高级模式填写。"><Select value={value} onChange={e=>onChange(e.target.value)}><option value="">选择快捷键…</option>{value&&!KEYS.some(k=>k.value===value)&&<option value={value}>已有自定义快捷键：{value}</option>}{KEYS.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>:<Field label="按键序列" hint="SendKeys 语法：{F1}、{ENTER}、^s、abc"><Input value={value} onChange={e=>onChange(e.target.value)} placeholder="{F1} / {ENTER} / ^s"/></Field>
}
