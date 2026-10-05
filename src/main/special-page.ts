// 特色玩法页面构建（纯函数，无 electron 依赖——引擎、预览与离线测试单一来源）。
// 页面 = 公共骨架（Canvas + 横幅 + 运行时）+ 该玩法的 Canvas 代码。运行时职责见 HARNESS_JS 注释。
//
// 两种用法：
// - 采集窗口（直播用）：素材走 file://，主进程 executeJavaScript 调 window.__apply / __config。
// - 预览（特色整蛊详情页里的小舞台）：页面由 zlspecial:// 协议提供，素材/本地文件也走它（同源，fetch 能用）；
//   渲染层用 postMessage 下发 {type:'apply'|'config'|'mute'}，页面空闲时回 {type:'special-idle'}。
//   预览默认静音、不开麦克风、不显示拖窗把手（iframe 里的 app-region 会把主窗口当成可拖区）。
import type { SpecialGameMeta, SpecialGameConfig } from '../shared/specialGames'

const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c')

// 传给页面的扁平配置：玩法代码直接读 cfg.size / cfg.speed 等。
export function specialPageConfig(cfg: SpecialGameConfig): Record<string, unknown> {
  return { background: cfg.background, speed: cfg.speed, countCap: cfg.countCap, ...cfg.params }
}

