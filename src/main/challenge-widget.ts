import { WIDGET_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
import { captureTitle } from './capture-output'
import { onScreenPosition } from './window-bounds'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, onOutputWindowEvent, onceOutputPageEvent } from './output-window'
// 计数挑战插件挂件（复刻参考软件 extracted_h5\25_计数挑战模块.html 面板）
// 320×300、rgba(0,0,0,0.7)、12px 圆角、标题24px、数字48px、礼物48px图、3.5s 轮转、缩放动画、锁图标
import { BrowserWindow, app, globalShortcut } from 'electron'
import fs from 'fs'
import path from 'path'
import type { CountChallengeConfig, CountChallengeGift } from '@shared/types'
import { GIFT_ICON_URLS } from '../shared/giftIcons'
import { giftNamesEqual } from './connector-events'
import { COUNTDOWN_ART } from '../shared/countdownArt'
import { announce } from './announce'
import { spokenDuration } from '../shared/announce'

// 原版「计数挑战」(插件配置计数) 和「加班器」(插件配置加班) 是两个独立插件，能同时挂在屏幕上。
// 老实现共用一个 win：开加班器就把计数挑战顶掉，而且两边数值走同一个挂件互相打架。
export type ChallengeSlot = 'challenge' | 'overtime'
interface ChallengeInstance {
  win: BrowserWindow
  cfg: CountChallengeConfig
  accels: string[]
}
const instances = new Map<ChallengeSlot, ChallengeInstance>()

function slotOf(cfg?: { slot?: string } | null): ChallengeSlot {
  return cfg?.slot === 'overtime' ? 'overtime' : 'challenge'
}
function live(slot: ChallengeSlot): ChallengeInstance | null {
  const inst = instances.get(slot)
  if (!inst || inst.win.isDestroyed()) {
    if (inst) instances.delete(slot)
    return null
  }
  return inst
}
function eachLive(fn: (inst: ChallengeInstance, slot: ChallengeSlot) => void): void {
  for (const slot of [...instances.keys()]) {
    const inst = live(slot)
    if (inst) fn(inst, slot)
  }
}
// 没指定槽位的旧调用（动作命令 计数加减 等）落到当前开着的那个：优先计数挑战。
function defaultSlot(): ChallengeSlot | null {
  if (live('challenge')) return 'challenge'
  if (live('overtime')) return 'overtime'
  return null
}
/**
 * 「计时加减」和「加班加减」原来都不带槽位，双双落到 defaultSlot()（优先计数挑战），
 * 于是两个挂件同时开着时，「加班加减」实际改的是计数挑战 —— 名字不同却做同一件事。
 * 这里优先用本组自己的槽位；那个没开就退回开着的那个（保住「只开一个也能用」的老行为）。
 */
