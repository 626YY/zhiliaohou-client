import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'
import postcss from 'postcss'
import tailwind from 'tailwindcss'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const out=path.join(root,'output/playwright/lottery-review')
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const fixtureImage=path.join(profile,'素材 # & 中文.svg');await fs.writeFile(fixtureImage,'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><rect width="300" height="60" fill="orange"/><circle cx="40" cy="30" r="20" fill="navy"/></svg>')
const errors=[], checks=[]
const check=(name,ok=true)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)}
const ipc=await fs.readFile(path.join(root,'src/main/ipc.ts'),'utf8')
// 2026-09-09 起中奖动作执行器抽成了具名函数 executePrizeAction，再 setLotteryActionHandler 挂上去；
// 这里照现在的写法截取（原来按 setLotteryActionHandler(async ( 截，改了名字就截成空串，动作永远"未连接"）
const actionBlock=ipc.slice(ipc.indexOf('  const executePrizeAction = async ('),ipc.indexOf('  setLotteryActionHandler(executePrizeAction)'))+'\nsetLotteryActionHandler(executePrizeAction);'
const facade=`const actual=require('electron'); class HiddenWindow extends actual.BrowserWindow { constructor(options){super({...options,show:false})} show(){} showInactive(){} focus(){} } Object.defineProperty(HiddenWindow,'name',{value:'BrowserWindow'}); module.exports={...actual,BrowserWindow:HiddenWindow};`
const preload=path.join(profile,'preload.cjs')
await fs.writeFile(preload,`const {contextBridge,ipcRenderer}=require('electron');ipcRenderer.on('ent:lottery-event',(_,event)=>ipcRenderer.send('test-lottery-event',event));contextBridge.exposeInMainWorld('api',{
 lotteryOpen:(...a)=>ipcRenderer.invoke('lottery-open',...a),lotteryConfigure:(...a)=>ipcRenderer.invoke('lottery-configure',...a),lotterySpin:(...a)=>ipcRenderer.invoke('lottery-spin',...a),lotteryClose:(...a)=>ipcRenderer.invoke('lottery-close',...a),lotteryState:()=>ipcRenderer.invoke('lottery-state'),
 lotteryHistory:async()=>[],lotteryHistoryClear:async()=>({ok:true}),
 onLotteryEvent:cb=>{const f=(_,v)=>cb(v);ipcRenderer.on('ent:lottery-event',f);return()=>ipcRenderer.removeListener('ent:lottery-event',f)},entertainmentListGiftImages:async()=>[],selectFile:async()=>({ok:false}),advancedWheelState:async()=>({one:false,two:false}),advancedWheelUpdate:async()=>({ok:true}),outputWindowResize:async()=>({ok:true}),outputWindowSize:async()=>null});`)
