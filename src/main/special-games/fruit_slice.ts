// 特色玩法「手势切水果」的页面内 Canvas 代码。
// 水果从左右两侧下方抛入划抛物线；按住拖动（或快速挥动）鼠标划出刀光把水果切成两半，
// 漏掉落地的水果会重新入队再抛，直到全部切完。操作：add（水果：10 种之一或 random 每个随机）/ clear。
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
  var queue=[];            // 待抛出水果类型队列
  var spawnAt=0;
  var trail=[];            // 刀光轨迹 {x,y,t}
  var nowMs=0;
  var pressing=false, lastPt=null;
  var MAXQ=1000000;        // 防爆夹紧：待抛队列上限（队列存的是水果种类，一项一个）

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function throwSpeed(){ return Math.max(20,Math.min(300,num(api.cfg.throwSpeed,100))); }
  function throwInterval(){ return Math.max(50,Math.min(2000,num(api.cfg.throwIntervalMs,150))); }
  function fruitPx(){ return Math.max(24, Math.min(api.W,api.H)*Math.max(5,Math.min(40,num(api.cfg.fruitSize,18)))/100); }

  function speedScale(){ return Math.max(0.2,Math.min(3, throwSpeed()/100)); }

  function spawnOne(type){
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
      px:fruitPx(), state:'whole'
    });
  }

  function sliceFruit(f, mx, my){
    f.state='sliced';
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

  function drawCue(ctx){
    var left=queue.length;
    for(var i=0;i<fruits.length;i++) if(fruits[i].state==='whole') left++;
    if(left<=0) return;
    var fs=Math.max(18,Math.min(32,api.W*0.025));
    var text='还剩 '+left+' 个水果没切';
    ctx.save();
    ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
    var tw=ctx.measureText(text).width;
    ZL.roundRect(ctx,12,12,tw+fs*1.6,fs*2.1,fs);
    ctx.fillStyle='rgba(20,22,28,0.66)'; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.14); ctx.strokeStyle='rgba(0,0,0,0.6)';
    ctx.strokeText(text,12+fs*0.8,12+fs*1.08);
    ctx.fillStyle='#fff'; ctx.fillText(text,12+fs*0.8,12+fs*1.08);
    ctx.restore();
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
      if(op==='clear'){ fruits=[]; halves=[]; juice=[]; queue=[]; trail=[]; return; }
      var n=Math.min(ZL.count(cmd,5), api.cap());
      var kind=String((cmd&&cmd.kind)||'random');
      if(TYPES.indexOf(kind)<0) kind='random';
      n=Math.min(n, MAXQ-queue.length);
      for(var i=0;i<n;i++) queue.push(kind==='random'?TYPES[Math.floor(Math.random()*TYPES.length)]:kind);
      var name=ZL.who(cmd);
      if(name) api.banner(name+' 抛来 '+n+' 个水果');
    },
    pointer:function(type,x,y){
      if(type==='down'){ pressing=true; lastPt={x:x,y:y}; }
      else if(type==='up'){ pressing=false; lastPt=null; }
      else if(type==='move'){
        if(lastPt){ sliceAlong(lastPt.x,lastPt.y,x,y); }
        if(pressing) lastPt={x:x,y:y};
        trail.push({x:x,y:y,t:nowMs});
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
        active=true;
        f.vy+=f.g*d;
        f.x+=f.vx*d; f.y+=f.vy*d;
        f.angle+=f.spin*d;
        if(f.y>=api.H*1.3 || f.x<-api.W*0.35 || f.x>api.W*1.35){
          // 漏掉落地：重新入队
          fruits.splice(i,1);
          queue.push(f.type);
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
      var kinds={};
      for(var i=0;i<queue.length;i++) kinds[queue[i]]=1;
      for(i=0;i<fruits.length;i++) kinds[fruits[i].type]=1;
      return { queued:queue.length, flying:fruits.length, kinds:Object.keys(kinds) };
    }
  };
})());
`
