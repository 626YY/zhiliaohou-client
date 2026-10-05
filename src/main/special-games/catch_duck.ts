// 特色玩法「抓鸭子」的页面内 Canvas 代码。
// 鸭子从顶部弹跳落下（OutBounce）到防重叠落点，主播点击抓住；累计抓鸭数持久化。
// 操作：add（大小：big/small/random）/ clear 清场 / reset 累计清零。
// 素材：duck/duck_angle_1~5.png（512×512，按裁剪矩形取本体）+ duck_appear.mp3（出现/被抓两路声道）。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','clear','reset'];
  // 五帧裁剪矩形（512×512 原图取鸭子本体）
  var CROPS=[[52,16,420,468],[44,24,428,460],[40,16,436,468],[44,12,428,476],[48,28,424,444]];
  var frames=[];
  var ducks=[];            // {x,y,size,frame,phase:'wait'|'drop'|'sit',started,t0,ty}
  var pending=null;        // 待落队列（按批合并，opt={size}）
  var batchClock=0;
  var caught=0;
  var nowMs=0;
  var prompts=[];          // 触发气泡 {name,avatarImg,count,until}

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function pct(v,d){ return Math.max(5,Math.min(100,num(v,d))); }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,300))); }
  // 大小选项 → 窗口高度百分比
  function sizeFor(size){
    return ZL.sizePct(size, pct(api.cfg.bigDuckSize,14), pct(api.cfg.smallDuckSize,8), pct(api.cfg.randomSizeMin,8), pct(api.cfg.randomSizeMax,14));
  }
  function sameOpt(a,b){ return a.size===b.size; }

  function chooseTarget(size){
    var W=api.W,H=api.H,m=3;
    var best=null,bestD=-1e9;
    for(var i=0;i<60;i++){
      var x=m+size/2+Math.random()*Math.max(1,W-size-m*2);
      var y=m+size/2+Math.random()*Math.max(1,H-size-m*2);
      var d=1e9;
      for(var j=0;j<ducks.length;j++){
        var dk=ducks[j];
        var dx=dk.x-x,dy=dk.ty-y,dd=Math.sqrt(dx*dx+dy*dy)-(dk.size+size)*0.4;
        if(dd<d)d=dd;
      }
      if(d>=0){ best={x:x,y:y}; break; }
      if(d>bestD){ bestD=d; best={x:x,y:y}; }
    }
    return best||{x:W/2,y:H/2};
  }

  function makeDuck(started,opt){
    // 按短边算：横屏就是窗口高度（和原来一样），竖屏直播时不会大到占半屏
    var size=Math.max(20,Math.round(Math.min(api.W,api.H)*sizeFor(opt&&opt.size)/100));
    var t=chooseTarget(size);
    return {
      x:t.x, y:-size, ty:t.y, size:size,
      frame:Math.floor(Math.random()*frames.length)||0,
      phase:'wait', started:started, t0:0
    };
  }

  function flushQueue(){
    var avail=Math.max(0, maxVisible()-ducks.length);
    var batch=Math.min(pending.total, 50, avail);
    for(var i=0;i<batch;i++){
      ducks.push(makeDuck(nowMs+i*24, pending.take()));   // 同批 24ms 错峰
    }
  }

  // 弹跳落下缓动（OutBounce）
  function outBounce(p){
    var n1=7.5625, d1=2.75;
    if(p<1/d1) return n1*p*p;
    if(p<2/d1) return n1*(p-=1.5/d1)*p+0.75;
    if(p<2.5/d1) return n1*(p-=2.25/d1)*p+0.9375;
    return n1*(p-=2.625/d1)*p+0.984375;
  }

  // 计数面板：一直显示 / 场上有东西时显示（默认）/ 不显示——好几个玩法同在一个窗口，用过的面板别一直堆在左上角
  function statsShown(){ var m=String(api.cfg.statsPanel||'active'); if(m==='off') return false; if(m==='always') return true; return ducks.length>0||pending.total>0; }
  function drawStats(ctx){
    if(!statsShown()){ if(api.hud) api.hud(0); return; }
    var fs=Math.max(13,Math.min(20,api.W*0.016));
    var lines=['已经抓 '+caught+' 只','等待落下：'+pending.total+' 只'];
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

  // 触发提示气泡：头像 + 名字 + 送了 + N 个鸭子（金），居中 y=max(60,34%H)，1.5s
  function drawPrompts(ctx){
    var now=nowMs;
    for(var i=prompts.length-1;i>=0;i--){
      var p=prompts[i];
      var left=(p.until-now)/1500;
      if(left<=0){ prompts.splice(i,1); continue; }
      var alpha=Math.min(1,left*3);
      var fs=Math.max(15,api.W*0.017);
      var avR=fs*1.6;
      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
      var t1=p.name, t2=' 送了 ', t3=p.count+' 个鸭子';
      var w1=ctx.measureText(t1).width, w2=ctx.measureText(t2).width, w3=ctx.measureText(t3).width;
      if(w1>api.W*0.22){ while(t1.length>1 && ctx.measureText(t1+'…').width>api.W*0.22) t1=t1.slice(0,-1); t1+='…'; w1=ctx.measureText(t1).width; }
      var padX=fs*0.9, boxW=avR*2+fs*0.7+w1+w2+w3+padX*2, boxH=avR*2+fs*0.8;
      var bx=api.W/2-boxW/2, by=Math.max(60,api.H*0.34);
      ZL.roundRect(ctx,bx,by,boxW,boxH,12);
      ctx.fillStyle='rgba(20,20,20,0.88)'; ctx.fill();
      ctx.lineWidth=1; ctx.strokeStyle='#d5a321'; ctx.stroke();
      var ax=bx+padX+avR, ay=by+boxH/2;
      // 头像：有图裁圆，无图名字首字
      var im=p.avatarImg;
      ctx.save();
      ctx.beginPath(); ctx.arc(ax,ay,avR,0,6.2832); ctx.closePath(); ctx.clip();
      if(ZL.imgOk(im)){
        var s=Math.max(avR*2/im.naturalWidth,avR*2/im.naturalHeight);
        ctx.drawImage(im,ax-im.naturalWidth*s/2,ay-im.naturalHeight*s/2,im.naturalWidth*s,im.naturalHeight*s);
      }else{
        ctx.fillStyle='#3a4b60'; ctx.fillRect(ax-avR,ay-avR,avR*2,avR*2);
        ctx.fillStyle='rgba(255,255,255,0.85)';
        ctx.font='700 '+avR+'px "Microsoft YaHei",sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText((p.name||'观').charAt(0),ax,ay);
      }
      ctx.restore();
      ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(ax,ay,avR,0,6.2832); ctx.stroke();
      var tx=ax+avR+fs*0.7, ty=ay;
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
      ctx.fillStyle='#ffffff'; ctx.fillText(t1,tx,ty);
      ctx.font='400 '+fs*0.94+'px "Microsoft YaHei",sans-serif';
      ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fillText(t2,tx+w1,ty);
      ctx.font='700 '+(fs*1.06)+'px "Microsoft YaHei",sans-serif';
      ctx.fillStyle='#ffd54a'; ctx.fillText(t3,tx+w1+w2,ty);
      ctx.restore();
    }
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      pending=ZL.queue();
      for(var i=0;i<5;i++) frames.push(ZL.img('duck/duck_angle_'+(i+1)+'.png'));
      caught=ZL.loadTotal('catch_duck');
    },
    resize:function(){},
    config:function(){},
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ ducks=[]; pending.clear(); prompts=[]; return; }
      if(op==='reset'){ caught=0; ZL.saveTotal('catch_duck',0); return; }
      var n=Math.min(ZL.count(cmd,5), api.cap());
      var size=String((cmd&&cmd.size)||'random');
      pending.push(Math.min(n, 999999999-pending.total), { size:size }, sameOpt);
      batchClock=0;
      var name=ZL.who(cmd);
      if(name){
        prompts.push({ name:name, avatarImg:cmd.avatar?ZL.imgRaw(cmd.avatar):null, count:n, until:nowMs+1500 });
        if(prompts.length>4) prompts.shift();
      }
    },
    pointer:function(type,x,y){
      if(type!=='down') return;
      // 逆序（上层优先）找被点中的鸭子
      for(var i=ducks.length-1;i>=0;i--){
        var d=ducks[i];
        if(d.phase==='wait') continue;
        if(Math.abs(x-d.x)<=d.size/2 && Math.abs(y-d.y)<=d.size/2){
          ducks.splice(i,1);
          caught++; ZL.saveTotal('catch_duck',caught);
          ZL.snd('duck/duck_appear.mp3');
          return true;
        }
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      batchClock+=step;
      if(pending.total>0 && (batchClock>=1200 || ducks.length===0)){ batchClock=0; flushQueue(); }
      var active=pending.total>0||prompts.length>0;
      var now=nowMs;
      for(var i=0;i<ducks.length;i++){
        var d=ducks[i];
        if(d.phase==='wait'){
          if(now>=d.started){ d.phase='drop'; d.t0=now; ZL.snd('duck/duck_appear.mp3'); }
          else { active=true; continue; }
        }
        if(d.phase==='drop'){
          active=true;
          var p=(now-d.t0)/700;   // 0.7s 落下
          if(p>=1){ d.y=d.ty; d.phase='sit'; }
          else d.y=-d.size+(d.ty+d.size)*outBounce(Math.max(0,p));
        }
      }
      return active;
    },
    draw:function(ctx){
      for(var i=0;i<ducks.length;i++){
        var d=ducks[i];
        if(d.phase==='wait') continue;
        var im=frames[d.frame]||frames[0];
        var crop=CROPS[d.frame]||CROPS[0];
        if(ZL.imgOk(im)){
          // 按裁剪矩形取本体，缩放到 size（以裁剪框宽为基准）
          var scale=d.size/crop[2];
          var dw=crop[2]*scale, dh=crop[3]*scale;
          ctx.drawImage(im, crop[0],crop[1],crop[2],crop[3], d.x-dw/2, d.y-dh/2, dw, dh);
        }else{
          ctx.save();
          ctx.fillStyle='#f4c542'; ctx.beginPath(); ctx.arc(d.x,d.y,d.size/2,0,6.2832); ctx.fill();
          ctx.restore();
        }
      }
      drawStats(api.hudCtx||ctx);
      drawPrompts(api.hudCtx||ctx);
    },
    stats:function(){ return { value:caught }; },
    // 只读调试钩子（离线验收用，生产不调用）：可点的鸭子中心点
    debug:function(){
      var hits=[];
      for(var i=0;i<ducks.length;i++) if(ducks[i].phase!=='wait') hits.push([ducks[i].x,ducks[i].y,ducks[i].size]);
      return { pending:pending.total, count:ducks.length, caught:caught, hits:hits };
    }
  };
})());
`
