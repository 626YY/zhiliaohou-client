import { app, BrowserWindow, dialog, globalShortcut } from 'electron'
import { giftNamesEqual } from '@shared/giftName'
import { OUTPUT_CHROMA_GREEN, outputsAlwaysOnTop, registerOutputWindow, createCaptureOutputWindow, onOutputWindowClosed, onOutputPageEvent } from './output-window'
import { captureTitle, assetUrl } from './capture-output'
import fs from 'fs'
import path from 'path'
import type { AdvancedWheelConfig, AdvancedWheelOption } from '@shared/types'
import { runScript } from './entertainment'

const COLORS = [
  '#E74C3C', '#E67E22', '#F1C40F', '#2ECC71',
  '#1ABC9C', '#3498DB', '#9B59B6', '#E91E63',
  '#00BCD4', '#8BC34A', '#FF5722', '#607D8B',
  '#795548', '#CDDC39', '#FF9800', '#673AB7'
]

let oneWin: BrowserWindow | null = null
let twoWin: BrowserWindow | null = null
const activeConfigs = new Map<1 | 2, AdvancedWheelConfig>()
const registeredShortcuts = new Map<1 | 2, string>()

function pathToSrc(value: string): string {
  if (!value) return ''
  if (/^(https?:|data:)/i.test(value)) return value
  return 'file:///' + value.replace(/\\/g, '/')
}

function optionAt(value: Partial<AdvancedWheelOption> | undefined, index: number): AdvancedWheelOption {
  const num = (input: unknown, fallback: number, min: number, max: number) => {
    const n = Number(input)
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
  }
  return {
    text: String(value?.text || `选项${index + 1}`),
    bgColor: String(value?.bgColor || COLORS[index]),
    textColor: String(value?.textColor || '#FFFFFF'),
    bgImage: String(value?.bgImage || ''),
    bgImageScale: num(value?.bgImageScale, 1, 0.1, 2),
    bgImageOffsetX: num(value?.bgImageOffsetX, 0, -260, 260),
    bgImageOffsetY: num(value?.bgImageOffsetY, 0, -260, 260),
    weight: num(value?.weight, 1, 0, 100000),
    sound: String(value?.sound || ''),
    scriptCategory: String(value?.scriptCategory || ''),
    script: String(value?.script || '')
  }
}

function normalizeConfig(input: Partial<AdvancedWheelConfig>): AdvancedWheelConfig {
  const source: 1 | 2 = input?.source === 2 ? 2 : 1
  const requestedCount = Number(input?.sectorCount)
  const sectorCount: 10 | 12 | 14 | 16 =
    requestedCount === 10 || requestedCount === 14 || requestedCount === 16 ? requestedCount : 12
  const sourceOptions = Array.isArray(input?.options) ? input.options : []
  return {
    source,
    sectorCount,
    options: Array.from({ length: 16 }, (_, index) => optionAt(sourceOptions[index], index)),
    centerImage: String(input?.centerImage || ''),
    centerScale: Math.max(0.3, Math.min(3, Number(input?.centerScale) || 1)),
    spinSound: String(input?.spinSound || ''),
    triggerGift: String(input?.triggerGift || ''),
    hotkey: String(input?.hotkey || ''),
    idleHide: input?.idleHide !== false,
    holdSeconds: Number.isFinite(Number(input?.holdSeconds)) ? Math.max(0, Math.min(120, Number(input?.holdSeconds))) : 6,
    builtinSound: input?.builtinSound !== false
  }
}

function pageConfig(config: AdvancedWheelConfig): AdvancedWheelConfig {
  return {
    ...config,
    centerImage: pathToSrc(config.centerImage),
    spinSound: pathToSrc(config.spinSound),
    options: config.options.map((option) => ({
      ...option,
      bgImage: pathToSrc(option.bgImage),
      sound: pathToSrc(option.sound)
    }))
  }
}

function configJson(config: AdvancedWheelConfig): string {
  return JSON.stringify(pageConfig(config)).replace(/</g, '\\u003c')
}

function releaseShortcut(source: 1 | 2): void {
  const previous = registeredShortcuts.get(source)
  if (previous) globalShortcut.unregister(previous)
  registeredShortcuts.delete(source)
}

function registerShortcut(config: AdvancedWheelConfig): string | undefined {
  releaseShortcut(config.source)
  const accelerator = config.hotkey.trim()
  if (!accelerator) return undefined
  try {
    if (!globalShortcut.register(accelerator, () => { void spinAdvancedWheel(config.source) })) {
      return `热键 ${accelerator} 已被系统或另一实例占用`
    }
    registeredShortcuts.set(config.source, accelerator)
  } catch {
    return `热键格式无效：${accelerator}`
  }
  return undefined
}

