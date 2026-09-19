import type {EntertainmentAction} from '@shared/types'
import {Modal} from './Modal'
import {Btn} from './ui'

export default function GiftRuleStarter({onClose,onChoose,onVideoBox}:{onClose:()=>void;onChoose:(action:EntertainmentAction|null)=>void;onVideoBox:()=>void}){
  return <Modal open onClose={onClose} title="收到礼物后，要发生什么？" width={480}>
    <p className="mb-4 text-sm text-[var(--text-3)]">先选效果，再填写触发礼物和素材。</p>
    <div className="grid grid-cols-2 gap-3">
      <Btn variant="secondary" onClick={onVideoBox}>随机抽一个视频</Btn>
      <Btn variant="secondary" onClick={()=>onChoose({actionType:'command',commandCmd:'video-play',commandParam:''})}>播放指定视频</Btn>
      <Btn variant="secondary" onClick={()=>onChoose({actionType:'sound',soundPath:''})}>播放音效</Btn>
      <Btn variant="secondary" onClick={()=>onChoose({actionType:'key',keySeq:''})}>按一个快捷键</Btn>
    </div>
    <div className="mt-4 border-t border-[var(--line)] pt-3"><Btn variant="ghost" size="sm" onClick={()=>onChoose(null)}>设置其他动作（高级）</Btn></div>
  </Modal>
}
