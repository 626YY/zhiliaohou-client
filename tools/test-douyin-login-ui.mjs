// 真实设置页/连接器页；用可控 IPC 响应检查扫码等待、自动继续和失败恢复。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root,'output/playwright/douyin-login-ui')
await fs.mkdir(output,{recursive:true})
const source = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
import Settings from './src/renderer/src/pages/Settings'; import Connector from './src/renderer/src/pages/Connector';
import {useAuth} from './src/renderer/src/stores/auth'; import {useToast} from './src/renderer/src/stores/ui';
localStorage.setItem('zl-theme','dark'); document.documentElement.dataset.theme='dark';
useAuth.getState().setUser({id:'fixture',username:'fixture',nickname:'测试主播',createdAt:0,boundRooms:['123']});
window.qa={lookupCalls:[],startCalls:0,bindCalls:0,saveCalls:0,state:{running:false,sim:false,roomId:'123'}};
window.toasts=()=>useToast.getState().toasts;
window.api={
  getSettings:async()=>({settings:{gamePath:'fixture.exe',gamePaths:{},currentGameId:'4wheel-challenge',modRootPath:'',modConfigPath:'',pythonPath:'python',connectorPath:'',downloadDir:'',alwaysOnTop:false}}),
  selfCheck:async()=>({items:[],version:'fixture',at:Date.now()}), onRoomAutoBound:()=>()=>{},
  roomLookup:(...args)=>{window.qa.lookupCalls.push(args);return new Promise(resolve=>window.finishLookup=resolve)},
  bindRoomWithLicense:async(room)=>{window.qa.bindCalls++;return {ok:true,boundRooms:['123',room]}},
  saveSettings:async()=>{window.qa.saveCalls++;return {settings:{}}},
  connectorState:async()=>window.qa.state, connectorLog:async()=>[], onConnectorLog:()=>()=>{},readConfig:async()=>({ok:true,values:{LiveRoomId:'123'}}),
  connectorStart:(...args)=>{window.qa.startCalls++;window.qa.state.connecting=true;return new Promise(resolve=>window.finishStart=(result)=>{window.qa.state={running:result.ok,sim:false,roomId:'123',connecting:false};resolve(result)})},
  connectorStop:async()=>{window.qa.state.running=false;window.finishStart?.({ok:false,error:'已取消连接'});return {ok:true}}
};
function App(){const [which,setWhich]=useState('settings');window.showPage=setWhich;return <MemoryRouter>{which==='settings'?<Settings/>:<Connector/>}</MemoryRouter>}
createRoot(document.getElementById('root')).render(<App/>);
`
const bundle = await build({stdin:{contents:source,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@shared':path.join(root,'src/shared')},define:{'process.env.NODE_ENV':'"production"'}})
const browser = await chromium.launch({channel:'msedge',headless:true})
const checks=[]
const pass=name=>{checks.push(name);console.log('PASS '+name)}
try {
  const page=await browser.newPage({viewport:{width:1200,height:950}}), errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://douyin-ui.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><meta charset="utf-8"><body><div id="root"></div></body></html>'}))
  await page.goto('https://douyin-ui.test/')
  const assets=path.join(root,'out/renderer/assets')
  const css=(await fs.readdir(assets)).find(n=>n.startsWith('index-')&&n.endsWith('.css'))
  if(css) await page.addStyleTag({content:await fs.readFile(path.join(assets,css),'utf8')})
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  await page.getByRole('textbox',{name:'抖音直播间号',exact:true}).fill('456')
  await page.getByRole('button',{name:'绑定',exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>window.qa.lookupCalls),[['456',true]])
  assert.equal(await page.getByRole('button',{name:'验证中…',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('textbox',{name:'抖音直播间号',exact:true}).isDisabled(),true)
  await page.screenshot({path:path.join(output,'binding-waits-for-login.png'),fullPage:true})
  await page.evaluate(()=>window.finishLookup({ok:true,room:'456',nickname:'测试主播',avatar:''}))
  await page.getByRole('button',{name:'确认绑定',exact:true}).click()
  await page.waitForFunction(()=>window.qa.bindCalls===1)
  assert.equal(await page.evaluate(()=>window.qa.saveCalls),0)
  pass('bind requests interactive login, waits for scan, and continues without clicking Save Settings')
  await page.getByRole('textbox',{name:'抖音直播间号',exact:true}).fill('789')
  await page.getByRole('button',{name:'绑定',exact:true}).click()
  await page.evaluate(()=>window.finishLookup({ok:false,needLogin:true,error:'已取消抖音登录'}))
  await page.getByRole('button',{name:'绑定',exact:true}).waitFor()
  assert.equal(await page.getByRole('textbox',{name:'抖音直播间号',exact:true}).isEnabled(),true)
  assert.match(await page.evaluate(()=>window.toasts().at(-1).text),/取消/)
  pass('cancelled login restores binding controls and shows the reason')
  await page.evaluate(()=>window.showPage('connector'))
  await page.getByRole('button',{name:'启动连接器',exact:true}).evaluate(button=>{button.click();button.click()})
  await page.getByRole('button',{name:'取消连接',exact:true}).waitFor()
  assert.equal(await page.getByRole('combobox',{name:'直播间号',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'模拟模式',exact:true}).isDisabled(),true)
  assert.equal(await page.evaluate(()=>window.qa.startCalls),1)
  await page.screenshot({path:path.join(output,'connector-waits-for-login.png'),fullPage:true})
  await page.evaluate(()=>window.finishStart({ok:true}))
  await page.getByRole('button',{name:'停止',exact:true}).waitFor()
  assert.match(await page.evaluate(()=>window.toasts().at(-1).text),/登录状态已保存/)
  pass('connection waits for login, locks conflicting controls, and automatically becomes running')
  await page.getByRole('button',{name:'停止',exact:true}).click()
  await page.getByRole('button',{name:'启动连接器',exact:true}).click()
  await page.getByRole('button',{name:'取消连接',exact:true}).click()
  await page.getByRole('button',{name:'启动连接器',exact:true}).waitFor()
  assert.equal(await page.getByRole('combobox',{name:'直播间号',exact:true}).isEnabled(),true)
  assert.equal(await page.evaluate(()=>window.qa.state.running),false)
  pass('cancel connection restores controls without showing running')
  await page.getByRole('button',{name:'启动连接器',exact:true}).click()
  await page.getByRole('button',{name:'取消连接',exact:true}).waitFor()
  await page.evaluate(()=>window.showPage('settings'))
  await page.getByRole('textbox',{name:'抖音直播间号',exact:true}).waitFor()
  await page.evaluate(()=>window.showPage('connector'))
  await page.getByRole('button',{name:'取消连接',exact:true}).waitFor()
  await page.evaluate(()=>window.finishStart({ok:true}))
  await page.getByRole('button',{name:'停止',exact:true}).waitFor()
  pass('leaving and returning during scan still tracks the eventual connection state')
  assert.deepEqual(errors,[])
} finally {await browser.close(); await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks},null,2))}
console.log(`Douyin UI regression: ${checks.length}/${checks.length} PASS`)
console.log('Evidence: '+output)
