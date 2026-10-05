import type {EntertainmentAction,EntertainmentRule} from '@shared/types'
import {joinVideoParam,splitVideoParam} from '@shared/entertainmentLabels'
import {parseSpecialBoxParam,parseSpecialParam,SPECIAL_BOX_DEFAULT_NAME,SPECIAL_GAME_MAP} from '@shared/specialGames'
import {joinTargetSuffix,splitTargetSuffix} from '../utils/videoTarget'

export type SetupKind='special'|'game'|'video'|'box'|'sound'|'key'
export const SETUP_KINDS:{id:SetupKind;label:string;hint:string}[]=[
  {id:'special',label:'特色整蛊',hint:'锁链、抓鸭子、粉丝来电等叠在直播画面上的小游戏'},
  {id:'game',label:'游戏整蛊',hint:'让游戏里出状况：翻车、惊吓等（要开着对应游戏）'},
  {id:'video',label:'播放指定视频',hint:'每次收到礼物，都播放同一个视频'},
  {id:'box',label:'随机抽一个视频',hint:'选一个文件夹，每次随机播放其中一个'},
  {id:'sound',label:'播放音效',hint:'收到礼物时，播放你选好的声音'},
  {id:'key',label:'按一个快捷键',hint:'用游戏或直播软件已有的快捷键触发效果'}
]
export function setupKind(rule?:EntertainmentRule):SetupKind|undefined{
  if(rule?.actionType==='command'&&(rule.commandCmd==='special-play'||rule.commandCmd==='special-box'))return 'special'
  if(rule?.actionType==='command'&&rule.commandCmd==='game-prank')return 'game'
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
    // 特色整蛊盲盒在向导里记成「box:奖池参数」（事件id,…|名字），和指定玩法共用一步
    case 'special':return rule?.commandCmd==='special-box'?'box:'+(rule.commandParam||''):rule?.commandParam||''
    case 'game':return rule?.commandParam||''
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
  else if(kind==='special'&&source.startsWith('box:'))action={actionType:'command',commandCmd:'special-box',commandParam:source.slice(4)}
  else if(kind==='special')action={actionType:'command',commandCmd:'special-play',commandParam:source}
  else if(kind==='game')action={actionType:'command',commandCmd:'game-prank',commandParam:source}
  else action={actionType:'key',keySeq:source}
  const specialName=kind==='special'?(source.startsWith('box:')?'盲盒·'+(parseSpecialBoxParam(source.slice(4)).name||SPECIAL_BOX_DEFAULT_NAME):SPECIAL_GAME_MAP[parseSpecialParam(source).id]?.name||''):''
  const automaticName=!source?'':kind==='box'?fileName(source):kind==='key'?'快捷键互动':kind==='special'?(specialName?`特色整蛊·${specialName}`:''):kind==='game'?`游戏整蛊·${source.split('|')[2]||source.split('|')[1]||''}`:`${kind==='video'?'视频':'音效'}：${fileName(source)}`
  // 特色整蛊 / 游戏整蛊是即时效果，新建时默认「即时执行」，不跟视频排队（编辑旧规则沿用原设置）
  const instant=(kind==='special'||kind==='game')&&!base
  return {id:'',triggerType:'gift',times:1,repeat:1,multiply:true,queueMode:instant?'instant':'normal',enabled:true,
    ...base,...action,name:base?.name?.trim()||automaticName,giftName:gift.trim(),
    ...(kind==='box'&&!base?{group:fileName(source)}:{}),
    ...(kind==='special'&&!base?{group:'特色整蛊'}:{}),
    extraActions:[...(base?.extraActions||[]),...(addition?[addition]:[])]}
}
