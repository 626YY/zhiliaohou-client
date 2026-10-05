// 萌宠时间皮肤 · 与参考设计稿逐项对图。
// 用和参考图完全相同的内容（标题「距离下播」/ 00:25:36 / 玫瑰+30秒 · 棒棒糖-10秒 · 小心心+10秒 · 惊喜盲盒随机加减）
// 渲染真实挂件（礼物图用真实素材，不改），自动裁出两边挂件主体、等高并排，输出「参考 | 当前」对比图。
// 不启动客户端主程序、不接触用户配置；离屏 Electron，不抢前台。
// 用法：node tools/compare-pet-reference.mjs [--skin=duo|cream|peach|night] [--scale=1.6]
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const arg = (k, d) => process.argv.find((a) => a.startsWith('--' + k + '='))?.slice(k.length + 3) ?? d
const skinKey = arg('skin', 'duo')
const renderScale = Number(arg('scale', '1.6'))
const recordMotion=process.argv.includes('--motion')
const REF = { cream: ['pet_cream', '01-cream-puppy.png'], duo: ['pet_duo', '02-mint-duo.png'], peach: ['pet_peach', '03-peach-kitten.png'], night: ['pet_night', '04-goodnight-cat.png'] }
if (!REF[skinKey]) throw new Error('未知皮肤：' + skinKey)
const [themeId, refFile] = REF[skinKey]
const outputName=arg('output','pet-reference-compare')
if(!/^[a-z0-9_-]+$/.test(outputName))throw new Error('Invalid output directory')
const output = path.join(root, 'output/playwright',outputName)
await fs.mkdir(output, { recursive: true })
const refPath = path.resolve(root, '..', 'output/timer-skins-20260920/suites', refFile)

// —— 打包真实输出页渲染函数（与 verify-pet-layout 同一套：只取页面声明，排除客户端生命周期）——
const sourcePlugin = { name: 'actual-page-without-client-runtime', setup(builder) {
  builder.onLoad({ filter: /src[/\\](main|shared|renderer)[/\\].*\.(ts|tsx)$/ }, async (args) => {
    let code = await fs.readFile(args.path, 'utf8')
    if (args.path.endsWith('time-widget.ts')) {
      const names = new Set(['ThemeEntry', 'THEMES', 'ART_TOP', 'GIFT_GAP', 'TICKER_H', 'numberOr', 'giftEffectColor', 'giftEffectText', 'source', 'pageJson', 'pageConfig', 'themeFor', 'widgetMetrics', 'giftRowsHtml', 'esc', 'widgetBaseCss', 'pageThemes', 'page'])
      const file = ts.createSourceFile(args.path, code, ts.ScriptTarget.Latest, true)
      code = file.statements.filter((node) => ts.isImportDeclaration(node) || names.has(node.name?.getText(file)) || (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => names.has(d.name.getText(file))))).map((node) => node.getFullText(file)).join('\n')
      code = code.replaceAll("'../renderer/pet-skins'", "'../../src/renderer/public/pet-skins'")
      code = code.replaceAll("'../renderer/pet-skins/charms.png'", "'../../src/renderer/public/pet-skins/charms.png'")
    }
    return { contents: code + (args.path.endsWith('time-widget.ts') ? '\nexport { page as renderTimePage };' : ''), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) }
  })
  builder.onResolve({ filter: /^\.\/(capture-output|window-bounds|output-window|entertainment|green-screen|db|time-log-view)$/ }, (args) => ({ path: args.path, external: true, sideEffects: false }))
  builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'renderer-fixture' }))
  builder.onLoad({ filter: /.*/, namespace: 'renderer-fixture' }, () => ({ contents: `export const app={getAppPath:()=>${JSON.stringify(root)}};export class BrowserWindow{}`, loader: 'js' }))
} }
const rendererModule = path.join(output, 'actual-renderer.cjs')
await build({ stdin: { contents: `export {renderTimePage,widgetMetrics} from './src/main/time-widget'; export {COUNTDOWN_THEMES} from './src/shared/countdownFrame';`, resolveDir: root, loader: 'ts' }, outfile: rendererModule, bundle: true, platform: 'node', format: 'cjs', plugins: [sourcePlugin], define: { __dirname: JSON.stringify(path.join(root, 'out/main')) }, logLevel: 'warning' })
const { renderTimePage, widgetMetrics, COUNTDOWN_THEMES } = createRequire(import.meta.url)(rendererModule)

