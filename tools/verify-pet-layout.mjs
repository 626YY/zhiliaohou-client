// 直接编译产品的输出页与React预览，在独立浏览器中复现用户截图。
// 不启动客户端主程序，不接触用户配置/IPC/直播间；允许正式客户端继续运行。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import ts from 'typescript'
import { chromium, _electron as electron } from 'playwright-core'

const root=path.resolve(import.meta.dirname,'..')
const baseline=process.argv.includes('--baseline')
const useElectron=process.argv.includes('--electron')
const recordMotion=process.argv.includes('--record-motion')
const outputName=process.argv.find(arg=>arg.startsWith('--output='))?.slice('--output='.length)||'pet-layout'
assert.match(outputName,/^[a-z0-9_-]+$/)
const output=path.join(root,'output/playwright',outputName+(baseline?'-before':'')+(useElectron?'-electron':''))
await fs.mkdir(output,{recursive:true})
const sourceFiles=['src/main/time-widget.ts','src/shared/countdownPets.ts','src/shared/petTimeText.ts','src/renderer/src/components/PetCountdownPreview.tsx']
const original=async file=>baseline&&sourceFiles.includes(path.relative(root,file).replaceAll('\\','/'))
  ? execFileSync('git',['show','HEAD:'+path.relative(root,file).replaceAll('\\','/')],{cwd:root,encoding:'utf8'})
  : fs.readFile(file,'utf8')
