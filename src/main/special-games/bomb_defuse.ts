// 特色玩法「拆炸弹」的页面内 Canvas 代码（2026-10-08 新玩法）。
// 观众送礼往屏幕上扔一颗定时炸弹（从上面掉下来弹两下），炸弹底下挂着几根不同颜色的线，只有一根是对的：
// 主播点一根线就剪一根——剪下去先停一下、心跳两声（炸弹上打个大问号），再揭晓这根线暗藏的效果：
//   拆除线（每颗只有 1 根）→ 拆弹成功（最后 1 秒剪对是「极限拆弹」）；加速线 → 倒计时加速；雷管线 → 当场爆炸；
//   扣时线 → 扣几秒；哑线 → 什么也没发生、虚惊一场。错线各是哪种按设置里的比例随机分。观众还能送礼「减时」使坏。
// 时间到了爆炸：闪白、震屏、烟火、满屏黑灰，黑灰要按住鼠标擦干净（wipe-layer.ts），也可以设成过一阵自己散；
// 惩罚列表不空时还会随机抽一条惩罚亮出来（唱首歌、学猫叫……）。
// 四种炸弹（cmd.kind）：dynamite 定时炸弹 / cartoon 卡通炸弹（引线随倒计时烧短）/ gift 礼物炸弹（拆开撒彩带）/
//   mega 超级炸弹（大铁桶 + 警报灯，多两根线、时间长一半、炸得更狠）；random 随机。
// 音效（全是合成的，C4 那种感觉）：plant 放炸弹按键输密码 / beep 倒计时滴声（越到最后越急，加速线让它更急）/ final 最后 0.7 秒长鸣 /
//   snip 剪线 / heartbeat 停顿心跳 / wrong 加速线报警 / dud 哑线泄气 / defused 拆除断电 / boom 爆炸 + wipe/*。数码管旁的红灯跟着滴声闪。
// 一次拆一颗，多的排队。炸弹、线、黑灰全是程序画的。
// 操作：add 放炸弹 / hasten 减时（秒）/ reduce 帮主播拆掉 / clear 全部拆除并清掉黑灰。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）；也别写反斜杠。
import { SHARED_JS } from './shared'
import { WIPE_JS } from './wipe-layer'

