// 新平台短许可单独落盘；不改主播游戏配置、旧许可或旧离线缓存。
import fs from 'node:fs'
import {dirname,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {gamePathFor} from './games'
import {loadCardProviderConfig} from './card-provider'
import {cardEpoch} from './card-epoch'
import {resolvePinnedModKey} from './mod-lease-verify'
import {platformErrorCode,ROOM_ID_RE,type LicenseConnection} from './license-connection'
import {cardMachineId} from './machine-id'
import {licenseEnforced} from './license-policy'
import {logLine} from './crash-log'

/** 平台回 room_not_bound：直播间没绑到当前账号。只报清楚，不动游戏 config.json 里的 LiveRoomId 或任何参数。 */
export class CardRoomNotBound extends Error{
  readonly code='room_not_bound'
  constructor(readonly room:string){super(`直播间 ${room} 尚未绑定到当前卡密账号，请先在客户端「直播间管理」扫码绑定；轮椅参数里的直播间号未改动`)}
}

const PRODUCT='game:4wheel-challenge'
const FILE='local-card-license.json'
let active:{dir:string;room:string;user:string;epoch:number;at:number;validUntil:number}|undefined
let pending:Promise<void>|undefined
const touched=new Set<string>()

export function cardWheelDirectory():string{
  const exe=gamePathFor('4wheel-challenge')
  if(!exe)return ''
  const dir=join(dirname(exe),'Mods','WheelLive')
  try{return fs.statSync(dir).isDirectory()?dir:''}catch{return ''}
}

// 机器码读取挪到 machine-id.ts（平台离线凭证也要绑定它）；这里保留同名导出，老调用方不用改
export { cardMachineId }

function atomicWrite(dir:string,value:Record<string,unknown>):void{
  const target=join(dir,FILE),temp=target+'.'+randomUUID()+'.tmp'
  try{fs.writeFileSync(temp,JSON.stringify(value),{encoding:'utf8',flag:'wx',flush:true});fs.renameSync(temp,target)}
  finally{try{fs.unlinkSync(temp)}catch{}}
}

export function hasCardModLease():boolean{return !!active}

const FREE_MARKER={provider:'card',free:true,note:'知了猴客户端已暂停卡密检查（license-policy enforce=false）'}
let freeMarkerLoggedDir=''
/** 免检模式：给轮椅 mod 写 {"provider":"card","free":true}（1.0.0.12 起的 mod 见到它直接视为已授权）。已是这份内容就不重写。 */
export function writeFreeModLease():boolean{
  const dir=cardWheelDirectory()
  if(!dir)return false
  try{
    const cur=JSON.parse(fs.readFileSync(join(dir,FILE),'utf8'))
    if(cur&&cur.provider==='card'&&cur.free===true)return true
  }catch{/* 没有或不是免检标记，下面写 */}
  try{atomicWrite(dir,FREE_MARKER)}catch(error){logLine('license',`免检标记写不进整蛊器目录：${String(error)}`);return false}
  touched.add(dir)
  if(freeMarkerLoggedDir!==dir){freeMarkerLoggedDir=dir;logLine('license',`已给轮椅整蛊器写入免检标记：${join(dir,FILE)}`)}
  return true
}

export function invalidateCardModLease(reason='请在客户端登录并激活卡密'):void{
  active=undefined
  // 免检模式下永远不能把 mod 锁回去：退出 / 换号 / 拒绝一律维持免检标记
  if(!licenseEnforced()){writeFreeModLease();return}
  const dir=cardWheelDirectory()
  if(dir)touched.add(dir)
  for(const target of touched){
    // 保留 marker：清除租约不能让新模式退回旧永久授权。
    try{atomicWrite(target,{provider:'card',lease:'',error:reason.slice(0,120)})}catch{/* 退出时目录可能已移除，租约仍严格在120秒内到期。 */}
  }
}

export async function renewCardModLease(connection:LicenseConnection,force=false):Promise<void>{
  if(!licenseEnforced()){writeFreeModLease();return}
  const config=loadCardProviderConfig()
  if(!config.enabled)return
  if(config.error||!config.origin)throw Error(config.error||'卡密平台配置不完整')
  const dir=cardWheelDirectory()
  if(!dir)throw Error('未找到轮椅整蛊器，请先安装整蛊器')
  let room=''
  try{const data=JSON.parse(fs.readFileSync(join(dir,'config.json'),'utf8'));room=String(data.LiveRoomId??data.liveRoomId??'').trim()}catch{throw Error('无法读取轮椅配置，请检查游戏路径')}
  if(!ROOM_ID_RE.test(room))throw Error('请先在轮椅参数里保存直播间号，再使用游戏功能')
  const user=connection.currentUser()?.id,epoch=cardEpoch()
  if(!user)throw Error('请先登录卡密平台账号')
  const pin=config.modKeys[PRODUCT]||config.modKeys['*']
  if(pin?.error)throw Error('轮椅授权配置不完整：'+pin.error)
  if(!force&&active?.dir===dir&&active.room===room&&active.user===user&&active.epoch===epoch&&performance.now()-active.at<30000&&active.validUntil>performance.now()+15000)return
  if(pending){
    await pending
    if(cardEpoch()!==epoch||connection.currentUser()?.id!==user||cardWheelDirectory()!==dir)throw Error('账号或游戏路径已变化，已取消授权')
    const latest=JSON.parse(fs.readFileSync(join(dir,'config.json'),'utf8'))
    if(String(latest.LiveRoomId??latest.liveRoomId??'').trim()!==room)throw Error('直播间设置已变化，请重试')
    return renewCardModLease(connection,force)
  }
  const current=()=>cardEpoch()===epoch&&connection.currentUser()?.id===user&&cardWheelDirectory()===dir
  pending=(async()=>{
    try{
      const key=resolvePinnedModKey(pin,pin?.keyXml?undefined:await connection.modPublicKey())
      const machineId=await cardMachineId()
      if(!current())throw Error('账号或游戏路径已变化，已取消授权')
      let reply:Awaited<ReturnType<LicenseConnection['modLease']>>
      try{reply=await connection.modLease({product:PRODUCT,room,machineId,keyXml:key})}
      catch(error){throw platformErrorCode(error)==='room_not_bound'?new CardRoomNotBound(room):error}
      if(!current())throw Error('账号或游戏路径已变化，已取消授权')
      const latest=JSON.parse(fs.readFileSync(join(dir,'config.json'),'utf8'))
      if(String(latest.LiveRoomId??latest.liveRoomId??'').trim()!==room)throw Error('直播间设置已变化，请重试')
      touched.add(dir)
      atomicWrite(dir,{provider:'card',lease:reply.lease})
      const now=performance.now()
      // 墙钟剩余时长转换到单调时钟；后续系统时钟回拨不会延长本机缓存寿命。
      active={dir,room,user,epoch,at:now,validUntil:now+Math.max(0,reply.claims.exp*1000-Date.now())}
    }catch(error){if(current())invalidateCardModLease(error instanceof CardRoomNotBound?'直播间未绑定到当前账号，请在客户端绑定直播间':'授权未就绪，请在客户端检查卡密状态');throw error}
  })()
  try{await pending}finally{pending=undefined}
}
