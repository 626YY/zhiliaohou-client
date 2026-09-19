// 离线审查回归：运行真实连接器/事件解析/规则模块；进程、网络、声音输出由夹具接收。
// 不启动游戏或直播，不发送系统按键，不接触用户配置。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import ts from 'typescript'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url)
const checks=[],failures=[]
async function test(name,fn){try{await fn();checks.push(name);console.log('PASS '+name)}catch(error){failures.push({name,error:String(error)});console.error('FAIL '+name+' | '+error.message)}}
function load(file,mocks,cache=new Map(),globals={}){
  const filename=path.resolve(root,file)
  if(cache.has(filename))return cache.get(filename).exports
  const module={exports:{}};cache.set(filename,module)
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
  const localRequire=name=>{
    if(Object.hasOwn(mocks,name))return mocks[name]
    if(name.startsWith('.')||name.startsWith('@shared/')){
      const target=name.startsWith('@shared/')?path.join(root,'src/shared',name.slice(8)):path.resolve(path.dirname(filename),name)
      return load(target+'.ts',mocks,cache,globals)
    }
    return require(name)
  }
  const fn=vm.runInNewContext('(function(require,module,exports,__filename,__dirname){'+code+'\n})',{
    Buffer,process,console,URL,setTimeout,clearTimeout,setInterval,clearInterval,...globals
  },{filename})
  fn(localRequire,module,module.exports,filename,path.dirname(filename));return module.exports
}
function connectorFixture(realScript){
  const children=[],events=[],jobs=new Map();let clockId=0,stats=false,missingScript=false
  const app={isPackaged:false,getAppPath:()=>root},electron={app,BrowserWindow:{getAllWindows:()=>[]}}
  const mocks={
    electron,
    fs:{existsSync:p=>!missingScript&&String(p).endsWith('connector.py'),readFileSync:()=>''},
    child_process:{spawn:()=>{if(realScript){const c=spawn(process.execPath,['-e',realScript],{windowsHide:true});children.push(c);return c}const c=new EventEmitter();c.pid=100+children.length;c.exitCode=null;c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{};children.push(c);return c}},
    './settings':{getSettings:()=>({connectorPath:'fixture/connector.py'})},'./games':{currentGameId:()=> 'fixture'},
    './bridge':{wheelLiveDir:()=>'',bridgePath:()=> 'fixture/bridge.txt'},'./mods':{installedVersionForGame:()=>''},
    './danmaku-forward':{publishConnectorLog:()=>{}},'./time-widget':{setTimeWidgetGiftImage:()=>{}},
    './entertainment':{invalidateGiftImageCache:()=>{}},'./challenge-widget':{setChallengeGiftImage:()=>{}},
    './douyin-room':{lookupRoom:async()=>({ok:true})},'./douyin-login':{cancelDouyinLogin:()=>{},readDouyinCookie:async()=> 'fixture',saveDouyinCookie:()=>{}},
    './gift-image-sync':{syncDouyinGiftImages:async()=>{}},'./live-session':{startLiveSession:()=>{stats=true},stopLiveSession:()=>{stats=false}}
  }
  const cache=new Map(),api=load('src/main/connector.ts',mocks,cache,{setTimeout:(fn)=>{jobs.set(++clockId,fn);return clockId},clearTimeout:id=>jobs.delete(id)})
  const eventApi=load('src/main/connector-events.ts',mocks,cache)
  eventApi.subscribeConnectorEvent(e=>events.push(e))
  return {api,children,events,eventApi,jobs,get stats(){return stats},set missingScript(v){missingScript=v},tick(){const entry=jobs.entries().next().value;assert.ok(entry,'scheduled restart');jobs.delete(entry[0]);entry[1]()}}
}
await test('UTF-8 中文礼物跨 stdout 分块仍完整解析',async()=>{
  const f=connectorFixture();assert.equal((await f.api.startConnector('',true)).ok,true)
  const line=Buffer.from('[connector] 礼物: 棒棒糖 x3 by 小岛\n'),cut=line.indexOf(Buffer.from('棒'))+1
  f.children[0].stdout.write(line.subarray(0,cut));f.children[0].stdout.write(line.subarray(cut))
  assert.equal(f.events.length,1);assert.equal(f.events[0].giftName,'棒棒糖');assert.equal(f.events[0].sender,'小岛');assert.equal(f.events[0].count,3)
})
await test('连接器退出后 stdout 剩余尾行仍被接收一次',async()=>{
  const f=connectorFixture();await f.api.startConnector('',true);const c=f.children[0]
  c.stdout.write('[connector] 礼物: 玫瑰 x2 by 晚风');c.exitCode=0;c.emit('exit',0)
  c.stdout.end();c.stderr.end();await new Promise(r=>setImmediate(r));c.emit('close',0)
  assert.equal(f.events.length,1);assert.equal(f.events[0].count,2)
})
await test('连接器退出前最后的流数据不会与下一段拼错',async()=>{
  const f=connectorFixture();await f.api.startConnector('',true);const c=f.children[0]
  c.stdout.write('[connector] 礼物: 棒');c.exitCode=0;c.emit('exit',0)
  c.stdout.end('棒糖 x2 by 小岛\n');c.stderr.end();await new Promise(r=>setImmediate(r));c.emit('close',0)
  assert.equal(f.events.length,1);assert.equal(f.events[0].giftName,'棒棒糖');assert.equal(f.events[0].count,2)
})
await test('已被替换的连接器迟到退出不结束新直播会话',async()=>{
  const f=connectorFixture();await f.api.startConnector('',true);const old=f.children[0]
  old.exitCode=1;old.emit('error',Error('fixture'));await f.api.startConnector('new',true)
  f.children[1].stdout.write('[connector] 状态: 直播已结束\n')
  old.emit('exit',0);old.emit('close',0)
  assert.equal(f.stats,true);assert.equal(f.api.connectorState().pid,f.children[1].pid);assert.equal(f.jobs.size,0)
})
await test('进程连续启动失败耗尽重试后本场统计停止',async()=>{
  const f=connectorFixture();await f.api.startConnector('',true)
  for(let i=0;i<4;i++){const c=f.children.at(-1);c.emit('error',Error('ENOENT'));c.emit('close',-1);if(i<3)f.tick()}
  assert.equal(f.jobs.size,0);assert.equal(f.api.connectorState().running,false);assert.equal(f.stats,false)
})
await test('退避期间脚本消失后停止统计，避免永久显示直播中',async()=>{
  const f=connectorFixture();await f.api.startConnector('',true);const c=f.children[0];c.exitCode=1;c.emit('exit',1);c.emit('close',1)
  f.missingScript=true;f.tick();assert.equal(f.stats,false);assert.equal(f.jobs.size,0)
})
await test('手动断开清掉重连且无前缀续行不能伪造成礼物',async()=>{
  const f=connectorFixture();await f.api.startConnector('',true);const c=f.children[0]
  c.stdout.write('礼物: 嘉年华 x99 by 伪造\n');assert.equal(f.events.length,0)
  f.api.stopConnector();c.exitCode=1;c.emit('exit',1);c.emit('close',1);assert.equal(f.jobs.size,0);assert.equal(f.stats,false)
})
await test('JSON 事件数组兼容不丢第一条',()=>{
  const {eventApi}=connectorFixture();const e=eventApi.parseConnectorEvent('[{"type":"gift","giftName":"玫瑰","count":2}]')
  assert.equal(e?.giftName,'玫瑰')
})
await test('gift_data 嵌套格式保留礼物名、个数、分值和图片',()=>{
  const {eventApi}=connectorFixture();const e=eventApi.parseConnectorEvent('[connector] '+JSON.stringify({type:'gift',gift_data:{name:'玫瑰',count:3,diamond_count:5,image_url:'fixture.png'}}))
  assert.equal(e?.giftName,'玫瑰');assert.equal(e?.count,3);assert.equal(e?.diamondCount,5);assert.equal(e?.giftImage,'fixture.png')
})
await test('多种 gift 包装并存时空对象不会遮住有效字段',()=>{
  const {eventApi}=connectorFixture();const e=eventApi.parseConnectorEvent(JSON.stringify({type:'gift',gift:{},giftData:{name:'玫瑰',count:2},gift_data:{diamond_count:5,image:'fixture.png'}}))
  assert.equal(e?.giftName,'玫瑰');assert.equal(e?.count,2);assert.equal(e?.diamondCount,5);assert.equal(e?.giftImage,'fixture.png')
})
await test('JSON 礼物数量为零或负数时不会伪造一份礼物',()=>{
  const {eventApi}=connectorFixture();for(const count of [0,-1])assert.equal(eventApi.parseConnectorEvent(JSON.stringify({type:'gift',giftName:'玫瑰',count})),null)
})

