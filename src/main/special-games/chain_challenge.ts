// 特色玩法「锁链特效」的页面内 Canvas 代码。
// 窗口中央一副 X 形交叉锁链 + 计数牌；礼物加环数（上锁音 + 抖动），主播点击/空格逐点挣脱；
// 归零后锁链切两半坠落飞散。
// 操作：add 加环 / reduce 直接扣环 / multiply、divide 按倍数改剩余（只在锁链挂着时生效，没锁链时忽略）/ clear 直接断开。
// 皮肤（cfg.visualStyle，全部 Canvas 程序化绘制，不用图片）：neon 霓虹（默认）/ candy 甜心 / rosegold 玫瑰金 / laser 赛博光束 / ice 冰晶。
//   每套是一整套视觉：链本体 + X 中心的锁 + 计数牌 + 解锁提示 + 点击冲击 + 断裂坠落；cfg.skinMotion 开关呼吸/闪烁/电流/闪光小动画。
//   以前的三款素材皮肤（经典金属 / 经典青蓝 / 经典紫）已下线，设置里还存着它们的按霓虹画。
// 现代款性能：整副 X 锁链（含发光）按「皮肤 + 窗口尺寸 + 粗细 + 像素密度 + 底色」烘焙成离屏 canvas，锁 / 粒子贴图同样预烘焙，
//   计数牌按数字缓存；每帧只 drawImage + 少量叠加动画，断裂也用缓存切两半。skinMotion 关掉时完全静态（常态无冲击时 tick 返回 false 停 rAF）。
//   烘焙在 CPU 画布上画完再整张交出去（显卡 / 兼容 / 平衡三种渲染模式都稳定在几十毫秒），光晕和投影每层只整体模糊一次；断完空闲一分钟释放缓存。
// 绿幕安全：配色全部避开绿色系（色相 90°~160°，青色往天蓝偏），光晕收紧、主体边缘实、卡片实心（半透明大光晕叠在 #00FF00 上抠完发绿发脏）；
//   透明底（OBS 直接叠）时光晕放柔、玻璃卡半透明。
// 音效（全部皮肤共用）：chain/chain_lock.ogg（上锁）、chain_tap.ogg（点击）、chain_impact.ogg（断裂）。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','reduce','multiply','divide','clear'];
  var MAXN=999999999;      // 防爆夹紧：剩余环数上限
  var remaining=0;
  var phase='idle';        // idle / locking / sustain / unlocking
  var phaseT=0;            // 当前阶段已进行 ms
  var shakeT=0;            // 点击抖动剩余
  var impact=0;            // 冲击光强度 0~1
  var nowMs=0;
  var spaceHeld=false, spaceHoldMs=0, spaceRepeatMs=0;
  var fx=[];               // 现代款：粒子 / 光环 / 闪电
  var FX_MAX=240;          // 防爆夹紧：同屏粒子上限（狂点时丢最早的）
  var pop=0, lockKick=0;   // 现代款：计数牌弹跳 / 锁被敲一下，0~1
  var motionT=0;           // 现代款：动态光效时钟 ms
  var C=null, CC=null;     // 现代款：锁链缓存 / 计数牌缓存
  var SK={};               // 现代款皮肤表（下面逐套定义）
  var releaseTimer=0;      // 现代款：空闲一阵后放掉缓存

  var LOCK_MS=400, SHAKE_MS=140;
  var UNLOCK_MS=560;       // 断裂：两半坠落 + 锁弹开 + 迸散都看得清

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function decrement(){ return Math.max(1,Math.trunc(num(api.cfg.decrementPerClick,1))); }
  function thickness(){ return Math.max(30,Math.min(1000,num(api.cfg.thicknessPercent,60)))/100; }
  function opacity(){ return Math.max(10,Math.min(100,num(api.cfg.opacity,100)))/100; }
  function unlockMode(){ return String(api.cfg.unlockMode||'mouse'); }
  function style(){ return String(api.cfg.visualStyle||'neon'); }
  // 当前皮肤 id；不认识的值（包括已下线的三款素材皮肤）按默认霓虹
  function modern(){ var s=style(); return SK[s]?s:'neon'; }
  function unlockMs(){ return UNLOCK_MS; }
  // 锁链挂着（出现中 / 常态）才能扣减、乘除
  function locked(){ return phase==='locking'||phase==='sustain'; }

  // X 锁链几何：两条对角线穿过中心区域
  function geom(){
    var W=api.W,H=api.H;
    var t=thickness();
    var cx=W/2, cy=H*0.5;
    var halfW=W*0.36*t+W*0.14, halfH=H*0.30*t+H*0.08;
    return { cx:cx, cy:cy, hw:halfW, hh:halfH,
      strands:[ [[cx-halfW,cy-halfH],[cx+halfW,cy+halfH]], [[cx+halfW,cy-halfH],[cx-halfW,cy+halfH]] ] };
  }

  function addShake(){ shakeT=SHAKE_MS; }
  function beginUnlock(){
    phase='unlocking'; phaseT=0; remaining=0; ZL.snd('chain/chain_impact.ogg');
    var m=modern(); if(m) skinFx(m,'brk');
  }

  // 扣减后的统一反馈：抖动 + 冲击光 + 点击音，归零断链
  function afterHit(){
    addShake(); impact=1;
    ZL.snd('chain/chain_tap.ogg');
    var m=modern(); if(m){ pop=1; lockKick=1; skinFx(m,'hit'); }
    if(remaining<=0) beginUnlock();
  }

  function unlockStep(){
    if(phase!=='sustain') return;
    remaining=Math.max(0, remaining-decrement());
    afterHit();
  }

  // ================= 现代款：公共小工具 =================
  // 尺度：u = 链环（随粗细线性），lu = 锁 / 冲击（随粗细放大得慢，免得压住计数牌），cu = 计数牌（只随窗口）。
  // 设计稿按 1280×720、默认粗细 60% 时 = 1 来写像素。
  var PI=Math.PI, TAU=PI*2;
  var F_NUM='"Bahnschrift","Segoe UI","Microsoft YaHei",sans-serif';
  var F_CJK='"Microsoft YaHei","PingFang SC",sans-serif';
  var F_MONO='Consolas,"Bahnschrift","Courier New",monospace';
  var F_BLACK='"Segoe UI Black","Arial Black","Microsoft YaHei",sans-serif';
  var SD=1;   // 正在烘焙的像素密度：shadowBlur / shadowOffset 不跟着变换缩放，要自己乘，不然高 DPI 下光晕变细
  function skinMotion(){ return String(api.cfg.skinMotion)!=='false' && api.cfg.skinMotion!==false; }
  function bgMode(){ return api.cfg.background==='transparent'?'t':'g'; }
  // 实际像素密度：直接按画布后备尺寸算（和外壳的 DPR 夹紧一致）
  function pxRatio(){ var cv=api.ctx&&api.ctx.canvas; return (cv&&api.W>0)?Math.max(1,cv.width/api.W):1; }
  function mk(w,h){ var cv=document.createElement('canvas'); cv.width=Math.max(1,Math.ceil(w)); cv.height=Math.max(1,Math.ceil(h)); return cv; }
  // 确定性随机（烘焙用：同样的参数每次长一样）
  function rng(seed){ var s=seed>>>0; return function(){ s=(s+0x6D2B79F5)>>>0; var t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function hash(n){ var x=Math.sin(n*127.1+311.7)*43758.5453; return x-Math.floor(x); }
  function lin(c,x0,y0,x1,y1,stops){ var gr=c.createLinearGradient(x0,y0,x1,y1); for(var i=0;i<stops.length;i+=2) gr.addColorStop(stops[i],stops[i+1]); return gr; }
  function rad(c,x,y,r0,r1,stops){ var gr=c.createRadialGradient(x,y,r0,x,y,r1); for(var i=0;i<stops.length;i+=2) gr.addColorStop(stops[i],stops[i+1]); return gr; }
  function mixHex(a,b,t){
    var x=parseInt(a.slice(1),16), y=parseInt(b.slice(1),16), r=[16,8,0].map(function(s){ return Math.round(((x>>s)&255)*(1-t)+((y>>s)&255)*t); });
    return 'rgb('+r[0]+','+r[1]+','+r[2]+')';
  }
  // 跑道形（中心 x,y；沿 x 长 L、宽 w），只加子路径
  function stadium(c,x,y,L,w){ if(L<w) L=w; var r=w/2, a=x-L/2+r, b=x+L/2-r; c.moveTo(a,y-r); c.lineTo(b,y-r); c.arc(b,y,r,-PI/2,PI/2); c.lineTo(a,y+r); c.arc(a,y,r,PI/2,PI*1.5); c.closePath(); }
  // 正多边形（外接圆半径 r、起始角 a0；sx = x 方向压扁）
  function polyPath(c,x,y,r,n,a0,sx){ c.beginPath(); for(var i=0;i<n;i++){ var a=a0+i*TAU/n; if(i) c.lineTo(x+Math.cos(a)*r*(sx||1),y+Math.sin(a)*r); else c.moveTo(x+Math.cos(a)*r*(sx||1),y+Math.sin(a)*r); } c.closePath(); }
  // 切角矩形（HUD 面板）
  function chamfer(c,x,y,w,h,k){ c.beginPath(); c.moveTo(x+k,y); c.lineTo(x+w-k,y); c.lineTo(x+w,y+k); c.lineTo(x+w,y+h-k); c.lineTo(x+w-k,y+h); c.lineTo(x+k,y+h); c.lineTo(x,y+h-k); c.lineTo(x,y+k); c.closePath(); }
  // 心形（中心 x,y、宽 w）
  function heartPath(c,x,y,w){
    var h=w*0.9;
    c.beginPath();
    c.moveTo(x,y+h*0.52);
    c.bezierCurveTo(x-w*0.18,y+h*0.36,x-w*0.52,y+h*0.12,x-w*0.5,y-h*0.18);
    c.bezierCurveTo(x-w*0.48,y-h*0.42,x-w*0.28,y-h*0.52,x-w*0.21,y-h*0.5);
    c.bezierCurveTo(x-w*0.1,y-h*0.5,x-w*0.02,y-h*0.42,x,y-h*0.3);
    c.bezierCurveTo(x+w*0.02,y-h*0.42,x+w*0.1,y-h*0.5,x+w*0.21,y-h*0.5);
    c.bezierCurveTo(x+w*0.28,y-h*0.52,x+w*0.48,y-h*0.42,x+w*0.5,y-h*0.18);
    c.bezierCurveTo(x+w*0.52,y+h*0.12,x+w*0.18,y+h*0.36,x,y+h*0.52);
    c.closePath();
  }
  // 四角星闪光（k = 腰身粗细）
  function sparklePath(c,x,y,r,k){ k=k||0.16; c.beginPath(); c.moveTo(x,y-r); c.quadraticCurveTo(x+r*k,y-r*k,x+r,y); c.quadraticCurveTo(x+r*k,y+r*k,x,y+r); c.quadraticCurveTo(x-r*k,y+r*k,x-r,y); c.quadraticCurveTo(x-r*k,y-r*k,x,y-r); c.closePath(); }
  // 五角星（ri = 内半径）
  function starPath(c,x,y,r,ri){ c.beginPath(); for(var i=0;i<10;i++){ var a=-PI/2+i*PI/5, rr=i%2?ri:r; if(i) c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr); else c.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr); } c.closePath(); }
  // 雪花（六臂，每臂两对小枝）
  function snowflake(c,x,y,r,lw,col){
    c.save(); c.translate(x,y); c.strokeStyle=col; c.lineWidth=lw; c.lineCap='round';
    for(var i=0;i<6;i++){
      c.save(); c.rotate(i*PI/3); c.beginPath();
      c.moveTo(0,0); c.lineTo(0,-r);
      c.moveTo(0,-r*0.56); c.lineTo(-r*0.24,-r*0.78); c.moveTo(0,-r*0.56); c.lineTo(r*0.24,-r*0.78);
      c.moveTo(0,-r*0.3); c.lineTo(-r*0.16,-r*0.45); c.moveTo(0,-r*0.3); c.lineTo(r*0.16,-r*0.45);
      c.stroke(); c.restore();
    }
    c.restore();
  }
  // 锁梁 U 形路径（中线）：腿在 x=±w/2，从 y0 往上到圆弧顶 y1（顶点 = y1 - w/2）
  function shacklePath(w,y0,y1){ return function(c){ c.beginPath(); c.moveTo(-w/2,y0); c.lineTo(-w/2,y1); c.arc(0,y1,w/2,PI,0); c.lineTo(w/2,y0); }; }
  // 描一条路径：p 是路径函数（自己 beginPath 建路径）或攒好的 Path2D
  function strokeP(c,p){ if(typeof p==='function'){ p(c); c.stroke(); } else c.stroke(p); }
  // 光晕 / 投影统一走这里：把一整层要发光（或投影）的轮廓先画到临时画布，整张模糊一次再叠回来（dx/dy = 投影偏移）。
  // 一层只模糊一次——逐个环 shadowBlur 的话，几百次小模糊在显卡模式下要烤好几百毫秒；整条链一次 shadowBlur 又会把整条斜链的外框都模糊一遍
  // 光晕本来就是软的，轮廓和模糊都在半分辨率上做（像素少四倍），叠回来时再放大
  function blurPass(K,c,blur,dx,dy,fn){
    var cv=c.canvas, k=0.5, w=Math.ceil(cv.width*k), h=Math.ceil(cv.height*k), m=c.getTransform();
    var a=mk(w,h), g=cpu2d(a); g.setTransform(m.a*k,m.b*k,m.c*k,m.d*k,m.e*k,m.f*k); fn(g);
    var b=mk(w,h), gb=cpu2d(b); gb.filter='blur('+(blur*0.5*K.d*k).toFixed(2)+'px)'; gb.drawImage(a,0,0);
    c.save(); c.setTransform(1,0,0,1,0,0); c.drawImage(b,dx*K.d,dy*K.d,w/k,h/k); c.restore();
  }
  // 字号自适应：超宽就缩
  function fitFont(c,weight,family,label,maxW,fs){ fs=Math.max(10,Math.round(fs)); c.font=weight+' '+fs+'px '+family; while(c.measureText(label).width>maxW&&fs>10){ fs-=1; c.font=weight+' '+fs+'px '+family; } return fs; }
  // 数字按字形实际高度垂直居中，返回基线 y
  function midBase(c,label,y){ var m=c.measureText(label); return y+((m.actualBoundingBoxAscent||0)-(m.actualBoundingBoxDescent||0))/2; }

  // —— 缓存图层 ——
  // 烤完读一个像素：逼浏览器当场把这张画布画完（显卡模式下纹理上传也在烘焙时做掉），不把活拖到第一帧、也不在之后反复重放绘制命令
  function settle(c){ try{ c.getImageData(0,0,1,1); }catch(e){} }
  // 烘焙用 CPU 画布：显卡模式下几百笔抗锯齿路径 / 模糊交给 GPU 反而慢（实测要编着色器、整条斜链做遮罩，几百毫秒），
  // CPU 上画稳定在几十毫秒；烤完 sealCanvas() 整张拷进一张普通画布（显卡模式下就是一次纹理上传），每帧绘制走它
  function cpu2d(cv){ return cv.getContext('2d',{ willReadFrequently:true }); }
  function sealCanvas(cv){ var out=mk(cv.width,cv.height), c=out.getContext('2d'); c.drawImage(cv,0,0); settle(c); return out; }
  // 整窗图层：四周多留 M 像素（抖动、断裂时边缘不露底），fn(c) 用页面坐标画
  function layerFull(K,fn){ var W=api.W,H=api.H,d=K.d,M=K.M; var cv=mk((W+2*M)*d,(H+2*M)*d), c=cpu2d(cv); c.setTransform(d,0,0,d,M*d,M*d); fn(c); return sealCanvas(cv); }
  function blitFull(ctx,K,cv){ if(cv) ctx.drawImage(cv,-K.M,-K.M,api.W+2*K.M,api.H+2*K.M); }
  // 小贴图（锁 / 粒子）：原点在中心，r = 半边长
  function sprite(K,r,fn){ var d=K.d, cv=mk(2*r*d,2*r*d), c=cpu2d(cv); c.setTransform(d,0,0,d,r*d,r*d); fn(c); return { cv:sealCanvas(cv), r:r }; }
  function blit(ctx,sp,x,y,s,rot){
    if(!sp) return;
    var r=sp.r*(s==null?1:s);
    if(rot){ ctx.save(); ctx.translate(x,y); ctx.rotate(rot); ctx.drawImage(sp.cv,-r,-r,2*r,2*r); ctx.restore(); }
    else ctx.drawImage(sp.cv,x-r,y-r,2*r,2*r);
  }
  // 两条对角线（geom 同一套斜率），从交叉中心往两头各伸到窗口外
  function strandList(g,u){ var a=Math.atan2(g.hh,g.hw), half=Math.sqrt(api.W*api.W+api.H*api.H)/2+120*u; return [{ ang:a, half:half }, { ang:-a, half:half }]; }
  // fn(c, half, si) 在链的局部坐标里画：x 沿链、y 垂直于链，原点 = 交叉中心
  function eachStrand(c,K,fn){ for(var i=0;i<K.sl.length;i++){ var s=K.sl[i]; c.save(); c.translate(K.g.cx,K.g.cy); c.rotate(s.ang); fn(c,s.half,i); c.restore(); } }
  // 沿链摆环：fn(k, x, odd)；k 偶数 = 正面环、奇数 = 侧面环。交叉中心（k=0）不放环：锁就是四条链的接头，中间不糊成一团
  function eachLink(half,pitch,fn){ var n=Math.ceil(half/pitch)+1; for(var k=-n;k<=n;k++) if(k) fn(k,k*pitch,Math.abs(k)%2===1); }
  // 链局部坐标 → 页面坐标
  function toPage(K,si,x,y){ var a=K.sl[si].ang, g=K.g; return [g.cx+Math.cos(a)*x-Math.sin(a)*y, g.cy+Math.sin(a)*x+Math.cos(a)*y]; }
  // 闪光候选点：在窗口里、不压锁、不压计数牌
  function addPt(K,p){
    var W=api.W,H=api.H,B=counterBox();
    if(p[0]<8||p[1]<8||p[0]>W-8||p[1]>H-8) return;
    if(Math.abs(p[0]-K.g.cx)<70*K.lu&&Math.abs(p[1]-K.g.cy)<70*K.lu) return;
    if(Math.abs(p[0]-B.cx)<B.bw*0.6&&Math.abs(p[1]-B.cy)<B.bh*0.9+30*B.cu) return;
    K.pts.push(p);
  }

  // 锁链缓存：换皮肤 / 窗口尺寸 / 粗细 / 像素密度 / 底色才重烤
  function cacheFor(sid){
    var W=api.W,H=api.H,d=pxRatio();
    var key=[sid,W,H,thickness(),d,bgMode()].join('|');
    if(C&&C.key===key) return C;
    var t0=performance.now(), g=geom(), base=Math.min(W,H)/720, tk=thickness()/0.6;
    var K={ key:key, sid:sid, d:d, g:g, u:base*tk, lu:base*Math.pow(tk,0.6), soft:bgMode()==='t', spr:{}, pts:[] };
    K.M=Math.ceil(Math.max(16,Math.min(W,H)*0.03));
    K.sl=strandList(g,K.u);
    C=K; SD=d;
    SK[sid].bake(K);
    K.bakeMs=Math.round(performance.now()-t0);
    return K;
  }

  // 计数牌：卡片 + 数字 + 上方解锁提示，按数字 / 提示文字缓存（数字只在点击时变）
  function counterBox(){ var W=api.W,H=api.H,cu=Math.min(W,H)/720; return { cx:W/2, cy:H*0.68, bw:Math.min(W*0.86,300*cu), bh:Math.min(H*0.22,96*cu), cu:cu }; }
  function hintText(){
    if(String(api.cfg.showUnlockHint)==='false'||api.cfg.showUnlockHint===false) return '';
    var m=unlockMode();
    return m==='space'?'按空格键解锁':(m==='both'?'点击绿幕或按空格键解锁':'点击绿幕解锁');
  }
  function counterFor(sid){
    var B=counterBox(), d=pxRatio(), label=String(remaining), hint=hintText();
    var key=[sid,api.W,api.H,d,bgMode(),label,hint].join('|');
    if(CC&&CC.key===key) return CC;
    var sk=SK[sid], cu=B.cu, pad=28*cu, chipH=hint?30*cu:0, gap=hint?10*cu:0;
    var probe=mk(1,1).getContext('2d'); probe.font='700 '+Math.round(15*cu)+'px '+F_CJK;
    var chipW=hint?probe.measureText(hint).width+40*cu:0;
    var w=Math.max(B.bw,chipW)+pad*2, top=B.bh/2+gap+chipH+pad, h=top+B.bh/2+pad;
    var cv=mk(w*d,h*d), c=cpu2d(cv);
    c.setTransform(d,0,0,d,w/2*d,top*d);
    var soft=bgMode()==='t';
    SD=d;
    sk.card(c,B,soft);
    sk.num(c,B,label);
    if(hint) sk.chip(c,B,hint,-(B.bh/2+gap+chipH/2),chipW,chipH,soft);
    CC={ key:key, cv:sealCanvas(cv), w:w, h:h, ox:w/2, oy:top, B:B };
    return CC;
  }

  // —— 粒子 / 光环 ——
  // p: { x,y, vx,vy（px/s）, g（重力 px/s²）, drag（每秒剩余速度比例）, rot,vr, s（缩放）, sp（贴图）, life（ms）, draw（自定义）}
  function addFx(p){ p.t=0; if(fx.length>=FX_MAX) fx.shift(); fx.push(p); return p; }
  function stepFx(step){
    var dt=step/1000;
    for(var i=fx.length-1;i>=0;i--){
      var p=fx[i]; p.t+=step;
      if(p.t>=p.life){ fx.splice(i,1); continue; }
      if(p.vx!=null){ if(p.drag){ var k=Math.pow(p.drag,dt); p.vx*=k; p.vy*=k; } p.vy+=(p.g||0)*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; }
      if(p.vr) p.rot+=p.vr*dt;
    }
  }
  function drawFx(ctx){ for(var i=0;i<fx.length;i++){ var p=fx[i]; ctx.save(); (p.draw||drawSpr)(ctx,p,p.t/p.life); ctx.restore(); } }
  // 贴图粒子：出生一下弹大、后段缩小收掉，只在最后一小段淡出（半透明的时间越短，绿幕上越不发脏）；align = 沿速度方向（拖尾火花）
  function drawSpr(ctx,p,k){
    var a=k<0.85?1:1-(k-0.85)/0.15, s=p.s*(k<0.1?0.45+k*5.5:1)*(p.shrink?1-k*0.55:1)*(k>0.55?1-(k-0.55)/0.45*0.7:1);
    ctx.globalAlpha*=a;
    blit(ctx,p.sp,p.x,p.y,s,p.align?Math.atan2(p.vy,p.vx):p.rot);
  }
  // 从 (x,y) 往外迸 n 个贴图粒子
  function burst(x,y,n,o){
    for(var i=0;i<n;i++){
      var a=o.arc!=null?(o.dir||-PI/2)+(Math.random()-0.5)*o.arc:Math.random()*TAU, v=o.v0+Math.random()*(o.v1-o.v0), r0=o.r||0;
      addFx({ x:x+Math.cos(a)*r0, y:y+Math.sin(a)*r0, vx:Math.cos(a)*v, vy:Math.sin(a)*v-(o.up||0), g:o.g||0, drag:o.drag,
        rot:Math.random()*TAU, vr:o.spin?(Math.random()-0.5)*o.spin:0, s:o.s0+Math.random()*(o.s1-o.s0),
        sp:o.sp[i%o.sp.length], life:o.life0+Math.random()*(o.life1-o.life0), align:o.align, shrink:o.shrink });
    }
  }
  // 扩散光环（两层：彩色 + 亮芯）
  function drawRing(ctx,p,k){
    var e=ZL.easeOut(k), r=p.r0+(p.r1-p.r0)*e;
    ctx.globalAlpha*=1-k*k;
    ctx.lineWidth=p.w*(1-0.65*k); ctx.strokeStyle=p.c1; ctx.beginPath(); ctx.arc(p.x,p.y,r,0,TAU); ctx.stroke();
    if(p.c2){ ctx.lineWidth=p.w*0.38*(1-0.65*k); ctx.strokeStyle=p.c2; ctx.stroke(); }
  }
  function skinFx(sid,kind){ var K=cacheFor(sid); SK[sid][kind](K,K.g.cx,K.g.cy); }
  // 锁链断完空闲一分钟：放掉缓存（整窗图层几张加起来十几 MB），下次上锁再烤（几十毫秒）
  function scheduleRelease(){ clearTimeout(releaseTimer); releaseTimer=setTimeout(function(){ if(phase==='idle'&&!fx.length){ C=null; CC=null; } },60000); }

  // 一道斜向扫光：只在扫过的斜带里把高光层再叠一遍（三层嵌套斜带做软边）
  function sweep(ctx,K,layer,t,period,dur,amt){
    var ph=(t%period)/dur; if(ph>=1||!layer) return;
    var W=api.W,H=api.H,M=K.M,bw=Math.max(36,Math.min(W,H)*0.085),sl=H*0.42,x=-bw*3-sl+(W+bw*6+sl*2)*ph;
    for(var i=0;i<3;i++){
      var w=bw*(1-i*0.32);
      ctx.save(); ctx.beginPath(); ctx.moveTo(x-w-sl,H+M); ctx.lineTo(x+w-sl,H+M); ctx.lineTo(x+w+sl,-M); ctx.lineTo(x-w+sl,-M); ctx.closePath(); ctx.clip();
      ctx.globalAlpha*=amt*0.42; blitFull(ctx,K,layer); ctx.restore();
    }
  }
  // 闪光点：n 颗错开的四角星在候选点上轮流亮起；动态关掉时固定几颗
  function twinkles(ctx,K,sp,t,n,period,on){
    var pts=K.pts; if(!pts.length||!sp) return;
    for(var i=0;i<n;i++){
      var tt=t+i*period/n, idx=on?Math.floor(tt/period):i*5+3, k=on?(tt-Math.floor(tt/period)*period)/period:0.25;
      var q=pts[Math.floor(hash(idx*7.31+i*3.7)*pts.length)%pts.length];
      var s=k<0.5?Math.sin(k/0.5*PI):0; if(s<=0.02) continue;
      blit(ctx,sp,q[0],q[1],s,k*0.9);
    }
  }

  // —— 现代款绘制入口 ——
  function drawModern(ctx,sid){
    var showChain=phase==='unlocking'||((phase==='locking'||phase==='sustain')&&remaining>0);
    if(!showChain&&!fx.length) return;
    var sk=SK[sid], K=cacheFor(sid), g=K.g;
    var sx=0,sy=0;
    if(shakeT>0){ var sp=shakeT/SHAKE_MS; sx=Math.sin(nowMs*0.09)*8*sp; sy=Math.cos(nowMs*0.13)*5*sp; }
    var on=skinMotion(), t=on?motionT:0;
    ctx.save();
    ctx.globalAlpha*=opacity();
    ctx.translate(sx,sy);
    if(phase==='unlocking'){ drawBreak(ctx,K,sk,Math.min(1,phaseT/unlockMs())); drawFx(ctx); }
    else if(showChain){
      var s=1;
      ctx.save();
      // 入场：easeOutBack 放大 + 前 1/4 淡入（链伸到窗口外的切口一闪而过不露）
      if(phase==='locking'){ var p=phaseT/LOCK_MS; s=Math.max(0.01,ZL.easeOutBack(p)); ctx.globalAlpha*=Math.min(1,p*4); }
      ctx.translate(g.cx,g.cy); ctx.scale(s,s); ctx.translate(-g.cx,-g.cy);
      blitFull(ctx,K,K.base);
      sk.live(ctx,K,t,on);
      var ls=(1+0.08*lockKick*lockKick)*(sk.beat?sk.beat(t,on):1);
      blit(ctx,K.lock,g.cx,g.cy,ls);
      if(sk.lockLive) sk.lockLive(ctx,K,t,on,ls);
      ctx.restore();
      drawFx(ctx);   // 冲击效果压在锁链上、垫在计数牌下（数字始终看得清）
      var Q=counterFor(sid), B=Q.B, ps=1+0.1*pop*pop;
      ctx.save(); ctx.translate(B.cx,B.cy); ctx.scale(ps,ps); ctx.drawImage(Q.cv,-Q.ox,-Q.oy,Q.w,Q.h); ctx.restore();
    }
    else drawFx(ctx);
    ctx.restore();
  }
  // 断裂：缓存切左右两半坠落（同经典款的轨迹，时长稍长更顺）+ 锁弹开往上一跳再掉。
  // 每半边只取缓存对应的那一半源矩形来画（不画整张再裁剪，旋转绘制的像素量减半）。
  function drawBreak(ctx,K,sk,p){
    var W=api.W,H=api.H,g=K.g,M=K.M,d=K.d;
    var fade=1-Math.max(0,(p-0.68)/0.32);
    var fall=H*1.18*p*p, spread=W*0.07*p;
    var cv=sk.breakLayer?sk.breakLayer(K):K.base, cut=Math.round((g.cx+M)*d);
    for(var side=0;side<2;side++){
      ctx.save();
      ctx.globalAlpha*=Math.max(0,fade);
      ctx.translate(g.cx+(side?spread:-spread), g.cy+fall);
      ctx.rotate((side?1:-1)*14*p*PI/180);
      if(side) ctx.drawImage(cv,cut,0,cv.width-cut,cv.height,cut/d-M-g.cx,-M-g.cy,(cv.width-cut)/d,cv.height/d);
      else ctx.drawImage(cv,0,0,cut,cv.height,-M-g.cx,-M-g.cy,cut/d,cv.height/d);
      ctx.restore();
    }
    ctx.save();
    if(sk.lockBreak) sk.lockBreak(ctx,K,p);   // 自带收场动画（不再叠通用淡出）
    else {
      var q=Math.max(0,p-0.3), y=g.cy-Math.sin(Math.min(1,p/0.3)*PI*0.5)*34*K.lu+H*1.3*q*q;
      ctx.globalAlpha*=Math.max(0,1-Math.max(0,(p-0.5)/0.5));
      blit(ctx,K.lockOpen,g.cx,y,1+0.1*p,p*0.55);
    }
    ctx.restore();
  }

  // ================= 霓虹：青 / 洋红交替的霓虹灯管链环 =================
  // 正面环 = 青色灯管 + 深色内芯，侧面环 = 洋红细灯管 + 深色细缝；交叠处正面环压住侧面环后面那根（编织感）。
  // 呼吸层：两种颜色的亮芯各烘一层，动态时一明一暗交替呼吸、偶尔闪一下（只改灯管内部亮度，边缘不变，抠绿安全）。
  var NEON=[
    { tube:'#18c4ff', core:'#d2f4ff', mid:'#178cff', deep:'#3a3cff', glow:'50,130,255' },
    { tube:'#ff3fd2', core:'#ffe0f6', mid:'#e027d4', deep:'#8a22f0', glow:'220,50,255' }
  ];
  // 一根霓虹灯管：深色外圈实边 + 收紧的光晕 + 灯管 + 半亮的芯（path 可以是路径函数或 Path2D）
  function neonTube(c,path,col,t,soft,noGlow){
    c.save(); c.lineJoin='round'; c.lineCap='round';
    if(!noGlow){ c.shadowColor='rgba('+col.glow+','+(soft?0.95:0.8)+')'; c.shadowBlur=t*(soft?2.6:0.7)*SD; }
    c.strokeStyle=col.deep; c.lineWidth=t*1.9; strokeP(c,path);
    c.shadowBlur=0; c.shadowColor='rgba(0,0,0,0)';
    c.strokeStyle=col.mid; c.lineWidth=t*1.4; strokeP(c,path);
    c.strokeStyle=col.tube; c.lineWidth=t; strokeP(c,path);
    c.globalAlpha=0.6; c.strokeStyle=col.core; c.lineWidth=t*0.42; strokeP(c,path);
    c.restore();
  }
  function neonHot(c,path,col,t){ c.save(); c.lineJoin='round'; c.lineCap='round'; c.strokeStyle=col.core; c.lineWidth=t*0.5; strokeP(c,path); c.strokeStyle='#ffffff'; c.lineWidth=t*0.2; strokeP(c,path); c.restore(); }
  function neonErase(c,path,t){ c.save(); c.globalCompositeOperation='destination-out'; c.lineJoin='round'; c.lineCap='round'; c.lineWidth=t*1.9; strokeP(c,path); c.restore(); }
  function neonFlicker(t){ var n=Math.floor(t/4300), k=t-n*4300; if(hash(n)<0.4||k>330) return 1; var s=Math.floor(k/55); return s%2?0.12:(s===2?0.5:1); }
  // 霓虹挂锁：青色锁梁 + 深色锁身洋红描边 + 青色钥匙孔；mode = base / hot（亮芯层）
  function neonLock(c,s,soft,open,mode){
    var bw=78*s, bh=56*s, top=-14*s, rr=15*s, t=8*s, lift=open?20*s:0;
    var sh=shacklePath(40*s,top+t/2-lift,top-18*s-lift);
    var body=function(c){ ZL.roundRect(c,-bw/2+t/2,top+t/2,bw-t,bh-t,rr); };
    var ky=top+bh*0.42;
    var key=function(c){ c.beginPath(); c.arc(0,ky,6*s,0,TAU); c.moveTo(0,ky+6.5*s); c.lineTo(0,ky+16*s); };
    if(mode==='hot'){ neonHot(c,sh,NEON[0],t); neonHot(c,body,NEON[1],t); neonHot(c,key,NEON[0],4.2*s); return; }
    neonTube(c,sh,NEON[0],t,soft);
    c.fillStyle=lin(c,0,top,0,top+bh,[0,'#1e1238',1,'#0a0820']); ZL.roundRect(c,-bw/2,top,bw,bh,rr+t/2); c.fill();
    c.strokeStyle='rgba(255,63,210,0.35)'; c.lineWidth=1.4*s; ZL.roundRect(c,-bw/2+t*1.6,top+t*1.6,bw-t*3.2,bh-t*3.2,rr*0.6); c.stroke();
    neonTube(c,body,NEON[1],t,soft);
    neonTube(c,key,NEON[0],4.2*s,soft);
  }
  function streakSprite(K,r,col){
    return sprite(K,r,function(c){
      c.lineCap='round'; c.shadowColor='rgba('+col.glow+',0.9)'; c.shadowBlur=r*0.22*SD;
      c.strokeStyle=col.tube; c.lineWidth=r*0.22; c.beginPath(); c.moveTo(-r*0.78,0); c.lineTo(r*0.78,0); c.stroke();
      c.shadowBlur=0; c.strokeStyle='#ffffff'; c.lineWidth=r*0.09; c.beginPath(); c.moveTo(-r*0.4,0); c.lineTo(r*0.74,0); c.stroke();
    });
  }
  SK.neon={
    bake:function(K){
      var u=K.u, lu=K.lu, soft=K.soft, half=K.sl[0].half;
      var F={ L:88*u, w:50*u, t:7.5*u }, E={ L:78*u, w:24*u, t:6.5*u }, P=58*u;
      var ys=(E.w-E.t)/2, r=(F.w-F.t)/2, ax=(F.L-F.w)/2, dx=Math.sqrt(Math.max(0,r*r-ys*ys));
      // 同类元件攒成一条路径：正面环灯管 / 内芯、侧面环灯管 / 细缝、交错裁剪框（正面环端弧和侧面环后那根交叉处）
      var fT=new Path2D(), fC=new Path2D(), eT=new Path2D(), eC=new Path2D(), wv=new Path2D();
      eachLink(half,P,function(k,x,odd){
        if(!odd){ stadium(fT,x,0,F.L-F.t,F.w-F.t); stadium(fC,x,0,F.L-F.t*1.5,F.w-F.t*1.5); return; }
        stadium(eT,x,0,E.L-E.t,E.w-E.t); stadium(eC,x,0,E.L-E.t*1.5,E.w-E.t*1.5);
        for(var sd=-1;sd<=1;sd+=2){ var cx0=x+sd*P-sd*(ax+dx); wv.rect(cx0-F.t*1.3,ys-E.t*0.45,F.t*2.6,E.t*1.45); }
      });
      for(var si=0;si<K.sl.length;si++) eachLink(half,P,function(k,x,odd){ if(!odd) addPt(K,toPage(K,si,x-F.L*0.18,-F.w/2+F.t*0.5)); });
      // mode：base = 完整灯管；h0 / h1 = 只画青 / 洋红的亮芯，另一色在这层里擦掉（遮挡关系与底图一致）
      function tube(c,path,ci,t,mode){ if(mode==='base') neonTube(c,path,NEON[ci],t,soft,true); else if(mode==='h'+ci) neonHot(c,path,NEON[ci],t); else neonErase(c,path,t); }
      // 深色内芯 + 内沿一圈淡淡的灯光反射：沿内芯边描两道半透明线，外半边随后被灯管盖住，只剩里面一圈（不用裁剪和模糊）；
      // 都在实心区内部，不影响抠绿；亮芯层里同样擦掉
      function core(c,path,t,ci,mode){
        if(mode!=='base'){ c.save(); c.globalCompositeOperation='destination-out'; c.fill(path); c.restore(); return; }
        c.fillStyle='#0b0920'; c.fill(path);
        c.save(); c.lineJoin='round'; c.strokeStyle='rgba('+NEON[ci].glow+',0.13)'; c.lineWidth=t*1.5; c.stroke(path); c.strokeStyle='rgba('+NEON[ci].glow+',0.2)'; c.lineWidth=t*0.8; c.stroke(path); c.restore();
      }
      function chain(c,mode){
        eachStrand(c,K,function(c){
          core(c,fC,F.t,0,mode); tube(c,fT,0,F.t,mode);
          core(c,eC,E.t,1,mode); tube(c,eT,1,E.t,mode);
          c.save(); c.clip(wv); tube(c,fT,0,F.t,mode); c.restore();
        });
      }
      K.base=layerFull(K,function(c){
        // 光晕：所有灯管外圈一次模糊垫底（绿幕下收紧、透明底时放柔）
        blurPass(K,c,(soft?2.6:0.7)*F.t,0,0,function(g){ eachStrand(g,K,function(g){ g.lineJoin='round'; g.strokeStyle='rgba('+NEON[0].glow+','+(soft?0.95:0.8)+')'; g.lineWidth=F.t*1.9; g.stroke(fT); g.strokeStyle='rgba('+NEON[1].glow+','+(soft?0.95:0.8)+')'; g.lineWidth=E.t*1.9; g.stroke(eT); }); });
        chain(c,'base');
      });
      K.hot0=layerFull(K,function(c){ chain(c,'h0'); });
      K.hot1=layerFull(K,function(c){ chain(c,'h1'); });
      K.lock=sprite(K,72*lu,function(c){ neonLock(c,lu,soft,false,'base'); });
      K.lockHot=sprite(K,72*lu,function(c){ neonLock(c,lu,soft,false,'hot'); });
      K.lockOpen=sprite(K,92*lu,function(c){ neonLock(c,lu,soft,true,'base'); neonLock(c,lu,soft,true,'hot'); });
      K.spr.s0=streakSprite(K,15*lu,NEON[0]); K.spr.s1=streakSprite(K,15*lu,NEON[1]);
    },
    // 断裂用：底图 + 两层亮芯压成一张（第一次断裂时才合，之后复用），坠落的两半只画这一张
    breakLayer:function(K){
      if(!K.flat){ var cv=mk(K.base.width,K.base.height), c=cv.getContext('2d'); c.drawImage(K.base,0,0); c.drawImage(K.hot0,0,0); c.drawImage(K.hot1,0,0); settle(c); K.flat=cv; }
      return K.flat;
    },
    live:function(ctx,K,t,on){
      var a0=1,a1=1;
      if(on){ var w=t*0.0024; a0=(0.3+0.7*(0.5+0.5*Math.sin(w)))*neonFlicker(t+2100); a1=(0.3+0.7*(0.5-0.5*Math.sin(w)))*neonFlicker(t); }
      ctx.save(); ctx.globalAlpha*=a0; blitFull(ctx,K,K.hot0); ctx.restore();
      ctx.save(); ctx.globalAlpha*=a1; blitFull(ctx,K,K.hot1); ctx.restore();
    },
    lockLive:function(ctx,K,t,on,ls){ var a=on?(0.45+0.55*(0.5+0.5*Math.cos(t*0.0024)))*neonFlicker(t+900):1; ctx.save(); ctx.globalAlpha*=a; blit(ctx,K.lockHot,K.g.cx,K.g.cy,ls); ctx.restore(); },
    card:function(c,B,soft){
      var w=B.bw,h=B.bh,cu=B.cu,r=h*0.3,x=-w/2,y=-h/2;
      // 玻璃卡：绿幕下实心（半透明叠绿会发绿），透明底时才真半透明
      c.save(); c.shadowColor='rgba(120,70,255,0.6)'; c.shadowBlur=(soft?20:5)*cu*SD;
      c.fillStyle=lin(c,0,y,0,y+h,[0,soft?'rgba(34,24,70,0.82)':'#211845',1,soft?'rgba(10,8,30,0.86)':'#0c0a24']); ZL.roundRect(c,x,y,w,h,r); c.fill(); c.restore();
      c.save(); ZL.roundRect(c,x,y,w,h,r); c.clip();
      c.fillStyle=lin(c,0,y,0,y+h*0.5,[0,'rgba(255,255,255,0.16)',1,'rgba(255,255,255,0)']); c.fillRect(x,y,w,h*0.5);
      c.restore();
      c.save(); c.lineJoin='round';
      c.shadowColor='rgba(150,90,255,0.95)'; c.shadowBlur=(soft?14:3)*cu*SD;
      c.strokeStyle=lin(c,x,0,x+w,0,[0,'#18c4ff',1,'#ff3fd2']); c.lineWidth=4.5*cu; ZL.roundRect(c,x,y,w,h,r); c.stroke();
      c.shadowBlur=0; c.strokeStyle='rgba(255,255,255,0.8)'; c.lineWidth=1.3*cu; ZL.roundRect(c,x,y,w,h,r); c.stroke();
      c.restore();
    },
    num:function(c,B,label){
      var fs=fitFont(c,'700',F_NUM,label,B.bw*0.74,B.bh*0.64), y=midBase(c,label,0);
      c.save(); c.textAlign='center'; c.textBaseline='alphabetic';
      c.shadowColor='rgba(40,190,255,0.95)'; c.shadowBlur=fs*0.3*SD; c.fillStyle='#ffffff'; c.fillText(label,0,y);
      c.shadowColor='rgba(255,70,220,0.85)'; c.shadowBlur=fs*0.12*SD; c.fillText(label,0,y);
      c.restore();
    },
    chip:function(c,B,text,y,w,h,soft){
      var cu=B.cu;
      c.save();
      c.fillStyle=soft?'rgba(18,13,42,0.88)':'#120d2a'; ZL.roundRect(c,-w/2,y-h/2,w,h,h/2); c.fill();
      c.strokeStyle=lin(c,-w/2,0,w/2,0,[0,'#18c4ff',1,'#ff3fd2']); c.lineWidth=1.6*cu; ZL.roundRect(c,-w/2,y-h/2,w,h,h/2); c.stroke();
      c.font='700 '+Math.round(15*cu)+'px '+F_CJK; c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#f5f0ff'; c.fillText(text,0,y+0.5*cu);
      c.restore();
    },
    hit:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:34*lu, r1:118*lu, w:7*lu, c1:'#18c4ff', c2:'#effcff', life:420, draw:drawRing });
      addFx({ x:x, y:y, r0:22*lu, r1:90*lu, w:5*lu, c1:'#ff3fd2', c2:'#ffe8f8', life:360, draw:drawRing });
      burst(x,y,16,{ sp:[K.spr.s0,K.spr.s1], v0:420*lu, v1:880*lu, drag:0.03, life0:260, life1:460, s0:0.7, s1:1.15, align:true, r:30*lu });
    },
    brk:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:40*lu, r1:260*lu, w:10*lu, c1:'#18c4ff', c2:'#effcff', life:620, draw:drawRing });
      addFx({ x:x, y:y, r0:30*lu, r1:200*lu, w:7*lu, c1:'#ff3fd2', c2:'#ffe8f8', life:540, draw:drawRing });
      burst(x,y,32,{ sp:[K.spr.s0,K.spr.s1], v0:520*lu, v1:1300*lu, drag:0.05, g:600*lu, life0:380, life1:760, s0:0.8, s1:1.4, align:true, r:30*lu });
    }
  };

  // ================= 甜心：粉 / 奶黄 / 天蓝的胖糖果链环 =================
  // 正面环 = 实心糖果圈（上亮下深渐变 + 白高光 + 柔和投影），侧面环 = 胖胶囊；中心心形挂锁带钥匙孔。
  var CANDY=[
    { light:'#ffd3e5', base:'#ff8fbf', deep:'#ec5d99', edge:'#d84a88' },
    { light:'#fff6d4', base:'#ffdf8c', deep:'#f5ba55', edge:'#e0a03c' },
    { light:'#dcf1ff', base:'#98d3ff', deep:'#5baaee', edge:'#4794dc' }
  ];
  // 一种颜色的全部糖果圈（q：环形 / 内圈阴影 / 外圈阴影 / 高光弧 / 高光点，都已攒成 Path2D）
  function candyRings(c,q,col,F){
    var t=F.t;
    c.fillStyle=lin(c,0,-F.w/2,0,F.w/2,[0,col.light,0.45,col.base,1,col.deep]); c.fill(q.ring,'evenodd');
    c.save(); c.clip(q.ring,'evenodd');
    c.lineWidth=t*0.5; c.strokeStyle=col.deep; c.globalAlpha=0.45; c.stroke(q.inner);
    c.globalAlpha=0.3; c.stroke(q.outer);
    c.globalAlpha=1; c.strokeStyle='rgba(255,255,255,0.85)'; c.lineWidth=t*0.26; c.lineCap='round'; c.stroke(q.hl);
    c.fillStyle='#ffffff'; c.fill(q.dot);
    c.restore();
    c.strokeStyle=col.edge; c.lineWidth=Math.max(1,t*0.08); c.stroke(q.ring);
  }
  // 一种颜色的全部胖胶囊（侧面环）
  function candyBars(c,b,col,E){
    var w=E.w;
    c.fillStyle=lin(c,0,-w/2,0,w/2,[0,col.light,0.45,col.base,1,col.deep]); c.fill(b.bar);
    c.save(); c.clip(b.bar);
    c.strokeStyle=col.deep; c.globalAlpha=0.35; c.lineWidth=w*0.1; c.stroke(b.seam);
    c.globalAlpha=1; c.strokeStyle='rgba(255,255,255,0.85)'; c.lineWidth=w*0.2; c.lineCap='round'; c.stroke(b.hl);
    c.restore();
    c.strokeStyle=col.edge; c.lineWidth=Math.max(1,w*0.07); c.stroke(b.bar);
  }
  function candyLock(c,s,open){
    var hw=88*s, hy=4*s, lift=open?20*s:0;
    var sh=shacklePath(36*s,hy-hw*0.22-lift,hy-hw*0.62-lift);
    c.save(); c.lineCap='round';
    c.strokeStyle='#e0a03c'; c.lineWidth=15*s; sh(c); c.stroke();
    c.strokeStyle=lin(c,0,hy-hw*0.95,0,hy-hw*0.25,[0,'#fff8de',1,'#ffd77a']); c.lineWidth=12*s; sh(c); c.stroke();
    c.translate(-1.6*s,-2*s); c.strokeStyle='rgba(255,255,255,0.9)'; c.lineWidth=3.2*s; sh(c); c.stroke();
    c.restore();
    c.save(); c.shadowColor='rgba(170,40,100,0.35)'; c.shadowBlur=8*s*SD; c.shadowOffsetY=3*s*SD;
    c.fillStyle=lin(c,-hw*0.4,hy-hw*0.45,hw*0.3,hy+hw*0.45,[0,'#ffb0d2',0.5,'#ff6aa6',1,'#e4407c']); heartPath(c,0,hy,hw); c.fill(); c.restore();
    c.save(); heartPath(c,0,hy,hw); c.clip();
    c.strokeStyle='rgba(190,30,95,0.35)'; c.lineWidth=7*s; heartPath(c,1.5*s,hy+2.5*s,hw); c.stroke();
    c.fillStyle='rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(-hw*0.24,hy-hw*0.22,hw*0.13,hw*0.075,-0.65,0,TAU); c.fill();
    c.fillStyle='#ffffff'; c.beginPath(); c.arc(-hw*0.12,hy-hw*0.33,hw*0.03,0,TAU); c.fill();
    c.restore();
    c.strokeStyle='#d23c78'; c.lineWidth=2*s; heartPath(c,0,hy,hw); c.stroke();
    c.fillStyle='rgba(255,255,255,0.55)'; c.beginPath(); c.arc(0,hy+0.5*s,8.5*s,0,TAU); c.fill();
    c.fillStyle='#8e1f52'; c.beginPath(); c.arc(0,hy-0.5*s,6*s,0,TAU); c.fill();
    c.beginPath(); c.moveTo(-3.8*s,hy+3*s); c.lineTo(3.8*s,hy+3*s); c.lineTo(2.4*s,hy+16*s); c.lineTo(-2.4*s,hy+16*s); c.closePath(); c.fill();
    c.fillStyle='#ffffff'; sparklePath(c,hw*0.52,hy-hw*0.5,8*s,0.18); c.fill(); sparklePath(c,-hw*0.58,hy+hw*0.06,4.5*s,0.18); c.fill();
  }
  function heartSprite(K,r,col){
    return sprite(K,r,function(c){
      var w=r*1.7;
      c.fillStyle=lin(c,0,-r,0,r,[0,col.light,0.5,col.base,1,col.deep]); heartPath(c,0,r*0.05,w); c.fill();
      c.strokeStyle=col.edge; c.lineWidth=r*0.09; heartPath(c,0,r*0.05,w); c.stroke();
      c.fillStyle='rgba(255,255,255,0.85)'; c.beginPath(); c.ellipse(-w*0.22,-w*0.16,w*0.11,w*0.065,-0.65,0,TAU); c.fill();
    });
  }
  function starSprite(K,r,fill,edge){
    return sprite(K,r,function(c){
      c.lineJoin='round'; c.fillStyle=fill; c.strokeStyle=edge; c.lineWidth=r*0.14;
      starPath(c,0,0,r*0.86,r*0.4); c.stroke(); c.fill();
      c.fillStyle='rgba(255,255,255,0.75)'; c.beginPath(); c.arc(-r*0.16,-r*0.2,r*0.14,0,TAU); c.fill();
    });
  }
  SK.candy={
    bake:function(K){
      var u=K.u, lu=K.lu, half=K.sl[0].half;
      var F={ L:84*u, w:58*u, t:18.5*u }, E={ L:76*u, w:25*u }, P=56*u;
      // 三种颜色各攒一组路径（粉 / 奶黄 / 天蓝按环序号轮换）
      var R=[], Bs=[], xa0=(F.L-F.w)/2, ra=(F.w-F.t)/2+F.t*0.12, yt=-ra;
      for(var i=0;i<3;i++){ R.push({ ring:new Path2D(), inner:new Path2D(), outer:new Path2D(), hl:new Path2D(), dot:new Path2D() }); Bs.push({ bar:new Path2D(), seam:new Path2D(), hl:new Path2D() }); }
      eachLink(half,P,function(k,x,odd){
        var ci=((k%3)+3)%3;
        if(!odd){
          var q=R[ci], xa=x-xa0;
          stadium(q.ring,x,0,F.L,F.w); stadium(q.ring,x,0,F.L-2*F.t,F.w-2*F.t);
          stadium(q.inner,x,-F.t*0.14,F.L-2*F.t,F.w-2*F.t); stadium(q.outer,x,F.t*0.12,F.L,F.w);
          q.hl.moveTo(xa+Math.cos(PI*1.16)*ra,Math.sin(PI*1.16)*ra); q.hl.arc(xa,0,ra,PI*1.16,PI*1.5); q.hl.lineTo(x+xa0*0.35,yt);
          q.dot.moveTo(x+xa0*0.62+F.t*0.13,yt); q.dot.arc(x+xa0*0.62,yt,F.t*0.13,0,TAU);
        } else {
          var b=Bs[ci];
          stadium(b.bar,x,0,E.L,E.w);
          b.seam.moveTo(x-E.L/2+E.w*0.7,E.w*0.08); b.seam.lineTo(x+E.L/2-E.w*0.7,E.w*0.08);
          b.hl.moveTo(x-E.L/2+E.w*0.6,-E.w*0.22); b.hl.lineTo(x+E.L/2-E.w*0.95,-E.w*0.22);
        }
      });
      for(var si=0;si<K.sl.length;si++) eachLink(half,P,function(k,x,odd){ if(!odd) addPt(K,toPage(K,si,x-F.L*0.12,-F.w/2+F.t*0.4)); });
      K.base=layerFull(K,function(c){
        // 柔和投影：糖果圈一遍、胶囊一遍（胶囊的影子落在圈上，有前后层次）
        blurPass(K,c,F.t*0.45,0,F.t*0.2,function(g){ eachStrand(g,K,function(g){ g.fillStyle='rgba(170,60,120,0.3)'; for(var i=0;i<3;i++) g.fill(R[i].ring,'evenodd'); }); });
        eachStrand(c,K,function(c){ for(var i=0;i<3;i++) candyRings(c,R[i],CANDY[i],F); });
        blurPass(K,c,E.w*0.32,0,E.w*0.15,function(g){ eachStrand(g,K,function(g){ g.fillStyle='rgba(170,60,120,0.3)'; for(var j=0;j<3;j++) g.fill(Bs[j].bar); }); });
        eachStrand(c,K,function(c){ for(var j=0;j<3;j++) candyBars(c,Bs[j],CANDY[j],E); });
      });
      // 扫光层：每个环上半部一层白（只在扫过的斜带里叠）
      K.sheen=layerFull(K,function(c){
        eachStrand(c,K,function(c){
          c.fillStyle=lin(c,0,-F.w/2,0,F.w*0.15,[0,'rgba(255,255,255,0.9)',1,'rgba(255,255,255,0)']); for(var i=0;i<3;i++) c.fill(R[i].ring,'evenodd');
          c.fillStyle=lin(c,0,-E.w/2,0,E.w*0.2,[0,'rgba(255,255,255,0.95)',1,'rgba(255,255,255,0)']); for(var j=0;j<3;j++) c.fill(Bs[j].bar);
        });
      });
      K.lock=sprite(K,76*lu,function(c){ candyLock(c,lu,false); });
      K.lockOpen=sprite(K,96*lu,function(c){ candyLock(c,lu,true); });
      K.spr.h=[heartSprite(K,13*lu,CANDY[0]),heartSprite(K,13*lu,{ light:'#ffe1ea', base:'#ff5d8f', deep:'#e23a6e', edge:'#c92c5e' }),heartSprite(K,13*lu,CANDY[2])];
      K.spr.st=[starSprite(K,12*lu,'#ffe07a','#f2a93b'),starSprite(K,12*lu,'#ffd0e4','#f07fb0')];
      K.spr.gl=sprite(K,9*lu,function(c){ c.fillStyle='#ffffff'; sparklePath(c,0,0,8*lu,0.16); c.fill(); });
    },
    live:function(ctx,K,t,on){ if(on) sweep(ctx,K,K.sheen,t,3400,1500,0.85); },
    // 心形锁一下下心跳（两拍一歇）
    beat:function(t,on){ if(!on) return 1; var k=(t%1600)/1600, b=k<0.12?Math.sin(k/0.12*PI):(k<0.26?0.55*Math.sin((k-0.12)/0.14*PI):0); return 1+0.07*b; },
    card:function(c,B,soft){
      var w=B.bw,h=B.bh,cu=B.cu,r=h*0.45,x=-w/2,y=-h/2,o=4*cu;
      c.save(); c.shadowColor='rgba(220,70,140,0.32)'; c.shadowBlur=10*cu*SD; c.shadowOffsetY=4*cu*SD;
      c.fillStyle='#ff6fac'; ZL.roundRect(c,x-o,y-o,w+o*2,h+o*2,r+o); c.fill(); c.restore();
      c.fillStyle=lin(c,0,y,0,y+h,[0,'#ffffff',1,'#fff0f6']); ZL.roundRect(c,x+2*cu,y+2*cu,w-4*cu,h-4*cu,r-2*cu); c.fill();
      c.strokeStyle='rgba(255,111,172,0.25)'; c.lineWidth=1.4*cu; ZL.roundRect(c,x+7*cu,y+7*cu,w-14*cu,h-14*cu,r-7*cu); c.stroke();
      var hs=[[x+24*cu,y+20*cu,9*cu,'#ffb3d1'],[x+w-26*cu,y+h-22*cu,8*cu,'#ffd98a'],[x+w-24*cu,y+20*cu,5*cu,'#9ad3ff']];
      for(var i=0;i<hs.length;i++){ c.fillStyle=hs[i][3]; heartPath(c,hs[i][0],hs[i][1],hs[i][2]*1.6); c.fill(); }
    },
    num:function(c,B,label){
      var fs=fitFont(c,'900',F_BLACK,label,B.bw*0.68,B.bh*0.68), y=midBase(c,label,0), cu=B.cu;
      c.save(); c.textAlign='center'; c.textBaseline='alphabetic'; c.lineJoin='round';
      c.fillStyle='#ffc2dc'; c.fillText(label,0,y+3.5*cu);
      c.fillStyle=lin(c,0,y-fs*0.75,0,y,[0,'#ff4f9e',1,'#ff9a3a']); c.fillText(label,0,y);
      c.restore();
    },
    chip:function(c,B,text,y,w,h){
      var cu=B.cu;
      c.save();
      c.fillStyle='#ff6fac'; ZL.roundRect(c,-w/2,y-h/2,w,h,h/2); c.fill();
      c.fillStyle='rgba(255,255,255,0.28)'; ZL.roundRect(c,-w/2+3*cu,y-h/2+2*cu,w-6*cu,h*0.42,h*0.25); c.fill();
      c.font='700 '+Math.round(15*cu)+'px '+F_CJK; c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#ffffff'; c.fillText(text,0,y+0.5*cu);
      c.restore();
    },
    hit:function(K,x,y){
      var lu=K.lu, sp=K.spr;
      burst(x,y-10*lu,9,{ sp:sp.h, v0:260*lu, v1:520*lu, arc:PI*1.5, g:900*lu, drag:0.4, life0:640, life1:900, s0:0.75, s1:1.25, spin:3, r:24*lu });
      burst(x,y-10*lu,6,{ sp:sp.st.concat([sp.gl]), v0:300*lu, v1:600*lu, arc:PI*1.6, g:800*lu, drag:0.4, life0:520, life1:780, s0:0.7, s1:1.1, spin:6, r:24*lu });
    },
    brk:function(K,x,y){
      var lu=K.lu, sp=K.spr;
      addFx({ x:x, y:y, r0:30*lu, r1:200*lu, w:9*lu, c1:'#ff8fbf', c2:'#ffffff', life:520, draw:drawRing });
      burst(x,y,20,{ sp:sp.h, v0:380*lu, v1:880*lu, g:1100*lu, drag:0.35, life0:800, life1:1150, s0:0.9, s1:1.6, spin:4, r:20*lu, up:120*lu });
      burst(x,y,12,{ sp:sp.st.concat([sp.gl]), v0:420*lu, v1:900*lu, g:1000*lu, drag:0.35, life0:650, life1:1000, s0:0.8, s1:1.3, spin:7, r:20*lu, up:100*lu });
    }
  };

  // ================= 玫瑰金：细长精致的首饰链 =================
  // 细线环（深 → 中 → 亮 → 高光四层线，模拟圆金属丝）+ 轻投影；正面长椭圆环 + 侧面细环，交叠处编织。
  function roseWire(c,path,t,noShadow){
    c.save(); c.lineJoin='round'; c.lineCap='round';
    if(!noShadow){ c.shadowColor='rgba(90,35,25,0.32)'; c.shadowBlur=t*0.9*SD; c.shadowOffsetY=t*0.45*SD; }
    c.strokeStyle='#7e3f33'; c.lineWidth=t; strokeP(c,path);
    c.restore();
    c.save(); c.lineJoin='round'; c.lineCap='round';
    c.translate(0,-t*0.07); c.strokeStyle='#bd705a'; c.lineWidth=t*0.74; strokeP(c,path);
    c.translate(0,-t*0.08); c.strokeStyle='#e39c83'; c.lineWidth=t*0.46; strokeP(c,path);
    c.translate(0,-t*0.06); c.strokeStyle='#f8d2c0'; c.lineWidth=t*0.24; strokeP(c,path);
    c.translate(0,-t*0.04); c.strokeStyle='#ffffff'; c.lineWidth=t*0.09; strokeP(c,path);
    c.restore();
  }
  // 简约圆形锁扣：抛光圆饼（径向渐变）+ 斜面亮边 + 内圈刻线 + 小钥匙孔 + 一点钻光
  function roseLock(c,s,open){
    var R=32*s, cy=5*s, lift=open?18*s:0;
    roseWire(c,shacklePath(30*s,cy-R+6*s-lift,cy-R-12*s-lift),6.2*s);
    c.save(); c.shadowColor='rgba(90,35,25,0.38)'; c.shadowBlur=8*s*SD; c.shadowOffsetY=3.5*s*SD;
    c.fillStyle=rad(c,-R*0.38,cy-R*0.42,R*0.06,R*1.3,[0,'#fff0e8',0.28,'#f2b9a2',0.62,'#c9785f',1,'#8a4637']); c.beginPath(); c.arc(0,cy,R,0,TAU); c.fill(); c.restore();
    c.strokeStyle='rgba(120,55,42,0.7)'; c.lineWidth=1.4*s; c.beginPath(); c.arc(0,cy,R*0.74,0,TAU); c.stroke();
    c.strokeStyle='rgba(255,236,226,0.8)'; c.lineWidth=1.2*s; c.beginPath(); c.arc(0,cy+1.2*s,R*0.74,0.12*PI,0.88*PI); c.stroke();
    c.strokeStyle='rgba(255,246,240,0.95)'; c.lineWidth=2*s; c.beginPath(); c.arc(0,cy,R-1.6*s,PI*1.02,PI*1.78); c.stroke();
    c.strokeStyle='#6f3328'; c.lineWidth=1.1*s; c.beginPath(); c.arc(0,cy,R,0,TAU); c.stroke();
    c.fillStyle='rgba(255,236,226,0.7)'; c.beginPath(); c.arc(0,cy-1*s,5.6*s,0,TAU); c.fill();
    c.fillStyle='#6a2f25'; c.beginPath(); c.arc(0,cy-2*s,4.4*s,0,TAU); c.fill();
    c.beginPath(); c.moveTo(-2.8*s,cy); c.lineTo(2.8*s,cy); c.lineTo(1.8*s,cy+11*s); c.lineTo(-1.8*s,cy+11*s); c.closePath(); c.fill();
    c.fillStyle='#ffffff'; sparklePath(c,-R*0.6,cy-R*0.6,8*s,0.13); c.fill();
  }
  function glintSprite(K,r,glow){
    return sprite(K,r,function(c){
      c.fillStyle=rad(c,0,0,0,r*0.45,[0,'rgba(255,255,255,0.95)',1,'rgba(255,255,255,0)']); c.beginPath(); c.arc(0,0,r*0.45,0,TAU); c.fill();
      c.shadowColor=glow; c.shadowBlur=r*0.25*SD; c.fillStyle='#ffffff'; sparklePath(c,0,0,r*0.95,0.13); c.fill();
    });
  }
  SK.rosegold={
    bake:function(K){
      var u=K.u, lu=K.lu, half=K.sl[0].half;
      var F={ L:82*u, w:32*u, t:5.4*u }, E={ L:82*u, w:12*u, t:4.8*u }, P=62*u;
      var ys=(E.w-E.t)/2, r=(F.w-F.t)/2, ax=(F.L-F.w)/2, dx=Math.sqrt(Math.max(0,r*r-ys*ys));
      // 正面环 / 侧面环 / 交错裁剪框各攒一条路径
      var fT=new Path2D(), eT=new Path2D(), wv=new Path2D();
      eachLink(half,P,function(k,x,odd){
        if(!odd){ stadium(fT,x,0,F.L-F.t,F.w-F.t); return; }
        stadium(eT,x,0,E.L-E.t,E.w-E.t);
        for(var sd=-1;sd<=1;sd+=2){ var cx0=x+sd*P-sd*(ax+dx); wv.rect(cx0-F.t*1.25,ys-E.t*0.25,F.t*2.5,E.t*1.5); }
      });
      for(var si=0;si<K.sl.length;si++) eachLink(half,P,function(k,x,odd){ if(!odd) addPt(K,toPage(K,si,x-F.L*0.2,-F.w/2+F.t*0.3)); });
      K.base=layerFull(K,function(c){
        // 轻投影：长椭圆环一遍、细环一遍（细环的影子落在长环上）
        var sh='rgba(90,35,25,0.32)';
        blurPass(K,c,F.t*0.9,0,F.t*0.45,function(g){ eachStrand(g,K,function(g){ g.strokeStyle=sh; g.lineWidth=F.t; g.stroke(fT); }); });
        eachStrand(c,K,function(c){ roseWire(c,fT,F.t,true); });
        blurPass(K,c,E.t*0.9,0,E.t*0.45,function(g){ eachStrand(g,K,function(g){ g.strokeStyle=sh; g.lineWidth=E.t; g.stroke(eT); }); });
        eachStrand(c,K,function(c){ roseWire(c,eT,E.t,true); c.save(); c.clip(wv); roseWire(c,fT,F.t,true); c.restore(); });
      });
      K.sheen=layerFull(K,function(c){
        eachStrand(c,K,function(c){
          c.strokeStyle='#fff3ea'; c.lineJoin='round';
          c.save(); c.lineWidth=F.t*0.42; c.translate(0,-F.t*0.2); c.stroke(fT); c.restore();
          c.save(); c.lineWidth=E.t*0.42; c.translate(0,-E.t*0.2); c.stroke(eT); c.restore();
        });
      });
      K.lock=sprite(K,66*lu,function(c){ roseLock(c,lu,false); });
      K.lockOpen=sprite(K,86*lu,function(c){ roseLock(c,lu,true); });
      K.spr.gl=glintSprite(K,12*lu,'rgba(255,190,150,0.95)');
      K.spr.dot=sprite(K,6*lu,function(c){ c.fillStyle=rad(c,-1*lu,-1*lu,0,5*lu,[0,'#fffaf4',0.45,'#f7cfa8',1,'#d79778']); c.beginPath(); c.arc(0,0,4.2*lu,0,TAU); c.fill(); });
    },
    live:function(ctx,K,t,on){ if(on) sweep(ctx,K,K.sheen,t,4200,1800,0.6); twinkles(ctx,K,K.spr.gl,t,on?2:3,2600,on); },
    card:function(c,B,soft){
      var w=B.bw,h=B.bh,cu=B.cu,r=16*cu,x=-w/2,y=-h/2;
      c.save(); c.shadowColor='rgba(120,60,50,0.22)'; c.shadowBlur=12*cu*SD; c.shadowOffsetY=4*cu*SD;
      c.fillStyle=lin(c,0,y,0,y+h,[0,'#fffbf8',1,'#f9ece4']); ZL.roundRect(c,x,y,w,h,r); c.fill(); c.restore();
      var rg=lin(c,x,y,x+w,y+h,[0,'#f0c2ad',0.5,'#c98472',1,'#e8b29d']);
      c.strokeStyle=rg; c.lineWidth=2*cu; ZL.roundRect(c,x+1*cu,y+1*cu,w-2*cu,h-2*cu,r-1*cu); c.stroke();
      c.globalAlpha=0.55; c.lineWidth=1*cu; ZL.roundRect(c,x+6*cu,y+6*cu,w-12*cu,h-12*cu,r-6*cu); c.stroke(); c.globalAlpha=1;
      c.fillStyle=rg; for(var sd=-1;sd<=1;sd+=2){ c.beginPath(); c.moveTo(sd*(w/2-18*cu),-4*cu); c.lineTo(sd*(w/2-14*cu),0); c.lineTo(sd*(w/2-18*cu),4*cu); c.lineTo(sd*(w/2-22*cu),0); c.closePath(); c.fill(); }
    },
    num:function(c,B,label){
      var fs=fitFont(c,'600',F_NUM,label,B.bw*0.66,B.bh*0.6), y=midBase(c,label,0);
      c.save(); c.textAlign='center'; c.textBaseline='alphabetic';
      c.fillStyle='rgba(255,255,255,0.9)'; c.fillText(label,0,y+1.5*B.cu);
      c.fillStyle=lin(c,0,y-fs*0.75,0,y,[0,'#e9a891',0.55,'#b8705f',1,'#9a5848']); c.fillText(label,0,y);
      c.restore();
    },
    chip:function(c,B,text,y,w,h){
      var cu=B.cu;
      c.save();
      c.fillStyle='#fffaf6'; ZL.roundRect(c,-w/2,y-h/2,w,h,h/2); c.fill();
      c.strokeStyle=lin(c,-w/2,0,w/2,0,[0,'#f0c2ad',0.5,'#c98472',1,'#f0c2ad']); c.lineWidth=1.4*cu; ZL.roundRect(c,-w/2,y-h/2,w,h,h/2); c.stroke();
      c.font='700 '+Math.round(15*cu)+'px '+F_CJK; c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#a8604f'; c.fillText(text,0,y+0.5*cu);
      c.restore();
    },
    hit:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:26*lu, r1:90*lu, w:3*lu, c1:'#f2c6b2', c2:'#ffffff', life:480, draw:drawRing });
      burst(x,y,8,{ sp:[K.spr.gl], v0:120*lu, v1:300*lu, drag:0.15, life0:600, life1:900, s0:0.6, s1:1.1, spin:2, r:26*lu, shrink:true });
      burst(x,y,10,{ sp:[K.spr.dot], v0:160*lu, v1:380*lu, drag:0.12, g:120*lu, life0:520, life1:820, s0:0.5, s1:1, r:22*lu, shrink:true });
    },
    brk:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:30*lu, r1:180*lu, w:4*lu, c1:'#f2c6b2', c2:'#ffffff', life:700, draw:drawRing });
      burst(x,y,22,{ sp:[K.spr.gl], v0:160*lu, v1:520*lu, drag:0.2, g:160*lu, life0:700, life1:1100, s0:0.7, s1:1.4, spin:2, r:20*lu, shrink:true });
      burst(x,y,26,{ sp:[K.spr.dot], v0:220*lu, v1:640*lu, drag:0.2, g:420*lu, life0:650, life1:1000, s0:0.6, s1:1.2, r:20*lu, shrink:true });
    }
  };

  // ================= 赛博光束：白芯 → 青蓝 → 紫晕的能量光束 =================
  // 沿光束等距套六边形「锁环」（压扁成透视的环：上半在光束后、下半在光束前）；中心全息六边形锁 + 旋转扫描环。
  function laserBeam(c,half,u){
    var ln=function(c){ c.beginPath(); c.moveTo(-half,0); c.lineTo(half,0); };
    c.save(); c.lineCap='butt';
    c.strokeStyle='#6436ff'; c.lineWidth=25*u; ln(c); c.stroke();
    c.strokeStyle='#3d5cff'; c.lineWidth=18*u; ln(c); c.stroke();
    c.strokeStyle='#22b4ff'; c.lineWidth=12*u; ln(c); c.stroke();
    c.strokeStyle='#a6eeff'; c.lineWidth=6.2*u; ln(c); c.stroke();
    c.strokeStyle='#ffffff'; c.lineWidth=2.8*u; ln(c); c.stroke();
    // 光束里两股缓慢扭动的等离子细丝
    c.lineWidth=1.2*u; c.strokeStyle='rgba(255,255,255,0.75)';
    for(var j=0;j<2;j++){ c.beginPath(); for(var x=-half;x<=half;x+=6*u){ var y=Math.sin(x/(46*u)+j*PI)*4.2*u; if(x===-half) c.moveTo(x,y); else c.lineTo(x,y); } c.stroke(); }
    c.restore();
  }
  // 一组透视六边形环（Path2D 攒好的半边）：深紫外圈 + 青线 + 白芯（光晕在整层模糊里）
  function hexRings(c,path,u){
    c.save(); c.lineJoin='round'; c.lineCap='round';
    c.strokeStyle='#4a2fd8'; c.lineWidth=7*u; c.stroke(path);
    c.strokeStyle='#33ccff'; c.lineWidth=3.8*u; c.stroke(path);
    c.strokeStyle='#ecfcff'; c.lineWidth=1.4*u; c.stroke(path);
    c.restore();
  }
  // 全息六边形锁：深色实心底 + 紫晕青边 + 内圈细线和角点 + 扫描线纹 + 发光钥匙孔
  function laserLock(c,s,soft){
    var R=46*s;
    c.save(); c.shadowColor='rgba(140,80,255,0.95)'; c.shadowBlur=(soft?18:5)*s*SD;
    c.fillStyle='#4a2fd8'; polyPath(c,0,0,R+4*s,6,-PI/2); c.fill(); c.restore();
    c.fillStyle=lin(c,0,-R,0,R,[0,'#101a44',1,'#060819']); polyPath(c,0,0,R,6,-PI/2); c.fill();
    c.save(); polyPath(c,0,0,R,6,-PI/2); c.clip(); c.fillStyle='rgba(80,200,255,0.1)'; c.beginPath(); for(var yy=-R;yy<R;yy+=3.2*s) c.rect(-R,yy,2*R,1.1*s); c.fill(); c.restore();
    c.save(); c.lineJoin='round';
    c.strokeStyle='#38d2ff'; c.lineWidth=3.6*s; polyPath(c,0,0,R-1.5*s,6,-PI/2); c.stroke();
    c.strokeStyle='#effdff'; c.lineWidth=1.2*s; c.stroke();
    c.strokeStyle='rgba(56,210,255,0.55)'; c.lineWidth=1.2*s; polyPath(c,0,0,R*0.7,6,-PI/2); c.stroke();
    c.fillStyle='#a6eeff'; c.beginPath(); for(var i=0;i<6;i++){ var a=-PI/2+i*PI/3, px=Math.cos(a)*R*0.7, py=Math.sin(a)*R*0.7; c.moveTo(px+1.7*s,py); c.arc(px,py,1.7*s,0,TAU); } c.fill();
    c.shadowColor='rgba(60,210,255,1)'; c.shadowBlur=10*s*SD; c.fillStyle='#a6e4ff';
    c.beginPath(); c.arc(0,-6*s,8*s,0,TAU); c.fill();
    c.beginPath(); c.moveTo(-5*s,-1.5*s); c.lineTo(5*s,-1.5*s); c.lineTo(3.4*s,15*s); c.lineTo(-3.4*s,15*s); c.closePath(); c.fill();
    c.shadowBlur=0; c.fillStyle='#ffffff'; c.beginPath(); c.arc(0,-6*s,3.4*s,0,TAU); c.fill();
    c.restore();
  }
  // 闪电（折线，出生即定形，闪两下灭）
  function boltPts(x,y,a,len,n,amp){ var pts=[[x,y]]; for(var i=1;i<=n;i++){ var d=len*i/n, j=i<n?(Math.random()*2-1)*amp:0; pts.push([x+Math.cos(a)*d-Math.sin(a)*j, y+Math.sin(a)*d+Math.cos(a)*j]); } return pts; }
  function drawBolt(ctx,p,k){
    ctx.globalAlpha*=(1-k)*(Math.floor(k*7)%2?0.55:1);
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath(); for(var i=0;i<p.pts.length;i++){ if(i) ctx.lineTo(p.pts[i][0],p.pts[i][1]); else ctx.moveTo(p.pts[i][0],p.pts[i][1]); }
    ctx.strokeStyle='#6436ff'; ctx.lineWidth=p.w*1.8; ctx.stroke();
    ctx.strokeStyle='#38d2ff'; ctx.lineWidth=p.w; ctx.stroke();
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=p.w*0.4; ctx.stroke();
  }
  // 六边形冲击波（边转边扩）
  function drawHexWave(ctx,p,k){
    var e=ZL.easeOut(k), r=p.r0+(p.r1-p.r0)*e;
    ctx.globalAlpha*=1-k; ctx.lineJoin='round';
    polyPath(ctx,p.x,p.y,r,6,-PI/2+e*p.spin);
    ctx.strokeStyle='#38d2ff'; ctx.lineWidth=p.w*(1-0.6*k); ctx.stroke();
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=p.w*0.35*(1-0.6*k); ctx.stroke();
  }
  function laserBolts(K,x,y,n,len){ var lu=K.lu; for(var i=0;i<n;i++){ var a=Math.random()*TAU; addFx({ x:x, y:y, pts:boltPts(x+Math.cos(a)*46*lu,y+Math.sin(a)*46*lu,a,len*(0.6+Math.random()*0.6),7,11*lu), w:3*lu, life:160+Math.random()*120, draw:drawBolt }); } }
  SK.laser={
    bake:function(K){
      var u=K.u, lu=K.lu, soft=K.soft, half=K.sl[0].half, R=27*u, step=150*u, hx=Math.cos(PI/6)*R*0.56;
      // 全部锁环的上半 / 下半各攒一条路径：上半先画（被光束压住）、下半后画（压在光束上）
      var back=new Path2D(), front=new Path2D();
      function halfHex(p,x,part){ p.moveTo(x+hx,0); p.lineTo(x+hx,part*R*0.5); p.lineTo(x,part*R); p.lineTo(x-hx,part*R*0.5); p.lineTo(x-hx,0); }
      for(var s=step;s<half;s+=step) for(var sd=-1;sd<=1;sd+=2){ halfHex(back,sd*s,-1); halfHex(front,sd*s,1); for(var si=0;si<K.sl.length;si++) addPt(K,toPage(K,si,sd*s,0)); }
      K.base=layerFull(K,function(c){
        // 紫外晕：光束和锁环的外圈一次模糊垫底（绿幕下收紧、透明底时放柔）
        blurPass(K,c,(soft?20:4)*u,0,0,function(g){ eachStrand(g,K,function(g,h){ g.strokeStyle='rgba(150,80,255,0.95)'; g.lineWidth=25*u; g.beginPath(); g.moveTo(-h,0); g.lineTo(h,0); g.stroke(); g.lineJoin='round'; g.lineWidth=7*u; g.stroke(back); g.stroke(front); }); });
        eachStrand(c,K,function(c,h){ hexRings(c,back,u); laserBeam(c,h,u); hexRings(c,front,u); });
      });
      K.lock=sprite(K,70*lu,function(c){ laserLock(c,lu,soft); });
      K.spr.sp=streakSprite(K,14*lu,{ tube:'#38d2ff', glow:'60,190,255' });
      K.spr.pulse=sprite(K,16*lu,function(c){ c.fillStyle=rad(c,0,0,0,15*lu,[0,'rgba(255,255,255,1)',0.25,'rgba(190,245,255,0.95)',0.55,'rgba(56,210,255,0.5)',1,'rgba(56,210,255,0)']); c.beginPath(); c.arc(0,0,15*lu,0,TAU); c.fill(); });
    },
    live:function(ctx,K,t,on){
      var g=K.g, u=K.u, seed=on?Math.floor(t/70):11;
      ctx.save(); ctx.lineJoin='round'; ctx.lineCap='round';
      for(var i=0;i<K.sl.length;i++){
        var s=K.sl[i], r=rng(seed*13+i*101+1);
        ctx.save(); ctx.translate(g.cx,g.cy); ctx.rotate(s.ang);
        // 电流：沿光束跳动的锯齿细线（每 70ms 换一次形状），三根攒成一条路径画
        ctx.beginPath();
        for(var j=0;j<3;j++){
          var x=-s.half+r()*s.half*0.5, x1=x+s.half*(0.5+r()*0.9);
          ctx.moveTo(x,(r()*2-1)*3*u);
          while(x<x1){ x+=(9+r()*15)*u; ctx.lineTo(x,(r()*2-1)*6.5*u); }
        }
        ctx.strokeStyle='rgba(156,222,255,0.95)'; ctx.lineWidth=2.4*u; ctx.stroke();
        ctx.strokeStyle='#ffffff'; ctx.lineWidth=0.9*u; ctx.stroke();
        // 能量脉冲：从两头往锁里流
        if(on) for(var q=0;q<2;q++){ var pos=((t*0.42*u+q*s.half*0.5+i*s.half*0.25)%s.half), d=s.half-pos; if(d>66*K.lu){ blit(ctx,K.spr.pulse,d,0,1); blit(ctx,K.spr.pulse,-d,0,1); } }
        ctx.restore();
      }
      ctx.restore();
    },
    // 扫描环：三段弧顺时针转 + 一圈刻度反着转
    lockLive:function(ctx,K,t,on,ls){
      var g=K.g, s=K.lu*ls, R=63*s, a0=on?t*0.0024:0.5;
      ctx.save(); ctx.translate(g.cx,g.cy); ctx.lineCap='round';
      ctx.beginPath(); for(var i=0;i<3;i++){ var a=a0+i*TAU/3; ctx.moveTo(Math.cos(a)*R,Math.sin(a)*R); ctx.arc(0,0,R,a,a+1.05); }
      ctx.strokeStyle='#4a2fd8'; ctx.lineWidth=5*s; ctx.stroke(); ctx.strokeStyle='#38d2ff'; ctx.lineWidth=2.6*s; ctx.stroke(); ctx.strokeStyle='#ffffff'; ctx.lineWidth=0.9*s; ctx.stroke();
      ctx.beginPath(); for(var j=0;j<24;j++){ var b=-a0*0.6+j*TAU/24, r0=R-7*s, r1=R-(j%3?10:13)*s; ctx.moveTo(Math.cos(b)*r0,Math.sin(b)*r0); ctx.lineTo(Math.cos(b)*r1,Math.sin(b)*r1); }
      ctx.strokeStyle='rgba(120,225,255,0.9)'; ctx.lineWidth=1.4*s; ctx.stroke();
      ctx.restore();
    },
    // 断裂时锁像全息信号断了：先横向切片错位乱闪，再像老显示器关机一样压成一道亮线收没（全程不靠半透明淡出，绿幕上不发脏）
    lockBreak:function(ctx,K,p){
      var sp=K.lock, g=K.g, lu=K.lu, r=sp.r, n=7, ch=sp.cv.height/n;
      if(p<0.62){
        var col=Math.max(0,(p-0.32)/0.3), sx=1+0.12*p+0.45*col, sy=Math.max(0.04,1-col);
        for(var i=0;i<n;i++){ var off=(hash(i*3.1+Math.floor(p*16))-0.5)*40*lu*Math.min(1,p*3); ctx.drawImage(sp.cv,0,i*ch,sp.cv.width,ch,g.cx-r*sx+off,g.cy+(-r+i*2*r/n)*sy,2*r*sx,2*r/n*sy); }
      }
      if(p>0.5&&p<0.8){
        var k=(p-0.5)/0.3, w=(1-k)*r*1.8;
        ctx.save(); ctx.lineCap='round';
        ctx.strokeStyle='#38d2ff'; ctx.lineWidth=6*lu*(1-k*0.6); ctx.beginPath(); ctx.moveTo(g.cx-w,g.cy); ctx.lineTo(g.cx+w,g.cy); ctx.stroke();
        ctx.strokeStyle='#ffffff'; ctx.lineWidth=2.4*lu*(1-k*0.6); ctx.stroke();
        ctx.restore();
      }
    },
    card:function(c,B,soft){
      var w=B.bw,h=B.bh,cu=B.cu,k=14*cu,x=-w/2,y=-h/2;
      c.save(); c.shadowColor='rgba(60,190,255,0.9)'; c.shadowBlur=(soft?16:4)*cu*SD;
      c.fillStyle='#2b6dff'; chamfer(c,x-2*cu,y-2*cu,w+4*cu,h+4*cu,k+1*cu); c.fill(); c.restore();
      c.fillStyle=lin(c,0,y,0,y+h,[0,soft?'rgba(12,22,56,0.9)':'#0c1638',1,soft?'rgba(5,8,26,0.92)':'#05081a']); chamfer(c,x,y,w,h,k); c.fill();
      c.save(); chamfer(c,x,y,w,h,k); c.clip(); c.fillStyle='rgba(80,200,255,0.07)'; c.beginPath(); for(var yy=y+2*cu;yy<y+h;yy+=4*cu) c.rect(x,yy,w,1.2*cu); c.fill(); c.restore();
      c.strokeStyle='rgba(79,216,255,0.85)'; c.lineWidth=1.4*cu; chamfer(c,x+4*cu,y+4*cu,w-8*cu,h-8*cu,k-2*cu); c.stroke();
      // 角标：四个角外侧的 L 形
      c.strokeStyle='#94e2ff'; c.lineWidth=2.4*cu; c.lineCap='square';
      var o=8*cu, L=15*cu;
      c.beginPath(); for(var i=0;i<4;i++){ var sx=i%2?1:-1, sy=i<2?-1:1, px=sx*(w/2+o), py=sy*(h/2+o); c.moveTo(px-sx*L,py); c.lineTo(px,py); c.lineTo(px,py-sy*L); } c.stroke();
      c.font='700 '+Math.round(11*cu)+'px '+F_MONO; c.letterSpacing=Math.round(3*cu)+'px'; c.textAlign='left'; c.textBaseline='middle';
      c.fillStyle='rgba(148,226,255,0.9)'; c.fillText('LOCK',x+17*cu,y+15*cu); c.letterSpacing='0px';
      c.fillStyle='#ff3fd2'; c.fillRect(x+w-26*cu,y+11*cu,9*cu,7*cu);
      c.fillStyle='rgba(148,226,255,0.45)'; c.beginPath(); for(var j=0;j<6;j++) c.rect(x+17*cu+j*7*cu,y+h-15*cu,4*cu,3*cu); c.fill();
    },
    num:function(c,B,label){
      var fs=fitFont(c,'700',F_MONO,label,B.bw*0.66,B.bh*0.58), y=midBase(c,label,3*B.cu);
      c.save(); c.textAlign='center'; c.textBaseline='alphabetic';
      c.shadowColor='rgba(40,200,255,1)'; c.shadowBlur=fs*0.35*SD; c.fillStyle='#86e0ff'; c.fillText(label,0,y);
      c.shadowBlur=0; c.fillStyle='#e6fdff'; c.fillText(label,0,y);
      c.restore();
    },
    chip:function(c,B,text,y,w,h,soft){
      var cu=B.cu;
      c.save();
      c.fillStyle=soft?'rgba(6,12,32,0.9)':'#060c20'; chamfer(c,-w/2,y-h/2,w,h,8*cu); c.fill();
      c.strokeStyle='rgba(79,216,255,0.9)'; c.lineWidth=1.3*cu; chamfer(c,-w/2,y-h/2,w,h,8*cu); c.stroke();
      c.fillStyle='#38d2ff'; c.fillRect(-w/2+7*cu,y-h*0.22,3*cu,h*0.44); c.fillRect(w/2-10*cu,y-h*0.22,3*cu,h*0.44);
      c.font='700 '+Math.round(15*cu)+'px '+F_CJK; c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#bff6ff'; c.fillText(text,0,y+0.5*cu);
      c.restore();
    },
    hit:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:50*lu, r1:140*lu, w:6*lu, spin:0.5, life:380, draw:drawHexWave });
      laserBolts(K,x,y,4,120*lu);
      burst(x,y,10,{ sp:[K.spr.sp], v0:420*lu, v1:820*lu, drag:0.03, life0:220, life1:400, s0:0.7, s1:1.1, align:true, r:38*lu });
    },
    brk:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:40*lu, r1:300*lu, w:9*lu, spin:0.7, life:620, draw:drawHexWave });
      addFx({ x:x, y:y, r0:30*lu, r1:200*lu, w:6*lu, spin:-0.5, life:520, draw:drawHexWave });
      laserBolts(K,x,y,9,230*lu);
      burst(x,y,24,{ sp:[K.spr.sp], v0:520*lu, v1:1250*lu, drag:0.05, g:500*lu, life0:320, life1:700, s0:0.8, s1:1.4, align:true, r:36*lu });
    }
  };

  // ================= 冰晶：半透明感冰蓝链环 =================
  // 不靠真半透明（绿幕会透绿），用冷白高光、斜向晶面光带、内圈折射暗边、霜点、冰裂纹、透光焦散画出通透感；
  // 环下沿挂冰锥；中心六边形冰晶锁 + 雪花。
  // 一组冰环（q：环形 / 内圈 / 外圈下沿 / 两种光带 / 三档霜点 / 裂纹 / 高光 / 焦散，都已攒成 Path2D）
  function iceRings(c,q,F){
    var t=F.t;
    c.fillStyle=lin(c,0,-F.w/2,0,F.w/2,[0,'#f4fcff',0.32,'#c6eafe',0.7,'#8fcbf2',1,'#5f9fdc']); c.fill(q.ring,'evenodd');
    c.save(); c.clip(q.ring,'evenodd');
    c.strokeStyle='rgba(38,98,178,0.5)'; c.lineWidth=t*0.6; c.stroke(q.inner);
    c.strokeStyle='rgba(60,120,200,0.35)'; c.lineWidth=t*0.5; c.stroke(q.outer);
    c.fillStyle='rgba(255,255,255,0.45)'; c.fill(q.bandA);
    c.fillStyle='rgba(255,255,255,0.28)'; c.fill(q.bandB);
    c.fillStyle='rgba(255,255,255,0.55)'; c.fill(q.dot[0]); c.fillStyle='rgba(255,255,255,0.75)'; c.fill(q.dot[1]); c.fillStyle='rgba(255,255,255,0.95)'; c.fill(q.dot[2]);
    c.lineJoin='round'; c.lineCap='round';
    c.strokeStyle='rgba(255,255,255,0.75)'; c.lineWidth=Math.max(0.7,t*0.06); c.stroke(q.crack);
    c.strokeStyle='rgba(255,255,255,0.95)'; c.lineWidth=t*0.16; c.stroke(q.hl);
    c.strokeStyle='rgba(236,250,255,0.9)'; c.lineWidth=t*0.13; c.stroke(q.caustic);
    c.restore();
    c.strokeStyle='#4b93d4'; c.lineWidth=Math.max(1,t*0.08); c.stroke(q.ring);
  }
  // 一组侧面冰环：切成两个晶面（上亮下暗，中间一道棱线），斜光带 + 冷白高光
  function iceBars(c,b,E){
    var w=E.w;
    c.fillStyle=lin(c,0,-w/2,0,w/2,[0,'#f2fbff',0.5,'#b9e4fc',0.52,'#86c3ef',1,'#5a9ddb']); c.fill(b.bar);
    c.save(); c.clip(b.bar);
    c.fillStyle='rgba(255,255,255,0.4)'; c.fill(b.bandA);
    c.fillStyle='rgba(255,255,255,0.22)'; c.fill(b.bandB);
    c.lineCap='round';
    c.strokeStyle='rgba(255,255,255,0.75)'; c.lineWidth=w*0.06; c.stroke(b.ridge);
    c.strokeStyle='rgba(255,255,255,0.95)'; c.lineWidth=w*0.15; c.stroke(b.hl);
    c.restore();
    c.strokeStyle='#4b93d4'; c.lineWidth=Math.max(1,w*0.06); c.stroke(b.bar);
  }
  // 冰锥（页面坐标，竖直往下挂）：左亮右暗两个晶面 + 描边 + 一道高光，全部冰锥攒成四条路径
  function icicleAdd(z,x,y,w,len){
    z.left.moveTo(x-w/2,y); z.left.quadraticCurveTo(x-w*0.18,y+len*0.55,x,y+len); z.left.lineTo(x+w*0.06,y); z.left.closePath();
    z.right.moveTo(x+w*0.06,y); z.right.lineTo(x,y+len); z.right.quadraticCurveTo(x+w*0.2,y+len*0.5,x+w/2,y); z.right.closePath();
    z.edge.moveTo(x-w/2,y); z.edge.quadraticCurveTo(x-w*0.18,y+len*0.55,x,y+len); z.edge.quadraticCurveTo(x+w*0.2,y+len*0.5,x+w/2,y);
    z.hl.moveTo(x-w*0.22,y+len*0.08); z.hl.lineTo(x-w*0.08,y+len*0.6);
  }
  function iceLock(c,s,open){
    var R=37*s, cy=8*s, lift=open?18*s:0;
    var sh=shacklePath(34*s,cy-R*0.72-lift,cy-R-13*s-lift);
    c.save(); c.lineCap='round';
    c.strokeStyle='#4b93d4'; c.lineWidth=11.5*s; sh(c); c.stroke();
    c.strokeStyle=lin(c,-17*s,0,17*s,0,[0,'#f4fcff',0.5,'#b4e2fc',1,'#7dbdee']); c.lineWidth=9*s; sh(c); c.stroke();
    c.translate(-1.2*s,-1.6*s); c.strokeStyle='rgba(255,255,255,0.95)'; c.lineWidth=2.4*s; sh(c); c.stroke();
    c.restore();
    c.save(); c.shadowColor='rgba(30,80,150,0.35)'; c.shadowBlur=7*s*SD; c.shadowOffsetY=3*s*SD; c.fillStyle='#8fcbf2'; polyPath(c,0,cy,R,6,-PI/2); c.fill(); c.restore();
    for(var i=0;i<6;i++){
      var a0=-PI/2+i*PI/3, a1=a0+PI/3, am=(a0+a1)/2, b=0.5+0.5*Math.cos(am+PI*0.75);
      c.fillStyle=mixHex('#5a9ddb','#f0faff',b); c.beginPath(); c.moveTo(0,cy); c.lineTo(Math.cos(a0)*R,cy+Math.sin(a0)*R); c.lineTo(Math.cos(a1)*R,cy+Math.sin(a1)*R); c.closePath(); c.fill();
    }
    c.fillStyle='rgba(240,250,255,0.55)'; polyPath(c,0,cy,R*0.56,6,-PI/2); c.fill();
    snowflake(c,0,cy,R*0.5,2*s,'#ffffff');
    c.lineJoin='round'; c.strokeStyle='#ffffff'; c.lineWidth=1.6*s; polyPath(c,0,cy,R-0.8*s,6,-PI/2); c.stroke();
    c.strokeStyle='#3f86c9'; c.lineWidth=1.1*s; polyPath(c,0,cy,R+0.4*s,6,-PI/2); c.stroke();
    c.fillStyle='#ffffff'; sparklePath(c,-R*0.55,cy-R*0.72,6*s,0.14); c.fill();
  }
  function shardSprite(K,r,seed){
    return sprite(K,r,function(c){
      var rnd=rng(seed), n=3+Math.floor(rnd()*3), pts=[];
      for(var i=0;i<n;i++){ var a=i/n*TAU+rnd()*0.8, rr=r*(0.45+rnd()*0.5); pts.push([Math.cos(a)*rr*1.15,Math.sin(a)*rr*0.75]); }
      c.beginPath(); for(var j=0;j<n;j++){ if(j) c.lineTo(pts[j][0],pts[j][1]); else c.moveTo(pts[j][0],pts[j][1]); } c.closePath();
      c.fillStyle=lin(c,-r,-r,r,r,[0,'#f6fdff',0.5,'#b4e2fc',1,'#6fb0e6']); c.fill();
      c.strokeStyle='#ffffff'; c.lineWidth=r*0.1; c.lineJoin='round'; c.stroke();
    });
  }
  SK.ice={
    bake:function(K){
      var u=K.u, lu=K.lu, half=K.sl[0].half, rnd=rng(9127);
      var F={ L:90*u, w:54*u, t:14*u }, E={ L:82*u, w:22*u }, P=66*u;
      var q={ ring:new Path2D(), inner:new Path2D(), outer:new Path2D(), bandA:new Path2D(), bandB:new Path2D(), dot:[new Path2D(),new Path2D(),new Path2D()], crack:new Path2D(), hl:new Path2D(), caustic:new Path2D() };
      var b={ bar:new Path2D(), bandA:new Path2D(), bandB:new Path2D(), ridge:new Path2D(), hl:new Path2D() };
      var L=F.L, w=F.w, t=F.t, xa0=(L-w)/2, rr=w/2-t*0.24;
      function quad(p,x,a,bb,cc,dd){ p.moveTo(x+a[0],a[1]); p.lineTo(x+bb[0],bb[1]); p.lineTo(x+cc[0],cc[1]); p.lineTo(x+dd[0],dd[1]); p.closePath(); }
      eachLink(half,P,function(k,x,odd){
        if(odd){
          var Lb=E.L, wb=E.w;
          stadium(b.bar,x,0,Lb,wb);
          quad(b.bandA,x,[-Lb*0.12,-wb/2],[0,-wb/2],[-Lb*0.08,wb/2],[-Lb*0.2,wb/2]);
          quad(b.bandB,x,[Lb*0.18,-wb/2],[Lb*0.23,-wb/2],[Lb*0.17,wb/2],[Lb*0.12,wb/2]);
          b.ridge.moveTo(x-Lb/2+wb*0.5,wb*0.02); b.ridge.lineTo(x+Lb/2-wb*0.5,wb*0.02);
          b.hl.moveTo(x-Lb/2+wb*0.55,-wb*0.27); b.hl.lineTo(x+Lb/2-wb*1.1,-wb*0.27);
          return;
        }
        stadium(q.ring,x,0,L,w); stadium(q.ring,x,0,L-2*t,w-2*t);
        stadium(q.inner,x,0,L-2*t,w-2*t); stadium(q.outer,x,t*0.14,L,w);
        quad(q.bandA,x,[-L*0.15,-w/2],[-L*0.02,-w/2],[-L*0.2,w/2],[-L*0.33,w/2]);
        quad(q.bandB,x,[L*0.2,-w/2],[L*0.26,-w/2],[L*0.12,w/2],[L*0.06,w/2]);
        for(var i=0;i<16;i++){ var dx0=(rnd()-0.5)*L, dy0=(rnd()-0.5)*w, dr=(0.6+rnd()*1.1)*t*0.08, di=Math.min(2,Math.floor(rnd()*3)); q.dot[di].moveTo(x+dx0+dr,dy0); q.dot[di].arc(x+dx0,dy0,dr,0,TAU); }
        // 冰裂纹：两道从外沿往里裂的细折线
        for(var j=0;j<2;j++){ var sx=x+(rnd()-0.5)*(L-w), sy=(j?1:-1)*w/2, dy=j?-1:1; q.crack.moveTo(sx,sy); q.crack.lineTo(sx+(rnd()-0.5)*t*0.9,sy+dy*t*0.45); q.crack.lineTo(sx+(rnd()-0.5)*t*1.4,sy+dy*t*0.9); }
        // 冷白高光（左上弧 + 上沿）、透光焦散（光穿过冰在内圈下沿聚成一道亮边）
        var xa=x-xa0; q.hl.moveTo(xa+Math.cos(PI*1.08)*rr,Math.sin(PI*1.08)*rr); q.hl.arc(xa,0,rr,PI*1.08,PI*1.5); q.hl.lineTo(x+xa0*0.55,-rr);
        q.caustic.moveTo(x-xa0,(w-2*t)/2+t*0.14); q.caustic.lineTo(x+xa0*0.55,(w-2*t)/2+t*0.14);
      });
      // 冰锥挂在正面环下沿（页面坐标竖直往下），位置 / 长短按种子定
      var z={ left:new Path2D(), right:new Path2D(), edge:new Path2D(), hl:new Path2D() };
      for(var si=0;si<K.sl.length;si++) eachLink(half,P,function(k,x,odd){
        if(odd) return;
        addPt(K,toPage(K,si,x-L*0.16,-w/2+t*0.35));
        var h1=hash(k*3.7+si*11.3), p1=toPage(K,si,x-L*0.12,w/2-t*0.25);
        icicleAdd(z,p1[0],p1[1],(6+h1*2.5)*u,(10+h1*16)*u);
        if(h1>0.45){ var p2=toPage(K,si,x+L*0.2,w/2-t*0.3); icicleAdd(z,p2[0],p2[1],(4.5+h1*1.5)*u,(7+hash(k*9.1+si)*9)*u); }
      });
      K.base=layerFull(K,function(c){
        // 投影：冰环一遍、侧面冰环一遍
        blurPass(K,c,F.t*0.35,0,F.t*0.16,function(g){ eachStrand(g,K,function(g){ g.fillStyle='rgba(30,80,150,0.32)'; g.fill(q.ring,'evenodd'); }); });
        eachStrand(c,K,function(c){ iceRings(c,q,F); });
        blurPass(K,c,E.w*0.3,0,E.w*0.12,function(g){ eachStrand(g,K,function(g){ g.fillStyle='rgba(30,80,150,0.3)'; g.fill(b.bar); }); });
        eachStrand(c,K,function(c){ iceBars(c,b,E); });
        c.fillStyle='#e8f7ff'; c.fill(z.left); c.fillStyle='#93c9f0'; c.fill(z.right);
        c.strokeStyle='#4b93d4'; c.lineWidth=Math.max(0.8,0.6*u); c.lineJoin='round'; c.stroke(z.edge);
        c.strokeStyle='rgba(255,255,255,0.9)'; c.lineWidth=Math.max(0.8,0.7*u); c.lineCap='round'; c.stroke(z.hl);
      });
      K.sheen=layerFull(K,function(c){ eachStrand(c,K,function(c){ c.fillStyle='rgba(255,255,255,0.8)'; c.fill(q.ring,'evenodd'); c.fill(b.bar); }); });
      K.lock=sprite(K,70*lu,function(c){ iceLock(c,lu,false); });
      K.lockOpen=sprite(K,90*lu,function(c){ iceLock(c,lu,true); });
      K.spr.sh=[shardSprite(K,11*lu,11),shardSprite(K,9*lu,23),shardSprite(K,13*lu,37),shardSprite(K,8*lu,51)];
      K.spr.gl=glintSprite(K,13*lu,'rgba(150,215,255,0.95)');
      K.spr.snow=sprite(K,4*lu,function(c){ c.fillStyle='#ffffff'; c.beginPath(); c.arc(0,0,2.6*lu,0,TAU); c.fill(); });
    },
    live:function(ctx,K,t,on){ if(on) sweep(ctx,K,K.sheen,t,5200,1700,0.5); twinkles(ctx,K,K.spr.gl,t,on?3:4,2200,on); },
    card:function(c,B,soft){
      var w=B.bw,h=B.bh,cu=B.cu,r=h*0.26,x=-w/2,y=-h/2;
      c.save(); c.shadowColor='rgba(20,60,120,0.35)'; c.shadowBlur=(soft?16:6)*cu*SD; c.shadowOffsetY=3*cu*SD;
      c.fillStyle=lin(c,0,y,0,y+h,[0,soft?'rgba(126,184,236,0.86)':'#7eb8ec',1,soft?'rgba(52,108,180,0.9)':'#346cb4']); ZL.roundRect(c,x,y,w,h,r); c.fill(); c.restore();
      c.save(); ZL.roundRect(c,x,y,w,h,r); c.clip();
      // 磨砂颗粒：三档透明度各攒一条路径
      var rnd=rng(4431), fr=[new Path2D(),new Path2D(),new Path2D()];
      for(var i=0;i<160;i++){ var px=x+rnd()*w, py=y+rnd()*h, pr=(0.4+rnd()*1.3)*cu, pi=Math.min(2,Math.floor(rnd()*3)); fr[pi].moveTo(px+pr,py); fr[pi].arc(px,py,pr,0,TAU); }
      c.fillStyle='rgba(255,255,255,0.07)'; c.fill(fr[0]); c.fillStyle='rgba(255,255,255,0.13)'; c.fill(fr[1]); c.fillStyle='rgba(255,255,255,0.2)'; c.fill(fr[2]);
      c.fillStyle=lin(c,0,y,0,y+h*0.5,[0,'rgba(255,255,255,0.32)',1,'rgba(255,255,255,0)']); c.fillRect(x,y,w,h*0.5);
      snowflake(c,x+20*cu,y+20*cu,9*cu,1.3*cu,'rgba(255,255,255,0.5)'); snowflake(c,x+w-20*cu,y+h-20*cu,9*cu,1.3*cu,'rgba(255,255,255,0.5)');
      c.restore();
      c.strokeStyle='rgba(255,255,255,0.9)'; c.lineWidth=1.6*cu; ZL.roundRect(c,x+0.8*cu,y+0.8*cu,w-1.6*cu,h-1.6*cu,r); c.stroke();
      c.strokeStyle='#2a5fa3'; c.lineWidth=1*cu; ZL.roundRect(c,x,y,w,h,r); c.stroke();
    },
    num:function(c,B,label){
      var fs=fitFont(c,'700',F_NUM,label,B.bw*0.66,B.bh*0.62), y=midBase(c,label,0), cu=B.cu;
      c.save(); c.textAlign='center'; c.textBaseline='alphabetic';
      c.fillStyle='#1d4f91'; c.fillText(label,0,y+3*cu);
      c.shadowColor='rgba(20,70,150,0.6)'; c.shadowBlur=fs*0.12*SD; c.fillStyle='#ffffff'; c.fillText(label,0,y);
      c.restore();
    },
    chip:function(c,B,text,y,w,h,soft){
      var cu=B.cu;
      c.save();
      c.fillStyle=soft?'rgba(79,143,207,0.9)':'#4f8fcf'; ZL.roundRect(c,-w/2,y-h/2,w,h,h/2); c.fill();
      c.strokeStyle='rgba(255,255,255,0.85)'; c.lineWidth=1.2*cu; ZL.roundRect(c,-w/2+0.6*cu,y-h/2+0.6*cu,w-1.2*cu,h-1.2*cu,h/2); c.stroke();
      c.font='700 '+Math.round(15*cu)+'px '+F_CJK; c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#ffffff'; c.fillText(text,0,y+0.5*cu);
      c.restore();
    },
    hit:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:30*lu, r1:110*lu, w:5*lu, c1:'#9fd6ff', c2:'#ffffff', life:420, draw:drawRing });
      burst(x,y,12,{ sp:K.spr.sh, v0:300*lu, v1:620*lu, g:1300*lu, drag:0.5, life0:500, life1:760, s0:0.7, s1:1.2, spin:9, r:28*lu, up:140*lu });
      burst(x,y,8,{ sp:[K.spr.snow], v0:200*lu, v1:460*lu, g:500*lu, drag:0.3, life0:500, life1:800, s0:0.6, s1:1.2, r:24*lu });
    },
    brk:function(K,x,y){
      var lu=K.lu;
      addFx({ x:x, y:y, r0:30*lu, r1:230*lu, w:7*lu, c1:'#9fd6ff', c2:'#ffffff', life:620, draw:drawRing });
      burst(x,y,30,{ sp:K.spr.sh, v0:380*lu, v1:1000*lu, g:1500*lu, drag:0.45, life0:700, life1:1100, s0:0.8, s1:1.6, spin:10, r:24*lu, up:160*lu });
      burst(x,y,16,{ sp:[K.spr.snow,K.spr.gl], v0:240*lu, v1:700*lu, g:500*lu, drag:0.3, life0:600, life1:1000, s0:0.6, s1:1.2, r:20*lu });
    }
  };

  // 键盘空格解锁
  var keyHooked=false;
  function hookKeys(){
    if(keyHooked) return; keyHooked=true;
    window.addEventListener('keydown',function(e){
      var m=unlockMode();
      if(e.code!=='Space') return;
      if(m!=='space'&&m!=='both') return;
      e.preventDefault();
      if(e.repeat) return;   // 连发由 tick 按 0.35s/0.12s 节奏自己来
      unlockStep();
      spaceHeld=true; spaceHoldMs=0; spaceRepeatMs=0;
      ZL.kick();
    });
    window.addEventListener('keyup',function(e){ if(e.code==='Space'){ spaceHeld=false; spaceHoldMs=0; spaceRepeatMs=0; } });
    // 按住空格时窗口失焦收不到松开：当成松开，不然会每 0.12 秒自动扣一环、新上的锁也被扣光
    window.addEventListener('blur',function(){ spaceHeld=false; spaceHoldMs=0; spaceRepeatMs=0; });
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      hookKeys();
    },
    resize:function(){},
    // 换皮肤 / 尺寸等由缓存键自己发现，下一帧重烤
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      var name=ZL.who(cmd);
      if(op==='clear'){
        // 全部清屏：不演断裂、不出声、不打横幅，锁链和粒子当场收掉
        if(cmd&&cmd.wipe){
          phase='idle'; phaseT=0; remaining=0; shakeT=0; impact=0; fx=[]; pop=0; lockKick=0;
          spaceHeld=false; spaceHoldMs=0; spaceRepeatMs=0;
          if(modern()) scheduleRelease();
          return;
        }
        if(locked()){ beginUnlock(); addShake(); impact=1; api.banner(name?name+' 帮主播直接解开了锁链':'锁链直接解开'); }
        return;
      }
      var n=ZL.count(cmd,1);
      if(op==='add'){
        n=Math.min(n,api.cap());
        remaining=Math.min(MAXN, remaining+n);
        var was=locked();
        if(!was){ phase='locking'; phaseT=0; }   // 空闲 / 正在断裂时再加：重新上锁
        clearTimeout(releaseTimer);
        addShake();
        if(modern()){ pop=1; if(was) lockKick=0.7; }
        ZL.snd('chain/chain_lock.ogg');
        api.banner(name?name+' 给主播加了 '+n+' 环锁链':'锁链 +'+n+' 环');
        return;
      }
      // 减少 / 乘除：只在锁链挂着时生效
      if(!locked()||remaining<=0) return;
      if(op==='reduce'){
        remaining=Math.max(0, remaining-n);
        api.banner(name?name+' 帮主播解开 '+n+' 环':'锁链 −'+n+' 环');
        afterHit();
      }else if(op==='multiply'){
        remaining=Math.min(MAXN, remaining*n);
        addShake(); impact=1;
        var m=modern(); if(m){ pop=1; lockKick=1; skinFx(m,'hit'); }
        ZL.snd('chain/chain_lock.ogg');
        api.banner(name?name+' 让锁链 ×'+n:'锁链 ×'+n);
      }else if(op==='divide'){
        remaining=Math.floor(remaining/n);
        api.banner(name?name+' 让锁链 ÷'+n:'锁链 ÷'+n);
        afterHit();
      }
    },
    pointer:function(type){
      if(type!=='down') return;
      var m=unlockMode();
      if(m==='mouse'||m==='both'){ unlockStep(); return true; }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      if(impact>0) impact=Math.max(0,impact-step/220);
      if(shakeT>0) shakeT-=step;
      var md=modern();
      if(md){
        motionT+=step;
        if(pop>0) pop=Math.max(0,pop-step/200);
        if(lockKick>0) lockKick=Math.max(0,lockKick-step/180);
        if(fx.length) stepFx(step);
      }
      // 空格连发：按住 0.35s 后每 0.12s 一次
      if(spaceHeld && phase==='sustain'){
        spaceHoldMs+=step;
        if(spaceHoldMs>350){ spaceRepeatMs+=step; if(spaceRepeatMs>=120){ spaceRepeatMs=0; unlockStep(); } }
      }
      if(phase==='locking'){
        phaseT+=step;
        if(phaseT>=LOCK_MS){ phase='sustain'; phaseT=0; }
        return true;
      }
      if(phase==='unlocking'){
        phaseT+=step;
        if(phaseT>=unlockMs()){ phase='idle'; phaseT=0; remaining=0; if(md) scheduleRelease(); return !!md&&fx.length>0; }
        return true;
      }
      // 现代款：粒子 / 弹跳没播完继续刷；开着皮肤动态光效时锁链挂着就一直刷
      if(md&&(fx.length>0||pop>0||lockKick>0)) return true;
      if(md&&phase==='sustain'&&remaining>0&&skinMotion()) return true;
      // 常态：只有抖动/冲击光/按住空格时刷帧，其余时间停 rAF 等点击
      return phase==='sustain' && (shakeT>0||impact>0||spaceHeld);
    },
    draw:function(ctx){ drawModern(ctx,modern()); },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){ return { phase:phase, remaining:remaining, skin:modern(), fx:fx.length, motion:skinMotion(), bakeMs:C?C.bakeMs:0 }; }
  };
})());
`