const catalog = JSON.parse(await fs.readFile(path.join(root, 'gift-assets/douyin/catalog.json'), 'utf8'))
const iconFor = (name) => { const icon = catalog.images.find((i) => i.name === name); if (!icon) throw new Error('礼物库缺图：' + name); return pathToFileURL(path.join(root, 'gift-assets/douyin', icon.file)).href }
// 与参考图相同的四个礼物（礼物图用真实素材；盲盒格用真实礼物图 + 参考文案「随机加减」）
const gifts = [
  { name: '玫瑰', op: '加减', seconds: 30, img: iconFor('玫瑰') },
  { name: '棒棒糖', op: '加减', seconds: -10, img: iconFor('棒棒糖') },
  { name: '小心心', op: '加减', seconds: 10, img: iconFor('小心心') },
  { name: '惊喜盲盒', mode: 'blindbox', text: '随机加减', img: iconFor('礼花筒') }
]
const theme = COUNTDOWN_THEMES.find((t) => t.id === themeId)
const cfg = { theme: themeId, title: '距离下播', titleColor: theme.titleColor, timeColor: theme.timeColor, giftNameColor: theme.giftNameColor, addColor: theme.addColor, subColor: theme.subColor, boxColor: theme.boxColor, cellBg: theme.cellBg, cellBorder: theme.cellBorder, bgImage: '', cellAlpha: 1, giftPanel: true, giftColumns: 2, giftPanelWidth: 1, giftIconSize: 42, giftNameSize: 16, giftTextSize: 16, scale: renderScale, petMotion: false, gifts, showSeconds: false, showNegative: true, zeroText: '时间到' }

const pageFile = path.join(output, 'time-widget.html')
await fs.writeFile(pageFile, renderTimePage(cfg, {}))

const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{for(const n of ['widget','compose']){const w=new BrowserWindow({width:400,height:400,show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false}});w.setTitle('pet compare '+n);w.loadURL('about:blank')}});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, '--force-device-scale-factor=1', '--allow-file-access-from-files'], cwd: root, env })
const page = await app.firstWindow()
while (app.windows().length < 2) await page.waitForTimeout(30)
const compose = app.windows().find((p) => p !== page)
const errors = []
for (const p of [page, compose]) p.on('pageerror', (e) => errors.push(e.message))

async function capture(p, file, w, h) {
  const win = await app.browserWindow(p)
  if (w && h) await win.evaluate((bw, s) => bw.setContentSize(s.w, s.h), { w, h })
  await win.evaluate((bw) => bw.webContents.invalidate())
  await p.waitForTimeout(150)
  const bytes = await win.evaluate(async (bw) => { const img = await bw.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); return [...img.toPNG()] })
  await fs.writeFile(file, Buffer.from(bytes))
}

// 渲染当前挂件（剩余 25:36 = 1536 秒）
const dims = widgetMetrics(cfg)
await (await app.browserWindow(page)).evaluate((bw, s) => bw.setContentSize(s.w, s.h), dims)
await page.goto(pathToFileURL(pageFile).href)
await page.evaluate(([c]) => { window.__setConfig(c, {}); window.__render({ remaining: 1536, zeroed: false, hidden: false }); document.body.style.background = 'transparent' }, [cfg])
await page.evaluate(() => document.fonts.ready)
await page.evaluate((c) => window.__setConfig(c, {}), cfg)
await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.gift-icon img')].map((im) => im.decode().catch(() => {}))) })
await page.waitForTimeout(80)
const currentPng = path.join(output, `${skinKey}-current.png`)
await capture(page, currentPng, dims.w, dims.h)
if(recordMotion){
  const motionDir=path.join(output,skinKey+'-motion')
  await fs.mkdir(motionDir,{recursive:true})
  await page.evaluate(c=>{window.__setConfig({...c,petMotion:true},{});document.body.style.background='#fbf8ef'},cfg)
  const frames=[]
  for(let time=0;time<4800;time+=100){
    await page.evaluate(t=>{for(const a of document.getAnimations()){a.pause();a.currentTime=t}},time)
    const file=path.join(motionDir,'frame-'+String(time/100).padStart(2,'0')+'.png')
    await capture(page,file,dims.w,dims.h);frames.push(path.basename(file))
  }
  await fs.writeFile(path.join(motionDir,'frames.json'),JSON.stringify({intervalMs:100,frames},null,2))
  console.log('MOTION CAPTURE: '+frames.length+' actual renderer frames')
}

