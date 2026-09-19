import type {EntertainmentAction,EntertainmentRule} from '@shared/types'
import {joinVideoParam,splitVideoParam} from '@shared/entertainmentLabels'
import {joinTargetSuffix,splitTargetSuffix} from '../utils/videoTarget'

export type SetupKind='video'|'box'|'sound'|'key'
export const SETUP_KINDS:{id:SetupKind;label:string;hint:string}[]=[
  {id:'video',label:'播放指定视频',hint:'每次收到礼物，都播放同一个视频'},
  {id:'box',label:'随机抽一个视频',hint:'选一个文件夹，每次随机播放其中一个'},
  {id:'sound',label:'播放音效',hint:'收到礼物时，播放你选好的声音'},
  {id:'key',label:'按一个快捷键',hint:'用游戏或直播软件已有的快捷键触发效果'}
]
export function setupKind(rule?:EntertainmentRule):SetupKind|undefined{
  if(rule?.actionType==='sound')return 'sound'
  if(rule?.actionType==='key')return 'key'
  if(rule?.actionType==='command'&&rule.commandCmd==='video-play')return 'video'
  if(rule?.actionType==='command'&&rule.commandCmd==='project-random')return 'box'
  return undefined
}
export function setupSource(rule?:EntertainmentRule){
  switch(setupKind(rule)){
    case 'video':return splitVideoParam(rule?.commandParam).path
    case 'box':return splitTargetSuffix(rule?.commandParam||'').rest
    case 'sound':return rule?.soundPath||''
    case 'key':return rule?.keySeq||''
    default:return ''
  }
}
export const fileName=(source:string)=>source.split(/[\\/]/).filter(Boolean).pop()||''
export const mediaFileUrl=(source:string)=>'file:///'+source.replace(/\\/g,'/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/,'$1:')

/** 基础向导只修改明确选择的项目，原规则的延迟、次数、指定窗口和附加动作完整保留。 */
export function setupRule(base:EntertainmentRule|undefined,kind:SetupKind,source:string,gift:string,addition?:EntertainmentAction):EntertainmentRule{
  const previous=setupKind(base)
  let action:EntertainmentAction
  if(kind==='video'){
    const old:ReturnType<typeof splitVideoParam>=previous==='video'?splitVideoParam(base?.commandParam):{path:'',seconds:'0'}
    action={actionType:'command',commandCmd:'video-play',commandParam:joinVideoParam(source,old.seconds,old.target,old.overflow!==false)}
  }else if(kind==='box'){
    const old=previous==='box'?splitTargetSuffix(base?.commandParam||''):{target:'0' as const,overflow:true}
    action={actionType:'command',commandCmd:'project-random',commandParam:joinTargetSuffix(source,old.target,old.overflow)}
  }else if(kind==='sound')action={actionType:'sound',soundPath:source,soundMode:base?.soundMode||'sync',soundVolume:base?.soundVolume??100}
  else action={actionType:'key',keySeq:source}
  const automaticName=!source?'':kind==='box'?fileName(source):kind==='key'?'快捷键互动':`${kind==='video'?'视频':'音效'}：${fileName(source)}`
  return {id:'',triggerType:'gift',times:1,repeat:1,multiply:true,queueMode:'normal',enabled:true,
    ...base,...action,name:base?.name?.trim()||automaticName,giftName:gift.trim(),
    ...(kind==='box'&&!base?{group:fileName(source)}:{}),
    extraActions:[...(base?.extraActions||[]),...(addition?[addition]:[])]}
}
