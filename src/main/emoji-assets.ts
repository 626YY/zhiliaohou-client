// 表情图（Twemoji 72px，CC-BY 4.0，见 assets/emoji72/LICENSE-GRAPHICS.txt）：
// 昵称 / 礼物名 / 文案里的 emoji 按图贴，Windows 自带字体画不出的（新版 emoji、国旗、🐦‍⬛ 这类 ZWJ 组合）也能显示。
// 图集与匹配规则整套来自轮椅整蛊台 mod/EmojiArt.cs（2026-07 实测扒出的 Twemoji 文件名规则：简单 emoji 去 FE0F、
// ZWJ 组合里留 FE0F、最长匹配逐级回退），这里移植成挂件页面脚本。用户 2026-09-11：「去轮椅整蛊台里拿那个 emoji」。
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

let cachedDir: string | null | undefined
let cachedKeys: string[] | undefined

/** 表情图目录：打包后在 resources/emoji72，开发时在仓库 assets/emoji72；找不到回 null（页面退回文字，不报错） */
export function emojiDir(): string | null {
  if (cachedDir !== undefined) return cachedDir
  const candidates = [path.join(process.resourcesPath || '', 'emoji72'), path.join(app.getAppPath(), 'assets', 'emoji72')]
  cachedDir = candidates.find((dir) => { try { return fs.statSync(dir).isDirectory() } catch { return false } }) || null
  return cachedDir
}

/** 图名索引（文件名去掉 .png）：拿真实文件名当权威，规则太不规则不能硬推 */
export function emojiKeys(): string[] {
  if (cachedKeys) return cachedKeys
  const dir = emojiDir()
  try {
    cachedKeys = dir ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)) : []
  } catch {
    cachedKeys = []
  }
  return cachedKeys
}

/** 塞进挂件页面 <head> 的脚本：定义 window.__zlText(el, text) / __emojiFace(el, name) / __emojiSplit(text) / __emojiHas(text) */
export function emojiPageScript(): string {
  const dir = emojiDir()
  const base = dir ? pathToFileURL(dir).href.replace(/\/?$/, '/') : ''
  return `<script>${EMOJI_RUNTIME.replace('__BASE__', JSON.stringify(base)).replace('__KEYS__', JSON.stringify(emojiKeys().join('|')))}</script>`
}

/** 页面脚本原文（tools/verify-avatar-emoji.mjs 也用它在 Node 里跑纯函数测试） */
export const EMOJI_RUNTIME = `(function(){
var BASE=__BASE__,KEYSTR=__KEYS__,KEYS=new Set(KEYSTR?KEYSTR.split('|'):[]);
if(typeof document!=='undefined'){var css=document.createElement('style');css.textContent='.emo{display:inline-block;width:1.15em;height:1.15em;vertical-align:-0.2em;margin:0 .04em;object-fit:contain}';(document.head||document.documentElement).appendChild(css)}
// 快筛：汉字 / ASCII 在这里就被判掉。放宽没关系（多查一次索引），收紧过头才会漏字
function maybe(cp){if(cp<0xA9)return false;if(cp>=0x10000)return true;if(cp===0xA9||cp===0xAE)return true;return cp>=0x203C&&cp<=0x3299}
// 能跟在前一个码位后面继续拼成同一个 emoji 的：变体选择符 / 键帽 / 零宽连接符 / 肤色
function joiner(cp){return cp===0xFE0F||cp===0x20E3||cp===0x200D||(cp>=0x1F3FB&&cp<=0x1F3FF)}
function ri(cp){return cp>=0x1F1E6&&cp<=0x1F1FF}
function key(cps,n,keepVS){var s='';for(var k=0;k<n;k++){if(!keepVS&&cps[k]===0xFE0F)continue;if(s)s+='-';s+=cps[k].toString(16)}return s}
// 从 cps[i] 起是不是一张图：{key, used}；最长匹配 + 逐级回退（🐦‍⬛ 先试整个，没有再退回 🐦）
function match(cps,i){
  // 键帽 1️⃣ #️⃣ 是 ASCII 打头（'1' + FE0F + 20E3），快筛放不过，单独认
  var keycap=(cps[i]===0x23||cps[i]===0x2A||(cps[i]>=0x30&&cps[i]<=0x39))&&(cps[i+1]===0xFE0F||cps[i+1]===0x20E3);
  if(!maybe(cps[i])&&!keycap)return null;
  var seq=[],p=i,prevZWJ=false;
  while(p<cps.length){var cp=cps[p];
    if(seq.length){var cont=prevZWJ||joiner(cp)||(seq.length===1&&ri(seq[0])&&ri(cp));if(!cont)break}
    seq.push(cp);p++;prevZWJ=(cp===0x200D);if(seq.length>12)break}
  // 裸的单个 BMP 符号（★☆♀♂〰 之类）字体本来就画得出、在昵称里是文字装饰：留给文字，别贴成卡通图（轮椅整蛊台同样规则）；
  // 带 FE0F 的（❤️ ☀️）是明确要 emoji 样子的，贴图，和别的 emoji 一个画风
  if(seq[0]<=0xFFFF&&seq.length===1)return null;
  if(!KEYS.size)return null;
  for(var n=seq.length;n>=1;n--){if(seq[n-1]===0x200D)continue;var k=key(seq,n,true);if(KEYS.has(k))return {key:k,used:n};var k2=key(seq,n,false);if(k2!==k&&k2&&KEYS.has(k2))return {key:k2,used:n}}
  return null}
function split(text){var cps=Array.from(String(text==null?'':text)).map(function(c){return c.codePointAt(0)}),out=[],buf='',i=0;
  while(i<cps.length){var m=match(cps,i);if(m){if(buf){out.push({text:buf});buf=''}out.push({key:m.key,text:String.fromCodePoint.apply(null,cps.slice(i,i+m.used))});i+=m.used}else{buf+=String.fromCodePoint(cps[i]);i++}}
  if(buf)out.push({text:buf});return out}
function img(seg){var im=document.createElement('img');im.className='emo';im.alt=seg.text;im.draggable=false;im.src=BASE+seg.key+'.png';im.onerror=function(){this.replaceWith(document.createTextNode(seg.text))};return im}
var g=typeof window!=='undefined'?window:globalThis;
g.__emojiSplit=split;
g.__emojiHas=function(text){return split(text).some(function(s){return s.key})};
// 把文字塞进元素：emoji 贴图，其余仍是文字（沿用元素自己的字号 / 颜色 / 省略号）
g.__zlText=function(el,text){if(!el)return el;el.textContent='';if(!BASE){el.textContent=String(text==null?'':text);return el}
  split(text).forEach(function(seg){el.appendChild(seg.key?img(seg):document.createTextNode(seg.text))});return el};
// 头像兜底「首字」：第一个字是 emoji 就贴图，否则一个字
g.__emojiFace=function(el,name){if(!el)return el;var segs=split(name),first=segs[0];el.textContent='';
  if(!first){el.textContent='观';return el}
  if(first.key&&BASE)el.appendChild(img(first));else el.textContent=Array.from(first.text)[0]||'观';return el};
})();`
