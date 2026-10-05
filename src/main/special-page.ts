// 特色玩法页面构建（纯函数，无 electron 依赖——直播窗口、预览与离线测试单一来源）。
// 页面 = 公共骨架（图层画布 + 横幅 + 运行时）+ 玩法的 Canvas 代码。运行时职责见 HARNESS_JS 注释。
//
// 三种用法：
// - 直播窗口「特色整蛊」（buildSpecialWindowPage）：17 个玩法共用一个窗口，用到哪个才加载哪个，
//   每个玩法自己一层画布、自己的配置；主进程 executeJavaScript 调 window.__apply / __config / __window。
// - 预览（特色整蛊详情页里的小舞台，buildSpecialPage preview）：只装一个玩法，页面由 zlspecial:// 协议提供，
//   渲染层用 postMessage 下发 {type:'apply'|'config'|'mute'}，页面空闲时回 {type:'special-idle'}。
//   预览默认静音、不开麦克风、不显示拖窗把手（iframe 里的 app-region 会把主窗口当成可拖区）。
// - 离线测试 / 缩略图（buildSpecialPage）：只装一个玩法，画布是 #cv。
import type { SpecialGameMeta, SpecialGameConfig, SpecialWindowConfig } from '../shared/specialGames'

const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c')

// 传给页面的扁平配置：玩法代码直接读 cfg.size / cfg.speed 等；底色是窗口的，玩法也要知道（锁链配色避开绿幕）。
export function specialPageConfig(cfg: SpecialGameConfig, background: SpecialWindowConfig['background'] = 'green'): Record<string, unknown> {
  return { background, speed: cfg.speed, countCap: cfg.countCap, ...cfg.params }
}

