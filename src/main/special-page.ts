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
// - 盲盒开奖（直播窗口才有 #fx 这层）：锣 + 「锁链+5」+ AI 配音逐条播，每条在锣响时生效，见 __reveal。
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
  // 盲盒开奖画面（锣 + 「锁链+5」）画在这一层：直播窗口才有，盖在玩法和计数面板上面
  var fx=document.getElementById('fx'), fxc=fx?fx.getContext('2d'):null;
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
    if(fx) sizeCanvas(fx,fxc);
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
  // 全部清屏的收尾（各玩法的场面由各自的 clear 收）：横幅立刻收起，还在响的玩法音效掐掉
  window.__wipe=function(){
    clearTimeout(bt); showBanner('');
    var l=window.__zlSounds||[];
    for(var i=0;i<l.length;i++){ try{ l[i].pause(); }catch(e){} }
  };
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
  var running=false,last=0,lastTick=0;
  // 帧率上限（0 = 跟显示器）：透明 / 绿幕窗口每画一帧都要整窗刷新给直播伴侣，主进程也跟着忙；
  // 直播推流一般 30 帧，画到 30 帧就够了，没到时间的那一帧只排下一帧、不推不画。
  var FPS=Math.max(0,Number(window.__FPS)||0);
  function frameDue(now,since){ return !(FPS>0&&since&&now-since<1000/FPS-2); }
  function post(type,extra){ if(!PREVIEW) return; try{ var m={source:'zl-special',type:type}; if(extra) for(var k in extra) m[k]=extra[k]; window.parent.postMessage(m,'*'); }catch(e){} }
  // 画布上还有没有东西（预览专用）：动画停了不等于画面空了——锁链挂着等主播点、鸭子躺着等抓，都是停着但有内容。
  // 自动演示只在真的空了才再来一波，不然会一直往上叠（2026-10-05 用户：一连直播间就看见一直有人送礼）。
  function canvasEmpty(){
    try{ var s=list[0]; if(!s) return true; var w=s.cv.width,h=s.cv.height; if(!w||!h) return true; var d=s.ctx.getImageData(0,0,w,h).data;
      for(var i=3;i<d.length;i+=64){ if(d[i]>8) return false; } return true; }catch(e){ return false; }
  }
  function frame(now){
    if(document.hidden){ running=false; last=0; lastTick=0; return; }
    if(!frameDue(now,lastTick)){ requestAnimationFrame(frame); return; }
    lastTick=now;
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
  function kick(){ if(running||document.hidden)return; running=true; last=0; lastTick=0; requestAnimationFrame(frame); }
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
  document.addEventListener('visibilitychange',function(){ if(!document.hidden){ kick(); if(rcur) drawStart(); } });
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
  // 窗口设置（全部玩法共用）：底色、帧率上限
  window.__window=function(next){
    try{ if(typeof next==='string')next=JSON.parse(next);}catch(e){return;}
    next=next||{};
    if(next.fps!=null){ FPS=Math.max(0,Number(next.fps)||0); lastTick=0; }
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

  // ===== 盲盒开奖（照时间盲盒那批视频）：锤子敲一声锣、蹦出「锁链+5」，接着 AI 配音念「锁链加5」 =====
  // 一条一条排队播（同时间盲盒「连击逐项播放」），每条开出的玩法在锣响那一刻生效。
  // 声音走 Web Audio：先解码量一下（开口在哪、念多长、人声统一到时间盲盒配音的响度），锣和人声按设置的间隔排准。
  // 配音还在现念（主播自己写的台词、冷门数量）的那条排到时最多等 VOICE_WAIT，等不到就只出画面不念。
  var RV=window.__REVEAL||{};
  var rq=[], rcur=null, rraf=0, rtimer=0, rwait=0, actx=null, clips={}, clipKeys=[];
  var WIND=0.12, FADE=0.3, VOICE_WAIT=2500, MIN_SHOW=1.1;
  function vol(v){ var n=v==null?100:Number(v); return Math.max(0,Math.min(1,(isFinite(n)?n:100)/100)); }
  function revealOn(){ return RV.enabled!==false; }
  function audio(){
    if(!actx){ try{ var AC=window.AudioContext||window.webkitAudioContext; actx=AC?new AC():null; }catch(e){ actx=null; } }
    return actx;
  }
  // 声音模块闲下来就歇着（开着的音频线程不播也一直在跑）；要开奖了再叫醒，叫醒完才排锣和人声的时间
  var rsleep=0;
  function wakeAudio(){
    clearTimeout(rsleep);
    var ac=audio();
    if(ac&&ac.state==='suspended'){ try{ return ac.resume().catch(function(){}); }catch(e){} }
    return null;
  }
  function sleepAudio(){
    clearTimeout(rsleep);
    rsleep=setTimeout(function(){ if(!rcur&&!rq.length&&actx&&actx.state==='running'){ try{ actx.suspend(); }catch(e){} } },4000);
  }
  // 读文件：fetch，不行再退 XHR（file:// 页面两条路都留着）
  function loadBytes(url){
    return new Promise(function(resolve,reject){
      function viaXhr(){
        try{ var x=new XMLHttpRequest(); x.open('GET',url); x.responseType='arraybuffer';
          x.onload=function(){ if(x.response&&x.response.byteLength>0) resolve(x.response); else reject(new Error('empty')); };
          x.onerror=function(){ reject(new Error('xhr')); }; x.send(); }catch(e){ reject(e); }
      }
      try{ fetch(url).then(function(r){ if(!r.ok&&r.status!==0) throw new Error('http '+r.status); return r.arrayBuffer(); }).then(resolve).catch(viaXhr); }catch(e){ viaXhr(); }
    });
  }
  // 量一下：开口在哪（跳过开头的静音）、响到哪、人声要放大多少（统一到时间盲盒配音的响度，峰值不破音）
  function measure(buf,norm){
    var d=buf.getChannelData(0), n=d.length, sr=buf.sampleRate, peak=0, i, v;
    for(i=0;i<n;i++){ v=d[i]<0?-d[i]:d[i]; if(v>peak) peak=v; }
    if(peak<0.0001) return null;
    var th=peak*0.018, a=0, b=n-1;
    while(a<n&&(d[a]<0?-d[a]:d[a])<th) a++;
    while(b>a&&(d[b]<0?-d[b]:d[b])<th) b--;
    a=Math.max(0,a-Math.round(0.025*sr)); b=Math.min(n-1,b+Math.round(0.06*sr));
    var gain=1;
    if(norm){ var s=0; for(i=a;i<=b;i++) s+=d[i]*d[i]; var rms=Math.sqrt(s/Math.max(1,b-a+1)); gain=Math.max(0.25,Math.min(4,0.125/Math.max(0.000001,rms),0.98/peak)); }
    return { buf:buf, off:a/sr, dur:Math.max(0.05,(b-a)/sr), gain:gain, peak:peak };
  }
  function clip(url,norm){
    if(!url) return Promise.resolve(null);
    var key=(norm?'v ':'g ')+url;
    if(clips[key]) return clips[key];
    var p=loadBytes(url).then(function(bytes){
      var ac=audio(); if(!ac) throw new Error('no-audio');
      return new Promise(function(res,rej){ var r=ac.decodeAudioData(bytes,res,rej); if(r&&r.then) r.then(res,rej); });
    }).then(function(buf){ return measure(buf,norm); }).catch(function(){ return null; });
    clips[key]=p; clipKeys.push(key);
    if(clipKeys.length>120){ delete clips[clipKeys.shift()]; }
    return p;
  }
  function play(info,when,v){
    var ac=audio(); if(!ac||!info||!(v>0)) return null;
    try{ var src=ac.createBufferSource(); src.buffer=info.buf; var g=ac.createGain(); g.gain.value=v*info.gain;
      src.connect(g); g.connect(ac.destination); src.start(Math.max(ac.currentTime,when),info.off,info.dur); return src; }catch(e){ return null; }
  }
  function pending(){ return rq.length+(rcur?1:0); }
  // 生效：盲盒开出来的，生效后把「某某的盲盒开出：…」再盖回去（玩法自己的横幅别把它顶掉，和以前一次下发时一样）
  function runCmds(it){ if(!it||it.applied) return; it.applied=true; var c=it.cmds||[]; for(var i=0;i<c.length;i++) applyOne(c[i]); if(it.announce) showBanner(String(it.announce),it.avatar||''); }
  function prep(it){ it.vclip=(RV.voice!==false&&it.voice)?clip(it.voice,true):null; }
  function pump(){
    clearTimeout(rwait);
    if(rcur||!rq.length) return;
    var it=rq[0];
    if(!it.headAt) it.headAt=Date.now();
    if(it.vid&&!it.voice&&RV.voice!==false&&Date.now()-it.headAt<VOICE_WAIT){ rwait=setTimeout(pump,100); return; }
    rq.shift();
    if(it.video) startVideoReveal(it); else startReveal(it);
  }
  function startReveal(it){
    rcur=it;
    var muted=!!window.__MUTED, sing=!muted&&RV.voice!==false, ring=!muted&&RV.gong!==false&&!!RV.gongUrl;
    Promise.all([ring?clip(RV.gongUrl,false):null, sing?(it.vclip||null):null, (ring||sing)?wakeAudio():null]).then(function(r){
      if(rcur!==it) return;
      var g=r[0], v=r[1], ac=g||v?audio():null;
      var wind=RV.showGong!==false?WIND:0, gap=Math.max(0,Number(RV.gapMs)||0)/1000;
      var now=ac?ac.currentTime:0, impact=now+wind, vAt=impact+(g?gap:0.05);
      if(g) play(g,impact,vol(RV.gongVolume));
      if(v) play(v,vAt,vol(RV.voiceVolume));
      var hold=Math.max(0,Number(RV.holdMs)||0)/1000;
      var endIn=Math.max(wind+MIN_SHOW,v?vAt-now+v.dur:0)+hold;
      var t0=performance.now();
      it.impact=t0+wind*1000; it.end=t0+endIn*1000;
      setTimeout(function(){ if(rcur===it) runCmds(it); },wind*1000);
      clearTimeout(rtimer); rtimer=setTimeout(function(){ if(rcur===it) endReveal(false); },endIn*1000);
      drawStart();
    });
  }
  function endReveal(drop){
    var it=rcur; rcur=null; clearTimeout(rtimer);
    stopVideo();
    if(it&&!drop) runCmds(it);
    // 收起：开奖这层整个藏起来（不播的时候不占合成），排空了让声音模块歇着
    if(fxc){ fxc.clearRect(0,0,W,H); fx.style.display='none'; }
    clearTimeout(rwait); rwait=setTimeout(pump,120);
    if(!rq.length) sleepAudio();
  }
  // 主进程下发：items 逐条开奖；rest 是排不下的（直接生效）；announce = 顶上那条「某某的盲盒开出：…」
  window.__reveal=function(items,rest,announce,avatar){
    items=items||[]; rest=rest||[];
    for(var i=0;i<rest.length;i++) applyOne(rest[i]);
    if(announce) showBanner(String(announce),avatar||'');
    var cap=Math.trunc(Number(RV.maxQueue)||0);
    for(var j=0;j<items.length;j++){
      var it=items[j]; if(!it) continue;
      it.announce=announce||''; it.avatar=avatar||'';
      if(!revealOn()||(cap>0&&pending()>=cap)){ runCmds(it); continue; }
      prep(it); rq.push(it);
    }
    if(RV.gong!==false&&RV.gongUrl) clip(RV.gongUrl,false);
    pump();
    return pending();
  };
  window.__revealPending=function(){ return pending(); };
  // 现念的配音好了（url 空 = 念不出来，这条就只出画面）
  window.__revealVoice=function(vid,url){
    for(var i=0;i<rq.length;i++){ var it=rq[i]; if(it.vid===vid&&!it.voice){ it.voice=String(url||''); it.vid=''; prep(it); } }
    pump();
  };
  // 全部清屏：排着的开奖不播了（也不生效）
  window.__revealClear=function(){ rq.length=0; if(rcur) endReveal(true); };
  window.__revealConfig=function(next){
    try{ if(typeof next==='string')next=JSON.parse(next);}catch(e){return;}
    next=next||{}; for(var k in next) RV[k]=next[k];
    // 关掉开奖画面：排着的立刻生效，一份都不丢
    if(!revealOn()){ var q=rq.splice(0,rq.length); for(var i=0;i<q.length;i++) runCmds(q[i]); if(rcur) endReveal(false); }
    else for(var j=0;j<rq.length;j++) prep(rq[j]);
  };
  // 测试钩子：排队情况 / 量一个声音文件（不出声），生产不调用
  window.__revealState=function(){ return { pending:pending(), current:rcur?{ text:rcur.text, applied:!!rcur.applied, impact:rcur.impact||0, end:rcur.end||0, voiced:!!rcur.voice, video:!!rcur.video, key:rcur.video&&vkey?vkey:null, shown:!!(fxv&&fxv.style.display==='block') }:null, queue:rq.map(function(x){ return x.text; }) }; };

  // ===== 开奖视频（事件配了视频的，照时间盲盒那种）：<video> 解码，WebGL 抠掉绿幕底色画到 #fxv 这层 =====
  // 第一帧出来时从四个角量底色（路师傅那批鸭子视频的底是偏黄的绿，不是纯绿），玩法在这一刻生效；放完收起。
  // 画布按显示尺寸开（乘设备像素比），不按 2880×2160 原片开；视频帧回调也守帧率上限。
  var fxv=document.getElementById('fxv'), vid=document.getElementById('fxvid'), vgl=null, vtex=null, vuni={}, vkey=null, lastV=0;
  function vglInit(){
    if(vgl) return true; if(!fxv) return false;
    try{ vgl=fxv.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false}); }catch(e){ vgl=null; }
    if(!vgl) return false;
    var VS='attribute vec2 p; varying vec2 vUv; void main(){ vUv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5); gl_Position=vec4(p,0.0,1.0); }';
    var FS='precision mediump float; varying vec2 vUv; uniform sampler2D uTex; uniform vec3 uKey; uniform float uSim; uniform float uSmooth; uniform float uSpill;'
      +' vec2 uv(vec3 c){ return vec2(-0.169*c.r-0.331*c.g+0.5*c.b, 0.5*c.r-0.419*c.g-0.081*c.b); }'
      +' void main(){ vec4 c=texture2D(uTex,vUv); float d=distance(uv(c.rgb),uv(uKey)); float a=smoothstep(uSim,uSim+uSmooth+0.001,d);'
      +' float s=uSpill*(1.0-a); vec3 rgb=mix(c.rgb,vec3(c.r,min(c.g,max(c.r,c.b)),c.b),s); gl_FragColor=vec4(rgb,c.a*a); }';
    function sh(t,src){ var s=vgl.createShader(t); vgl.shaderSource(s,src); vgl.compileShader(s); return vgl.getShaderParameter(s,vgl.COMPILE_STATUS)?s:null; }
    var vs=sh(vgl.VERTEX_SHADER,VS), fs=sh(vgl.FRAGMENT_SHADER,FS);
    if(!vs||!fs){ vgl=null; return false; }
    var prog=vgl.createProgram(); vgl.attachShader(prog,vs); vgl.attachShader(prog,fs); vgl.linkProgram(prog);
    if(!vgl.getProgramParameter(prog,vgl.LINK_STATUS)){ vgl=null; return false; }
    vgl.useProgram(prog);
    var b=vgl.createBuffer(); vgl.bindBuffer(vgl.ARRAY_BUFFER,b); vgl.bufferData(vgl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),vgl.STATIC_DRAW);
    var loc=vgl.getAttribLocation(prog,'p'); vgl.enableVertexAttribArray(loc); vgl.vertexAttribPointer(loc,2,vgl.FLOAT,false,0,0);
    vuni.tex=vgl.getUniformLocation(prog,'uTex'); vuni.key=vgl.getUniformLocation(prog,'uKey'); vuni.sim=vgl.getUniformLocation(prog,'uSim');
    vuni.smooth=vgl.getUniformLocation(prog,'uSmooth'); vuni.spill=vgl.getUniformLocation(prog,'uSpill');
    vtex=vgl.createTexture(); vgl.bindTexture(vgl.TEXTURE_2D,vtex);
    vgl.texParameteri(vgl.TEXTURE_2D,vgl.TEXTURE_WRAP_S,vgl.CLAMP_TO_EDGE); vgl.texParameteri(vgl.TEXTURE_2D,vgl.TEXTURE_WRAP_T,vgl.CLAMP_TO_EDGE);
    vgl.texParameteri(vgl.TEXTURE_2D,vgl.TEXTURE_MIN_FILTER,vgl.LINEAR); vgl.texParameteri(vgl.TEXTURE_2D,vgl.TEXTURE_MAG_FILTER,vgl.LINEAR);
    vgl.clearColor(0,0,0,0);
    return true;
  }
  function hexRgb(h){ h=String(h||'#00ff00').replace('#',''); var n=parseInt(h,16); if(!isFinite(n)) n=65280; return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; }
  // 四个角颜色差不多、又够艳（绿幕 / 蓝幕），就当底色；量不出来用设置里的颜色
  function autoKey(){
    try{
      var c=document.createElement('canvas'); c.width=32; c.height=24; var x=c.getContext('2d'); x.drawImage(vid,0,0,32,24);
      var d=x.getImageData(0,0,32,24).data, pts=[[1,1],[30,1],[1,22],[30,22]], cs=[], i;
      for(i=0;i<pts.length;i++){ var o=(pts[i][1]*32+pts[i][0])*4; cs.push([d[o]/255,d[o+1]/255,d[o+2]/255]); }
      var m=[0,0,0]; for(i=0;i<cs.length;i++){ m[0]+=cs[i][0]/4; m[1]+=cs[i][1]/4; m[2]+=cs[i][2]/4; }
      for(i=0;i<cs.length;i++){ if(Math.abs(cs[i][0]-m[0])+Math.abs(cs[i][1]-m[1])+Math.abs(cs[i][2]-m[2])>0.2) return null; }
      if(Math.max(m[0],m[1],m[2])-Math.min(m[0],m[1],m[2])<0.25) return null;
      return m;
    }catch(e){ return null; }
  }
  function layoutVideo(){
    var vw=vid.videoWidth, vh=vid.videoHeight; if(!vw||!vh) return;
    var sc=Math.min(W/vw,H/vh)*Math.max(0.2,Math.min(1,(Number(RV.videoScale)||100)/100));
    var w=Math.max(1,Math.round(vw*sc)), h=Math.max(1,Math.round(vh*sc));
    fxv.style.width=w+'px'; fxv.style.height=h+'px'; fxv.style.left=Math.round((W-w)/2)+'px'; fxv.style.top=Math.round((H-h)/2)+'px';
    var cw=Math.max(1,Math.round(w*DPR)), ch=Math.max(1,Math.round(h*DPR));
    if(fxv.width!==cw||fxv.height!==ch){ fxv.width=cw; fxv.height=ch; }
    vgl.viewport(0,0,cw,ch);
  }
  function renderVideo(){
    vgl.bindTexture(vgl.TEXTURE_2D,vtex);
    try{ vgl.texImage2D(vgl.TEXTURE_2D,0,vgl.RGBA,vgl.RGBA,vgl.UNSIGNED_BYTE,vid); }catch(e){ return; }
    vgl.uniform1i(vuni.tex,0);
    vgl.uniform3fv(vuni.key,vkey||hexRgb(RV.videoKeyColor));
    vgl.uniform1f(vuni.sim,Math.max(0.01,(Number(RV.videoSimilarity)||0)/100*0.6));
    vgl.uniform1f(vuni.smooth,Math.max(0.002,(Number(RV.videoSmoothness)||0)/100*0.35));
    vgl.uniform1f(vuni.spill,(Number(RV.videoSpill)||0)/100);
    vgl.clear(vgl.COLOR_BUFFER_BIT); vgl.drawArrays(vgl.TRIANGLE_STRIP,0,4);
  }
  function stopVideo(){
    if(!vid) return;
    vid.onended=null; vid.onerror=null;
    if(vid.getAttribute('src')){ try{ vid.pause(); }catch(e){} vid.removeAttribute('src'); try{ vid.load(); }catch(e){} }
    if(fxv) fxv.style.display='none';
    if(vgl){ try{ vgl.clear(vgl.COLOR_BUFFER_BIT); }catch(e){} }
  }
  function startVideoReveal(it){
    rcur=it;
    // 放不了视频（没有 WebGL）就退回锣 + 大字
    if(!vid||!vglInit()){ it.video=''; startReveal(it); return; }
    vkey=null; lastV=0;
    var done=false, started=false;
    function finish(){
      if(done||rcur!==it) return;
      done=true; stopVideo();
      // 勾了「放视频时也念」：视频放完再念一句
      if(it.vclip&&RV.voice!==false&&!window.__MUTED){
        Promise.all([it.vclip,wakeAudio()]).then(function(r){
          if(rcur!==it) return;
          var v=r[0], ac=v?audio():null;
          if(!v||!ac){ endReveal(false); return; }
          play(v,ac.currentTime+0.05,vol(RV.voiceVolume));
          clearTimeout(rtimer); rtimer=setTimeout(function(){ if(rcur===it) endReveal(false); },(v.dur+0.35)*1000);
        });
      } else endReveal(false);
    }
    function draw(now){
      if(done||rcur!==it) return;
      if(vid.readyState>=2&&frameDue(now||performance.now(),lastV)){
        lastV=now||performance.now();
        if(!started){
          started=true;
          vkey=RV.videoKeyAuto!==false?autoKey():null;
          fxv.style.display='block';
          it.impact=performance.now();
          runCmds(it);
        }
        layoutVideo(); renderVideo();
      }
      if(vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(function(t){ draw(t); }); else requestAnimationFrame(draw);
    }
    vid.muted=!!window.__MUTED; vid.volume=vol(it.videoVolume);
    vid.onended=finish; vid.onerror=finish;
    vid.src=it.video;
    // 保险：一分钟还没放完也收（文件坏了、解码卡住）
    clearTimeout(rtimer); rtimer=setTimeout(finish,60000);
    var p=vid.play(); if(p&&p.catch) p.catch(function(){ finish(); });
    draw();
  }
  window.__revealProbe=function(url,norm){ return clip(String(url||''),norm!==false).then(function(m){ return m?{ off:m.off, dur:m.dur, gain:m.gain, peak:m.peak, rate:m.buf.sampleRate }:null; }); };

  var lastFx=0;
  function drawStart(){ if(!fxc) return; fx.style.display='block'; if(!rraf){ lastFx=0; rraf=requestAnimationFrame(drawFrame); } }
  function drawFrame(now){
    rraf=0; if(!fxc) return;
    var it=rcur; if(!it||!it.impact){ fxc.clearRect(0,0,W,H); return; }
    // 帧率上限同玩法那一层
    if(frameDue(now,lastFx)){
      lastFx=now;
      fxc.clearRect(0,0,W,H);
      try{ drawCard(fxc,it,now); }catch(e){ console.error('reveal draw',e); }
    }
    rraf=requestAnimationFrame(drawFrame);
  }
  window.__revealDraw=function(t){ if(!fxc||!rcur||!rcur.impact) return false; fx.style.display='block'; fxc.clearRect(0,0,W,H); drawCard(fxc,rcur,rcur.impact+Number(t||0)*1000); return true; };
  function easeBack(k){ var s=1.70158; k=k-1; return k*k*((s+1)*k+s)+1; }
  var FONT='"Microsoft YaHei","PingFang SC","Heiti SC",sans-serif';
  function drawCard(c,it,now){
    var t=(now-it.impact)/1000, left=(it.end-now)/1000;
    var S=Math.min(W,H)/720*Math.max(0.3,(Number(RV.scale)||100)/100);
    var gong=RV.showGong!==false;
    var text=String(it.text||''), sub=String(it.sub||'');
    // 先按设定大小量一遍，放不下就整体缩小
    for(var pass=0;pass<2;pass++){
      var R=46*S, F=Math.round(66*S), SF=Math.round(26*S);
      c.font='900 '+F+'px '+FONT; var tw=c.measureText(text).width;
      var sw=0; if(sub){ c.font='700 '+SF+'px '+FONT; sw=c.measureText(sub).width; }
      var gw=gong?R*3.3:0, cw=gw+Math.max(tw,sw)+F*0.35, pad=24*S;
      if(pass===0&&cw>W-pad*2){ S*=(W-pad*2)/cw; continue; }
      break;
    }
    var pos=RV.position||'top', x0, cy;
    if(pos==='top-left'){ x0=pad; cy=H*0.2; }
    else if(pos==='top-right'){ x0=W-pad-cw; cy=H*0.2; }
    else { x0=(W-cw)/2; cy=pos==='center'?H*0.5:pos==='bottom'?H*0.8:H*0.22; }
    var fade=left<FADE?Math.max(0,left/FADE):1, appear=Math.max(0,Math.min(1,(t+WIND)/0.08));
    c.save(); c.globalAlpha=fade*appear; c.translate(0,(1-fade)*-16*S);
    if(gong) drawGong(c,x0+R*1.05,cy,R,t);
    var k=Math.max(0,Math.min(1,(t+0.02)/0.3));
    if(k>0){
      var sc=0.35+0.65*easeBack(k), tx=x0+gw+F*0.15+Math.max(tw,sw)/2, ty=cy-(sub?SF*0.6:0);
      c.save(); c.translate(tx,ty); c.scale(sc,sc); c.globalAlpha=fade*Math.min(1,k*3);
      drawWord(c,text,F);
      c.restore();
      if(sub){
        c.save(); c.globalAlpha=fade*Math.min(1,k*2); c.font='700 '+SF+'px '+FONT; c.textAlign='center'; c.textBaseline='middle'; c.lineJoin='round';
        c.lineWidth=SF*0.28; c.strokeStyle='rgba(20,30,80,.9)'; c.strokeText(sub,tx,ty+F*0.62+SF*0.2);
        c.fillStyle='#fff6c8'; c.fillText(sub,tx,ty+F*0.62+SF*0.2); c.restore();
      }
    }
    c.restore();
  }
  // 大字照时间盲盒视频里的「时间×2」：白到浅蓝的渐变字、蓝描边、外圈粉
  function drawWord(c,text,F){
    c.font='900 '+F+'px '+FONT; c.textAlign='center'; c.textBaseline='middle'; c.lineJoin='round'; c.miterLimit=2;
    c.lineWidth=F*0.3; c.strokeStyle='#ff4fa8'; c.strokeText(text,0,0);
    c.lineWidth=F*0.17; c.strokeStyle='#2147d9'; c.strokeText(text,0,0);
    var g=c.createLinearGradient(0,-F*0.5,0,F*0.5); g.addColorStop(0,'#ffffff'); g.addColorStop(0.55,'#e9f6ff'); g.addColorStop(1,'#8fd3ff');
    c.fillStyle=g; c.fillText(text,0,0);
  }
  function drawGong(c,x,y,R,t){
    var top=y-R*1.32, wob=t>0?0.14*Math.exp(-3.4*t)*Math.sin(19*t):0, pulse=t>0?1+0.09*Math.exp(-8*t):1, TAU=Math.PI*2;
    c.save(); c.lineCap='round';
    c.strokeStyle='#6b3a12'; c.lineWidth=Math.max(2,R*0.12);
    c.beginPath(); c.moveTo(x-R*0.85,top); c.lineTo(x+R*0.85,top); c.stroke();
    c.translate(x,top); c.rotate(wob);
    c.strokeStyle='#d6242a'; c.lineWidth=Math.max(1.5,R*0.05);
    c.beginPath(); c.moveTo(-R*0.55,0); c.lineTo(-R*0.36,R*0.42); c.moveTo(R*0.55,0); c.lineTo(R*0.36,R*0.42); c.stroke();
    c.translate(0,R*1.32); c.scale(pulse,pulse);
    var g=c.createRadialGradient(-R*0.32,-R*0.36,R*0.08,0,0,R);
    g.addColorStop(0,'#fff6c4'); g.addColorStop(0.42,'#f6c945'); g.addColorStop(0.82,'#c88a14'); g.addColorStop(1,'#7c4c08');
    c.fillStyle=g; c.beginPath(); c.arc(0,0,R,0,TAU); c.fill();
    c.lineWidth=Math.max(2,R*0.08); c.strokeStyle='#5e3604'; c.stroke();
    c.lineWidth=Math.max(1,R*0.035); c.strokeStyle='rgba(110,62,4,.55)';
    c.beginPath(); c.arc(0,0,R*0.8,0,TAU); c.stroke();
    c.beginPath(); c.arc(0,0,R*0.62,0,TAU); c.stroke();
    var b=c.createRadialGradient(-R*0.08,-R*0.1,R*0.02,0,0,R*0.3);
    b.addColorStop(0,'#fffbe6'); b.addColorStop(1,'#d79a1c');
    c.fillStyle=b; c.beginPath(); c.arc(0,0,R*0.3,0,TAU); c.fill();
    c.lineWidth=Math.max(1,R*0.035); c.strokeStyle='rgba(100,55,0,.6)'; c.stroke();
    if(t>0&&t<0.25){ c.fillStyle='rgba(255,255,240,'+(0.55*(1-t/0.25))+')'; c.beginPath(); c.arc(0,0,R,0,TAU); c.fill(); }
    c.restore();
    // 敲响后荡开的两圈声波
    if(t>0&&t<0.8){
      for(var i=0;i<2;i++){ var tt=t-i*0.14; if(tt<=0) continue; var k=tt/0.66; if(k>=1) continue;
        c.strokeStyle='rgba(255,214,90,'+(0.85*(1-k))+')'; c.lineWidth=Math.max(2,R*0.09*(1-k));
        c.beginPath(); c.arc(x,y,R*(1.05+1.25*k),0,TAU); c.stroke(); }
    }
    // 锤子：从右下抡起来敲中锣边，再弹开一点
    var px=x+R*1.9, py=y+R*1.2, hx=x+R*1.2, hy=y+R*0.1;
    var L=Math.sqrt((hx-px)*(hx-px)+(hy-py)*(hy-py)), ah=Math.atan2(hy-py,hx-px), ar=ah+1.15, a;
    if(t<0){ var q=Math.max(0,Math.min(1,(t+WIND)/WIND)); a=ar+(ah-ar)*q*q; }
    else { a=ah+0.42*Math.sin(Math.min(1,t/0.22)*Math.PI/2); }
    var ex=px+Math.cos(a)*L, ey=py+Math.sin(a)*L;
    c.save(); c.lineCap='round';
    c.strokeStyle='#7a4a1c'; c.lineWidth=Math.max(2,R*0.11);
    c.beginPath(); c.moveTo(px,py); c.lineTo(px+Math.cos(a)*(L-R*0.2),py+Math.sin(a)*(L-R*0.2)); c.stroke();
    var hg=c.createRadialGradient(ex-R*0.06,ey-R*0.06,R*0.02,ex,ey,R*0.24);
    hg.addColorStop(0,'#ff8a8a'); hg.addColorStop(1,'#c4161c');
    c.fillStyle=hg; c.beginPath(); c.arc(ex,ey,R*0.24,0,TAU); c.fill();
    c.lineWidth=Math.max(1,R*0.04); c.strokeStyle='#7d0d10'; c.stroke();
    c.restore();
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
#fx{position:absolute;left:0;top:0;z-index:35;display:none;pointer-events:none;}
#fxv{position:absolute;left:0;top:0;z-index:34;display:none;pointer-events:none;}
#fxvid{display:none;}
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
<script>window.__INITIAL_CFGS=${scriptJson({ [meta.id]: specialPageConfig(cfg, background) })};window.__GAME_META=${scriptJson({ [meta.id]: gameMeta(meta) })};window.__LAYER_ORDER=${scriptJson([meta.id])};window.__DEFAULT_GAME=${scriptJson(meta.id)};window.__PREVIEW=${preview ? 'true' : 'false'};window.__ASSET_BASE=${scriptJson(assetBase)};window.__FILE_BASE=${scriptJson(options.fileBase || '')};window.__FPS=${preview ? 30 : 0};</script>
<script>${codeTable([{ id: meta.id, code }])}</script>
<script>${HARNESS_JS}</script>
</body></html>`
}

/**
 * 直播窗口「特色整蛊」：全部玩法同一个页面，用到哪个才加载哪个；图层顺序见 SPECIAL_LAYER_ORDER。
 * reveal = 盲盒开奖画面与配音的设置（SpecialRevealConfig 加上锣声地址 gongUrl），不给 = 默认设置、没有锣声。
 */
export function buildSpecialWindowPage(
  games: { meta: SpecialGameMeta; cfg: SpecialGameConfig; code: string }[],
  win: SpecialWindowConfig,
  layerOrder: string[],
  assetBase = '',
  reveal: Record<string, unknown> = {}
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
<canvas id="fxv"></canvas>
<video id="fxvid" playsinline preload="auto"></video>
<canvas id="fx"></canvas>
<div id="hit" data-nodrag></div>
<div id="banner"><img id="bav" alt=""><span id="btx"></span></div>
<div id="grip" title="拖动摆放窗口">⋮⋮ 拖动</div>
<script>window.__INITIAL_CFGS=${scriptJson(cfgs)};window.__GAME_META=${scriptJson(metas)};window.__LAYER_ORDER=${scriptJson(layerOrder)};window.__DEFAULT_GAME='';window.__PREVIEW=false;window.__ASSET_BASE=${scriptJson(assetBase)};window.__FILE_BASE='';window.__REVEAL=${scriptJson(reveal)};window.__FPS=${Math.max(0, Math.trunc(Number(win.fps) || 0))};</script>
<script>${codeTable(games.filter((g) => !!g.code).map((g) => ({ id: g.meta.id, code: g.code })))}</script>
<script>${HARNESS_JS}</script>
</body></html>`
}
