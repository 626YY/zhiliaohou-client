// 特色玩法「扔粑粑」的页面内 Canvas 代码。
// 粑粑从屏外抛物线飞入 → 落地阻尼弹跳 0.38s → 永久黏住；主播点一下就清掉（累计落盘）。
// 操作：add（大小：big/small/random）/ clear 清场 / reset 累计清零。
// 素材：throw_poop/default.png + throw.mp3（cfg.customImage / customSound 可换本地文件，走 api.fileUrl）。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','clear','reset'];
  var items=[];            // {x,y,size,rot,rotV,sx,sy,tx,ty,vx,vy,g,travel,started,phase} phase: wait/fly/bounce/landed
  var pending=null;        // 待生成队列（按批合并，opt={size}）
  var nextLaunchAt=0;      // 下一件最早生成时刻（spawn_interval 节流，跨批推进）
  var batchClock=0;        // 批次间隔计时（1.2s 一批）
  var caught=0;            // 累计已清理（localStorage 持久）
  var poopImg=null, customImg=null, customImgPath='';
  var nowMs=0;             // 本地时钟（随 tick 推进，含速度倍率）

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function pct(v,d){ return Math.max(5,Math.min(400,num(v,d))); }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,300))); }
  function spawnInterval(){ return Math.max(10,num(api.cfg.spawnIntervalMs,100)); }
  // 大小选项 → 窗口短边百分比
  function sizeFor(size){
    return ZL.sizePct(size, pct(api.cfg.bigPoopSize,14), pct(api.cfg.smallPoopSize,8), pct(api.cfg.randomSizeMin,8), pct(api.cfg.randomSizeMax,14));
  }
  function sameOpt(a,b){ return a.size===b.size; }

  // 自定义粑粑图：路径变了才重新加载（加载完叫醒一帧，静止画面也能换上新图）
  function syncCustom(){
    var p=String(api.cfg.customImage||'').trim();
    if(p===customImgPath) return;
    customImgPath=p;
    customImg=p?ZL.imgRaw(p):null;
    if(customImg&&!customImg.complete) customImg.addEventListener('load',ZL.kick);
  }
  function sprite(){
    // 自定义图加载失败（complete 但没像素）就退回内置
    if(customImg&&!(customImg.complete&&!ZL.imgOk(customImg))) return customImg;
    return poopImg;
  }

  // 选落点：随机 60 个候选，取与既有落点间距最大的（防堆叠），偏上半屏
  function chooseTarget(size){
    var W=api.W,H=api.H,m=3;
    var best=null,bestD=-1e9,i;
    for(i=0;i<60;i++){
      var x=m+size/2+Math.random()*Math.max(1,W-size-m*2);
      var y=size/2+Math.random()*Math.max(1,H*0.72-size);
      var d=1e9;
      for(var j=0;j<items.length;j++){
        var it=items[j];
        var dx=it.tx-x,dy=it.ty-y,dd=Math.sqrt(dx*dx+dy*dy)-(it.size+size)*0.4;
        if(dd<d)d=dd;
      }
      if(d>=0){ best={x:x,y:y}; break; }
      if(d>bestD){ bestD=d; best={x:x,y:y}; }
    }
    return best||{x:W/2,y:H/3};
  }

  function makeItem(opt){
    var base=Math.min(api.W,api.H);
    var size=Math.max(28,Math.round(base*sizeFor(opt&&opt.size)/100));
    var t=chooseTarget(size);
    // 起点：顶部外 55% / 左外 / 右外
    var edge=Math.random(), sx,sy;
    if(edge<0.55){ sx=Math.random()*api.W; sy=-size; }
    else if(edge<0.78){ sx=-size; sy=Math.random()*api.H*0.4; }
    else { sx=api.W+size; sy=Math.random()*api.H*0.4; }
    var travel=0.55+Math.random()*0.3;
    var g=api.H*(1.6+Math.random()*0.8);
    var vx=(t.x-sx)/travel;
    var vy=(t.y-sy-0.5*g*travel*travel)/travel;
    return {
      size:size, tx:t.x, ty:t.y, sx:sx, sy:sy, x:sx, y:sy,
      vx:vx, vy:vy, g:g, travel:travel, started:nextLaunchAt,
      rot:0, rotV:(Math.random()*2-1)*7, landRot:(Math.random()*2-1)*0.6,
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
    // 尚未出现 = 还在排队的 + 已经排进场、还没起飞的（以前只算排队的，面板显示 0 粑粑还在一个个飞进来）
    var waiting=pending.total;
    for(var wi=0;wi<items.length;wi++) if(items[wi].phase==='wait') waiting++;
    var lines=['已抓粑粑：'+caught+' 个','尚未出现：'+waiting+' 个'];
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

  // 命中盒 = ceil(size*√2)+6 见方（旋转外接盒+余量），后生成的在上层先命中
  function hit(x,y){
    for(var i=items.length-1;i>=0;i--){
      var it=items[i];
      if(it.phase==='wait') continue;
      var half=Math.ceil(it.size*Math.SQRT2)+6;
      if(Math.abs(x-it.x)<=half/2 && Math.abs(y-it.y)<=half/2) return i;
    }
    return -1;
  }

  function throwSnd(){
    var cs=String(api.cfg.customSound||'').trim();
    if(cs) ZL.sndRaw(cs); else ZL.snd('throw_poop/throw.mp3');
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      pending=ZL.queue();
      poopImg=ZL.img('throw_poop/default.png');
      caught=ZL.loadTotal('throw_poop');
      syncCustom();
    },
    // 改窗口大小（一键切竖屏）：场上的粑粑挪回画面里
    resize:function(){
      for(var i=0;i<items.length;i++){
        var it=items[i], h=it.size/2;
        it.tx=ZL.clamp(it.tx,h,Math.max(h,api.W-h));
        it.ty=ZL.clamp(it.ty,h,Math.max(h,api.H-h));
        if(it.phase==='landed'){ it.x=it.tx; it.y=it.ty; }
      }
    },
    config:function(){ syncCustom(); },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      // 发射排期一起清零：不然清空后下一波要按清空前排好的时间等（排队多时能等半分钟以上）
      if(op==='clear'){ items=[]; pending.clear(); nextLaunchAt=0; batchClock=0; return; }
      if(op==='reset'){ caught=0; ZL.saveTotal('throw_poop',0); return; }
      var n=Math.min(ZL.count(cmd,5), api.cap());
      var was=pending.total;
      pending.push(Math.min(n, 999999999-pending.total), { size:String((cmd&&cmd.size)||'random') }, sameOpt);
      // 攒批：队列从空变成有东西才开始计时，之后再来礼物不清零（以前每来一次都清零，礼物间隔短于 1.2 秒、场上又没清空时，排队的一直不落）
      if(was===0) batchClock=0;
      var name=ZL.who(cmd);
      if(name) api.banner(name+' 扔来 '+n+' 个粑粑');
    },
    pointer:function(type,x,y){
      if(type!=='down') return;
      var idx=hit(x,y);
      if(idx<0) return;
      items.splice(idx,1);
      caught++; ZL.saveTotal('throw_poop',caught);
      return true;
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      var now=nowMs/1000;
      batchClock+=step;
      if(pending.total>0 && (batchClock>=1200 || items.length===0)){ batchClock=0; flushQueue(); }
      var active=pending.total>0;
      var i,it;
      for(i=0;i<items.length;i++){
        it=items[i];
        if(it.phase==='wait'){
          if(now>=it.started){
            it.phase='fly'; it.t0=now; it.x=it.sx; it.y=it.sy;
            if(!it.sounded){ it.sounded=true; throwSnd(); }
          } else { active=true; continue; }
        }
        if(it.phase==='fly'){
          active=true;
          var t=now-it.t0;
          if(t>=it.travel){ it.phase='bounce'; it.bounceT=0; it.x=it.tx; it.y=it.ty; }
          else{
            it.x=it.sx+it.vx*t;
            it.y=it.sy+it.vy*t+0.5*it.g*t*t;
            it.rot+=it.rotV*step/1000;
          }
        } else if(it.phase==='bounce'){
          active=true;
          it.bounceT+=step/1000;
          var b=it.bounceT;
          if(b>=0.38){ it.phase='landed'; it.x=it.tx; it.y=it.ty; it.rot=it.landRot; }
          else{
            var decay=Math.exp(-8*b), s=Math.sin(16*b);
            it.x=it.tx+it.vx*0.045*decay*s;
            it.y=it.ty+it.vy*0.045*decay*s;
            it.rot+=it.rotV*0.3*step/1000;
          }
        }
      }
      return active;
    },
    draw:function(ctx){
      var i,it,im=sprite();
      for(i=0;i<items.length;i++){
        it=items[i];
        if(it.phase==='wait') continue;
        var ok=false;
        if(ZL.imgOk(im)){
          // 自定义图不一定是方的：等比塞进 size 见方
          var wh=ZL.fit(im,it.size);
          ok=ZL.drawImg(ctx,im,it.x,it.y,wh[0],wh[1],it.rot,1);
        }
        if(!ok){
          ctx.save(); ctx.translate(it.x,it.y); ctx.rotate(it.rot);
          ctx.fillStyle='#8a5a2b'; ctx.beginPath(); ctx.arc(0,0,it.size/2,0,6.2832); ctx.fill();
          ctx.restore();
        }
      }
      drawStats(api.hudCtx||ctx);
    },
    stats:function(){ return { value:caught }; },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      var hits=[];
      for(var i=0;i<items.length;i++) if(items[i].phase==='landed') hits.push([items[i].x,items[i].y,items[i].size]);
      return { pending:pending.total, count:items.length, caught:caught, hits:hits, custom:!!customImg };
    }
  };
})());
`