// 公共运行时：
// - 玩法按需加载：第一次收到它的命令才执行它的代码（不用的玩法不占内存、不开麦克风）；每个玩法一份自己的 ZL 小工具
//   （音量、素材缓存、声道互不串），一层自己的画布（锁链的擦除、来电的整屏遮罩都只在自己那层）。
// - 渲染：一个 rAF 循环，只推「还在动」的那几层；全都停了就停帧（直播伴侣盖住窗口时不空转）。
// - 点击：按图层从上往下找，点中东西的那个玩法接住这一下，按住拖动的后续移动/抬起也只给它（各玩各的）；
//   谁都没点中、也没拖动，才算给「点哪都算」的玩法（锁链）一下。没按住时的挥动大家都看得到（挥手拍苍蝇）。
// - __apply/__config/__window 桥、横幅（带送礼人头像）、图片/音频加载。
// 内部不用模板串插值（${…}），注入值走 window.__GAME_CODE / __INITIAL_CFGS / __GAME_META / __LAYER_ORDER 等。
export const HARNESS_JS = `(function(){
  var PREVIEW=!!window.__PREVIEW;
  var META=window.__GAME_META||{};
  var ORDER=window.__LAYER_ORDER||[];
  var CFGS=window.__INITIAL_CFGS||{};
  var CODE=window.__GAME_CODE||{};
  var DEFAULT=String(window.__DEFAULT_GAME||'');
  var stage=document.getElementById('stage');
  // 直播窗口才有：计数面板、送礼提示画在这一层，盖在所有玩法之上（不会被上层的锁链挡住）；单玩法页面就画在自己画布上
  var hudLayer=document.getElementById('hud');
  var hit=document.getElementById('hit');
  var banner=document.getElementById('banner'), bannerText=document.getElementById('btx'), bannerAvatar=document.getElementById('bav');
  var DPR=Math.max(1,Math.min(3,window.devicePixelRatio||1));
  var W=0,H=0;
  var slots={}, list=[], LOADING=null;
  window.__MUTED=PREVIEW?(window.__MUTED!==false):false;
  function layerOf(id){ var i=ORDER.indexOf(id); return i<0?ORDER.length:i; }
  // 本地文件（自定义素材）→ 可加载的 URL：预览走 zlspecial 同源通道，采集窗口走 file://
  function fileUrl(p){
    var u=String(p||'').trim(); if(!u) return '';
    if(/^(https?|file|data|blob|zlspecial|zlmedia):/i.test(u)) return u;
    var norm=u.replace(/\\\\/g,'/');
    if(window.__FILE_BASE) return window.__FILE_BASE+norm.split('/').map(encodeURIComponent).join('/');
    return 'file:///'+norm;
  }
  function sizeCanvas(cv,ctx){ cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); cv.style.width=W+'px'; cv.style.height=H+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); }
  function sizeSlot(s){ sizeCanvas(s.cv,s.ctx); if(s.hcv) sizeCanvas(s.hcv,s.hctx); }
  function ensureHud(s){
    if(!hudLayer) return s.ctx;
    if(!s.hcv){ s.hcv=document.createElement('canvas'); s.hcv.setAttribute('data-hud',s.id); hudLayer.appendChild(s.hcv); s.hctx=s.hcv.getContext('2d'); sizeCanvas(s.hcv,s.hctx); }
    return s.hctx;
  }
  function clearSlot(s){ s.ctx.clearRect(0,0,W,H); if(s.hctx) s.hctx.clearRect(0,0,W,H); }
  function resize(){
    W=window.innerWidth; H=window.innerHeight;
    // 改尺寸会清空画布：每层都重画一遍（停着的也画一帧，挂着的锁链不能消失）
    for(var i=0;i<list.length;i++){ var s=list[i]; sizeSlot(s); try{ if(s.g&&s.g.resize)s.g.resize(W,H);}catch(e){} s.active=true; }
    kick();
  }
  window.addEventListener('resize',resize);
  var bt=0;
  // 横幅：送礼人头像 + 文案（整个窗口共用一条）
  function showBanner(msg,avatar){
    if(!banner)return;
    if(!msg){banner.style.opacity=0;return;}
    var av=avatar||'';
    bannerText.textContent=msg;
    if(av){ bannerAvatar.src=fileUrl(av); bannerAvatar.style.display='block'; } else { bannerAvatar.removeAttribute('src'); bannerAvatar.style.display='none'; }
    banner.style.opacity=1; clearTimeout(bt); bt=setTimeout(function(){banner.style.opacity=0;},2600);
  }
  if(bannerAvatar) bannerAvatar.onerror=function(){ bannerAvatar.style.display='none'; };
  // 左上角计数面板（「已经抓 N 只」那块）排队：几个玩法同时在场时按图层顺序上下排开，不叠在一起。
  // 玩法每次画都报一下自己面板多高（没画就报 0），拿回自己那块的 top；位置变了就叫它重画一帧。
  var HUD_TOP=10, HUD_GAP=8, hudH={}, hudY={};
  function layoutHud(){
    var y=HUD_TOP;
    for(var i=0;i<list.length;i++){
      var s=list[i], h=hudH[s.id]||0;
      if(h>0){ if(hudY[s.id]!==y){ hudY[s.id]=y; wake(s); } y+=h+HUD_GAP; }
      else hudY[s.id]=HUD_TOP;
    }
  }
  function hudSlot(s,h){
    var v=Math.max(0,Number(h)||0);
    if((hudH[s.id]||0)!==v){ hudH[s.id]=v; layoutHud(); }
    return hudY[s.id]!=null?hudY[s.id]:HUD_TOP;
  }
  function makeApi(s){
    return {
      get W(){return W}, get H(){return H}, get cfg(){return s.cfg}, get ctx(){return s.ctx},
      // 计数面板 / 送礼提示画这里（直播窗口里在所有玩法之上，单玩法页面就是自己的画布）
      get hudCtx(){ return ensureHud(s); },
      get preview(){return PREVIEW},
      muted:function(){ return !!window.__MUTED; },
      rand:function(a,b){return a+Math.random()*(b-a)},
      pick:function(arr){return arr[Math.floor(Math.random()*arr.length)]},
      asset:function(rel){ return (window.__ASSET_BASE||'')+String(rel||''); },
      fileUrl:fileUrl,
      loadImage:function(url){ var im=new Image(); im.src=url; return im; },
      sound:function(url,vol){ if(window.__MUTED) return null; try{ var a=new Audio(url); a.volume=Math.max(0,Math.min(1,vol==null?1:vol)); a.play().catch(function(){}); return a; }catch(e){ return null; } },
      // 头像没传就用正在执行的那条命令的（玩法在 apply 里调 banner 时自动带上送礼人）
      banner:function(msg,avatar){ showBanner(msg,avatar!=null?avatar:(s.cur&&s.cur.avatar)||''); },
      cap:function(){ var c=Math.trunc(Number(s.cfg.countCap)||0); return c>0?c:1000000; },
      speed:function(){ var v=Number(s.cfg.speed); return (v>0?v:1); },
      hud:function(h){ return hudSlot(s,h); }
    };
  }
  // 加载一个玩法（已加载就直接返回）。单玩法页面的画布就是 #cv；直播窗口按图层顺序插一层新画布。
  function ensure(id){
    var s=slots[id];
    if(s) return s.g?s:null;
    var fn=CODE[id]; if(typeof fn!=='function') return null;
    var cv=document.getElementById('cv');
    if(!cv||cv.getAttribute('data-game')!==id){
      cv=document.createElement('canvas'); cv.setAttribute('data-game',id);
      var before=null;
      for(var i=0;i<list.length;i++){ if(layerOf(list[i].id)>layerOf(id)){ before=list[i].cv; break; } }
      stage.insertBefore(cv,before);   // DOM 顺序 = 图层顺序，后面的盖在上面
    }
    var m=META[id]||{};
    s={ id:id, cv:cv, ctx:cv.getContext('2d'), cfg:{}, g:null, api:null, active:false, cur:null, interactive:m.interactive===true, anywhere:m.anywhere===true };
    var init=CFGS[id]||{}; for(var k in init) s.cfg[k]=init[k];
    s.api=makeApi(s);
    slots[id]=s;
    list.push(s); list.sort(function(a,b){ return layerOf(a.id)-layerOf(b.id); });
    sizeSlot(s);
    window.__ZL={};   // 玩法代码里的 SHARED_JS 往这个新对象上挂工具，玩法自己抓住它
    LOADING=s;
    try{ fn(); }catch(e){ console.error('special load '+id,e); }
    LOADING=null;
    var zl=window.__ZL;
    // 异步事件（麦克风回调 / 素材加载完）叫醒渲染：只叫醒它自己那层
    if(zl) zl.kick=function(){ wake(s); };
    return s.g?s:null;
  }
  window.registerGame=function(g){
    var s=LOADING; if(!s){ console.error('registerGame 只能在加载玩法时调用'); return; }
    s.g=g;
    try{ if(g.init)g.init(s.api);}catch(e){console.error('game init',e);}
    wake(s);
  };
  var running=false,last=0;
  function post(type,extra){ if(!PREVIEW) return; try{ var m={source:'zl-special',type:type}; if(extra) for(var k in extra) m[k]=extra[k]; window.parent.postMessage(m,'*'); }catch(e){} }
  // 画布上还有没有东西（预览专用）：动画停了不等于画面空了——锁链挂着等主播点、鸭子躺着等抓，都是停着但有内容。
  // 自动演示只在真的空了才再来一波，不然会一直往上叠（2026-10-05 用户：一连直播间就看见一直有人送礼）。
  function canvasEmpty(){
    try{ var s=list[0]; if(!s) return true; var w=s.cv.width,h=s.cv.height; if(!w||!h) return true; var d=s.ctx.getImageData(0,0,w,h).data;
      for(var i=3;i<d.length;i+=64){ if(d[i]>8) return false; } return true; }catch(e){ return false; }
  }
  function frame(now){
    if(document.hidden){ running=false; last=0; return; }
    var dt=last?Math.min(80,now-last):16; last=now;
    var any=false;
    for(var i=0;i<list.length;i++){
      var s=list[i]; if(!s.active||!s.g) continue;
      var a=false;
      try{ a=s.g.tick?!!s.g.tick(dt):false; }catch(e){ console.error('tick '+s.id,e); }
      clearSlot(s);
      try{ if(s.g.draw)s.g.draw(s.ctx); }catch(e){ console.error('draw '+s.id,e); }
      s.active=a; if(a) any=true;
    }
    if(any) requestAnimationFrame(frame); else { running=false; last=0; if(PREVIEW) post('special-idle',{empty:canvasEmpty()}); }
  }
  function kick(){ if(running||document.hidden)return; running=true; last=0; requestAnimationFrame(frame); }
  function wake(s){ if(s) s.active=true; kick(); }
  window.__kick=function(){ for(var i=0;i<list.length;i++) list[i].active=true; kick(); };
  // 测试钩子：手动推一帧（不依赖 rAF / 可见性），返回是否还有活动。离线截图测试用，生产不调用。
  window.__step=function(dt){ var a=false; for(var i=0;i<list.length;i++){ var s=list[i]; if(!s.g) continue; var r=false; try{ r=s.g.tick?!!s.g.tick(Number(dt)||16):false; }catch(e){} clearSlot(s); try{ if(s.g.draw)s.g.draw(s.ctx);}catch(e){} if(r) a=true; } return a; };
  // 还有没有活动：给 id 只问那个玩法，不给问全部
  window.__alive=function(id){ for(var i=0;i<list.length;i++){ var s=list[i]; if(id&&s.id!==id) continue; try{ if(s.g&&s.g.tick&&s.g.tick(0)) return true; }catch(e){} } return false; };
  // 累计统计（有累计数的玩法实现 GAME.stats()，返回 {value:N}）
  window.__stats=function(id){ var s=slots[id||DEFAULT]; try{ return s&&s.g&&s.g.stats?s.g.stats():null; }catch(e){ return null; } };
  // 窗口里已经加载的玩法（按图层从下到上）
  window.__loaded=function(){ return list.filter(function(s){ return !!s.g; }).map(function(s){ return s.id; }); };
  // 测试钩子：拿某个玩法的对象（只读 debug() 用）/ 计数面板排位，生产不调用
  window.__game=function(id){ var s=slots[id||DEFAULT]; return s&&s.g||null; };
  window.__hudLayout=function(){ var out={}; for(var id in hudH){ if(hudH[id]>0) out[id]={ h:hudH[id], y:hudY[id] }; } return out; };
  document.addEventListener('visibilitychange',function(){ if(!document.hidden)kick(); });
  function applyOne(cmd){
    if(!cmd||typeof cmd!=='object') return false;
    var id=String(cmd.game||DEFAULT||''); var s=id?ensure(id):null; if(!s) return false;
    s.cur=cmd;
    try{ if(s.g.apply)s.g.apply(cmd); }catch(e){ console.error('apply '+id,e);}
    // 盲盒开出来的：用「某某的盲盒开出：…」盖掉玩法自己的横幅
    if(cmd.announce) showBanner(String(cmd.announce),cmd.avatar||'');
    s.cur=null;
    wake(s);
    return true;
  }
  window.__apply=function(cmd){
    try{ if(typeof cmd==='string')cmd=JSON.parse(cmd);}catch(e){cmd={};}
    return applyOne(cmd||{});
  };
  // 一次下发好几条（盲盒一份礼物开出好几样），最后统一盖一条开出提示
  window.__applyMany=function(cmds,announce,avatar){
    var n=0; cmds=cmds||[];
    for(var i=0;i<cmds.length;i++){ if(applyOne(cmds[i])) n++; }
    if(announce) showBanner(String(announce),avatar||'');
    return n;
  };
  window.__banner=function(msg,avatar){ showBanner(String(msg||''),avatar||''); };
  // 玩法配置：给 id 改那个玩法（还没加载就先记着，加载时用）；不给 id = 单玩法页面的那个玩法
  window.__config=function(next,id){
    try{ if(typeof next==='string')next=JSON.parse(next);}catch(e){return;}
    next=next||{};
    var gid=String(id||DEFAULT||''); if(!gid) return;
    var c=CFGS[gid]||(CFGS[gid]={}); for(var k in next) c[k]=next[k];
    var s=slots[gid];
    if(s){ for(var k2 in next) s.cfg[k2]=next[k2]; try{ if(s.g&&s.g.config)s.g.config(s.cfg);}catch(e){} wake(s); }
    // 单玩法页（离线测试 / 缩略图）沿用老习惯：配置里带底色就换页面底色
    if(!id&&!PREVIEW&&next.background) document.body.style.background=next.background==='transparent'?'transparent':'#00FF00';
  };
  // 窗口设置（全部玩法共用）：底色
  window.__window=function(next){
    try{ if(typeof next==='string')next=JSON.parse(next);}catch(e){return;}
    next=next||{};
    if(next.background==='green'||next.background==='transparent'){
      if(!PREVIEW) document.body.style.background=next.background==='transparent'?'transparent':'#00FF00';
      for(var id in CFGS) CFGS[id].background=next.background;
      for(var i=0;i<list.length;i++){ var s=list[i]; s.cfg.background=next.background; try{ if(s.g&&s.g.config)s.g.config(s.cfg);}catch(e){} wake(s); }
    }
  };
  window.__mute=function(on){ window.__MUTED=!!on; for(var i=0;i<list.length;i++){ var s=list[i]; try{ if(s.g&&s.g.mute)s.g.mute(!!on);}catch(e){} } };
  if(PREVIEW){
    window.addEventListener('message',function(e){
      var m=e&&e.data; if(!m||m.source!=='zl-special-host') return;
      if(m.type==='apply') window.__apply(m.cmd||{});
      else if(m.type==='config') window.__config(m.cfg||{});
      else if(m.type==='mute') window.__mute(m.value);
    });
  }
  if(hit){
    var owner=null, receivers=[], tap=null;
    var mapPt=function(e){ var r=hit.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; };
    // 玩法的 pointer 返回 true = 这一下点中了它的东西（接住了），下面的玩法就不再收到
    function send(s,type,x,y){ var r=false; try{ r=s.g.pointer(type,x,y)===true; }catch(_){} wake(s); return r; }
    function takers(anywhere){ var out=[]; for(var i=list.length-1;i>=0;i--){ var s=list[i]; if(!s.g||!s.g.pointer||!s.interactive) continue; if(s.anywhere===anywhere) out.push(s); } return out; }
    function giveAnywhere(x,y){ var any=takers(true); for(var j=0;j<any.length;j++){ receivers.push(any[j]); if(send(any[j],'down',x,y)) return any[j]; } return null; }
    hit.addEventListener('pointerdown',function(e){
      var p=mapPt(e); owner=null; receivers=[]; tap=null;
      var first=takers(false);
      for(var i=0;i<first.length;i++){ receivers.push(first[i]); if(send(first[i],'down',p[0],p[1])){ owner=first[i]; break; } }
      if(!owner){
        // 窗口里只有「点哪都算」的玩法时立刻给；有别的玩法在场就等抬起：没拖动、没点中别的，才算一下
        if(!first.length) owner=giveAnywhere(p[0],p[1]);
        else if(takers(true).length) tap={x:p[0],y:p[1]};
      }
      try{ hit.setPointerCapture(e.pointerId); }catch(_){}
      kick(); e.stopPropagation();
    },true);
    hit.addEventListener('pointermove',function(e){
      var p=mapPt(e);
      if(tap&&(Math.abs(p[0]-tap.x)>12||Math.abs(p[1]-tap.y)>12)) tap=null;
      if(owner){ send(owner,'move',p[0],p[1]); return; }
      for(var i=list.length-1;i>=0;i--){ var s=list[i]; if(s.g&&s.g.pointer&&s.interactive){ try{ s.g.pointer('move',p[0],p[1]); }catch(_){} } }
    },true);
    function finish(e,cancel){
      var p=cancel?[-1,-1]:mapPt(e);
      var to=receivers.slice(); if(owner&&to.indexOf(owner)<0) to.push(owner);
      for(var k=0;k<to.length;k++) send(to[k],'up',p[0],p[1]);
      if(!cancel&&tap&&!owner) giveAnywhere(tap.x,tap.y);
      owner=null; receivers=[]; tap=null;
    }
    hit.addEventListener('pointerup',function(e){ finish(e,false); },true);
    hit.addEventListener('pointercancel',function(e){ finish(e,true); },true);
  }
  resize();
  if(DEFAULT) ensure(DEFAULT);
  setTimeout(function(){ post('special-ready'); },0);
})();`

