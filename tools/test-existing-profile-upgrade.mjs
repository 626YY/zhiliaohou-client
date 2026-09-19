// 在现有正式资料的备份副本上验升级；原资料、真实素材与游戏目录全部只读。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {_electron as electron} from 'playwright-core'
import {writeHiddenElectronBootstrap,prepareIsolatedGameProfile} from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..'),workspace=path.dirname(root)
const output=path.join(root,'output/playwright/existing-profile-upgrade')
const buildDir=process.env.ZL_UPGRADE_OUT_DIR||'output/profile-upgrade-build'
const backup=process.env.ZL_PROFILE_BACKUP||await fs.readFile(path.join(workspace,'Tmp/live-data/local-formal-backup-path.txt'),'utf8')
const source=path.join(backup.trim(),'profile')
const checks=[],errors=[];let completed=false,app,service
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)}
const stable=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v)
const equal=(a,b)=>stable(a)===stable(b)
const hash=b=>createHash('sha256').update(b).digest('hex')
const readJson=async p=>JSON.parse(await fs.readFile(p,'utf8'))
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const exe=path.join(root,'node_modules/electron/dist/electron.exe')
await fs.mkdir(output,{recursive:true});await fs.access(path.join(root,buildDir,'main/index.js'))
const profile=await fs.mkdtemp(path.join(output,'session-'))
const isolated=await prepareIsolatedGameProfile(root,profile)
await fs.cp(source,profile,{recursive:true})
const originalRules=await readJson(path.join(source,'data/entertainment_rules.json'))
const originalSettings=await readJson(path.join(source,'data/settings.json'))
const originalUserBytes=await fs.readFile(path.join(source,'data/users.json'))
check('existing profile really contains saved rules',originalRules.length>0)
// 只在副本替换游戏路径，禁止误触真实 Mod；素材路径与全部规则保持原值。
const baselineSettings={...originalSettings,...isolated,guideSeen:true,assetGuideSeen:true,autoLogin:false,timeLogWindow:false}
await fs.writeFile(path.join(profile,'data/settings.json'),JSON.stringify(baselineSettings))
const fileBefore={}
for(const name of ['entertainment_rules','ent-presets','danmaku_forward','keyboard-widget','effects-widget','entrance','marquee','progress','wish','queue-widget','sticker-stats']){
  const p=path.join(profile,'data',name+'.json');try{fileBefore[name]=await readJson(p)}catch{}
}
let storageBefore={}
const blank=path.join(profile,'storage-only.html'),blankEntry=path.join(profile,'storage-only.cjs')
await fs.writeFile(blank,'<!doctype html><title>Profile preservation check</title>')
await fs.writeFile(blankEntry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{offscreen:true}});w.loadFile(${JSON.stringify(blank)})});`)
try{
  app=await electron.launch({executablePath:exe,args:[blankEntry],cwd:root,env})
  const blankPage=await app.firstWindow();await blankPage.waitForLoadState()
  storageBefore=await blankPage.evaluate(()=>Object.fromEntries(Object.entries(localStorage)))
  check('saved entertainment browser configuration is present',Object.keys(storageBefore).some(k=>/^(ent_|ent-|zl_widget)/.test(k)))
  await app.close();app=null

  // 真实临时卡密服务；不给此账号授权，保证旧自动开启项不会执行键鼠或真实项目动作。
  const py=path.join(profile,'service.py')
  await fs.writeFile(py,`import sys,json,secrets,threading\nfrom pathlib import Path\nsys.path.insert(0,${JSON.stringify(path.join(workspace,'卡密系统'))})\nfrom app import create_app,create_admin\nfrom werkzeug.serving import make_server,WSGIRequestHandler\nclass Quiet(WSGIRequestHandler):\n def log(self,*a,**k): pass\na=create_app({'DATA_DIR':Path(sys.argv[1]),'IDENTITY_MODE':'local','LEGACY_TOKEN_FILE':'','LEGACY_URL':''})\np=secrets.token_urlsafe(24)\ncreate_admin(a,'owner@upgrade.test',secrets.token_urlsafe(24))\nr=a.test_client().post('/api/v1/register',json={'email':'profile@upgrade.test','password':p})\nassert r.status_code==201\ns=make_server('127.0.0.1',0,a,threaded=True,request_handler=Quiet)\nprint(json.dumps({'origin':'http://127.0.0.1:'+str(s.server_port),'publicKey':a.extensions['signing'].public()['key'],'password':p}),flush=True)\nt=threading.Thread(target=s.serve_forever,daemon=True);t.start()\ntry: sys.stdin.readline()\nfinally: s.shutdown();s.server_close();t.join(5)\n`)
  service=spawn('python',[py,path.join(profile,'service-data')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']})
  const conf=await new Promise((resolve,reject)=>{
    let text=''
    const timeout=setTimeout(()=>reject(Error('isolated platform startup timed out')),30000)
    service.once('exit',()=>{clearTimeout(timeout);reject(Error('isolated platform exited'))})
    service.stdout.on('data',b=>{
      text+=b.toString()
      if(text.includes('\n')){
        clearTimeout(timeout)
        try{resolve(JSON.parse(text.split('\n')[0]))}catch{reject(Error('invalid fixture startup response'))}
      }
    })
    service.stderr.on('data',()=>{})
  })
  await fs.writeFile(path.join(profile,'license-provider.json'),JSON.stringify({provider:'card',origin:conf.origin,publicKey:conf.publicKey}))
  const entry=await writeHiddenElectronBootstrap(root,profile,{isolateGames:false,outDir:buildDir,offscreen:true})
  app=await electron.launch({executablePath:exe,args:[entry],cwd:root,env})
  const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
  await page.waitForFunction(()=>!!window.api?.cardState)
  check('queue remains unlimited as requested',(await page.evaluate(()=>window.api.getSettings())).settings.videoQueueLimit===0)
  const login=await page.evaluate(p=>window.api.emailLogin('profile@upgrade.test',p),conf.password)
  check('new card account can log in while old data remains',login.ok===true)
  await page.reload();await page.getByRole('link',{name:'娱乐助手',exact:true}).waitFor()
  const closePrompt=async()=>{const d=page.getByRole('dialog');if(await d.count()){const close=d.getByRole('button',{name:/稍后|取消|关闭|知道了/}).first();if(await close.count())await close.click();else await page.keyboard.press('Escape')}}
  await page.waitForTimeout(1800);await closePrompt()
  const goto=async id=>{await page.evaluate(id=>location.hash='/ent?tool='+id,id);await page.getByTestId('basic-feature-guide').waitFor();await page.waitForTimeout(500)}
  for(const id of ['gift','time','video','green','wheel','nine','challenge','overtime','effects','progress','entrance','marquee','keyboard','protect']){
    await goto(id)
    const mode=page.getByRole('group',{name:'配置模式',exact:true})
    await mode.getByRole('button',{name:'高级',exact:true}).click();await mode.getByRole('button',{name:'基础',exact:true}).click()
    check(id+': existing page opens and modes switch',await mode.getByRole('button',{name:'基础',exact:true}).getAttribute('aria-pressed')==='true')
  }
  await goto('gift')
  const edit=page.getByTitle('编辑',{exact:true}).first()
  if(await edit.count()){
    await edit.click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
    check('opening an existing rule then cancelling preserves it',equal(await readJson(path.join(profile,'data/entertainment_rules.json')),fileBefore.entertainment_rules))
  }
  const storageAfter=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)))
  const protectedKeys=Object.keys(storageBefore).filter(k=>/^(ent_|ent-|zl_widget)/.test(k))
  const changed=protectedKeys.filter(k=>storageBefore[k]!==storageAfter[k])
  if(changed.length){
    const fields=(a,b,p='')=>{if(equal(a,b))return [];if(!a||!b||typeof a!=='object'||typeof b!=='object')return [p];return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>fields(a[k]??null,b[k]??null,p?p+'.'+k:k))}
    console.log('Changed saved configuration keys',JSON.stringify(changed.map(key=>{try{return {key,fields:fields(JSON.parse(storageBefore[key]),JSON.parse(storageAfter[key]))}}catch{return {key,fields:['value']}}})))
  }
  check('all '+protectedKeys.length+' existing entertainment storage values are preserved',changed.length===0)
  for(const [name,value] of Object.entries(fileBefore))check(name+': saved data unchanged',equal(await readJson(path.join(profile,'data',name+'.json')),value))
  const after=(await page.evaluate(()=>window.api.getSettings())).settings
  for(const name of ['pinyouAssetRoot','videoQueue','videoPoolSlots','videoDefaultSlot','videoQueueLimit','outputCaptureMode','outputTitleStyle','outputsAlwaysOnTop','chromaKey'])if(name in baselineSettings)check(name+': configured value retained',equal(after[name],baselineSettings[name]))
  check('old account records remain byte-identical',hash(await fs.readFile(path.join(profile,'data/users.json')))===hash(originalUserBytes))
  check('all original saved gift rules remain byte-equivalent in meaning',equal(await readJson(path.join(profile,'data/entertainment_rules.json')),originalRules))
  await page.reload();await page.getByRole('link',{name:'娱乐助手',exact:true}).waitFor();await page.waitForTimeout(600)
  check('reload still preserves existing rules',equal(await readJson(path.join(profile,'data/entertainment_rules.json')),originalRules))
  check('no renderer errors',errors.length===0)
  check('original backup is untouched',hash(await fs.readFile(path.join(source,'data/users.json')))===hash(originalUserBytes)&&equal(await readJson(path.join(source,'data/entertainment_rules.json')),originalRules))
  completed=true;console.log('EXISTING PROFILE UPGRADE '+checks.length+'/'+checks.length+' PASS')
}finally{
  if(app)await app.close()
  if(service&&service.exitCode===null){service.stdin.end('\n');const child=service;setTimeout(()=>{if(child.exitCode===null)child.kill()},4000).unref()}
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({completed,checks,errors,originalRuleCount:originalRules.length,originalEntertainmentStorageCount:Object.keys(storageBefore).filter(k=>/^(ent_|ent-|zl_widget)/.test(k)).length},null,2))
}