export const code = SHARED_JS + WIPE_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null, L=null;
  var OPS=['add','hasten','reduce','clear'];
  var KINDS=['dynamite','cartoon','gift','mega'];
  var KIND_NAME={ dynamite:'定时炸弹', cartoon:'卡通炸弹', gift:'礼物炸弹', mega:'超级炸弹' };
  // 线的颜色（全部避开绿色：绿幕抠像会把绿线抠掉）
  var WIRES=[['红','229,57,53'],['蓝','30,136,229'],['黄','253,216,53'],['白','245,245,245'],['橙','251,140,0'],['紫','142,36,170'],
    ['粉','255,105,180'],['青','0,188,212'],['棕','141,94,60'],['灰','140,146,156'],['金','212,175,55'],['黑','38,38,42']];
  var queue=[];            // 等着上场的 {name, avatar, hasten}
  var B=null;              // 当前炸弹
  var parts=[];            // 烟 / 火 / 火花 / 彩带
  var texts=[];            // 飘字
  var nowMs=0, flash=0, shake=0;
  var tally={ defused:0, exploded:0 };
  var TAU=Math.PI*2;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function cfgN(k,d,lo,hi){ return Math.max(lo,Math.min(hi,num(api.cfg[k],d))); }
  function on(k){ return api.cfg[k]!==false&&String(api.cfg[k])!=='false'; }
  function short(){ return Math.min(api.W,api.H); }
  function F(w,px){ return w+' '+Math.round(px)+'px "Microsoft YaHei",sans-serif'; }
  function outBounce(p){ var n1=7.5625,d1=2.75; if(p<1/d1) return n1*p*p; if(p<2/d1) return n1*(p-=1.5/d1)*p+0.75; if(p<2.5/d1) return n1*(p-=2.25/d1)*p+0.9375; return n1*(p-=2.625/d1)*p+0.984375; }
  function rng(seed){ var s=seed>>>0; return function(){ s=(s+0x6D2B79F5)>>>0; var t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

  function size(){ return short()*cfgN('bombSize',42,5,400)/100*(B&&B.kind==='mega'?1.15:1); }
  // 惩罚列表：「、」「，」「/」「|」「；」都算分隔
  function punishments(){
    var t=String(api.cfg.punishList==null?'':api.cfg.punishList), seps=['，',',','/','|','；',';'];
    for(var i=0;i<seps.length;i++) t=t.split(seps[i]).join('、');
    var out=[], parts=t.split('、');
    for(var j=0;j<parts.length;j++){ var p=parts[j].trim(); if(p) out.push(p.slice(0,30)); }
    return out;
  }
  function center(){ return [api.W/2, api.H*0.46]; }
  function geom(){
    var S=size(), c=center(), X=c[0], Y=c[1];
    var dw=S*0.7, dh=S*0.36, dx=X-dw/2, dy=Y-dh/2+S*0.02;
    return { S:S, X:X, Y:Y, dw:dw, dh:dh, dx:dx, dy:dy, y0:dy+dh-S*0.01 };
  }
  // 一根线：从装置底边一个插座垂下来，兜一圈插回另一个插座（三次贝塞尔，采 32 个点）。
  // 插座位置、兜多深每颗炸弹随机（线互相交叉，像真炸弹那样乱），最低点上下错开，好点中。
  function wirePts(g,w){
    var x0=g.X-g.dw*0.38, span=g.dw*0.76;
    var xs=x0+span*w.fs, xe=x0+span*w.fe, depth=g.S*w.fd, bend=g.S*0.06*(xe>xs?-1:1);
    var P=[[xs,g.y0],[xs+bend,g.y0+depth*1.33],[xe-bend,g.y0+depth*1.33],[xe,g.y0]], out=[];
    for(var n=0;n<=32;n++){
      var t=n/32, u=1-t;
      out.push([u*u*u*P[0][0]+3*u*u*t*P[1][0]+3*u*t*t*P[2][0]+t*t*t*P[3][0], u*u*u*P[0][1]+3*u*u*t*P[1][1]+3*u*t*t*P[2][1]+t*t*t*P[3][1]]);
    }
    return out;
  }
  function makeBomb(q){
    var kind=KINDS.indexOf(q.kind)>=0?q.kind:KINDS[Math.floor(Math.random()*KINDS.length)];
    // 线的根数不设上限，防爆：最多 24 根（再多就挤成一团了）；颜色不够就循环用
    var k=Math.trunc(cfgN('wireCount',4,2,24));
    if(kind==='mega') k=Math.min(24,k+2);
    var pool=WIRES.slice();
    for(var i=pool.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=pool[i]; pool[i]=pool[j]; pool[j]=t; }
    var wires=[], right=Math.floor(Math.random()*k);
    // 错线的效果按比例随机：加速 / 雷管 / 扣时 / 哑线（全是 0 就都当加速线）
    var wts=[['speed',cfgN('roleSpeed',40,0,1e6)],['boom',cfgN('roleBoom',30,0,1e6)],['minus',cfgN('roleMinus',0,0,1e6)],['dud',cfgN('roleDud',30,0,1e6)]];
    var sum=0; for(var q=0;q<wts.length;q++) sum+=wts[q][1];
    function pickRole(){ if(sum<=0) return 'speed'; var r=Math.random()*sum; for(var z=0;z<wts.length;z++){ r-=wts[z][1]; if(r<0) return wts[z][0]; } return wts[wts.length-1][0]; }
    // 2k 个插座随机分给 k 根线（两头离得够远才兜得出圈），兜的深度从浅到深错开后打乱
    var slots=[];
    for(var sl=0;sl<k*2;sl++) slots.push(sl/(k*2-1));
    for(var tries=0;tries<40;tries++){
      for(var a=slots.length-1;a>0;a--){ var b=Math.floor(Math.random()*(a+1)); var tt=slots[a]; slots[a]=slots[b]; slots[b]=tt; }
      var okSlots=true;
      for(var c2=0;c2<k;c2++) if(Math.abs(slots[c2*2]-slots[c2*2+1])<0.28){ okSlots=false; break; }
      if(okSlots) break;
    }
    var depths=[];
    for(var dd=0;dd<k;dd++) depths.push(0.17+0.27*dd/Math.max(1,k-1));
    for(var e=depths.length-1;e>0;e--){ var f=Math.floor(Math.random()*(e+1)); var t2=depths[e]; depths[e]=depths[f]; depths[f]=t2; }
    for(var w=0;w<k;w++) wires.push({ name:pool[w%pool.length][0], c:pool[w%pool.length][1], cut:-1, cutT:0, correct:w===right, role:w===right?'defuse':pickRole(), fs:slots[w*2], fe:slots[w*2+1], fd:depths[w] });
    var ms=cfgN('timerSec',15,1,1e6)*1000*(kind==='mega'?1.5:1)-Math.max(0,num(q.hasten,0))*1000;
    ms=Math.max(1000,ms);
    return { kind:kind, name:q.name||'', avatar:q.avatar?ZL.imgRaw(q.avatar):null, wires:wires, left:ms, total:ms, rate:1,
      phase:'in', t:0, beepAcc:0, led:0, finalSnd:false, hurt:0, fade:0 };
  }
  function nextBomb(){ if(!B&&queue.length){ B=makeBomb(queue.shift()); ZL.snd('bomb_defuse/plant.wav',0.8); } }
  // 飘字：整段放在炸弹右边（右边放不下就放左边），别压在炸弹上
  function say(text,color){
    var g=geom(), sz=short()*0.048;
    var w=sz*text.length*0.95, right=g.X+g.S*0.5, left=g.X-g.S*0.5;
    var align=right+w<=api.W-sz*0.5?'left':'right';
    var x=align==='left'?right:left, y=g.Y-g.S*0.05+texts.length%3*sz*1.25;
    texts.push({ x:x, y:y, text:text, color:color, align:align, t:0, max:1300, size:sz }); if(texts.length>30) texts.shift();
  }

  function defuse(by){
    if(!B||(B.phase!=='armed'&&B.phase!=='in'&&B.phase!=='cut')) return;
    B.extreme=B.phase!=='in'&&B.left<1000;
    B.phase='ok'; B.t=0; tally.defused++;
    ZL.snd('bomb_defuse/defused.wav',0.9);
    if(on('winEffect')){ confetti(); if(B.kind==='gift') confetti(); }
    if(by) api.banner(by);
  }
  function explode(){
    if(!B||B.phase==='boom') return;
    var g=geom();
    B.phase='boom'; B.t=0; tally.exploded++;
    var mega=B.kind==='mega';
    flash=1; shake=mega?1100:700; texts=texts.filter(function(t){ return t.t<50; });
    var pl=punishments();
    B.punish=pl.length?pl[Math.floor(Math.random()*pl.length)]:'';
    if(B.punish) api.banner((B.name?B.name+' 的炸弹炸了！':'炸弹炸了！')+'惩罚：'+B.punish);
    ZL.snd('bomb_defuse/boom.wav',1);
    var S=g.S;
    for(var i=0;i<(mega?40:26);i++){ var a=Math.random()*TAU, v=S*(0.4+Math.random()*1.2); parts.push({ k:'smoke', x:g.X, y:g.Y, vx:Math.cos(a)*v, vy:Math.sin(a)*v-S*0.3, r0:S*0.08, r1:S*(0.35+Math.random()*0.35), t:0, max:1300+Math.random()*900 }); }
    for(var f=0;f<16;f++){ var b=Math.random()*TAU, w=S*(0.6+Math.random()*1.4); parts.push({ k:'fire', x:g.X, y:g.Y, vx:Math.cos(b)*w, vy:Math.sin(b)*w, r0:S*0.06, r1:S*(0.18+Math.random()*0.2), t:0, max:380+Math.random()*320 }); }
    for(var s=0;s<34;s++){ var c=Math.random()*TAU, u=S*(2+Math.random()*3); parts.push({ k:'spark', x:g.X, y:g.Y, vx:Math.cos(c)*u, vy:Math.sin(c)*u, t:0, max:420+Math.random()*380 }); }
    // 黑灰：炸弹那儿一大块 + 满屏溅几块
    var life=cfgN('sootFadeSec',0,0,1e6)*1000;
    L.add({ x:g.X, y:g.Y, size:S*1.45, draw:soot, life:life, tint:'28,26,24' });
    // 防爆：一次最多溅 60 块（擦屏层同屏超过上限会让最早的淡掉）
    var n=Math.min(60,Math.trunc(cfgN('sootCount',4,0,1e6))*(mega?2:1));
    for(var k=0;k<n;k++) L.add({ x:api.W*(0.1+Math.random()*0.8), y:api.H*(0.1+Math.random()*0.8), size:S*(0.5+Math.random()*0.45), draw:soot, life:life, tint:'28,26,24' });
  }
  // 一块爆炸黑灰（程序画）：参差的实心团块 + 往外炸开的焦痕 + 溅出去的黑点，只在最外圈留一点烟熏虚边
  function blob(c,x,y,r,rnd,jag){
    var n=26+Math.floor(rnd()*14), pts=[];
    for(var i=0;i<n;i++){ var a=i/n*TAU, rr=r*(1+jag*(rnd()-0.5)+0.12*Math.sin(a*3+rnd()*6)); pts.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr]); }
    c.beginPath(); c.moveTo((pts[n-1][0]+pts[0][0])/2,(pts[n-1][1]+pts[0][1])/2);
    for(var j=0;j<n;j++){ var p=pts[j], q=pts[(j+1)%n]; c.quadraticCurveTo(p[0],p[1],(p[0]+q[0])/2,(p[1]+q[1])/2); }
    c.closePath(); c.fill();
  }
  function soot(c,sp){
    var s=sp.size, cx=s/2, cy=s/2, r=rng(Math.floor(sp.seed*1000)+7);
    var g=c.createRadialGradient(cx,cy,s*0.2,cx,cy,s*0.5);
    g.addColorStop(0,'rgba(26,24,22,0.55)'); g.addColorStop(1,'rgba(26,24,22,0)');
    c.fillStyle=g; c.beginPath(); c.arc(cx,cy,s*0.5,0,TAU); c.fill();
    c.fillStyle='rgba(14,13,12,0.93)';
    blob(c,cx,cy,s*0.24,r,0.55);
    for(var i=0;i<9;i++){ var a=r()*TAU, d=s*(0.12+r()*0.16); blob(c,cx+Math.cos(a)*d,cy+Math.sin(a)*d,s*(0.05+r()*0.08),r,0.7); }
    c.lineCap='round';
    for(var j=0;j<22;j++){
      var b=r()*TAU, l0=s*(0.16+r()*0.08), l1=s*(0.3+r()*0.18), w0=s*(0.012+r()*0.02);
      c.fillStyle='rgba(14,13,12,'+(0.7+r()*0.25)+')';
      c.beginPath(); c.moveTo(cx+Math.cos(b-0.05)*l0,cy+Math.sin(b-0.05)*l0); c.lineTo(cx+Math.cos(b)*l1,cy+Math.sin(b)*l1); c.lineTo(cx+Math.cos(b+0.05)*l0,cy+Math.sin(b+0.05)*l0); c.closePath(); c.fill();
      c.beginPath(); c.arc(cx+Math.cos(b)*l1,cy+Math.sin(b)*l1,w0*0.6,0,TAU); c.fill();
    }
    for(var k=0;k<55;k++){
      var e=r()*TAU, dd=s*(0.26+r()*0.22), rd=s*(0.003+r()*0.012);
      c.fillStyle='rgba(12,11,10,'+(0.6+r()*0.4)+')'; c.beginPath(); c.arc(cx+Math.cos(e)*dd,cy+Math.sin(e)*dd,rd,0,TAU); c.fill();
    }
  }
  function confetti(){
    var cols=['255,82,110','255,196,0','64,156,255','255,140,40','186,104,255','255,255,255'];
    for(var i=0;i<110;i++){
      parts.push({ k:'paper', x:Math.random()*api.W, y:-Math.random()*api.H*0.5, vx:(Math.random()-0.5)*api.W*0.12, vy:api.H*(0.18+Math.random()*0.3),
        w:short()*(0.008+Math.random()*0.012), h:short()*(0.014+Math.random()*0.02), a:Math.random()*6.28, va:(Math.random()-0.5)*10, c:cols[i%cols.length], t:0, max:2600+Math.random()*1200 });
    }
  }
  function cutWire(i,at){
    var w=B.wires[i];
    if(w.cut>=0||B.phase!=='armed') return;
    w.cut=at; w.cutT=0;
    ZL.snd('bomb_defuse/snip.wav',0.9);
    var ms=cfgN('suspenseMs',800,0,1e7);
    if(ms<=0){ reveal(i); return; }
    // 剪下去先别说对错：计时停住、心跳两声、炸弹上打个大问号
    B.phase='cut'; B.t=0; B.cutIdx=i; B.suspense=ms;
    ZL.snd('bomb_defuse/heartbeat.wav',0.9);
  }
  function reveal(i){
    var w=B.wires[i];
    if(B.phase==='cut') B.phase='armed';
    B.revealed=(B.revealed||0)+1;
    if(w.role==='defuse'){ defuse(''); return; }
    if(w.role==='dud'){ say('哑线！虚惊一场','240,248,255'); ZL.snd('bomb_defuse/dud.wav',0.9); return; }
    B.hurt=1;
    if(w.role==='boom'){ say('剪到雷管了！','255,90,90'); explode(); return; }
    ZL.snd('bomb_defuse/wrong.wav',0.8);
    if(w.role==='minus'){ var m=cfgN('wrongMinus',5,0,1e6); B.left=Math.max(0,B.left-m*1000); say('剪错了！−'+m+' 秒','255,90,90'); return; }
    var f=cfgN('speedup',2,1,1e4); B.rate=Math.min(1e6,B.rate*f); say('加速线！倒计时 ×'+(Math.round(B.rate*10)/10),'255,90,90');
  }
  function hitWire(x,y){
    var g=geom(), best=-1, bestAt=0, bestD=1e9, th=g.S*0.032*1.6+4;
    for(var i=0;i<B.wires.length;i++){
      if(B.wires[i].cut>=0) continue;
      var pts=wirePts(g,B.wires[i]);
      for(var n=0;n<pts.length;n++){ var dx=pts[n][0]-x, dy=pts[n][1]-y, d=Math.sqrt(dx*dx+dy*dy); if(d<bestD){ bestD=d; best=i; bestAt=n; } }
    }
    return bestD<=th?[best,Math.max(3,Math.min(29,bestAt))]:null;
  }
  function inBomb(x,y){ var g=geom(); return Math.abs(x-g.X)<=g.S*0.45&&y>=g.Y-g.S*0.5&&y<=g.y0+g.S*0.5; }

  // —— 画炸弹 ——
  function drawSticks(ctx,g){
    var S=g.S, sw=S*0.19, sh=S*0.82;
    for(var i=-1;i<=1;i++){
      var x=g.X+i*S*0.2-sw/2, y=g.Y-sh/2-S*0.04;
      var gr=ctx.createLinearGradient(x,0,x+sw,0);
      gr.addColorStop(0,'#6e0d09'); gr.addColorStop(0.35,'#d8392c'); gr.addColorStop(0.5,'#ff8a70'); gr.addColorStop(0.62,'#cf3024'); gr.addColorStop(1,'#5e0b07');
      ZL.roundRect(ctx,x,y,sw,sh,sw*0.18); ctx.fillStyle=gr; ctx.fill();
      ctx.fillStyle='#ead6b2'; ctx.beginPath(); ctx.ellipse(x+sw/2,y+sw*0.12,sw*0.42,sw*0.12,0,0,TAU); ctx.fill();
      ctx.strokeStyle='rgba(60,30,10,0.6)'; ctx.lineWidth=Math.max(1,S*0.006); ctx.stroke();
      // 引信头
      ctx.strokeStyle='#2a2522'; ctx.lineWidth=Math.max(1.5,S*0.012); ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(x+sw/2,y+sw*0.08); ctx.quadraticCurveTo(x+sw*(0.5+i*0.4),y-S*0.06,x+sw*(0.5+i*0.7),y-S*0.03); ctx.stroke();
    }
    // 两道黑胶带
    for(var b=0;b<2;b++){
      var by=g.Y+(b?S*0.27:-S*0.3), bw=S*0.66, bh=S*0.055;
      var tg=ctx.createLinearGradient(0,by,0,by+bh); tg.addColorStop(0,'#3b3b3e'); tg.addColorStop(1,'#151517');
      ZL.roundRect(ctx,g.X-bw/2,by,bw,bh,bh*0.3); ctx.fillStyle=tg; ctx.fill();
    }
  }
  // 卡通炸弹：黑亮圆球 + 盖子 + 引线（剩多少时间引线剩多长）+ 引线头的火星
  function drawCartoon(ctx,g){
    var S=g.S, cx=g.X, cy=g.Y-S*0.1, r=S*0.45;
    var frac=(B.phase==='ok')?0:Math.max(0.06,Math.min(1,B.left/Math.max(1,B.total)));
    var p0=[cx+r*0.42,cy-r*0.86], p1=[cx+r*0.95,cy-r*1.42], p2=[cx+r*1.25,cy-r*0.95];
    ctx.save(); ctx.lineCap='round';
    ctx.strokeStyle='#7c5a32'; ctx.lineWidth=S*0.032;
    ctx.beginPath(); ctx.moveTo(p0[0],p0[1]);
    var tip=p0;
    for(var i=1;i<=24;i++){ var t=frac*i/24, u=1-t; var x=u*u*p0[0]+2*u*t*p1[0]+t*t*p2[0], y=u*u*p0[1]+2*u*t*p1[1]+t*t*p2[1]; ctx.lineTo(x,y); tip=[x,y]; }
    ctx.stroke();
    ctx.strokeStyle='rgba(255,230,180,0.35)'; ctx.lineWidth=S*0.008; ctx.stroke();
    ctx.restore();
    var gr=ctx.createRadialGradient(cx-r*0.35,cy-r*0.42,r*0.06,cx,cy,r);
    gr.addColorStop(0,'#666b77'); gr.addColorStop(0.32,'#2b2e35'); gr.addColorStop(1,'#09090c');
    ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(cx,cy,r,0,TAU); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.24)'; ctx.beginPath(); ctx.ellipse(cx-r*0.4,cy-r*0.48,r*0.22,r*0.12,-0.7,0,TAU); ctx.fill();
    ctx.save(); ctx.translate(cx+r*0.38,cy-r*0.82); ctx.rotate(0.55);
    var cg=ctx.createLinearGradient(-r*0.18,0,r*0.18,0); cg.addColorStop(0,'#2c3038'); cg.addColorStop(0.5,'#6b717d'); cg.addColorStop(1,'#25282e');
    ZL.roundRect(ctx,-r*0.18,-r*0.12,r*0.36,r*0.24,r*0.05); ctx.fillStyle=cg; ctx.fill();
    ctx.restore();
    if(B.phase!=='ok'){
      // 火星：每帧抖一下
      ctx.save(); ctx.lineCap='round';
      var rr=S*0.06;
      var fg=ctx.createRadialGradient(tip[0],tip[1],0,tip[0],tip[1],rr*1.4); fg.addColorStop(0,'rgba(255,240,170,0.95)'); fg.addColorStop(0.5,'rgba(255,150,40,0.6)'); fg.addColorStop(1,'rgba(255,90,0,0)');
      ctx.fillStyle=fg; ctx.beginPath(); ctx.arc(tip[0],tip[1],rr*1.4,0,TAU); ctx.fill();
      for(var k=0;k<9;k++){
        var a=Math.random()*TAU, l=rr*(0.6+Math.random()*0.9);
        ctx.strokeStyle='rgba(255,'+(170+Math.floor(Math.random()*80))+',60,0.95)'; ctx.lineWidth=Math.max(1.5,S*0.006);
        ctx.beginPath(); ctx.moveTo(tip[0],tip[1]); ctx.lineTo(tip[0]+Math.cos(a)*l,tip[1]+Math.sin(a)*l); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // 礼物炸弹：粉红礼盒 + 金色缎带 + 蝴蝶结
  function drawGiftBox(ctx,g){
    var S=g.S, bw=S*0.9, bh=S*0.62, bx=g.X-bw/2, by=g.Y-S*0.36;
    var gr=ctx.createLinearGradient(bx,0,bx+bw,0); gr.addColorStop(0,'#c2185b'); gr.addColorStop(0.45,'#ff5c8d'); gr.addColorStop(1,'#ad1457');
    ZL.roundRect(ctx,bx,by,bw,bh,S*0.03); ctx.fillStyle=gr; ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.18)';
    for(var dx=0;dx<6;dx++) for(var dy=0;dy<4;dy++){ var px=bx+bw*(0.1+dx*0.16)+(dy%2)*bw*0.08, py=by+bh*(0.15+dy*0.24); ctx.beginPath(); ctx.arc(px,py,S*0.018,0,TAU); ctx.fill(); }
    var lid=ctx.createLinearGradient(0,by-S*0.12,0,by+S*0.02); lid.addColorStop(0,'#ff7aa2'); lid.addColorStop(1,'#d81b60');
    ZL.roundRect(ctx,bx-S*0.035,by-S*0.12,bw+S*0.07,S*0.15,S*0.03); ctx.fillStyle=lid; ctx.fill();
    var rib=ctx.createLinearGradient(g.X-S*0.07,0,g.X+S*0.07,0); rib.addColorStop(0,'#c98a1a'); rib.addColorStop(0.5,'#ffe08a'); rib.addColorStop(1,'#c98a1a');
    ctx.fillStyle=rib; ctx.fillRect(g.X-S*0.065,by-S*0.12,S*0.13,bh+S*0.12);
    // 蝴蝶结
    ctx.save(); ctx.translate(g.X,by-S*0.13);
    for(var sd=-1;sd<=1;sd+=2){
      ctx.save(); ctx.rotate(sd*0.5);
      var lg=ctx.createLinearGradient(0,-S*0.16,0,0); lg.addColorStop(0,'#ffe9a8'); lg.addColorStop(1,'#d79a24');
      ctx.fillStyle=lg; ctx.beginPath(); ctx.ellipse(sd*S*0.1,-S*0.07,S*0.12,S*0.075,0,0,TAU); ctx.fill();
      ctx.strokeStyle='rgba(150,95,10,0.6)'; ctx.lineWidth=Math.max(1,S*0.008); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle='#e6a92c'; ctx.beginPath(); ctx.arc(0,-S*0.02,S*0.045,0,TAU); ctx.fill();
    ctx.restore();
  }
  // 超级炸弹：大铁桶 + 黄黑警示带 + 顶上一闪一闪的警报灯
  function drawBarrel(ctx,g){
    var S=g.S, bw=S*0.92, bh=S*0.98, bx=g.X-bw/2, by=g.Y-S*0.56;
    var gr=ctx.createLinearGradient(bx,0,bx+bw,0); gr.addColorStop(0,'#3a3f46'); gr.addColorStop(0.35,'#9aa3ae'); gr.addColorStop(0.55,'#6d757f'); gr.addColorStop(1,'#2f343a');
    ZL.roundRect(ctx,bx,by,bw,bh,S*0.06); ctx.fillStyle=gr; ctx.fill();
    for(var r2=0;r2<2;r2++){ var ry=by+bh*(r2?0.9:0.1); ctx.fillStyle='rgba(20,22,26,0.55)'; ctx.fillRect(bx,ry-S*0.02,bw,S*0.04); ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(bx,ry-S*0.02,bw,S*0.008); }
    ctx.save(); ctx.beginPath(); ctx.rect(bx,by+bh*0.16,bw,bh*0.08); ctx.clip();
    ctx.fillStyle='#f2c230'; ctx.fillRect(bx,by+bh*0.16,bw,bh*0.08);
    ctx.fillStyle='#1b1b1b';
    for(var x=bx-bh*0.1;x<bx+bw;x+=bh*0.08){ ctx.beginPath(); ctx.moveTo(x,by+bh*0.24); ctx.lineTo(x+bh*0.04,by+bh*0.24); ctx.lineTo(x+bh*0.08,by+bh*0.16); ctx.lineTo(x+bh*0.04,by+bh*0.16); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    var on2=B.phase!=='ok'&&(nowMs%500)<250, lx=g.X, ly=by-S*0.02;
    if(on2){ var gl=ctx.createRadialGradient(lx,ly,0,lx,ly,S*0.3); gl.addColorStop(0,'rgba(255,60,40,0.55)'); gl.addColorStop(1,'rgba(255,60,40,0)'); ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(lx,ly,S*0.3,0,TAU); ctx.fill(); }
    ctx.fillStyle='#2a2d33'; ctx.fillRect(lx-S*0.1,ly-S*0.01,S*0.2,S*0.04);
    var dg=ctx.createRadialGradient(lx-S*0.03,ly-S*0.07,S*0.01,lx,ly-S*0.04,S*0.09); dg.addColorStop(0,on2?'#ffd0c8':'#ff8a80'); dg.addColorStop(1,on2?'#ff2a1a':'#9a1a12');
    ctx.fillStyle=dg; ctx.beginPath(); ctx.arc(lx,ly-S*0.01,S*0.08,Math.PI,0); ctx.closePath(); ctx.fill();
  }
  function drawBody(ctx,g){
    if(B.kind==='cartoon') drawCartoon(ctx,g);
    else if(B.kind==='gift') drawGiftBox(ctx,g);
    else if(B.kind==='mega') drawBarrel(ctx,g);
    else drawSticks(ctx,g);
  }
  function drawDevice(ctx,g){
    var S=g.S;
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,0.45)'; ctx.shadowBlur=S*0.04; ctx.shadowOffsetY=S*0.015;
    var gr=ctx.createLinearGradient(0,g.dy,0,g.dy+g.dh); gr.addColorStop(0,'#5a616b'); gr.addColorStop(0.5,'#3a3f47'); gr.addColorStop(1,'#202329');
    ZL.roundRect(ctx,g.dx,g.dy,g.dw,g.dh,S*0.035); ctx.fillStyle=gr; ctx.fill();
    ctx.restore();
    ctx.save();
    ZL.roundRect(ctx,g.dx,g.dy,g.dw,g.dh,S*0.035); ctx.lineWidth=Math.max(1.5,S*0.008); ctx.strokeStyle='#0d0f12'; ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=Math.max(1,S*0.005);
    ctx.beginPath(); ctx.moveTo(g.dx+S*0.04,g.dy+S*0.008); ctx.lineTo(g.dx+g.dw-S*0.04,g.dy+S*0.008); ctx.stroke();
    // 警示条
    ctx.save(); ZL.roundRect(ctx,g.dx+g.dw*0.08,g.dy+g.dh*0.06,g.dw*0.84,g.dh*0.12,g.dh*0.04); ctx.clip();
    ctx.fillStyle='#f2c230'; ctx.fillRect(g.dx,g.dy,g.dw,g.dh*0.2);
    ctx.fillStyle='#1b1b1b';
    for(var x=g.dx-g.dh*0.2;x<g.dx+g.dw;x+=g.dh*0.16){ ctx.beginPath(); ctx.moveTo(x,g.dy+g.dh*0.2); ctx.lineTo(x+g.dh*0.08,g.dy+g.dh*0.2); ctx.lineTo(x+g.dh*0.16,g.dy); ctx.lineTo(x+g.dh*0.08,g.dy); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // 跟着滴声闪的红灯
    var lr=S*0.026, lxp=g.dx+g.dw*0.94, lyp=g.dy+g.dh*0.12, lit=B?B.led:0;
    if(B&&B.phase==='ok') lit=0;
    if(lit>0.05){ var lgw=ctx.createRadialGradient(lxp,lyp,0,lxp,lyp,lr*4); lgw.addColorStop(0,'rgba(255,40,30,'+(0.7*lit)+')'); lgw.addColorStop(1,'rgba(255,40,30,0)'); ctx.fillStyle=lgw; ctx.beginPath(); ctx.arc(lxp,lyp,lr*4,0,TAU); ctx.fill(); }
    var lg2=ctx.createRadialGradient(lxp-lr*0.3,lyp-lr*0.3,lr*0.1,lxp,lyp,lr);
    lg2.addColorStop(0,lit>0.05?'#ffd6d0':'#7a2a24'); lg2.addColorStop(1,lit>0.05?'#ff2a1a':'#3a0c0a');
    ctx.fillStyle=lg2; ctx.beginPath(); ctx.arc(lxp,lyp,lr,0,TAU); ctx.fill();
    ctx.lineWidth=Math.max(1,S*0.004); ctx.strokeStyle='#111'; ctx.stroke();
    // 四颗螺丝
    var sr=S*0.014;
    var pts=[[g.dx+S*0.03,g.dy+g.dh*0.32],[g.dx+g.dw-S*0.03,g.dy+g.dh*0.32],[g.dx+S*0.03,g.dy+g.dh-S*0.03],[g.dx+g.dw-S*0.03,g.dy+g.dh-S*0.03]];
    for(var i=0;i<4;i++){ ctx.fillStyle='#a3a9b2'; ctx.beginPath(); ctx.arc(pts[i][0],pts[i][1],sr,0,TAU); ctx.fill(); ctx.strokeStyle='#4a4f57'; ctx.lineWidth=Math.max(1,sr*0.35); ctx.beginPath(); ctx.moveTo(pts[i][0]-sr*0.6,pts[i][1]); ctx.lineTo(pts[i][0]+sr*0.6,pts[i][1]); ctx.stroke(); }
    // 数码管
    var lx=g.dx+g.dw*0.12, ly=g.dy+g.dh*0.28, lw=g.dw*0.76, lh=g.dh*0.6;
    ZL.roundRect(ctx,lx,ly,lw,lh,S*0.015); ctx.fillStyle='#070707'; ctx.fill();
    ctx.lineWidth=Math.max(1,S*0.006); ctx.strokeStyle='#30343a'; ctx.stroke();
    var txt='00:00', hot=B&&B.left<3000&&B.phase==='armed';
    if(B){
      if(B.phase==='ok') txt='SAFE';
      else { var ms=Math.max(0,B.left); if(ms>=10000){ var s=Math.ceil(ms/1000); txt=(Math.floor(s/60)<10?'0':'')+Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60); } else { var d=Math.ceil(ms/100)/10; txt=(d<10?'0':'')+d.toFixed(1); } }
    }
    var fs=lh*0.78;
    ctx.font='700 '+Math.round(fs)+'px "Consolas","Courier New",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='rgba(120,10,10,0.16)'; ctx.fillText(txt.length===4?'8888':'88:88',lx+lw/2,ly+lh/2+fs*0.04);
    var blink=hot?(Math.sin(nowMs*0.03)>0?1:0.35):1;
    var col=B&&B.phase==='ok'?'90,210,255':(B&&B.hurt>0?'255,255,255':'255,42,42');
    ctx.save(); ctx.globalAlpha*=blink; ctx.shadowColor='rgba('+col+',0.9)'; ctx.shadowBlur=fs*0.35;
    ctx.fillStyle='rgba('+col+',1)'; ctx.fillText(txt,lx+lw/2,ly+lh/2+fs*0.04);
    ctx.restore();
    if(B&&B.hurt>0){ ZL.roundRect(ctx,g.dx,g.dy,g.dw,g.dh,S*0.035); ctx.fillStyle='rgba(255,40,40,'+(0.45*B.hurt)+')'; ctx.fill(); }
    ctx.restore();
  }
  function drawWires(ctx,g){
    var th=g.S*0.032, k=B.wires.length;
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    for(var i=0;i<k;i++){
      var w=B.wires[i], pts=wirePts(g,w);
      var segs=w.cut>=0?[[0,w.cut-1],[w.cut+1,32]]:[[0,32]];
      for(var s=0;s<segs.length;s++){
        var a=segs[s][0], b=segs[s][1];
        // 剪断的两头往下耷拉
        var droop=function(n){ if(w.cut<0) return 0; var dn=Math.abs(n-w.cut); return dn<8?(8-dn)/8*th*2.2*Math.min(1,w.cutT/200):0; };
        ctx.beginPath();
        for(var n=a;n<=b;n++){ var px=pts[n][0], py=pts[n][1]+droop(n); if(n===a) ctx.moveTo(px,py); else ctx.lineTo(px,py); }
        ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=th*1.4; ctx.stroke();
        ctx.strokeStyle='rgba('+w.c+',1)'; ctx.lineWidth=th; ctx.stroke();
        ctx.save(); ctx.translate(0,-th*0.22); ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=th*0.28; ctx.stroke(); ctx.restore();
        if(w.cut>=0){
          var end=s===0?b:a, ex=pts[end][0], ey=pts[end][1]+droop(end);
          ctx.fillStyle='#d9913f'; ctx.beginPath(); ctx.arc(ex,ey,th*0.42,0,TAU); ctx.fill();
        }
      }
    }
    // 剪断的线揭晓后挂个小牌子：这根是什么线（所有线画完再画，别被别的线压住）
    for(var li=0;li<k;li++){
      var lw=B.wires[li];
      if(lw.cut<0||(B.phase==='cut'&&B.cutIdx===li)||lw.role==='defuse') continue;
      var lab={ speed:'加速', boom:'雷管', minus:'扣时', dud:'哑线' }[lw.role]||'';
      if(!lab) continue;
      var cp=wirePts(g,lw)[lw.cut], fs2=Math.max(13,g.S*0.05);
      ctx.save(); ctx.font=F('800',fs2); ctx.textAlign='center'; ctx.textBaseline='middle';
      var tw2=ctx.measureText(lab).width+fs2*0.9, bh2=fs2*1.5, ly2=cp[1]+th*2.2+bh2/2;
      ZL.roundRect(ctx,cp[0]-tw2/2,ly2-bh2/2,tw2,bh2,bh2/2);
      ctx.fillStyle=lw.role==='dud'?'rgba(40,90,140,0.94)':'rgba(170,30,30,0.95)'; ctx.fill();
      ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.fillText(lab,cp[0],ly2+fs2*0.04);
      ctx.restore();
    }
    // 线头插进装置的两排插座
    for(var j=0;j<k;j++){
      var p=wirePts(g,B.wires[j]);
      ctx.fillStyle='#16181b'; ctx.fillRect(p[0][0]-th*0.7,p[0][1]-th*0.5,th*1.4,th); ctx.fillRect(p[32][0]-th*0.7,p[32][1]-th*0.5,th*1.4,th);
    }
    ctx.restore();
  }
  function drawTag(ctx,g){
    if(!B.name||!on('showName')) return;
    var kn=KIND_NAME[B.kind]||'炸弹', fs=Math.max(13,short()*0.03), text=B.name+' 的'+kn;
    if(B.name.length>10) text=B.name.slice(0,10)+'… 的'+kn;
    ctx.save(); ctx.font=F('700',fs);
    var w=ctx.measureText(text).width+fs*1.4, h=fs*1.8, x=g.X-w/2, y=g.Y-g.S*0.62-h;
    ZL.roundRect(ctx,x,y,w,h,h/2); ctx.fillStyle='rgba(20,22,28,0.78)'; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,200,90,0.8)'; ctx.stroke();
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#ffd88a'; ctx.fillText(text,g.X,y+h/2+fs*0.04);
    ctx.restore();
  }
  function drawBomb(ctx){
    var g=geom(), S=g.S;
    var oy=0, sc=1, alpha=1, jx=0, jy=0;
    if(B.phase==='in'){ var p=Math.min(1,B.t/650); oy=-(g.Y+S)*(1-outBounce(p)); }
    if(B.phase==='armed'&&B.left<3000){ jx=(Math.random()-0.5)*S*0.012; jy=(Math.random()-0.5)*S*0.012; }
    if(B.phase==='ok'&&B.t>1500){ alpha=Math.max(0,1-(B.t-1500)/500); sc=1+0.06*(1-alpha); }
    ctx.save(); ctx.globalAlpha*=alpha;
    ctx.translate(g.X+jx,g.Y+oy+jy); ctx.scale(sc,sc); ctx.translate(-g.X,-g.Y);
    drawBody(ctx,g);
    drawDevice(ctx,g);
    drawWires(ctx,g);
    drawTag(ctx,g);
    if((B.phase==='armed'||B.phase==='in')&&on('showOdds')){
      var fs=Math.max(12,short()*0.026), txt=B.wires.length+' 根线 · 只有 1 根能拆'+(B.wires.some(function(w){ return w.role==='boom'; })?' · 小心雷管':'');
      ctx.save(); ctx.font=F('700',fs); ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.lineJoin='round'; ctx.lineWidth=Math.max(3,fs*0.22); ctx.strokeStyle='rgba(0,0,0,0.7)';
      var oy2=g.y0+g.S*0.52+fs; ctx.strokeText(txt,g.X,oy2); ctx.fillStyle='#ffe6a8'; ctx.fillText(txt,g.X,oy2);
      ctx.restore();
    }
    ctx.restore();
    if(B.phase==='cut'){
      // 心跳一样一下一下鼓的大问号
      var beat=B.t%600, k2=1+0.18*Math.max(0,1-Math.abs(beat-60)/90)+0.12*Math.max(0,1-Math.abs(beat-260)/90);
      var qs=g.S*0.34;
      ctx.save(); ctx.translate(g.X+g.S*0.62,g.Y-g.S*0.38); ctx.scale(k2,k2);
      ctx.font='900 '+Math.round(qs)+'px "Microsoft YaHei",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.lineJoin='round'; ctx.lineWidth=Math.max(4,qs*0.12); ctx.strokeStyle='rgba(0,0,0,0.75)';
      ctx.strokeText('？',0,0); ctx.fillStyle='#ffd34d'; ctx.fillText('？',0,0);
      ctx.restore();
    }
  }
  function drawBig(ctx,text,sub,col,t,third){
    var a=Math.min(1,t/160), s=ZL.easeOutBack(Math.min(1,t/360)), fs=Math.max(26,short()*0.1);
    ctx.save(); ctx.globalAlpha*=a; ctx.translate(api.W/2,api.H*0.2); ctx.scale(Math.max(0.01,s),Math.max(0.01,s));
    ctx.font='900 '+Math.round(fs)+'px "Microsoft YaHei",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineJoin='round'; ctx.lineWidth=Math.max(4,fs*0.16); ctx.strokeStyle='rgba(0,0,0,0.75)';
    ctx.strokeText(text,0,0); ctx.fillStyle=col; ctx.fillText(text,0,0);
    if(sub){ ctx.font=F('700',fs*0.34); ctx.lineWidth=Math.max(3,fs*0.07); ctx.strokeText(sub,0,fs*0.75); ctx.fillStyle='#fff'; ctx.fillText(sub,0,fs*0.75); }
    if(third){ ctx.font=F('800',fs*0.42); ctx.lineWidth=Math.max(3,fs*0.08); var ty3=fs*(sub?1.3:0.8); ctx.strokeText(third,0,ty3); ctx.fillStyle='#ffd34d'; ctx.fillText(third,0,ty3); }
    ctx.restore();
  }
  function statsShown(){ var m=String(api.cfg.statsPanel||'active'); if(m==='off') return false; if(m==='always') return true; return !!B||queue.length>0||L.count()>0; }
  function drawStats(ctx){
    if(!statsShown()){ if(api.hud) api.hud(0); return; }
    var lines=[];
    if(B&&(B.phase==='armed'||B.phase==='in')) lines.push('炸弹倒计时 '+Math.max(0,Math.ceil(B.left/1000))+' 秒'+(B.rate>1.01?'（×'+(Math.round(B.rate*10)/10)+'）':''));
    if(queue.length) lines.push('还有 '+queue.length+' 颗排队');
    lines.push('拆掉 '+tally.defused+' 颗 · 炸了 '+tally.exploded+' 颗');
    if(L.count()>0) lines.push('黑灰还有 '+L.count()+' 块，按住鼠标擦');
    var fs=Math.max(13,Math.min(20,api.W*0.016));
    ctx.save(); ctx.font=F('600',fs);
    var w=0,i;
    for(i=0;i<lines.length;i++) w=Math.max(w,ctx.measureText(lines[i]).width);
    var padX=fs*0.9,padY=fs*0.55,lh=fs*1.5,ph=lines.length*lh+padY*2-lh*0.5;
    var top=api.hud?api.hud(ph):10;
    ZL.roundRect(ctx,10,top,w+padX*2,ph,12); ctx.fillStyle='rgba(20,22,28,0.66)'; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='middle';
    for(i=0;i<lines.length;i++){
      var ly=top+padY+i*lh+lh*0.32;
      ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.14); ctx.strokeStyle='rgba(0,0,0,0.6)';
      ctx.strokeText(lines[i],10+padX,ly); ctx.fillStyle='#fff'; ctx.fillText(lines[i],10+padX,ly);
    }
    ctx.restore();
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      L=ZL.splatLayer(a,{ brush:function(){ return api.cfg.brushSize; }, clean:function(){ return api.cfg.cleanPercent; },
        sound:function(n){ ZL.snd('wipe/'+n+'.wav',n==='squeak'?0.35:0.8); } });
    },
    resize:function(){ L.resize(); },
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS), name=ZL.who(cmd);
      if(op==='clear'){ B=null; queue=[]; parts=[]; texts=[]; L.clear(); flash=0; shake=0; return; }
      var n=Math.min(ZL.count(cmd,1),api.cap());
      if(op==='hasten'){
        if(B&&(B.phase==='armed'||B.phase==='in'||B.phase==='cut')){
          B.left=Math.max(0,B.left-n*1000); B.hurt=1;
          say('−'+n+' 秒','255,90,90');
          ZL.snd('bomb_defuse/beep.wav',1);
          api.banner(name?name+' 给炸弹减了 '+n+' 秒！':'炸弹 −'+n+' 秒');
        }else if(queue.length){ queue[0].hasten=(queue[0].hasten||0)+n; api.banner(name?name+' 给下一颗炸弹减了 '+n+' 秒':'下一颗炸弹 −'+n+' 秒'); }
        return;
      }
      if(op==='reduce'){
        var left=n;
        if(B&&(B.phase==='armed'||B.phase==='in'||B.phase==='cut')){ defuse(name?name+' 帮主播拆掉了炸弹':'炸弹被拆掉了'); left--; }
        while(left>0&&queue.length){ queue.shift(); left--; }
        return;
      }
      n=Math.min(n,99999-queue.length);
      var kd=String((cmd&&cmd.kind)||'random');
      for(var i=0;i<n;i++) queue.push({ name:name, avatar:cmd&&cmd.avatar||'', hasten:0, kind:kd });
      var kn=KIND_NAME[kd]||'炸弹';
      api.banner(name?(n>1?name+' 扔来 '+n+' 颗'+kn+'！快拆':name+' 扔来一颗'+kn+'！快拆'):(n>1?n+' 颗'+kn+'来了！':kn+'来了！'));
      nextBomb();
    },
    pointer:function(type,x,y){
      if(type==='down'&&B&&B.phase==='armed'){
        var h=hitWire(x,y);
        if(h){ cutWire(h[0],h[1]); return true; }
        if(inBomb(x,y)) return true;
      }
      if(type==='down'&&B&&(B.phase==='in'||B.phase==='cut')&&inBomb(x,y)) return true;
      return L.pointer(type,x,y);
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      var active=L.tick(step);
      if(flash>0){ flash=Math.max(0,flash-step/350); active=true; }
      if(shake>0){ shake=Math.max(0,shake-step); active=true; }
      if(!B) nextBomb();
      if(B){
        active=true;
        B.t+=step;
        if(B.hurt>0) B.hurt=Math.max(0,B.hurt-step/420);
        for(var w=0;w<B.wires.length;w++) if(B.wires[w].cut>=0) B.wires[w].cutT+=step;
        if(B.phase==='in'&&B.t>=650){ B.phase='armed'; B.t=0; B.beepAcc=1e9; }   // 落稳当下先滴一声（C4 装好那一下），之后按节奏滴
        if(B.phase==='cut'&&B.t>=B.suspense){ reveal(B.cutIdx); }
        if(B.led>0) B.led=Math.max(0,B.led-step/140);
        if(B.phase==='armed'){
          B.left-=step*B.rate;
          // 滴声节奏：一开始一秒一滴，越到最后越急（按剩余比例算，加速线让它跟着更急）；真实剩 0.7 秒放一串长鸣
          if(B.left>0){
            var realLeft=B.left/Math.max(0.1,B.rate);
            if(realLeft<=700){ if(!B.finalSnd){ B.finalSnd=true; B.led=1; if(on('beep')) ZL.snd('bomb_defuse/final.wav',0.85); } }
            else {
              var fr=Math.max(0,Math.min(1,B.left/Math.max(1,B.total)));
              B.beepAcc+=step;
              if(B.beepAcc>=(110+890*Math.pow(fr,1.25))/Math.max(0.1,B.rate)){ B.beepAcc=0; B.led=1; if(on('beep')) ZL.snd('bomb_defuse/beep.wav',0.7); }
            }
          }
          if(B.left<=0) explode();
        }
        if(B&&B.phase==='ok'&&B.t>=2000){ B=null; }
        else if(B&&B.phase==='boom'&&B.t>=(B.punish?3600:1700)){ B=null; }
      }
      for(var i=parts.length-1;i>=0;i--){
        var p=parts[i]; p.t+=step;
        if(p.t>=p.max){ parts.splice(i,1); continue; }
        var s=step/1000;
        if(p.k==='paper'){ p.x+=p.vx*s+Math.sin((p.t+i*90)*0.004)*api.W*0.0008*step; p.y+=p.vy*s; p.a+=p.va*s; }
        else { p.x+=p.vx*s; p.y+=p.vy*s; var damp=p.k==='spark'?0.96:0.93; p.vx*=damp; p.vy*=damp; if(p.k==='smoke') p.vy-=short()*0.05*s; }
        active=true;
      }
      for(var j=texts.length-1;j>=0;j--){ texts[j].t+=step; if(texts[j].t>=texts[j].max) texts.splice(j,1); else active=true; }
      return active;
    },
    draw:function(ctx){
      var sx=shake>0?(Math.random()-0.5)*short()*0.03*shake/700:0, sy=shake>0?(Math.random()-0.5)*short()*0.03*shake/700:0;
      ctx.save(); ctx.translate(sx,sy);
      L.draw(ctx);
      if(B&&B.phase!=='boom') drawBomb(ctx);
      for(var i=0;i<parts.length;i++){
        var p=parts[i], a=1-p.t/p.max;
        ctx.save(); ctx.globalAlpha*=Math.max(0,a);
        if(p.k==='smoke'||p.k==='fire'){
          var r=p.r0+(p.r1-p.r0)*Math.min(1,p.t/(p.max*0.6));
          var g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
          if(p.k==='smoke'){ g.addColorStop(0,'rgba(58,56,54,0.75)'); g.addColorStop(1,'rgba(58,56,54,0)'); }
          else { g.addColorStop(0,'rgba(255,236,150,0.95)'); g.addColorStop(0.45,'rgba(255,128,30,0.8)'); g.addColorStop(1,'rgba(200,40,10,0)'); }
          ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,r,0,TAU); ctx.fill();
        }else if(p.k==='spark'){
          ctx.strokeStyle='rgba(255,210,120,1)'; ctx.lineWidth=Math.max(1.5,short()*0.004); ctx.lineCap='round';
          ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-p.vx*0.03,p.y-p.vy*0.03); ctx.stroke();
        }else if(p.k==='paper'){
          ctx.globalAlpha=Math.min(1,(p.max-p.t)/400);
          ctx.translate(p.x,p.y); ctx.rotate(p.a); ctx.scale(1,Math.abs(Math.cos(p.a*1.7))*0.8+0.2);
          ctx.fillStyle='rgba('+p.c+',0.95)'; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
        }
        ctx.restore();
      }
      ctx.restore();
      for(var j=0;j<texts.length;j++){
        var t=texts[j], ta=1-t.t/t.max;
        ctx.save(); ctx.globalAlpha*=Math.max(0,ta);
        // 实测宽度：炸弹旁边放不下（竖屏窄窗口）就缩字号（最小六成），还放不下就整段夹回画面里，不让字被画面边缘切掉
        var tfs=t.size, tfont=function(s){ ctx.font='900 '+Math.round(s)+'px "Microsoft YaHei",sans-serif'; };
        tfont(tfs);
        var tm=tfs*0.3, tw=ctx.measureText(t.text).width, avail=t.align==='left'?api.W-tm-t.x:t.align==='right'?t.x-tm:api.W-tm*2;
        if(tw>avail&&avail>0){ tfs=Math.max(t.size*0.6,tfs*avail/tw); tfont(tfs); tw=ctx.measureText(t.text).width; }
        var tx=t.x;
        if(t.align==='left') tx=Math.max(tm,Math.min(tx,api.W-tm-tw));
        else if(t.align==='right') tx=Math.min(api.W-tm,Math.max(tx,tm+tw));
        ctx.textAlign=t.align||'center'; ctx.textBaseline='middle';
        ctx.lineJoin='round'; ctx.lineWidth=Math.max(4,tfs*0.2); ctx.strokeStyle='rgba(0,0,0,0.8)';
        var yy=t.y-t.t*0.04; ctx.strokeText(t.text,tx,yy); ctx.fillStyle='rgba('+t.color+',1)'; ctx.fillText(t.text,tx,yy);
        ctx.restore();
      }
      if(B&&B.phase==='ok'){
        var okT=B.extreme?'极限拆弹！':B.kind==='gift'?'拆出惊喜！':B.kind==='mega'?'超级炸弹拆除！':'拆弹成功！';
        drawBig(ctx,okT,B.name?B.name+' 的'+(KIND_NAME[B.kind]||'炸弹')+'被拆了':'',B.extreme?'#ff8a3d':'#ffd34d',B.t);
      }
      if(B&&B.phase==='boom') drawBig(ctx,B.kind==='mega'?'轰——！':B.kind==='gift'?'礼物炸了！':'炸了！',L.count()?'满屏黑灰，按住鼠标擦干净':'','#ff6a3d',B.t,B.punish?'惩罚：'+B.punish:'');
      if(flash>0){ ctx.save(); ctx.fillStyle='rgba(255,250,235,'+(0.78*flash)+')'; ctx.fillRect(0,0,api.W,api.H); ctx.restore(); }
      drawStats(api.hudCtx||ctx);
    },
    // 只读调试钩子（离线验收用，生产不调用）：每根线可点的位置（线最低点）、对不对、剪没剪
    debug:function(){
      var wires=[];
      if(B){ var g=geom(); for(var i=0;i<B.wires.length;i++){ var p=wirePts(g,B.wires[i])[16]; wires.push([Math.round(p[0]),Math.round(p[1]),B.wires[i].correct,B.wires[i].cut>=0,B.wires[i].role]); } }
      return { phase:B?B.phase:'', kind:B?B.kind:'', total:B?B.total:0, left:B?Math.round(B.left):0, rate:B?B.rate:0, queue:queue.length, wires:wires, punish:B&&B.punish||'', extreme:!!(B&&B.extreme),
        splats:L.count(), hits:L.debug(), defused:tally.defused, exploded:tally.exploded, parts:parts.length };
    }
  };
})());
`