const PAGE_CSS = `
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
body{position:relative;}
#stage{position:absolute;inset:0;z-index:1;pointer-events:none;}
#stage canvas,#hud canvas{position:absolute;left:0;top:0;display:block;pointer-events:none;}
#hud{position:absolute;inset:0;z-index:30;pointer-events:none;}
#hit{position:absolute;inset:0;z-index:40;touch-action:none;}
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
`

// 玩法代码包成函数：用到时才执行（代码字符串本身是顶层脚本，放进函数体里语义不变）
function codeTable(entries: { id: string; code: string }[]): string {
  return `window.__GAME_CODE={${entries.map((e) => `${JSON.stringify(e.id)}:function(){\n${e.code}\n}`).join(',\n')}};`
}

function gameMeta(meta: SpecialGameMeta): { interactive: boolean; anywhere: boolean } {
  return { interactive: meta.interactive, anywhere: meta.pointerAnywhere === true }
}

export interface SpecialPageOptions {
  /** 详情页预览：静音、不开麦克风、不显示拖窗把手，接收 postMessage */
  preview?: boolean
  /** 本地文件的 URL 前缀（预览用 zlspecial://app/file/）；空 = file:/// */
  fileBase?: string
  /** 底色（玩法也会读到）；不给就看 cfg 里有没有老字段 background，再不然绿幕 */
  background?: SpecialWindowConfig['background']
}

