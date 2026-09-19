// 可见原生窗口的启动、退出与 HWND 回归，通过本测试进程的 Node Inspector 诊断。
// 不依赖 Playwright 等待所有 target，避免待机窗口初始化阻塞原生生命周期检查。
import { spawn } from 'node:child_process'
import { once } from 'node:events'
export async function launchNativeElectron(executable,entry,profile,root){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 // 这是明确要求可见的客户端验收实例；SW_HIDE 会吃掉主窗口第一次 ShowWindow。
 const child=spawn(executable,['--inspect=127.0.0.1:0',entry,'--user-data-dir='+profile],{cwd:root,env,windowsHide:false,stdio:['ignore','pipe','pipe']})
 let log='',next=0
 const endpoint=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Native Electron inspector did not start: '+log)),12000)
  child.once('error',e=>{clearTimeout(timer);reject(e)})
  child.stderr.on('data',data=>{log+=data;const match=log.match(/Debugger listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}})
 })
 const socket=new WebSocket(endpoint),pending=new Map()
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(!data.id)return;const handlers=pending.get(data.id);if(!handlers)return;pending.delete(data.id);data.error?handlers.reject(Error(data.error.message)):handlers.resolve(data.result)})
 socket.addEventListener('close',()=>{for(const p of pending.values())p.reject(Error('Test inspector closed'));pending.clear()})
 const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
 await request('Runtime.enable',{})
 const evaluate=async(fn,arg)=>{
  const result=await request('Runtime.evaluate',{expression:`global.__captureEvaluation = (${fn.toString()})(global.__captureElectron,${JSON.stringify(arg)??'undefined'})`,awaitPromise:true,returnByValue:true}).catch(error=>{throw Error(error.message+' | '+fn.toString().slice(0,150))})
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text)
  return result.result.value
 }
 const startupDeadline=Date.now()+12000
 try{
  while(true){
   const ready=await request('Runtime.evaluate',{expression:'!!global.__captureElectron?.app.isReady()',returnByValue:true,includeCommandLineAPI:true})
   if(ready.result?.value===true)break
   if(Date.now()>startupDeadline)throw Error('Native Electron app did not become ready: '+log)
   await new Promise(r=>setTimeout(r,40))
  }
 }catch(error){socket.close();child.kill();throw error}
 const windowHandle=id=>({evaluate:(fn,arg)=>evaluate(({BrowserWindow},{id,source,arg})=>{
  const win=BrowserWindow.fromId(id);if(!win)throw Error('Test window closed: '+id)
  return (0,eval)('('+source+')')(win,arg)
 },{id,source:fn.toString(),arg})})
 const pageHandle=meta=>({
  id:meta.id,url:()=>meta.url,isClosed:()=>false,
  evaluate:(fn,arg)=>windowHandle(meta.id).evaluate((win,{source,arg})=>win.webContents.executeJavaScript('('+source+')('+JSON.stringify(arg)+')'),{source:fn.toString(),arg}),
  waitForTimeout:ms=>new Promise(r=>setTimeout(r,ms)),
  async waitForFunction(fn,arg,{timeout=10000}={}){const until=Date.now()+timeout;while(Date.now()<until){if(await this.evaluate(fn,arg))return;await this.waitForTimeout(50)}throw Error('Native page condition timed out: '+fn)},
  async waitForLoadState(){await this.waitForFunction(()=>document.readyState==='complete')},
  async screenshot({path}){const bytes=await windowHandle(meta.id).evaluate(async w=>[...(await w.webContents.capturePage()).toPNG()]);await (await import('node:fs/promises')).writeFile(path,Buffer.from(bytes))},
  locator:selector=>({textContent:()=>windowHandle(meta.id).evaluate((w,selector)=>w.webContents.executeJavaScript('document.querySelector('+JSON.stringify(selector)+')?.textContent'),selector)})
 })
 return {
  child,evaluate,windowHandle,on:()=>{},
  async windows(){return (await evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL()&&!w.webContents.isLoadingMainFrame()).map(w=>({id:w.id,url:w.webContents.getURL()})))).map(pageHandle)},
  browserWindow:async p=>windowHandle(p.id),
  async close(){
   if(child.exitCode!==null)return
   const exited=once(child,'exit')
   void evaluate(({app})=>app.quit()).catch(()=>{})
   // Node Inspector 自身会使 Node 在退出时等待调试器断开。
   socket.close()
   let forced=false
   const timer=setTimeout(()=>{if(child.exitCode===null){forced=true;child.kill()}},8000)
   try{await exited}finally{clearTimeout(timer)}
   if(forced)throw Error('Test Electron did not quit normally; owned process was cleaned up')
  }
 }
}
