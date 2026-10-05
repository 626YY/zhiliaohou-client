// 特色玩法「顶金币」的页面内 Canvas 代码。
// 马里奥式顶砖：点击悬空砖块 → 砖块上跳 0.2s、弹出一枚金币（空中 |cos(spin)| 翻面）落下堆叠；
// 再点击金币收走。计数：已顶数量 / 剩余数量（顶部居中）。操作：add 充金币 / clear 清场。
// 素材：coin_bump/brick.png + coin.png + coin_bump.mp3；cfg.customCoinImage / customSound（顶出音效）可换本地文件（走 api.fileUrl）。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','clear'];
  var MAXN=999999999;      // 防爆夹紧：砖块里金币上限
  var brickImg=null, coinImg=null, customCoin=null, customCoinPath='';
  var remaining=0;         // 砖块里还剩多少金币
  var total=0;             // 已顶出总数
  var coins=[];            // {x,y,vx,vy,r,spin,spinV,settled,alpha,pickAt}
  var bumpT=0;             // 砖块上跳动画剩余
  var appearT=0;           // 砖块出现（弹入）动画剩余
  var nowMs=0;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function coinR(){ return Math.max(4, Math.min(api.W,api.H)*Math.max(1,Math.min(20,num(api.cfg.coinSize,5)))/200); }

  // 自定义金币图：路径变了才重新加载；加载失败（complete 但没像素）退回内置
  function syncCustom(){
    var p=String(api.cfg.customCoinImage||'').trim();
    if(p===customCoinPath) return;
    customCoinPath=p;
    customCoin=p?ZL.imgRaw(p):null;
    if(customCoin&&!customCoin.complete) customCoin.addEventListener('load',ZL.kick);
  }
  function coinSprite(){ return (customCoin&&!(customCoin.complete&&!ZL.imgOk(customCoin)))?customCoin:coinImg; }
  function bumpSnd(){
    var cs=String(api.cfg.customSound||'').trim();
    if(cs) ZL.sndRaw(cs); else ZL.snd('coin_bump/coin_bump.mp3');
  }

  function brickRect(){
    var side=Math.max(30, Math.min(api.W,api.H)*0.16);
    return { x:api.W*0.5, y:api.H*0.42, side:side };
  }

  function floorY(r){ return api.H-6-r; }

  function bump(){
    if(remaining<=0) return;
    remaining--; total++;
    bumpT=200;
    var b=brickRect(), r=coinR();
    coins.push({
      x:b.x, y:b.y-b.side/2-r,
      vx:(Math.random()*2-1)*60, vy:-api.H*0.55,
      r:r, spin:Math.random()*3.14, spinV:6+Math.random()*6,
      settled:false, alpha:1, pickAt:0
    });
    bumpSnd();
  }

  function drawCounter(ctx){
    if(total<=0&&remaining<=0) return;
    var fs=Math.max(16,Math.min(32,api.W*0.024));
    var lines=['已顶数量：'+total,'剩余数量：'+remaining];
    ctx.save();
    ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
    var w=0,i;
    for(i=0;i<lines.length;i++) w=Math.max(w,ctx.measureText(lines[i]).width);
    var bw=Math.max(280*fs/32, w*1.3), bh=fs*3.1;
    var x=api.W/2-bw/2, y=api.H*0.04;
    ZL.roundRect(ctx,x,y,bw,bh,fs*0.5);
    ctx.fillStyle='rgba(20,13,5,0.55)'; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,240,165,0.35)'; ctx.stroke();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    for(i=0;i<lines.length;i++){
      var ly=y+bh*(0.3+i*0.4);
      ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.16); ctx.strokeStyle='rgba(20,13,5,0.9)';
      ctx.strokeText(lines[i],api.W/2,ly);
      ctx.fillStyle='#fff0a5';
      ctx.fillText(lines[i],api.W/2,ly);
    }
    ctx.restore();
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      brickImg=ZL.img('coin_bump/brick.png');
      coinImg=ZL.img('coin_bump/coin.png');
      syncCustom();
    },
    resize:function(){},
    config:function(){ syncCustom(); },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ coins=[]; remaining=0; total=0; return; }
      var n=Math.min(ZL.count(cmd,5), api.cap());
      remaining=Math.min(remaining+n, MAXN);
      appearT=260;         // 砖块弹入
      var name=ZL.who(cmd);
      if(name) api.banner(name+' 充进 '+n+' 枚金币，快顶砖块');
    },
    pointer:function(type,x,y){
      if(type!=='down') return;
      // 先判金币（点金币收走）
      for(var i=coins.length-1;i>=0;i--){
        var c=coins[i];
        var dx=x-c.x, dy=y-c.y;
        if(dx*dx+dy*dy <= c.r*c.r*1.44){
          coins.splice(i,1);
          ZL.snd('coin_bump/coin_bump.mp3', 0.8);
          return;
        }
      }
      // 再判砖块（顶）
      var b=brickRect();
      if(Math.abs(x-b.x)<=b.side*0.62 && Math.abs(y-b.y)<=b.side*0.62) bump();
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      if(bumpT>0) bumpT-=step;
      if(appearT>0) appearT-=step;
      var active=bumpT>0||appearT>0;
      var d=step/1000;
      var g=api.H*2.2;
      for(var i=0;i<coins.length;i++){
        var c=coins[i];
        if(c.settled) continue;
        active=true;
        c.vy+=g*d;
        c.x+=c.vx*d; c.y+=c.vy*d;
        c.spin+=c.spinV*d;
        var fy=floorY(c.r);
        if(c.y>=fy){
          c.y=fy;
          if(Math.abs(c.vy)>60){ c.vy=-c.vy*0.32; c.vx*=0.7; }
          else { c.vy=0; c.vx*=0.8; if(Math.abs(c.vx)<8){ c.vx=0; c.settled=true; } }
        }
        if(c.x<c.r){ c.x=c.r; c.vx=Math.abs(c.vx)*0.6; }
        if(c.x>api.W-c.r){ c.x=api.W-c.r; c.vx=-Math.abs(c.vx)*0.6; }
      }
      return active;
    },
    draw:function(ctx){
      var b=brickRect();
      // 砖块（出现弹入 + 顶起 0.2s 单峰偏移）
      var offY=0, scale=1;
      if(bumpT>0){ var p=1-bumpT/200; offY=-Math.sin(p*Math.PI)*b.side*0.14; }
      if(appearT>0){ scale=ZL.easeOutBack(1-appearT/260); }
      if(remaining>0||coins.length>0||bumpT>0||appearT>0){
        ctx.save();
        ctx.translate(b.x,b.y+offY); ctx.scale(Math.max(0.01,scale),Math.max(0.01,scale));
        if(!ZL.drawImg(ctx,brickImg,0,0,b.side,b.side,0,1)){
          ctx.fillStyle='#c8742c'; ctx.fillRect(-b.side/2,-b.side/2,b.side,b.side);
        }
        ctx.restore();
      }
      // 金币（未落地按 |cos(spin)| 水平压扁翻面）
      var cim=coinSprite();
      for(var i=0;i<coins.length;i++){
        var c=coins[i];
        var stretch=c.settled?1:Math.max(0.22,Math.abs(Math.cos(c.spin)));
        ctx.save();
        ctx.translate(c.x,c.y);
        ctx.scale(stretch,1);
        var cwh=ZL.imgOk(cim)?ZL.fit(cim,c.r*2):[c.r*2,c.r*2];
        if(!ZL.drawImg(ctx,cim,0,0,cwh[0],cwh[1],0,1)){
          ctx.fillStyle='#ffd34d';
          ctx.beginPath(); ctx.arc(0,0,c.r,0,6.2832); ctx.fill();
        }
        ctx.restore();
      }
      drawCounter(ctx);
    },
    // 只读调试钩子（离线验收用，生产不调用）：砖块中心 + 可收的金币
    debug:function(){
      var b=brickRect(), hits=[];
      for(var i=0;i<coins.length;i++) hits.push([coins[i].x,coins[i].y,coins[i].r]);
      return { remaining:remaining, total:total, coins:coins.length, brickAt:[b.x,b.y], hits:hits, custom:coinSprite()===customCoin&&!!customCoin };
    }
  };
})());
`