/** 只装一个玩法的页面：详情页预览、离线测试、缩略图。画布是 #cv。 */
export function buildSpecialPage(meta: SpecialGameMeta, cfg: SpecialGameConfig, code: string, assetBase = '', options: SpecialPageOptions = {}): string {
  const preview = options.preview === true
  const legacyBg = (cfg as Partial<{ background: string }>).background
  const background: SpecialWindowConfig['background'] = options.background ?? (legacyBg === 'transparent' ? 'transparent' : 'green')
  const handle = meta.interactive && !preview ? '<div id="grip" title="拖动摆放窗口">⋮⋮ 拖动</div>' : ''
  // 预览底色交给外层舞台（棋盘格/绿幕由渲染层画），页面本身透明
  const bodyBg = preview ? 'transparent' : background === 'transparent' ? 'transparent' : '#00FF00'
  const passThrough = !meta.interactive && !preview
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>${PAGE_CSS}
body{background:${bodyBg};${passThrough ? 'pointer-events:none;' : ''}}
</style></head><body>
<div id="stage"><canvas id="cv" data-game="${meta.id}"${meta.interactive ? ' data-nodrag' : ''}></canvas></div>
${meta.interactive ? '<div id="hit" data-nodrag></div>' : ''}
<div id="banner"><img id="bav" alt=""><span id="btx"></span></div>
${handle}
<script>window.__INITIAL_CFGS=${scriptJson({ [meta.id]: specialPageConfig(cfg, background) })};window.__GAME_META=${scriptJson({ [meta.id]: gameMeta(meta) })};window.__LAYER_ORDER=${scriptJson([meta.id])};window.__DEFAULT_GAME=${scriptJson(meta.id)};window.__PREVIEW=${preview ? 'true' : 'false'};window.__ASSET_BASE=${scriptJson(assetBase)};window.__FILE_BASE=${scriptJson(options.fileBase || '')};</script>
<script>${codeTable([{ id: meta.id, code }])}</script>
<script>${HARNESS_JS}</script>
</body></html>`
}

/** 直播窗口「特色整蛊」：全部玩法同一个页面，用到哪个才加载哪个；图层顺序见 SPECIAL_LAYER_ORDER。 */
export function buildSpecialWindowPage(
  games: { meta: SpecialGameMeta; cfg: SpecialGameConfig; code: string }[],
  win: SpecialWindowConfig,
  layerOrder: string[],
  assetBase = ''
): string {
  const cfgs: Record<string, unknown> = {}
  const metas: Record<string, unknown> = {}
  for (const g of games) {
    cfgs[g.meta.id] = specialPageConfig(g.cfg, win.background)
    metas[g.meta.id] = gameMeta(g.meta)
  }
  const bodyBg = win.background === 'transparent' ? 'transparent' : '#00FF00'
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>特色整蛊</title><style>${PAGE_CSS}
body{background:${bodyBg};}
</style></head><body>
<div id="stage"></div>
<div id="hud"></div>
<div id="hit" data-nodrag></div>
<div id="banner"><img id="bav" alt=""><span id="btx"></span></div>
<div id="grip" title="拖动摆放窗口">⋮⋮ 拖动</div>
<script>window.__INITIAL_CFGS=${scriptJson(cfgs)};window.__GAME_META=${scriptJson(metas)};window.__LAYER_ORDER=${scriptJson(layerOrder)};window.__DEFAULT_GAME='';window.__PREVIEW=false;window.__ASSET_BASE=${scriptJson(assetBase)};window.__FILE_BASE='';</script>
<script>${codeTable(games.filter((g) => !!g.code).map((g) => ({ id: g.meta.id, code: g.code })))}</script>
<script>${HARNESS_JS}</script>
</body></html>`
}