const sourcePlugin={name:'actual-page-without-client-runtime',setup(builder){
  builder.onLoad({filter:/src[/\\](main|shared|renderer)[/\\].*\.(ts|tsx)$/},async args=>{
    let code=await original(args.path)
    if(args.path.endsWith('time-widget.ts')){
      // 仅保留产品页的原始声明，排除顶层生命周期监听器和所有客户端服务。
      const names=new Set(['ThemeEntry','THEMES','ART_TOP','GIFT_GAP','TICKER_H','numberOr','giftEffectColor','giftEffectText','source','pageJson','pageConfig','themeFor','widgetMetrics','giftRowsHtml','esc','widgetBaseCss','pageThemes','page'])
      const file=ts.createSourceFile(args.path,code,ts.ScriptTarget.Latest,true)
      code=file.statements.filter(node=>ts.isImportDeclaration(node)||names.has(node.name?.getText(file))||(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>names.has(d.name.getText(file))))).map(node=>node.getFullText(file)).join('\n')
      // 只重定向测试页的素材URL到同一份源素材，避免依赖out/是否正在构建。
      code=code.replaceAll("'../renderer/pet-skins'","'../../src/renderer/public/pet-skins'")
      code=code.replaceAll("'../renderer/pet-skins/charms.png'","'../../src/renderer/public/pet-skins/charms.png'")
    }
    return {contents:code+(args.path.endsWith('time-widget.ts')?'\nexport { page as renderTimePage };':''),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)}
  })
  // 这些导入只被主程序运行逻辑使用，渲染页无此依赖；明确禁用模块副作用。
  builder.onResolve({filter:/^\.\/(capture-output|window-bounds|output-window|entertainment|green-screen|db|time-log-view)$/},args=>({path:args.path,external:true,sideEffects:false}))
  builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'renderer-fixture'}))
  builder.onLoad({filter:/.*/,namespace:'renderer-fixture'},()=>({contents:`export const app={getAppPath:()=>${JSON.stringify(root)}};export class BrowserWindow{}`,loader:'js'}))
}}
const rendererModule=path.join(output,'actual-renderer.cjs')
await build({stdin:{contents:`export {renderTimePage,widgetMetrics} from './src/main/time-widget'; export {COUNTDOWN_THEMES} from './src/shared/countdownFrame';`,resolveDir:root,loader:'ts'},outfile:rendererModule,bundle:true,platform:'node',format:'cjs',plugins:[sourcePlugin],define:{__dirname:JSON.stringify(path.join(root,'out/main'))},logLevel:'warning'})
const {renderTimePage,widgetMetrics,COUNTDOWN_THEMES}=createRequire(import.meta.url)(rendererModule)
const catalog=JSON.parse(await fs.readFile(path.join(root,'gift-assets/douyin/catalog.json'),'utf8'))
const iconFor=name=>{
  const icon=catalog.images.find(item=>item.name===name)
  assert.ok(icon,'测试礼物缺少目录素材: '+name)
  return pathToFileURL(path.join(root,'gift-assets/douyin',icon.file)).href
}
const gifts=[
  {name:'小心心',mode:'blindbox'},{name:'亲吻',mode:'blindbox'},
  {name:'跑车',op:'清零'},{name:'爱的守护',seconds:30},
  // 截图中的双杯 CHEERS 图在真实目录叫「99啤酒」，展示名保留用户文案。
  {name:'干杯啤酒',imageName:'99啤酒',seconds:30},{name:'猜猜我是谁',seconds:30}
].map(({imageName,...g})=>({op:'加减',seconds:30,...g,img:iconFor(imageName||g.name)}))
await Promise.all(gifts.map(gift=>fs.access(new URL(gift.img))))
function config(id,extra={}){
  const theme=COUNTDOWN_THEMES.find(t=>t.id===id)
  return {theme:id,title:'这么点时间太少了',titleColor:theme.titleColor,timeColor:theme.timeColor,giftNameColor:theme.giftNameColor,addColor:theme.addColor,subColor:theme.subColor,boxColor:theme.boxColor,cellBg:theme.cellBg,cellBorder:theme.cellBorder,bgImage:'',cellAlpha:1,giftPanel:true,giftColumns:2,giftPanelWidth:1,giftIconSize:42,giftNameSize:16,giftTextSize:16,scale:1,petMotion:false,gifts,showSeconds:false,showNegative:true,zeroText:'时间到',...extra}
}
const first=config('pet_duo')
const pageFile=path.join(output,'time-widget.html')
await fs.writeFile(pageFile,renderTimePage(first,{}))
const coldPageFile=path.join(output,'cold-theme.html')
await fs.writeFile(coldPageFile,renderTimePage(config('theatre'),{}))
// 预览使用真正的React组件，不另写一份测试用HTML。
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import PetPreview from './src/renderer/src/components/PetCountdownPreview';const root=createRoot(document.getElementById('preview'));window.setPreview=(config)=>{root.render(<PetPreview config={config} value="00:57:02" zeroed={false} giftImage={g=>g.img||''} giftText={g=>g.mode==='blindbox'?'盲盒':g.op==='清零'?'清零':'+30'} giftColor={g=>g.mode==='blindbox'?config.boxColor:g.op==='清零'?config.subColor:config.addColor}/>)};`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'preview.js'),bundle:true,platform:'browser',format:'iife',tsconfig:path.join(root,'tsconfig.web.json'),plugins:[sourcePlugin],logLevel:'warning'})
await fs.writeFile(path.join(output,'preview.html'),`<!doctype html><html><head><base href="${pathToFileURL(path.join(root,'src/renderer/public/')).href}"><style>html,body{margin:0;background:transparent}#preview{width:392px}*{box-sizing:border-box}</style></head><body><div id="preview"></div><script src="${pathToFileURL(path.join(output,'preview.js')).href}"></script></body></html>`)
let browser,app,context,page,preview
if(useElectron){
  const profile=await fs.mkdtemp(path.join(output,'renderer-session-'))
  const entry=path.join(profile,'renderer-only.cjs')
  await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{for(const name of ['output','preview']){const win=new BrowserWindow({width:392,height:440,show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false}});win.setTitle('Pet layout test '+name);win.loadURL('about:blank')}});`)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry,'--force-device-scale-factor=1','--allow-file-access-from-files'],cwd:root,env})
  page=await app.firstWindow()
  while(app.windows().length<2)await page.waitForTimeout(30)
  preview=app.windows().find(p=>p!==page)
  for(const p of [page,preview])await p.emulateMedia({reducedMotion:'no-preference'})
}else{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--allow-file-access-from-files']})
  context=await browser.newContext({viewport:{width:392,height:440},deviceScaleFactor:1,reducedMotion:'no-preference'})
  page=await context.newPage();preview=await context.newPage()
}
async function capture(p,name){
  const file=name?path.join(output,name+'.png'):undefined
  if(!app)return p.screenshot(file?{path:file}:{})
  const win=await app.browserWindow(p)
  await win.evaluate(w=>w.webContents.invalidate())
  await p.waitForTimeout(120)
  const bytes=await win.evaluate(async w=>{const img=await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});return [...img.toPNG()]})
  assert.ok(bytes.length>100,'Empty Electron screenshot')
  const buffer=Buffer.from(bytes)
  if(file)await fs.writeFile(file,buffer)
  return buffer
}
const errors=[],checks=[],scenarios=[]
for(const p of [page,preview])p.on('pageerror',e=>errors.push(e.message))
const pass=name=>{checks.push(name);console.log('PASS '+name)}
const references={pet_cream:'01-cream-puppy.png',pet_duo:'02-mint-duo.png',pet_peach:'03-peach-kitten.png',pet_night:'04-goodnight-cat.png'}
async function referenceFidelity(id,captured){
  const source=path.join(root,'../output/timer-skins-20260920/suites',references[id])
  const original=await fs.readFile(source),copied=await fs.readFile(path.join(root,'src/renderer/public/pet-skins','reference-'+id.slice(4)+'.png'))
  assert.equal(createHash('sha256').update(copied).digest('hex'),createHash('sha256').update(original).digest('hex'),'原稿PNG被改画')
  return page.evaluate(async({id,png,original})=>{
    const decode=async src=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height)}
    const actual=await decode('data:image/png;base64,'+png),expected=await decode(original)
    const at=(im,x,y)=>{const n=(Math.round(y)*im.width+Math.round(x))*4;return [...im.data.slice(n,n+3)]}
    const faceBoxes={pet_cream:[[443,220,700,347]],pet_duo:[[415,225,625,348],[750,220,910,335]],pet_peach:[[448,220,728,362]],pet_night:[[448,231,737,359]]}
    const head=document.querySelector('.pet-paint-head'),r=head.getBoundingClientRect(),css=getComputedStyle(head),scale=r.width/head.clientWidth
    const [sw,sh]=css.backgroundSize.split(' ').map(parseFloat),[ox,oy]=css.backgroundPosition.split(' ').map(parseFloat)
    const charm=document.querySelector('.pet-charm'),cr=charm.getBoundingClientRect(),vb=charm.viewBox.baseVal
    const path=new Path2D(charm.querySelector('clipPath path').getAttribute('d')),ctx=document.createElement('canvas').getContext('2d')
    const errors={face:[],charm:[]}
    const sample=(x,y,sx,sy,kind)=>{
      const neighbors=[at(expected,x-2,y-2),at(expected,x+2,y+2),at(expected,x,y)].flat()
      if([0,1,2].some(c=>Math.max(neighbors[c],neighbors[c+3],neighbors[c+6])-Math.min(neighbors[c],neighbors[c+3],neighbors[c+6])>15))return
      const a=at(actual,sx,sy),b=at(expected,x,y)
      errors[kind].push(Math.max(...a.map((v,c)=>Math.abs(v-b[c]))))
    }
    for(const [x0,y0,x1,y1] of faceBoxes[id])for(let y=y0;y<y1;y+=13)for(let x=x0;x<x1;x+=13)sample(x,y,r.x+(x/1254*sw+ox)*scale,r.y+(y/1254*sh+oy)*scale,'face')
    for(let y=vb.y+4;y<vb.y+vb.height-4;y+=4)for(let x=vb.x+4;x<vb.x+vb.width-4;x+=4){
      if(![[x-3,y-3],[x+3,y+3],[x-3,y+3],[x+3,y-3]].every(([a,b])=>ctx.isPointInPath(path,a,b)))continue
      sample(x,y,cr.x+(x-vb.x)/vb.width*cr.width,cr.y+(y-vb.y)/vb.height*cr.height,'charm')
    }
    const metrics=Object.fromEntries(Object.entries(errors).map(([key,values])=>[key,{samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,outliers:values.filter(v=>v>35).length/values.length}]))
    return {...metrics,tailCount:document.querySelectorAll('.pet-tail').length,heartCount:document.querySelectorAll('.pet-heart').length,charmSource:charm.querySelector('image').getAttribute('href')}
  },{id,png:captured.toString('base64'),original:pathToFileURL(source).href})
}
async function render(cfg,value=3422){
  const dimensions=widgetMetrics(cfg)
  if(app)await (await app.browserWindow(page)).evaluate((w,size)=>w.setContentSize(size.w,size.h),dimensions)
  else await page.setViewportSize({width:dimensions.w,height:dimensions.h})
  await page.evaluate(([cfg,value])=>{window.__setConfig(cfg,{});window.__render({remaining:value,zeroed:false,hidden:false});document.body.style.background='#00ff00'},[cfg,value])
  await page.evaluate(()=>document.fonts.ready)
  // 再次应用以覆盖字体缓存冷热两种时序。
  await page.evaluate(cfg=>window.__setConfig(cfg,{}),cfg)
  await page.evaluate(async()=>{
    await Promise.all([...document.querySelectorAll('.gift-icon img')].map(image=>image.decode().catch(()=>{})))
  })
  await page.waitForTimeout(35)
}
async function inspect(p,selector='#stage'){
  return p.locator(selector).evaluate(root=>{
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}}
    const get=s=>rect(root.querySelector(s))
    const title=root.querySelector('.pet-title'),digits=root.querySelector('.pet-time'),text=digits.querySelector('text'),head=root.querySelector('.pet-clock')
    const scale=head.getBoundingClientRect().width/head.clientWidth
    const textBox=text?.getBBox()
    const digitRect=digits.getBoundingClientRect(),svg=digits.querySelector('svg')
    // SVG getBBox 的竖向范围含字体EM留白；用真实字形升降部核对可见边界。
    const ctx=document.createElement('canvas').getContext('2d'),font=text&&getComputedStyle(text)
    if(font)ctx.font=`${font.fontWeight} ${font.fontSize} ${font.fontFamily}`
    const measured=text&&ctx.measureText(text.textContent),baseline=text&&Number(text.getAttribute('y'))
    const ink=textBox?{top:digitRect.top+(baseline-measured.actualBoundingBoxAscent)*scale,bottom:digitRect.top+(baseline+measured.actualBoundingBoxDescent)*scale,left:digitRect.left+textBox.x*scale,right:digitRect.left+(textBox.x+textBox.width)*scale}:null
    const overlaps=(a,b)=>a&&b&&a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y
    const titleBox=get('.pet-title'),clockBox=get('.pet-clock'),timeBox=get('.pet-time'),charmBox=get('.pet-charm')
    const lastCells=[...root.querySelectorAll('.gift-cell[data-last-row="true"]')]
    const lastContent=lastCells.flatMap(cell=>[...cell.querySelectorAll('.gift-icon,.gift-name,.gift-effect')]).map(rect)
    const footer=get('.pet-paint-foot'),gifts=get('.pet-gifts'),ticker=get('#ticker')||get('.pet-ticker')
    const footerSize=getComputedStyle(root.querySelector('.pet-paint-foot')).backgroundSize.split(' ').map(parseFloat)
    const menuContentBottom=ticker?.bottom||gifts?.bottom
    const pet=root.querySelector('.pet-paint-pet')
    return {theme:root.dataset.petSkin,reference:!!root.querySelector('.pet-paint[data-pet-reference]'),title:titleBox,time:timeBox,clock:clockBox,charm:charmBox,anchor:get('.pet-charm-anchor'),scale,ink,
      paintHead:get('.pet-paint-head'),paintFoot:footer,footerSize,menu:get('.pet-menu-content'),gifts,ticker,
      menuBottomGap:menuContentBottom==null?null:(footer.bottom-menuContentBottom)/scale,
      lastContentGap:lastContent.length?(footer.bottom-Math.max(...lastContent.map(r=>r.bottom)))/scale:null,
      cells:[...root.querySelectorAll('.gift-cell')].map(rect),petVisual:get('.pet-paint-pet'),petTransform:pet?getComputedStyle(pet).transform:null,
      tails:[...root.querySelectorAll('.pet-tail')].map(e=>getComputedStyle(e).transform),hearts:[...root.querySelectorAll('.pet-heart')].map(e=>getComputedStyle(e).transform),
      titleGap:(timeBox.y-titleBox.bottom)/scale,bottomGap:(clockBox.bottom-timeBox.bottom)/scale,
      text:title.textContent,digits:digits.textContent,font:digits.dataset.petFontSize,
      titleFont:parseFloat(getComputedStyle(title).fontSize),titleDecoWidth:parseFloat(getComputedStyle(title,'::before').width),
      titleOverflow:title.scrollWidth>title.clientWidth+1,
      overflows:[...root.querySelectorAll('.gift-name,.gift-effect')].filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>e.textContent),
      overflowDetails:[...root.querySelectorAll('.gift-name,.gift-effect')].filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>({text:e.textContent,width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,size:getComputedStyle(e).fontSize,lineHeight:getComputedStyle(e).lineHeight})),
      missingImages:[...root.querySelectorAll('.gift-cell')].filter(cell=>{const image=cell.querySelector('.gift-icon img');return !image||!image.complete||image.naturalWidth<=0}).map(cell=>cell.querySelector('.gift-name')?.textContent),
      collisions:[...root.querySelectorAll('.gift-icon,.gift-text')].filter(e=>overlaps(charmBox,rect(e))).map(e=>e.className),
      letters:[...root.querySelectorAll('.gift-name,.gift-effect')].map(e=>({text:e.textContent,kind:e.className,size:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight,synthesis:getComputedStyle(e).fontSynthesis})),
      window:{w:innerWidth,h:innerHeight},panel:get('.pet-panel'),svg:svg?{w:svg.clientWidth,h:svg.clientHeight}:null}
  })
}
function checkLayout(result){
  assert.ok(result.titleGap>=3.5,'标题/数字缺少安全间距: '+JSON.stringify(result))
  assert.ok(result.bottomGap>=11,'数字碰到底部装饰线')
  assert.ok(result.ink&&result.ink.top>=result.time.y-1&&result.ink.bottom<=result.time.bottom+1,'真实数字字形溢出')
  assert.ok(result.ink.left>=result.time.x-1&&result.ink.right<=result.time.right+1,'数字横向挤出')
  assert.equal(result.titleOverflow,false,'长标题溢出')
  assert.ok(result.titleDecoWidth/result.titleFont>.55,'长标题把装饰线挤成了细针')
  assert.deepEqual(result.overflows,[],'礼物文字溢出: '+JSON.stringify(result.overflowDetails))
  assert.deepEqual(result.missingImages,[],'礼物图标缺失或资源未加载')
  assert.deepEqual(result.collisions,[],'挂件遮住礼物')
  assert.ok(result.anchor,'挂件没有固定扣环锚点')
  assert.ok(Math.abs(result.footerSize[0]-result.footerSize[1])<.02,'底部圆角源图被非等比缩放')
  assert.ok(Math.abs(result.footerSize[0]/1254-result.paintHead.w/((result.reference?1008:1190)*result.scale))<.002,'底部圆角与头图缩放不一致')
  if(result.theme==='pet_berry')assert.ok(result.title.right<=result.clock.x+result.clock.w*.61,'兔兔/草莓占用的区域遮住标题')
  assert.ok(result.charm.x>=0&&result.charm.right<=result.window.w+1&&result.charm.bottom<=result.window.h+1,'挂件被窗口裁切')
  if(result.menuBottomGap!=null)assert.ok(result.menuBottomGap>=10&&result.menuBottomGap<=18,'菜单底部留白应独立于圆角底片: '+result.menuBottomGap)
}
async function checkBorderPixels(p){
  const geometry=await p.evaluate(()=>{
    const h=document.querySelector('.pet-paint-head').getBoundingClientRect(),m=document.querySelector('.pet-paint-menu').getBoundingClientRect(),f=document.querySelector('.pet-paint-foot').getBoundingClientRect()
    const bands=[...document.querySelectorAll('.pet-paint-menu,.pet-paint-foot')].map(element=>{
      const r=element.getBoundingClientRect(),css=getComputedStyle(element),scale=r.width/element.clientWidth
      return {x:r.left,y:r.top,w:r.width,h:r.height,scale,url:css.maskImage.slice(5,-2),size:css.maskSize.split(' ').map(parseFloat),position:css.maskPosition.split(' ').map(parseFloat)}
    })
    const seams=[...document.querySelectorAll('.pet-paint-clock-fill,.pet-paint-clock-end')].filter(e=>e.getBoundingClientRect().height>0).map(e=>e.getBoundingClientRect().top)
    const reference=!!document.querySelector('.pet-paint[data-pet-reference]')
    return {left:h.left,right:h.right,top:m.top,bottom:f.bottom,footerTop:f.top,seams,reference,dark:document.querySelector('[data-pet-skin]')?.dataset.petSkin==='pet_night',guard:h.width*(reference?18/1008:24/1190)+1,bands}
  })
  const visible=await capture(p)
  const hide=await p.addStyleTag({content:'.pet-gifts,#ticker,.pet-ticker{visibility:hidden!important}'})
  let artwork
  try{artwork=await capture(p)}finally{await hide.evaluate(e=>e.remove())}
  const result=await p.evaluate(async([a,b,g])=>{
    const decode=async data=>{const im=new Image();im.src='data:image/png;base64,'+data;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height)}
    const before=await decode(a),after=await decode(b)
    // 按产品两段背景的实际坐标重建轮廓。底片中央可放内容，保护区只沿真实外沿向内延伸。
    const mask=document.createElement('canvas');mask.width=before.width;mask.height=before.height
    const ctx=mask.getContext('2d')
    for(const band of g.bands){
      if(band.h<=0)continue
      const image=new Image();image.src=band.url;await image.decode()
      const [sw,sh]=band.size,[ox,oy]=band.position
      ctx.save();ctx.beginPath();ctx.rect(band.x,band.y,band.w,band.h);ctx.clip()
      ctx.drawImage(image,band.x+ox*band.scale,band.y+oy*band.scale,sw*band.scale,sh*band.scale);ctx.restore()
    }
    const silhouette=ctx.getImageData(0,0,mask.width,mask.height).data,width=mask.width,height=mask.height
    const distance=new Float32Array(width*height),diagonal=Math.SQRT2
    for(let i=0;i<distance.length;i++)distance[i]=silhouette[i*4+3]>128?1e6:0
    // 两次八邻域距离传播得到描边保护带，弧角中间的可用底色不再全部列为禁区。
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x;if(!distance[i])continue
      distance[i]=Math.min(distance[i],x?distance[i-1]+1:1,y?distance[i-width]+1:1,x&&y?distance[i-width-1]+diagonal:1e6,x+1<width&&y?distance[i-width+1]+diagonal:1e6)
    }
    for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
      const i=y*width+x;if(!distance[i])continue
      distance[i]=Math.min(distance[i],x+1<width?distance[i+1]+1:1,y+1<height?distance[i+width]+1:1,x+1<width&&y+1<height?distance[i+width+1]+diagonal:1e6,x&&y+1<height?distance[i+width-1]+diagonal:1e6)
    }
    let checked=0,changed=0,interiorChanged=0,seamLeaks=0
    const changedPoints=[]
    // 隐藏内容后的整条背景内部不应在分片拼接位置透出绿幕；一条1px裂缝也会计入。
    for(const seam of [...g.seams,g.top,g.footerTop]){
      for(let y=Math.max(0,Math.floor(seam)-1);y<=Math.min(height-1,Math.ceil(seam)+1);y++){
        for(let x=Math.ceil(g.left+(g.right-g.left)*.2);x<Math.min(width,Math.floor(g.right-(g.right-g.left)*.2));x++){
          const i=(y*width+x)*4
          if(after.data[i]<=3&&after.data[i+1]>=252&&after.data[i+2]<=3)seamLeaks++
        }
      }
    }
    for(let y=Math.ceil(g.top);y<Math.min(before.height,Math.floor(g.bottom));y++){
      for(let x=Math.ceil(g.left);x<Math.min(before.width,Math.floor(g.right));x++){
        const offset=(y*before.width+x)*4,different=[0,1,2,3].some(i=>Math.abs(before.data[offset+i]-after.data[offset+i])>8)
        if(distance[y*width+x]>g.guard){if(y>=g.footerTop&&different)interiorChanged++;continue}
        // 菜单顶部是与时间区拼接的内部接缝，不属于原画外轮廓。
        if(y<g.top+g.guard&&x>g.left+g.guard*2&&x<g.right-g.guard*2)continue
        // 原稿吊饰拆层留下的是内部遮罩边界，底色仍可上色；保护原画真正的深色/奶油色外描边。
        if(g.reference){const rgb=[...after.data.slice(offset,offset+3)];if(g.dark?!(Math.min(...rgb)>160||Math.max(...rgb)<75):Math.max(...rgb)>=170)continue}
        checked++;if(different){changed++;if(changedPoints.length<16)changedPoints.push({x,y,distance:distance[y*width+x],before:[...before.data.slice(offset,offset+3)],after:[...after.data.slice(offset,offset+3)]})}
      }
    }
    return {checked,changed,interiorChanged,seamLeaks,...(changed?{changedPoints}: {})}
  },[visible.toString('base64'),artwork.toString('base64'),geometry])
  assert.ok(result.checked>1000,'边框像素采样不足')
  assert.equal(result.changed,0,'礼物内容/分隔线盖住原画边框: '+JSON.stringify(result))
  assert.equal(result.seamLeaks,0,'原画分片接缝透出绿幕: '+JSON.stringify(result))
  return result
}
try{
  await page.goto(pathToFileURL(coldPageFile).href)
  const coldDimensions=widgetMetrics(first)
  if(app)await(await app.browserWindow(page)).evaluate((w,size)=>w.setContentSize(size.w,size.h),coldDimensions)
  else await page.setViewportSize({width:coldDimensions.w,height:coldDimensions.h})
  await page.evaluate(cfg=>{window.__setConfig(cfg,{});window.__render({remaining:3422,zeroed:false,hidden:false})},first)
  await page.evaluate(()=>document.fonts.ready)
  await page.evaluate(()=>Promise.all([...document.querySelectorAll('.gift-icon img')].map(im=>im.decode())))
  await page.waitForTimeout(30)
  checkLayout(await inspect(page))
  assert.ok(await page.evaluate(()=>document.fonts.check('850 24px PetCjk')),'冷切换后圆体未加载')
  pass('普通皮肤冷切换至原稿皮肤，字体加载后自动重新排版，标题/数字不溢出')
  await page.goto(pathToFileURL(pageFile).href)
  await preview.goto(pathToFileURL(path.join(output,'preview.html')).href)
  await render(first)
  await capture(page,'duo-user-config')
  const firstResult=await inspect(page)
  await fs.writeFile(path.join(output,'user-config-metrics.json'),JSON.stringify(firstResult,null,2))
  checkLayout(firstResult)
  pass('用户原配置：长标题、00:57:02、六个礼物，标题/数字/装饰线互不重叠')
  assert.ok(firstResult.letters.filter(t=>t.kind==='gift-name').every(t=>parseFloat(t.size)===24),'礼物名没有按原稿24px显示')
  assert.ok(firstResult.letters.filter(t=>t.kind==='gift-effect').every(t=>parseFloat(t.size)===26),'礼物效果没有按原稿26px显示')
  assert.ok(firstResult.letters.filter(t=>t.kind==='gift-name').every(t=>t.weight==='850'),'原稿皮肤没有使用独立圆体字重')
  assert.ok(firstResult.letters.every(t=>t.synthesis==='none'),'礼物字体未禁用合成粗体')
  assert.ok(firstResult.lastContentGap>=12&&firstResult.lastContentGap<=36,'最后一行图文下方仍有过大空白: '+firstResult.lastContentGap)
  pass('原稿皮肤16号设置对应礼物名24px、效果26px；独立可调且最后一行自然靠近底边')
  await preview.evaluate(cfg=>window.setPreview(cfg),first)
  await preview.waitForFunction(()=>document.querySelector('.pet-time svg'))
  await preview.evaluate(()=>document.fonts.ready)
  await preview.evaluate(()=>Promise.all([...document.querySelectorAll('.gift-icon img')].map(image=>image.decode())))
  await capture(preview,'duo-preview')
  const previewResult=await inspect(preview,'[data-pet-skin]')
  checkLayout(previewResult)
  assert.deepEqual(previewResult.letters,firstResult.letters,'预览与实际输出的文字字号不同')
  assert.equal(previewResult.font,firstResult.font)
  assert.equal(previewResult.titleFont,firstResult.titleFont,'预览与输出的标题字号不同')
  pass('真实React预览与实际输出使用相同字号与布局')
  for(const skin of COUNTDOWN_THEMES.filter(t=>t.id.startsWith('pet_'))){
    await render(config(skin.id))
    const info=await inspect(page);checkLayout(info)
    // 扣环的固定锚点必须落在真实原画外沿，不能靠一条横线连接到浮空挂件。
    const anchored=await page.evaluate(async()=>{
      const anchor=document.querySelector('.pet-charm-anchor').getBoundingClientRect(),head=document.querySelector('.pet-paint-head'),r=head.getBoundingClientRect(),css=getComputedStyle(head)
      const url=css.backgroundImage.slice(5,-2),img=new Image();img.src=url;await img.decode()
      const mask=new Image();mask.src=css.maskImage.slice(5,-2);await mask.decode()
      const [sw,sh]=css.backgroundSize.split(' ').map(parseFloat),[ox,oy]=css.backgroundPosition.split(' ').map(parseFloat)
      const scale=r.width/head.clientWidth,x=((anchor.x-r.x)/scale-ox)/sw*img.naturalWidth,y=((anchor.y-r.y)/scale-oy)/sh*img.naturalHeight
      const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(mask,0,0,c.width,c.height)
      return {alpha:ctx.getImageData(Math.round(x),Math.round(y),1,1).data[3],x,y}
    })
    assert.ok(anchored.alpha>200,skin.id+' 挂件连接点不在原画边框内: '+JSON.stringify(anchored))
    const captured=await capture(page,skin.id)
    if(references[skin.id]){
      const fidelity=await referenceFidelity(skin.id,captured)
      for(const part of ['face','charm']){assert.ok(fidelity[part].samples>40,skin.id+' 原稿采样不足');assert.ok(fidelity[part].mean<7&&fidelity[part].outliers<.08,skin.id+' '+part+' 与原稿颜色/形状不符: '+JSON.stringify(fidelity))}
      assert.equal(fidelity.tailCount,skin.id==='pet_duo'?2:1)
      assert.equal(fidelity.heartCount,1)
      assert.ok(fidelity.charmSource.endsWith('reference-'+skin.id.slice(4)+'.png'))
      info.fidelity=fidelity
    }
    const borderPixels=await checkBorderPixels(page)
    assert.ok(info.lastContentGap>=12&&info.lastContentGap<=36,skin.id+' 最后一行下方留白不合理: '+info.lastContentGap)
    assert.ok(borderPixels.interiorChanged>10,skin.id+' 礼物内容没有进入底片中央可用区域')
    scenarios.push({theme:skin.id,...info,anchored,borderPixels})
  }
  pass('八套皮肤：扣环锚点均落在原画上，挂件与礼物内容无碰撞')
  pass('八套底部圆角等比缩放；菜单可进入底片中央，实际外描边像素保持完整')
  pass('四份原稿逐字节复用；实际动物/吊饰截图按原图采样匹配，原稿尾巴与心心图层齐全')
  await fs.mkdir(path.join(output,'all-skin-motion'),{recursive:true})
  for(const skin of COUNTDOWN_THEMES.filter(t=>t.id.startsWith('pet_'))){
    await render(config(skin.id,{petMotion:true}))
    let fixed
    const hashes=[]
    for(const time of [0,600,1800,2900]){
      await page.evaluate(t=>{for(const a of document.getAnimations()){a.pause();a.currentTime=t}},time)
      const info=await inspect(page);checkLayout(info)
      const stable={title:info.title,time:info.time,menu:info.menu,cells:info.cells,anchor:info.anchor}
      if(!fixed)fixed=stable
      else assert.deepEqual(stable,fixed,skin.id+' 动画带动了文字、菜单或固定锚点')
      const png=await capture(page,'all-skin-motion/'+skin.id+'-'+time)
      hashes.push(createHash('md5').update(png).digest('hex'))
    }
    assert.ok(new Set(hashes).size>=2,skin.id+' 动画画面没有变化')
    await render(config(skin.id,{petMotion:false}))
    assert.ok(await page.locator('.pet-paint-pet,.pet-charm,.pet-tail,.pet-heart,.pet-tail-lines').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationName==='none')),skin.id+' 关闭小动作仍有动画')
  }
  pass('八套皮肤逐帧核对摆动极值：没有遮挡/裁切，文字/菜单/锚点固定，画面MD5确有变化')
  pass('八套皮肤关闭小动作后，动物/尾巴/心心/吊饰全部停止')
  await render(first)
  assert.deepEqual(await page.locator('.gift-icon img').evaluateAll(images=>images.map(i=>i.src)),gifts.map(g=>g.img))
  pass('平台礼物图片保持原文件，仅调整显示大小和排版')
  await render(config('pet_duo',{cellBg:'#f1d1e8',cellBorder:'#705589',giftTicker:true}))
  await page.evaluate(()=>window.__ticker({name:'小心心',sender:'边框验收',delta:30,remaining:3422}))
  await page.waitForTimeout(400)
  checkLayout(await inspect(page));await checkBorderPixels(page)
  await capture(page,'duo-custom-menu-ticker')
  pass('自定义礼物底色和活动滚动条也保持在外边框以内')
  for(const scale of [.4,.75,1,2])for(const columns of [1,2,3]){
    await render(config('pet_duo',{scale,giftColumns:columns}))
    checkLayout(await inspect(page))
  }
  pass('0.4/0.75/1/2倍缩放 × 1/2/3列，文字与挂件间距保持')
  // 加宽时检查实际DOM的比例，防止背景变大、标题/吊饰仍是固定像素。
  for(const id of ['pet_cream','pet_duo','pet_peach','pet_night']){
    let reference
    for(const width of [1,1.6,2.5]){
      await render(config(id,{title:'距离下播',gifts:gifts.slice(0,4),giftPanelWidth:width}))
      const info=await inspect(page);checkLayout(info)
      const ratio=await page.evaluate(()=>{
        const r=s=>document.querySelector(s).getBoundingClientRect(),head=r('.pet-clock')
        return {clock:head.height/head.width,body:(r('.pet-paint-foot').bottom-r('.pet-paint-pet').top)/head.width,charm:r('.pet-charm').height/head.width,title:parseFloat(getComputedStyle(document.querySelector('.pet-title')).fontSize)/head.width}
      })
      if(!reference)reference=ratio
      for(const key of ['clock','charm','title'])assert.ok(Math.abs(ratio[key]/reference[key]-1)<.02,id+' 加宽后 '+key+' 比例改变')
      assert.ok(Math.abs(ratio.body/reference.body-1)<.04,id+' 加宽后整体被压扁')
      await checkBorderPixels(page)
    }
  }
  pass('四款原稿皮肤：1/1.6/2.5倍面板宽度下，整体/计时框/标题/吊饰比例保持，所有分片无绿缝')
  for(const id of ['pet_cream','pet_duo','pet_berry','pet_space'])for(const charmScale of [.2,.7,.85,2]){
    await render(config(id,{charmScale,giftColumns:3}))
    const info=await inspect(page)
    try{checkLayout(info)}catch(error){await capture(page,'charm-failure');await fs.writeFile(path.join(output,'charm-failure.json'),JSON.stringify({id,charmScale,...info},null,2));throw error}
  }
  pass('吊饰0.2/0.7/0.85/2：旧默认值对齐原稿，左右挂件均不裁切、不遮住三列礼物')
  await render(config('pet_duo',{giftNameSize:24,giftTextSize:26}))
  const enlarged=await inspect(page);checkLayout(enlarged)
  assert.ok(enlarged.letters.filter(t=>t.kind==='gift-name').every(t=>parseFloat(t.size)===36))
  assert.ok(enlarged.letters.filter(t=>t.kind==='gift-effect').every(t=>parseFloat(t.size)===42.25))
  pass('现有字号设置继续生效，调大文字后格子同步增大')
  for(const id of ['pet_duo','pet_space','pet_berry'])for(const extra of [{gifts:[]},{giftPanel:false},{gifts:[],giftTicker:true},{gifts:gifts.slice(0,5),giftColumns:3},{giftIconSize:96,giftNameSize:28,giftTextSize:28,giftColumns:3,scale:.6},{title:'这么点时间不够用，今天还想再多播一会'}]){
    await render(config(id,extra));const info=await inspect(page)
    try{checkLayout(info)}catch(error){await capture(page,'edge-failure');throw new Error(id+' '+JSON.stringify(extra)+' '+error.message)}
  }
  pass('空菜单、隐藏菜单、大图标大字号、长标题不会互相挤压')
  await render(first,-1234567);checkLayout(await inspect(page))
  await page.evaluate(()=>window.__render({remaining:0,zeroed:true,hidden:false}));checkLayout(await inspect(page))
  pass('长时间、负数和结束文字均在独立时间区域内')
  for(const remaining of [1536,1535,1535,36000,1536]){
    await render(first,remaining)
    const text=await page.locator('.pet-time').textContent()
    assert.match(text,/^\d{2}:\d{2}:\d{2}$/,'重新布局丢失冒号')
    assert.equal(await page.locator('.pet-colon-dot').count(),4,'冒号圆点丢失')
  }
  pass('连续走秒、同秒重绘和十小时切回，三组数字与四颗冒号圆点保持')
  await page.emulateMedia({reducedMotion:'reduce'})
  await render(config('pet_duo',{petMotion:true}))
  if(!app)await page.bringToFront()
  const before=await inspect(page)
  await page.waitForTimeout(650)
  const after=await inspect(page)
  assert.deepEqual(before.anchor,after.anchor,'固定扣环锚点随挂件一起飘动')
  assert.notDeepEqual(before.charm,after.charm,'挂件没有轻摆')
  assert.ok(before.petVisual&&after.petVisual,'宠物没有独立动画图层')
  assert.equal(before.petTransform,after.petTransform,'原稿静止身体/框体跟着尾巴移动')
  assert.equal(before.tails.length,2,'双狗应有两条独立尾巴')
  assert.notDeepEqual(before.tails,after.tails,'尾巴没有独立摇动')
  assert.ok(before.hearts.length>0,'原稿顶部心心缺失')
  assert.notDeepEqual(before.hearts,after.hearts,'原稿顶部心心没有轻跳')
  assert.ok(await page.locator('.pet-heart,.pet-tail-lines').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).opacity==='1')),'装饰透明度把绿幕混进了原稿颜色')
  for(const key of ['title','time','menu','cells'])assert.deepEqual(before[key],after[key],key+' 随装饰动画移动')
  checkLayout(after)
  pass('Windows减少动画设置下，两条原稿尾巴/心心/吊饰独立运动；身体/锚点/文字/菜单静止')
  if(recordMotion){
    await fs.mkdir(path.join(output,'motion'),{recursive:true})
    const frames=[]
    // 固定浏览器动画时间后采样，避免截图耗时改变相位；只有测试页面受到控制。
    for(let elapsed=0;elapsed<4800;elapsed+=100){
      await page.evaluate(time=>{for(const animation of document.getAnimations()){animation.pause();animation.currentTime=time}},elapsed)
      const name='motion/frame-'+String(elapsed/100).padStart(2,'0')
      await capture(page,name);frames.push({time:elapsed,file:name+'.png'})
    }
    await fs.writeFile(path.join(output,'motion/frames.json'),JSON.stringify({intervalMs:100,frames},null,2))
    pass('记录4.8秒尾巴/心心/吊饰完整周期的48张真实Electron相位帧')
  }
  await render(config('pet_duo',{petMotion:false}))
  const stillBefore=await inspect(page);await page.waitForTimeout(700);const stillAfter=await inspect(page)
  for(const key of ['charm','petVisual','petTransform','tails','hearts','title','time','menu','cells'])assert.deepEqual(stillBefore[key],stillAfter[key],key+' 在关闭动画后仍移动')
  pass('关闭小动作后，小动物、挂件和内容全部静止')
  if(app){
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused())),true)
    pass('Electron实际渲染器验证通过，测试窗口全程隐藏且未启动客户端服务')
  }
  assert.deepEqual(errors,[])
}catch(error){errors.push(String(error.stack||error));console.error(error.message);process.exitCode=1}
finally{
  if(app)await app.close()
  if(browser)await browser.close()
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({baseline,useElectron,recordMotion,checks,errors,scenarios},null,2))
  console.log('PET LAYOUT '+(process.exitCode?'FAILED':'PASS')+': '+checks.length+' checks')
}
