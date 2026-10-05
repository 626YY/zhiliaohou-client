// 特色玩法「粉丝来电」的页面内 Canvas 代码。
// 顶部紧凑白色来电条：头像 + 昵称 +「正在来电 mm:ss」+ 红挂断/绿接听两圆钮；
// 铃声循环、超时自动挂断、多通排队；接听后随机播一条接听音频，播完自动挂断进下一通。
// 操作：show 打来 N 通（排队）/ clear 挂断全部。
// 素材：fan_call/default_ringtone.mp3（铃声循环）、default_answer.mp3（接听音）、answer/hangup 两个圆钮 SVG；
//      cfg.ringtonePath（自定义铃声）/ answerAudios（多条接听语音，每次随机一条）走 api.fileUrl，坏了回退内置。
// 静音：长音频（铃声/接听语音）照常播放但 muted（接听语音播完才挂断，不能因为静音就卡住），mute(on) 同步已在播的。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['show','clear'];
  var MAXQ=999999999;      // 防爆夹紧：排队总数上限
  var answerBtnImg=null, hangupBtnImg=null;
  var current=null;        // {name,avatarImg,startedAt,answered,answerAu}
  var queue=[];            // 排队（按来电人合并）：{name,avatar,left}
  var nowMs=0;
  var ringAu=null;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function durationSec(){ return Math.max(3,Math.min(600,num(api.cfg.durationSec,10))); }
  function showAvatar(){ return api.cfg.showAvatar!==false; }
  function queueCalls(){ return api.cfg.queueCalls!==false; }
  function ringVol(){ return Math.max(0,Math.min(100,num(api.cfg.ringtoneVolume,100))); }
  function answerVol(){ return Math.max(0,Math.min(100,num(api.cfg.answerVolume,100))); }
  function queued(){ var s=0; for(var i=0;i<queue.length;i++) s+=queue[i].left; return s; }

  // 释放一个媒体元素（去掉事件、停播、卸载资源，避免后台继续缓冲）
  function dropMedia(au){
    if(!au) return;
    au.onended=null; au.onerror=null;
    try{ au.pause(); au.removeAttribute('src'); au.load(); }catch(e){}
  }

  function stopRing(){ dropMedia(ringAu); ringAu=null; }
  function startRing(){
    stopRing();
    if(api.cfg.ringtoneEnabled===false) return;
    var builtin=api.asset('fan_call/default_ringtone.mp3');
    var custom=String(api.cfg.ringtonePath||'').trim();
    var au=new Audio(custom?api.fileUrl(custom):builtin);
    au.loop=true;
    au.volume=ringVol()/100;
    au.muted=api.muted();
    // 自定义铃声放不了 → 换内置
    if(custom) au.onerror=function(){ if(ringAu!==au) return; au.onerror=null; au.src=builtin; au.play().catch(function(){}); };
    au.play().catch(function(){});
    ringAu=au;
  }

  function makeCall(info){
    return {
      name:info.name,
      avatarImg:info.avatar?ZL.imgRaw(info.avatar):null,
      startedAt:nowMs, answered:false, answerAu:null
    };
  }

  function showCall(call){
    current=call;
    current.startedAt=nowMs;
    startRing();
  }

  function takeNext(){
    var q=queue[0];
    if(!q) return null;
    q.left--;
    if(q.left<=0) queue.shift();
    return makeCall(q);
  }

  function dismissCurrent(showNext){
    if(current){ dropMedia(current.answerAu); current.answerAu=null; }
    current=null;
    stopRing();
    if(showNext&&queue.length>0) showCall(takeNext());
    ZL.kick();
  }

  // 接听：随机挑一条自定义接听语音（没有就内置），播完自动挂断进下一通
  function answerCurrent(){
    if(!current||current.answered) return;
    var call=current;
    call.answered=true;
    call.startedAt=nowMs;
    stopRing();
    var builtin=api.asset('fan_call/default_answer.mp3');
    var pick=ZL.pickPath(api.cfg.answerAudios);
    var url=pick?api.fileUrl(pick):'';
    var au=new Audio(url||builtin);
    au.volume=answerVol()/100;
    au.muted=api.muted();
    au.onended=function(){ if(current===call) dismissCurrent(true); };
    au.onerror=function(){
      if(current!==call) return;
      // 自定义语音放不了 → 换内置；内置也放不了就停在通话中，等主播挂断
      if(url){ url=''; au.src=builtin; au.play().catch(function(){}); }
    };
    au.play().catch(function(){});
    call.answerAu=au;
  }

  // 卡片布局：内容 = 头像54 + 文字列 + 挂断52 + 接听52，高约74，顶部居中
  function cardGeom(){
    var fs=17;
    var name=current?current.name:'';
    var ctx=api.ctx;
    ctx.save();
    ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
    var nameW=Math.min(ctx.measureText(name).width, api.W*0.3);
    ctx.restore();
    var textW=Math.max(110,nameW+8);
    var btnR=26, avR=27;
    var w=14+avR*2+10+textW+10+btnR*2+10+btnR*2+12;
    var h=avR*2+20;
    return { x:api.W/2-w/2, y:api.H*0.035, w:w, h:h, avR:avR, btnR:btnR, textW:textW,
      hangupX:api.W/2-w/2+14+avR*2+10+textW+10+btnR,
      answerX:api.W/2-w/2+14+avR*2+10+textW+10+btnR*2+10+btnR };
  }

  function drawAvatar(ctx,g){
    var ax=g.x+14+g.avR, ay=g.y+g.h/2;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax,ay,g.avR,0,6.2832); ctx.closePath(); ctx.clip();
    var im=current.avatarImg;
    if(showAvatar()&&ZL.imgOk(im)){
      var s=Math.max(g.avR*2/im.naturalWidth,g.avR*2/im.naturalHeight);
      ctx.drawImage(im,ax-im.naturalWidth*s/2,ay-im.naturalHeight*s/2,im.naturalWidth*s,im.naturalHeight*s);
    }else{
      ctx.fillStyle='#e1e6ee'; ctx.fillRect(ax-g.avR,ay-g.avR,g.avR*2,g.avR*2);
      ctx.fillStyle='#484f5b';
      ctx.font='700 20px "Microsoft YaHei",sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText((current.name||'粉').charAt(0)||'粉',ax,ay);
    }
    ctx.restore();
  }

  function drawButton(ctx,cx,cy,r,color,img,glyphRot){
    if(ZL.imgOk(img)){
      ctx.drawImage(img,cx-r,cy-r,r*2,r*2);
      return;
    }
    ctx.save();
    ctx.translate(cx,cy);
    ctx.fillStyle=color;
    ctx.beginPath(); ctx.arc(0,0,r,0,6.2832); ctx.fill();
    ctx.rotate(glyphRot);
    ctx.fillStyle='#fff';
    ctx.font=(r*0.92)+'px "Segoe UI Emoji","Apple Color Emoji",serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('\\uD83D\\uDCDE',0,0);
    ctx.restore();
  }

  function fmt(ms){
    var s=Math.max(0,Math.floor(ms/1000));
    var m=Math.floor(s/60), ss=s%60;
    return (m<10?'0':'')+m+':'+(ss<10?'0':'')+ss;
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      answerBtnImg=ZL.img('fan_call/fan_call_answer.svg');
      hangupBtnImg=ZL.img('fan_call/fan_call_hangup.svg');
    },
    resize:function(){},
    config:function(){
      // 铃声开关 / 音量热更新
      if(ringAu){ if(api.cfg.ringtoneEnabled===false) stopRing(); else ringAu.volume=ringVol()/100; }
      if(current&&current.answerAu) current.answerAu.volume=answerVol()/100;
    },
    mute:function(on){
      if(ringAu) ringAu.muted=!!on;
      if(current&&current.answerAu) current.answerAu.muted=!!on;
    },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ queue=[]; dismissCurrent(false); return; }
      var n=Math.min(ZL.count(cmd,1), api.cap());
      var info={ name:ZL.who(cmd)||'神秘粉丝', avatar:String((cmd&&cmd.avatar)||'') };
      if(!queueCalls()){
        // 不排队：新来电直接挤掉当前（一次来多通也只留一通）
        dismissCurrent(false);
        showCall(makeCall(info));
        return;
      }
      if(!current){ showCall(makeCall(info)); n--; }
      n=Math.min(n, MAXQ-queued());
      if(n>0){
        var last=queue[queue.length-1];
        if(last&&last.name===info.name&&last.avatar===info.avatar) last.left+=n;
        else queue.push({ name:info.name, avatar:info.avatar, left:n });
      }
    },
    pointer:function(type,x,y){
      if(type!=='down'||!current) return;
      var g=cardGeom();
      var dx=x-g.hangupX, dy=y-g.y-g.h/2;
      if(dx*dx+dy*dy<=g.btnR*g.btnR*1.3){ dismissCurrent(true); return true; }
      dx=x-g.answerX;
      if(dx*dx+dy*dy<=g.btnR*g.btnR*1.3 && !current.answered){ answerCurrent(); return true; }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      if(!current) return false;
      if(!current.answered && nowMs-current.startedAt>=durationSec()*1000){
        dismissCurrent(true);
        return current!=null;
      }
      return true;
    },
    draw:function(ctx){
      if(!current) return;
      var g=cardGeom();
      // 卡片
      ctx.save();
      ctx.shadowColor='rgba(0,0,0,0.35)'; ctx.shadowBlur=18; ctx.shadowOffsetY=4;
      ZL.roundRect(ctx,g.x,g.y,g.w,g.h,14);
      ctx.fillStyle='#ffffff'; ctx.fill();
      ctx.restore();
      drawAvatar(ctx,g);
      // 文字列
      var tx=g.x+14+g.avR*2+10, ty1=g.y+g.h/2-11, ty2=g.y+g.h/2+12;
      ctx.save();
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.font='700 17px "Microsoft YaHei",sans-serif';
      ctx.fillStyle='#181b20';
      var name=current.name;
      if(ctx.measureText(name).width>g.textW){
        while(name.length>1 && ctx.measureText(name+'…').width>g.textW) name=name.slice(0,-1);
        name+='…';
      }
      ctx.fillText(name,tx,ty1);
      ctx.font='400 12px "Microsoft YaHei",sans-serif';
      ctx.fillStyle='#828892';
      var status=(current.answered?'正在通话  ':'正在来电  ')+fmt(nowMs-current.startedAt);
      ctx.fillText(status,tx,ty2);
      ctx.restore();
      // 按钮
      var by=g.y+g.h/2;
      drawButton(ctx,g.hangupX,by,g.btnR,'#f2363a',hangupBtnImg,2.356);
      if(!current.answered) drawButton(ctx,g.answerX,by,g.btnR,'#22c55e',answerBtnImg,0);
      // 排队提示（卡片下方）
      var waiting=queued();
      if(waiting>0){
        var wt='还有 '+waiting+' 通来电在排队';
        ctx.save();
        ctx.font='600 13px "Microsoft YaHei",sans-serif';
        var tw=ctx.measureText(wt).width;
        var wx=api.W/2, wy=g.y+g.h+16;
        ZL.roundRect(ctx,wx-tw/2-12,wy-12,tw+24,24,12);
        ctx.fillStyle='rgba(20,22,28,0.66)'; ctx.fill();
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle='#ffffff';
        ctx.fillText(wt,wx,wy);
        ctx.restore();
      }
    },
    // 只读调试钩子（离线验收用，生产不调用）：当前来电、排队数、两颗按钮位置、正在用的长音频
    debug:function(){
      var g=current?cardGeom():null;
      var media=[];
      if(ringAu) media.push(ringAu);
      if(current&&current.answerAu) media.push(current.answerAu);
      return {
        current:current?{ name:current.name, answered:current.answered }:null,
        queued:queued(),
        answerAt:g?[g.answerX,g.y+g.h/2]:null,
        hangupAt:g?[g.hangupX,g.y+g.h/2]:null,
        media:media
      };
    }
  };
})());
`
