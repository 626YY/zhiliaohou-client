// 特色玩法「抓子弹」的页面内 Canvas 代码。
// 子弹从顶部落下、在底部按最多 6 列堆叠（落速快会反弹一次），主播点击抓住；被抽走的那列上方子弹重新落下补位。
// 操作：add / reduce（直接移除：先扣还没落下的排队，再从场上最新的往回移除）/ clear 清场 / reset 累计清零。
// 素材：catch_bullet/catch_bullet_default.png（941×1672 竖弹）+ catch_bullet_collision.mp3（落地定住时播）；
//      cfg.customImages（多张，每颗随机一张）/ customSound 可换本地文件（走 api.fileUrl）。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['add','reduce','clear','reset'];
  var defaultImg=null;
  var customImgs=[], customKey='';
  var bullets=[];          // {x,y,w,h,vx,vy,angle,spin,column,landed,everLanded,bounced,img}
  var pending=0, spawnClock=0;
  var caught=0;
  var nowMs=0;
  var prompt=null;         // {text, until}
  var lastSndAt=0;

  var COLS=6;
  var BASE_W=96, BASE_H=256;     // 贴图统一等比缩到 ≤96×256
  var DEFAULT_ASPECT=941/1672;   // 内置子弹图宽高比（图没加载好时用）

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function sizePct(){ return Math.max(50,Math.min(200,num(api.cfg.sizePercent,100)))/100; }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,300))); }
  function boxScale(){ return sizePct()*Math.min(1.4, api.H/720); }

  // 自定义子弹图（换行分隔的多张）：路径串变了才重新加载
  function syncCustom(){
    var key=String(api.cfg.customImages||'');
    if(key===customKey) return;
    customKey=key;
    customImgs=[];
    var list=ZL.paths(key);
    for(var i=0;i<list.length;i++){
      var im=ZL.imgRaw(list[i]);
      if(im){ customImgs.push(im); if(!im.complete) im.addEventListener('load',ZL.kick); }
    }
  }
  // 每颗随机挑一张：有自定义图就从里面挑（加载失败的跳过），否则内置
  function pickSprite(){
    var ok=[];
    for(var i=0;i<customImgs.length;i++){ var im=customImgs[i]; if(!(im.complete&&!ZL.imgOk(im))) ok.push(im); }
    return ok.length?ok[Math.floor(Math.random()*ok.length)]:defaultImg;
  }
  // 按贴图宽高比塞进 96×256（×缩放）的盒子
  function fitBox(im){
    var asp=ZL.imgOk(im)? im.naturalWidth/im.naturalHeight : DEFAULT_ASPECT;
    var mw=BASE_W*boxScale(), mh=BASE_H*boxScale();
    if(asp>mw/mh) return [mw, mw/asp];
    return [mh*asp, mh];
  }

  function colX(c){ return api.W*(c+0.5)/COLS; }
  // 该列已落地子弹堆出来的高度 → 这颗子弹的堆叠目标 y（中心）
  function pileTarget(b){
    var stack=0;
    for(var i=0;i<bullets.length;i++){ var o=bullets[i]; if(o!==b && o.landed && o.column===b.column) stack+=o.h*0.32; }
    return api.H-10-b.h/2-stack;
  }
  function chooseColumn(){
    // 选堆得最矮的列，并列时随机
    var counts=[],i,c;
    for(c=0;c<COLS;c++) counts.push(0);
    for(i=0;i<bullets.length;i++) if(bullets[i].landed) counts[bullets[i].column]++;
    var bestN=1e9;
    for(c=0;c<COLS;c++) if(counts[c]<bestN) bestN=counts[c];
    var ties=[];
    for(c=0;c<COLS;c++) if(counts[c]===bestN) ties.push(c);
    return ties[Math.floor(Math.random()*ties.length)];
  }

  // 最矮那一列还放得下一颗（落定后整颗在画面里）才放新的；堆满了先留在队里，主播点掉一些再落
  // （以前一直往上堆，720p 每列十来颗就堆出窗口顶，新来的停在画面上方看不见）
  function hasRoom(){
    var stacks=[], c, i, h=BASE_H*boxScale();
    for(c=0;c<COLS;c++) stacks.push(0);
    for(i=0;i<bullets.length;i++) stacks[bullets[i].column]+=bullets[i].h*0.32;   // 还在落的也算，马上就落到那一列
    var best=1e9;
    for(c=0;c<COLS;c++) if(stacks[c]<best) best=stacks[c];
    return api.H-10-best-h>=0;
  }

  function spawnOne(){
    var c=chooseColumn();
    var im=pickSprite();
    var wh=fitBox(im);
    bullets.push({
      x:colX(c)+(Math.random()*2-1)*api.W/COLS*0.3, y:-wh[1], colJit:(Math.random()*2-1)*0.3,
      w:wh[0], h:wh[1], img:im,
      vx:(Math.random()*2-1)*30, vy:Math.random()*40,
      angle:Math.random()*6.28, spin:(Math.random()*2-1)*2.4,
      column:c, landed:false, bounced:false, everLanded:false
    });
  }

  // 抽走子弹后重排受影响的列：比新目标高出来的子弹松开重新落下（带一点被砸动的横移和旋转）
  function reflow(cols){
    for(var c in cols){
      var col=Number(c), list=[], i;
      for(i=0;i<bullets.length;i++) if(bullets[i].landed&&bullets[i].column===col) list.push(bullets[i]);
      list.sort(function(a,b){ return b.y-a.y; });   // 从底往上
      var stack=0;
      for(i=0;i<list.length;i++){
        var b=list[i];
        var tgt=api.H-10-b.h/2-stack;
        if(b.y<tgt-1){
          b.landed=false; b.bounced=true; b.vy=0;
          b.vx=(Math.random()*2-1)*35;
          b.spin=(Math.random()<0.5?-1:1)*(1.2+Math.random()*1.9);
        } else stack+=b.h*0.32;
      }
    }
  }

  function removeAt(i,cols){
    var b=bullets[i];
    bullets.splice(i,1);
    if(b&&b.landed) cols[b.column]=1;
  }

  function landSnd(){
    var cs=String(api.cfg.customSound||'').trim();
    if(cs) ZL.sndRaw(cs); else ZL.snd('catch_bullet/catch_bullet_collision.mp3');
  }

  // 计数面板：一直显示 / 场上有东西时显示（默认）/ 不显示——好几个玩法同在一个窗口，用过的面板别一直堆在左上角
  function statsShown(){ var m=String(api.cfg.statsPanel||'active'); if(m==='off') return false; if(m==='always') return true; return bullets.length>0||pending>0; }
  function drawStats(ctx){
    if(!statsShown()){ if(api.hud) api.hud(0); return; }
    var fs=Math.max(13,Math.min(20,api.W*0.016));
    var flying=0,i;
    for(i=0;i<bullets.length;i++) if(!bullets[i].landed) flying++;
    var lines=['已经抓 '+caught+' 颗','未落下：'+(pending+flying)+' 颗'];
    ctx.save();
    ctx.font='600 '+fs+'px "Microsoft YaHei",sans-serif';
    var w=0;
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

  // 中部提示条：y=38%H，金边深色底白字，3 秒
  function drawPrompt(ctx){
    if(!prompt) return;
    var left=(prompt.until-nowMs)/300;
    if(left<=0){ prompt=null; return; }
    var alpha=Math.min(1,left);
    var fs=Math.max(15,api.W*0.019);
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
    var tw=ctx.measureText(prompt.text).width;
    var bw=Math.min(api.W-24, Math.max(180, tw+fs*2.4));
    var bh=fs*2.84, bx=api.W/2-bw/2, by=api.H*0.52-bh/2;
    ZL.roundRect(ctx,bx,by,bw,bh,bh/2);
    ctx.fillStyle='rgba(22,19,15,0.87)'; ctx.fill();
    ctx.lineWidth=1; ctx.strokeStyle='rgb(223,161,58)'; ctx.stroke();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#fff';
    var t=prompt.text;
    if(ctx.measureText(t).width>bw-fs*2){
      while(t.length>4 && ctx.measureText(t+'…').width>bw-fs*2) t=t.slice(0,-1);
      t+='…';
    }
    ctx.fillText(t,api.W/2,by+bh/2);
    ctx.restore();
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      defaultImg=ZL.img('catch_bullet/catch_bullet_default.png');
      caught=ZL.loadTotal('catch_bullet');
      syncCustom();
    },
    // 改窗口大小（一键切竖屏）：每列按新尺寸重新堆好，别把底下一排留在画面外点不到
    resize:function(){
      var byCol={}, i, j;
      for(i=0;i<bullets.length;i++){
        var b=bullets[i];
        if(b.landed){ b.x=colX(b.column)+(b.colJit||0)*api.W/COLS; (byCol[b.column]=byCol[b.column]||[]).push(b); }
        b.x=ZL.clamp(b.x,b.w*0.4,Math.max(b.w*0.4,api.W-b.w*0.4));
      }
      for(var c in byCol){
        var list=byCol[c], stack=0;
        list.sort(function(a,b){ return b.y-a.y; });
        for(j=0;j<list.length;j++){ list[j].y=api.H-10-list[j].h/2-stack; stack+=list[j].h*0.32; }
      }
    },
    config:function(){ syncCustom(); },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      var name=ZL.who(cmd);
      if(op==='clear'){ bullets=[]; pending=0; prompt=null; return; }
      if(op==='reset'){ caught=0; ZL.saveTotal('catch_bullet',0); return; }
      var n=ZL.count(cmd,5);
      if(op==='reduce'){
        // 先扣还没落下的排队，再从场上最新的往回移除
        var fromQueue=Math.min(pending,n);
        pending-=fromQueue;
        var left=n-fromQueue, cols={};
        for(var i=bullets.length-1;i>=0&&left>0;i--){ removeAt(i,cols); left--; }
        reflow(cols);
        // 提示按实际减掉的数量（以前写的是请求数，场上没那么多也说减少了 n 颗）
        var removed=n-left;
        if(name&&removed>0) prompt={ text:name+' 减少了 '+removed+' 颗子弹', until:nowMs+3000 };
        return;
      }
      n=Math.min(n,api.cap());
      pending=Math.min(pending+n, 999999999);
      if(name) prompt={ text:name+' 送了 '+n+' 颗子弹', until:nowMs+3000 };
    },
    pointer:function(type,x,y){
      if(type!=='down') return;
      for(var i=bullets.length-1;i>=0;i--){
        var b=bullets[i];
        if(Math.abs(x-b.x)<=b.w*0.62 && Math.abs(y-b.y)<=b.h*0.52){
          var cols={};
          removeAt(i,cols);
          reflow(cols);
          caught++; ZL.saveTotal('catch_bullet',caught);
          return true;
        }
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      var now=nowMs;
      // 生成节流：每 0.15s 放 6 颗
      spawnClock+=step;
      if(pending>0 && spawnClock>=150){
        spawnClock=0;
        var room=Math.max(0, maxVisible()-bullets.length);
        var batch=Math.min(pending, 6, room), spawned=0;
        for(var s=0;s<batch&&hasRoom();s++){ spawnOne(); spawned++; }
        pending-=spawned;
      }
      // 堆满了在等主播点：不用一直刷帧，点掉一颗时会被叫醒
      var active=(pending>0&&hasRoom()) || (prompt!=null && nowMs<prompt.until);
      var g=api.H*1.9;   // 像素重力
      for(var i=0;i<bullets.length;i++){
        var b=bullets[i];
        if(b.landed) continue;
        active=true;
        var d=step/1000;
        b.vy+=g*d;
        b.x+=b.vx*d; b.y+=b.vy*d;
        b.angle+=b.spin*d;
        // 撞墙反弹
        if(b.x<b.w*0.4){ b.x=b.w*0.4; b.vx=Math.abs(b.vx)*0.4; }
        if(b.x>api.W-b.w*0.4){ b.x=api.W-b.w*0.4; b.vx=-Math.abs(b.vx)*0.4; }
        var target=pileTarget(b);
        if(b.y>=target){
          b.y=target;
          if(!b.everLanded && !b.bounced && b.vy>180){
            b.vy=-Math.min(270, b.vy*0.25); b.bounced=true; b.everLanded=true;
          }else{
            b.vy=0; b.vx=0; b.spin=0; b.landed=true; b.everLanded=true; b.angle=0;
            if(now-lastSndAt>35){ lastSndAt=now; landSnd(); }
          }
        }
      }
      return active;
    },
    draw:function(ctx){
      for(var i=0;i<bullets.length;i++){
        var b=bullets[i];
        var im=b.img;
        if(!ZL.imgOk(im)) im=defaultImg;   // 自定义图坏了就画内置
        ctx.save();
        ctx.translate(b.x,b.y); ctx.rotate(b.angle);
        if(ZL.imgOk(im)){
          var asp=im.naturalWidth/im.naturalHeight;
          var dw=b.w, dh=b.w/asp;
          if(dh>b.h){ dh=b.h; dw=b.h*asp; }
          ctx.drawImage(im,-dw/2,-dh/2,dw,dh);
        }
        else { ctx.fillStyle='rgb(211,157,69)'; ctx.fillRect(-b.w/2,-b.h/2,b.w,b.h); }
        ctx.restore();
      }
      drawStats(api.hudCtx||ctx);
      drawPrompt(api.hudCtx||ctx);
    },
    stats:function(){ return { value:caught }; },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      var hits=[], flying=0;
      for(var i=0;i<bullets.length;i++){ if(bullets[i].landed) hits.push([bullets[i].x,bullets[i].y,bullets[i].h]); else flying++; }
      return { pending:pending, count:bullets.length, flying:flying, caught:caught, hits:hits, customs:customImgs.length };
    }
  };
})());
`