const uiEntry=`import React from 'react';import{createRoot}from'react-dom/client';import {lotteryImageSrc} from './src/renderer/src/components/LotteryPreview';window.testImageSrc=lotteryImageSrc;import Wheel from './src/renderer/src/pages/EntertainmentWheel';import Nine from './src/renderer/src/pages/EntertainmentNineGrid';const kind=new URLSearchParams(location.search).get('view');createRoot(document.getElementById('root')).render(kind==='nine'?<Nine/>:<Wheel/>);`
await build({stdin:{contents:uiEntry,loader:'tsx',resolveDir:root},outfile:path.join(profile,'ui.js'),jsx:'automatic',bundle:true,platform:'browser',format:'iife',alias:{'@shared':path.join(root,'src/shared')}})
const componentCss=await fs.readFile(path.join(profile,'ui.css'),'utf8')
const cssSource=path.join(root,'src/renderer/src/index.css')
const css=await postcss([tailwind(path.join(root,'tailwind.config.js'))]).process(await fs.readFile(cssSource,'utf8'),{from:cssSource})
await fs.writeFile(path.join(profile,'ui.css'),css.css+'\n'+componentCss)
const art=path.join(root,'src/renderer/public/entertainment-assets/wheel-premium-bg.png')
for(const dir of ['entertainment-assets','out/renderer/entertainment-assets']){await fs.mkdir(path.join(profile,dir),{recursive:true});await fs.copyFile(art,path.join(profile,dir,'wheel-premium-bg.png'))}
await fs.writeFile(path.join(profile,'ui.html'),`<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><body style="padding:24px;background:var(--bg)"><div id="root"></div><script src="ui.js"></script></body></html>`)
const code=`const {app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(profile)});globalThis.draws=[];globalThis.actionCalls=[];globalThis.created=[];
const lottery=require('./src/main/lottery-widget');const time=require('./src/main/time-widget'),video=require('./src/main/video-widget'),green=require('./src/main/green-screen'),effects=require('./src/main/effects-widget');
const {openVideoWidget}=video,{openGreenScreen}=green,{timeWidgetAdjust}=time,{openEffectsWindow,effectsFire}=effects;
globalThis.gameId='librarian';globalThis.liveStateImpl=async()=>({inGame:false});globalThis.prankCalls=[];
const currentGameId=()=>globalThis.gameId,liveState=()=>globalThis.liveStateImpl(),livePrank=async id=>{globalThis.prankCalls.push({game:globalThis.gameId,id});return {ok:true}},entertainmentCommand=async(cmd)=>cmd==='countdown-clear'?time.timeWidgetClear():({ok:false});
// executePrizeAction 里用到的 output-window 帮手，这里给个替身（真实实现只在打包后的主进程里）
const captureSourceBackground=()=>'#000000';
// 与 src/main/entertainment.ts 的 splitVideoTarget 同一套后缀语义：|绿幕N / |视频（★模板字符串里 \s 要写成 \\s）
const splitVideoTarget=(raw)=>{const m=/^(.*?)\\s*\\|\\s*(?:绿幕\\s*([1-4])(固定)?|(固定)|视频)$/.exec(String(raw||'').trim());if(!m)return {rest:String(raw||'').trim(),target:0,overflow:true};if(m[4])return {rest:m[1].trim(),target:0,overflow:false};return {rest:m[1].trim(),target:m[2]?Number(m[2]):'video',overflow:!m[3]}};
const setLotteryActionHandler=fn=>{globalThis.action=fn;lottery.setLotteryActionHandler(async(i,context)=>{globalThis.actionCalls.push(i);return fn(i,context)})};
${actionBlock}
globalThis.test={lottery,time,video,green,effects};ipcMain.on('test-lottery-event',(_,event)=>globalThis.draws.push(event));app.on('browser-window-created',(_,w)=>globalThis.created.push(w.getTitle()));
ipcMain.handle('lottery-open',(_,kind,items,img)=>kind==='nine'?lottery.openNineGridWindow(items):kind==='lucky'?lottery.openLuckyWindow(items,img):lottery.openWheelWindow(items));
ipcMain.handle('lottery-configure',(_,kind,t,items,img)=>lottery.configureLottery(kind,t,items,img));ipcMain.handle('lottery-close',(_,kind)=>lottery.closeLotteryWindow(kind));ipcMain.handle('lottery-spin',(_,kind)=>lottery.lotterySpin(kind));ipcMain.handle('lottery-state',()=>lottery.lotteryState());
app.whenReady().then(()=>{const w=new BrowserWindow({width:1180,height:950,webPreferences:{preload:${JSON.stringify(preload)},backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(profile,'ui.html'))});});`
await build({stdin:{contents:code,loader:'ts',resolveDir:root},outfile:path.join(profile,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],alias:{'@shared':path.join(root,'src/shared')},plugins:[{name:'all-windows-hidden',setup(b){b.onResolve({filter:/^electron$/},a=>a.namespace==='hidden'?{path:'electron',external:true}:{path:'electron',namespace:'hidden'});b.onLoad({filter:/.*/,namespace:'hidden'},()=>({contents:facade,loader:'js',resolveDir:root}))}}]})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(profile,'main.cjs')],env})
const api=(fn,arg)=>app.evaluate(fn,arg)
const waitFor=async(fn,timeout=18000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await api(fn))return;await new Promise(r=>setTimeout(r,80))}throw Error('Timed out: '+fn)}
const pageFor=async part=>{const until=Date.now()+10000;while(Date.now()<until){const p=app.windows().find(p=>p.url().includes(part));if(p){await p.waitForLoadState('domcontentloaded');return p}await new Promise(r=>setTimeout(r,50))}throw Error('Missing window '+part)}
const shot=async(page,name)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const w=await app.browserWindow(page);const data=await w.evaluate(async win=>Array.from((await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()));await fs.writeFile(path.join(out,name),Buffer.from(data));await w.dispose()}
const shotFull=async(page,name)=>{const win=await app.browserWindow(page);const old=await win.evaluate(w=>w.getContentSize());const size=await page.evaluate(()=>[innerWidth,Math.max(innerHeight,document.documentElement.scrollHeight)]);await win.evaluate((w,s)=>w.setContentSize(...s),size);await page.waitForFunction(height=>innerHeight>=height,size[1]);try{await shot(page,name)}finally{await win.evaluate((w,s)=>w.setContentSize(...s),old);await win.dispose()}}
const item=(name,action='none',param='')=>({name,color:'#409eff',action,actionParam:param})
try{
 app.on('window',page=>page.on('pageerror',e=>errors.push(e.message)))
 const ui=await app.firstWindow();ui.on('pageerror',e=>errors.push(e.message));await ui.waitForLoadState('domcontentloaded');await ui.getByText('转盘奖项',{exact:true}).waitFor()
 await ui.getByRole('button',{name:'动作',exact:true}).first().click()
 await ui.getByLabel('中奖动作').selectOption('countdown-adjust');await ui.getByLabel('倒计时秒数').fill('15')
 await ui.waitForFunction(()=>JSON.parse(localStorage.getItem('ent-wheel-items'))[0].actionParam==='15')
 check('真实转盘页面可编辑并保存中奖动作')
 const imageInfo=await ui.evaluate(async path=>{const src=window.testImageSrc(path);const im=new Image();im.src=src;await im.decode();return {src,width:im.naturalWidth,hash:new URL(src).hash}},fixtureImage)
 check('页面图片支持中文空格井号与&路径',imageInfo.width===300&&imageInfo.hash===''&&imageInfo.src.includes('%23'))
 await shotFull(ui,'restored-wheel-editor.png')
 check('页面只保留升级转盘的一套窗口入口',await ui.getByRole('button',{name:'转盘窗口',exact:true}).count()===1&&await ui.getByText('高级转盘',{exact:true}).count()===0&&await ui.getByRole('button',{name:'开启',exact:true}).count()===0)
 await ui.getByRole('button',{name:'转盘窗口',exact:true}).click();const previewWheel=await pageFor('lottery-lucky');await previewWheel.waitForFunction(()=>!!window.__startSpin)
 await ui.getByRole('button',{name:'转起来',exact:true}).click();await waitFor(()=>globalThis.test.lottery.lotteryState().draws.wheel?.phase==='result')
 const previewResult=await api(()=>globalThis.test.lottery.lotteryState().draws.wheel)
 await ui.getByText('抽中：'+previewResult.item.name,{exact:true}).waitFor()
 check('真实页面预览与直播窗口显示同一次中奖',await previewWheel.locator('#result').textContent()==='抽中：'+previewResult.item.name)
 await ui.getByLabel('奖项 1 名称').fill('新配置奖项')
 await ui.waitForFunction(()=>!document.body.textContent.includes('抽中：'))
 await previewWheel.waitForFunction(()=>document.getElementById('result').textContent==='')
 check('空闲编辑奖项同步刷新页面和采集窗口并清除旧结果')
 await ui.getByRole('button',{name:'关闭窗口',exact:true}).click()

 await ui.goto('file:///'+path.join(profile,'ui.html').replaceAll('\\','/')+'?view=nine');await ui.getByText('九宫格转盘（3×3）',{exact:true}).waitFor()
 check('九宫格中心只有开始按钮',await ui.getByRole('button',{name:'开始',exact:true}).count()===1)
 check('九宫格只有8个可编辑奖项',await ui.locator('.lottery-nine-board input').count()===8)
 await ui.getByRole('button',{name:'动作',exact:true}).first().click();await ui.getByLabel('中奖动作').selectOption('green-video');await ui.getByLabel('动作 1 视频路径').fill('C:\\素材\\开场.mp4')
 await ui.waitForFunction(()=>JSON.parse(localStorage.getItem('ent-nine-actions'))[0].action==='green-video')
 const nineLayout=await ui.evaluate(()=>{const card=document.querySelector('.zl-card').getBoundingClientRect(),grid=document.querySelector('.grid').getBoundingClientRect();return {card:{x:card.x,width:card.width},grid:{x:grid.x,width:grid.width},ok:grid.right<=card.right&&grid.left>=card.left}})
 check('九宫格编辑盘完整位于面板内',nineLayout.ok)
 await shotFull(ui,'restored-nine-editor.png')
 check('九宫格动作设置按原位置持久化')
 await ui.getByRole('button',{name:'九宫格窗口',exact:true}).click();const previewNine=await pageFor('lottery-nine');await previewNine.waitForFunction(()=>!!window.__startSpin)
 await ui.getByRole('button',{name:'开始',exact:true}).click();await waitFor(()=>globalThis.test.lottery.lotteryState().draws.nine?.phase==='result'||globalThis.test.lottery.lotteryState().draws.nine?.phase==='error')
 const nineResult=await api(()=>globalThis.test.lottery.lotteryState().draws.nine)
 await ui.getByText('抽中：'+nineResult.item.name,{exact:true}).waitFor()
 check('九宫格页面高亮与外圈采集中奖一致',await previewNine.locator('#result').textContent()==='抽中：'+nineResult.item.name&&await ui.locator('.scale-105').count()===1)
 await ui.getByRole('button',{name:'关闭窗口',exact:true}).click()

 // 页面测试结束，配置命令统一使用真实主进程函数，避免其他页面effect覆盖测试配置。
 await fs.writeFile(path.join(profile,'observer.html'),'<html>Observer</html>'); await ui.goto('file:///'+path.join(profile,'observer.html').replaceAll('\\','/'))
 await api(()=>{globalThis.test.time.openTimeWidget({initial:100,on:false,enable:false});globalThis.test.lottery.openWheelWindow([{name:'重复奖项',color:'#409eff',action:'countdown-adjust',actionParam:'15'}]);globalThis.draws=[];globalThis.actionCalls=[]})
 const wheel=await pageFor('lottery-lucky');await wheel.waitForFunction(()=>!!window.__startSpin)
 await api(()=>{const l=globalThis.test.lottery;l.configureLottery('wheel',{autoSpin:true,triggerGift:'玫瑰'});l.handleLotteryGift({type:'gift',giftName:'玫瑰',count:3,ts:Date.now(),raw:'test'});})
 await waitFor(()=>globalThis.actionCalls.length===3&&globalThis.draws.filter(e=>e.phase==='result').length===3)
 const draws=await api(()=>globalThis.draws.filter(e=>e.kind==='wheel'&&e.phase==='result'))
 check('忙碌时3份礼物顺序执行，重复中奖也执行3次',draws.length===3&&new Set(draws.map(e=>e.id)).size===3)
 const last=draws.at(-1);assert.equal(await wheel.locator('#result').textContent(),'抽中：'+last.item.name)
 check('主进程结果与采集窗口结果一致')
 await wheel.evaluate(id=>{document.title='zl-lottery:'+JSON.stringify({type:'done',id,seq:999})},last.id)
 await new Promise(r=>setTimeout(r,100));check('重复完成通知不会重复执行中奖动作',await api(()=>globalThis.actionCalls.length===3))
 const beforeHandle=await api(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='幸运转盘').getNativeWindowHandle().toString('hex'))
 await api((_,img)=>globalThis.test.lottery.openWheelWindow([{name:'火箭大礼包超级长奖项名称',color:'#67c23a',img},{name:'谢谢参与',color:'#409eff'}]),fixtureImage)
 await wheel.waitForFunction(()=>images[0]?.naturalWidth===300);check('采集窗口加载同一特殊路径图片')
 const afterHandle=await api(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='幸运转盘').getNativeWindowHandle().toString('hex'))
 check('更新已打开转盘保留采集句柄',beforeHandle===afterHandle)
 await shot(wheel,'restored-wheel-normal.png')
 await api((_,img)=>globalThis.test.lottery.openLuckyWindow([{name:'现有幸运转盘',color:'#67c23a',img},{name:'谢谢参与',color:'#409eff'}],img),fixtureImage)
 const lucky=await pageFor('lottery-lucky');await lucky.waitForFunction(()=>!!window.__startSpin);await lucky.locator('#spin img').evaluate(im=>im.decode());await shot(lucky,'restored-lucky.png')
 check('旧wheel与升级lucky API复用唯一窗口句柄',beforeHandle===await api(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='幸运转盘').getNativeWindowHandle().toString('hex')))
 await api(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='幸运转盘').setSize(360,360))
 await shot(wheel,'restored-wheel-small.png')
 check('360px窗口无横向或纵向滚动裁切',await wheel.evaluate(()=>document.documentElement.scrollWidth===innerWidth&&document.documentElement.scrollHeight===innerHeight))
 await api((_,img)=>globalThis.test.lottery.openNineGridWindow(Array.from({length:8},(_,i)=>({name:'外圈 '+i+' 号长奖项名称',color:'',img:i===0?img:undefined}))),fixtureImage)
 const nine=await pageFor('lottery-nine');await nine.waitForFunction(()=>!!window.__startSpin);await shot(nine,'restored-nine.png')
 // 2026-09-11：抽中「再抽一次」要真的接着再抽（以前链上出现过就一律拒绝，这个玩法从来没生效过）。
 // holdSeconds 设 0 让连抽不等停留时间，测试才跑得快；上限 6 轮在 test-entertainment-interactions 里验（进程内，秒级）。
 await api(()=>{const l=globalThis.test.lottery;l.configureLottery('wheel',{autoSpin:false,triggerGift:'',holdSeconds:0},[{name:'去九宫格',color:'#409eff',action:'nine-spin'}]);l.configureLottery('nine',{autoSpin:false,triggerGift:'',holdSeconds:0},[{name:'回转盘',color:'#409eff',action:'wheel-spin'}]);globalThis.draws=[];l.lotterySpin('wheel')})
 await waitFor(()=>globalThis.draws.filter(e=>e.phase==='result').length>=2,30000)
 const loopDraws=await api(()=>globalThis.draws.filter(e=>e.phase==='result'))
 check('跨盘联动能来回走通（以前第二跳就被当成循环拦死）',loopDraws.length>=2&&loopDraws[0].kind==='wheel'&&loopDraws[1].kind==='nine')
 // 两跳验到了就把两个盘的奖项都换成不联动的，等在跑的那几轮（用的是旧快照）走完，别让连抽拖住后面的用例
 await api(()=>{const l=globalThis.test.lottery;l.configureLottery('wheel',{autoSpin:false,triggerGift:''},[{name:'到此为止',color:'#409eff'}]);l.configureLottery('nine',{autoSpin:false,triggerGift:''},[{name:'到此为止',color:'#409eff'}])})
 await waitFor(()=>{const d=globalThis.test.lottery.lotteryState().draws;return ['wheel','nine'].every(k=>d[k]?.phase!=='started'&&!d[k]?.queued)},40000)
 await api(()=>{const l=globalThis.test.lottery;globalThis.draws=[];globalThis.actionCalls=[];l.configureLottery('wheel',{autoSpin:false,triggerGift:''},[{name:'当前轮旧配置',color:'#409eff',action:'countdown-clear'}]);l.lotterySpin('wheel');l.configureLottery('wheel',{autoSpin:false,triggerGift:''},[{name:'下一轮新配置',color:'#67c23a',action:'countdown-adjust',actionParam:'20'}]);l.lotterySpin('wheel')})
 await waitFor(()=>globalThis.actionCalls.length===2)
 const names=await api(()=>globalThis.actionCalls.map(i=>i.name));check('编辑保留当前轮快照，下一轮采用新配置',names.join('|')==='当前轮旧配置|下一轮新配置')
 await api(()=>{const l=globalThis.test.lottery;globalThis.draws=[];l.lotterySpin('wheel');l.lotterySpin('wheel');l.closeLotteryWindow('wheel')})
 await new Promise(r=>setTimeout(r,4500));check('关闭窗口取消当前和排队演出',await api(()=>!globalThis.draws.some(e=>e.phase==='result')))
 await api(()=>globalThis.test.lottery.openWheelWindow([{name:'重开保留动作',color:'#409eff',action:'countdown-adjust',actionParam:'5'}]))
 const saved=JSON.parse(await fs.readFile(path.join(profile,'lottery-config.json'),'utf8'));check('配置文件保留动作和触发条件',saved.wheel.items[0].actionParam==='5'&&saved.wheel.trigger.autoSpin===false)
 // 故障注入仅作用于独立 profile：模拟配置文件被目录占用。
 const configFile=path.join(profile,'lottery-config.json'), configBackup=configFile+'.bak'
 await fs.rename(configFile,configBackup);await fs.mkdir(configFile)
 try{
   const fail=await api(()=>globalThis.test.lottery.configureLottery('wheel',{autoSpin:true,triggerGift:'不应生效'},[{name:'坏配置',color:''}]))
   assert.equal(fail.ok,false)
   const retained=await api(()=>{const l=globalThis.test.lottery;l.lotterySpin('wheel');const name=l.lotteryState().draws.wheel.item.name;l.closeLotteryWindow('wheel');return name})
   check('写盘失败保留原内存配置',retained==='重开保留动作')
 }finally{await fs.rmdir(configFile);await fs.rename(configBackup,configFile)}
 const oversized=await api(()=>globalThis.test.lottery.configureLottery('wheel',undefined,Array.from({length:65},(_,i)=>({name:String(i),color:''}))))
 check('超过64项明确拒绝而不截短',!oversized.ok&&oversized.error.includes('64'))
 await api(()=>globalThis.test.lottery.openWheelWindow([{name:'延迟动作',color:'#409eff',action:'effect',actionParam:'rain'}]))
 const delayed=await api(async({BrowserWindow})=>{
   const l=globalThis.test.lottery;l.setLotteryActionHandler(()=>new Promise(resolve=>{globalThis.releaseOldAction=resolve}));l.lotterySpin('wheel')
   const old=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='幸运转盘'),id=l.lotteryState().draws.wheel.id
   old.emit('page-title-updated',{preventDefault(){}},'zl-lottery:'+JSON.stringify({type:'done',id,seq:77}))
   await new Promise(resolve=>setTimeout(resolve,20));l.closeLotteryWindow('wheel')
   // 0.3.41 起采集窗口「关闭只清空内容」并复用同一个原生窗口（关掉再开还是它），
   // 所以要验证「旧窗口的迟到事件不影响重开窗口」必须先把旧窗口真销毁，重开的才是另一个窗口。
   old.destroy();l.openWheelWindow([{name:'重开的新一轮',color:'#409eff'}]);old.emit('closed')
   l.setLotteryActionHandler(async(item,context)=>globalThis.action(item,context));l.lotterySpin('wheel');const next=l.lotteryState().draws.wheel.id
   old.emit('page-title-updated',{preventDefault(){}},'zl-lottery:'+JSON.stringify({type:'spin',id:'',seq:90}))
   old.emit('page-title-updated',{preventDefault(){}},'zl-lottery:'+JSON.stringify({type:'done',id:next,seq:91}))
   globalThis.releaseOldAction({ok:false,error:'旧动作失败'});await new Promise(resolve=>setTimeout(resolve,30))
   const state=l.lotteryState();l.closeLotteryWindow('wheel');return {open:state.wheel,same:state.draws.wheel.id===next,phase:state.draws.wheel.phase,queued:state.draws.wheel.queued}
 })
 if(!(delayed.open&&delayed.same&&delayed.phase==='started'))console.log('DELAYED',JSON.stringify(delayed))
 check('旧窗口关闭和延迟动作不会清掉重开窗口',delayed.open&&delayed.same&&delayed.phase==='started')
 check('旧窗口spin/done消息不能干扰重开窗口',delayed.queued===0&&delayed.phase==='started')
 // 销毁/重开窗口之后先跟主进程同步一次：窗口销毁和下一次 evaluate 撞在同一刻会偶发
 // 「Target page, context or browser has been closed」，加一个同步点最省事。
 await app.evaluate(()=>1)
 for(const mode of ['close','switch']) {
   const deferred=await api(async({BrowserWindow},mode)=>{
     const l=globalThis.test.lottery;globalThis.gameId='librarian';globalThis.prankCalls=[];globalThis.liveStateImpl=()=>new Promise(resolve=>{globalThis.resolveState=resolve})
     l.openWheelWindow([{name:'等待局内状态',color:'#409eff',action:'prank',actionParam:'librarian|blackhole'}]);l.lotterySpin('wheel')
     const current=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='幸运转盘'),id=l.lotteryState().draws.wheel.id
     current.emit('page-title-updated',{preventDefault(){}},'zl-lottery:'+JSON.stringify({type:'done',id,seq:93}))
     if(mode==='close')l.closeLotteryWindow('wheel');else globalThis.gameId='4wheel-challenge'
     globalThis.resolveState({inGame:true});await new Promise(resolve=>setTimeout(resolve,30))
     const calls=globalThis.prankCalls.length,error=l.lotteryState().draws.wheel?.error;l.closeLotteryWindow('wheel');globalThis.gameId='librarian';globalThis.liveStateImpl=async()=>({inGame:false});return {calls,error}
   },mode)
   check(mode==='close'?'等待游戏状态期间关窗不会发送旧整蛊':'等待游戏状态期间切换游戏不会发送旧整蛊',deferred.calls===0)
 }
 const direct=async i=>api(async(_,item)=>globalThis.action(item,()=>true),i)
 assert.equal((await direct(item('失败视频','video','Z:/missing.mp4'))).ok,false);check('无效中奖视频返回明确失败')
 assert.equal((await direct(item('空动画','effect','unknown'))).ok,false);check('无效动画不静默替换成另一种')
 assert.equal((await direct(item('跨游戏','prank','4wheel-challenge|t_blackhole'))).ok,false)
 assert.equal((await direct(item('未进馆','prank','librarian|blackhole'))).ok,false);check('游戏事件校验当前游戏与局内状态（游戏接口替身）')
 await api(()=>{const t=globalThis.test.time;t.openTimeWidget({initial:100,on:false,enable:false});t.timeWidgetClear();t.timeWidgetAdjust(100)})
 assert.equal((await direct(item('固定加时','countdown-adjust','7'))).ok,true)
 assert.equal(await api(()=>globalThis.test.time.timeWidgetState().remaining),107)
 assert.equal((await direct(item('固定减时','countdown-adjust','-3'))).ok,true)
 assert.equal(await api(()=>globalThis.test.time.timeWidgetState().remaining),104)
 for(const value of ['0.1~0.2','7.5','-0.1','9'.repeat(400),'abc']) {
   assert.equal((await direct(item('无效秒数','countdown-adjust',value))).ok,false)
   assert.equal(await api(()=>globalThis.test.time.timeWidgetState().remaining),104)
 }
 check('整数加减实际余量正确，拒绝小数和溢出且余量不变')
 for(const [range,values] of [['10~12',[10,11,12]],['12~10',[10,11,12]],['-2~0',[-2,-1,0]]]) {
   for(const [i,random] of [0,.5,.999].entries()) {
     const delta=await api(async(_,data)=>{const original=Math.random,before=globalThis.test.time.timeWidgetState().remaining;Math.random=()=>data.random;try{const r=await globalThis.action({name:'范围',color:'',action:'countdown-adjust',actionParam:data.range},()=>true);return {ok:r.ok,value:globalThis.test.time.timeWidgetState().remaining-before}}finally{Math.random=original}},{range,random})
     assert.equal(delta.ok,true);assert.equal(delta.value,values[i])
   }
 }
 check('整数范围含正负端点，倒序同效且按均匀整数抽取')
 assert.equal((await direct(item('清零','countdown-clear'))).ok,true);assert.equal(await api(()=>globalThis.test.time.timeWidgetState().remaining),0);check('清零动作实际将挂件余量清零')
 assert.equal((await direct(item('烟花','effect','firework'))).ok,true)
 await waitFor(()=>globalThis.test.effects.effectsState().open);check('中奖动画打开真实礼物动画窗口')
 const encoded=await ui.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d'),chunks=[]
   const stream=canvas.captureStream(20),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'})
   recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve)
   let frame=0;const tick=setInterval(()=>{ctx.fillStyle=frame++%2?'#cc8c29':'#153a42';ctx.fillRect(0,0,160,90)},50)
   recorder.start();await new Promise(resolve=>setTimeout(resolve,1200));recorder.stop();await stopped;clearInterval(tick);stream.getTracks().forEach(track=>track.stop())
   return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))
 })
 const media=path.join(profile,'抽奖 # & 视频.webm');await fs.writeFile(media,Buffer.from(encoded))
 // 开哪个才有哪个：绿幕视频只播到主播开着的窗口，先替主播开一个 1 号空窗口
 assert.equal((await api(()=>globalThis.test.green.openGreenScreen('','video','',1))).ok,true)
 assert.equal((await direct({...item('绿幕视频','green-video',media),actionSeconds:0.6})).ok,true)
 assert.equal((await direct({...item('普通视频','video',media),actionSeconds:0.6})).ok,true)
 await waitFor(()=>globalThis.created.some(t=>t.startsWith('绿幕'))&&globalThis.created.some(t=>t.startsWith('视频')))
 // 视频窗口播完真关；绿幕播完把素材撤掉、窗口留着（它是主播开的采集来源）
 await waitFor(()=>globalThis.test.video.videoWidgetState().main===false&&globalThis.test.green.greenScreenState().slots.every(s=>!s.src));check('视频/绿幕动作实际开窗并按时收掉素材',true)
 check('所有测试窗口全程隐藏，不抢前台',await api(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 check('所有页面无JavaScript异常',errors.length===0)
 console.log('Lottery Electron regression: '+checks.length+'/'+checks.length+' PASS')
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors,profile,hidden:true},null,2))
}catch(error){
  console.error('LOTTERY FAILURE',error&&error.stack||error)
  console.error('PAGE ERRORS',errors)
  try{
    const dump=await api(({BrowserWindow})=>{
      const t=globalThis.test||{}
      return {
        videoState:t.video?t.video.videoWidgetState():null,
        greenOpen:t.green?t.green.greenScreenState().slots.filter(s=>s.open):null,
        windows:BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),url:w.webContents.getURL().slice(-40)}))
      }
    })
    console.error('STATE',dump)
  }catch(extra){console.error('STATE unavailable:',extra&&extra.message)}
  throw error
}finally{await app.close()}
