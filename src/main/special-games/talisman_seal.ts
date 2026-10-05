// 特色玩法「符咒封印」的页面内 Canvas 代码。
// 24 张符纸（6×4 确定性布局，42% 红符）easeOutBack 飞入封满屏幕；对麦克风大喊，
// 每喊一声（音量过阈值、回落 55% 武装、冷却 220ms）减耐久 + 抖动 + 全卡摇摆 +「破」字闪现；
// 归零后符纸四散飞落。操作：add 加点 / reduce 等于替主播喊了 N 声 / multiply、divide 只在封印中生效 / clear 直接破解。
// 素材：talisman_break/ 下的 ivory/rose 符纸 + counter_frame + break_callout + 三个音效。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','reduce','multiply','divide','clear'];
  var MAXN=999999999;      // 防爆夹紧：封印点数上限
  var ivoryImg=null, roseImg=null, counterImg=null, calloutImg=null;
  var cards=[];            // {cx,cy,scale,rot,delay,rose,scatter,wobPhase,wobSpeed,wobAmt}
  var phase='idle';        // idle / locking / sustain / breaking
  var phaseT=0;
  var remaining=0, maximum=0;
  var shakeUntil=0, wobbleUntil=0, flashUntil=0;
  var nowMs=0;
  var mic=null, micToken=0, micPending=false, micDevice='';
  var micState='', micKind='';   // 麦克风提示文字；kind：error / preview
  var armed=true, lastTrigger=0;

  var LOCK_MS=720, BREAK_MS=1050;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function threshold(){ return Math.max(1,Math.min(500,num(api.cfg.threshold,240))); }
  function decrement(){ return Math.max(1,Math.trunc(num(api.cfg.decrementPerShout,1))); }
  function cooldown(){ return Math.max(50,Math.min(5000,num(api.cfg.cooldownMs,220))); }
  function sealed(){ return phase==='locking'||phase==='sustain'; }

  // 确定性随机（种子=7319+W*3+H：同尺寸窗口布局相同）
  function seededRand(seed){
    var s=seed>>>0;
    return function(){
      s=(s+0x6D2B79F5)>>>0;
      var t=Math.imul(s^(s>>>15), 1|s);
      t=(t+Math.imul(t^(t>>>7), 61|t))^t;
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }

  function rebuildCards(){
    cards=[];
    var W=api.W,H=api.H;
    var rnd=seededRand(7319+W*3+H);
    var i,r,c;
    for(r=0;r<4;r++) for(c=0;c<6;c++){
      cards.push({
        cx:(c+0.5+(rnd()*2-1)*0.24)/6*W,
        cy:(r+0.5+(rnd()*2-1)*0.18)/4*H,
        scale:0.88+rnd()*0.30,
        rot:(rnd()*2-1)*19,
        delay:rnd()*0.32,
        rose:rnd()<0.42,
        scatter:(rnd()<0.5?-1:1)*(0.35+rnd()*0.6),
        wobPhase:rnd()*18, wobSpeed:17+rnd()*14, wobAmt:0.65+rnd()*0.7
      });
    }
    // 洗牌决定叠放顺序
    for(i=cards.length-1;i>0;i--){ var j=Math.floor(rnd()*(i+1)); var t=cards[i]; cards[i]=cards[j]; cards[j]=t; }
  }

  // —— 声控（喊叫：电平过阈值 + 回落 55% 再武装 + 冷却）——
  // 麦克风按设备名挑（ZL.getMic）；详情页预览里不开麦克风，只提示一行字。
  function setMicState(text,kind){ micState=text; micKind=kind||''; ZL.kick(); }
  function startMic(){
    if(mic||micPending) return;
    var token=++micToken;
    micPending=true;
    micDevice=String(api.cfg.micDevice||'');
    ZL.getMic(micDevice).then(function(stream){
      micPending=false;
      if(token!==micToken){ try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} return; }
      try{
        var AC=window.AudioContext||window.webkitAudioContext;
        var ac=new AC();
        var src=ac.createMediaStreamSource(stream);
        var an=ac.createAnalyser(); an.fftSize=1024; an.smoothingTimeConstant=0;
        src.connect(an);
        var buf=new Float32Array(an.fftSize);
        var stopped=false;
        var timer=setInterval(function(){
          if(stopped) return;
          an.getFloatTimeDomainData(buf);
          var peak=0;
          for(var i=0;i<buf.length;i++){ var a=buf[i]<0?-buf[i]:buf[i]; if(a>peak)peak=a; }
          var level=Math.min(255,Math.round(peak*255));
          var now=performance.now();
          var th=threshold();
          var release=Math.max(5, th*0.55);
          if(!armed && level<=release) armed=true;
          if(armed && level>=th && now-lastTrigger>=cooldown()){
            armed=false; lastTrigger=now;
            onShout();
          }
        },45);
        mic={ stop:function(){ stopped=true; clearInterval(timer); try{ac.close();}catch(e){} try{stream.getTracks().forEach(function(t){t.stop();});}catch(e){} } };
        setMicState('','');
      }catch(e){ setMicState('麦克风不可用','error'); }
    }).catch(function(e){
      micPending=false;
      if(token!==micToken) return;
      if(e&&e.message==='preview') setMicState('预览不收音','preview');
      else setMicState('麦克风不可用','error');
    });
  }
  function stopMic(){ micToken++; micPending=false; if(mic){ mic.stop(); mic=null; } }

  // 一次破封反馈（喊一声 / reduce / divide 共用）：扣点 + 「破」字 + 抖动 + 全卡摇摆 + 破声，归零进飞散
  function registerBreak(amount){
    if(!sealed()||remaining<=0) return;
    remaining=Math.max(0,remaining-amount);
    flashUntil=nowMs+460;
    shakeUntil=nowMs+200;
    wobbleUntil=nowMs+720;
    ZL.snd('talisman_break/talisman_break.mp3');
    if(remaining<=0) beginBreaking();
  }

  function onShout(){
    registerBreak(decrement());
    ZL.kick();
  }

  function beginBreaking(){
    phase='breaking'; phaseT=0;
    remaining=0;
    stopMic();
    flashUntil=nowMs+480;
    ZL.snd('talisman_break/talisman_clear.mp3');
  }

  function cardSize(card){
    var H=api.H;
    var th=Math.max(170,H*0.37)*card.scale;
    var img=card.rose?roseImg:ivoryImg;
    var ar=ZL.imgOk(img)? img.naturalHeight/img.naturalWidth : 1.66;
    return [th/ar, th];
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      ivoryImg=ZL.img('talisman_break/talisman_ivory.png');
      roseImg=ZL.img('talisman_break/talisman_rose.png');
      counterImg=ZL.img('talisman_break/counter_frame.png');
      calloutImg=ZL.img('talisman_break/break_callout.png');
    },
    resize:function(){ if(sealed()) rebuildCards(); },
    config:function(){
      // 换了麦克风：封印中就按新设备重开监听
      if(String(api.cfg.micDevice||'')!==micDevice && (mic||micPending)){ stopMic(); if(sealed()) startMic(); }
    },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      var name=ZL.who(cmd);
      if(op==='clear'){
        if(sealed()){ beginBreaking(); api.banner(name?name+' 帮主播破解了封印':'封印直接破解'); }
        return;
      }
      var n=ZL.count(cmd,3);
      if(op==='add'){
        n=Math.min(n,api.cap());
        remaining=Math.min(MAXN, remaining+n);
        maximum=Math.max(maximum,remaining);
        if(!sealed()){ phase='locking'; phaseT=0; rebuildCards(); }
        else shakeUntil=nowMs+200;
        startMic();
        ZL.snd('talisman_break/talisman_appear.mp3');
        api.banner(name?name+' 给主播贴上 '+n+' 点封印':'符咒封印 +'+n+' 点');
        return;
      }
      // 减少 / 乘除：只在封印中生效
      if(!sealed()||remaining<=0) return;
      if(op==='reduce'){
        api.banner(name?name+' 帮主播破了 '+n+' 点封印':'封印 −'+n+' 点');
        registerBreak(n);
      }else if(op==='multiply'){
        remaining=Math.min(MAXN, remaining*n);
        maximum=Math.max(maximum,remaining);
        shakeUntil=nowMs+200;
        ZL.snd('talisman_break/talisman_appear.mp3');
        api.banner(name?name+' 让封印 ×'+n:'封印 ×'+n);
      }else if(op==='divide'){
        var next=Math.floor(remaining/n);
        api.banner(name?name+' 让封印 ÷'+n:'封印 ÷'+n);
        if(next<remaining) registerBreak(remaining-next);
        else shakeUntil=nowMs+200;
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      if(phase==='locking'){ phaseT+=step; if(phaseT>=LOCK_MS){ phase='sustain'; phaseT=0; } return true; }
      if(phase==='breaking'){
        phaseT+=step;
        if(phaseT>=BREAK_MS){ phase='idle'; phaseT=0; remaining=0; maximum=0; cards=[]; return false; }
        return true;
      }
      // 常态：只有抖动/摇摆/破字期间刷帧，其余时间停 rAF（喊叫回调会叫醒）
      if(phase==='sustain') return nowMs<shakeUntil||nowMs<wobbleUntil||nowMs<flashUntil;
      return false;
    },
    draw:function(ctx){
      if(phase==='idle') return;
      var W=api.W,H=api.H;
      var now=nowMs;
      var shakeX=0,shakeY=0;
      if(now<shakeUntil){
        var m=Math.max(2,W*0.004);
        shakeX=(Math.random()*2-1)*m; shakeY=(Math.random()*2-1)*m;
      }
      ctx.save();
      ctx.translate(shakeX,shakeY);
      var i,card;
      for(i=0;i<cards.length;i++){
        card=cards[i];
        var img=card.rose?roseImg:ivoryImg;
        var sz=cardSize(card);
        var x=card.cx, y=card.cy, rot=card.rot*Math.PI/180, alpha=0.96;
        if(phase==='locking'){
          var raw=(phaseT/LOCK_MS-card.delay)/Math.max(0.1,1-card.delay);
          if(raw<=0) continue;
          if(raw>1)raw=1;
          var p=ZL.easeOutBack(raw);
          var fromTop=card.cy<H/2;
          var startY=fromTop? -sz[1] : H+sz[1];
          y=startY+(card.cy-startY)*p;
          rot+=(1-raw)*28*Math.PI/180*card.scatter;
          alpha=Math.min(0.96, raw*1.9);
        } else if(phase==='breaking'){
          var bp=Math.min(1, Math.max(0,(phaseT/BREAK_MS-card.delay*0.34)/0.78));
          x=card.cx+W*card.scatter*bp*0.78;
          y=card.cy+H*(0.12*bp+0.82*bp*bp);
          rot+=card.scatter*145*Math.PI/180*bp;
          alpha=(1-bp)*0.96;
        } else if(now<wobbleUntil){
          // 命中摇摆 0.72s：包络 (1-p)^0.34，复合正弦
          var wp=1-(wobbleUntil-now)/720;
          var env=Math.pow(1-wp,0.34)*card.wobAmt;
          var t=now/1000*card.wobSpeed+card.wobPhase;
          var wave=Math.sin(t)+0.43*Math.sin(t*1.73+card.wobPhase*2.19);
          x+=W*0.012*env*wave;
          y+=H*0.0025*env*Math.sin(t*1.31+card.wobPhase);
          rot+=3.8*Math.PI/180*env*Math.sin(t*0.83+card.wobPhase*1.41);
        }
        ctx.save();
        ctx.globalAlpha*=Math.max(0,alpha);
        ctx.translate(x,y); ctx.rotate(rot);
        if(ZL.imgOk(img)) ctx.drawImage(img,-sz[0]/2,-sz[1]/2,sz[0],sz[1]);
        else { ctx.fillStyle=card.rose?'#b03040':'#e8dcc0'; ZL.roundRect(ctx,-sz[0]/2,-sz[1]/2,sz[0],sz[1],6); ctx.fill(); }
        ctx.restore();
      }
      // 计数器（顶部居中，breaking 前 32% 淡出）
      if(remaining>0||phase==='breaking'){
        var ca=1;
        if(phase==='breaking') ca=Math.max(0,1-phaseT/(BREAK_MS*0.32));
        if(ca>0){
          var cw=Math.max(160,Math.min(300,W*0.2));
          var ch=ZL.imgOk(counterImg)? cw*counterImg.naturalHeight/counterImg.naturalWidth : cw/1.5;
          var cx=W/2, cy=H*0.02+ch/2;
          var label=String(remaining);
          ctx.save();
          ctx.globalAlpha*=ca;
          if(ZL.imgOk(counterImg)) ctx.drawImage(counterImg,cx-cw/2,cy-ch/2,cw,ch);
          else { ZL.roundRect(ctx,cx-cw/2,cy-ch/2,cw,ch,ch/3); ctx.fillStyle='rgba(20,22,28,0.78)'; ctx.fill(); }
          var fs=Math.max(20,ch*0.42);
          ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
          while(ctx.measureText(label).width>cw*0.7 && fs>12){ fs-=1; ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif'; }
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.14); ctx.strokeStyle='rgba(0,0,0,0.65)';
          ctx.strokeText(label,cx,cy);
          ctx.fillStyle='#ffd34d';
          ctx.fillText(label,cx,cy);
          ctx.restore();
        }
      }
      // 「破」字闪现 0.46s：中心 (58%W, 48%H)，弹入
      if(now<flashUntil){
        var fp=1-(flashUntil-now)/460;
        var fa=fp<0.55?1:1-(fp-0.55)/0.45;
        var fs2=0.72+ZL.easeOutBack(Math.min(1,fp*2.5))*0.28;
        var cw2=Math.min(W*0.32,520)*fs2;
        ctx.save();
        ctx.globalAlpha*=Math.max(0,fa);
        if(ZL.imgOk(calloutImg)){
          var ch2=cw2*calloutImg.naturalHeight/calloutImg.naturalWidth;
          ctx.drawImage(calloutImg, W*0.58-cw2/2, H*0.48-ch2/2, cw2, ch2);
        }else{
          var bf=cw2*0.42;
          ctx.font='700 '+bf+'px "Microsoft YaHei",serif';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.lineJoin='round'; ctx.lineWidth=Math.max(3,bf*0.1); ctx.strokeStyle='rgba(120,10,10,0.9)';
          ctx.strokeText('破', W*0.58, H*0.48);
          ctx.fillStyle='#e8342e'; ctx.fillText('破', W*0.58, H*0.48);
        }
        ctx.restore();
      }
      if(micState&&phase!=='breaking'){
        ctx.save();
        var mfs=Math.max(14,W*0.014);
        ctx.font='600 '+mfs+'px "Microsoft YaHei",sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,mfs*0.16); ctx.strokeStyle='rgba(0,0,0,0.55)';
        ctx.strokeText(micState, W/2, H*0.94);
        ctx.fillStyle=micKind==='preview'?'rgba(255,255,255,0.88)':'rgba(255,120,120,0.95)';
        ctx.fillText(micState, W/2, H*0.94);
        ctx.restore();
      }
      ctx.restore();
    },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){ return { phase:phase, remaining:remaining, maximum:maximum, micState:micState, micKind:micKind }; }
  };
})());
`
