// 特色玩法「小新哎嘿」的页面内 Canvas 代码。
// 小新（特效视频拆出的透明帧序列）在随机位置循环扭动 + 播「哎嘿」语音；
// 点击后拖鞋从右上拍下（0.36s），第 150ms 播拍击声，拍完小新消失，队列补位。操作：add / clear。
// 素材：xiaoxin/frames/f001~f030.png（已抠绿）、xiaoxin_voice.wav、xiaoxin_slap.wav、xiaoxin_slipper.png。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','clear'];
  var FRAMES=30;
  var frames=[];
  var slipperImg=null;
  var boys=[];             // {x,y,w,h,frameOff,striking,strikeAt,dieAt}
  var slippers=[];         // {x,y,w,h,t0}
  var pending=0;
  var spawnClock=0;
  var nowMs=0;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,12))); }

  function makeBoy(){
    var bw=118+Math.random()*48;   // 118~166
    bw=Math.max(88,Math.min(bw, api.W*0.42));
    var bh=Math.max(110, bw*376/300);
    var m=8;
    return {
      x:m+bw/2+Math.random()*Math.max(1,api.W-bw-m*2),
      y:m+bh/2+Math.random()*Math.max(1,api.H-bh-m*2),
      w:bw, h:bh, frameOff:Math.floor(Math.random()*FRAMES),
      striking:false, strikeAt:0, dieAt:0
    };
  }

  function drawSlippers(ctx){
    var now=nowMs;
    for(var i=slippers.length-1;i>=0;i--){
      var s=slippers[i];
      var p=(now-s.t0)/360;
      if(p>=1){ slippers.splice(i,1); continue; }
      var strike=Math.min(1,p/0.43);
      var fade=p<0.62?1:(1-p)/0.38;
      var size=Math.min(s.w,s.h)*(0.48+0.20*strike);
      var cx=s.w*(0.82-0.34*strike), cy=s.h*(0.18+0.34*strike);
      var rot=(-28+40*strike)*Math.PI/180;
      ctx.save();
      ctx.globalAlpha*=fade;
      ctx.translate(s.x-s.w/2+cx, s.y-s.h/2+cy);
      ctx.rotate(rot);
      if(ZL.imgOk(slipperImg)){
        var wh=ZL.fit(slipperImg,size);
        ctx.drawImage(slipperImg,-wh[0]/2,-wh[1]/2,wh[0],wh[1]);
      }else{
        ctx.fillStyle='#e8689a';
        ZL.roundRect(ctx,-size/2,-size*0.22,size,size*0.44,size*0.2); ctx.fill();
      }
      ctx.restore();
    }
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      for(var i=0;i<FRAMES;i++){
        var n='00'+(i+1); n=n.slice(-3);
        frames.push(ZL.img('xiaoxin/frames/f'+n+'.png'));
      }
      slipperImg=ZL.img('xiaoxin/xiaoxin_slipper.png');
    },
    resize:function(){},
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ boys=[]; slippers=[]; pending=0; return; }
      var n=Math.min(ZL.count(cmd,3), api.cap());
      pending=Math.min(pending+n, 999999999);
      var name=ZL.who(cmd);
      if(name) api.banner(name+' 叫来 '+n+' 个小新');
    },
    pointer:function(type,x,y){
      if(type!=='down') return;
      for(var i=boys.length-1;i>=0;i--){
        var b=boys[i];
        if(b.striking) continue;
        if(Math.abs(x-b.x)<=b.w/2 && Math.abs(y-b.y)<=b.h/2){
          b.striking=true;
          b.strikeAt=nowMs+150;
          b.dieAt=nowMs+360;
          slippers.push({ x:b.x, y:b.y, w:b.w*1.35, h:b.h*1.25, t0:nowMs });
          return;
        }
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      // 140ms 一个补位
      spawnClock+=step;
      if(pending>0 && boys.length<maxVisible() && spawnClock>=140){
        spawnClock=0;
        var b=makeBoy();
        boys.push(b); pending--;
        ZL.snd('xiaoxin/xiaoxin_voice.wav');
      }
      var active=pending>0||slippers.length>0||boys.length>0;
      var now=nowMs;
      for(var i=boys.length-1;i>=0;i--){
        var bb=boys[i];
        if(bb.striking && now>=bb.strikeAt && !bb.slapped){ bb.slapped=true; ZL.snd('xiaoxin/xiaoxin_slap.wav'); }
        if(bb.striking && now>=bb.dieAt){ boys.splice(i,1); continue; }
      }
      return active;
    },
    draw:function(ctx){
      // 15fps 帧序列循环
      var fi=Math.floor(nowMs/(1000/15))%FRAMES;
      for(var i=0;i<boys.length;i++){
        var b=boys[i];
        var im=frames[(fi+b.frameOff)%FRAMES];
        if(ZL.imgOk(im)) ctx.drawImage(im, b.x-b.w/2, b.y-b.h/2, b.w, b.h);
        else { ctx.fillStyle='#e8574a'; ZL.roundRect(ctx,b.x-b.w/2,b.y-b.h/2,b.w,b.h,10); ctx.fill(); }
      }
      drawSlippers(ctx);
    },
    // 只读调试钩子（离线验收用，生产不调用）：可点的小新中心点
    debug:function(){
      var hits=[];
      for(var i=0;i<boys.length;i++) if(!boys[i].striking) hits.push([boys[i].x,boys[i].y,boys[i].w]);
      return { pending:pending, count:boys.length, hits:hits };
    }
  };
})());
`