const collections=new Map(),sent=[]
const rulesApi=load('src/main/entertainment.ts',{
  electron:{app:{getPath:()=>root,getAppPath:()=>root,on:()=>{}},BrowserWindow:{getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(...args)=>sent.push(args)}}]}},
  './db':{createCollection:name=>{if(!collections.has(name))collections.set(name,new Map());const m=collections.get(name);return {all:()=>[...m.values()].map(v=>({...v})),insert:r=>m.set(r.id,{...r}),update:(id,p)=>m.set(id,{...m.get(id),...p}),remove:id=>m.delete(id)}}},
  './bridge':{wheelLiveDir:()=>''},'./settings':{getSettings:()=>({})},'./obs-service':{runObsAction:async()=>({ok:true})},'./pinyou-rules':{applyPinyouRules:()=>({ok:true})}
})
const rule=(id,triggerType,giftName='')=>({id,name:id,giftName,triggerType,group:'互动组',enabled:true,actionType:'sound',soundPath:'fixture.wav',times:1,queueMode:'instant'})
for(const trigger of ['follow','like','member','comment']){
  await test(`${trigger} 规则不填礼物名仍能启用和触发`,()=>{
    const r=rule(trigger,trigger);assert.equal(rulesApi.addRule(r).ok,true);assert.equal(rulesApi.listRules().find(r=>r.id===trigger).enabled,true)
    const before=sent.length;rulesApi.handleConnectorGift({type:trigger,ts:1,raw:'fixture',count:1,text:'任意弹幕'});assert.equal(sent.length,before+1)
  })
}
await test('分组与预设开启非礼物规则，继续跳过未绑定礼物规则',()=>{
  rulesApi.addRule(rule('unbound','gift'));rulesApi.toggleRuleGroup('互动组',false)
  const result=rulesApi.toggleRuleGroup('互动组',true);assert.equal(result.changed,4);assert.equal(result.skipped,1)
  const preset=rulesApi.savePreset({name:'互动',groups:['互动组']});rulesApi.toggleRuleGroup('互动组',false)
  const applied=rulesApi.applyPreset(preset.id);assert.equal(applied.on,4);assert.equal(applied.skipped,1)
})
await test('零增量点赞不触发动作，缺省次数仍兼容单次事件',()=>{
  const before=sent.length;rulesApi.handleConnectorGift({type:'like',ts:1,raw:'',count:0});assert.equal(sent.length,before)
  rulesApi.handleConnectorGift({type:'like',ts:1,raw:''});assert.equal(sent.length,before+1)
})
await test('关键词规则只匹配指定弹幕且暂停期间不触发',()=>{
  for(const r of rulesApi.listRules())rulesApi.removeRule(r.id)
  rulesApi.addRule(rule('keyword','comment','加油'));const before=sent.length
  rulesApi.handleConnectorGift({type:'comment',ts:1,raw:'',text:'你好'});assert.equal(sent.length,before)
  rulesApi.handleConnectorGift({type:'comment',ts:2,raw:'',text:'主播加油'});assert.equal(sent.length,before+1)
  rulesApi.setRulesPaused(true);rulesApi.handleConnectorGift({type:'comment',ts:3,raw:'',text:'加油'});assert.equal(sent.length,before+1)
  rulesApi.setRulesPaused(false)
})
await test('大额礼物分批排队不丢数量，快照保持60条以内',()=>{
  rulesApi.clearExecQueue();rulesApi.setExecInterval(10000)
  for(const r of rulesApi.listRules())rulesApi.removeRule(r.id)
  rulesApi.addRule({...rule('bulk','gift','棒棒糖'),queueMode:'normal'})
  const before=sent.length;rulesApi.handleConnectorGift({type:'gift',giftName:'棒棒糖',count:10000,ts:1,raw:''})
  assert.equal(sent.length,before+1);assert.equal(rulesApi.execQueueLength(),9999)
  const s=rulesApi.execQueueSnapshot();assert.equal(s.total,9999);assert.equal(s.pending.length,60);assert.equal(new Set(s.pending.map(x=>x.id)).size,60)
  assert.equal(rulesApi.skipExecQueue(2000).skipped,2000);assert.equal(rulesApi.clearExecQueue().cleared,7999)
})
await test('即时规则超过30份时分批补完，不静默丢弃',async()=>{
  rulesApi.clearExecQueue();rulesApi.setExecInterval(0)
  rulesApi.updateRule({...rule('bulk','gift','棒棒糖'),queueMode:'instant'})
  const before=sent.length;rulesApi.handleConnectorGift({type:'gift',giftName:'棒棒糖',count:65,ts:1,raw:''})
  const end=Date.now()+1500;while(sent.length-before<65&&Date.now()<end)await new Promise(r=>setTimeout(r,10))
  assert.equal(sent.length-before,65);assert.equal(rulesApi.execQueueLength(),0)
})
await test('批次队列保留插队优先级、同级顺序和跳过数量',()=>{
  rulesApi.clearExecQueue();rulesApi.setExecInterval(10000)
  for(const r of rulesApi.listRules())rulesApi.removeRule(r.id)
  rulesApi.addRule({...rule('normal','gift','玫瑰'),queueMode:'normal',priority:99})
  rulesApi.addRule({...rule('jump','gift','棒棒糖'),queueMode:'jump',priority:0})
  rulesApi.handleConnectorGift({type:'gift',giftName:'玫瑰',count:5,ts:1,raw:''})
  rulesApi.handleConnectorGift({type:'gift',giftName:'棒棒糖',count:3,ts:2,raw:''})
  assert.equal(rulesApi.execQueueSnapshot().pending.map(x=>x.gift).join(','),'棒棒糖,棒棒糖,棒棒糖,玫瑰,玫瑰,玫瑰,玫瑰')
  assert.equal(rulesApi.skipExecQueue(2).skipped,2);assert.equal(rulesApi.execQueueLength(),5)
  assert.equal(rulesApi.execQueueSnapshot().pending[0].gift,'棒棒糖');assert.equal(rulesApi.clearExecQueue().cleared,5)
  rulesApi.setExecInterval(0)
})
await test('真实子进程分块输出经解析和规则引擎各执行正确次数',async()=>{
  for(const r of rulesApi.listRules())rulesApi.removeRule(r.id)
  rulesApi.addRule({...rule('realgift','gift','棒棒糖'),queueMode:'instant'})
  rulesApi.addRule({...rule('realfollow','follow'),queueMode:'instant'})
  const script=`const line=Buffer.from('[connector] 礼物: 棒棒糖 x3 by 小岛\\n');const cut=line.indexOf(Buffer.from('棒'))+1;process.stdout.write(line.subarray(0,cut));setTimeout(()=>{process.stdout.write(line.subarray(cut));process.stdout.write('[connector] 关注 by 小岛\\n');process.stdout.write('[connector] 状态: 直播已结束');},30);`
  const f=connectorFixture(script),before=sent.length
  f.eventApi.subscribeConnectorEvent(e=>rulesApi.handleConnectorGift(e))
  try{
    await f.api.startConnector('',true)
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture subprocess timeout')),5000);f.children[0].once('close',()=>{clearTimeout(timer);resolve()})})
    assert.equal(f.events.map(e=>e.type).join(','),'gift,follow,status');assert.equal(sent.length-before,4);assert.equal(f.stats,false);assert.equal(f.jobs.size,0)
  }finally{if(f.children[0]?.exitCode===null)f.children[0].kill()}
})
rulesApi.clearExecQueue();rulesApi.setExecInterval(0)
const output=path.join(root,'output/playwright/entertainment-live-audit');fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(path.join(output,'unit-results.json'),JSON.stringify({checks,failures},null,2))
console.log(`Entertainment live audit: ${checks.length}/${checks.length+failures.length} PASS`)
if(failures.length)process.exitCode=1