const page = (config: AdvancedWheelConfig) => `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>高级转盘${config.source}</title><style>
* { box-sizing:border-box; }
html,body { width:100%; height:100%; margin:0; overflow:hidden; background:#00FF00; font-family:"Microsoft YaHei",sans-serif; }
.wheel-container { position:relative; width:600px; height:600px; margin:40px; display:flex; align-items:center; justify-content:center; }
.wheel-outer { position:absolute; width:592px; height:592px; border-radius:50%; background:linear-gradient(135deg,#FF4444,#CC0000,#FF2222,#CC0000); padding:14px; box-shadow:0 0 30px rgba(255,215,0,.6),inset 0 0 20px rgba(0,0,0,.3); }
.outer-dot { position:absolute; width:12px; height:12px; border-radius:50%; background:rgba(255,255,200,.85); box-shadow:0 0 4px rgba(255,255,150,.6); animation:blink 1s infinite; }
@keyframes blink { 0%,100% { opacity:1; } 50% { opacity:.25; } }
/* 跑马灯：转起来时亮点顺着盘跑（盘减速灯也跟着慢），抽中后整圈齐闪几下。 */
.spin .outer-dot { animation:none; opacity:.22; transform:scale(.9); box-shadow:none; }
.spin .outer-dot.trail { opacity:.7; transform:scale(1.3); box-shadow:0 0 8px 1px #ffd873; }
.spin .outer-dot.lit { opacity:1; transform:scale(1.75); box-shadow:0 0 13px 3px #ffe07a; }
.cheer .outer-dot { animation:cheer .24s steps(1,end) 6; }
.cheer .outer-dot:nth-child(even) { animation-delay:.12s; }
@keyframes cheer { 0%,49% { opacity:1; transform:scale(1.65); box-shadow:0 0 15px 4px #ffe07a; } 50%,100% { opacity:.18; transform:scale(.9); box-shadow:none; } }
canvas { position:absolute; width:536px; height:536px; border-radius:50%; }
.center-area { position:absolute; width:220px; height:220px; border-radius:50%; z-index:20; overflow:hidden; display:flex; align-items:center; justify-content:center; cursor:pointer; background:radial-gradient(circle,#2a2035,#14101c); border:4px solid rgba(255,215,0,.7); box-shadow:0 0 18px rgba(0,0,0,.55); transition:transform .12s; }
.center-area img { width:100%; height:100%; object-fit:cover; border-radius:50%; }
.center-placeholder { color:#FFD700; font-size:26px; font-weight:900; letter-spacing:4px; text-shadow:0 2px 8px rgba(0,0,0,.8); }
.pointer { position:absolute; right:-14px; top:50%; transform:translateY(-50%); width:0; height:0; border-top:20px solid transparent; border-bottom:20px solid transparent; border-right:40px solid #FF0000; filter:drop-shadow(-3px 0 6px rgba(0,0,0,.5)); z-index:100; }
.pointer::after { content:""; position:absolute; right:-44px; top:-12px; border-top:12px solid transparent; border-bottom:12px solid transparent; border-right:22px solid #FFFF00; }
/* 空闲时整盘藏起来，窗口只剩绿底，抠像后直播画面里干干净净。 */
.wheel-container.idle > * { visibility:hidden; }
#result { position:absolute; left:50%; bottom:-28px; transform:translateX(-50%); z-index:200; display:none; max-width:560px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#FFD700; font-size:30px; font-weight:bold; text-shadow:0 0 8px rgba(0,0,0,.9); background:rgba(0,0,0,.55); border:2px solid rgba(255,215,0,.6); border-radius:12px; padding:8px 26px; }
</style></head>
<body><div class="wheel-container"><div class="wheel-outer" id="outer"></div><canvas id="wheel" width="536" height="536"></canvas><div class="center-area" id="center"></div><div class="pointer"></div><div id="result"></div></div>
<script>
var cfg = ${configJson(config)};
// 转盘实录音效（真转盘转动声与中奖声，尾巴的人声播报已去掉）
var PRESET = { spin: ${JSON.stringify(assetUrl('wheel-spin.mp3'))}, win: ${JSON.stringify(assetUrl('wheel-win.mp3'))} };
var canvas = document.getElementById('wheel');
var ctx = canvas.getContext('2d');
var R = canvas.width / 2;
var rotation = 0;
var spinning = false;
var options = [];
var images = [];
var audio = null;
var TAU = Math.PI * 2;

(function () { var outer=document.getElementById('outer'); for (var i=0;i<16;i++) { var a=(i/16)*TAU; var dot=document.createElement('div'); dot.className='outer-dot'; dot.style.left=(296+Math.cos(a)*282-6)+'px'; dot.style.top=(296+Math.sin(a)*282-6)+'px'; dot.style.animationDelay=(i%2 ? '.5s' : '0s'); outer.appendChild(dot); } })();
var dots=[].slice.call(document.querySelectorAll('.outer-dot')), cheerTimer=0;
// 灯的位置直接从盘的转角推：盘转得快灯就跑得快，盘停灯也停。乘 2 = 灯绕的圈数是盘的两倍，更像真抽奖机。
function paintBulbs(rot) { var n=dots.length; if(!n) return; var head=((Math.round(rot/TAU*n)%n)+n)%n, step=Math.max(1,Math.round(n/3));
  for (var i=0;i<n;i++) { var level=0;
    for (var k=0;k<3;k++) { var back=((head+k*step-i)%n+n)%n; if(back===0){ level=2; break; } if(back===1&&level<1) level=1; }
    dots[i].classList.toggle('lit',level===2); dots[i].classList.toggle('trail',level===1); } }
function clearBulbs() { for (var i=0;i<dots.length;i++) dots[i].classList.remove('lit','trail'); }
function imageFor(src) { if (!src) return null; var image=new Image(); image.onload=function(){ draw(rotation); }; image.src=src; return image; }
// 没配音效文件也有声：转动时每过一个扇区「哒」一下，抽中三连上扬音。
var audioCtx=null, lastSector=null, idleTimer=0;
function ac(){ try { if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); return audioCtx; } catch(_) { return null; } }
// 转动声：指针拨过挡片的「嗒」，噪声过带通，比蜂鸣器耐听
function noiseBurst(center,dur,gain){ var c=ac(); if(!c) return; var n=Math.max(1,Math.floor(c.sampleRate*dur)),buf=c.createBuffer(1,n,c.sampleRate),data=buf.getChannelData(0);
  for (var i=0;i<n;i++){ var fade=1-i/n; data[i]=(Math.random()*2-1)*fade*fade; }
  var src=c.createBufferSource(); src.buffer=buf;
  var bp=c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=center; bp.Q.value=6;
  var g=c.createGain(); g.gain.value=gain; src.connect(bp); bp.connect(g); g.connect(c.destination); src.start(); }
// 中奖声：颁奖钟琴琶音
function chime(freq,delay,dur,gain){ var c=ac(); if(!c) return; var t=c.currentTime+delay;
  [[1,gain],[2,gain*.35],[3,gain*.12]].forEach(function(pair){ var o=c.createOscillator(),g=c.createGain();
    o.type='sine'; o.frequency.setValueAtTime(freq*pair[0],t);
    g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(.0002,pair[1]),t+.012); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+dur+.05); }); }
var presetSpin=null;
function startPreset(){ if(cfg.builtinSound===false||cfg.spinSound||!PRESET.spin) return; try { stopPreset(); presetSpin=new Audio(PRESET.spin); presetSpin.loop=true; presetSpin.play().catch(function(){}); } catch(_) {} }
function stopPreset(){ if(presetSpin){ try { presetSpin.pause(); } catch(_) {} presetSpin=null; } }
// 实录转动音在放就不叠哒哒声；没有实录素材才退回合成音
function tickSound(){ if(cfg.builtinSound===false||cfg.spinSound||PRESET.spin) return; noiseBurst(1800,.035,.35); noiseBurst(320,.05,.12); }
function winSound(picked){ stopPreset(); if(picked&&picked.sound) { play(picked.sound); return; } if(cfg.builtinSound===false) return; if(PRESET.win) { play(PRESET.win); return; } [[523.25,0,.9],[659.25,.09,.9],[783.99,.18,1],[1046.5,.27,1.6]].forEach(function(pair){ chime(pair[0],pair[1],pair[2],.12); }); }
function setIdle(on){ var box=document.querySelector('.wheel-container'); box.classList.toggle('idle', on && cfg.idleHide!==false); }
function play(src) { if (!src) return; try { var a=new Audio(src); a.play().catch(function(){}); } catch (_) {} }
function draw(rot) {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  var count=options.length || 1, arc=TAU/count;
  for (var i=0;i<count;i++) { var opt=options[i] || {}, start=rot+i*arc;
    ctx.beginPath(); ctx.moveTo(R,R); ctx.arc(R,R,R-2,start,start+arc); ctx.closePath(); ctx.fillStyle=opt.bgColor || '#666'; ctx.fill(); ctx.strokeStyle='rgba(200,0,0,.55)'; ctx.lineWidth=2; ctx.stroke();
    ctx.save(); ctx.translate(R,R); ctx.rotate(start+arc/2); var image=images[i];
    if (image && image.complete && image.naturalWidth>0) { var size=48*Math.max(.1,Math.min(2,Number(opt.bgImageScale)||1)); var ox=Number(opt.bgImageOffsetX)||0, oy=Number(opt.bgImageOffsetY)||0; ctx.drawImage(image,R*.72-size/2+ox,-size/2+oy,size,size); }
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=opt.textColor || '#FFFFFF'; ctx.font='bold 18px "Microsoft YaHei"'; ctx.shadowColor='rgba(0,0,0,.7)'; ctx.shadowBlur=3; ctx.fillText(opt.text || ('选项'+(i+1)),R*.48,0); ctx.restore();
  }
}
function weightedIndex() { var total=options.reduce(function(sum,opt){ return sum+Math.max(0,Number(opt.weight)||0); },0); if (total<=0) return Math.floor(Math.random()*options.length); var random=Math.random()*total; for (var i=0;i<options.length;i++) { random-=Math.max(0,Number(options[i].weight)||0); if (random<0) return i; } return options.length-1; }
function setConfig(next) { cfg=next || cfg; var count=[10,12,14,16].indexOf(Number(cfg.sectorCount))>=0 ? Number(cfg.sectorCount) : 12; options=Array.isArray(cfg.options) ? cfg.options.slice(0,count) : []; while (options.length<count) options.push({text:'选项'+(options.length+1),bgColor:'#666',textColor:'#FFFFFF',weight:1}); images=options.map(function(opt){ return imageFor(opt.bgImage); }); var center=document.getElementById('center'); center.innerHTML=cfg.centerImage ? '<img src="'+cfg.centerImage.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'" alt="">' : '<span class="center-placeholder">开始</span>'; center.style.transform='scale('+Math.max(.3,Math.min(3,Number(cfg.centerScale)||1))+')'; draw(rotation); }
function spin() { if (spinning || !options.length) return Promise.resolve(-1); spinning=true; document.getElementById('result').style.display='none'; play(cfg.spinSound); var container=document.querySelector('.wheel-container'); clearTimeout(cheerTimer); clearTimeout(idleTimer); setIdle(false); lastSector=null; startPreset(); container.classList.remove('cheer'); container.classList.add('spin'); var index=weightedIndex(), arc=TAU/options.length, desired=-(index+.5)*arc, from=rotation, delta=((desired-from)%TAU+TAU)%TAU, to=from+TAU*6+delta, began=performance.now(); return new Promise(function(resolve){ function tick(now){ var t=Math.min(1,(now-began)/5200), ease=1-Math.pow(1-t,3); rotation=from+(to-from)*ease; draw(rotation); paintBulbs(rotation); var sector=Math.floor(rotation/arc); if(sector!==lastSector){ if(lastSector!==null) tickSound(); lastSector=sector; } if(t<1) requestAnimationFrame(tick); else { spinning=false; container.classList.remove('spin'); clearBulbs(); container.classList.add('cheer'); cheerTimer=setTimeout(function(){ container.classList.remove('cheer'); },1500); var picked=options[index] || {}; winSound(picked); idleTimer=setTimeout(function(){ setIdle(true); }, Math.max(0,Number(cfg.holdSeconds)>=0?Number(cfg.holdSeconds):6)*1000); var result=document.getElementById('result'); result.textContent='恭喜抽中：'+(picked.text || ''); result.style.display='block'; console.log('ADVANCED_WHEEL_RESULT:'+JSON.stringify({source:cfg.source,index:index,script:picked.script || ''})); resolve(index); } } requestAnimationFrame(tick); }); }
document.getElementById('center').addEventListener('click',function(){ spin(); });
window.__spin=spin; window.__setConfig=function(next){ setConfig(next); if(!spinning) setIdle(true); }; setConfig(cfg); setIdle(true);
</script></body></html>`

