// 「手势拍蚊子 / 手势拍苍蝇」共用引擎（big_mosquito / gesture_fly 两个玩法只差素材与名字）。
// 鼠标挥拍（快速移动鼠标扫过目标）+ 点击拍 + 可选声控拍手；HP 制 + 红闪 0.24s + 坠落 0.85s。
// 操作：add（大小 big/small/random：random 在小~大之间分 5 档，血量跟着档位插值）/ reduce（先扣排队，再随机直接拍死场上的）/ clear。
// 超过同屏上限的排队，场上少了自动补上。cfg.customImage 换掉目标图（苍蝇落地爬行也用它，走 api.fileUrl）；
// cfg.textSize 是头顶昵称字号；声控用 cfg.micDevice 指定的麦克风；嗡嗡声遵守静音。
// ★字符串里禁止反引号或 ${…}（CONF 是本文件 TS 层唯一一处插值）。

export interface SwatOpts {
  /** 主图（苍蝇用 fly.png，蚊子用 mosquito.png） */
  image: string
  /** 落地爬行帧（苍蝇 fly_crawl_1/2；蚊子为空=null 不落地） */
  crawlImages?: string[]
  /** 拍击音效 */
  slap: string
  /** 环境嗡鸣（可空） */
  buzz?: string
  /** 显示名（虫子/苍蝇） */
  bugName: string
  /** 尺寸/血量参数键名前缀（bigMosquito / bigFly） */
  sizeKey: string
  hpKey: string
  smallSizeKey: string
  smallHpKey: string
  /** 提示文案 */
  cue: string
}

