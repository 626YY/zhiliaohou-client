// 特色玩法「扔垃圾」的页面内 Canvas 代码。
// 30 种生活垃圾从屏外抛物线飞入 → 阻尼弹跳 0.38s → 黏住；主播拖进底部居中的垃圾桶收掉。
// 操作：add（大小 big/small/random + 种类 30 选 1 或 random）/ clear 清场 / reset 累计清零。
// 素材：throw_trash/<30 种>.png + throw.mp3（飞入）+ collect.mp3（进桶）。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','clear','reset'];
  var TRASH=['cola_plastic','cola_glass','water_bottle','beer_can','old_shoe','snack_wrapper','food_package','chocolate_bar','crackers','sandwich_cookies','burger','fish_burger','pizza','fried_egg','egg','broccoli_stem','vegetable_scraps','dried_banana','bell_pepper','avocado','ginger_root','tofu_piece','bread_slice','cookie','marshmallow','chocolate_candy','jelly_candy','coconut_ball','wafer_bar','assorted_candies'];
  var LEGACY={oreo_cookies:'sandwich_cookies',raffaello:'coconut_ball',kinder_bueno:'wafer_bar'};
  var items=[];            // {id,img,size,x,y,angle,phase,sx,sy,tx,ty,vx,vy,g,travel,started,bounceT,sounded}
  var pending=null;        // 待生成队列（按批合并，opt={size,kind}）
  var nextLaunchAt=0, batchClock=0;
  var collected=0;         // 累计进桶（持久）
  var dragIdx=-1, dragDX=0, dragDY=0;
  var nowMs=0;
  var binA=0, binUsed=false; // 垃圾桶淡入淡出（0~1）/ 扔过没有（「一直显示」用）
  var BIN_FADE_MS=300;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function pct(v,d){ return Math.max(5,Math.min(100,num(v,d))); }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,300))); }
  function spawnInterval(){ return Math.max(10,num(api.cfg.spawnIntervalMs,100)); }
  function binPct(){ return Math.max(10,Math.min(60,num(api.cfg.binSizePercent,45))); }
  // 大小选项 → 窗口短边百分比
  function sizeFor(size){
    return ZL.sizePct(size, pct(api.cfg.bigTrashSize,14), pct(api.cfg.smallTrashSize,8), pct(api.cfg.randomSizeMin,8), pct(api.cfg.randomSizeMax,14));
  }
  function sameOpt(a,b){ return a.size===b.size&&a.kind===b.kind; }

  // 垃圾桶矩形：宽=clamp(100, 窗口宽*60%, 窗口宽*bin%)，高=宽*1.15，底部居中，底距 max(12, 3.5%H)
  function binRect(){
    var W=api.W,H=api.H;
    var bw=Math.max(100,Math.min(W*0.6, W*binPct()/100));
    var bh=bw*1.15;
    return { x:(W-bw)/2, y:Math.max(0,H-bh-Math.max(12,H*0.035)), w:bw, h:bh };
  }

  function chooseTarget(size){
    var W=api.W,H=api.H,m=3;
    var best=null,bestD=-1e9;
    var bin=binRect();
    for(var i=0;i<60;i++){
      var x=m+size/2+Math.random()*Math.max(1,W-size-m*2);
      var y=size/2+Math.random()*Math.max(1,H*0.66-size);
      // 别落在垃圾桶里
      if(x>bin.x-size && x<bin.x+bin.w+size && y>bin.y-size){ continue; }
      var d=1e9;
      for(var j=0;j<items.length;j++){
        var it=items[j];
        var dx=it.tx-x,dy=it.ty-y,dd=Math.sqrt(dx*dx+dy*dy)-(it.size+size)*0.4;
        if(dd<d)d=dd;
      }
      if(d>=0){ best={x:x,y:y}; break; }
      if(d>bestD){ bestD=d; best={x:x,y:y}; }
    }
    if(best) return best;
    // 随机位置全落在桶上（大垃圾 + 大桶时会这样）：贴在桶左右更宽的一侧，别放到桶后面被挡住看不见
    var leftW=bin.x, rightW=W-(bin.x+bin.w);
    var fx=leftW>=rightW? Math.max(size/2+m, leftW/2) : Math.min(W-size/2-m, bin.x+bin.w+rightW/2);
    return { x:fx, y:size/2+Math.random()*Math.max(1,H*0.66-size) };
  }

  function makeItem(opt){
    var base=Math.min(api.W,api.H);
    var size=Math.max(28,Math.min(300,Math.round(base*sizeFor(opt&&opt.size)/100)));
    var kind=opt&&opt.kind;
    var id=TRASH.indexOf(kind)>=0?kind:TRASH[Math.floor(Math.random()*TRASH.length)];
    var img=ZL.img('throw_trash/'+id+'.png');
    var t=chooseTarget(size);
    var edge=Math.random(), sx,sy;
    if(edge<0.55){ sx=Math.random()*api.W; sy=-size; }
    else if(edge<0.78){ sx=-size; sy=Math.random()*api.H*0.4; }
    else { sx=api.W+size; sy=Math.random()*api.H*0.4; }
    var travel=0.55+Math.random()*0.3;
    var g=api.H*(1.6+Math.random()*0.8);
    var vx=(t.x-sx)/travel;
    var vy=(t.y-sy-0.5*g*travel*travel)/travel;
    return {
      id:id, img:img, size:size, tx:t.x, ty:t.y, sx:sx, sy:sy, x:sx, y:sy,
      vx:vx, vy:vy, g:g, travel:travel, started:nextLaunchAt,
      angle:0, spin:(Math.random()*2-1)*5, landAngle:(Math.random()*2-1)*1.2,
      phase:'wait', bounceT:0, sounded:false
    };
  }

  function flushQueue(){
    var avail=Math.max(0, maxVisible()-items.length);
    var batch=Math.min(pending.total, 50, avail);
    if(batch<=0) return;
    var now=nowMs/1000;
    nextLaunchAt=Math.max(nextLaunchAt, now);
    for(var i=0;i<batch;i++){
      items.push(makeItem(pending.take()));
      nextLaunchAt+=spawnInterval()/1000;
    }
  }

  // 计数面板：一直显示 / 场上有东西时显示（默认）/ 不显示——好几个玩法同在一个窗口，用过的面板别一直堆在左上角
  function statsShown(){ var m=String(api.cfg.statsPanel||'active'); if(m==='off') return false; if(m==='always') return true; return items.length>0||(!!pending&&pending.total>0); }
  function drawStats(ctx){
    if(!statsShown()){ if(api.hud) api.hud(0); return; }
    var fs=Math.max(13,Math.min(20,api.W*0.016));
    // 尚未出现 = 还在排队的 + 已经排进场、还没飞进来的
    var waiting=pending.total;
    for(var wi=0;wi<items.length;wi++) if(items[wi].phase==='wait') waiting++;
    var lines=['已进桶：'+collected+' 件','尚未出现：'+waiting+' 件'];
    ctx.save();
    ctx.font='600 '+fs+'px "Microsoft YaHei",sans-serif';
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
      ctx.strokeText(lines[i],10+padX,ly);
      ctx.fillStyle='#fff'; ctx.fillText(lines[i],10+padX,ly);
    }
    ctx.restore();
  }

  // 垃圾桶什么时候在画面上：默认有垃圾（场上 / 待飞入 / 正拖着）才淡入、收完淡出；
  // 「用过就一直显示」= 扔过一次就留着。全部清屏（wipe）一律立刻收起。
  function binWanted(){
    if(String(api.cfg.binShow||'active')==='always'&&binUsed) return true;
    return items.length>0||pending.total>0||dragIdx>=0;
  }

  // 代码画垃圾桶（浅灰桶身+深色椭圆桶口）
  function drawBin(ctx){
    var b=binRect();
    ctx.save();
    if(binA<1) ctx.globalAlpha*=binA;
    ctx.translate(b.x,b.y);
    var w=b.w,h=b.h;
    // 桶身
    ZL.roundRect(ctx, w*0.12, h*0.18, w*0.76, h*0.77, w*0.08);
    ctx.fillStyle='rgba(214,219,221,0.96)'; ctx.fill();
    ctx.lineWidth=Math.max(2,w*0.025); ctx.strokeStyle='rgba(72,78,82,0.96)'; ctx.stroke();
    // 桶口
    ctx.beginPath(); ctx.ellipse(w*0.5, h*0.205, w*0.44, h*0.125, 0, 0, 6.2832);
    ctx.fillStyle='rgba(28,29,30,0.99)'; ctx.fill();
    ctx.lineWidth=Math.max(1.5,w*0.02); ctx.strokeStyle='rgba(5,5,5,0.96)'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(w*0.5, h*0.205, w*0.34, h*0.085, 0, 0, 6.2832);
    ctx.fillStyle='rgba(48,49,50,0.96)'; ctx.fill();
    // 桶身竖棱
    ctx.strokeStyle='rgba(72,78,82,0.35)'; ctx.lineWidth=Math.max(1.5,w*0.012);
    for(var i=0;i<4;i++){
      var lx=w*(0.28+i*0.147);
      ctx.beginPath(); ctx.moveTo(lx,h*0.3); ctx.lineTo(lx,h*0.86); ctx.stroke();
    }
    ctx.restore();
  }

  function itemAt(x,y){
    for(var i=items.length-1;i>=0;i--){
      var it=items[i];
      if(it.phase==='wait'||it.phase==='dragging') continue;
      var half=Math.ceil(it.size*Math.SQRT2)+8;
      if(Math.abs(x-it.x)<=half/2 && Math.abs(y-it.y)<=half/2) return i;
    }
    return -1;
  }

  function drawItem(ctx,it){
    var im=it.img;
    var ok=ZL.imgOk(im);
    ctx.save();
    ctx.translate(it.x,it.y); ctx.rotate(it.angle);
    if(ok){
      var wh=ZL.fit(im,it.size);
      ctx.drawImage(im,-wh[0]/2,-wh[1]/2,wh[0],wh[1]);
    }else{
      ctx.fillStyle='#7a6a55';
      ctx.fillRect(-it.size/2,-it.size/2,it.size,it.size);
    }
    ctx.restore();
  }

  return {
    init:function(a){ api=a; ZL.bind(a); pending=ZL.queue(); collected=ZL.loadTotal('throw_trash'); },
    // 改窗口大小（一键切竖屏）：场上的垃圾挪回画面里（桶按新尺寸自己算）
    resize:function(){
      for(var i=0;i<items.length;i++){
        var it=items[i], h=it.size/2;
        it.tx=ZL.clamp(it.tx,h,Math.max(h,api.W-h));
        it.ty=ZL.clamp(it.ty,h,Math.max(h,api.H-h));
        if(it.phase==='settled'){ it.x=it.tx; it.y=it.ty; }
      }
    },
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      // 发射排期一起清零：不然清空后下一波要按清空前排好的时间等
      if(op==='clear'){ items=[]; pending.clear(); dragIdx=-1; nextLaunchAt=0; batchClock=0; if(cmd&&cmd.wipe){ binA=0; binUsed=false; } return; }
      if(op==='reset'){ collected=0; ZL.saveTotal('throw_trash',0); return; }
      binUsed=true;
      var n=Math.min(ZL.count(cmd,5), api.cap());
      var size=String((cmd&&cmd.size)||'random');
      var kind=String((cmd&&cmd.kind)||'random');
      kind=LEGACY[kind]||kind;   // 改过名的老种类（去掉了品牌名）
      if(TRASH.indexOf(kind)<0) kind='random';
      var was=pending.total;
      pending.push(Math.min(n, 999999999-pending.total), { size:size, kind:kind }, sameOpt);
      // 攒批：队列从空变成有东西才开始计时，之后再来礼物不清零（以前每来一次都清零，礼物间隔短于 1.2 秒、场上又没清空时，排队的一直不落）
      if(was===0) batchClock=0;
      var name=ZL.who(cmd);
      if(name) api.banner(name+' 扔来 '+n+' 件垃圾');
    },
    pointer:function(type,x,y){
      if(type==='down'){
        var i=itemAt(x,y);
        if(i>=0){
          var it=items[i];
          dragDX=x-it.x; dragDY=y-it.y;
          it.phase='dragging';
          // 提到最上层
          items.splice(i,1); items.push(it); dragIdx=items.length-1;
          return true;
        }
      } else if(type==='move'){
        if(dragIdx>=0){
          var it2=items[dragIdx];
          // 拖到窗口外也只停在边上（以前拖出去松手，垃圾就留在窗外拖不回来，桶也永远不消失）
          if(it2){ it2.x=ZL.clamp(x-dragDX,it2.size/2,Math.max(it2.size/2,api.W-it2.size/2)); it2.y=ZL.clamp(y-dragDY,it2.size/2,Math.max(it2.size/2,api.H-it2.size/2)); }
        }
      } else if(type==='up'){
        if(dragIdx>=0){
          var it3=items[dragIdx];
          dragIdx=-1;
          if(it3){
            var b=binRect();
            if(it3.x>b.x && it3.x<b.x+b.w && it3.y>b.y && it3.y<b.y+b.h){
              // 进桶
              var k=items.indexOf(it3); if(k>=0) items.splice(k,1);
              collected++; ZL.saveTotal('throw_trash',collected);
              ZL.snd('throw_trash/collect.mp3');
            } else {
              it3.phase='settled'; it3.tx=it3.x; it3.ty=it3.y;
            }
          }
          ZL.kick();
        }
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      var now=nowMs/1000;
      batchClock+=step;
      if(pending.total>0 && (batchClock>=1200 || items.length===0)){ batchClock=0; flushQueue(); }
      var active=pending.total>0 || dragIdx>=0;
      var i,it;
      for(i=0;i<items.length;i++){
        it=items[i];
        if(it.phase==='wait'){
          if(now>=it.started){
            it.phase='flying'; it.t0=now; it.x=it.sx; it.y=it.sy;
            if(!it.sounded){ it.sounded=true; ZL.snd('throw_trash/throw.mp3'); }
          } else { active=true; continue; }
        }
        if(it.phase==='flying'){
          active=true;
          var t=now-it.t0;
          if(t>=it.travel){ it.phase='bouncing'; it.bounceT=0; it.x=it.tx; it.y=it.ty; }
          else{
            it.x=it.sx+it.vx*t;
            it.y=it.sy+it.vy*t+0.5*it.g*t*t;
            it.angle+=it.spin*step/1000;
          }
        } else if(it.phase==='bouncing'){
          active=true;
          it.bounceT+=step/1000;
          var b=it.bounceT;
          if(b>=0.38){ it.phase='settled'; it.x=it.tx; it.y=it.ty; it.angle=it.landAngle; }
          else{
            var decay=Math.exp(-8*b), s=Math.sin(16*b);
            it.x=it.tx+it.vx*0.045*decay*s;
            it.y=it.ty+it.vy*0.045*decay*s;
          }
        } else if(it.phase==='dragging'){
          active=true;
        }
      }
      var want=binWanted()?1:0;
      if(binA!==want){
        binA=want>binA?Math.min(1,binA+step/BIN_FADE_MS):Math.max(0,binA-step/BIN_FADE_MS);
        active=true;
      }
      return active;
    },
    draw:function(ctx){
      var i;
      for(i=0;i<items.length;i++){
        var it=items[i];
        if(it.phase==='wait'||it.phase==='dragging') continue;
        drawItem(ctx,it);
      }
      if(binA>0.004) drawBin(ctx);
      if(dragIdx>=0&&items[dragIdx]) drawItem(ctx,items[dragIdx]);
      drawStats(api.hudCtx||ctx);
    },
    stats:function(){ return { value:collected }; },
    // 只读调试钩子（离线验收用，生产不调用）：可拖的垃圾中心点 + 桶中心
    debug:function(){
      var hits=[], kinds={};
      for(var i=0;i<items.length;i++){
        kinds[items[i].id]=1;
        if(items[i].phase==='settled') hits.push([items[i].x,items[i].y,items[i].size]);
      }
      var b=binRect();
      return { pending:pending.total, count:items.length, collected:collected, hits:hits, drop:[b.x+b.w/2,b.y+b.h/2], kinds:Object.keys(kinds), bin:binA };
    }
  };
})());
`