function ref(source: 1 | 2): BrowserWindow | null {
  return source === 1 ? oneWin : twoWin
}

function assign(source: 1 | 2, win: BrowserWindow | null): void {
  if (source === 1) oneWin = win
  else twoWin = win
}

export function openAdvancedWheel(config: AdvancedWheelConfig): { ok: boolean; error?: string } {
  try {
    const normalized = normalizeConfig(config)
    ref(normalized.source)?.close()
    const shortcutError = registerShortcut(normalized)
    activeConfigs.set(normalized.source, normalized)
    const file = path.join(app.getPath('userData'), `advanced-wheel-${normalized.source}.html`)
    fs.writeFileSync(file, page(normalized), 'utf8')
    const win = createCaptureOutputWindow({
      width: 680,
      height: 720,
      title: `高级转盘${normalized.source}`,
      backgroundColor: OUTPUT_CHROMA_GREEN,
      frame: false,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: true,
      skipTaskbar: true,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, `高级转盘${normalized.source}`)
    win.loadFile(file)
    registerOutputWindow(win)
    onOutputPageEvent(win, 'console-message', (_event, _level, message) => {
      if (!message.startsWith('ADVANCED_WHEEL_RESULT:')) return
      try {
        const result = JSON.parse(message.slice('ADVANCED_WHEEL_RESULT:'.length)) as {
          source?: number
          index?: number
          script?: string
        }
        if ((result.source === 1 || result.source === 2) && Number.isInteger(result.index)) {
          const current = activeConfigs.get(result.source)
          const script = current?.options[result.index!]?.script || result.script || ''
          if (script) runScript(script)
        }
      } catch {
        // The widget remains usable even if a page log is malformed.
      }
    })
    onOutputWindowClosed(win, () => {
      if (ref(normalized.source) === win) {
        assign(normalized.source, null)
        releaseShortcut(normalized.source)
      }
    })
    assign(normalized.source, win)
    return { ok: true, error: shortcutError }
  } catch (error) {
    return { ok: false, error: '打开高级转盘失败：' + (error as Error).message }
  }
}

export function closeAdvancedWheel(source: 1 | 2): { ok: boolean } {
  try {
    ref(source)?.close()
  } catch {
    // ignore
  }
  releaseShortcut(source)
  assign(source, null)
  return { ok: true }
}

export async function spinAdvancedWheel(source: 1 | 2): Promise<{ ok: boolean; result?: number }> {
  const win = ref(source)
  if (!win || win.isDestroyed()) return { ok: false }
  try {
    const result = await win.webContents.executeJavaScript('window.__spin ? window.__spin() : -1')
    return Number.isInteger(result) && result >= 0 ? { ok: true, result } : { ok: false }
  } catch {
    return { ok: false }
  }
}

export async function updateAdvancedWheel(config: AdvancedWheelConfig): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeConfig(config)
  activeConfigs.set(normalized.source, normalized)
  const win = ref(normalized.source)
  if (!win || win.isDestroyed()) return { ok: true }
  const shortcutError = registerShortcut(normalized)
  try {
    await win.webContents.executeJavaScript(`window.__setConfig && window.__setConfig(${configJson(normalized)})`)
  } catch {
    return { ok: false }
  }
  return { ok: true, error: shortcutError }
}

