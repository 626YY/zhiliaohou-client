// 特色玩法「声控拍蚊子」的页面内 Canvas 代码。
// 蚊子满屏随机乱飞 + 蚊鸣循环；拍手（麦克风掌声识别，按响度分三档消灭）或鼠标点击消灭；
// 死亡后旋转坠落淡出；全灭后停帧停声音。超过同屏上限的蚊子排队，场上少了自动补上。
// 操作：add / reduce（先扣排队，再随机消灭场上的）/ clear。
// 素材：mosquito/mosquito_pose_1~5.png + mosquito.mp3。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS, MIC_CLAP_JS } from './shared'

export const code = SHARED_JS + MIC_CLAP_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','reduce','clear'];
  var poses=[];
  var bugs=[];             // {x,y,heading,target,nextTurn,speed,sizeF,phase,frameOff,deadAt}
  var pending=0;           // 超出同屏上限排队的蚊子
  var nowMs=0;
  var clap=null, clapKey='';
  var micState='', micKind='';   // 麦克风提示文字；kind：error / preview
  var lastClapAt=0;
  var buzz=[];             // 蚊鸣声道
  var buzzCheckAt=0;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function threshold(){ return Math.max(1,Math.min(500,num(api.cfg.threshold,180))); }
  function killPerClap(){ return Math.max(1,Math.trunc(num(api.cfg.killPerClap,1))); }
  function scaled(){ return api.cfg.volumeScaledKill!==false; }
  function sensitivity(){ return Math.max(1,Math.min(100,num(api.cfg.clapSensitivity,70))); }
  function cooldown(){ return Math.max(50,Math.min(10000000,num(api.cfg.cooldownMs,260))); }
  // 识别方式：clap = 识别拍手（掌声识别）；volume = 只看音量（任何声音够响就算）
  function triggerMode(){ return String(api.cfg.triggerMode||'clap')==='volume'?'volume':'clap'; }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,1000))); }
  function soundLoop(){ return api.cfg.soundLoop!==false; }
  function level(key,d){ return Math.max(1,Math.min(500,num(api.cfg[key],d))); }
  function kills(key,d){ return Math.max(1,Math.trunc(num(api.cfg[key],d))); }

  function makeBug(){
    return {
      x:0.08+Math.random()*0.84, y:0.08+Math.random()*0.84,
      heading:Math.random()*6.2832, target:Math.random()*6.2832,
      nextTurn:Math.random()*0.9, speed:0.018+Math.random()*0.03,
      sizeF:0.85+Math.random()*0.5, phase:Math.random()*6.2832,
      frameOff:Math.floor(Math.random()*5), deadAt:0
    };
  }

  function aliveCount(){ var n=0; for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt) n++; return n; }

  // 按响度分档：阈值档=每次拍手消灭，往上三档（音量/只数都可调），取够得着的最高一档（不少于每次拍手消灭）
  function killsFor(lv){
    var base=killPerClap();
    if(!scaled()) return base;
    var tiers=[[threshold(),base],[level('clapLevel2',200),kills('clapKill2',2)],[level('clapLevel3',220),kills('clapKill3',4)],[level('maxKillLevel',240),kills('loudClapMaxKill',8)]];
    tiers.sort(function(a,b){ return a[0]-b[0]; });
    var k=base;
    for(var i=0;i<tiers.length;i++) if(lv>=tiers[i][0]) k=tiers[i][1];
    return Math.max(base,k);
  }

  function killRandom(n){
    var alive=[];
    for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt) alive.push(bugs[i]);
    for(var j=0;j<n&&alive.length>0;j++){
      var idx=Math.floor(Math.random()*alive.length);
      alive[idx].deadAt=nowMs;
      alive.splice(idx,1);
    }
  }

  // 把排队的蚊子补进场（同屏上限内）
  function refill(){
    if(pending<=0) return;
    var room=Math.max(0, maxVisible()-aliveCount());
    var k=Math.min(pending,room);
    for(var i=0;i<k;i++) bugs.push(makeBug());
    pending-=k;
  }

  function micKeyNow(){ return [String(api.cfg.micDevice||''),threshold(),sensitivity(),cooldown(),triggerMode()].join('|'); }
  function startMicIfNeeded(){
    if(clap||bugs.length===0) return;
    clapKey=micKeyNow();
    clap=ZL.startClap({
      sensitivity:sensitivity(), threshold:threshold(), cooldownMs:cooldown(), triggerMode:triggerMode(), deviceLabel:String(api.cfg.micDevice||''),
      onClap:function(lv){
        var now=nowMs;
        if(now-lastClapAt<cooldown()) return;
        lastClapAt=now;
        killRandom(killsFor(lv));
        ZL.kick();
      },
      onState:function(st){
        if(st==='no-mic'){ micState='麦克风不可用，点击灭蚊'; micKind='error'; }
        else if(st==='preview'){ micState='预览不收音，点击灭蚊'; micKind='preview'; }
        else { micState=''; micKind=''; }
        ZL.kick();
      }
    });
  }
  function stopMic(){ if(clap){ clap.stop(); clap=null; } }

  function syncBuzz(){
    if(nowMs<buzzCheckAt) return;
    buzzCheckAt=nowMs+500;
    var alive=aliveCount(),i;
    var want=soundLoop()&&!api.muted()? Math.min(3, Math.ceil(alive/8)) : 0;
    var master=Number(api.cfg.volume); if(!(master>=0)) master=100;
    if(master<=0) want=0;
    // 收缩
    while(buzz.length>want){ var a=buzz.pop(); try{ a.onended=null; a.pause(); }catch(e){} }
    // 补足
    while(buzz.length<want){
      var au=new Audio(api.asset('mosquito/mosquito.mp3'));
      au.volume=Math.max(0,Math.min(1, master/100*(0.5+Math.random()*0.4)));
      au.loop=false;
      au.onended=function(){
        var self=this;
        // 播完隔 3 秒再响（断续的嗡嗡声）；期间静音了 / 蚊子没了就不再响
        setTimeout(function(){
          if(buzz.indexOf(self)>=0 && !api.muted() && aliveCount()>0){ try{ self.currentTime=0; self.play().catch(function(){}); }catch(e){} }
        }, 3000);
      };
      try{ au.currentTime=Math.random()*2; au.play().catch(function(){}); }catch(e){}
      buzz.push(au);
    }
  }
  function stopBuzz(){ for(var i=0;i<buzz.length;i++){ try{ buzz[i].onended=null; buzz[i].pause(); }catch(e){} } buzz=[]; }

  function banner(cmd,text){ if(api.cfg.showTriggerUser===true){ var name=ZL.who(cmd); if(name) api.banner(name+text); } }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      for(var i=0;i<5;i++) poses.push(ZL.img('mosquito/mosquito_pose_'+(i+1)+'.png'));
    },
    resize:function(){},
    config:function(){
      // 换了麦克风 / 阈值 / 灵敏度：重开监听（有蚊子时下一帧自动开）
      if(clap&&micKeyNow()!==clapKey) stopMic();
      buzzCheckAt=0;
    },
    mute:function(on){ if(on) stopBuzz(); buzzCheckAt=0; },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ bugs=[]; pending=0; stopMic(); stopBuzz(); return; }
      var n=ZL.count(cmd,10);
      if(op==='reduce'){
        var q=Math.min(pending,n);
        pending-=q;
        killRandom(n-q);
        banner(cmd,' 帮主播拍死 '+n+' 只蚊子');
        return;
      }
      n=Math.min(n,api.cap());
      pending=Math.min(pending+n, 999999999);
      refill();
      banner(cmd,' 放出 '+n+' 只蚊子');
    },
    pointer:function(type,x,y){
      if(type!=='down') return;
      var nx=x/api.W, ny=y/api.H;
      for(var i=bugs.length-1;i>=0;i--){
        var b=bugs[i];
        if(b.deadAt) continue;
        var size=Math.max(16,Math.min(api.W,api.H)*0.025*b.sizeF)/Math.min(api.W,api.H);
        var dx=(nx-b.x), dy=(ny-b.y);
        if(dx*dx+dy*dy <= size*size*2.2){ b.deadAt=nowMs; return true; }
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      refill();
      if(bugs.length>0){ startMicIfNeeded(); syncBuzz(); }
      else { stopMic(); stopBuzz(); }
      if(bugs.length===0) return false;
      var alive=false;
      var dtS=Math.min(0.05,Math.max(0.001,step/1000));
      for(var i=bugs.length-1;i>=0;i--){
        var b=bugs[i];
        if(b.deadAt){
          var dp=(nowMs-b.deadAt)/950;
          if(dp>=1){ bugs.splice(i,1); continue; }
          b.y+=dp*dtS*0.6;   // 坠落
          alive=true; continue;
        }
        alive=true;
        b.nextTurn-=dtS;
        if(b.nextTurn<=0){ b.nextTurn=0.18+Math.random()*0.72; b.target=Math.random()*6.2832; }
        // 边缘软回弹
        if(b.x<0.08) b.target=(Math.random()*2-1)*0.65;
        if(b.x>0.92) b.target=Math.PI+(Math.random()*2-1)*0.65;
        if(b.y<0.08) b.target=0.35+Math.random()*(Math.PI-0.7);
        if(b.y>0.92) b.target=Math.PI+0.35+Math.random()*(Math.PI-0.7);
        var d=b.target-b.heading;
        while(d>Math.PI)d-=6.2832; while(d<-Math.PI)d+=6.2832;
        b.heading+=d*Math.min(1,dtS*3.2);
        b.speed+=(Math.random()*2-1)*0.012*dtS;
        b.speed=Math.max(0.018,Math.min(0.075,b.speed));
        b.x+=Math.cos(b.heading)*b.speed*dtS;
        b.y+=Math.sin(b.heading)*b.speed*dtS;
        b.x=Math.max(0.025,Math.min(0.975,b.x));
        b.y=Math.max(0.035,Math.min(0.965,b.y));
      }
      // 最后一只拿掉的这一帧就关麦克风、停嗡嗡声：返回 false 以后不会再 tick，等不到下一帧开头（以前打完麦克风一直开着）
      if(bugs.length===0){ stopMic(); stopBuzz(); }
      return alive;
    },
    draw:function(ctx){
      var t=nowMs/1000;
      var frame=Math.floor(t*12)%5;   // 12fps 扇翅
      var i;
      for(i=0;i<bugs.length;i++){
        var b=bugs[i];
        var size=Math.max(16,Math.min(api.W,api.H)*0.025*b.sizeF);
        var x=b.x*api.W, y=b.y*api.H;
        var rot=Math.sin(t*b.speed*40+b.phase)*1.0;   // ±57° 摇摆
        var alpha=1;
        if(b.deadAt){
          var dp=(nowMs-b.deadAt)/950;
          rot=dp*6+b.phase;
          alpha=1-dp;
        }
        ctx.save();
        ctx.globalAlpha*=alpha;
        ctx.translate(x,y); ctx.rotate(rot);
        // 蚊子按飞行朝向翻面
        var flip=Math.cos(b.heading)<0&&!b.deadAt;
        if(flip) ctx.scale(-1,1);
        var im=poses[(frame+b.frameOff)%5];
        if(ZL.imgOk(im)) ctx.drawImage(im,-size/2,-size/2,size,size);
        else { ctx.strokeStyle='#333'; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(0,0,size*0.4,size*0.25,0,0,6.2832); ctx.stroke(); }
        ctx.restore();
      }
      // 提示条（左上）：走计数面板排位，几个玩法同时在场时上下排开（以前固定画在 12,12，会和别的面板叠住）
      var total=aliveCount()+pending;
      var hctx=api.hudCtx||ctx;
      if(total>0){
        var cue=(micState?'点击灭蚊':'拍手或点击灭蚊')+'  剩余 '+total+' 只';
        var fs2=Math.max(15,Math.min(26,api.W*0.021)), bh2=fs2*2.1;
        var top2=api.hud?api.hud(bh2):12;
        hctx.save();
        hctx.font='700 '+fs2+'px "Microsoft YaHei",sans-serif';
        var tw2=hctx.measureText(cue).width;
        ZL.roundRect(hctx,12,top2,tw2+fs2*1.6,bh2,fs2);
        hctx.fillStyle='rgba(20,22,28,0.66)'; hctx.fill();
        hctx.lineWidth=1.5; hctx.strokeStyle='rgba(255,255,255,0.16)'; hctx.stroke();
        hctx.textAlign='left'; hctx.textBaseline='middle';
        hctx.lineJoin='round'; hctx.lineWidth=Math.max(2,fs2*0.14); hctx.strokeStyle='rgba(0,0,0,0.6)';
        hctx.strokeText(cue,12+fs2*0.8,top2+bh2/2);
        hctx.fillStyle='#fff'; hctx.fillText(cue,12+fs2*0.8,top2+bh2/2);
        hctx.restore();
      } else if(api.hud) api.hud(0);
      if(micState&&bugs.length>0){
        ctx.save();
        ctx.font='600 '+Math.max(13,api.W*0.013)+'px "Microsoft YaHei",sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle=micKind==='preview'?'rgba(255,255,255,0.8)':'rgba(255,140,140,0.85)';
        ctx.fillText(micState, api.W/2, api.H-18);
        ctx.restore();
      }
    },
    // 只读调试钩子（离线验收用，生产不调用）：killsFor 供验收三档消灭
    debug:function(){
      var hits=[];
      for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt) hits.push([bugs[i].x*api.W,bugs[i].y*api.H]);
      return { alive:aliveCount(), pending:pending, count:bugs.length, micState:micState, micKind:micKind, buzz:buzz.length, hits:hits, killsFor:killsFor, media:buzz.slice() };
    }
  };
})());
`