// 拼「参考 | 当前」：各自裁出主体（参考去象牙白底、当前去绿底→换象牙白），等高并排
const H = 900
const composeHtml = path.join(output, 'compose.html')
await fs.writeFile(composeHtml, `<!doctype html><html><body style="margin:0;overflow:hidden;background:#fbf8ef"><canvas id="c"></canvas><script>
function load(s){return new Promise(function(r){var i=new Image();i.onload=function(){r(i)};i.src=s})}
function crop(im,isBg,recolor){var c=document.createElement('canvas');c.width=im.width;c.height=im.height;var g=c.getContext('2d');g.drawImage(im,0,0);var D=g.getImageData(0,0,c.width,c.height),d=D.data,x0=c.width,y0=c.height,x1=0,y1=0;for(var y=0;y<c.height;y++)for(var x=0;x<c.width;x++){var i=(y*c.width+x)*4;if(isBg(d[i],d[i+1],d[i+2],d[i+3])){if(recolor){d[i]=251;d[i+1]=248;d[i+2]=239;d[i+3]=255}}else{if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}if(recolor)g.putImageData(D,0,0);var o=document.createElement('canvas');var pad=6;o.width=x1-x0+1+pad*2;o.height=y1-y0+1+pad*2;var og=o.getContext('2d');og.fillStyle='#fbf8ef';og.fillRect(0,0,o.width,o.height);og.drawImage(c,x0,y0,x1-x0+1,y1-y0+1,pad,pad,x1-x0+1,y1-y0+1);return o}
Promise.all([load(${JSON.stringify(pathToFileURL(refPath).href)}),load(${JSON.stringify(pathToFileURL(currentPng).href)})]).then(function(a){
  var ref=crop(a[0],function(r,g,b,al){return al<10||(r>238&&g>234&&b>222&&Math.abs(r-g)<14)},false);
  var cur=crop(a[1],function(r,g,b,al){return al<10||(g>200&&r<90&&b<90)},true);
  window.comparisonMetrics={reference:{width:ref.width,height:ref.height,aspect:ref.width/ref.height},current:{width:cur.width,height:cur.height,aspect:cur.width/cur.height}};
  window.comparisonMetrics.aspectDifference=Math.abs(window.comparisonMetrics.current.aspect/window.comparisonMetrics.reference.aspect-1);
  var H=${H},gap=40,rw=Math.round(ref.width*H/ref.height),cw=Math.round(cur.width*H/cur.height);
  var c=document.getElementById('c');c.width=rw+cw+gap*3;c.height=H+70;var g=c.getContext('2d');g.fillStyle='#fbf8ef';g.fillRect(0,0,c.width,c.height);
  g.drawImage(ref,gap,50,rw,H);g.drawImage(cur,gap*2+rw,50,cw,H);
  g.fillStyle='#333';g.font='bold 26px Microsoft YaHei';g.fillText('参考 ${refFile}',gap,34);g.fillText('当前渲染（同内容）',gap*2+rw,34);
  document.title='ready:'+c.width+'x'+c.height;
});
</script></body></html>`)
await compose.goto(pathToFileURL(composeHtml).href)
await compose.waitForFunction(() => document.title.startsWith('ready:'), { timeout: 15000 })
const [cw, ch] = (await compose.title()).slice(6).split('x').map(Number)
const comparePng = path.join(output, `${skinKey}-compare.png`)
await capture(compose, comparePng, cw, ch)
const metrics=await compose.evaluate(()=>window.comparisonMetrics)
await fs.writeFile(path.join(output,`${skinKey}-metrics.json`),JSON.stringify({themeId,dimensions:dims,...metrics},null,2))

const noFocus = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused()))
await app.close()
console.log(`当前渲染：${currentPng}（挂件 ${dims.w}×${dims.h}）`)
console.log(`对比图：${comparePng}`)
console.log(`参考/当前宽高比：${metrics.reference.aspect.toFixed(4)} / ${metrics.current.aspect.toFixed(4)}（相差 ${(metrics.aspectDifference*100).toFixed(2)}%）`)
console.log(`不抢前台：${noFocus ? '是' : '否'}`)
if (errors.length) { console.log('页面错误：'); for (const e of errors) console.log('  ' + e) }
