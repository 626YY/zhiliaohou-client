import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/live-reporting')
await fs.mkdir(output, { recursive: true })
const dir = await fs.mkdtemp(path.join(output, 'session-'))
await build({ entryPoints: { queue: path.join(root,'src/main/live-report-queue.ts'), events: path.join(root,'src/main/connector-events.ts') },
  outdir: dir, outExtension: {'.js':'.mjs'}, bundle: true, platform: 'node', format: 'esm' })
const { LiveReportQueue } = await import(pathToFileURL(path.join(dir,'queue.mjs')))
const { parseConnectorEvent } = await import(pathToFileURL(path.join(dir,'events.mjs')))
let passed = 0
const pass = name => { passed++; console.log('PASS ' + name) }
const ctx = { email: 'streamer@example.test', server: 'http://127.0.0.1:18772', room: 'test-live-room', game: 'librarian' }
const parsed = (line, ts = Date.now()) => { const e = parseConnectorEvent(line,ts); assert.ok(e,line); return e }
const gift = parsed('[connector] 礼物: 小心心 x3  by 验收送礼观众 2 分/个')
let saved = [], calls = [], fail = true
const q = new LiveReportQueue([], rows => { saved = structuredClone(rows) }, async (context, events) => {
  calls.push({context,events})
  if (fail) throw new Error('simulated response loss')
  return {ok:true,accepted:events.map(e=>e.id)}
})
assert.equal(q.add(ctx,gift,gift.diamondCount,false),true)
assert.equal(saved[0].event.coins,6)
assert.equal(saved[0].event.count,3)
pass('真实连接器礼物格式进入持久队列，3 × 2 = 6')
await assert.rejects(q.flush(ctx.email,ctx.server))
assert.equal(q.size,1)
assert.equal(saved.length,1)
pass('网络失败保留同一事件 ID')
const restored = new LiveReportQueue(saved, rows => { saved = structuredClone(rows) },async (_,events)=>({ok:true,accepted:events.map(e=>e.id)}))
assert.equal(await restored.flush('other@example.test',ctx.server),0)
assert.equal(await restored.flush(ctx.email,'http://127.0.0.1:1'),0)
assert.equal(await restored.flush(ctx.email,ctx.server),1)
assert.equal(restored.size,0)
pass('重启后补传，账号和服务器不串线')
assert.equal(q.add(ctx,gift,2,true),false)
assert.equal(q.add(ctx,parsed('[模拟] [connector] 礼物: 小心心 x3 by 验收模拟'),2,false),false)
assert.equal(q.add(ctx,parsed('[connector] 点赞: 12'),0,false),false)
pass('模拟礼物与无昵称的聚合点赞不进入真实数据')
const privateEvent={...gift,avatar:'C:/private/avatar.png',raw:gift.raw,text:'PRIVATE_TEXT'}
const privacy=[]
const p=new LiveReportQueue([], rows=>privacy.push(structuredClone(rows)),async()=>({ok:false}))
p.add(ctx,privateEvent,2,false)
assert.ok(!JSON.stringify(privacy).includes('C:/private'))
assert.ok(!JSON.stringify(privacy).includes('PRIVATE_TEXT'))
pass('上传白名单不包含头像、路径和弹幕正文')
let release
const c=new LiveReportQueue([],()=>{},async(_,events)=>{await new Promise(r=>{release=r}); return {ok:true,accepted:events.map(e=>e.id)}})
c.add(ctx,gift,2,false)
const sending=c.flush(ctx.email,ctx.server)
c.add(ctx,gift,2,false)
assert.equal(await c.flush(ctx.email,ctx.server),0)
release()
assert.equal(await sending,1)
assert.equal(c.size,1)
pass('并发上传只确认已发送批次，上传途中新增事件保留')
const badAck=new LiveReportQueue([],()=>{},async()=>({ok:true,accepted:['unrelated-event-id']}))
badAck.add(ctx,gift,2,false)
await assert.rejects(badAck.flush(ctx.email,ctx.server))
assert.equal(badAck.size,1)
pass('错误确认不会删除记录')
const rounded=[]
const roundQueue=new LiveReportQueue([],rows=>rounded.push(structuredClone(rows)),async()=>({ok:false}))
roundQueue.add(ctx,gift,0.6,false)
assert.equal(rounded[0][0].event.coins,3)
assert.throws(()=>roundQueue.add(ctx,{...gift,ts:-1},1,false),/时间异常/)
assert.throws(()=>roundQueue.add(ctx,{...gift,count:1_000_000_001},1,false),/超过服务器上限/)
pass('单价取整与本场账一致，异常时间/超限数量明确报错')
const fair=new LiveReportQueue([],()=>{},async(context,events)=>context.room==='old-unbound-room'?{ok:false,error:'unbound'}:{ok:true,accepted:events.map(e=>e.id)})
fair.add({...ctx,room:'old-unbound-room'},gift,2,false)
fair.add(ctx,gift,2,false)
await assert.rejects(fair.flush(ctx.email,ctx.server))
assert.equal(await fair.flush(ctx.email,ctx.server),1)
assert.equal(fair.size,1)
pass('旧房间上传被拒，不阻塞新房间数据')