// 公共运行时：rAF 无活动自停、可见性暂停、指针映射、__apply/__config 桥、横幅（带送礼人头像）、图片/音频加载。
// 内部不用模板串插值（${…}），注入值走 window.__INITIAL_CFG / __INTERACTIVE / __PREVIEW / __FILE_BASE。
export const HARNESS_JS = `(function(){
  var cv=document.getElementById('cv'); var ctx=cv.getContext('2d');
  var banner=document.getElementById('banner'), bannerText=document.getElementById('btx'), bannerAvatar=document.getElementById('bav');
  var INTERACTIVE=!!window.__INTERACTIVE;
  var PREVIEW=!!window.__PREVIEW;
  var CFG=window.__INITIAL_CFG||{};
  var DPR=Math.max(1,Math.min(3,window.devicePixelRatio||1));
  var W=0,H=0,GAME=null;
  var CUR=null; // 正在执行的那条命令（横幅自动带上送礼人头像）
  window.__MUTED=PREVIEW?(window.__MUTED!==false):false;
  function resize(){ W=window.innerWidth; H=window.innerHeight; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); cv.style.width=W+'px'; cv.style.height=H+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); try{ if(GAME&&GAME.resize)GAME.resize(W,H);}catch(e){} kick(); }
  window.addEventListener('resize',resize);
  // 本地文件（自定义素材）→ 可加载的 URL：预览走 zlspecial 同源通道，采集窗口走 file://
  function fileUrl(p){
    var u=String(p||'').trim(); if(!u) return '';
    if(/^(https?|file|data|blob|zlspecial|zlmedia):/i.test(u)) return u;
    var norm=u.replace(/\\\\/g,'/');
    if(window.__FILE_BASE) return window.__FILE_BASE+norm.split('/').map(encodeURIComponent).join('/');
    return 'file:///'+norm;
  }
  var api={
    get W(){return W}, get H(){return H}, get cfg(){return CFG}, get ctx(){return ctx},
    get preview(){return PREVIEW},
    muted:function(){ return !!window.__MUTED; },
    rand:function(a,b){return a+Math.random()*(b-a)},
    pick:function(arr){return arr[Math.floor(Math.random()*arr.length)]},
    asset:function(rel){ return (window.__ASSET_BASE||'')+String(rel||''); },
    fileUrl:fileUrl,
    loadImage:function(url){ var im=new Image(); im.src=url; return im; },
    sound:function(url,vol){ if(window.__MUTED) return null; try{ var a=new Audio(url); a.volume=Math.max(0,Math.min(1,vol==null?1:vol)); a.play().catch(function(){}); return a; }catch(e){ return null; } },
    banner:function(msg,avatar){ showBanner(msg,avatar); },
    cap:function(){ var c=Math.trunc(Number(CFG.countCap)||0); return c>0?c:1000000; },
    speed:function(){ var s=Number(CFG.speed); return (s>0?s:1); }
  };
  window.registerGame=function(g){ GAME=g; try{ if(g.init)g.init(api);}catch(e){console.error('game init',e);} kick(); };
  var bt=0;
  // 横幅：送礼人头像 + 文案。头像没传就用当前命令的（玩法在 apply 里调 banner 时自动带上）。
  function showBanner(msg,avatar){
    if(!banner)return;
    if(!msg){banner.style.opacity=0;return;}
    var av=avatar!=null?avatar:(CUR&&CUR.avatar)||'';
    bannerText.textContent=msg;
    if(av){ bannerAvatar.src=fileUrl(av); bannerAvatar.style.display='block'; } else { bannerAvatar.removeAttribute('src'); bannerAvatar.style.display='none'; }
    banner.style.opacity=1; clearTimeout(bt); bt=setTimeout(function(){banner.style.opacity=0;},2600);
  }
  if(bannerAvatar) bannerAvatar.onerror=function(){ bannerAvatar.style.display='none'; };
  var running=false,last=0;
  function post(type,extra){ if(!PREVIEW) return; try{ var m={source:'zl-special',type:type}; if(extra) for(var k in extra) m[k]=extra[k]; window.parent.postMessage(m,'*'); }catch(e){} }
  // 画布上还有没有东西（预览专用）：动画停了不等于画面空了——锁链挂着等主播点、鸭子躺着等抓，都是停着但有内容。
  // 自动演示只在真的空了才再来一波，不然会一直往上叠（2026-10-05 用户：一连直播间就看见一直有人送礼）。
  function canvasEmpty(){
    try{ var w=cv.width,h=cv.height; if(!w||!h) return true; var d=ctx.getImageData(0,0,w,h).data;
      for(var i=3;i<d.length;i+=64){ if(d[i]>8) return false; } return true; }catch(e){ return false; }
  }
  function frame(now){
    if(document.hidden){ running=false; last=0; return; }
    var dt=last?Math.min(80,now-last):16; last=now;
    var active=false;
    try{ active = GAME&&GAME.tick ? !!GAME.tick(dt) : false; }catch(e){ console.error('tick',e); }
    ctx.clearRect(0,0,W,H);
    try{ if(GAME&&GAME.draw)GAME.draw(ctx); }catch(e){ console.error('draw',e); }
    if(active) requestAnimationFrame(frame); else { running=false; last=0; if(PREVIEW) post('special-idle',{empty:canvasEmpty()}); }
  }
  function kick(){ if(running||document.hidden)return; running=true; last=0; requestAnimationFrame(frame); }
  window.__kick=kick;
  // 测试钩子：手动推一帧（不依赖 rAF / 可见性），返回是否还有活动。离线截图测试用，生产不调用。
  window.__step=function(dt){ var a=false; try{ a=GAME&&GAME.tick?!!GAME.tick(Number(dt)||16):false; }catch(e){} ctx.clearRect(0,0,W,H); try{ if(GAME&&GAME.draw)GAME.draw(ctx);}catch(e){} return a; };
  window.__alive=function(){ return !!(GAME&&GAME.tick&&GAME.tick(0)); };
  // 累计统计（有累计数的玩法实现 GAME.stats()，返回 {value:N}）
  window.__stats=function(){ try{ return GAME&&GAME.stats?GAME.stats():null; }catch(e){ return null; } };
  document.addEventListener('visibilitychange',function(){ if(!document.hidden)kick(); });
  window.__apply=function(cmd){
    try{ if(typeof cmd==='string')cmd=JSON.parse(cmd);}catch(e){cmd={};}
    cmd=cmd||{};
    CUR=cmd;
    try{ if(GAME&&GAME.apply)GAME.apply(cmd); }catch(e){ console.error('apply',e);}
    // 盲盒开出来的：用「某某的盲盒开出：…」盖掉玩法自己的横幅
    if(cmd.announce) showBanner(String(cmd.announce));
    CUR=null;
    kick();
  };
  window.__config=function(next){ try{ if(typeof next==='string')next=JSON.parse(next);}catch(e){return;} for(var k in next)CFG[k]=next[k]; if(!PREVIEW) document.body.style.background=CFG.background==='transparent'?'transparent':'#00FF00'; try{ if(GAME&&GAME.config)GAME.config(CFG);}catch(e){} kick(); };
  window.__mute=function(on){ window.__MUTED=!!on; try{ if(GAME&&GAME.mute)GAME.mute(!!on);}catch(e){} };
  if(PREVIEW){
    window.addEventListener('message',function(e){
      var m=e&&e.data; if(!m||m.source!=='zl-special-host') return;
      if(m.type==='apply') window.__apply(m.cmd||{});
      else if(m.type==='config') window.__config(m.cfg||{});
      else if(m.type==='mute') window.__mute(m.value);
    });
  }
  if(INTERACTIVE){
    var mapPt=function(e){ var r=cv.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; };
    cv.addEventListener('pointerdown',function(e){ var p=mapPt(e); try{ if(GAME&&GAME.pointer)GAME.pointer('down',p[0],p[1]);}catch(_){} kick(); e.stopPropagation(); },true);
    cv.addEventListener('pointermove',function(e){ var p=mapPt(e); try{ if(GAME&&GAME.pointer)GAME.pointer('move',p[0],p[1]);}catch(_){} },true);
    cv.addEventListener('pointerup',function(e){ var p=mapPt(e); try{ if(GAME&&GAME.pointer)GAME.pointer('up',p[0],p[1]);}catch(_){} },true);
    cv.addEventListener('pointercancel',function(e){ try{ if(GAME&&GAME.pointer)GAME.pointer('up',-1,-1);}catch(_){} },true);
  }
  resize();
  setTimeout(function(){ post('special-ready'); },0);
})();`

