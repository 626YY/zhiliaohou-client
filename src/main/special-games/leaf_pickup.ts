// 特色玩法「捡叶子」的页面内 Canvas 代码。
// 秋叶从顶部摇摆飘落（easeOutCubic + 正弦摇摆 2 个来回、振幅渐收）铺满底部；
// 点击叶子 → 按「每次点击收几片 × 本轮加速倍数」沿贝塞尔飞进右下角垃圾桶（缩到 12%、后 32% 渐隐）。无音效。
// 回合制：空闲时来的 add 开新一轮（已清扫归零），本轮内 add 累加；剩余多于同屏上限时边清边从顶上补落。
// 操作：add（大小 big/small/random）/ reduce 直接扫掉 N 片 / accelerate 本轮每次点击收 N 倍（回合结束复位 1）/
//      tornado 龙卷风卷走 N 片（各自旋转、统一飘向右上角，新的 add 会把正在刮的龙卷风收掉）/ clear 清场。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','reduce','accelerate','tornado','clear'];
  var MAX_VISIBLE=2000;    // 同屏叶子上限（剩余更多时边清边补）
  var MAX_SPAWN=600;       // 每帧最多补落多少片（大额礼物不一帧全塞）
  var MAX_FLY=32;          // 一次清扫做飞行动画的上限，多出来的直接收走
  var MAX_TORNADO=400;     // 龙卷风同时卷起的动画上限
  var REPLAY_MAX=80;       // 同屏已满时，重放一批顶部飘落的上限
  var MAXN=999999999;      // 防爆夹紧：剩余上限
  var sprites=[];
  var leaves=[];           // {x,y,size,rot,sprite,phase:'falling'|'settled'|'flying'|'tornado', ...}
  var remaining=0;         // 回合制：剩余
  var cleared=0;           // 本轮已清扫
  var multiplier=1;        // 本轮加速倍数
  var roundActive=false;
  var curSize='random';    // 补落的叶子用最近一次 add 的大小
  var nowMs=0;
  var binA=0, binUsed=false; // 垃圾桶淡入淡出（0~1）/ 来过叶子没有（「一直显示」用）
  var BIN_FADE_MS=300;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function pct(v,d){ return Math.max(3,Math.min(100,num(v,d))); }
  function leavesPerClick(){ return Math.max(1,Math.trunc(num(api.cfg.leavesPerClick,1))); }
  // 大小选项 → 窗口高度百分比
  function sizeFor(size){
    return ZL.sizePct(size, pct(api.cfg.bigLeafSize,50), pct(api.cfg.smallLeafSize,10), pct(api.cfg.randomSizeMin,10), pct(api.cfg.randomSizeMax,50));
  }
  function onField(l){ return l.phase==='falling'||l.phase==='settled'; }
  function fieldCount(){ var n=0; for(var i=0;i<leaves.length;i++) if(onField(leaves[i])) n++; return n; }

  // 垃圾桶（右下角）：宽 clamp(76,142,W*10.5%)，高=宽*1.22，边距 clamp(14,34,W*1.8%)
  function binRect(){
    var W=api.W,H=api.H;
    var bw=Math.max(76,Math.min(142,W*0.105));
    var bh=bw*1.22;
    var m=Math.max(14,Math.min(34,W*0.018));
    return { x:W-bw-m, y:H-bh-m, w:bw, h:bh };
  }

  function makeLeaf(stagger){
    // 按短边算：横屏就是窗口高度（和原来一样），竖屏直播时叶子不会大到占半屏
    var size=Math.max(14,Math.round(Math.min(api.W,api.H)*sizeFor(curSize)/100));
    var tx=Math.random()*Math.max(1,api.W-size)+size/2;
    // 落点集中在下部 1/3，营造铺满底部
    var ty=api.H-size/2-Math.random()*api.H*0.30;
    return {
      x:tx, y:-size, sx:tx, sy:-size, tx:tx, ty:ty, size:size,
      rot:Math.random()*6.28, sprite:Math.floor(Math.random()*8),
      phase:'falling', started:nowMs+stagger, duration:1400+Math.random()*900,
      swayAmp:api.W*(0.02+Math.random()*0.025)
    };
  }

  // 已落定的叶子重新从顶上飘一次（同屏满了还在加时，让观众看到「又落了一批」）
  function replayFall(leaf,stagger){
    leaf.phase='falling'; leaf.sx=leaf.tx; leaf.sy=-leaf.size; leaf.x=leaf.tx; leaf.y=-leaf.size;
    leaf.started=nowMs+stagger; leaf.duration=1400+Math.random()*900;
  }

  // 同屏叶子数对齐剩余：少了从顶上补落，多了把多余的收掉
  function maintain(){
    if(!roundActive) return;
    var want=Math.min(remaining,MAX_VISIBLE), have=fieldCount(), i;
    if(have<want){
      var add=Math.min(want-have,MAX_SPAWN);
      var gap=Math.min(60,2500/add);   // 一批在 2.5 秒内错峰落完
      for(i=0;i<add;i++) leaves.push(makeLeaf(i*gap));
    }else if(have>want){
      var extra=have-want;
      for(i=leaves.length-1;i>=0&&extra>0;i--) if(onField(leaves[i])){ leaves.splice(i,1); extra--; }
    }
  }

  // 二次贝塞尔取点
  function qpoint(sx,sy,cx,cy,ex,ey,t){
    var u=1-t;
    return [u*u*sx+2*u*t*cx+t*t*ex, u*u*sy+2*u*t*cy+t*t*ey];
  }

  function flyToBin(leaf){
    var b=binRect();
    var ex=b.x+b.w*0.5, ey=b.y+b.h*0.2;
    // 控制点：先上扬再落进桶口
    var cx=(leaf.x+ex)/2, cy=Math.min(leaf.y,ey)-api.H*0.24;
    leaf.fsx=leaf.x; leaf.fsy=leaf.y; leaf.fcx=cx; leaf.fcy=cy; leaf.fex=ex; leaf.fey=ey;
    leaf.phase='flying'; leaf.ft0=nowMs; leaf.fdur=620+Math.random()*240;
  }

  // 把一组叶子收走：前 MAX_FLY 片飞进桶，其余直接拿掉
  function sweep(list){
    for(var i=0;i<list.length;i++){
      if(i<MAX_FLY) flyToBin(list[i]);
      else { var k=leaves.indexOf(list[i]); if(k>=0) leaves.splice(k,1); }
    }
  }

  // 场上随机挑 n 片（不含正在飞的）
  function pickRandom(n){
    var pool=[];
    for(var i=0;i<leaves.length;i++) if(onField(leaves[i])) pool.push(leaves[i]);
    for(var j=pool.length-1;j>0;j--){ var k=Math.floor(Math.random()*(j+1)); var t=pool[j]; pool[j]=pool[k]; pool[k]=t; }
    return pool.slice(0,n);
  }

  // 龙卷风：每片叶子各自旋转，带着漩涡偏移统一飘向右上角
  function startTornado(list){
    for(var i=0;i<list.length;i++){
      var l=list[i];
      if(i>=MAX_TORNADO){ var k=leaves.indexOf(l); if(k>=0) leaves.splice(k,1); continue; }
      l.phase='tornado';
      l.tsx=l.x; l.tsy=l.y;
      l.tex=api.W+l.size+Math.random()*api.W*0.05; l.tey=-l.size-Math.random()*api.H*0.12;
      l.tt0=nowMs+Math.random()*320; l.tdur=1500+Math.random()*900;
      l.tspin=(Math.random()<0.5?-1:1)*(9+Math.random()*9);
      l.tr0=Math.min(api.W,api.H)*(0.03+Math.random()*0.06);
      l.tang=Math.random()*6.2832; l.tangV=8+Math.random()*6;
      l.trot0=l.rot;
    }
  }
  function cancelTornado(){
    for(var i=leaves.length-1;i>=0;i--) if(leaves[i].phase==='tornado') leaves.splice(i,1);
  }

  function finishRoundIfDone(){
    if(roundActive && remaining<=0 && leaves.length===0){ roundActive=false; multiplier=1; }
  }

  // 垃圾桶什么时候在画面上：默认这一轮还有叶子（场上 / 飞进桶 / 被卷走 / 还没落下）才淡入、扫完淡出；
  // 「用过就一直显示」= 来过一次叶子就留着。全部清屏（wipe）一律立刻收起。
  function binWanted(){
    if(String(api.cfg.binShow||'active')==='always'&&binUsed) return true;
    return roundActive||remaining>0||leaves.length>0;
  }

  function drawBin(ctx){
    var b=binRect();
    ctx.save();
    if(binA<1) ctx.globalAlpha*=binA;
    ctx.translate(b.x,b.y);
    var w=b.w,h=b.h;
    ZL.roundRect(ctx, w*0.12, h*0.18, w*0.76, h*0.77, w*0.08);
    ctx.fillStyle='rgba(214,219,221,0.96)'; ctx.fill();
    ctx.lineWidth=Math.max(2,w*0.025); ctx.strokeStyle='rgba(72,78,82,0.96)'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(w*0.5, h*0.205, w*0.44, h*0.125, 0, 0, 6.2832);
    ctx.fillStyle='rgba(28,29,30,0.99)'; ctx.fill();
    ctx.lineWidth=Math.max(1.5,w*0.02); ctx.strokeStyle='rgba(5,5,5,0.96)'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(w*0.5, h*0.205, w*0.34, h*0.085, 0, 0, 6.2832);
    ctx.fillStyle='rgba(48,49,50,0.96)'; ctx.fill();
    ctx.restore();
  }

  // 计数面板：一直显示 / 场上有东西时显示（默认）/ 不显示——好几个玩法同在一个窗口，用过的面板别一直堆在左上角
  function statsShown(){ var m=String(api.cfg.statsPanel||'active'); if(m==='off') return false; if(m==='always') return true; return roundActive||remaining>0; }
  function drawStats(ctx){
    if(!statsShown()){ if(api.hud) api.hud(0); return; }
    var fs=Math.max(13,Math.min(20,api.W*0.016));
    var lines=['已清扫：'+cleared,'剩余：'+remaining];
    if(multiplier>1) lines.push('加速清扫：×'+multiplier);
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
      ctx.fillStyle=(i===2)?'#ffd54a':'#fff'; ctx.fillText(lines[i],10+padX,ly);
    }
    ctx.restore();
  }

  function drawLeaf(ctx,leaf,scale,alpha){
    var im=sprites[leaf.sprite];
    var s=leaf.size*(scale||1);
    ctx.save();
    if(alpha!=null&&alpha<1) ctx.globalAlpha*=alpha;
    ctx.translate(leaf.x,leaf.y); ctx.rotate(leaf.rot);
    if(ZL.imgOk(im)) ctx.drawImage(im,-s/2,-s/2,s,s);
    else { ctx.fillStyle='#e8a735'; ctx.beginPath(); ctx.ellipse(0,0,s/2,s*0.36,0,0,6.2832); ctx.fill(); }
    ctx.restore();
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      for(var i=0;i<8;i++) sprites.push(ZL.img('leaf_pickup/leaf_sprite_0'+(i+1)+'.png'));
    },
    resize:function(){},
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      var name=ZL.who(cmd);
      if(op==='clear'){ leaves=[]; remaining=0; cleared=0; multiplier=1; roundActive=false; if(cmd&&cmd.wipe){ binA=0; binUsed=false; } return; }
      var n=ZL.count(cmd,5);
      if(op==='add'){
        binUsed=true;
        n=Math.min(n,api.cap());
        cancelTornado();   // 新叶子来了，正在刮的龙卷风收掉
        if(!roundActive){ remaining=0; cleared=0; multiplier=1; leaves=[]; roundActive=true; }
        curSize=String((cmd&&cmd.size)||'random');
        var before=fieldCount();
        remaining=Math.min(MAXN, remaining+n);
        // 同屏已满：拿已落定的叶子重放一批顶部飘落
        if(before>=MAX_VISIBLE){
          var again=pickRandom(Math.min(n,REPLAY_MAX));
          for(var r=0;r<again.length;r++) replayFall(again[r],r*40);
        }
        maintain();
        if(name) api.banner(name+' 送来 '+n+' 片落叶');
        return;
      }
      if(op==='accelerate'){
        // 只对进行中的一轮生效；没有进行中的回合就复位 1
        if(!roundActive){ multiplier=1; return; }
        multiplier=Math.min(n,MAXN);
        api.banner(name?name+' 让主播清扫加速 ×'+n:'清扫加速 ×'+n);
        return;
      }
      if(!roundActive||remaining<=0) return;
      var take=Math.min(n,remaining);
      if(op==='reduce'){
        sweep(pickRandom(take));
        remaining-=take; cleared+=take;
        api.banner(name?name+' 帮主播扫掉 '+take+' 片叶子':'直接扫掉 '+take+' 片叶子');
      }else if(op==='tornado'){
        startTornado(pickRandom(take));
        remaining-=take; cleared+=take;
        api.banner(name?name+' 刮来龙卷风，卷走 '+take+' 片叶子':'龙卷风卷走 '+take+' 片叶子');
      }
    },
    pointer:function(type,x,y){
      if(type!=='down'||!roundActive) return;
      // 逆序椭圆命中：rx=max(8,size*0.48), ry=max(7,size*0.36)
      for(var i=leaves.length-1;i>=0;i--){
        var leaf=leaves[i];
        if(!onField(leaf)) continue;
        if(leaf.phase==='falling' && nowMs<leaf.started) continue;
        var rx=Math.max(8,leaf.size*0.48), ry=Math.max(7,leaf.size*0.36);
        var dx=x-leaf.x, dy=y-leaf.y;
        if((dx*dx)/(rx*rx)+(dy*dy)/(ry*ry)<=1){
          // 点中：收 每次点击收几片 × 加速倍数（点中的这片 + 离它最近的其它叶子）
          var take=Math.min(leavesPerClick()*multiplier, remaining);
          if(take<=0) return;
          var others=[];
          for(var j=0;j<leaves.length;j++){
            var o=leaves[j];
            if(o===leaf||!onField(o)) continue;
            var ox=o.x-leaf.x, oy=o.y-leaf.y;
            others.push({ l:o, d:ox*ox+oy*oy });
          }
          others.sort(function(a,b){ return a.d-b.d; });
          var picked=[leaf];
          for(var k=0;k<others.length&&picked.length<take;k++) picked.push(others[k].l);
          sweep(picked);
          remaining=Math.max(0,remaining-take);
          cleared+=take;
          return true;
        }
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      maintain();
      var active=false;
      for(var i=leaves.length-1;i>=0;i--){
        var leaf=leaves[i];
        if(leaf.phase==='falling'){
          active=true;
          var p=(nowMs-leaf.started)/leaf.duration;
          if(p<0) continue;
          if(p>=1){ leaf.x=leaf.tx; leaf.y=leaf.ty; leaf.phase='settled'; continue; }
          var e=1-Math.pow(1-p,3);   // easeOutCubic
          var sway=Math.sin(p*Math.PI*2)*leaf.swayAmp*(1-p);
          leaf.x=Math.max(leaf.size/2,Math.min(api.W-leaf.size/2, leaf.sx+(leaf.tx-leaf.sx)*e+sway));
          leaf.y=leaf.sy+(leaf.ty-leaf.sy)*e;
        } else if(leaf.phase==='flying'){
          active=true;
          var fp=(nowMs-leaf.ft0)/leaf.fdur;
          if(fp>=1){ leaves.splice(i,1); continue; }
          var fe=1-Math.pow(1-fp,3);
          var pt=qpoint(leaf.fsx,leaf.fsy,leaf.fcx,leaf.fcy,leaf.fex,leaf.fey,fe);
          leaf.x=pt[0]; leaf.y=pt[1];
          leaf.fscale=Math.max(0.12, 1-fe*0.82);
          leaf.falpha=fe<0.68?1:(1-fe)/0.32;
        } else if(leaf.phase==='tornado'){
          active=true;
          var tp=(nowMs-leaf.tt0)/Math.max(100,leaf.tdur);
          if(tp<0){ leaf.rot=leaf.trot0+leaf.tspin*0.02*(nowMs-leaf.tt0+320)/1000; continue; }
          if(tp>=1){ leaves.splice(i,1); continue; }
          var te=Math.pow(tp,1.6);   // 先原地打转，再越卷越快地飘走
          var ang=leaf.tang+leaf.tangV*tp*3;
          var rr=leaf.tr0*(0.5+tp*1.6);
          leaf.x=leaf.tsx+(leaf.tex-leaf.tsx)*te+Math.cos(ang)*rr;
          leaf.y=leaf.tsy+(leaf.tey-leaf.tsy)*te+Math.sin(ang)*rr*0.6;
          leaf.rot=leaf.trot0+leaf.tspin*(nowMs-leaf.tt0)/1000;
          leaf.talpha=tp<0.8?1:(1-tp)/0.2;
        }
      }
      finishRoundIfDone();
      var want=binWanted()?1:0;
      if(binA!==want){
        binA=want>binA?Math.min(1,binA+step/BIN_FADE_MS):Math.max(0,binA-step/BIN_FADE_MS);
        active=true;
      }
      return active;
    },
    draw:function(ctx){
      var i;
      for(i=0;i<leaves.length;i++){
        var leaf=leaves[i];
        if(leaf.phase==='falling' && nowMs<leaf.started) continue;
        if(!onField(leaf)) continue;   // 飞的 / 卷的后画
        drawLeaf(ctx,leaf,1,1);
      }
      for(i=0;i<leaves.length;i++){
        var l2=leaves[i];
        if(l2.phase==='flying') drawLeaf(ctx,l2,l2.fscale||1,l2.falpha==null?1:l2.falpha);
      }
      if(binA>0.004) drawBin(ctx);
      for(i=0;i<leaves.length;i++){
        var l3=leaves[i];
        if(l3.phase==='tornado') drawLeaf(ctx,l3,1,l3.talpha==null?1:l3.talpha);
      }
      drawStats(api.hudCtx||ctx);
    },
    stats:function(){ return { value:cleared }; },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      var hits=[], flying=0, tornado=0;
      for(var i=0;i<leaves.length;i++){
        var l=leaves[i];
        if(l.phase==='settled') hits.push([l.x,l.y,l.size]);
        else if(l.phase==='flying') flying++;
        else if(l.phase==='tornado') tornado++;
      }
      return { remaining:remaining, cleared:cleared, multiplier:multiplier, roundActive:roundActive, field:fieldCount(), flying:flying, tornado:tornado, hits:hits, bin:binA };
    }
  };
})());
`
