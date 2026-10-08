// 特色玩法「礼物拔河」的页面内 Canvas 代码（2026-10-08 新玩法）。
// 画面下方一条拔河绳：观众每送一份礼物把绳结往观众那边拉一截，主播狂点画面（或按空格）往回拽；
// 绳结先到哪边的终点线哪边赢，限时到了看绳结在谁那边。观众赢 → 主播被砸一脸奶油 / 鸡蛋 / 番茄（按住鼠标擦干净，见 wipe-layer.ts）；
// 主播赢 → 满屏彩带。一局进行中点画面哪儿都算拉一下（上层玩法点中自己的东西除外）。
// 操作：add 观众拉 N 下（没在比就开一局）/ reduce 替主播拉 N 下 / clear 结束这一局并清掉糊的东西。
// 素材：tug_of_war/{cake,egg,tomato}.png（飞来的）+ *_splat_1~2.png（糊屏）；音效全是合成的：pull/whistle/win/lose + wipe/*。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）；也别写反斜杠。
import { SHARED_JS } from './shared'
import { WIPE_JS } from './wipe-layer'

export const code = SHARED_JS + WIPE_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null, L=null;
  var OPS=['add','reduce','clear'];
  var KINDS={
    cake:{ fly:'tug_of_war/cake.png', splat:['tug_of_war/cake_splat_1.png','tug_of_war/cake_splat_2.png'], tint:'250,246,236' },
    egg:{ fly:'tug_of_war/egg.png', splat:['tug_of_war/egg_splat_1.png','tug_of_war/egg_splat_2.png'], tint:'255,206,70', drip:'250,234,186' },
    tomato:{ fly:'tug_of_war/tomato.png', splat:['tug_of_war/tomato_splat_1.png','tug_of_war/tomato_splat_2.png'], tint:'204,34,24' }
  };
  var R=null;              // 当前一局 {p, shown, t, dur, result, rt, vp, sp, fade, next}
  var team=[];             // 观众队最近出力的人 {name, img, n}
  var fx=[];               // 飘字 {x,y,text,color,t,max}
  var paper=[];            // 彩带
  var flying=[];           // 飞来的惩罚 {kind,img,sx,sy,tx,ty,t,dur,size,rot,spin}
  var nowMs=0, jerk=0, jerkV=0, swing=0, swingV=0, shake=0, pullSndAt=0;
  var wins={ viewers:0, streamer:0 };
  var keysHooked=false;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function cfgN(k,d,lo,hi){ return Math.max(lo,Math.min(hi,num(api.cfg[k],d))); }
  // 数值不设上限（用户：「所有数值默认无上限」），这里的上界只是防爆
  function roundMs(){ return cfgN('roundSec',30,1,1e6)*1000; }
  function giftPull(){ return cfgN('giftPull',8,0.1,1e6)/100; }
  function clickPull(){ return cfgN('clickPull',1.5,0.01,1e6)/100; }
  function spaceOn(){ return api.cfg.spacePull!==false&&String(api.cfg.spacePull)!=='false'; }
  function penaltyKind(){ var k=String(api.cfg.penalty||'random'); if(KINDS[k]) return k; var ks=['cake','egg','tomato']; return ks[Math.floor(Math.random()*ks.length)]; }
  function short(){ return Math.min(api.W,api.H); }
  function ropeY(){ return api.H*cfgN('ropeY',80,40,95)/100; }
  function span(){ return api.W*0.32; }
  function thick(){ return Math.max(8,short()*0.028); }
  function playing(){ return !!R&&!R.result; }
  function F(w,px){ return w+' '+Math.round(px)+'px "Microsoft YaHei",sans-serif'; }

  function addFx(side,n){
    var last=fx[fx.length-1];
    if(last&&last.side===side&&last.t<350){ last.n+=n; last.t=0; last.text='+'+last.n; return; }
    var kx=api.W/2+(R?R.shown:0)*span();
    fx.push({ side:side, n:n, x:kx+(side==='v'?-1:1)*thick()*3.2, y:ropeY()-thick()*2.6, text:'+'+n,
      color:side==='v'?'255,92,110':'96,182,255', t:0, max:900, size:short()*(side==='v'?0.05:0.04) });
    if(fx.length>40) fx.shift();
  }

  function startRound(){
    R={ p:0, shown:0, t:0, dur:roundMs(), result:'', rt:0, vp:0, sp:0, fade:0, next:0 };
    team=[];
    ZL.snd('tug_of_war/whistle.wav',0.8);
  }
  function credit(cmd,n){
    var name=ZL.who(cmd)||'观众';
    for(var i=0;i<team.length;i++){ if(team[i].name===name){ var e=team.splice(i,1)[0]; e.n+=n; team.unshift(e); return; } }
    team.unshift({ name:name, img:cmd&&cmd.avatar?ZL.imgRaw(cmd.avatar):null, n:n });
    if(team.length>3) team.length=3;
  }
  function pullViewers(n,cmd){
    if(!playing()) return;
    R.p=Math.max(-1,R.p-giftPull()*n); R.vp+=n;
    jerkV-=thick()*2.2; swingV-=0.6;
    if(cmd) credit(cmd,n);
    addFx('v',n);
    ZL.snd('tug_of_war/pull.wav',0.9);
    if(R.p<=-1) finish('viewers');
  }
  function pullStreamer(n){
    if(!playing()) return;
    R.p=Math.min(1,R.p+clickPull()*n); R.sp+=n;
    jerkV+=thick()*0.9; swingV+=0.25;
    addFx('s',n);
    if(nowMs-pullSndAt>110){ pullSndAt=nowMs; ZL.snd('tug_of_war/pull.wav',0.5); }
    if(R.p>=1) finish('streamer');
  }
  function finish(who){
    if(!R||R.result) return;
    R.result=who; R.rt=0;
    if(who==='viewers'){ wins.viewers++; ZL.snd('tug_of_war/lose.wav',0.9); throwPenalty(); }
    else if(who==='streamer'){ wins.streamer++; ZL.snd('tug_of_war/win.wav',0.9); if(api.cfg.winEffect!==false&&String(api.cfg.winEffect)!=='false') confetti(); }
  }
  function throwPenalty(){
    // 防爆：一次最多飞 200 个（同屏糊块再多擦屏层自己会让最早的淡掉）；一块最大画面短边的 4 倍
    var n=Math.min(200,Math.trunc(cfgN('penaltyCount',3,1,1e6)));
    var size=short()*cfgN('splatSize',36,2,400)/100;
    for(var i=0;i<n;i++){
      var kind=penaltyKind(), k=KINDS[kind];
      var s=size*(0.85+Math.random()*0.3);
      flying.push({ kind:kind, img:ZL.img(k.fly), sx:api.W*(0.3+Math.random()*0.4), sy:api.H*1.12,
        tx:api.W*(0.14+Math.random()*0.72), ty:api.H*(0.14+Math.random()*0.52), t:-650-i*260, dur:520, size:s,
        rot:(Math.random()-0.5)*0.8, spin:(Math.random()-0.5)*7, whoosh:false });
    }
  }
  function land(f){
    var k=KINDS[f.kind];
    var drips=(api.cfg.drips===false||String(api.cfg.drips)==='false')?0:3;
    var life=cfgN('autoClearSec',0,0,1e6)*1000;
    L.add({ x:f.tx, y:f.ty, size:f.size, img:ZL.img(k.splat[Math.floor(Math.random()*k.splat.length)]), rot:(Math.random()-0.5)*1.2,
      tint:k.tint, dripTint:k.drip||k.tint, drips:drips, dripLen:f.size*0.55, life:life });
    L.burst(f.tx,f.ty,k.tint,f.size,18);
    shake=Math.max(shake,180);
    ZL.snd('wipe/splat.wav',1);
  }
  function confetti(){
    var cols=['255,82,110','255,196,0','64,156,255','255,140,40','186,104,255','255,255,255'];
    for(var i=0;i<120;i++){
      paper.push({ x:Math.random()*api.W, y:-Math.random()*api.H*0.5, vx:(Math.random()-0.5)*api.W*0.12, vy:api.H*(0.18+Math.random()*0.3),
        w:short()*(0.008+Math.random()*0.012), h:short()*(0.014+Math.random()*0.02), a:Math.random()*6.28, va:(Math.random()-0.5)*10,
        c:cols[i%cols.length], t:0, max:2600+Math.random()*1200 });
    }
  }

  // —— 画 ——
  function drawRope(ctx,y,x0,x1,th){
    ctx.save();
    ctx.lineCap='round';
    ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=th;
    ctx.beginPath(); ctx.moveTo(x0,y+th*0.55); ctx.lineTo(x1,y+th*0.55); ctx.stroke();
    var g=ctx.createLinearGradient(0,y-th/2,0,y+th/2);
    g.addColorStop(0,'#f0d39c'); g.addColorStop(0.5,'#cf9d58'); g.addColorStop(1,'#8d6130');
    ctx.strokeStyle=g; ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
    // 麻绳的螺旋股
    ctx.beginPath(); ctx.rect(x0,y-th/2,x1-x0,th); ctx.clip();
    ctx.strokeStyle='rgba(98,62,24,0.5)'; ctx.lineWidth=Math.max(1.5,th*0.16);
    var st=th*0.78, off=((jerk%st)+st)%st;
    for(var x=x0-th+off;x<x1+th;x+=st){ ctx.beginPath(); ctx.moveTo(x,y-th/2); ctx.lineTo(x+th*0.55,y+th/2); ctx.stroke(); }
    ctx.strokeStyle='rgba(255,240,205,0.35)'; ctx.lineWidth=Math.max(1,th*0.08);
    for(var x2=x0-th+off+st*0.4;x2<x1+th;x2+=st){ ctx.beginPath(); ctx.moveTo(x2,y-th/2); ctx.lineTo(x2+th*0.4,y+th*0.2); ctx.stroke(); }
    ctx.restore();
  }
  function drawPost(ctx,x,y,th,color,label){
    ctx.save();
    var h=th*7;
    ZL.roundRect(ctx,x-th*0.28,y-h/2,th*0.56,h,th*0.28);
    ctx.fillStyle='rgba('+color+',0.95)'; ctx.fill();
    ctx.lineWidth=Math.max(1.5,th*0.12); ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.stroke();
    ctx.font=F('700',th*0.95); ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,th*0.22); ctx.strokeStyle='rgba(0,0,0,0.6)';
    ctx.strokeText(label,x,y+h/2+th*0.3); ctx.fillStyle='#fff'; ctx.fillText(label,x,y+h/2+th*0.3);
    ctx.restore();
  }
  function drawKnot(ctx,x,y,th){
    ctx.save();
    ctx.translate(x,y);
    // 两条红绸带（跟着拉扯晃）
    for(var s=-1;s<=1;s+=2){
      ctx.save(); ctx.rotate(swing*0.6+s*0.28);
      var g=ctx.createLinearGradient(0,0,0,th*4.2); g.addColorStop(0,'#ff3b4d'); g.addColorStop(1,'#b3121f');
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.moveTo(-th*0.35,0); ctx.quadraticCurveTo(s*th*0.9,th*2.2,s*th*0.5,th*4.2); ctx.lineTo(s*th*0.05,th*3.6); ctx.lineTo(-s*th*0.2,th*4.1); ctx.quadraticCurveTo(-s*th*0.1,th*2,th*0.35,0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    var r=th*0.95, g2=ctx.createRadialGradient(-r*0.35,-r*0.35,r*0.1,0,0,r);
    g2.addColorStop(0,'#ff7a86'); g2.addColorStop(1,'#c3121f');
    ctx.fillStyle=g2; ctx.beginPath(); ctx.arc(0,0,r,0,6.2832); ctx.fill();
    ctx.lineWidth=Math.max(1.5,th*0.14); ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.stroke();
    ctx.restore();
  }
  function avatar(ctx,x,y,r,img,name,ring){
    ctx.save();
    ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.closePath(); ctx.save(); ctx.clip();
    if(ZL.imgOk(img)){ var s=Math.max(r*2/img.naturalWidth,r*2/img.naturalHeight); ctx.drawImage(img,x-img.naturalWidth*s/2,y-img.naturalHeight*s/2,img.naturalWidth*s,img.naturalHeight*s); }
    else { ctx.fillStyle='#4a3d55'; ctx.fillRect(x-r,y-r,r*2,r*2); ctx.fillStyle='#fff'; ctx.font=F('700',r); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(name||'观').charAt(0),x,y+r*0.05); }
    ctx.restore();
    ctx.lineWidth=Math.max(2,r*0.14); ctx.strokeStyle=ring; ctx.stroke();
    ctx.restore();
  }
  function pill(ctx,x,y,text,fs,bg,align){
    ctx.save();
    ctx.font=F('700',fs);
    var w=ctx.measureText(text).width+fs*1.3, h=fs*1.75;
    var x0=align==='right'?x-w:(align==='center'?x-w/2:x);
    ZL.roundRect(ctx,x0,y-h/2,w,h,h/2);
    ctx.fillStyle=bg; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.stroke();
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#fff';
    ctx.fillText(text,x0+w/2,y+fs*0.04);
    ctx.restore();
    return w;
  }
  function drawTeams(ctx,y,th){
    var fs=Math.max(13,short()*0.03);
    var ty=y-th*6.2;
    var w=pill(ctx,api.W*0.04,ty,'观众队  '+R.vp+' 下',fs,'rgba(214,52,78,0.92)','left');
    var showNames=api.cfg.showNames!==false&&String(api.cfg.showNames)!=='false';
    if(showNames){
      for(var i=0;i<team.length;i++){
        var r=fs*1.05, ax=api.W*0.04+w+fs*0.6+r+i*r*1.55;
        avatar(ctx,ax,ty,r,team[i].img,team[i].name,'rgba(255,214,222,0.95)');
      }
    }
    pill(ctx,api.W*0.96,ty,'主播  '+R.sp+' 下',fs,'rgba(38,120,220,0.92)','right');
    if(playing()){
      var hint=spaceOn()?'主播：狂点画面 / 按空格 往回拽！':'主播：狂点画面往回拽！';
      var k=1+0.05*Math.sin(nowMs*0.012), hy=y+th*4.6;
      ctx.save(); ctx.translate(api.W/2,hy); ctx.scale(k,k);
      ctx.font=F('800',fs*0.92); ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.lineJoin='round'; ctx.lineWidth=Math.max(3,fs*0.2); ctx.strokeStyle='rgba(0,0,0,0.72)';
      ctx.strokeText(hint,0,0); ctx.fillStyle='#ffffff'; ctx.fillText(hint,0,0);
      ctx.restore();
    }
  }
  function drawTimer(ctx,y,th){
    var left=Math.max(0,R.dur-R.t), sec=Math.ceil(left/1000);
    var txt=Math.floor(sec/60)+':'+(sec%60<10?'0':'')+(sec%60);
    var fs=Math.max(18,short()*0.06), urgent=left<=5000&&playing();
    var cx=api.W/2, ty=y-th*6.2;
    ctx.save();
    if(urgent){ var k=1+0.08*Math.max(0,Math.sin(nowMs*0.02)); ctx.translate(cx,ty); ctx.scale(k,k); ctx.translate(-cx,-ty); }
    ctx.font='800 '+Math.round(fs)+'px "Bahnschrift","Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineJoin='round'; ctx.lineWidth=Math.max(3,fs*0.14); ctx.strokeStyle='rgba(0,0,0,0.65)';
    ctx.strokeText(txt,cx,ty); ctx.fillStyle=urgent?'#ff5a5a':'#ffffff'; ctx.fillText(txt,cx,ty);
    ctx.restore();
    var bw=api.W*0.18, bh=Math.max(4,th*0.35), by=ty+fs*0.62;
    ctx.save();
    ZL.roundRect(ctx,cx-bw/2,by,bw,bh,bh/2); ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fill();
    ZL.roundRect(ctx,cx-bw/2,by,bw*Math.max(0,left/R.dur),bh,bh/2); ctx.fillStyle=urgent?'#ff5a5a':'#ffd34d'; ctx.fill();
    ctx.restore();
  }
  function drawResult(ctx){
    var a=Math.min(1,R.rt/180), s=ZL.easeOutBack(Math.min(1,R.rt/380));
    var title,sub,col;
    var timeUp=R.t>=R.dur;
    if(R.result==='viewers'){ title=timeUp?'时间到，观众赢！':'观众赢了！'; sub='主播准备挨砸——'; col='#ff6b81'; }
    else if(R.result==='streamer'){ title=timeUp?'时间到，主播赢！':'主播赢了！'; sub='绳子被主播拽回来啦'; col='#5cc8ff'; }
    else { title='平局！'; sub='谁也没拉过谁'; col='#ffd34d'; }
    var fs=Math.max(26,short()*0.1), cx=api.W/2, cy=api.H*0.4;
    ctx.save();
    ctx.globalAlpha*=a*(R.fade>0?Math.max(0,1-R.fade):1);
    ctx.translate(cx,cy); ctx.scale(Math.max(0.01,s),Math.max(0.01,s));
    ctx.font='900 '+Math.round(fs)+'px "Microsoft YaHei",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineJoin='round'; ctx.lineWidth=Math.max(4,fs*0.16); ctx.strokeStyle='rgba(0,0,0,0.72)';
    ctx.strokeText(title,0,0); ctx.fillStyle=col; ctx.fillText(title,0,0);
    ctx.font=F('700',fs*0.36); ctx.lineWidth=Math.max(3,fs*0.07);
    ctx.strokeText(sub,0,fs*0.78); ctx.fillStyle='#fff'; ctx.fillText(sub,0,fs*0.78);
    ctx.restore();
  }
  function statsShown(){ var m=String(api.cfg.statsPanel||'active'); if(m==='off') return false; if(m==='always') return true; return !!R||L.count()>0; }
  function drawStats(ctx){
    if(!statsShown()){ if(api.hud) api.hud(0); return; }
    var lines=[];
    if(R) lines.push(playing()?'拔河中：观众 '+R.vp+' 下 · 主播 '+R.sp+' 下':'这局：'+(R.result==='viewers'?'观众赢':R.result==='streamer'?'主播赢':'平局'));
    lines.push('战绩：主播 '+wins.streamer+' 胜 · 观众 '+wins.viewers+' 胜');
    var n=L.count()+flying.length;
    if(n>0) lines.push('还要擦 '+n+' 块，按住鼠标来回擦');
    var fs=Math.max(13,Math.min(20,api.W*0.016));
    ctx.save();
    ctx.font=F('600',fs);
    var w=0,i;
    for(i=0;i<lines.length;i++) w=Math.max(w,ctx.measureText(lines[i]).width);
    var padX=fs*0.9,padY=fs*0.55,lh=fs*1.5,ph=lines.length*lh+padY*2-lh*0.5;
    var top=api.hud?api.hud(ph):10;
    ZL.roundRect(ctx,10,top,w+padX*2,ph,12);
    ctx.fillStyle='rgba(20,22,28,0.66)'; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='middle';
    for(i=0;i<lines.length;i++){
      var ly=top+padY+i*lh+lh*0.32;
      ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.14); ctx.strokeStyle='rgba(0,0,0,0.6)';
      ctx.strokeText(lines[i],10+padX,ly); ctx.fillStyle='#fff'; ctx.fillText(lines[i],10+padX,ly);
    }
    ctx.restore();
  }
  function hookKeys(){
    if(keysHooked) return; keysHooked=true;
    window.addEventListener('keydown',function(e){
      if(e.code!=='Space'||e.repeat||!api||!spaceOn()||!playing()) return;
      pullStreamer(1); ZL.kick();
    });
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      L=ZL.splatLayer(a,{ brush:function(){ return api.cfg.brushSize; }, clean:function(){ return api.cfg.cleanPercent; },
        sound:function(n){ ZL.snd('wipe/'+n+'.wav',n==='squeak'?0.35:0.8); } });
      for(var k in KINDS){ ZL.img(KINDS[k].fly); for(var j=0;j<KINDS[k].splat.length;j++) ZL.img(KINDS[k].splat[j]); }
      hookKeys();
    },
    resize:function(){ L.resize(); },
    config:function(){ if(R&&!R.result) R.dur=roundMs(); },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      var name=ZL.who(cmd);
      if(op==='clear'){
        R=null; team=[]; fx=[]; paper=[]; flying=[]; L.clear();
        if(cmd&&cmd.wipe){ jerk=0; jerkV=0; swing=0; swingV=0; shake=0; }
        return;
      }
      var n=Math.min(ZL.count(cmd,1),api.cap());
      if(op==='reduce'){
        if(!playing()) return;
        pullStreamer(n);
        api.banner(name?name+' 帮主播拉了 '+n+' 下':'帮主播拉了 '+n+' 下');
        return;
      }
      if(R&&R.result){ R.next+=n; R.nextCmd=cmd; return; }   // 上一局还在出结果：攒着，下一局一开就拉
      if(!R){ startRound(); api.banner(name?name+' 发起拔河！主播快往回拽':'礼物拔河开始！主播快往回拽'); }
      else if(name) api.banner(name+' 拉了 '+n+' 下');
      pullViewers(n,cmd);
    },
    pointer:function(type,x,y){
      if(type==='down'){
        if(playing()){ pullStreamer(1); L.press(x,y); return true; }
        return L.pointer('down',x,y);
      }
      L.pointer(type,x,y);
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      var active=L.tick(step);
      // 绳子：绳结缓到目标位置，被拉一下整根抖一下、绸带晃一下
      // 弹簧按 16ms 小步积分：卡一下（一帧几百毫秒）也不会越抖越大；卡太久直接归位
      if(step>1000){ jerk=0; jerkV=0; swing=0; swingV=0; }
      else for(var rem=step;rem>0;rem-=16){
        var f=Math.min(16,rem)/16;
        jerkV+=(-jerk*0.03-jerkV*0.18)*f; jerk+=jerkV*f;
        swingV+=(-swing*0.025-swingV*0.08)*f; swing+=swingV*f;
      }
      if(swing>0.45){ swing=0.45; swingV=Math.min(0,swingV); } else if(swing<-0.45){ swing=-0.45; swingV=Math.max(0,swingV); }
      if(shake>0) shake=Math.max(0,shake-step);
      if(Math.abs(jerk)>0.2||Math.abs(jerkV)>0.05||Math.abs(swing)>0.004||Math.abs(swingV)>0.002||shake>0) active=true;
      if(R){
        active=true;
        R.shown+=(R.p-R.shown)*Math.min(1,step/90);
        if(!R.result){
          R.t+=step;
          if(R.t>=R.dur){ R.t=R.dur; finish(R.p<-0.02?'viewers':R.p>0.02?'streamer':'draw'); }
        }else{
          R.rt+=step;
          if(R.rt>2600){
            R.fade=Math.min(1,R.fade+step/600);
            if(R.fade>=1){
              var next=R.next, who=R.nextCmd||null; R=null;
              if(next>0){ startRound(); pullViewers(next,who); }
            }
          }
        }
      }
      for(var i=flying.length-1;i>=0;i--){
        var f=flying[i];
        f.t+=step; active=true;
        if(f.t>0&&!f.whoosh){ f.whoosh=true; ZL.snd('wipe/whoosh.wav',0.7); }
        if(f.t>=f.dur){ flying.splice(i,1); land(f); }
      }
      for(var j=fx.length-1;j>=0;j--){ fx[j].t+=step; if(fx[j].t>=fx[j].max) fx.splice(j,1); else active=true; }
      for(var q=paper.length-1;q>=0;q--){
        var p=paper[q]; p.t+=step;
        if(p.t>=p.max){ paper.splice(q,1); continue; }
        var s=step/1000; p.x+=p.vx*s+Math.sin((p.t+q*90)*0.004)*api.W*0.0008*step; p.y+=p.vy*s; p.a+=p.va*s; active=true;
      }
      return active;
    },
    draw:function(ctx){
      var sx=shake>0?(Math.random()-0.5)*short()*0.012*shake/180:0, sy=shake>0?(Math.random()-0.5)*short()*0.012*shake/180:0;
      ctx.save(); ctx.translate(sx,sy);
      L.draw(ctx);
      ctx.restore();
      if(R){
        var y=ropeY(), th=thick(), cx=api.W/2, sp=span();
        var alpha=R.fade>0?Math.max(0,1-R.fade):1;
        ctx.save(); ctx.globalAlpha*=alpha;
        ctx.save(); ctx.setLineDash([th*0.6,th*0.45]); ctx.lineWidth=Math.max(2,th*0.16); ctx.strokeStyle='rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.moveTo(cx,y-th*3); ctx.lineTo(cx,y+th*3); ctx.stroke(); ctx.restore();
        drawPost(ctx,cx-sp,y,th,'226,58,86','观众赢');
        drawPost(ctx,cx+sp,y,th,'48,132,232','主播赢');
        drawRope(ctx,y,api.W*0.04+jerk,api.W*0.96+jerk,th);
        drawKnot(ctx,cx+R.shown*sp+jerk,y,th);
        drawTeams(ctx,y,th);
        drawTimer(ctx,y,th);
        ctx.restore();
        if(R.result) drawResult(ctx);
      }
      for(var i=0;i<flying.length;i++){
        var f=flying[i];
        if(f.t<0||!ZL.imgOk(f.img)) continue;
        var e=Math.min(1,f.t/f.dur), ee=1-Math.pow(1-e,2);
        var x=f.sx+(f.tx-f.sx)*ee, y2=f.sy+(f.ty-f.sy)*ee-Math.sin(Math.PI*e)*api.H*0.12;
        var s=f.size*(0.35+0.55*ee);
        ctx.save(); ctx.translate(x,y2); ctx.rotate(f.rot+f.spin*e);
        ctx.drawImage(f.img,-s/2,-s/2,s,s);
        ctx.restore();
      }
      for(var j=0;j<fx.length;j++){
        var t=fx[j], a=1-t.t/t.max;
        ctx.save(); ctx.globalAlpha*=Math.max(0,a);
        ctx.font='900 '+Math.round(t.size)+'px "Bahnschrift","Microsoft YaHei",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.lineJoin='round'; ctx.lineWidth=Math.max(3,t.size*0.14); ctx.strokeStyle='rgba(0,0,0,0.6)';
        var yy=t.y-t.t*0.05, pop=1+0.25*Math.max(0,1-t.t/120);
        ctx.translate(t.x,yy); ctx.scale(pop,pop); ctx.translate(-t.x,-yy);
        ctx.strokeText(t.text,t.x,yy); ctx.fillStyle='rgba('+t.color+',1)'; ctx.fillText(t.text,t.x,yy);
        ctx.restore();
      }
      for(var q=0;q<paper.length;q++){
        var p=paper[q], pa=Math.min(1,(p.max-p.t)/400);
        ctx.save(); ctx.globalAlpha*=Math.max(0,pa); ctx.translate(p.x,p.y); ctx.rotate(p.a); ctx.scale(1,Math.abs(Math.cos(p.a*1.7))*0.8+0.2);
        ctx.fillStyle='rgba('+p.c+',0.95)'; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
        ctx.restore();
      }
      drawStats(api.hudCtx||ctx);
    },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      return { round:R?{ p:Math.round(R.p*1000)/1000, t:Math.round(R.t), dur:R.dur, result:R.result, vp:R.vp, sp:R.sp, next:R.next }:null,
        flying:flying.length, splats:L.count(), hits:L.debug(), wins:{ viewers:wins.viewers, streamer:wins.streamer }, team:team.length, paper:paper.length };
    }
  };
})());
`
