// 真实平台签发 → 完整客户端取证/落盘/撤销；文件全在隔离目录，不启动游戏。
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID,createHash} from 'node:crypto'
import {build} from 'esbuild'
import {_electron as electron} from 'playwright-core'
import {writeHiddenElectronBootstrap} from './electron-test-bootstrap.mjs'
const root=path.resolve(import.meta.dirname,'..'),workspace=path.dirname(root)
const outDir=process.env.ZL_MOD_CARD_OUT_DIR||'output/formal-combined-build'
const out=path.join(root,'output/playwright/mod-card-client')
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile,{outDir,offscreen:true})
const settings=JSON.parse(await fs.readFile(path.join(profile,'data/settings.json'),'utf8'))
const modDir=path.join(path.dirname(settings.gamePaths['4wheel-challenge']),'Mods/WheelLive')
await fs.mkdir(modDir,{recursive:true})
const config={LiveRoomId:'123456789',CustomBoxes:[{Name:'保留原盲盒',GiftName:'小心心'}],UnknownFutureOption:17}
await fs.writeFile(path.join(modDir,'config.json'),JSON.stringify(config))
await fs.writeFile(path.join(modDir,'license_status.json'),'old status stays untouched')
await fs.writeFile(path.join(modDir,'.wl_lic_cache.json'),'old cache stays untouched')
await fs.writeFile(path.join(modDir,'bridge.txt'),'')
const dll=path.join(path.dirname(modDir),'WheelLive.dll')
await fs.writeFile(dll,'previous isolated dll fixture')
const backupRoot=(await fs.readFile(path.join(workspace,'Tmp/live-data/local-formal-backup-path.txt'),'utf8')).trim()
const service=spawn('python',[path.join(root,'tools/mod-card-fixture.py'),path.join(workspace,'卡密系统'),path.join(profile,'service-data'),path.join(backupRoot,'platform-with-mod-key')],{windowsHide:true,stdio:['pipe','pipe','pipe']})
const lines=[],readers=[];let buf='';service.stderr.on('data',()=>{})
service.stdout.on('data',b=>{buf+=b.toString();for(;;){const i=buf.indexOf('\n');if(i<0)break;const line=buf.slice(0,i);buf=buf.slice(i+1);if(readers.length)readers.shift()(line);else lines.push(line)}})
const read=()=>new Promise((resolve,reject)=>{if(lines.length){resolve(JSON.parse(lines.shift()));return}const timer=setTimeout(()=>reject(Error('isolated service response timeout')),30000);readers.push(line=>{clearTimeout(timer);try{resolve(JSON.parse(line))}catch{reject(Error('invalid service response'))}})})
const platform=await read()
await fs.writeFile(path.join(profile,'license-provider.json'),JSON.stringify({provider:'card',origin:platform.origin,publicKey:platform.publicKey,modPublicKeys:{'game:4wheel-challenge':{keyXml:platform.modKey.key_xml,fingerprint:platform.modKey.fingerprint}}}))
const built=await build({entryPoints:[path.join(root,'src/main/mod-lease-verify.ts')],bundle:true,platform:'node',format:'esm',write:false})
const {verifyModLease}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
let app,completed=false;const checks=[]
const check=(name,value)=>{if(!value)throw Error(name);checks.push(name);console.log('PASS '+name)}
const wait=async(fn,label)=>{const until=Date.now()+15000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,150))}throw Error(label)}
const lease=async()=>JSON.parse(await fs.readFile(path.join(modDir,'local-card-license.json'),'utf8'))
const grant=async(product,mode,email)=>{service.stdin.write(JSON.stringify({op:'grant',product,mode,email})+'\n');const r=await read();if(!r.ok)throw Error('fixture grant failed')}
try{
  app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry],cwd:root,env})
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.api?.cardState)
  const api=(name,...args)=>page.evaluate(({name,args})=>window.api[name](...args),{name,args})
  check('startup selects card mode without using old cache',(await lease()).provider==='card'&&!(await lease()).lease)
  const email=randomUUID()+'@broker.test',password=randomUUID()+'Aa!'
  check('real platform registration',(await api('emailRegister',email,'',password,'验收')).ok)
  service.stdin.write(JSON.stringify({op:'bind',email,room:config.LiveRoomId})+'\n')
  check('fixture supplies server-confirmed binding for this mod test',(await read()).ok)
  const user=(await api('session')).id
  check('platform card activates',(await api('cardRedeem',platform.codes.platform)).ok)
  check('platform alone cannot unlock wheel',!(await lease()).lease)
  check('wheel card activates',(await api('cardRedeem',platform.codes.wheel)).ok)
  await wait(async()=>!!(await lease()).lease,'wheel lease not written')
  const token=(await lease()).lease,claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'))
  const verified=verifyModLease(token,platform.modKey.key_xml,{sub:user,product:'game:4wheel-challenge',room:config.LiveRoomId,machineId:claims.machine_id,nonce:claims.nonce})
  check('client writes an actually signed short lease',verified.exp>Math.floor(Date.now()/1000)&&verified.exp-verified.iat<=120)
  check('lease is bound to current customer/game/room',verified.sub===user&&verified.room===config.LiveRoomId&&verified.product_id==='game:4wheel-challenge')
  const result=await api('liveCmd','ping')
  check('authorized command reaches real game-state check without starting a game',result.ok===false&&/未在运行/.test(result.error||''))
  const manifest=JSON.parse(await fs.readFile(path.join(root,'output/local-card-mod/manifest.json'),'utf8'))
  check('matching card DLL installed after authorization',createHash('sha256').update(await fs.readFile(dll)).digest('hex')===manifest.sha256)
  check('previous DLL backed up',(await fs.readdir(path.join(profile,'mod-backups'))).some(name=>name.endsWith('.dll')))
  check('game configuration preserved byte for byte',await fs.readFile(path.join(modDir,'config.json'),'utf8')===JSON.stringify(config))
  check('old license status and cache never changed',await fs.readFile(path.join(modDir,'license_status.json'),'utf8')==='old status stays untouched'&&await fs.readFile(path.join(modDir,'.wl_lic_cache.json'),'utf8')==='old cache stays untouched')
  if(process.argv.includes('--queue')){
    const media=path.join(profile,'queue-long.mp4')
    await promisify(execFile)('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=32x32:r=1:d=600','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true})
    check('card mode queue defaults to unlimited',(await api('getSettings')).settings.videoQueueLimit===0)
    check('real card mode opens green output',(await api('greenScreenOpen','','video','',3)).ok)
    const rule=await api('entertainmentRuleAdd',{id:'',giftName:'千连击验收',actionType:'command',commandCmd:'video-play',commandParam:media,enabled:true,queueMode:'instant',multiply:true,extraActions:[]})
    check('card mode saves video rule',rule.ok)
    await page.evaluate(()=>{window.__queue=null;window.api.onQueueChanged(value=>{window.__queue=value})})
    check('card mode accepts one real 1000 gift event',(await api('connectorSimulate','礼物: 千连击验收 ×1000 by 隔离验收')).ok)
    const deadline=Date.now()+240000
    let queued=0,pending=-1
    while(Date.now()<deadline){const g=await api('greenScreenState'),q=await page.evaluate(()=>window.__queue);queued=g.queued||0;pending=q?(q.total??q.pending.length)+(q.running?1:0):-1;if(queued===999&&pending===0)break;await new Promise(r=>setTimeout(r,500))}
    check('card mode keeps every gift: 1 playing plus 999 queued',queued===999&&pending===0)
    const refreshed=(await lease()).lease,renewed=JSON.parse(Buffer.from(refreshed.split('.')[1],'base64url'))
    verifyModLease(refreshed,platform.modKey.key_xml,{sub:user,product:'game:4wheel-challenge',room:config.LiveRoomId,machineId:renewed.machine_id,nonce:renewed.nonce})
    check('mod lease renews during the long queue',renewed.iat>verified.iat&&renewed.exp>Date.now()/1000)
    await api('entertainmentCommand','video-stop','');await new Promise(r=>setTimeout(r,800))
    const stopped=await api('greenScreenState')
    check('stop explicitly clears the entire 1000 gift queue',stopped.queued===0&&stopped.slots.every(s=>!s.src))
  }
  await grant('game:4wheel-challenge','revoke',email)
  await wait(async()=>!(await lease()).lease,'revoked lease did not clear')
  check('revocation empties lease and retains card mode',(await lease()).provider==='card')
  check('revoked game action denied',(await api('liveCmd','ping')).code==='license_required')
  check('no commands reached the game bridge',await fs.readFile(path.join(modDir,'bridge.txt'),'utf8')==='')
  await grant('game:4wheel-challenge','permanent',email)
  await api('liveCmd','ping');await wait(async()=>!!(await lease()).lease,'new grant did not renew')
  check('new valid grant restores signed lease',!!(await lease()).lease)
  await api('logout');await wait(async()=>!(await lease()).lease,'logout did not clear lease')
  check('logout cannot revive old cache',(await lease()).provider==='card'&&!((await api('cardState')).user))
  completed=true;console.log('MOD CARD CLIENT '+checks.length+'/'+checks.length+' PASS')
}finally{
  if(app)await app.close()
  if(service.exitCode===null){service.stdin.write('{"op":"stop"}\n');setTimeout(()=>{if(service.exitCode===null)service.kill()},4000).unref()}
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({completed,checks},null,2))
}