export async function exportAdvancedWheelConfig(
  config: Partial<AdvancedWheelConfig>
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const normalized = normalizeConfig(config)
    const { source: _source, ...compatibleConfig } = normalized
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow()!, {
      title: '保存高级转盘配置',
      defaultPath: `高级转盘${normalized.source}-config.json`,
      filters: [{ name: '高级转盘配置', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '已取消' }
    fs.writeFileSync(
      result.filePath,
      JSON.stringify({ version: 1, ...compatibleConfig }, null, 2),
      'utf8'
    )
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: '保存配置失败：' + (error as Error).message }
  }
}

export async function importAdvancedWheelConfig(
  source: 1 | 2
): Promise<{ ok: boolean; config?: AdvancedWheelConfig; error?: string }> {
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      title: '导入高级转盘配置',
      filters: [{ name: '高级转盘配置', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: '已取消' }
    const content = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) as Partial<AdvancedWheelConfig>
    return { ok: true, config: normalizeConfig({ ...content, source }) }
  } catch (error) {
    return { ok: false, error: '导入配置失败：' + (error as Error).message }
  }
}

export function handleAdvancedWheelGift(giftName: string): void {
  const name = giftName.trim()
  if (!name) return
  for (const source of [1, 2] as const) {
    const config = activeConfigs.get(source)
    if (config?.triggerGift && giftNamesEqual(config.triggerGift, name)) void spinAdvancedWheel(source)
  }
}

export function advancedWheelState(): { one: boolean; two: boolean } {
  return {
    one: !!oneWin && !oneWin.isDestroyed(),
    two: !!twoWin && !twoWin.isDestroyed()
  }
}

app.on('before-quit', () => {
  closeAdvancedWheel(1)
  closeAdvancedWheel(2)
})