await build({entryPoints:[path.join(root,'src/main/email-api.ts')],outfile:path.join(dir,'email-api.mjs'),bundle:true,platform:'node',format:'esm',
  plugins:[{name:'transport-dependencies',setup(b){
    b.onResolve({filter:/^(electron|\.\/cred-store|\.\/settings|\.\/bridge)$/},args=>({path:args.path,namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{
      electron:'export const net={fetch:(...args)=>globalThis.__liveTestFetch(...args)}',
      './cred-store':'export const credGetUser=()=>"test-only-password"',
      './settings':'export const getSettings=()=>({serverUrl:"http://127.0.0.1:18772"})',
      './bridge':'export const wheelLiveDir=()=>""'
    }[args.path],loader:'js'}))
  }}]})
const emailApi=await import(pathToFileURL(path.join(dir,'email-api.mjs')))
emailApi.setEmailSession(ctx.email,'expired-session')
let requests=0
globalThis.__liveTestFetch=async(url,options)=>{
  requests++
  const body=JSON.parse(options.body)
  if(url.endsWith('/login')) return new Response(JSON.stringify({ok:1,session:'renewed-session'}))
  if(body.session==='expired-session') return new Response(JSON.stringify({ok:0,relogin:1,error:'登录已过期'}),{status:401})
  assert.equal(body.session,'renewed-session')
  return new Response(JSON.stringify({ok:1,accepted:['test-event']}))
}
assert.equal((await emailApi.sendLiveEvents(ctx.email,ctx.room,ctx.game,'test',[])).ok,true)
assert.equal(requests,3)
pass('真实邮箱 HTTP 封装保留 401 重登标记，并用新会话重传')
globalThis.__liveTestFetch=async()=>new Response(JSON.stringify({ok:0,error:'直播间未绑定当前账号'}),{status:403})
assert.equal((await emailApi.sendLiveEvents(ctx.email,ctx.room,ctx.game,'test',[])).error,'直播间未绑定当前账号')
pass('403 的绑定失败原因显示到上传日志')
delete globalThis.__liveTestFetch

const endpoint=process.env.LIVE_REPORT_TEST_URL
if(endpoint){
  const url=new URL(endpoint)
  assert.equal(url.hostname,'127.0.0.1','只允许隔离本地服务')
  const liveContext={...ctx,server:endpoint}
  const post=async(route,body)=>{
    const res=await fetch(endpoint+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    const result=await res.json(); assert.equal(res.status,200,JSON.stringify(result)); return result
  }
  const admin=(op,extra={})=>post('/api/license/admin',{s:'test-admin-token-for-live-records',op,...extra})
  const previousViewers=(await admin('viewers',{scope:ctx.room,n:500})).viewers
  const previousGifts=(await admin('live_records',{scope:ctx.room})).gifts.filter(g=>g.nick.startsWith('验收'))
  const previousValue=(nick,key)=>previousViewers.find(v=>v.nick===nick)?.[key]||0
  const live = new LiveReportQueue([], rows=>fs.writeFile(path.join(dir,'pending.json'),JSON.stringify(rows)),async(context,events)=>{
    const r=await post('/api/email/live-events',{email:context.email,session:'test-session-for-live-records',room:context.room,game:context.game,v:'acceptance-test',events})
    // 故意模拟“服务端已入库、响应丢失”，同一批立即再发，验真实数据库去重。
    const retried=await post('/api/email/live-events',{email:context.email,session:'test-session-for-live-records',room:context.room,game:context.game,events})
    assert.deepEqual(r.accepted,retried.accepted)
    return {...r,ok:r.ok===1}
  })
  for(const [line,coins] of [
    ['[connector] 礼物: 小心心 x3 by 验收送礼观众 2 分/个',2],
    ['[darkmage-connector] gift 玫瑰 x2 by 验收薄连接器观众',1],
    ['[connector] 关注 by 验收关注观众',0],
    ['[darkmage-connector] follow | 验收薄连接器关注',0],
    [JSON.stringify({type:'enter',sender:'验收进场观众'}),0]
  ]) assert.equal(live.add(liveContext,parsed(line),coins,false),true,line)
  assert.equal(await live.flush(ctx.email,endpoint),5)
  const viewers=await admin('viewers',{scope:ctx.room,n:500})
  assert.equal(viewers.viewers.find(v=>v.nick==='验收送礼观众').score,previousValue('验收送礼观众','score')+6)
  assert.equal(viewers.viewers.find(v=>v.nick==='验收关注观众').follows,previousValue('验收关注观众','follows')+1)
  assert.equal(viewers.viewers.find(v=>v.nick==='验收进场观众').score,0)
  const records=await admin('live_records',{scope:ctx.room})
  assert.equal(records.gifts.filter(g=>g.nick.startsWith('验收')).length,previousGifts.length+2)
  assert.equal(records.gifts.filter(g=>g.nick.startsWith('验收')).reduce((s,g)=>s+g.coins,0),previousGifts.reduce((s,g)=>s+g.coins,0)+8)
  pass('解析 → 持久队列 → HTTP → Flask → SQLite → 后台查询，重传后仍为 2 条礼物/8 抖币/2 名关注')
}
await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({passed,integration:!!endpoint},null,2))
console.log(`SUMMARY ${passed}/${endpoint?12:11} PASS`)
console.log('Evidence: '+dir)
