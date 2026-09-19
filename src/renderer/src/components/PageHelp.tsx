import {useState} from 'react'
import {useLocation,useNavigate} from 'react-router-dom'
import {HelpCircle} from 'lucide-react'
import {Btn} from './ui'
import {Modal} from './Modal'
import {FEATURE_GUIDES} from '../lib/featureGuides'

const HELP:Record<string,{text:string;actions:[string,string][]}>={
  '/':{text:'选择你要玩的游戏，进入详情查看效果与安装状态。只用视频、抽奖或计时互动，可以直接进入娱乐助手。',actions:[['配置娱乐互动','/ent'],['检查游戏安装','/launch']]},
  '/config':{text:'先选游戏，再调整常用参数。搜索可以查找全部参数；细项也可在高级模式查看。实时模式开启时，修改会立即影响运行中的游戏，保存后下次仍会使用。',actions:[['测试游戏效果','/remote']]},
  '/remote':{text:'先启动游戏并进入关卡，再点需要的整蛊测试。下方可以绑定礼物，让连接器收到礼物后自动触发。',actions:[['启动游戏','/launch'],['连接直播间','/connector']]},
  '/launch':{text:'选择游戏后，按页面提示完成授权、查找游戏和安装检查。状态正常后启动游戏；遇到异常可运行检查，按结果修复。',actions:[['查看游戏库','/'],['调整设置','/settings']]},
  '/stats':{text:'连接直播间后，这里会显示收到的礼物和互动数据。没有数据时，先检查直播间是否连接成功；模拟消息不会上传为真实直播记录。',actions:[['查看连接状态','/connector']]},
  '/connector':{text:'选择已绑定的直播间，再启动连接器。首次使用按提示扫码登录，连接成功后再测试礼物互动。模拟模式用于本机测试，运行状态会注明模拟。',actions:[['绑定直播间','/settings'],['配置礼物互动','/ent']]},
  '/settings':{text:'常用的是账号与直播间、游戏位置、外观和窗口采集。改完点击保存设置；自定义目录、渲染方式和抠图微调可在高级中调整。',actions:[['检查游戏','/launch']]},
  '/news':{text:'这里查看工作室公告和更新内容。需要使用某个新功能，可以进入对应游戏或娱乐助手。',actions:[['查看游戏库','/'],['查看娱乐功能','/ent']]},
  '/notifications':{text:'这里查看授权申请、账号变更等通知。按通知内容处理；已读标记只改变通知状态。',actions:[['查看账号和直播间','/settings']]},
  '/ent':{text:'按用途选择互动功能，也可以搜索视频、礼物、时间等关键词。先配置并预览，再打开对应窗口，最后在直播软件中添加窗口采集来源。',actions:[]},
  '/mod':{text:'先查看游戏要求、效果与授权状态，再按页面提示安装。安装完成后到启动游戏页检查并运行。',actions:[['启动与检查','/launch']]}
}
export default function PageHelp(){
  const location=useLocation(),navigate=useNavigate()
  const [open,setOpen]=useState(false)
  const key=location.pathname.startsWith('/mod/')?'/mod':location.pathname
  const guide=HELP[key]||HELP['/']
  const feature=key==='/ent'?FEATURE_GUIDES[new URLSearchParams(location.search).get('tool')||'']:undefined
  return <><Btn variant="ghost" size="sm" onClick={()=>setOpen(true)} aria-label="使用帮助"><HelpCircle size={15}/><span className="hidden min-[1050px]:inline">使用帮助</span></Btn>
    <Modal open={open} onClose={()=>setOpen(false)} title="使用帮助" width={500} footer={<Btn variant="secondary" onClick={()=>setOpen(false)}>知道了</Btn>}>
      <p className="text-sm leading-7 text-[var(--text-2)]">{guide.text}</p>
      {feature&&<ol className="mt-4 space-y-2 text-sm text-[var(--text-2)]">{feature.steps.map((step,i)=><li key={step}>{i+1}. {step}</li>)}</ol>}
      <p className="mt-4 text-xs leading-6 text-[var(--text-3)]">基础模式显示常用项。高级配置即使收起仍会生效；切换模式不会重置设置。</p>
      {!!guide.actions.length&&<div className="mt-4 flex flex-wrap gap-2">{guide.actions.map(([label,to])=><Btn key={label} variant="secondary" size="sm" onClick={()=>{setOpen(false);navigate(to)}}>{label}</Btn>)}</div>}
    </Modal></>
}
