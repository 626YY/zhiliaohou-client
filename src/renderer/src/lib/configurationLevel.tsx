import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react'

export type ConfigurationLevel='basic'|'advanced'
const KEY='zl_configuration_level'
const Context=createContext<{level:ConfigurationLevel;setLevel:(level:ConfigurationLevel)=>void}|null>(null)
function read():ConfigurationLevel{try{return localStorage.getItem(KEY)==='advanced'?'advanced':'basic'}catch{return 'basic'}}

export function ConfigurationProvider({children}:{children:ReactNode}){
  const [level,update]=useState<ConfigurationLevel>(read)
  const setLevel=useCallback((value:ConfigurationLevel)=>{
    update(value)
    try{localStorage.setItem(KEY,value)}catch{/* 本次界面仍可切换 */}
  },[])
  useEffect(()=>{
    const changed=(event:StorageEvent)=>{if(event.key===KEY)update(read())}
    window.addEventListener('storage',changed)
    return()=>window.removeEventListener('storage',changed)
  },[])
  const value=useMemo(()=>({level,setLevel}),[level,setLevel])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useConfigurationLevel(){
  const context=useContext(Context)
  return context||{level:'advanced' as ConfigurationLevel,setLevel:(_level:ConfigurationLevel)=>{}}
}

export function ExpandedConfiguration({children}:{children:ReactNode}){
  const {setLevel}=useConfigurationLevel()
  const value=useMemo(()=>({level:'advanced' as ConfigurationLevel,setLevel}),[setLevel])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** 折叠只改变显示，不卸载表单，不清空已有高级配置。 */
export function AdvancedFields({children}:{children:ReactNode}){
  const {level}=useConfigurationLevel()
  return <div data-advanced-fields style={{display:level==='advanced'?'contents':'none'}}>{children}</div>
}
