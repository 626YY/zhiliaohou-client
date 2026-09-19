// 本机卡密模式随客户端携带验签支持；修复/重装后也恢复同一版本，不覆盖主播配置。
import fs from 'node:fs'
import {basename,dirname,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {app} from 'electron'
import {gamePathFor} from './games'
import {loadCardProviderConfig} from './card-provider'
import {modKeyFingerprint} from './mod-lease-verify'
import {processRunning} from './proc-snapshot'
import {cardEpoch} from './card-epoch'
import {licenseEnforced} from './license-policy'

const digest=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')

export async function ensureCardModSupport(gameId:string):Promise<void>{
  const epoch=cardEpoch()
  const config=loadCardProviderConfig()
  // 免检模式（license-policy）：旧账号系统的主播也要换上认 free 标记的 1.0.0.12 组件，不然游戏里还是锁着
  const free=!licenseEnforced()
  if(gameId!=='4wheel-challenge')return
  if(!config.enabled&&!free)return
  if(config.enabled&&config.error)throw Error(config.error)
  const base=app.isPackaged?join(process.resourcesPath,'local-card-mod'):join(app.getAppPath(),'output','local-card-mod')
  let manifest:{sha256:string;fingerprint:string;version:string}
  try{manifest=JSON.parse(fs.readFileSync(join(base,'manifest.json'),'utf8'))}catch{throw Error('本机整蛊器授权组件缺失，请重新安装完整客户端')}
  if(!/^[a-f0-9]{64}$/.test(manifest.sha256)||!/^[a-f0-9]{64}$/.test(manifest.fingerprint)||!/^\d+(\.\d+){3}$/.test(manifest.version))throw Error('整蛊器授权组件信息无效')
  if(config.enabled){
    const pin=config.modKeys?.['game:4wheel-challenge']
    const fingerprint=pin?.fingerprint||(pin?.keyXml?modKeyFingerprint(pin.keyXml):'')
    if(fingerprint!==manifest.fingerprint)throw Error('整蛊器与当前卡密平台不匹配，请重新安装对应客户端')
  }
  const source=join(base,'WheelLive.dll')
  if(!fs.existsSync(source)||digest(source)!==manifest.sha256)throw Error('整蛊器授权组件损坏，请重新安装完整客户端')
  const exe=gamePathFor(gameId),target=exe?join(dirname(exe),'Mods','WheelLive.dll'):''
  if(!target||!fs.existsSync(target))throw Error('请先在游戏库安装轮椅整蛊器')
  if(digest(target)===manifest.sha256)return
  if(await processRunning(basename(exe),true))throw Error('请先关闭轮椅游戏，再更新整蛊器；已有配置会保留')
  if(cardEpoch()!==epoch||gamePathFor(gameId)!==exe)throw Error('账号或游戏路径已变化，操作已取消')
  const previous=digest(target),backup=join(app.getPath('userData'),'mod-backups')
  fs.mkdirSync(backup,{recursive:true})
  const saved=join(backup,'WheelLive-'+previous+'.dll')
  if(!fs.existsSync(saved))fs.copyFileSync(target,saved)
  const temp=target+'.'+randomUUID()+'.tmp'
  try{fs.copyFileSync(source,temp);fs.renameSync(temp,target)}finally{try{fs.unlinkSync(temp)}catch{}}
  fs.writeFileSync(join(dirname(target),'.zl-version-wheellive'),manifest.version,'utf8')
}
