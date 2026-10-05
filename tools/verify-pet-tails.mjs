// 实际输出页的尾巴残影回归：隐藏动态尾巴后，尾尖区域必须完全透明；摆到两端时根部不能裂开。
// 先用 compare-pet-reference.mjs 生成 actual-renderer.cjs，再传 --renderer=...；不启动客户端服务。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright-core'

const root=path.resolve(import.meta.dirname,'..')
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3)||fallback
const baseline=process.argv.includes('--baseline')
const record=process.argv.includes('--record')
const output=path.join(root,'output/playwright',arg('output',baseline?'tail-regression-before':'tail-regression'))
const renderer=path.resolve(root,arg('renderer','output/playwright/tail-after/actual-renderer.cjs'))
const {renderTimePage,widgetMetrics,COUNTDOWN_THEMES}=createRequire(import.meta.url)(renderer)
await fs.mkdir(output,{recursive:true})
// 原稿中远离身体连接处的尾尖区域；这些位置没有框体或其他角色，静态底图应透明。
const cases={
  pet_duo:{tips:[[231,285,310,390],[310,305,335,392],[335,327,362,392],[1010,307,1085,390],[342,306,357,319]],decor:[[600,76,670,133],[563,101,599,136],[680,86,715,122],[45,735,124,906]],roots:[[365,386],[968,402]]},
  pet_cream:{tips:[[881,243,1006,392]],decor:[[255,218,365,345],[1134,675,1205,846]],roots:[[866,383]]},
  pet_peach:{tips:[[878,246,1006,329],[895,330,997,394]],decor:[[261,207,355,305],[1135,677,1212,1015]],roots:[[888,389]],body:[[822,312,840,343],[842,334,855,368],[856,355,873,388]]},
  pet_night:{tips:[[922,247,1070,343],[937,343,1074,399]],decor:[[265,205,331,259],[310,140,380,209],[70,460,124,742]],roots:[[926,394]],body:[[858,300,877,337],[879,326,891,363],[897,353,912,395]]}
}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--allow-file-access-from-files']})
const page=await browser.newPage({deviceScaleFactor:1})
const errors=[],results=[],failures=[]
page.on('pageerror',e=>errors.push(e.message))
const assetRoot=pathToFileURL(path.join(root,'src/renderer/public/pet-skins/')).href
const oldAssetRoot=pathToFileURL(path.join(root,'output/tail-fix-baseline/')).href
async function render(id){
  const theme=COUNTDOWN_THEMES.find(t=>t.id===id)
  const cfg={theme:id,title:'这么点时间太少了',titleColor:theme.titleColor,timeColor:theme.timeColor,giftNameColor:theme.giftNameColor,addColor:theme.addColor,subColor:theme.subColor,boxColor:theme.boxColor,cellBg:theme.cellBg,cellBorder:theme.cellBorder,bgImage:'',cellAlpha:1,giftPanel:false,giftColumns:2,giftPanelWidth:1,giftIconSize:42,giftNameSize:16,giftTextSize:16,scale:2,petMotion:true,charmScale:.7,gifts:[],showSeconds:false,showNegative:true,zeroText:'时间到'}
  let html=renderTimePage(cfg,{})
  if(baseline)html=html.replaceAll(assetRoot+'reference-',oldAssetRoot+'reference-')
  const file=path.join(output,id+'.html');await fs.writeFile(file,html)
  const size=widgetMetrics(cfg);await page.setViewportSize({width:size.w,height:size.h})
  await page.goto(pathToFileURL(file).href)
  await page.evaluate(()=>{window.__render({remaining:3422,zeroed:false,hidden:false});document.body.style.background='transparent'})
  await page.evaluate(()=>document.fonts.ready)
  await page.waitForTimeout(150)
}
async function phase(time){
  await page.evaluate(t=>{for(const a of document.getAnimations()){a.pause();a.currentTime=t}},time)
  await page.waitForTimeout(35)
}
async function pixels(png,spec){
  return page.evaluate(async({data,spec})=>{
    const im=new Image();im.src='data:image/png;base64,'+data;await im.decode()
    const c=document.createElement('canvas');c.width=im.width;c.height=im.height
    const ctx=c.getContext('2d');ctx.drawImage(im,0,0)
    const image=ctx.getImageData(0,0,c.width,c.height)
    const head=document.querySelector('.pet-paint-head'),rect=head.getBoundingClientRect(),css=getComputedStyle(head),scale=rect.width/head.clientWidth
    const [sw,sh]=css.backgroundSize.split(' ').map(parseFloat),[ox,oy]=css.backgroundPosition.split(' ').map(parseFloat)
    const map=(x,y)=>[rect.x+(x/1254*sw+ox)*scale,rect.y+(y/1254*sh+oy)*scale]
    const residues=[]
    const measure=([x0,y0,x1,y1])=>{
      const [left,top]=map(x0,y0),[right,bottom]=map(x1,y1);let opaque=0
      const points=[]
      for(let y=Math.max(0,Math.ceil(top));y<Math.min(c.height,Math.floor(bottom));y++)for(let x=Math.max(0,Math.ceil(left));x<Math.min(c.width,Math.floor(right));x++)if(image.data[(y*c.width+x)*4+3]>64){opaque++;if(points.length<12)points.push([Math.round(((x-rect.x)/scale-ox)/sw*1254),Math.round(((y-rect.y)/scale-oy)/sh*1254)])}
      residues.push(points)
      return opaque
    }
    const tipPixels=spec.tips.map(measure),decorPixels=spec.decor.map(measure)
    const rootHoles=spec.roots.map(([x,y])=>{
      const [cx,cy]=map(x,y);let holes=0
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(image.data[(Math.round(cy+dy)*c.width+Math.round(cx+dx))*4+3]<220)holes++
      return holes
    })
    // 覆盖旧裁切线穿过的背部和侧边；只查一个根部中心像素会漏掉三角缺口。
    const bodyHoles=(spec.body||[]).map(([x0,y0,x1,y1])=>{
      const [left,top]=map(x0,y0),[right,bottom]=map(x1,y1);let holes=0
      for(let y=Math.ceil(top);y<Math.floor(bottom);y++)for(let x=Math.ceil(left);x<Math.floor(right);x++)if(image.data[(y*c.width+x)*4+3]<220)holes++
      return holes
    })
    return {tipPixels,decorPixels,rootHoles,bodyHoles,residues}
  },{data:png.toString('base64'),spec})
}
try{
  for(const [id,spec] of Object.entries(cases)){
    await render(id);await phase(0)
    const hide=await page.addStyleTag({content:'.pet-tail,.pet-tail-lines,.pet-heart,.pet-charm-mount{visibility:hidden!important}'})
    const staticPng=await page.screenshot({omitBackground:true,path:path.join(output,id+'-static.png')})
    const staticResult=await pixels(staticPng,spec)
    await hide.evaluate(e=>e.remove())
    const phases=[]
    for(const time of [0,600,1200,1800,2400]){
      await phase(time)
      const png=await page.screenshot({omitBackground:true,path:path.join(output,id+'-'+time+'.png')})
      const measured=await pixels(png,spec)
      phases.push({time,...measured})
    }
    results.push({id,staticTailPixels:staticResult.tipPixels,staticDecorPixels:staticResult.decorPixels,residues:staticResult.residues,phases})
    console.log(id+' static tail residue: '+staticResult.tipPixels.join(', ')+' pixels')
    console.log(id+' static heart/charm residue: '+staticResult.decorPixels.join(', ')+' pixels')
    if(!baseline){
      if(!staticResult.tipPixels.every(n=>n===0))failures.push(id+' 静态底图仍留有旧尾巴')
      if(!staticResult.decorPixels.every(n=>n===0))failures.push(id+' 静态底图仍留有心心/吊饰')
      if(!phases.every(p=>p.rootHoles.every(n=>n===0)))failures.push(id+' 摆动时根部断开')
      if(!phases.every(p=>p.bodyHoles.every(n=>n===0)))failures.push(id+' 摆动时背部/根部侧边缺口')
    }
  }
  assert.deepEqual(failures,[])
  if(baseline)assert.ok(results.some(r=>r.staticTailPixels.some(n=>n>0)),'原代码应复现尾巴残留')
  if(record&&!baseline){
    await render('pet_duo')
    await page.evaluate(()=>{document.body.style.background='#00ff00'})
    const rect=await page.locator('.pet-art').boundingBox()
    const clip={x:0,y:0,width:page.viewportSize().width,height:Math.ceil(rect.height+110)}
    const dir=path.join(output,'motion');await fs.mkdir(dir,{recursive:true});const frames=[]
    for(let t=0;t<2400;t+=100){
      await phase(t);const file='frame-'+String(t/100).padStart(2,'0')+'.png'
      const png=await page.screenshot({clip,path:path.join(dir,file)})
      frames.push({time:t,file,md5:createHash('md5').update(png).digest('hex')})
    }
    await fs.writeFile(path.join(dir,'frames.json'),JSON.stringify({intervalMs:100,frames},null,2))
    assert.ok(new Set(frames.map(f=>f.md5)).size>18,'动画截图重复')
  }
  assert.deepEqual(errors,[])
  console.log(baseline?'TAIL BASELINE: residue reproduced':'TAIL REGRESSION PASS: 4 skins, 5 phases each')
}catch(e){errors.push(e.stack||String(e));console.error(e.message);process.exitCode=1}
finally{
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({baseline,results,errors},null,2))
  await browser.close()
}