export function preferSlot(want: ChallengeSlot): ChallengeSlot | undefined {
  if (live(want)) return want
  return defaultSlot() ?? undefined
}
function runIn(slot: ChallengeSlot | null | undefined, js: string): { ok: boolean } {
  const target = slot ? live(slot) : (defaultSlot() ? live(defaultSlot() as ChallengeSlot) : null)
  if (!target) return { ok: false }
  try {
    void target.win.webContents.executeJavaScript(js).catch(() => {})
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
// 原版 25_计数挑战模块.html 的两个默认礼物图（:224 小心心、:242 玫瑰）。
// 只按礼物名兜底，绝不拿其中一张去冒充所有没图的礼物（用户明确反对错图顶替）。
const DEFAULT_GIFT_IMG: Record<string, string> = {
  小心心: 'https://p3-webcast.douyinpic.com/img/webcast/7ef47758a435313180e6b78b056dda4e.png~tplv-obj.png',
  玫瑰: 'https://p3-webcast.douyinpic.com/img/webcast/96e9bc977d926732e37351fae827813.png~tplv-obj.png'
}

const esc = (s: string) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const toSrc = (p: string) => {
  if (!p) return ''
  if (/^(?:https?:|file:|data:)/i.test(p)) return p
  return 'file:///' + p.replace(/\\/g, '/')
}
function hexToRgb(hex: string): string {
  let h = String(hex || '').replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6) || '000000', 16)
  if (Number.isNaN(n)) return '0,0,0'
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

// 原版颜色表（逆向 0x475830，8 色，顺序即下拉顺序）：
// 白色 / 天蓝 / 橙黄 / 黄色 / 红色 / 绿色 / 黑色 / 蓝色
export const CHALLENGE_COLOR_NAMES = ['白色', '天蓝', '橙黄', '黄色', '红色', '绿色', '黑色', '蓝色']
const COLORS = ['#ffffff', '#87ceeb', '#ffa500', '#ffff00', '#ff0000', '#00ff00', '#000000', '#0000ff']

const PANEL_CSS = `
html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:transparent; font-family:Arial, sans-serif; }
.jishu-wrapper { position:absolute; cursor:grab; user-select:none; -webkit-user-select:none; }
.jishu-wrapper.dragging { cursor:grabbing; }
.main-container { width:320px; height:300px; padding:10px; background-color:rgba(0,0,0,0.7); border-radius:12px; }
.item { margin-bottom:0; padding:6px; background-color:transparent; }
.item.text-item { text-align:center; display:flex; align-items:center; justify-content:center; }
.item-one { height:50px; font-size:24px; font-weight:bold; color:white; text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000; }
.item-two { height:58px; font-size:48px; font-weight:bold; color:white; text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000; display:flex; align-items:center; justify-content:center; position:relative; }
@keyframes jishu-scale { 0% { transform:scale(1.3); opacity:0.7; } 100% { transform:scale(1); opacity:1; } }
.scale-animation { animation: jishu-scale 0.3s ease-out forwards; }
.item-two .icon { width:18px; height:18px; position:absolute; right:8px; top:6px; z-index:1; }
.item-pause { height:36px; font-size:28px; font-weight:bold; color:white; text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000; text-align:center; display:flex; align-items:center; justify-content:center; }
.item-three { height:30px; font-size:20px; font-weight:bold; color:white; text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000; }
.item-four { height:66px; display:flex; gap:10px; }
.left-column, .right-column { flex:1; display:flex; align-items:center; padding:5px; background-color:transparent; min-width:0; }
.image-container { width:48px; height:48px; margin-right:8px; overflow:hidden; flex-shrink:0; background-color:transparent; }
.item-image { width:48px; height:48px; object-fit:cover; display:block; background-color:transparent; }
.text-label { flex:1; min-width:0; background-color:transparent; text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000; }
.upper-text, .lower-text { display:block; margin:0 0 2px 0; font-size:15px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background-color:transparent; }
.upper-text { font-weight:bold; color:GIFTNAMECOLOR; }
.lower-text { font-weight:bold; font-size:15px; color:DELTACOLOR; }
.divider { height:1px; background-color:#ddd; }
`

const LOCK_SVG = `<svg id="itemTwoIcon" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path d="M0 0h1024v1024H0V0z" fill="#202425" opacity=".01"></path><path d="M187.733333 341.333333a324.266667 324.266667 0 1 1 648.533334 0v68.266667a324.266667 324.266667 0 0 1-648.533334 0v-68.266667zM512 119.466667A221.866667 221.866667 0 0 0 290.133333 341.333333v68.266667A221.866667 221.866667 0 1 0 443.733334 0v-68.266667A221.866667 221.866667 0 0 0 512 119.466667z" fill="#FFAA44"></path><path d="M102.4 512a136.533333 136.533333 0 0 1 136.533333-136.533333h546.133334a136.533333 136.533333 0 0 1 136.533333 136.533333v341.333333a136.533333 136.533333 0 0 1-136.533333 136.533334H238.933333a136.533333 136.533333 0 0 1-136.533333-136.533334V512z" fill="#FF7744"></path><path d="M512 563.2a51.2 51.2 0 0 1 51.2 51.2v136.533333a51.2 51.2 0 0 1-102.4 0v-136.533333a51.2 51.2 0 0 1 51.2-51.2z" fill="#FFFFFF"></path></svg>`

interface ChallengeRuntimeConfig {
  timer: boolean
  clockOn: boolean
  speed: number
  showNegative: boolean
  showSeconds: boolean
  giftVisible: boolean
  pauseText: string
  showRecord: boolean
  zeroText: string
  zeroHide: boolean
  gifts: { img: string; upper: string; lower: string }[]
  title: string
  third: string
  titleColor: string
  numColor: string
  giftNameColor: string
  deltaColor: string
  bg: string
  showLock: boolean
  mouseEnabled: boolean
  mouseValue: number
  autoAdjust: boolean
  autoSpeed: number
  autoValue: number
  skin: string
  styleImg: string
}

// 挑战样式（组合框_计数挑战样式 / 组合框_加班挑战样式）：选了就换整块面板底图，
// 老实现只认「透明背景」一项，另外三项选了毫无反应。
const STYLE_ART: Record<string, string> = {
  蓝黑梯形: COUNTDOWN_ART.mode1_cyan,
  橙色梯形: COUNTDOWN_ART.mode1_orange,
  粉色萌仔: COUNTDOWN_ART.mode2_frame
}

function runtimeConfig(cfg: CountChallengeConfig, localImgs: Record<string, string>): ChallengeRuntimeConfig {
  const mode = cfg.mode === 'counter' ? 'counter' : 'timer'
  const styleImg = STYLE_ART[String(cfg.style || '')] || ''
  // 有底图时面板底色让位给底图（底图自带造型），没有才用纯色/透明。
  const bg = styleImg
    ? 'transparent'
    : cfg.bgTransparent ? 'transparent' : `rgba(${hexToRgb(cfg.bgColor || '#000000')},${Math.max(0, Math.min(1, cfg.bgAlpha ?? 0.7))})`
  const speed = Math.max(50, Number(cfg.clockSpeed) || 1000)
  const pick = (idx: number | undefined) =>
    COLORS[Number(idx ?? cfg.countColor) || 0] || COLORS[Number(cfg.countColor) || 0] || '#ffffff'
  const color = pick(cfg.titleColor) // 标题/第三行（组合框_计数_文字颜色）
  const numColor = pick(cfg.numColor) // 大数字
  const giftNameColor = pick(cfg.giftNameColor)
  const deltaColor = pick(cfg.deltaColor)
  const gifts: CountChallengeGift[] = Array.isArray(cfg.gifts) ? cfg.gifts.slice(0, 6) : []
  const giftCount = [2, 4, 6].includes(Number(cfg.giftCount)) ? Number(cfg.giftCount) : 2
  const pool = gifts.slice(0, giftCount)
  while (pool.length < 2) pool.push({ name: '', delta: '', img: '' })
  // 两种原版配置共用同一个 H5：计时显示自定义文字/秒数，计数显示礼物数字。
  const lowerOf = (g: CountChallengeGift) => {
    if (mode === 'counter') return g.delta || ''
    if (g.text && g.text.trim()) return g.text.trim()
    if (g.before != null || g.after != null) {
      const op = g.op === '加' || g.op === '减' ? '加减' : g.op || '加减'
      return `${op} ${Number(g.before) || 0}~${Number(g.after) || 0}`
    }
    return g.delta || ''
  }
  // 礼物图优先级：显式选图 → 连接器已下载的本地图 → 内置图源 → 原版默认图（仅小心心/玫瑰按名匹配）。
  // 都没有就留空，不拿别的礼物图顶替。
  const giftJson = pool.map((g) => {
    let src = g.img ? toSrc(g.img) : ''
    if (!src && g.name && localImgs[g.name]) src = toSrc(localImgs[g.name])
    if (!src && g.name && GIFT_ICON_URLS[g.name]) src = GIFT_ICON_URLS[g.name]
    if (!src && g.name && DEFAULT_GIFT_IMG[g.name]) src = DEFAULT_GIFT_IMG[g.name]
    return { img: src, upper: g.name || '', lower: lowerOf(g) }
  })
  return {
    timer: mode === 'timer',
    clockOn: cfg.clockOn !== false,
    speed,
    showNegative: !!cfg.showNegative,
    showSeconds: !!cfg.showSeconds,
    giftVisible: cfg.giftShow !== false,
    pauseText: String(cfg.pauseText || ''),
    showRecord: !!cfg.showRecord,
    zeroText: String(cfg.zeroText || ''),
    zeroHide: !!cfg.zeroHide,
    gifts: giftJson,
    title: String(cfg.title || ''),
    third: String(cfg.third || ''),
    titleColor: color,
    numColor,
    giftNameColor,
    deltaColor,
    bg,
    showLock: cfg.showLock !== false,
    mouseEnabled: !!cfg.mouseEnabled,
    mouseValue: Number(cfg.mouseValue) || 0,
    autoAdjust: mode === 'counter' && !!cfg.autoAdjust,
    autoSpeed: 1000 / Math.max(1, Math.min(10, Number(cfg.autoSpeed) || 1)),
    autoValue: mode === 'counter' ? Number(cfg.autoValue) || 0 : 0,
    skin: normalizeWidgetSkin(cfg.style),
    styleImg
  }
}

function page(cfg: CountChallengeConfig, localImgs: Record<string, string>) {
  const runtime = runtimeConfig(cfg, localImgs)
  const initial = Number(cfg.initial) || 0
  const css = PANEL_CSS.replace('GIFTNAMECOLOR', runtime.giftNameColor).replace('DELTACOLOR', runtime.deltaColor)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}
${WIDGET_SKIN_CSS}

body[data-widget-skin]:not([data-widget-skin="classic"]) #main {background:var(--ws-bg)!important;border:1px solid var(--ws-line);border-top:4px solid var(--ws-accent);border-radius:var(--ws-radius);box-sizing:content-box}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(#text1,#text2,#text3,#textPause,.upper-text,.lower-text) {text-shadow:none!important;color:var(--ws-text)!important}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(#text1,.lower-text) {color:var(--ws-accent)!important}
body[data-widget-skin]:not([data-widget-skin="classic"]) .item-one {border-bottom:1px solid var(--ws-line)}
</style></head>
<body>
<div class="jishu-wrapper" id="wrapper" style="left:0;top:0">
  <div class="main-container skin-motion-panel" id="main" style="background-color:${runtime.bg}${runtime.styleImg ? `;background-image:url('${runtime.styleImg}');background-size:100% 100%;background-repeat:no-repeat` : ''}">
    <div class="item text-item item-one"><span id="text1" style="color:${runtime.titleColor}">${esc(runtime.title)}</span></div>
    <div class="item text-item item-two"><span id="text2" style="color:${runtime.numColor}">00:00</span>${LOCK_SVG}</div>
    <div class="item text-item item-pause"><span id="textPause"></span></div>
    <div class="item item-four" id="giftModule">
      <div class="left-column"><div class="image-container"><img id="img1" class="item-image" src="${runtime.gifts[0].img || 'about:blank'}"></div><div class="text-label"><span class="upper-text" id="upper1"></span><div class="divider"></div><span class="lower-text" id="lower1"></span></div></div>
      <div class="right-column"><div class="image-container"><img id="img2" class="item-image" src="${runtime.gifts[1].img || 'about:blank'}"></div><div class="text-label"><span class="upper-text" id="upper2"></span><div class="divider"></div><span class="lower-text" id="lower2"></span></div></div>
    </div>
    <div class="item text-item item-three"><span id="text3" style="color:${runtime.titleColor}">${esc(runtime.third)}</span></div>
  </div>
</div>
<script>
  var ACTIVE=${pageJson(runtime)}, INITIAL=${initial};
  var TIMER=false,CLOCK_ON=false,SPEED=1000,SHOW_NEG=false,SHOW_SECS=false,GIFT_VISIBLE=true,PAUSE_TEXT='',SHOW_RECORD=false,ZERO_TEXT='',ZERO_HIDE=false,GIFTS=[];
  var AUTO_ON=false,AUTO_SPEED=1000,AUTO_VALUE=0,MOUSE_ON=false,MOUSE_VALUE=0;
  var el2=document.getElementById('text2'),giftModule=document.getElementById('giftModule'),main=document.getElementById('main'),titleEl=document.getElementById('text1'),thirdEl=document.getElementById('text3'),pauseEl=document.getElementById('textPause'),lockEl=document.getElementById('itemTwoIcon');
  var wrapper=document.getElementById('wrapper'),dragging=false,moved=false,ox=0,oy=0;
  wrapper.addEventListener('mousedown',function(e){dragging=true;moved=false;ox=e.screenX-window.screenX;oy=e.screenY-window.screenY;e.preventDefault();});
  document.addEventListener('mousemove',function(e){if(!dragging)return;moved=true;wrapper.classList.add('dragging');try{window.moveTo(e.screenX-ox,e.screenY-oy);}catch(err){}});
  document.addEventListener('mouseup',function(){if(dragging&&!moved&&MOUSE_ON&&MOUSE_VALUE){window.__adjust(MOUSE_VALUE);}dragging=false;wrapper.classList.remove('dragging');});
  var curIdx=0,rotationHandle=0,timerHandle=0,autoHandle=0,IMGCACHE={};
  // 礼物图预加载缓存（原版 preloadAllGiftImages + MAX_CACHE_SIZE=24）：
  // 轮转换图时命中缓存，弱网下不再闪白。加载不出来就留空，不拿别的礼物图顶替。
  function preload(src){if(!src||IMGCACHE[src])return;var im=new Image();im.src=src;IMGCACHE[src]=im;
    var keys=Object.keys(IMGCACHE);if(keys.length>24)delete IMGCACHE[keys[0]];}
  function preloadAll(){for(var i=0;i<GIFTS.length;i++)preload(GIFTS[i]&&GIFTS[i].img);}
  function setImg(node,src){if(!node)return;if(!src){node.removeAttribute('src');node.style.visibility='hidden';return;}
    node.style.visibility='visible';node.src=src;node.onerror=function(){this.onerror=null;this.removeAttribute('src');this.style.visibility='hidden';};}
  function renderPair(i){if(!GIFT_VISIBLE||GIFTS.length===0)return;var a=GIFTS[i%GIFTS.length],b=GIFTS.length>1?GIFTS[(i+1)%GIFTS.length]:a;
    setImg(document.getElementById('img1'),a.img);document.getElementById('upper1').textContent=a.upper||'';document.getElementById('lower1').textContent=a.lower||'';
    setImg(document.getElementById('img2'),b.img);document.getElementById('upper2').textContent=b.upper||'';document.getElementById('lower2').textContent=b.lower||'';}
  function resetRotation(){if(rotationHandle)clearInterval(rotationHandle);rotationHandle=0;curIdx=0;preloadAll();if(GIFT_VISIBLE&&GIFTS.length){renderPair(0);if(GIFTS.length>1)rotationHandle=setInterval(function(){curIdx=(curIdx+2)%GIFTS.length;renderPair(curIdx);},3500);}}
  function pad(n){return n<10?'0'+n:''+n;}
  // 不显示原始秒数时按时间排版：满 1 天进"N天"，满 1 小时进 HH，否则 MM:SS。
  // 老实现只有 MM:SS，一小时以上会显示成 62:05 这种看不懂的数字。
  function fmt(n){var neg=n<0?'-':'',v=Math.abs(Math.trunc(n));if(SHOW_SECS)return String(Math.trunc(n));
    var d=Math.floor(v/86400),h=Math.floor(v%86400/3600),m=Math.floor(v%3600/60),s=v%60;
    if(d)return neg+d+'天'+pad(h)+':'+pad(m)+':'+pad(s);
    if(h)return neg+pad(h)+':'+pad(m)+':'+pad(s);
    return neg+pad(m)+':'+pad(s);}
  // 原版分两条路径：走秒/常规刷新不带动画，只有礼物/热键触发那一下才做缩放（setText2TextPro）。
  // 老实现每次 render 都加动画，结果大数字每秒抽搐一次。
  function setText(val,anim){if(el2.textContent===val&&!anim)return;el2.classList.remove('scale-animation');el2.textContent=val;if(anim){void el2.offsetWidth;el2.classList.add('scale-animation');}}
  var v=INITIAL, PAUSED_UNTIL=0;
  function render(anim){if(TIMER&&!SHOW_NEG&&v<=0&&ZERO_TEXT){setText(ZERO_TEXT,anim);document.body.style.visibility=ZERO_HIDE?'hidden':'visible';}else{document.body.style.visibility='visible';setText(fmt(v),anim);}}
  function tick(){if(!TIMER||!CLOCK_ON||Date.now()<PAUSED_UNTIL)return;v=v-1;if(!SHOW_NEG&&v<0)v=0;render(false);}
  function autoTick(){if(!AUTO_ON||Date.now()<PAUSED_UNTIL)return;v=v+AUTO_VALUE;if(!SHOW_NEG&&v<0)v=0;render(false);}
  function resetTimers(){if(timerHandle)clearInterval(timerHandle);if(autoHandle)clearInterval(autoHandle);timerHandle=0;autoHandle=0;if(TIMER&&CLOCK_ON&&SPEED>0)timerHandle=setInterval(tick,SPEED);if(!TIMER&&AUTO_VALUE!==0)autoHandle=setInterval(autoTick,AUTO_SPEED);}
  window.__adjust=function(d){v=v+(Number(d)||0);if(!SHOW_NEG&&v<0)v=0;render(true);};
  window.__pause=function(ms){PAUSED_UNTIL=Date.now()+(Number(ms)||0);document.getElementById('textPause').textContent=PAUSE_TEXT;setTimeout(function(){if(Date.now()>=PAUSED_UNTIL)document.getElementById('textPause').textContent='';},Math.max(0,Number(ms)||0));};
  window.__setValue=function(val,anim){v=Number(val)||0;render(!!anim);};
  window.__getValue=function(){return v;};
  window.__mul=function(k){k=Number(k);if(!Number.isFinite(k))return;v=Math.round(v*k);if(!SHOW_NEG&&v<0)v=0;render(true);};
  window.__div=function(k){k=Number(k);if(!Number.isFinite(k)||k===0)return;v=Math.round(v/k);if(!SHOW_NEG&&v<0)v=0;render(true);};
  window.__toggleAuto=function(){AUTO_ON=!AUTO_ON;return AUTO_ON;};
  // 原版 H5 对外还有这几个：手动翻页/取值（showGiftPair/nextPair/prevPair/getGifts/getCurrentGiftIndex/flush）
  window.__showGiftPair=function(i){curIdx=Math.max(0,Math.trunc(Number(i)||0))%Math.max(1,GIFTS.length);renderPair(curIdx);};
  window.__nextPair=function(){if(!GIFTS.length)return;curIdx=(curIdx+2)%GIFTS.length;renderPair(curIdx);};
  window.__prevPair=function(){if(!GIFTS.length)return;curIdx=(curIdx-2+GIFTS.length*2)%GIFTS.length;renderPair(curIdx);};
  window.__getGifts=function(){return GIFTS;};
  window.__getCurrentGiftIndex=function(){return curIdx;};
  window.__flush=function(){render(false);renderPair(curIdx);};
  function randomBetween(a,b){a=Math.round(Number(a)||0);b=Math.round(Number(b)||0);var lo=Math.min(a,b),hi=Math.max(a,b);return lo+Math.floor(Math.random()*(hi-lo+1));}
  window.__applyGift=function(op,before,after,showRecord){var action=String(op||'加减'), value=randomBetween(before,after), record='';
    if(action==='乘以'){window.__mul(value);record='×'+value;}
    else if(action==='除以'){window.__div(value);record='÷'+value;}
    else if(action==='范围'){window.__setValue(value);record='='+value;}
    else if(action==='清零'){window.__setValue(0);record='清零';}
    else { if(action==='减') value=-Math.abs(value); window.__adjust(value);record=(value>=0?'+':'')+value; }
    if(showRecord||SHOW_RECORD){document.getElementById('textPause').textContent=record;}
  };
  function applyRuntime(next){ACTIVE=next||ACTIVE;TIMER=!!ACTIVE.timer;CLOCK_ON=!!ACTIVE.clockOn;SPEED=Math.max(50,Number(ACTIVE.speed)||1000);SHOW_NEG=!!ACTIVE.showNegative;SHOW_SECS=!!ACTIVE.showSeconds;GIFT_VISIBLE=!!ACTIVE.giftVisible;PAUSE_TEXT=String(ACTIVE.pauseText||'');SHOW_RECORD=!!ACTIVE.showRecord;ZERO_TEXT=String(ACTIVE.zeroText||'');ZERO_HIDE=!!ACTIVE.zeroHide;GIFTS=Array.isArray(ACTIVE.gifts)?ACTIVE.gifts:[];AUTO_ON=!!ACTIVE.autoAdjust;AUTO_SPEED=Math.max(50,Number(ACTIVE.autoSpeed)||1000);AUTO_VALUE=Number(ACTIVE.autoValue)||0;MOUSE_ON=!!ACTIVE.mouseEnabled;MOUSE_VALUE=Number(ACTIVE.mouseValue)||0;
    document.body.dataset.widgetSkin=ACTIVE.skin||'classic';
    main.style.backgroundColor=ACTIVE.bg||'transparent';main.style.backgroundImage=ACTIVE.styleImg?"url('"+ACTIVE.styleImg+"')":'none';main.style.backgroundSize='100% 100%';main.style.backgroundRepeat='no-repeat';titleEl.textContent=String(ACTIVE.title||'');titleEl.style.color=ACTIVE.titleColor||'#fff';thirdEl.textContent=String(ACTIVE.third||'');thirdEl.style.color=ACTIVE.titleColor||'#fff';el2.style.color=ACTIVE.numColor||'#fff';pauseEl.textContent=PAUSE_TEXT;if(lockEl)lockEl.style.display=ACTIVE.showLock?'block':'none';giftModule.style.display=GIFT_VISIBLE&&GIFTS.length?'flex':'none';document.querySelectorAll('.upper-text').forEach(function(el){el.style.color=ACTIVE.giftNameColor||'#fff';});document.querySelectorAll('.lower-text').forEach(function(el){el.style.color=ACTIVE.deltaColor||'#fff';});resetRotation();resetTimers();render();}
  window.__updateConfig=applyRuntime;
  applyRuntime(ACTIVE);
</script>
</body></html>`
}

function unregisterHotkeys(slot: ChallengeSlot): void {
  const inst = instances.get(slot)
  if (!inst) return
  for (const accelerator of inst.accels) globalShortcut.unregister(accelerator)
  inst.accels = []
}

function accelerator(hotkey: { enabled: boolean; func: string; key: string }): string | null {
  if (!hotkey.enabled || !hotkey.key.trim()) return null
  const prefix: Record<string, string> = { '无': '', Alt: 'Alt+', Ctrl: 'Ctrl+', 'Ctrl+Alt': 'Ctrl+Alt+', Shift: 'Shift+' }
  return (prefix[hotkey.func] ?? '') + hotkey.key.trim()
}

function registerHotkeys(slot: ChallengeSlot, cfg: CountChallengeConfig): void {
  unregisterHotkeys(slot)
  const inst = instances.get(slot)
  if (!inst) return
  // 主播填的键名不合法（如「空格键」）时 globalShortcut.register 直接抛：单条失败只跳过，别把整个挂件更新打成 reject
  const tryRegister = (key: string, fn: () => void): boolean => {
    try {
      return globalShortcut.register(key, fn)
    } catch {
      return false
    }
  }
  for (const hotkey of (cfg.hotkeys || []).slice(0, 4)) {
    const key = accelerator(hotkey)
    if (!key || !tryRegister(key, () => challengeAdjust(hotkey.value, slot))) continue
    inst.accels.push(key)
  }
  const autoKey = String(cfg.autoToggleHotkey || '')
  if (/^F(?:[1-9]|1[0-2])$/.test(autoKey) && tryRegister(autoKey, () => {
    runIn(slot, 'window.__toggleAuto && window.__toggleAuto()')
  })) inst.accels.push(autoKey)
}

function parseDelta(value: string): number {
  const result = Number(String(value || '').trim())
  return Number.isFinite(result) ? result : 0
}

function localGiftImages(): Record<string, string> {
  const images: Record<string, string> = {}
  try {
    const { listGiftImages } = require('./entertainment') as typeof import('./entertainment')
    for (const gift of listGiftImages()) if (!images[gift.name]) images[gift.name] = gift.path
  } catch {
    // 礼物缓存目录不存在时，挂件仍可使用配置里的图片和 CDN 回退图。
  }
  return images
}

function pageJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function coordinate(value: unknown, fallback: number): number {
  const result = Number(value)
  return Number.isFinite(result) ? Math.round(result) : fallback
}

function syncOpenWidget(slot: ChallengeSlot): void {
  const inst = live(slot)
  if (!inst) return
  const [x, y] = inst.win.getPosition()
  const nextX = coordinate(inst.cfg.posX, x)
  const nextY = coordinate(inst.cfg.posY, y)
  if (x !== nextX || y !== nextY) inst.win.setPosition(nextX, nextY)
  const runtime = runtimeConfig(inst.cfg, localGiftImages())
  void inst.win.webContents
    .executeJavaScript(`window.__updateConfig&&window.__updateConfig(${pageJson(runtime)})`)
    .catch(() => {})
}

// 连接器下载到礼物图后回填到所有开着的挂件（计数挑战和加班器可能同时挂着）。
export function setChallengeGiftImage(name: string, image: string): void {
  const giftName = String(name || '').trim()
  const imagePath = String(image || '').trim()
  if (!giftName || !imagePath) return
  eachLive((inst, slot) => {
    let changed = false
    const gifts = (inst.cfg.gifts || []).map((gift) => {
      if (!giftNamesEqual(gift.name, giftName) || gift.img === imagePath) return gift
      changed = true
      return { ...gift, img: imagePath }
    })
    if (!changed) return
    inst.cfg = { ...inst.cfg, gifts }
    syncOpenWidget(slot)
  })
}

export function openChallengeWidget(cfg: CountChallengeConfig): { ok: boolean; error?: string } {
  const slot = slotOf(cfg)
  try {
    unregisterHotkeys(slot)
    const old = instances.get(slot)
    if (old) { try { old.win.close() } catch { /* ignore */ } instances.delete(slot) }
    const activeConfig: CountChallengeConfig = {
      ...cfg,
      gifts: Array.isArray(cfg.gifts) ? cfg.gifts.map((gift) => ({ ...gift })) : []
    }
    const localImgs = localGiftImages()
    // 两个插件各写各的页面文件，互不覆盖。
    const tmp = path.join(app.getPath('userData'), `challenge-widget-${slot}.html`)
    fs.writeFileSync(tmp, page(activeConfig, localImgs))
    const created = createCaptureOutputWindow({
      title: slot === 'overtime' ? '加班器' : '计数挑战',
      // 原 H5 的 320x300 是内容区，连同 10px padding 的实际外框为 340x320。
      width: 340, height: 320,
      ...onScreenPosition(coordinate(activeConfig.posX, 500), coordinate(activeConfig.posY, 30), 340, 320),
      frame: false, transparent: true, alwaysOnTop: outputsAlwaysOnTop(), resizable: false,
      skipTaskbar: true, hasShadow: false, webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    instances.set(slot, { win: created, cfg: activeConfig, accels: [] })
    captureTitle(created, slot === 'overtime' ? '加班器' : '计数挑战')
    created.loadFile(tmp)
    onceOutputPageEvent(created, 'did-finish-load', () => syncOpenWidget(slot))
    registerOutputWindow(created)
    onOutputWindowEvent(created, 'move', () => {
      const inst = instances.get(slot)
      if (inst && inst.win === created && !created.isDestroyed()) {
        const [x, y] = created.getPosition()
        inst.cfg = { ...inst.cfg, posX: x, posY: y }
      }
    })
    onOutputWindowClosed(created, () => {
      const inst = instances.get(slot)
      if (inst && inst.win === created) {
        unregisterHotkeys(slot)
        instances.delete(slot)
      }
    })
    registerHotkeys(slot, activeConfig)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (slot === 'overtime' ? '打开加班器失败：' : '打开计数挑战失败：') + (e as Error).message }
  }
}
export function challengeAdjust(delta: number, slot?: ChallengeSlot): { ok: boolean } {
  return runIn(slot, `window.__adjust && window.__adjust(${Number(delta) || 0})`)
}

// 配置由设置页持续同步到主进程。这样页面切走后，挂件仍能按最新礼物规则工作。
export function updateChallengeWidget(cfg: CountChallengeConfig): { ok: boolean } {
  const slot = slotOf(cfg)
  const inst = live(slot)
  if (!inst) return { ok: false }
  inst.cfg = { ...cfg, gifts: Array.isArray(cfg.gifts) ? cfg.gifts.map((gift) => ({ ...gift })) : [] }
  registerHotkeys(slot, inst.cfg)
  syncOpenWidget(slot)
  return { ok: true }
}

// 连接器从抖音收到的是真实礼物增量；连击 N 次按原始事件逐次执行，随机区间也逐次重新抽取。
// 计数挑战和加班器各自按自己的礼物表算，互不影响。
export function handleChallengeGift(name: string, count = 1, image = ''): void {
  const gift = String(name || '').trim()
  if (!gift) return
  setChallengeGiftImage(gift, image)
  // 数量不设上限（用户铁律）：观众一次点 99/999，挂件必须如实计入。
  const amount = Math.max(1, Math.trunc(Number(count) || 1))
  eachLive((inst, slot) => {
    const cfg = inst.cfg
    // 礼物名一律走归一化比较（全角/半角、大小写、多余空格都能对上），
    // 老实现用裸等号，带空格或全角的礼物直接不触发。
    if (cfg.pauseAdjust && giftNamesEqual(cfg.pauseGift, gift) && cfg.pauseTime > 0) {
      challengePause(cfg.pauseTime * 1000, slot)
    }
    const rule = (cfg.gifts || []).find((item) => giftNamesEqual(item.name, gift))
    if (!rule) return
    for (let index = 0; index < amount; index++) {
      if (cfg.mode === 'counter') challengeAdjust(parseDelta(rule.delta), slot)
      else challengeApplyGift(rule.op || '加减', Number(rule.before) || 0, Number(rule.after) || 0, !!cfg.showRecord, slot)
    }
    const spoken = spokenChallenge(rule, cfg.mode === 'counter', amount)
    if (spoken) announce(slot === 'overtime' ? 'overtime' : 'challenge', slot === 'overtime' ? `加班${spoken}` : spoken)
  })
}

// AI 语音播报（announce.ts）：计数模式念总共加减了多少；计时模式念这一格的动作（区间随机的值在挂件页里才抽，念范围）。
// 礼物行自己写了显示文字的（「+1分钟」）就念那句
function spokenChallenge(rule: CountChallengeGift, counter: boolean, amount: number): string {
  if (rule.text?.trim()) return amount > 1 ? `${rule.text.trim()}，${amount}次` : rule.text.trim()
  if (counter) {
    const total = parseDelta(rule.delta) * amount
    return total > 0 ? `加${total}` : total < 0 ? `减${-total}` : ''
  }
  const a = Number(rule.before) || 0
  const b = Number(rule.after) || 0
  const op = rule.op || '加减'
  const times = amount > 1 ? `，${amount}次` : ''
  if (op === '清零') return '清零'
  if (op === '乘以') return a ? `乘${a}${times}` : ''
  if (op === '除以') return a ? `除以${a}${times}` : ''
  if (op === '范围') return a === b ? `设为${spokenDuration(a)}` : `设为${spokenDuration(Math.min(a, b))}到${spokenDuration(Math.max(a, b))}`
  // 加 / 减 / 加减：在 [前, 后] 里随机取；「加减」的正负跟着数值走
  const sign = op === '减' || (op === '加减' && Math.max(a, b) <= 0) ? '减' : '加'
  const lo = Math.min(Math.abs(a), Math.abs(b))
  const hi = Math.max(Math.abs(a), Math.abs(b))
  if (!hi) return ''
  if (a === b) return `${sign}${spokenDuration(hi * amount)}`
  return `${sign}${spokenDuration(lo)}到${spokenDuration(hi)}${times}`
}
export function challengeApplyGift(op: string, before: number, after: number, showRecord: boolean, slot?: ChallengeSlot): { ok: boolean } {
  const action = JSON.stringify(String(op || '加减'))
  return runIn(slot, `window.__applyGift && window.__applyGift(${action},${Number(before) || 0},${Number(after) || 0},${!!showRecord})`)
}
export function challengeMul(k: number, slot?: ChallengeSlot): { ok: boolean } {
  if (!Number.isFinite(k)) return { ok: false }
  return runIn(slot, `window.__mul && window.__mul(${k})`)
}
export function challengeDiv(k: number, slot?: ChallengeSlot): { ok: boolean } {
  if (!Number.isFinite(k) || k === 0) return { ok: false }
  return runIn(slot, `window.__div && window.__div(${k})`)
}
export function challengeSetValue(v: number, slot?: ChallengeSlot): { ok: boolean } {
  return runIn(slot, `window.__setValue && window.__setValue(${Number(v) || 0})`)
}
export function challengePause(ms: number, slot?: ChallengeSlot): { ok: boolean } {
  return runIn(slot, `window.__pause && window.__pause(${Number(ms) || 0})`)
}
export function closeChallengeWidget(slot?: ChallengeSlot): { ok: boolean } {
  const targets: ChallengeSlot[] = slot ? [slot] : [...instances.keys()]
  for (const key of targets) {
    unregisterHotkeys(key)
    const inst = instances.get(key)
    try { inst?.win.close() } catch { /* ignore */ }
    instances.delete(key)
  }
  return { ok: true }
}
export async function challengeWidgetState(slot?: ChallengeSlot): Promise<{ open: boolean; value?: number }> {
  const inst = live(slot || 'challenge')
  if (!inst) return { open: false }
  try {
    const value = await inst.win.webContents.executeJavaScript('window.__getValue&&window.__getValue()')
    return Number.isFinite(Number(value)) ? { open: true, value: Number(value) } : { open: true }
  } catch {
    return { open: true }
  }
}
app.on('before-quit', () => {
  closeChallengeWidget()
})
