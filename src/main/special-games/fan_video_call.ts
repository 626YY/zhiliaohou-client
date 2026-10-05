// 特色玩法「粉丝来视频」的页面内 Canvas 代码。
// 全屏深色视频通话界面：来电时顶部头像昵称 + 底部红挂断/绿接听；接听后全屏播一条视频
// （cover 裁切绘制），播完自动挂断；多通排队，通话中显示「新的视频来电（等待 N 个）」。
// 操作：show 打来 N 通（排队）/ clear 挂断全部。
// 摄像头：cameraEnabled 且不是详情页预览时，响铃期间用本机摄像头画面（≤1280×720@30，镜像）当背景；
//        打不开（被直播软件占用等）就跳过并提示一行小字；接通的视频出画面后立刻关摄像头。
// 素材：fan_video_call/answer.svg + hangup.svg（按钮图标）、default_video.mp4（接听后播的视频）、
//      铃声复用 fan_call/default_ringtone.mp3；cfg.ringtonePath / answerVideos（多条随机一条）走 api.fileUrl，坏了回退内置。
// 静音：铃声 / 视频照常播放但 muted（视频播完才挂断），mute(on) 同步已在播的。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['show','clear'];
  var MAXQ=999999999;      // 防爆夹紧：排队总数上限
  var WATCHDOG_MS=15000;   // 接听后这么久还没出画面 = 视频坏了
  var answerGlyph=null, hangupGlyph=null;
  var current=null;        // {name,avatarImg,startedAt,answered,answeredAt}
  var queue=[];            // 排队（按来电人合并）：{name,avatar,left}
  var nowMs=0;
  var ringAu=null;
  var video=null, videoReady=false, videoCustom=false;
  var cam=null, camPending=false, camToken=0, camFailed=false;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function durationSec(){ return Math.max(3,Math.min(600,num(api.cfg.durationSec,10))); }
  function showAvatar(){ return api.cfg.showAvatar!==false; }
  function queueCalls(){ return api.cfg.queueCalls!==false; }
  function ringVol(){ return Math.max(0,Math.min(100,num(api.cfg.ringtoneVolume,100))); }
  function videoVol(){ return Math.max(0,Math.min(100,num(api.cfg.answerVideoVolume,100))); }
  function wantCamera(){ return api.cfg.cameraEnabled===true && !api.preview; }
  function queued(){ var s=0; for(var i=0;i<queue.length;i++) s+=queue[i].left; return s; }

  // 释放一个媒体元素（去掉事件、停播、卸载资源）
  function dropMedia(el){
    if(!el) return;
    el.onended=null; el.onerror=null; el.onloadeddata=null;
    try{ el.pause(); el.removeAttribute('src'); el.load(); }catch(e){}
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
    if(custom) au.onerror=function(){ if(ringAu!==au) return; au.onerror=null; au.src=builtin; au.play().catch(function(){}); };
    au.play().catch(function(){});
    ringAu=au;
  }

  // —— 摄像头（响铃背景）——
  function stopTracks(stream){ try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} }
  function startCamera(){
    if(cam||camPending||!wantCamera()) return;
    if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)){ camFailed=true; return; }
    var token=++camToken;
    camPending=true; camFailed=false;
    navigator.mediaDevices.getUserMedia({ audio:false, video:{ width:{ ideal:1280, max:1280 }, height:{ ideal:720, max:720 }, frameRate:{ ideal:30, max:30 } } }).then(function(stream){
      camPending=false;
      if(token!==camToken){ stopTracks(stream); return; }
      var v=document.createElement('video');
      v.muted=true; v.playsInline=true; v.autoplay=true;
      v.srcObject=stream;
      v.play().catch(function(){});
      cam={ stream:stream, video:v };
      ZL.kick();
    }).catch(function(){
      camPending=false;
      if(token!==camToken) return;
      camFailed=true;
      ZL.kick();
    });
  }
  function stopCamera(){
    camToken++; camPending=false; camFailed=false;
    if(cam){ stopTracks(cam.stream); try{ cam.video.pause(); cam.video.srcObject=null; }catch(e){} cam=null; }
  }

  function stopVideo(){ dropMedia(video); video=null; videoReady=false; videoCustom=false; }

  function showCall(call){
    current=call;
    current.startedAt=nowMs;
    startRing();
    startCamera();
  }

  function makeCall(info){
    return {
      name:info.name,
      avatarImg:info.avatar?ZL.imgRaw(info.avatar):null,
      startedAt:nowMs, answered:false, answeredAt:0
    };
  }

  function takeNext(){
    var q=queue[0];
    if(!q) return null;
    q.left--;
    if(q.left<=0) queue.shift();
    return makeCall(q);
  }

  function dismissCurrent(showNext){
    current=null;
    stopRing(); stopVideo();
    if(showNext&&queue.length>0) showCall(takeNext());   // 接着响下一通（摄像头开着就不关，避免闪一下）
    else stopCamera();
    ZL.kick();
  }

  // 接听后播一条视频：自定义视频随机一条，坏了退回内置，内置也坏了直接挂断进下一通
  function playVideo(url,custom){
    stopVideo();
    var call=current;
    var v=document.createElement('video');
    v.playsInline=true; v.preload='auto';
    v.volume=videoVol()/100;
    v.muted=api.muted();
    v.onloadeddata=function(){
      if(video!==v) return;
      videoReady=true;
      stopCamera();   // 视频出画面了，摄像头让位
      ZL.kick();
    };
    v.onended=function(){ if(video===v&&current===call) dismissCurrent(true); };
    v.onerror=function(){ if(video===v&&current===call) videoFailed(); };
    v.src=url;
    v.play().catch(function(){ /* 播不起来交给看门狗 */ });
    video=v; videoCustom=custom;
  }
  function videoFailed(){
    if(!current) return;
    if(videoCustom) playVideo(api.asset('fan_video_call/default_video.mp4'),false);
    else dismissCurrent(true);
  }

  function answerCurrent(){
    if(!current||current.answered) return;
    current.answered=true;
    current.answeredAt=nowMs;
    stopRing();
    var pick=ZL.pickPath(api.cfg.answerVideos);
    if(pick) playVideo(api.fileUrl(pick),true);
    else playVideo(api.asset('fan_video_call/default_video.mp4'),false);
  }

  // 底部按钮几何：左红挂断、右绿接听，下方文字标签
  function btnGeom(){
    var r=Math.max(28,Math.min(44,api.W*0.055));
    var y=api.H*0.82;
    return { r:r, y:y, hangupX:api.W*0.32, answerX:api.W*0.68 };
  }

  function drawBtn(ctx,cx,cy,r,color,glyph,label,fs){
    ctx.save();
    ctx.fillStyle=color;
    ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=12;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,6.2832); ctx.fill();
    ctx.shadowBlur=0;
    if(ZL.imgOk(glyph)) ctx.drawImage(glyph,cx-r*0.5,cy-r*0.5,r,r);
    ctx.font='600 '+fs+'px "Microsoft YaHei",sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.fillText(label,cx,cy+r+8);
    ctx.restore();
  }

  // cover 铺满（mirror=镜像，摄像头自拍视角）
  function drawCover(ctx,el,iw,ih,mirror){
    var W=api.W,H=api.H;
    if(!(iw>0&&ih>0)) return;
    var s=Math.max(W/iw,H/ih);
    var dw=iw*s, dh=ih*s;
    ctx.save();
    if(mirror){ ctx.translate(W,0); ctx.scale(-1,1); }
    ctx.drawImage(el,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.restore();
  }

  function centerText(ctx,text,y,fs,color){
    ctx.save();
    ctx.font='600 '+fs+'px "Microsoft YaHei",sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.16); ctx.strokeStyle='rgba(0,0,0,0.55)';
    ctx.strokeText(text,api.W/2,y);
    ctx.fillStyle=color; ctx.fillText(text,api.W/2,y);
    ctx.restore();
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      answerGlyph=ZL.img('fan_video_call/answer.svg');
      hangupGlyph=ZL.img('fan_video_call/hangup.svg');
    },
    resize:function(){},
    config:function(){
      if(ringAu){ if(api.cfg.ringtoneEnabled===false) stopRing(); else ringAu.volume=ringVol()/100; }
      if(video) video.volume=videoVol()/100;
      // 摄像头开关热更新：响铃中打开 / 关掉
      if(current&&!current.answered){ if(wantCamera()) startCamera(); else stopCamera(); }
    },
    mute:function(on){
      if(ringAu) ringAu.muted=!!on;
      if(video) video.muted=!!on;
    },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ queue=[]; dismissCurrent(false); return; }
      var n=Math.min(ZL.count(cmd,1), api.cap());
      var info={ name:ZL.who(cmd)||'神秘粉丝', avatar:String((cmd&&cmd.avatar)||'') };
      if(!queueCalls()){
        // 不排队：新来电直接挤掉当前（一次来多通也只留一通）
        current=null; stopRing(); stopVideo();
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
      var g=btnGeom();
      var dx=x-g.hangupX, dy=y-g.y;
      if(dx*dx+dy*dy<=g.r*g.r*1.44){ dismissCurrent(true); return true; }
      dx=x-g.answerX;
      if(!current.answered && dx*dx+dy*dy<=g.r*g.r*1.44){ answerCurrent(); return true; }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      if(!current) return false;
      if(!current.answered && nowMs-current.startedAt>=durationSec()*1000){
        dismissCurrent(true);
        return current!=null;
      }
      // 视频看门狗：接听后迟迟不出画面就当坏了
      if(current.answered && !videoReady && nowMs-current.answeredAt>=WATCHDOG_MS){
        current.answeredAt=nowMs;
        videoFailed();
      }
      return true;
    },
    draw:function(ctx){
      if(!current) return;
      var W=api.W,H=api.H;
      // 深色通话底
      ctx.save();
      ctx.fillStyle='#121519';
      ctx.fillRect(0,0,W,H);
      ctx.restore();
      if(current.answered){
        // 接听后：视频 cover 铺满
        if(video&&videoReady&&video.readyState>=2) drawCover(ctx,video,video.videoWidth,video.videoHeight,false);
      }else if(cam&&cam.video.readyState>=2){
        // 响铃中：本机摄像头当背景（镜像），压一层暗色让文字清楚
        drawCover(ctx,cam.video,cam.video.videoWidth,cam.video.videoHeight,true);
        ctx.save(); ctx.fillStyle='rgba(0,0,0,0.28)'; ctx.fillRect(0,0,W,H); ctx.restore();
      }
      var fs1=Math.max(20,W*0.026), fs2=Math.max(13,W*0.016);
      if(!current.answered){
        // 来电信息：头像 + 昵称 + 状态
        var avR=Math.max(36,W*0.05);
        var ax=W/2, ay=H*0.2;
        ctx.save();
        ctx.beginPath(); ctx.arc(ax,ay,avR,0,6.2832); ctx.closePath(); ctx.clip();
        var im=current.avatarImg;
        if(showAvatar()&&ZL.imgOk(im)){
          var s2=Math.max(avR*2/im.naturalWidth,avR*2/im.naturalHeight);
          ctx.drawImage(im,ax-im.naturalWidth*s2/2,ay-im.naturalHeight*s2/2,im.naturalWidth*s2,im.naturalHeight*s2);
        }else{
          ctx.fillStyle='#2a3546'; ctx.fillRect(ax-avR,ay-avR,avR*2,avR*2);
          ctx.fillStyle='rgba(255,255,255,0.85)';
          ctx.font='700 '+(avR)+'px "Microsoft YaHei",sans-serif';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText((current.name||'粉').charAt(0)||'粉',ax,ay);
        }
        ctx.restore();
        ctx.lineWidth=3; ctx.strokeStyle='rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(ax,ay,avR,0,6.2832); ctx.stroke();
        ctx.save();
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font='700 '+fs1+'px "Microsoft YaHei",sans-serif';
        ctx.fillStyle='#fff';
        ctx.fillText(current.name, ax, ay+avR+fs1*1.3);
        ctx.font='400 '+fs2+'px "Microsoft YaHei",sans-serif';
        ctx.fillStyle='rgba(255,255,255,0.6)';
        ctx.fillText('邀请你视频通话', ax, ay+avR+fs1*1.3+fs2*1.8);
        ctx.restore();
        if(camFailed) centerText(ctx,'摄像头不可用，仍可接听',H*0.62,Math.max(12,W*0.013),'rgba(255,255,255,0.7)');
      }else{
        if(!videoReady) centerText(ctx,'正在连接视频…',H*0.5,fs2,'rgba(255,255,255,0.8)');
        // 通话中：顶部名字条 + 等待条
        ctx.save();
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font='600 '+fs2+'px "Microsoft YaHei",sans-serif';
        ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs2*0.16); ctx.strokeStyle='rgba(0,0,0,0.5)';
        ctx.strokeText(current.name, W/2, H*0.05);
        ctx.fillStyle='rgba(255,255,255,0.9)';
        ctx.fillText(current.name, W/2, H*0.05);
        ctx.restore();
        var waiting=queued();
        if(waiting>0){
          var wt=queue[0].name+' · 新的视频来电（等待 '+waiting+' 个）';
          var wfs=Math.max(13,W*0.015);
          ctx.save();
          ctx.font='600 '+wfs+'px "Microsoft YaHei",sans-serif';
          var tw=ctx.measureText(wt).width;
          ZL.roundRect(ctx,W/2-tw/2-wfs,H*0.085,tw+wfs*2,wfs*2.2,wfs*1.1);
          ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fill();
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillStyle='#ffd54a';
          ctx.fillText(wt,W/2,H*0.085+wfs*1.15);
          ctx.restore();
        }
      }
      // 底部按钮
      var g=btnGeom();
      var lfs=Math.max(13,W*0.015);
      drawBtn(ctx,g.hangupX,g.y,g.r,'#f2363a',hangupGlyph,'挂断',lfs);
      if(!current.answered) drawBtn(ctx,g.answerX,g.y,g.r,'#22c55e',answerGlyph,'接听',lfs);
    },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      var g=btnGeom();
      var media=[];
      if(ringAu) media.push(ringAu);
      if(video) media.push(video);
      return {
        current:current?{ name:current.name, answered:current.answered }:null,
        queued:queued(), videoReady:videoReady, camera:!!cam, cameraPending:camPending, cameraFailed:camFailed,
        answerAt:[g.answerX,g.y], hangupAt:[g.hangupX,g.y], media:media
      };
    }
  };
})());
`