export interface SpecialPageOptions {
  /** 详情页预览：静音、不开麦克风、不显示拖窗把手，接收 postMessage */
  preview?: boolean
  /** 本地文件的 URL 前缀（预览用 zlspecial://app/file/）；空 = file:/// */
  fileBase?: string
}

export function buildSpecialPage(meta: SpecialGameMeta, cfg: SpecialGameConfig, code: string, assetBase = '', options: SpecialPageOptions = {}): string {
  const preview = options.preview === true
  const handle = meta.interactive && !preview ? '<div id="grip" title="拖动摆放窗口">⋮⋮ 拖动</div>' : ''
  // 预览底色交给外层舞台（棋盘格/绿幕由渲染层画），页面本身透明
  const bodyBg = preview ? 'transparent' : cfg.background === 'transparent' ? 'transparent' : '#00FF00'
  const passThrough = !meta.interactive && !preview
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
body{background:${bodyBg};position:relative;${passThrough ? 'pointer-events:none;' : ''}}
#cv{position:absolute;inset:0;display:block;${meta.interactive ? 'touch-action:none;' : 'pointer-events:none;'}}
#banner{position:absolute;left:50%;top:3%;transform:translateX(-50%);z-index:50;pointer-events:none;
  display:flex;align-items:center;gap:10px;max-width:92%;
  font:bold 24px "Microsoft YaHei","Segoe UI Emoji","Apple Color Emoji",sans-serif;color:#fff;white-space:nowrap;opacity:0;transition:opacity .3s ease;
  background:rgba(0,0,0,.5);border-radius:999px;padding:6px 20px 6px 8px;
  text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;}
#bav{width:36px;height:36px;border-radius:50%;object-fit:cover;display:none;border:2px solid rgba(255,255,255,.85);flex:none;}
#btx{overflow:hidden;text-overflow:ellipsis;padding-left:6px;}
#grip{position:absolute;right:8px;top:8px;z-index:60;-webkit-app-region:drag;cursor:move;
  font:600 12px "Microsoft YaHei",sans-serif;color:rgba(255,255,255,.85);background:rgba(0,0,0,.35);
  border-radius:10px;padding:3px 10px;user-select:none;}
</style></head><body>
<canvas id="cv"${meta.interactive ? ' data-nodrag' : ''}></canvas>
<div id="banner"><img id="bav" alt=""><span id="btx"></span></div>
${handle}
<script>window.__INITIAL_CFG=${scriptJson(specialPageConfig(cfg))};window.__INTERACTIVE=${meta.interactive ? 'true' : 'false'};window.__PREVIEW=${preview ? 'true' : 'false'};window.__ASSET_BASE=${scriptJson(assetBase)};window.__FILE_BASE=${scriptJson(options.fileBase || '')};</script>
<script>${HARNESS_JS}</script>
<script>${code}</script>
</body></html>`
}
