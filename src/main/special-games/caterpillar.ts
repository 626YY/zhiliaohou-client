// 特色玩法「毛毛虫蠕动」的页面内 Canvas 代码。
// 纯代码绘制的毛毛虫（径向渐变圆节 + 正弦蠕动）满屏随机爬行；点击后拖鞋从右上拍下（0.36s）、
// 第 150ms 播拍击声、虫子坠落出屏；30s 自动掉落（可调，0=不自动）。累计拍死数持久化。
// 操作：add（颜色：config=按玩法设置 / random=每条随机 / 九色之一）/ clear 清场 / reset 累计清零。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','clear','reset'];
  var COLORS={ green:['#8eda0d','#5d9408'], red:['#e54848','#a82e2e'], orange:['#f28a28','#b8630f'], yellow:['#e8c52e','#a88c14'], cyan:['#29c9c9','#1a8f8f'], blue:['#4389ed','#2658ad'], purple:['#9459de','#6736a3'], pink:['#e66bb1','#ad4480'], white:['#e3e9ed','#9aa7b0'] };
  var COLOR_IDS=['green','red','orange','yellow','cyan','blue','purple','pink','white'];
  var worms=[];            // {x,y,heading,speed,turnAt,color,born,striking,falling,vy,rot,rotV,alpha}
  var slippers=[];         // {x,y,w,h,t0} 拖鞋特效
  var pending=null;        // 待出场队列（按批合并，opt={color}）
  var caught=0;
  var nowMs=0;
  var slipperImg=null;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function sizePct(){ return Math.max(50,Math.min(180,num(api.cfg.sizePercent,100)))/100; }
  function speedPct(){ return Math.max(30,Math.min(200,num(api.cfg.speedPercent,100)))/100; }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,100))); }
  function autoDropMs(){ return Math.max(0,num(api.cfg.autoDropSeconds,30))*1000; }
  function segR(){ return Math.min(api.W,api.H)*0.021*sizePct(); }
  // 颜色选项 → 九色之一：config 用玩法设置，random 每条随机
  function colorFor(opt){
    var c=opt&&opt.color;
    if(c==='random') return COLOR_IDS[Math.floor(Math.random()*COLOR_IDS.length)];
    if(COLORS[c]) return c;
    var cfgColor=String(api.cfg.caterpillarColor||'green');
    return COLORS[cfgColor]?cfgColor:'green';
  }
  function sameOpt(a,b){ return a.color===b.color; }

  function makeWorm(opt){
    var m=60;
    return {
      x:m+Math.random()*Math.max(1,api.W-m*2), y:m+Math.random()*Math.max(1,api.H-m*2),
      heading:Math.random()*6.2832,
      speed:Math.min(api.W,api.H)*0.055*speedPct(),
      turnAt:nowMs+800+Math.random()*1600,
      color:COLORS[colorFor(opt)],
      born:nowMs,
      striking:false, falling:false, vy:0, rot:0, rotV:0, alpha:1, phase:Math.random()*6.28
    };
  }

  // 虫体各节中心（从头往后，带蠕动横向偏移）
  function segments(w){
    var r=segR(), gap=r*1.05, n=9;
    var dx=Math.cos(w.heading), dy=Math.sin(w.heading);
    var px=-dy, py=dx;   // 垂直方向
    var out=[];
    var t=nowMs/1000;
    for(var i=0;i<n;i++){
      var back=i*gap;
      var sway=Math.sin(t*6+w.phase+i*0.75)*r*0.34*(i/n+0.25);
      out.push([w.x-dx*back+px*sway, w.y-dy*back+py*sway, r*(1.12-i*0.045)]);
    }
    return out;
  }

  function drawWorm(ctx,w){
    var segs=segments(w);
    var r=segR();
    ctx.save();
    ctx.globalAlpha*=w.alpha;
    // 从尾到头画（头在最上）
    for(var i=segs.length-1;i>=0;i--){
      var s=segs[i], rr=s[2];
      var g=ctx.createRadialGradient(s[0]-rr*0.35,s[1]-rr*0.4,rr*0.15, s[0],s[1],rr);
      g.addColorStop(0,w.color[0]);
      g.addColorStop(1,w.color[1]);
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(s[0],s[1],rr,0,6.2832); ctx.fill();
    }
    // 头上的眼睛
    var head=segs[0];
    var dx=Math.cos(w.heading), dy=Math.sin(w.heading);
    var px=-dy, py=dx;
    var ex=head[0]+dx*r*0.72, ey=head[1]+dy*r*0.72;
    for(var side=-1;side<=1;side+=2){
      var exx=ex+px*side*r*0.42, eyy=ey+py*side*r*0.42;
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(exx,eyy,r*0.30,0,6.2832); ctx.fill();
      ctx.fillStyle='#151515';
      ctx.beginPath(); ctx.arc(exx+dx*r*0.1,eyy+dy*r*0.1,r*0.16,0,6.2832); ctx.fill();
    }
    // 触角
    ctx.strokeStyle=w.color[1]; ctx.lineWidth=Math.max(1.5,r*0.1); ctx.lineCap='round';
    for(var a=-1;a<=1;a+=2){
      ctx.beginPath();
      ctx.moveTo(head[0]+dx*r*0.8+px*a*r*0.3, head[1]+dy*r*0.8+py*a*r*0.3);
      ctx.lineTo(head[0]+dx*r*1.5+px*a*r*0.62, head[1]+dy*r*1.5+py*a*r*0.62);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 拖鞋特效（复刻手机版公式）：层宽 w×1.35、高×1.25，0.36s
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

  function drawStats(ctx){
    var fs=Math.max(13,Math.min(20,api.W*0.016));
    var lines=['已抓毛毛虫：'+caught+' 条','尚未出现：'+pending.total+' 条'];
    ctx.save();
    ctx.font='600 '+fs+'px "Microsoft YaHei",sans-serif';
    var w=0,i;
    for(i=0;i<lines.length;i++) w=Math.max(w,ctx.measureText(lines[i]).width);
    var padX=fs*0.9,padY=fs*0.55,lh=fs*1.5;
    ZL.roundRect(ctx,10,10,w+padX*2,lines.length*lh+padY*2-lh*0.5,12);
    ctx.fillStyle='rgba(20,22,28,0.66)'; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='middle';
    for(i=0;i<lines.length;i++){
      var ly=10+padY+i*lh+lh*0.32;
      ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.14); ctx.strokeStyle='rgba(0,0,0,0.6)';
      ctx.strokeText(lines[i],10+padX,ly);
      ctx.fillStyle='#fff'; ctx.fillText(lines[i],10+padX,ly);
    }
    ctx.restore();
  }

  function strike(w){
    if(w.striking||w.falling) return;
    w.striking=true;
    var r=segR();
    slippers.push({ x:w.x, y:w.y, w:r*2*9, h:r*2*9, t0:nowMs });
    w.strikeAt=nowMs+150;
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      pending=ZL.queue();
      slipperImg=ZL.img('xiaoxin/xiaoxin_slipper.png');
      caught=ZL.loadTotal('caterpillar');
    },
    resize:function(){},
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ worms=[]; slippers=[]; pending.clear(); return; }
      if(op==='reset'){ caught=0; ZL.saveTotal('caterpillar',0); return; }
      var n=Math.min(ZL.count(cmd,5), api.cap());
      var color=String((cmd&&cmd.color)||'config');
      pending.push(Math.min(n, 999999999-pending.total), { color:color }, sameOpt);
      var name=ZL.who(cmd);
      if(name) api.banner(name+' 放出 '+n+' 条毛毛虫');
    },
    pointer:function(type,x,y){
      if(type!=='down') return;
      // 逆序找被点中的虫（任一节的命中圆）
      for(var i=worms.length-1;i>=0;i--){
        var w=worms[i];
        if(w.striking||w.falling) continue;
        var segs=segments(w);
        var hit=false;
        for(var s=0;s<segs.length;s++){
          var dx=x-segs[s][0], dy=y-segs[s][1];
          if(dx*dx+dy*dy <= segs[s][2]*segs[s][2]*1.4){ hit=true; break; }
        }
        if(hit){ strike(w); return; }
      }
    },
    tick:function(dt){
      var step=Math.min(80,dt)*api.speed();
      nowMs+=step;
      // 补虫（每帧一条，同屏上限内）
      if(pending.total>0 && worms.length<maxVisible()){
        worms.push(makeWorm(pending.take()));
      }
      var active=pending.total>0||slippers.length>0;
      var now=nowMs;
      for(var i=worms.length-1;i>=0;i--){
        var w=worms[i];
        // 拖鞋拍到 150ms 后开始坠落
        if(w.striking && !w.falling && now>=w.strikeAt){
          w.falling=true; w.vy=70; w.rotV=(Math.random()<0.5?-1:1)*(2+Math.random()*3);
          ZL.snd('xiaoxin/xiaoxin_slap.wav');
          caught++; ZL.saveTotal('caterpillar',caught);
        }
        // 自动掉落
        var ad=autoDropMs();
        if(!w.falling && !w.striking && ad>0 && now-w.born>ad){ w.falling=true; w.vy=70; w.rotV=2; }
        if(w.falling){
          active=true;
          w.vy+=api.H*2.4*step/1000;
          w.y+=w.vy*step/1000;
          w.rot+=w.rotV*step/1000;
          if(w.y-segR()*2>api.H+80){ worms.splice(i,1); }
          continue;
        }
        active=true;
        // 爬行
        if(now>=w.turnAt){ w.turnAt=now+800+Math.random()*1600; w.heading+=(Math.random()*2-1)*0.7; }
        // 靠边回中
        var m=segR()*3;
        if(w.x<m) w.heading+=(0-w.heading)*0.08+0.05;
        if(w.x>api.W-m) w.heading+=(Math.PI-w.heading)*0.08;
        if(w.y<m) w.heading+=(Math.PI/2-w.heading)*0.08+0.03;
        if(w.y>api.H-m) w.heading+=(-Math.PI/2-w.heading)*0.08;
        w.x+=Math.cos(w.heading)*w.speed*step/1000;
        w.y+=Math.sin(w.heading)*w.speed*step/1000;
        w.x=Math.max(m*0.4,Math.min(api.W-m*0.4,w.x));
        w.y=Math.max(m*0.4,Math.min(api.H-m*0.4,w.y));
      }
      return active;
    },
    draw:function(ctx){
      for(var i=0;i<worms.length;i++){
        var w=worms[i];
        ctx.save();
        if(w.rot){ ctx.translate(w.x,w.y); ctx.rotate(w.rot); ctx.translate(-w.x,-w.y); }
        drawWorm(ctx,w);
        ctx.restore();
      }
      drawSlippers(ctx);
      drawStats(ctx);
    },
    stats:function(){ return { value:caught }; },
    // 只读调试钩子（离线验收用，生产不调用）：可点的虫头位置 + 场上颜色
    debug:function(){
      var hits=[], colors={};
      for(var i=0;i<worms.length;i++){
        var w=worms[i];
        colors[w.color[0]]=1;
        if(!w.striking&&!w.falling) hits.push([w.x,w.y,segR()]);
      }
      return { pending:pending.total, count:worms.length, caught:caught, hits:hits, colors:Object.keys(colors) };
    }
  };
})());
`
