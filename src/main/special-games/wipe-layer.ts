// 特色玩法共用的「糊在屏幕上的东西 + 按住鼠标擦干净」：礼物拔河输了被砸的奶油 / 鸡蛋 / 番茄、拆炸弹炸出来的黑灰。
// 每一块是自己的一张离屏画布（本体 + 慢慢往下流的汁），擦就在这张画布上挖掉（destination-out）；
// 擦过的块每 150ms 量一次还剩多少（缩到 24×24 数不透明度），剩得少于设定就整块淡出（叮一声 + 闪光）。
// 用法：var L=ZL.splatLayer(api,{ brush:fn→窗口短边%, clean:fn→擦掉多少%算干净, onClean:fn(块), sound:fn(名字) })；
//   L.add({x,y,size,img|draw,rot,tint,drips,dripLen,life}) / L.burst / L.pointer(type,x,y) / L.tick(dt) / L.draw(ctx) / L.clear() / L.count()
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）；也别写反斜杠（模板串会吃掉）。
export const WIPE_JS = `
(function(){
var ZL=window.__ZL;
ZL.splatLayer=function(api,opts){
  opts=opts||{};
  var L={ list:[], parts:[], pressing:false, lx:0, ly:0, cleaned:0, squeakAt:0 };
  var probe=null, pctx=null, nowMs=0;
  var MAXP=400;   // 防爆夹紧：同屏粒子上限
  var MAXS=60;    // 防爆夹紧：同屏糊块上限（每块一张离屏画布），再多就让最早的悄悄淡掉
  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function res(){ var cv=api.ctx&&api.ctx.canvas; return (cv&&api.W>0)?Math.max(1,Math.min(2,cv.width/api.W)):1; }
  function brushR(){ var p=Math.max(1,Math.min(1000,num(opts.brush?opts.brush():10,10))); return Math.max(6,Math.min(api.W,api.H)*p/200); }
  function cleanFrac(){ var v=num(opts.clean?opts.clean():85,85); return Math.max(0.5,Math.min(1,v/100)); }
  function snd(name){ if(opts.sound) opts.sound(name); }
  function measure(sp){
    if(!probe){ probe=document.createElement('canvas'); probe.width=24; probe.height=24; pctx=probe.getContext('2d',{willReadFrequently:true}); }
    pctx.clearRect(0,0,24,24); pctx.drawImage(sp.cv,0,0,24,24);
    var d=pctx.getImageData(0,0,24,24).data, s=0;
    for(var i=3;i<d.length;i+=4) s+=d[i];
    return s;
  }
  // 往这块的画布上画本体：图片要等加载好（没好就下一帧再画），程序画的直接画
  function paint(sp){
    if(sp.painted) return true;
    var c=sp.ctx;
    if(sp.img){
      if(!ZL.imgOk(sp.img)) return false;
      c.save(); c.setTransform(sp.r,0,0,sp.r,0,0);
      c.translate(sp.w/2,sp.size/2); c.rotate(sp.rot);
      var k=sp.size*0.94;
      c.drawImage(sp.img,-k/2,-k/2,k,k);
      c.restore();
    }else if(sp.draw){
      c.save(); c.setTransform(sp.r,0,0,sp.r,0,0); sp.draw(c,sp); c.restore();
    }
    sp.painted=true;
    initDrips(sp);
    return true;
  }
  // 汁从哪儿流：随便挑一列，找这一列糊的东西最下面的边，从边上往下流（不会悬空挂一条）
  function initDrips(sp){
    if(!sp.nd) return;
    var r=sp.r, S=sp.size, cw=sp.cv.width, data=null;
    try{ data=sp.ctx.getImageData(0,0,cw,Math.ceil(S*r)).data; }catch(e){ data=null; }
    for(var k=0;k<sp.nd;k++){
      for(var tries=0;tries<14;tries++){
        var x=S*(0.22+Math.random()*0.56), px=Math.min(cw-1,Math.round(x*r)), edge=-1;
        if(data){ for(var py=Math.round(S*0.9*r);py>=Math.round(S*0.42*r);py--){ if(data[(py*cw+px)*4+3]>200){ edge=py/r; break; } } }
        else edge=S*0.6;
        if(edge<0) continue;
        sp.drips.push({ x:x, y0:edge-S*0.015, len:0, max:sp.dl*(0.35+Math.random()*0.65), w:S*(0.014+Math.random()*0.016),
          delay:500+Math.random()*1800, speed:0.6+Math.random()*0.8, wob:Math.random()*6.28, done:false });
        break;
      }
    }
  }
  L.add=function(o){
    var live=0; for(var q=0;q<L.list.length;q++) if(L.list[q].fade<=0) live++;
    for(var z=0;z<L.list.length&&live>=MAXS;z++){ if(L.list[z].fade<=0){ L.list[z].fade=1; live--; } }
    var size=Math.max(10,num(o.size,100)), r=res();
    if(size*r>2400) r=Math.max(0.25,2400/size);   // 防爆：一块的画布边长不超过 2400 像素
    var dl=(o.drips>0)?Math.max(0,num(o.dripLen,size*0.5)):0;
    var w=size, h=size+dl;
    var cv=document.createElement('canvas'); cv.width=Math.ceil(w*r); cv.height=Math.ceil(h*r);
    var sp={ x:num(o.x,api.W/2), y:num(o.y,api.H/2), size:size, w:w, h:h, r:r, cv:cv, ctx:cv.getContext('2d',{willReadFrequently:false}),
      img:o.img||null, draw:o.draw||null, rot:num(o.rot,0), tint:o.tint||'255,255,255', dripTint:o.dripTint||o.tint||'255,255,255', seed:Math.random()*1000,
      t:0, life:Math.max(0,num(o.life,0)), fade:0, painted:false, base:0, left:1, dirty:false, measureAt:0, touched:false, drips:[],
      nd:Math.max(0,Math.min(8,Math.trunc(num(o.drips,0)))), dl:dl };
    paint(sp);
    L.list.push(sp);
    return sp;
  };
  // 溅开的小水滴（不留在画面上，0.5 秒散掉）
  L.burst=function(x,y,tint,size,n){
    n=Math.max(0,Math.min(40,n==null?16:n));
    for(var i=0;i<n&&L.parts.length<MAXP;i++){
      var a=Math.random()*6.2832, sp=size*(1.2+Math.random()*2.2);
      L.parts.push({ k:'drop', x:x, y:y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-size*0.6, r:size*(0.012+Math.random()*0.03), c:tint, life:0, max:380+Math.random()*260 });
    }
  };
  function sparkle(sp){
    for(var i=0;i<18&&L.parts.length<MAXP;i++){
      var a=Math.random()*6.2832, v=sp.size*(0.5+Math.random()*1.1);
      L.parts.push({ k:'star', x:sp.x, y:sp.y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, r:sp.size*(0.02+Math.random()*0.025), c:i%3?'255,236,150':'255,255,255', life:0, max:520+Math.random()*300 });
    }
  }
  function startFade(sp){ if(sp.fade>0) return; sp.fade=1; L.cleaned++; sparkle(sp); snd('clean'); if(opts.onClean) opts.onClean(sp); }
  // 擦：从上一个点到这个点，每隔 0.35 个笔刷半径戳一下
  L.wipe=function(x0,y0,x1,y1){
    var br=brushR(), any=false;
    for(var i=0;i<L.list.length;i++){
      var sp=L.list[i];
      if(sp.fade>0||!sp.painted) continue;
      var ox=sp.x-sp.w/2, oy=sp.y-sp.size/2;
      var minx=Math.min(x0,x1)-br, maxx=Math.max(x0,x1)+br, miny=Math.min(y0,y1)-br, maxy=Math.max(y0,y1)+br;
      if(maxx<ox||minx>ox+sp.w||maxy<oy||miny>oy+sp.h) continue;
      // 第一次擦之前记下它现在有多少（流下来的汁也算进去），之后汁就不再往下流了
      if(!sp.touched){ sp.touched=true; sp.base=Math.max(1,measure(sp)); }
      var c=sp.ctx;
      c.save(); c.setTransform(sp.r,0,0,sp.r,0,0); c.globalCompositeOperation='destination-out';
      var dx=x1-x0, dy=y1-y0, len=Math.sqrt(dx*dx+dy*dy), steps=Math.max(1,Math.ceil(len/(br*0.35)));
      for(var k=0;k<=steps;k++){
        var px=x0+dx*k/steps-ox, py=y0+dy*k/steps-oy;
        var g=c.createRadialGradient(px,py,br*0.15,px,py,br);
        g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(0.62,'rgba(0,0,0,0.95)'); g.addColorStop(1,'rgba(0,0,0,0)');
        c.fillStyle=g; c.beginPath(); c.arc(px,py,br,0,6.2832); c.fill();
      }
      c.restore();
      sp.dirty=true; any=true;
      if(Math.random()<0.35&&L.parts.length<MAXP) L.parts.push({ k:'drop', x:x1, y:y1, vx:(Math.random()-0.5)*br*3, vy:-br*(1+Math.random()*2), r:br*(0.06+Math.random()*0.08), c:sp.tint, life:0, max:320 });
    }
    if(any&&nowMs-L.squeakAt>260){ L.squeakAt=nowMs; snd('squeak'); }
    return any;
  };
  // 按下的点笔刷够得着哪一块（从块的边上一点开始拖也算按在上面）
  L.hitAt=function(x,y){
    var pad=brushR()*0.8;
    for(var i=L.list.length-1;i>=0;i--){
      var sp=L.list[i];
      if(sp.fade>0) continue;
      var ox=sp.x-sp.w/2, oy=sp.y-sp.size/2;
      if(x>=ox-pad&&x<=ox+sp.w+pad&&y>=oy-pad&&y<=oy+sp.h+pad) return sp;
    }
    return null;
  };
  // 鼠标：按在糊的东西上就开始擦（返回 true 接住这一下），按住拖着擦；松开停
  L.pointer=function(type,x,y){
    if(type==='down'){
      if(!L.hitAt(x,y)) return false;
      L.pressing=true; L.lx=x; L.ly=y; L.wipe(x,y,x,y);
      return true;
    }
    if(type==='move'){ if(L.pressing){ L.wipe(L.lx,L.ly,x,y); L.lx=x; L.ly=y; } return false; }
    if(type==='up'){ L.pressing=false; }
    return false;
  };
  // 外面接住了「按下」（比如拔河一局还没完，点一下算拉一下）也可以顺手开始擦
  L.press=function(x,y){ L.pressing=true; L.lx=x; L.ly=y; if(L.hitAt(x,y)) L.wipe(x,y,x,y); };
  L.tick=function(dt){
    nowMs+=dt;
    var active=false, i;
    for(i=L.list.length-1;i>=0;i--){
      var sp=L.list[i];
      sp.t+=dt;
      if(!sp.painted){ paint(sp); active=true; }
      if(sp.t<260) active=true;
      if(sp.fade>0){
        sp.fade-=dt/360;
        if(sp.fade<=0){ L.list.splice(i,1); continue; }
        active=true; continue;
      }
      if(sp.life>0&&sp.t>sp.life){ sp.fade=1; L.cleaned++; active=true; continue; }
      // 汁往下流：没被擦过之前慢慢流，越流越慢
      if(!sp.touched&&sp.painted){
        for(var k=0;k<sp.drips.length;k++){
          var d=sp.drips[k];
          if(sp.t<d.delay||d.len>=d.max) continue;
          var grow=dt*0.012*d.speed*sp.size/100*Math.max(0.15,1-d.len/d.max);
          var from=d.len; d.len=Math.min(d.max,d.len+grow);
          var c=sp.ctx;
          c.save(); c.setTransform(sp.r,0,0,sp.r,0,0);
          var stepY=Math.max(0.5,d.w*0.25);
          // 越往下越细、微微左右扭；流到头挂一颗圆滚滚的水滴
          for(var yy=from;yy<=d.len;yy+=stepY){
            var q=yy/Math.max(1,d.max), cy=d.y0+yy, rr=d.w*(1-0.45*q), cx=d.x+Math.sin(q*5+d.wob)*d.w*0.35;
            c.fillStyle='rgba('+sp.dripTint+',0.95)'; c.beginPath(); c.arc(cx,cy,rr,0,6.2832); c.fill();
          }
          if(d.len>=d.max&&!d.done){
            d.done=true;
            var ex=d.x+Math.sin(5+d.wob)*d.w*0.35, ey=d.y0+d.len;
            c.fillStyle='rgba('+sp.dripTint+',0.97)'; c.beginPath(); c.arc(ex,ey+d.w*0.5,d.w*1.05,0,6.2832); c.fill();
            c.fillStyle='rgba(255,255,255,0.35)'; c.beginPath(); c.arc(ex-d.w*0.35,ey+d.w*0.2,d.w*0.3,0,6.2832); c.fill();
          }
          c.restore();
          active=true;
        }
      }
      if(sp.dirty&&nowMs-sp.measureAt>=150){
        sp.measureAt=nowMs; sp.dirty=false;
        sp.left=measure(sp)/Math.max(1,sp.base);
        if(sp.left<=1-cleanFrac()) startFade(sp);
      }
      if(sp.dirty) active=true;
    }
    for(i=L.parts.length-1;i>=0;i--){
      var p=L.parts[i];
      p.life+=dt;
      if(p.life>=p.max){ L.parts.splice(i,1); continue; }
      var s=dt/1000;
      p.x+=p.vx*s; p.y+=p.vy*s;
      if(p.k==='drop') p.vy+=api.H*1.6*s; else { p.vx*=0.94; p.vy*=0.94; }
      active=true;
    }
    return active;
  };
  L.draw=function(ctx){
    for(var i=0;i<L.list.length;i++){
      var sp=L.list[i];
      if(!sp.painted) continue;
      var sc=1;
      if(sp.t<130) sc=0.45+0.67*(sp.t/130); else if(sp.t<260) sc=1.12-0.12*((sp.t-130)/130);
      ctx.save();
      if(sp.fade>0){ ctx.globalAlpha*=Math.max(0,sp.fade); sc*=1+0.08*(1-sp.fade); }
      ctx.translate(sp.x,sp.y); ctx.scale(sc,sc);
      ctx.drawImage(sp.cv,-sp.w/2,-sp.size/2,sp.w,sp.h);
      ctx.restore();
    }
    for(var j=0;j<L.parts.length;j++){
      var p=L.parts[j], a=1-p.life/p.max;
      ctx.save(); ctx.globalAlpha*=Math.max(0,a);
      if(p.k==='star'){
        ctx.fillStyle='rgba('+p.c+',1)';
        ctx.translate(p.x,p.y); ctx.rotate(p.life*0.008);
        ctx.beginPath();
        for(var q=0;q<8;q++){ var rr=q%2?p.r*0.35:p.r; var aa=q*Math.PI/4; ctx.lineTo(Math.cos(aa)*rr,Math.sin(aa)*rr); }
        ctx.closePath(); ctx.fill();
      }else{
        ctx.fillStyle='rgba('+p.c+',0.95)'; ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.5,p.r),0,6.2832); ctx.fill();
      }
      ctx.restore();
    }
  };
  L.count=function(){ var n=0; for(var i=0;i<L.list.length;i++) if(L.list[i].fade<=0) n++; return n; };
  L.busy=function(){ return L.list.length>0||L.parts.length>0; };
  L.clear=function(){ L.list=[]; L.parts=[]; L.pressing=false; };
  // 改窗口大小（一键切竖屏）：挪回画面里
  L.resize=function(){
    for(var i=0;i<L.list.length;i++){
      var sp=L.list[i], h=sp.size*0.3;
      sp.x=Math.max(h,Math.min(Math.max(h,api.W-h),sp.x));
      sp.y=Math.max(h,Math.min(Math.max(h,api.H-h),sp.y));
    }
  };
  // 调试：每块中心、大小、还剩多少
  L.debug=function(){ var out=[]; for(var i=0;i<L.list.length;i++){ var sp=L.list[i]; if(sp.fade<=0) out.push([Math.round(sp.x),Math.round(sp.y),Math.round(sp.size),Math.round(sp.left*100)/100]); } return out; };
  return L;
};
})();
`
