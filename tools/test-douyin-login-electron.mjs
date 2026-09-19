// 真 Electron 登录窗口/Cookie 持久化/主进程连接器；抖音响应和扫码凭据均为测试数据。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/douyin-login')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const modDir = path.join(profile, 'game/Mods/WheelLive')
await fs.mkdir(modDir, { recursive: true })
await fs.writeFile(path.join(modDir, 'connector.py'), `import pathlib, time
here = pathlib.Path(__file__).parent
with (here / 'starts.txt').open('a') as f: f.write('start\\n')
print('TEST_CONNECTOR_COOKIE_READY=' + str('sessionid=' in (here / 'douyin_cookie.txt').read_text()), flush=True)
time.sleep(120)
`)
await build({ stdin: { contents: `export * from './src/main/douyin-login'; export { lookupRoom } from './src/main/douyin-room'; export { startConnector, stopConnector, connectorState, getLog } from './src/main/connector'; export { saveSettings } from './src/main/settings';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(profile, 'runtime.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const main = path.join(profile, 'main.cjs')
const loginHtml = `<html><meta charset="utf-8"><h1>扫码登录（自动化测试页面）</h1><button onclick="this.outerHTML='<p>扫码登录</p>'">登录</button></html>`
await fs.writeFile(main, `
const electron = require('electron'), fs = require('node:fs'), path = require('node:path');
const { app, BrowserWindow: NativeWindow, session } = electron;
app.setPath('userData', __dirname); app.setAppPath(${JSON.stringify(root)}); app.setMaxListeners(60);
global.qa = { opened: [], mode: 'ok', requests: 0, fs };
for (const method of ['show', 'showInactive', 'focus', 'restore', 'maximize', 'moveTop']) NativeWindow.prototype[method] = function() {};
const HiddenWindow = new Proxy(NativeWindow, { construct(Target, args) {
  global.qa.opened.push(args[0]);
  return Reflect.construct(Target, [{...args[0], show:false, focusable:false, webPreferences:{...args[0]?.webPreferences, backgroundThrottling:false, paintWhenInitiallyHidden:true}}], Target);
}});
const Module = require('node:module'), original = Module._load;
Module._load = function(request) { return request === 'electron' ? {...electron, BrowserWindow:HiddenWindow} : original.apply(this, arguments) };
global.fetch = async (url) => {
  if (!String(url).startsWith('https://live.douyin.com/')) throw new Error('Unexpected external request');
  if (String(url) === 'https://live.douyin.com/') return new Response('', {headers:{'set-cookie':'ttwid=fixture-visitor; Path=/; Secure'}});
  global.qa.requests++;
  if (global.qa.mode === 'network') throw new Error('fixture network failure');
  if (global.qa.mode === '401') { global.qa.mode = 'ok'; return new Response('', {status:401}); }
  if (global.qa.mode === 'expired') { global.qa.mode = 'ok'; return new Response('defaultHeaderUserInfo: {"isLogin":false}'); }
  if (global.qa.mode === 'offline') return new Response('defaultHeaderUserInfo: {"isLogin":true,"realName":"测试主播","avatarUrl":"https://example.invalid/avatar.png"}');
  return new Response('<div data-anchor-info="{&quot;nickname&quot;:&quot;测试主播&quot;,&quot;avatar&quot;:&quot;https://example.invalid/avatar.png&quot;}"></div>');
};
app.whenReady().then(async () => {
  global.qa.ses = session.fromPartition('persist:zhiliao-douyin');
  global.qa.ses.protocol.handle('https', () => new Response(${JSON.stringify(loginHtml)}, {headers:{'Content-Type':'text/html'}}));
  global.qa.api = require('./runtime.cjs');
  global.qa.api.saveSettings({currentGameId:'4wheel-challenge',gamePath:path.join(__dirname,'game/fixture.exe'),gamePaths:{},guideSeen:true});
  const control = new HiddenWindow({title:'douyin-test-control'}); await control.loadURL('about:blank');
});
`)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
execFileSync(process.execPath,['--check',main])
let app
const checks = []
const pass = name => { checks.push(name); console.log('PASS ' + name) }
const call = (name, ...args) => app.evaluate((_, {name,args}) => global.qa.api[name](...args), {name,args})
const evalMain = (fn, arg) => app.evaluate(fn, arg)
async function until(fn, message, timeout = 12000) { const end = Date.now()+timeout; while(Date.now()<end) { const result=await fn(); if(result) return result; await new Promise(resolve=>setTimeout(resolve,40)) } throw new Error(message) }
async function launch() { app = await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[main],cwd:root,env,timeout:20000}); await app.firstWindow({timeout:20000}) }
async function cookie(value = 'fixture-session', name = 'sessionid', domain = '.douyin.com') {
  await evalMain(async (_, {value,name,domain}) => global.qa.ses.cookies.set({url:'https://'+domain.replace(/^\./,'')+'/',domain,name,value,secure:true,httpOnly:true,expirationDate:Date.now()/1000+86400}), {value,name,domain})
}
async function clear() {
  await evalMain(async () => global.qa.ses.clearStorageData({storages:['cookies']}))
  await fs.rm(path.join(modDir,'douyin_cookie.txt'),{force:true})
}
async function begin(name, ...args) {
  await evalMain((_, {name,args}) => { global.qa.result = null; global.qa.api[name](...args).then(result=>{global.qa.result=result}) }, {name,args})
}
const result = () => until(()=>evalMain(()=>global.qa.result),'operation did not finish')
const loginCount = () => evalMain(() => global.qa.opened.filter(o=>o.title?.startsWith('抖音扫码登录')).length)
const loginWindow = () => until(()=>app.windows().find(w=>w.url().startsWith('https://live.douyin.com/')), 'login page missing')
try {
  await launch()
  assert.equal((await call('lookupRoom','123')).needLogin,true)
  assert.equal(await loginCount(),0)
  pass('background avatar lookup never opens a login window')

  await cookie('visitor','ttwid')
  await cookie('not-a-login','uid_tt')
  await begin('lookupRoom','123',true)
  const page = await loginWindow()
  assert.equal(await evalMain(()=>global.qa.result),null)
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined')
  assert.equal(await page.evaluate(()=>typeof window.api),'undefined')
  await page.getByRole('heading',{name:'扫码登录（自动化测试页面）'}).waitFor()
  await page.getByText('扫码登录',{exact:true}).waitFor()
  pass('first bind opens the isolated web page and automatically reveals QR login; visitor cookies do not count as login')
  await cookie('fixture-first-login')
  assert.equal((await result()).nickname,'测试主播')
  assert.match(await fs.readFile(path.join(modDir,'douyin_cookie.txt'),'utf8'),/sessionid=fixture-first-login/)
  assert.equal(await evalMain(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1)
  assert.equal(await evalMain(()=>global.qa.ses.cookies.listenerCount('changed')),0)
  pass('scan completion automatically saves the connector file, closes login, and continues room lookup')

  const count = await loginCount()
  assert.equal((await call('lookupRoom','123',true)).ok,true)
  assert.equal(await loginCount(),count)
  pass('existing login is reused without another web page')

  await app.close(); app = null; await launch()
  await fs.rm(path.join(modDir,'douyin_cookie.txt'),{force:true})
  assert.match(await call('readDouyinCookie'),/sessionid=fixture-first-login/)
  assert.equal((await call('lookupRoom','123',true)).ok,true)
  assert.equal(await loginCount(),0)
  pass('login survives an actual Electron restart, including without a legacy cookie file')

  // 轮椅 mod/Login.cs + tools/douyin_login.py 的历史文件格式；与真实账号完全隔离。
  await fs.writeFile(path.join(modDir,'douyin_cookie.txt'),'\uFEFFCookie: sessionid=fixture-wheel-live; ttwid=fixture-visitor')
  assert.match(await call('readDouyinCookie',modDir),/sessionid=fixture-wheel-live/)
  const legacyCount = await loginCount()
  assert.equal((await call('lookupRoom','123',true)).ok,true)
  assert.equal(await loginCount(),legacyCount)
  pass('WheelLive login file is reused without scanning, including a game-side account change and BOM/Cookie prefix')

  await evalMain(()=>{global.qa.mode='expired'})
  await begin('lookupRoom','123',true)
  await loginWindow()
  assert.equal(await evalMain(()=>global.qa.result),null)
  await cookie('fixture-renewed')
  assert.equal((await result()).ok,true)
  assert.match(await fs.readFile(path.join(modDir,'douyin_cookie.txt'),'utf8'),/fixture-renewed/)
  pass('expired login opens QR login once, saves its replacement, and retries lookup')

  await clear()
  await begin('lookupRoom','123',true); await loginWindow()
  const pendingCount = await loginCount()
  await evalMain(()=>{global.qa.api.loginDouyin().then(r=>{global.qa.joined=r})})
  assert.equal(await loginCount(),pendingCount)
  await evalMain(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().startsWith('抖音扫码登录')).close())
  assert.match((await result()).error,/取消/)
  assert.equal(await evalMain(()=>global.qa.joined.ok),false)
  assert.equal(await fs.stat(path.join(modDir,'douyin_cookie.txt')).then(()=>true,()=>false),false)
  pass('concurrent login requests share one window; close cancels all without saving')

  await evalMain(()=>{global.qa.mode='401'})
  await fs.writeFile(path.join(modDir,'douyin_cookie.txt'),'sessionid=fixture-legacy')
  await begin('lookupRoom','123',true); await loginWindow()
  await cookie('fixture-after-401')
  assert.equal((await result()).ok,true)
  pass('HTTP 401 renews a legacy file login automatically')

  const windowsBeforeNetwork = await loginCount()
  await evalMain(()=>{global.qa.mode='network'})
  assert.match((await call('lookupRoom','123',true)).error,/网络/)
  assert.equal(await loginCount(),windowsBeforeNetwork)
  await evalMain(()=>{global.qa.mode='offline'})
  assert.equal((await call('lookupRoom','123',true)).offline,true)
  await evalMain(()=>{global.qa.mode='ok'})
  pass('network errors do not trigger login loops; offline room confirmation remains supported')

  await clear()
  await fs.writeFile(path.join(modDir,'douyin_cookie.txt'),'sessionid=fixture-preserve')
  await evalMain(()=>{global.qa.mode='expired'; const fs=global.qa.fs; global.qa.rename=fs.renameSync; fs.renameSync=function(from,to){if(String(to).endsWith('douyin_cookie.txt'))throw new Error('test disk failure'); return global.qa.rename.apply(this,arguments)}})
  await begin('lookupRoom','123',true); await loginWindow(); await cookie('fixture-write-failure')
  assert.match((await result()).error,/保存失败/)
  await evalMain(()=>{global.qa.fs.renameSync=global.qa.rename})
  assert.equal(await fs.readFile(path.join(modDir,'douyin_cookie.txt'),'utf8'),'sessionid=fixture-preserve')
  assert.equal((await fs.readdir(modDir)).some(n=>n.endsWith('.tmp')),false)
  pass('failed automatic save reports failure and preserves the old file, with no temp files left')

  await clear()
  await call('saveSettings',{gamePath:'',gamePaths:{}})
  await begin('lookupRoom','123',true); await loginWindow(); await cookie('fixture-no-mod')
  assert.equal((await result()).ok,true)
  assert.match(await call('readDouyinCookie'),/fixture-no-mod/)
  await call('saveSettings',{gamePath:path.join(profile,'game/fixture.exe')})
  pass('room binding and automatic login storage also work before installing a game Mod')

  await clear()
  await begin('startConnector','123',false); await loginWindow()
  assert.equal((await call('connectorState')).connecting,true)
  assert.equal((await call('connectorState')).running,false)
  assert.equal((await call('startConnector','123',false)).ok,false)
  await cookie('fixture-connector')
  assert.equal((await result()).ok,true)
  await until(async()=> (await call('getLog')).some(l=>l.text==='TEST_CONNECTOR_COOKIE_READY=True'),'Python did not observe the saved login')
  assert.equal((await fs.readFile(path.join(modDir,'starts.txt'),'utf8')).trim(),'start')
  assert.equal((await call('connectorState')).running,true)
  assert.equal((await call('connectorState')).connecting,false)
  await call('stopConnector')
  await until(async()=>!(await call('connectorState')).running,'connector did not stop')
  pass('real Python connector starts exactly once after scan and reads the automatically saved file')

  await evalMain(()=>{global.qa.mode='network'})
  assert.equal((await call('startConnector','123',false)).ok,true)
  await call('stopConnector')
  await until(async()=>!(await call('connectorState')).running,'connector did not stop after fallback')
  await evalMain(()=>{global.qa.mode='ok'})
  pass('auxiliary room-profile lookup failure does not block the existing connection with saved login')

  await clear()
  const startsBeforeCancel = await fs.readFile(path.join(modDir,'starts.txt'),'utf8')
  await begin('startConnector','123',false); await loginWindow(); await call('stopConnector')
  assert.match((await result()).error,/取消/)
  assert.equal((await call('connectorState')).running,false)
  assert.equal(await fs.readFile(path.join(modDir,'starts.txt'),'utf8'),startsBeforeCancel)
  pass('cancel while scanning never starts a connector')

  await begin('startConnector','123',false); await loginWindow()
  await call('saveSettings',{currentGameId:'librarian'})
  await cookie('fixture-path-change')
  assert.match((await result()).error,/已更改/)
  assert.equal(await fs.readFile(path.join(modDir,'starts.txt'),'utf8'),startsBeforeCancel)
  await call('saveSettings',{currentGameId:'4wheel-challenge'})
  pass('switching games while scanning cannot launch a connector against the wrong game')

  await clear()
  const simWindows = await loginCount()
  assert.equal((await call('startConnector','123',true)).ok,true)
  assert.equal(await loginCount(),simWindows)
  await call('stopConnector')
  await until(async()=>!(await call('connectorState')).running,'sim connector did not stop')
  assert.equal((await call('startConnector','',false)).ok,false)
  pass('simulation needs no login; a real connection requires a room number')
} catch (error) {
  // 下半段在下面统一收尾；异常时仍关闭自己的连接器和实例。
  await fs.writeFile(path.join(profile,'failure.txt'),String(error.stack||error))
  throw error
} finally {
  if(app) { await call('stopConnector').catch(()=>{}); await app.close().catch(()=>{}) }
  await fs.writeFile(path.join(profile,'results.json'),JSON.stringify({checks,profile,limitations:['Fake Douyin responses and test session cookies; no actual broadcaster scan or live gift connection.']},null,2))
}
console.log(`Douyin login regression: ${checks.length}/${checks.length} PASS`)
console.log('Evidence: '+profile)
