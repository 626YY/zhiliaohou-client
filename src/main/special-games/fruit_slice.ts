// 特色玩法「手势切水果」的页面内 Canvas 代码。
// 水果从左右两侧下方抛入划抛物线；按住拖动或快速挥动鼠标划出刀光把水果切成两半（「切水果方式」可改成只认按住拖动 / 划过就切），
// 没切到、掉出画面的水果按「漏掉的再抛几次」再抛，抛够了就不再抛。操作：add（水果：10 种之一或 random 每个随机）/ clear。
// ★2026-10-07 以前切开的水果没移出列表，飞出画面时也被当成漏掉重新入队——切多少都会抛回来，永远切不完（用户：「那个一直切不完啊」）。
// 素材：fruit_slice/<10 种>.png + slice.mp3。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','clear'];
  var TYPES=['apple','orange','watermelon','banana','strawberry','pineapple','kiwi','peach','pear','mango'];
  var JUICE={ apple:'#f5576c', orange:'#ffa53d', watermelon:'#ff4d5e', banana:'#ffe066', strawberry:'#ff6b81', pineapple:'#ffd43b', kiwi:'#94d82d', peach:'#ffc078', pear:'#c0eb75', mango:'#ffb84d' };
  var imgs={};
  var fruits=[];           // {type,x,y,vx,vy,g,angle,spin,px,state:'whole',born}
  var halves=[];           // {type,x,y,vx,vy,angle,spin,px,side}
  var juice=[];            // {x,y,vx,vy,color,r,life}
  var queue=[];            // 待抛出的水果 {type, tries}（tries = 已经漏掉重抛过几次）
  var spawnAt=0;
  var trail=[];            // 刀光轨迹 {x,y,t}
  var nowMs=0;
  var pressing=false, lastPt=null;
  var hov=null;             // 没按住时上一次鼠标位置 {x,y,t}（算挥动速度）
  var sliced=0, dropped=0;  // 切开的 / 漏够次数不再抛的（调试用）
  var MAXQ=1000000;        // 防爆夹紧：待抛队列上限（队列存的是水果种类，一项一个）

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function throwSpeed(){ return Math.max(20,Math.min(300,num(api.cfg.throwSpeed,100))); }
  function throwInterval(){ return Math.max(50,Math.min(2000,num(api.cfg.throwIntervalMs,150))); }
  // 怎么算切：both = 按住拖动或快速挥动（默认）；drag = 只认按住拖动；hover = 鼠标划过就切
  function sliceMode(){ var m=String(api.cfg.sliceMode||'both'); return (m==='drag'||m==='hover')?m:'both'; }
  // 不按住时鼠标多快算挥了一刀（窗口短边百分比 / 秒）
  function swipeSpeed(){ return Math.max(5,Math.min(300,num(api.cfg.swipeSpeed,30))); }
  function missRetry(){ return Math.max(0,Math.min(99,Math.trunc(num(api.cfg.missRetry,1)))); }
  function fruitPx(){ return Math.max(24, Math.min(api.W,api.H)*Math.max(5,Math.min(40,num(api.cfg.fruitSize,18)))/100); }

  function speedScale(){ return Math.max(0.2,Math.min(3, throwSpeed()/100)); }

  function spawnOne(item){
    var type=item.type;
    var W=api.W,H=api.H;
    var fromLeft=Math.random()<0.5;
    var sx=fromLeft? -0.07*W : 1.07*W;
    var sy=H*(0.62+Math.random()*0.28);
    var tx=W*(0.34+Math.random()*0.32);
    var ty=H*(0.2+Math.random()*0.3);
    var ss=speedScale();
    var travel=(0.72+Math.random()*0.30)/Math.sqrt(ss);
    var g=1.45*ss*H;   // 像素重力
    var vx=(tx-sx)/travel;
    var vy=(ty-sy-0.5*g*travel*travel)/travel;
    fruits.push({
      type:type, x:sx, y:sy, vx:vx, vy:vy, g:g,
      angle:(Math.random()*2-1)*0.44, spin:(Math.random()*2-1)*1.92,
      px:fruitPx(), state:'whole', tries:item.tries||0
    });
  }

  function sliceFruit(f, mx, my){
    f.state='sliced';
    sliced++;
    // 切割方向法线
    var len=Math.sqrt(mx*mx+my*my);
    var nx=len>1? -my/len : 1, ny=len>1? mx/len : 0;
    for(var side=-1;side<=1;side+=2){
      halves.push({
        type:f.type, x:f.x, y:f.y,
        vx:f.vx*0.6+nx*side*120, vy:f.vy*0.6+ny*side*120-60,
        g:f.g, angle:f.angle, spin:f.spin+side*2, px:f.px, side:side
      });
    }
    // 果汁粒子
    var col=JUICE[f.type]||'#ff6b6b';
    for(var i=0;i<14;i++){
      var a=Math.random()*6.2832, sp=40+Math.random()*180;
      juice.push({ x:f.x, y:f.y, vx:Math.cos(a)*sp+f.vx*0.3, vy:Math.sin(a)*sp+f.vy*0.3-40, color:col, r:2+Math.random()*4, life:0 });
    }
    ZL.snd('fruit_slice/slice.mp3');
  }

  // 点-线段距离
  function segDist(px,py,ax,ay,bx,by){
    var dx=bx-ax, dy=by-ay;
    var l2=dx*dx+dy*dy;
    var t=l2>0? ((px-ax)*dx+(py-ay)*dy)/l2 : 0;
    t=Math.max(0,Math.min(1,t));
    var qx=ax+dx*t, qy=ay+dy*t;
    return Math.sqrt((px-qx)*(px-qx)+(py-qy)*(py-qy));
  }

  function sliceAlong(ax,ay,bx,by){
    var mx=bx-ax, my=by-ay;
    for(var i=0;i<fruits.length;i++){
      var f=fruits[i];
      if(f.state!=='whole') continue;
      if(segDist(f.x,f.y,ax,ay,bx,by)<=f.px*0.5) sliceFruit(f, mx, my);
    }
  }

  // 「还剩 N 个水果没切」：走计数面板排位（api.hud），几个玩法同时在场时上下排开（以前固定画在 12,12，会和别的面板叠住）
  function drawCue(ctx){
    var left=queue.length;
    for(var i=0;i<fruits.length;i++) if(fruits[i].state==='whole') left++;
    var hctx=api.hudCtx||ctx;
    if(left<=0){ if(api.hud) api.hud(0); return; }
    var fs=Math.max(18,Math.min(32,api.W*0.025)), bh=fs*2.1;
    var top=api.hud?api.hud(bh):12;
    var text='还剩 '+left+' 个水果没切';
    hctx.save();
    hctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
    var tw=hctx.measureText(text).width;
    ZL.roundRect(hctx,12,top,tw+fs*1.6,bh,fs);
    hctx.fillStyle='rgba(20,22,28,0.66)'; hctx.fill();
    hctx.lineWidth=1.5; hctx.strokeStyle='rgba(255,255,255,0.16)'; hctx.stroke();
    hctx.textAlign='left'; hctx.textBaseline='middle';
    hctx.lineJoin='round'; hctx.lineWidth=Math.max(2,fs*0.14); hctx.strokeStyle='rgba(0,0,0,0.6)';
    hctx.strokeText(text,12+fs*0.8,top+bh/2);
    hctx.fillStyle='#fff'; hctx.fillText(text,12+fs*0.8,top+bh/2);
    hctx.restore();
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      for(var i=0;i<TYPES.length;i++) imgs[TYPES[i]]=ZL.img('fruit_slice/'+TYPES[i]+'.png');
    },
    resize:function(){},
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ fruits=[]; halves=[]; juice=[]; queue=[]; trail=[]; hov=null; return; }
      var n=Math.min(ZL.count(cmd,5), api.cap());
      var kind=String((cmd&&cmd.kind)||'random');
      if(TYPES.indexOf(kind)<0) kind='random';
      n=Math.min(n, MAXQ-queue.length);
      for(var i=0;i<n;i++) queue.push({ type:kind==='random'?TYPES[Math.floor(Math.random()*TYPES.length)]:kind, tries:0 });
      var name=ZL.who(cmd);
      if(name) api.banner(name+' 抛来 '+n+' 个水果');
    },
    pointer:function(type,x,y){
      var mode=sliceMode();
      if(type==='down'){ pressing=true; lastPt={x:x,y:y}; hov=null; return; }
      if(type==='up'){ pressing=false; lastPt=null; return; }
      if(type!=='move') return;
      // 这一下从哪划过来：按住时从上一个按住点；没按住时看挥得够不够快（划过就切模式不看速度）
      var from=null, t=performance.now();
      if(pressing){ if(lastPt) from=lastPt; lastPt={x:x,y:y}; }
      else if(mode!=='drag'&&hov&&t-hov.t<250){
        var dt=Math.max(1,t-hov.t)/1000, dx=x-hov.x, dy=y-hov.y;
        var spd=Math.sqrt(dx*dx+dy*dy)/Math.max(1,Math.min(api.W,api.H))*100/dt;
        if(mode==='hover'||spd>=swipeSpeed()) from=hov;
      }
      hov=pressing?null:{x:x,y:y,t:t};
      if(!from) return;
      sliceAlong(from.x,from.y,x,y);
      // 刀光只画真的在切的这一下，而且得有水果可切：清屏 / 切完以后鼠标在窗口上晃，画面上不该再冒出白线
      if(fruits.length>0||queue.length>0){
        var last=trail[trail.length-1];
        if(!last||nowMs-last.t>60) trail.push({x:from.x,y:from.y,t:nowMs});
        trail.push({x:x,y:y,t:nowMs});
        ZL.kick();
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      // 抛出节流
      if(queue.length>0 && nowMs>=spawnAt){
        spawnOne(queue.shift());
        spawnAt=nowMs+throwInterval();
      }
      var d=step/1000;
      var i;
      // 刀光过期
      for(i=trail.length-1;i>=0;i--) if(nowMs-trail[i].t>220) trail.splice(i,1);
      // 水果
      var active=queue.length>0||trail.length>0;
      for(i=fruits.length-1;i>=0;i--){
        var f=fruits[i];
        // 切开的整果交给两半去画，自己直接拿掉（以前留在列表里，飞出画面又被当成漏掉重抛）
        if(f.state!=='whole'){ fruits.splice(i,1); continue; }
        active=true;
        f.vy+=f.g*d;
        f.x+=f.vx*d; f.y+=f.vy*d;
        f.angle+=f.spin*d;
        if(f.y>=api.H*1.3 || f.x<-api.W*0.35 || f.x>api.W*1.35){
          // 没切到、掉出画面：按设置再抛几次，抛够了就不再抛（不然切不到的话永远抛不完）
          fruits.splice(i,1);
          if((f.tries||0)<missRetry()) queue.push({ type:f.type, tries:(f.tries||0)+1 });
          else dropped++;
        }
      }
      for(i=halves.length-1;i>=0;i--){
        var h=halves[i];
        active=true;
        h.vy+=h.g*d;
        h.x+=h.vx*d; h.y+=h.vy*d;
        h.angle+=h.spin*d;
        if(h.y>=api.H*1.32 || h.x<-api.W*0.4 || h.x>api.W*1.4) halves.splice(i,1);
      }
      for(i=juice.length-1;i>=0;i--){
        var j=juice[i];
        active=true;
        j.vy+=900*d;
        j.x+=j.vx*d; j.y+=j.vy*d;
        j.life+=d;
        if(j.life>0.7) juice.splice(i,1);
      }
      return active;
    },
    draw:function(ctx){
      var i;
      // 果汁
      for(i=0;i<juice.length;i++){
        var j=juice[i];
        ctx.save();
        ctx.globalAlpha=Math.max(0,1-j.life/0.7);
        ctx.fillStyle=j.color;
        ctx.beginPath(); ctx.arc(j.x,j.y,j.r,0,6.2832); ctx.fill();
        ctx.restore();
      }
      // 整果
      for(i=0;i<fruits.length;i++){
        var f=fruits[i];
        if(f.state!=='whole') continue;
        ctx.save();
        ctx.translate(f.x,f.y); ctx.rotate(f.angle);
        var im=imgs[f.type];
        if(ZL.imgOk(im)) ctx.drawImage(im,-f.px/2,-f.px/2,f.px,f.px);
        else { ctx.fillStyle=JUICE[f.type]||'#e66'; ctx.beginPath(); ctx.arc(0,0,f.px/2,0,6.2832); ctx.fill(); }
        ctx.restore();
      }
      // 半块（贴图左/右一半）
      for(i=0;i<halves.length;i++){
        var h=halves[i];
        ctx.save();
        ctx.translate(h.x,h.y); ctx.rotate(h.angle);
        var im2=imgs[h.type];
        if(ZL.imgOk(im2)){
          var sw=im2.naturalWidth, sh=im2.naturalHeight;
          var sx=h.side<0?0:sw/2;
          ctx.drawImage(im2, sx,0,sw/2,sh, -h.px/4, -h.px/2, h.px/2, h.px);
        }else{
          ctx.fillStyle=JUICE[h.type]||'#e66';
          ctx.fillRect(-h.px/4,-h.px/2,h.px/2,h.px);
        }
        ctx.restore();
      }
      // 刀光轨迹（0.22s 渐隐）
      if(trail.length>1){
        ctx.save();
        ctx.lineCap='round'; ctx.lineJoin='round';
        for(i=1;i<trail.length;i++){
          var a=(nowMs-trail[i].t)/220;
          var alpha=Math.max(0,1-a);
          ctx.strokeStyle='rgba(255,255,255,'+(alpha*0.9)+')';
          ctx.lineWidth=Math.max(2, 10*alpha);
          ctx.shadowColor='rgba(140,240,255,'+(alpha*0.8)+')';
          ctx.shadowBlur=12*alpha;
          ctx.beginPath();
          ctx.moveTo(trail[i-1].x, trail[i-1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
        ctx.restore();
      }
      drawCue(ctx);
    },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      var kinds={}, whole=[];
      for(var i=0;i<queue.length;i++) kinds[queue[i].type]=1;
      for(i=0;i<fruits.length;i++){ kinds[fruits[i].type]=1; if(fruits[i].state==='whole') whole.push([fruits[i].x,fruits[i].y,fruits[i].px]); }
      return { queued:queue.length, flying:fruits.length, whole:whole, sliced:sliced, dropped:dropped, kinds:Object.keys(kinds) };
    }
  };
})());
`