export function buildSwatCode(opts: SwatOpts): string {
  // 配置注入（JS 对象字面量拼进字符串，素材路径无中文无反引号）
  const CONF = JSON.stringify({
    image: opts.image,
    crawl: opts.crawlImages || [],
    slap: opts.slap,
    buzz: opts.buzz || '',
    bugName: opts.bugName,
    sizeKey: opts.sizeKey,
    hpKey: opts.hpKey,
    smallSizeKey: opts.smallSizeKey,
    smallHpKey: opts.smallHpKey,
    cue: opts.cue
  })
  return `
window.registerGame((function(){
  var ZL=window.__ZL;
  var CONF=${CONF};
  var api=null;
  var OPS=['add','reduce','clear'];
  var SPAWN_BATCH=256;     // 每帧最多补进场多少只
  var mainImg=null, crawlImgs=[], redCache={}, redCount=0;
  var customImg=null, customPath='';
  var bugs=[];             // {x,y,heading,target,nextTurn,speed,sizePct,hp,maxHp,phase,deadAt,flashUntil,state,crawlPhase,restUntil,name}
  var pending=null;        // 超出同屏上限的排队（按批合并，opt={size,name}）
  var nowMs=0;
  var clap=null, clapKey='', micState='', micKind='';
  var lastClapAt=0, lastGestureHitAt=0;
  var hand={x:-1,y:-1,px:-1,py:-1,pt:0};
  var buzzAu=null, buzzCheckAt=0;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function bigSize(){ return Math.max(10,Math.min(100,num(api.cfg[CONF.sizeKey],55))); }
  function smallSize(){ return Math.max(5,Math.min(100,num(api.cfg[CONF.smallSizeKey],18))); }
  function bigHp(){ return Math.max(1,Math.min(50,Math.trunc(num(api.cfg[CONF.hpKey],3)))); }
  function smallHp(){ return Math.max(1,Math.min(50,Math.trunc(num(api.cfg[CONF.smallHpKey],1)))); }
  function flightSpeed(){ return Math.max(10,Math.min(300,num(api.cfg.flightSpeed,50))); }
  function hitRadius(){ return Math.max(5,Math.min(40,num(api.cfg.hitRadius,13))); }
  function gestureSpeed(){ return Math.max(5,Math.min(100,num(api.cfg.gestureSpeed,30))); }
  function killPerClap(){ return Math.max(1,Math.trunc(num(api.cfg.killPerClap,1))); }
  function threshold(){ return Math.max(1,Math.min(500,num(api.cfg.threshold,180))); }
  function sensitivity(){ return Math.max(1,Math.min(100,num(api.cfg.clapSensitivity,70))); }
  function cooldown(){ return Math.max(50,Math.min(5000,num(api.cfg.cooldownMs,260))); }
  // 识别方式：clap = 识别拍手（掌声识别）；volume = 只看音量（任何声音够响就算）
  function triggerMode(){ return String(api.cfg.triggerMode||'clap')==='volume'?'volume':'clap'; }
  function maxVisible(){ return Math.max(1,Math.trunc(num(api.cfg.maxVisible,300))); }
  function textSize(){ return Math.max(12,Math.min(96,num(api.cfg.textSize,32))); }
  function controlMode(){ return String(api.cfg.controlMode||'mouse'); }
  function showTrigger(){ return api.cfg.showTriggerUser!==false; }
  function sameOpt(a,b){ return a.size===b.size&&a.name===b.name; }

  function shortSide(){ return Math.min(api.W,api.H); }
  function bugPx(b){ return shortSide()*b.sizePct/100; }
  function aliveCount(){ var n=0; for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt) n++; return n; }

  // 自定义目标图：路径变了才重新加载；加载失败（complete 但没像素）退回内置
  function syncCustom(){
    var p=String(api.cfg.customImage||'').trim();
    if(p===customPath) return;
    customPath=p;
    customImg=p?ZL.imgRaw(p):null;
    if(customImg&&!customImg.complete) customImg.addEventListener('load',ZL.kick);
  }
  function useCustom(){ return !!customImg && !(customImg.complete&&!ZL.imgOk(customImg)); }

  // 大小选项 → 尺寸百分比 + 血量：big/small 用对应参数；random 在小~大之间 5 档随机，血量按档位插值
  function makeBug(opt){
    var size=opt&&opt.size, sp, hp;
    if(size==='big'){ sp=bigSize(); hp=bigHp(); }
    else if(size==='small'){ sp=smallSize(); hp=smallHp(); }
    else {
      var t=Math.floor(Math.random()*5)/4;
      sp=smallSize()+(bigSize()-smallSize())*t;
      hp=Math.max(1,Math.round(smallHp()+(bigHp()-smallHp())*t));
    }
    return {
      x:0.08+Math.random()*0.84, y:0.08+Math.random()*0.84,
      heading:Math.random()*6.2832, target:Math.random()*6.2832,
      nextTurn:Math.random()*0.9, speed:0.018+Math.random()*0.03,
      sizePct:sp, hp:hp, maxHp:hp, phase:Math.random()*6.2832,
      deadAt:0, flashUntil:0, state:'fly', crawlPhase:Math.random()*6.2832,
      restUntil:nowMs+1200+Math.random()*4000, name:(opt&&opt.name)||''
    };
  }

  // 把排队的补进场（同屏上限内，每帧最多 256 只）
  function refill(){
    if(pending.total<=0) return;
    var room=Math.min(SPAWN_BATCH, Math.max(0, maxVisible()-aliveCount()));
    for(var i=0;i<room&&pending.total>0;i++) bugs.push(makeBug(pending.take()));
  }

  // 红闪贴图（SourceAtop 填红，半分辨率），按素材+尺寸缓存
  function redImg(im,w,h){
    var cw=Math.max(4,Math.round(w/2)), ch=Math.max(4,Math.round(h/2));
    var key=im.src+'|'+cw+'x'+ch;
    var cv=redCache[key];
    if(!cv){
      if(++redCount>64){ redCache={}; redCount=1; }   // 尺寸/换图多了就整表重来，防缓存无限长
      cv=document.createElement('canvas'); cv.width=cw; cv.height=ch;
      var c=cv.getContext('2d');
      c.drawImage(im,0,0,cw,ch);
      c.globalCompositeOperation='source-atop';
      c.fillStyle='rgba(255,25,35,0.8)';
      c.fillRect(0,0,cw,ch);
      redCache[key]=cv;
    }
    return cv;
  }

  function damage(cands, limit){
    // 按距离排序取前 limit 只；还在红闪（0.24s 内刚挨过一下）的不重复扣血——一次挥过去只算一巴掌
    for(var j=cands.length-1;j>=0;j--) if(cands[j].b.deadAt||cands[j].b.flashUntil>nowMs) cands.splice(j,1);
    cands.sort(function(a,b){ return a.d-b.d; });
    var hit=false;
    for(var i=0;i<cands.length&&i<limit;i++){
      var b=cands[i].b;
      b.hp--;
      b.flashUntil=nowMs+240;
      hit=true;
      if(b.hp<=0){ b.deadAt=nowMs; }
    }
    if(hit) ZL.snd(CONF.slap, 0.9);
    return hit;
  }

  // 挥拍：手位置命中半径内的候选
  function swatAt(nx, ny){
    var rad=hitRadius()/100;   // 归一化（按短边）
    var cands=[];
    for(var i=0;i<bugs.length;i++){
      var b=bugs[i];
      if(b.deadAt) continue;
      var bx=b.x*api.W/shortSide(), by=b.y*api.H/shortSide();
      var hx=nx*api.W/shortSide(), hy=ny*api.H/shortSide();
      var dx=bx-hx, dy=by-hy;
      var d=Math.sqrt(dx*dx+dy*dy)-bugPx(b)/shortSide()*0.35;
      if(d<=rad) cands.push({ d:d, b:b });
    }
    if(damage(cands, 5)){ lastGestureHitAt=nowMs; return true; }
    return false;
  }

  function swatRandom(n){
    var cands=[];
    for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt) cands.push({ d:Math.random(), b:bugs[i] });
    damage(cands, Math.max(1,n));
  }

  // reduce：不管血量，随机直接拍死 n 只
  function killRandom(n){
    var alive=[];
    for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt) alive.push(bugs[i]);
    var hit=false;
    for(var j=0;j<n&&alive.length>0;j++){
      var idx=Math.floor(Math.random()*alive.length);
      alive[idx].hp=0; alive[idx].deadAt=nowMs; alive[idx].flashUntil=nowMs+240;
      alive.splice(idx,1); hit=true;
    }
    if(hit) ZL.snd(CONF.slap, 0.9);
  }

  function clapMode(){ var m=controlMode(); return m==='clap'||m==='both'; }
  function micKeyNow(){ return [String(api.cfg.micDevice||''),threshold(),sensitivity(),cooldown(),triggerMode()].join('|'); }
  function startClapIfNeeded(){
    if(!clapMode()){ stopClap(); return; }
    if(clap||bugs.length===0) return;
    clapKey=micKeyNow();
    clap=ZL.startClap({
      sensitivity:sensitivity(), threshold:threshold(), cooldownMs:cooldown(), triggerMode:triggerMode(), deviceLabel:String(api.cfg.micDevice||''),
      onClap:function(){
        var now=nowMs;
        if(now-lastClapAt<cooldown()) return;
        if(now-lastGestureHitAt<650) return;   // 手势优先去重
        lastClapAt=now;
        swatRandom(killPerClap());
        ZL.kick();
      },
      onState:function(st){
        if(st==='no-mic'){ micState='麦克风不可用'; micKind='error'; }
        else if(st==='preview'){ micState='预览不收音'; micKind='preview'; }
        else { micState=''; micKind=''; }
        ZL.kick();
      }
    });
  }
  function stopClap(){ if(clap){ clap.stop(); clap=null; } micState=''; micKind=''; }

  function stopBuzz(){ if(buzzAu){ try{ buzzAu.pause(); }catch(e){} buzzAu=null; } }
  function syncBuzz(){
    if(!CONF.buzz) return;
    if(nowMs<buzzCheckAt) return;
    buzzCheckAt=nowMs+800;
    var flying=0;
    for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt && bugs[i].state==='fly') flying++;
    var master=Number(api.cfg.volume); if(!(master>=0)) master=100;
    if(flying<=0||master<=0||api.muted()){ stopBuzz(); return; }
    if(!buzzAu){
      buzzAu=new Audio(api.asset(CONF.buzz));
      buzzAu.loop=true;
      buzzAu.play().catch(function(){});
    }
    buzzAu.volume=Math.max(0,Math.min(1, master/100*0.55));
  }

  // 提示文字：按控制方式
  function cueText(){
    var m=controlMode();
    var head=m==='clap'?'拍手打'+CONF.bugName:(m==='both'?'挥手或拍手打'+CONF.bugName:CONF.cue);
    var left=aliveCount()+pending.total;
    return head+'  剩余 '+left+' 只';
  }

  return {
    init:function(a){
      api=a; ZL.bind(a);
      pending=ZL.queue();
      mainImg=ZL.img(CONF.image);
      for(var i=0;i<CONF.crawl.length;i++) crawlImgs.push(ZL.img(CONF.crawl[i]));
      syncCustom();
    },
    resize:function(){},
    config:function(){
      syncCustom();
      // 换了麦克风 / 阈值 / 灵敏度 / 控制方式：重开监听（下一帧按需自动开）
      if(clap&&(micKeyNow()!==clapKey||!clapMode())) stopClap();
      buzzCheckAt=0;
    },
    mute:function(on){ if(on) stopBuzz(); buzzCheckAt=0; },
    apply:function(cmd){
      var op=ZL.op(cmd,OPS);
      if(op==='clear'){ bugs=[]; pending.clear(); stopClap(); stopBuzz(); return; }
      var n=ZL.count(cmd,3);
      if(op==='reduce'){
        var q=pending.drop(n);
        killRandom(n-q);
        return;
      }
      n=Math.min(n,api.cap());
      pending.push(Math.min(n, 999999999-pending.total), { size:String((cmd&&cmd.size)||'random'), name:ZL.who(cmd) }, sameOpt);
      refill();
    },
    pointer:function(type,x,y){
      var m=controlMode();
      // 拍手声控模式：麦克风不可用 / 详情页预览（不收音）时鼠标照样能拍，不然打不完
      if(m!=='mouse'&&m!=='both'&&micKind!=='error'&&micKind!=='preview') return;
      // 挥拍测速按真实时间（以前用画面时钟：同一帧里的移动被跳过，刷新率越高越难挥中）
      var now=performance.now();
      if(type==='move'){
        if(hand.pt>0&&now-hand.pt<250){
          var dt=Math.max(0.004,(now-hand.pt)/1000);
          var dist=Math.sqrt((x-hand.px)*(x-hand.px)+(y-hand.py)*(y-hand.py));
          var spd=dist/shortSide()*100/dt;   // %短边/秒
          if(spd>=gestureSpeed()) swatAt(x/api.W, y/api.H);
        }
        hand.px=x; hand.py=y; hand.pt=now;
      } else if(type==='down'){
        var hitBug=swatAt(x/api.W, y/api.H);
        hand.px=x; hand.py=y; hand.pt=now;
        return hitBug;
      }
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      refill();
      if(bugs.length===0){ stopClap(); stopBuzz(); return false; }
      startClapIfNeeded();
      syncBuzz();
      var alive=false;
      var dtS=Math.min(0.05,Math.max(0.001,step/1000));
      var spdScale=flightSpeed()/50;
      var canCrawl=crawlImgs.length>0;
      for(var i=bugs.length-1;i>=0;i--){
        var b=bugs[i];
        if(b.deadAt){
          var dp=(nowMs-b.deadAt)/850;
          if(dp>=1){ bugs.splice(i,1); continue; }
          b.y+=dp*dtS*0.75;
          alive=true; continue;
        }
        alive=true;
        if(b.state==='fly'){
          b.nextTurn-=dtS;
          if(b.nextTurn<=0){ b.nextTurn=0.18+Math.random()*0.72; b.target=Math.random()*6.2832; }
          if(b.x<0.08) b.target=(Math.random()*2-1)*0.65;
          if(b.x>0.92) b.target=Math.PI+(Math.random()*2-1)*0.65;
          if(b.y<0.08) b.target=0.35+Math.random()*(Math.PI-0.7);
          if(b.y>0.92) b.target=Math.PI+0.35+Math.random()*(Math.PI-0.7);
          var d=b.target-b.heading;
          while(d>Math.PI)d-=6.2832; while(d<-Math.PI)d+=6.2832;
          b.heading+=d*Math.min(1,dtS*3.2);
          b.speed+=(Math.random()*2-1)*0.012*dtS;
          b.speed=Math.max(0.018,Math.min(0.075,b.speed));
          b.x+=Math.cos(b.heading)*b.speed*dtS*spdScale;
          b.y+=Math.sin(b.heading)*b.speed*dtS*spdScale;
          b.x=Math.max(0.025,Math.min(0.975,b.x));
          b.y=Math.max(0.035,Math.min(0.965,b.y));
          // 苍蝇：飞累了落地爬行
          if(canCrawl && nowMs>=b.restUntil){ b.state='crawl'; b.restUntil=nowMs+2000+Math.random()*4500; }
        } else {
          // 爬行：小步挪动
          b.crawlPhase+=dtS*8;
          b.x+=Math.cos(b.heading)*0.006*dtS;
          b.y+=Math.sin(b.heading)*0.006*dtS;
          if(Math.random()<dtS*0.7) b.heading+=(Math.random()*2-1)*1.2;
          b.x=Math.max(0.025,Math.min(0.975,b.x));
          b.y=Math.max(0.035,Math.min(0.965,b.y));
          if(nowMs>=b.restUntil){ b.state='fly'; b.restUntil=nowMs+2500+Math.random()*5000; }
        }
      }
      // 最后一只拿掉的这一帧就关麦克风、停嗡嗡声：返回 false 以后不会再 tick（以前打完麦克风一直开着）
      if(bugs.length===0){ stopBuzz(); stopClap(); }
      return alive;
    },
    draw:function(ctx){
      var t=nowMs/1000;
      var custom=useCustom();
      var nameFs=textSize();
      var i;
      for(i=0;i<bugs.length;i++){
        var b=bugs[i];
        var px=bugPx(b);
        var x=b.x*api.W, y=b.y*api.H;
        var rot=Math.sin(t*b.speed*40+b.phase)*0.8;
        var alpha=1;
        var im=custom?customImg:mainImg;
        if(b.deadAt){ var dp=(nowMs-b.deadAt)/850; rot=dp*5+b.phase; alpha=1-dp; }
        else if(b.state==='crawl'&&crawlImgs.length>0){
          // 爬行帧：自定义图就用它本身轻轻扭动，内置用两帧交替
          if(!custom) im=crawlImgs[Math.floor(b.crawlPhase)%crawlImgs.length];
          rot=Math.sin(b.crawlPhase*(custom?0.9:0.4))*(custom?0.18:0.1);
        }
        ctx.save();
        ctx.globalAlpha*=alpha;
        ctx.translate(x,y);
        if(!b.deadAt && b.state==='fly'){ ctx.rotate(b.heading*0.22+rot*0.35); if(Math.cos(b.heading)<0) ctx.scale(-1,1); }
        else ctx.rotate(rot);
        if(ZL.imgOk(im)){
          var wh=ZL.fit(im,px);   // 自定义图不一定是方的：等比塞进 px 见方
          var drawEl=b.flashUntil>nowMs?redImg(im,Math.min(1024,wh[0]),Math.min(1024,wh[1])):im;
          ctx.drawImage(drawEl,-wh[0]/2,-wh[1]/2,wh[0],wh[1]);
        }else{
          ctx.fillStyle='#444'; ctx.beginPath(); ctx.arc(0,0,px*0.35,0,6.2832); ctx.fill();
        }
        ctx.restore();
        // 血条（多血时）
        if(!b.deadAt && b.maxHp>1 && b.hp<b.maxHp){
          var bw=px*0.5, bh=Math.max(3,px*0.035);
          ctx.save();
          ZL.roundRect(ctx,x-bw/2,y-px*0.42,bw,bh,bh/2);
          ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fill();
          ZL.roundRect(ctx,x-bw/2,y-px*0.42,bw*b.hp/b.maxHp,bh,bh/2);
          ctx.fillStyle='#ff5348'; ctx.fill();
          ctx.restore();
        }
        // 触发者名牌（少量时）：字号 = cfg.textSize
        if(showTrigger()&&b.name&&bugs.length<=40&&!b.deadAt){
          var fs=nameFs;
          ctx.save();
          ctx.font='600 '+fs+'px "Microsoft YaHei",sans-serif';
          var label=b.name;
          var maxW=Math.max(fs*4,api.W*0.4);
          if(ctx.measureText(label).width>maxW){ while(label.length>1&&ctx.measureText(label+'…').width>maxW) label=label.slice(0,-1); label+='…'; }
          var tw=ctx.measureText(label).width;
          var by=y-px*0.5-fs*1.1;
          var bx=Math.max(tw/2+fs*0.5, Math.min(api.W-tw/2-fs*0.5, x));   // 名牌水平钳在窗口内
          ZL.roundRect(ctx,bx-tw/2-fs*0.5,by-fs*0.85,tw+fs,fs*1.7,fs*0.85);
          ctx.fillStyle='rgba(20,22,28,0.7)'; ctx.fill();
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillStyle='#ffe9a8';
          ctx.fillText(label,bx,by);
          ctx.restore();
        }
      }
      // 提示文字（左上）：走计数面板排位，几个玩法同时在场时上下排开（以前固定画在 12,12，会和别的面板叠住）
      var hctx=api.hudCtx||ctx;
      if(bugs.length>0||pending.total>0){
        var cue=cueText();
        var fs2=Math.max(15,Math.min(32,api.W*0.025)), bh2=fs2*2.1;
        var top2=api.hud?api.hud(bh2):12;
        hctx.save();
        hctx.font='700 '+fs2+'px "Microsoft YaHei",sans-serif';
        var tw2=hctx.measureText(cue).width;
        ZL.roundRect(hctx,12,top2,tw2+fs2*1.6,bh2,fs2);
        hctx.fillStyle='rgba(20,22,28,0.66)'; hctx.fill();
        hctx.lineWidth=1.5; hctx.strokeStyle='rgba(255,255,255,0.16)'; hctx.stroke();
        hctx.textAlign='left'; hctx.textBaseline='middle';
        hctx.lineJoin='round'; hctx.lineWidth=Math.max(2,fs2*0.14); hctx.strokeStyle='rgba(0,0,0,0.6)';
        hctx.strokeText(cue,12+fs2*0.8,top2+bh2/2);
        hctx.fillStyle='#fff'; hctx.fillText(cue,12+fs2*0.8,top2+bh2/2);
        hctx.restore();
      } else if(api.hud) api.hud(0);
      if(bugs.length>0||pending.total>0){
        if(micState){
          ctx.save();
          ctx.font='600 '+Math.max(13,api.W*0.013)+'px "Microsoft YaHei",sans-serif';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillStyle=micKind==='preview'?'rgba(255,255,255,0.8)':'rgba(255,140,140,0.85)';
          ctx.fillText(micState, api.W/2, api.H-18);
          ctx.restore();
        }
      }
    },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      var hits=[], sizes=[], hps=[], hpNow=[];
      for(var i=0;i<bugs.length;i++) if(!bugs[i].deadAt){ hits.push([bugs[i].x*api.W,bugs[i].y*api.H]); sizes.push(bugs[i].sizePct); hps.push(bugs[i].maxHp); hpNow.push(bugs[i].hp); }
      return { alive:aliveCount(), pending:pending.total, count:bugs.length, hits:hits, sizes:sizes, hps:hps, hpNow:hpNow, custom:useCustom(), micState:micState, micKind:micKind, clap:!!clap, media:buzzAu?[buzzAu]:[] };
    }
  };
})());
`
}
