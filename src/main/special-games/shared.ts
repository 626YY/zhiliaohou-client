// 特色玩法共享页面助手（每个玩法的页面内 JS 都拼上这一段）。
// 提供：素材图加载缓存 / 居中画图 / 圆角矩形 / 计数胶囊 / 限声道音效 / 缓动 / 麦克风掌声检测。
// ★与玩法代码同样的约束：字符串里禁止反引号与 ${…}；运行环境是采集窗口页面（api 由 HARNESS_JS 提供）。

// —— 素材与绘制 ——
export const SHARED_JS = `
window.__ZL=window.__ZL||{};
(function(){
var ZL=window.__ZL;
var API=null;
ZL.bind=function(api){API=api;};
var imgCache={};
ZL.img=function(rel){
  var im=imgCache[rel];
  if(!im){
    // 不设 crossOrigin：预览里素材走 zlspecial、头像走抖音 CDN，要求 CORS 反而加载失败；画布不读像素，污染无所谓
    im=new Image();
    im.src=/^(https?|file|data|zlspecial|zlmedia):/i.test(rel)?rel:API.asset(rel);
    imgCache[rel]=im;
  }
  return im;
};
ZL.imgOk=function(im){ try{ return !!(im&&im.complete&&im.naturalWidth>0); }catch(e){ return false; } };
// 任意 URL/本地路径的图片（自定义素材）：路径换算交给运行时 api.fileUrl（预览和直播窗口走的通道不同）
ZL.imgRaw=function(pathOrUrl){
  var u=API.fileUrl(pathOrUrl); if(!u) return null;
  return ZL.img(u);
};
// 多文件参数（换行分隔的路径串）→ 数组 / 随机挑一个（空串 = 没选，调用方用内置素材）
ZL.paths=function(list){ return String(list||'').split(/\\r?\\n/).map(function(s){ return s.trim(); }).filter(Boolean); };
ZL.pickPath=function(list){ var arr=ZL.paths(list); return arr.length?arr[Math.floor(Math.random()*arr.length)]:''; };
// 居中画图（w/h 为实际像素；rot 弧度；alpha 0~1）。图没加载好返回 false，调用方画兜底。
ZL.drawImg=function(ctx,im,cx,cy,w,h,rot,alpha){
  if(!ZL.imgOk(im)) return false;
  ctx.save();
  if(alpha!=null&&alpha<1) ctx.globalAlpha*=alpha;
  if(rot){ ctx.translate(cx,cy); ctx.rotate(rot); ctx.drawImage(im,-w/2,-h/2,w,h); }
  else ctx.drawImage(im,cx-w/2,cy-h/2,w,h);
  ctx.restore();
  return true;
};
// 等比塞进 box×box 的盒子
ZL.fit=function(im,box){ var w=im.naturalWidth||1,h=im.naturalHeight||1,s=box/Math.max(w,h); return [w*s,h*s]; };
ZL.clamp=function(v,a,b){ return v<a?a:(v>b?b:v); };
ZL.lerp=function(a,b,t){ return a+(b-a)*t; };
ZL.easeOut=function(p){ if(p<0)p=0; if(p>1)p=1; return 1-Math.pow(1-p,3); };
ZL.easeOutBack=function(p){ if(p<0)p=0; if(p>1)p=1; var c1=0.72,c3=c1+1; return 1+c3*Math.pow(p-1,3)+c1*Math.pow(p-1,2); };
ZL.roundRect=function(ctx,x,y,w,h,r){
  if(r>w/2)r=w/2; if(r>h/2)r=h/2;
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
};
// 计数胶囊：深色半透明底 + 白字黑描边，居中于 (cx,top)。返回实际宽高。
ZL.pill=function(ctx,cx,top,text,fs){
  ctx.save();
  ctx.font='600 '+fs+'px "Microsoft YaHei",sans-serif';
  var tw=ctx.measureText(text).width, padX=fs*0.8, padY=fs*0.4;
  var w=tw+padX*2, h=fs+padY*2, x=cx-w/2;
  ZL.roundRect(ctx,x,top,w,h,h/2);
  ctx.fillStyle='rgba(20,22,28,0.72)'; ctx.fill();
  ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.stroke();
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,fs*0.14); ctx.strokeStyle='rgba(0,0,0,0.65)';
  ctx.strokeText(text,cx,top+h/2);
  ctx.fillStyle='#ffffff'; ctx.fillText(text,cx,top+h/2);
  ctx.restore();
  return [w,h];
};
// 音效：每个素材 12 声道轮播（连击不掐断前一声），音量 = cfg.volume% × 传入 vol。
var sndChannels={}, sndIdx={};
function playUrl(url,vol){
  if(window.__MUTED) return null; // 详情页预览默认静音
  try{
    var master=Number(API.cfg.volume); if(!(master>=0)) master=100;
    var v=Math.max(0,Math.min(1,(vol==null?1:vol)*master/100));
    if(v<=0.001) return null;
    var arr=sndChannels[url];
    if(!arr){ arr=[]; sndChannels[url]=arr; sndIdx[url]=0; }
    if(arr.length<12){
      var a=new Audio(url); arr.push(a);
    }
    var i=sndIdx[url]%arr.length; sndIdx[url]=i+1;
    var au=arr[i];
    try{ au.pause(); au.currentTime=0; }catch(e){}
    au.volume=v;
    au.play().catch(function(){});
    return au;
  }catch(e){ return null; }
}
ZL.snd=function(rel,vol){ return playUrl(API.asset(rel),vol); };
// 任意 URL/本地路径（自定义音效）
ZL.sndRaw=function(pathOrUrl,vol){
  var u=API.fileUrl(pathOrUrl); if(!u) return null;
  return playUrl(u,vol);
};
// 麦克风：按设备名挑（设备 id 跨页面不通用；名字要授权后才拿得到，所以先用默认设备拿一次授权再换）。
// 预览里永远不开麦克风（reject 'preview'）。opts.label 空 = 系统默认。
ZL.getMic=function(label,constraints){
  if(API&&API.preview) return Promise.reject(new Error('preview'));
  if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)) return Promise.reject(new Error('no-mic'));
  var base=constraints||{ echoCancellation:false, noiseSuppression:false, autoGainControl:false };
  var want=String(label||'').trim();
  return navigator.mediaDevices.getUserMedia({ audio:base }).then(function(stream){
    if(!want) return stream;
    return navigator.mediaDevices.enumerateDevices().then(function(list){
      var hit=null;
      for(var i=0;i<list.length;i++){ if(list[i].kind==='audioinput'&&list[i].label===want){ hit=list[i]; break; } }
      if(!hit) return stream; // 找不到这个名字（拔了 / 改名）就用默认设备，别让玩法哑掉
      var cur=stream.getAudioTracks()[0];
      if(cur&&cur.getSettings&&cur.getSettings().deviceId===hit.deviceId) return stream;
      var c={}; for(var k in base) c[k]=base[k]; c.deviceId={ exact:hit.deviceId };
      return navigator.mediaDevices.getUserMedia({ audio:c }).then(function(s2){
        try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
        return s2;
      }).catch(function(){ return stream; });
    }).catch(function(){ return stream; });
  });
};
// localStorage 持久计数（file:// 页面按会话分区持久）：累计数字读写。
ZL.loadTotal=function(key){ try{ var n=Number(localStorage.getItem('zl-special-'+key)); return n>0?Math.floor(n):0; }catch(e){ return 0; } };
ZL.saveTotal=function(key,n){ try{ localStorage.setItem('zl-special-'+key,String(Math.floor(n))); }catch(e){} };
})();
// —— 动作命令小工具（各玩法 apply 共用）——
(function(){
var ZL=window.__ZL;
// 操作名：在玩法支持的列表里就用它；旧值 spawn / 未知值 → 默认操作（列表第一项）
ZL.op=function(cmd,list){ var o=String((cmd&&cmd.operation)||'').trim().toLowerCase(); return list.indexOf(o)>=0?o:list[0]; };
// 数量：≥1 的整数（主进程已解析好，这里只兜底）
ZL.count=function(cmd,def){ var n=Math.trunc(Number(cmd&&cmd.count)); return n>=1?n:Math.max(1,Math.trunc(Number(def))||1); };
// 送礼人昵称：空 / 'undefined' / 'null' 一律当没有（文案里别拼出空名）
ZL.who=function(cmd){ var v=cmd?cmd.username:''; var s=String(v==null?'':v).trim(); return (s==='undefined'||s==='null')?'':s; };
// 大小选项 → 百分比：big / small 用对应参数；random 在 [lo,hi] 里随机（不给随机范围就在 small~big 之间）
ZL.sizePct=function(size,big,small,lo,hi){
  if(size==='big') return big;
  if(size==='small') return small;
  var a=(lo==null||!isFinite(Number(lo)))?small:Number(lo), b=(hi==null||!isFinite(Number(hi)))?big:Number(hi);
  if(a>b){ var t=a; a=b; b=t; }
  return a+Math.random()*(b-a);
};
// 异步事件（麦克风回调 / 媒体播完 / 素材加载完）改了画面后叫醒渲染循环
ZL.kick=function(){ try{ if(window.__kick) window.__kick(); }catch(e){} };
// 待生成队列（按批合并）：push 同选项的批次自动合并，take 从队头取一个
ZL.queue=function(){
  var q={ list:[], total:0 };
  q.push=function(n,opt,same){
    if(n<=0) return;
    var last=q.list[q.list.length-1];
    if(last&&same&&same(last.opt,opt)) last.n+=n; else q.list.push({ n:n, opt:opt });
    q.total+=n;
  };
  q.take=function(){ var h=q.list[0]; if(!h) return null; h.n--; q.total--; if(h.n<=0) q.list.shift(); return h.opt; };
  // 从队尾扣掉 n 个（减少操作优先扣还没出场的），返回实际扣掉多少
  q.drop=function(n){ var done=0; while(n>done&&q.list.length){ var t=q.list[q.list.length-1], k=Math.min(t.n,n-done); t.n-=k; done+=k; q.total-=k; if(t.n<=0) q.list.pop(); } return done; };
  q.clear=function(){ q.list=[]; q.total=0; };
  return q;
};
})();
`;

// —— 麦克风掌声检测（声控拍蚊子 / 符咒封印 / 大蚊子苍蝇的声控模式共用）——
// 掌声识别：音量沿 RMS 包络检出「声音事件」，事件内提取 9 维特征，套预训练好的
// 标准化逻辑回归模型（clap_feature_model.json 的 mean/scale/weights/bias），概率 >= 阈值判为掌声。
// getUserMedia 失败 / 无麦克风时 onState('no-mic')，玩法退化为仅手动。
export const MIC_CLAP_JS = `
window.__ZL=window.__ZL||{};
(function(){
var ZL=window.__ZL;
var MODEL={
  mean:[143.49789516775488,5.536516841064406,0.29301040596879524,0.1402608128312133,0.18329266426678736,18.10632234855388,38.63211621516527,145.18518518518417,0.3002425568130497],
  scale:[37.54959288184503,1.9956685855037841,0.25251615672179256,0.11598695608659886,0.08438898417536708,26.070938834040774,36.433821462215704,94.6950568917177,0.2053283822036634],
  weights:[0.6118253682010399,0.5005396645906981,0.012943314258368185,-1.1188335402111822,2.5367725384605264,0.055762079005384525,0.531450681903995,-1.001805072996523,0.21673724346723677],
  bias:-0.8126118543251913
};
// opts: { sensitivity 0~100（越大越容易判掌声）, threshold, deviceLabel（麦克风名，空=默认）, onClap(peakLevel0_255), onState(state) }
// onState：'listening' / 'no-mic'（没麦克风或被拒）/ 'preview'（详情页预览不开麦克风）
ZL.startClap=function(opts){
  var state={ running:false, stopped:false, stream:null, ac:null, timer:0 };
  function stop(){
    state.stopped=true;
    state.running=false;
    if(state.timer){ clearInterval(state.timer); state.timer=0; }
    try{ if(state.ac) state.ac.close(); }catch(e){}
    try{ if(state.stream) state.stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
    state.ac=null; state.stream=null;
  }
  function start(){
    ZL.getMic(opts.deviceLabel).then(function(stream){
      if(!state.running&&state.stopped){ try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} return; }
      try{
        state.stream=stream;
        var AC=window.AudioContext||window.webkitAudioContext;
        var ac=new AC(); state.ac=ac;
        var src=ac.createMediaStreamSource(stream);
        var an=ac.createAnalyser(); an.fftSize=1024; an.smoothingTimeConstant=0;
        src.connect(an);
        var tbuf=new Float32Array(an.fftSize);
        var fbuf=new Float32Array(an.frequencyBinCount);
        var floor=0.004;              // 噪声地板（自适应）
        var inEvent=false, evStart=0, evPeak=0, evRms2=0, evFrames=0, evZc=0, evPrev=0, evHigh=0, evFlatN=0, evFlatSum=0, evFlatSum2=0, attackMs=0, riseFrames=0, belowSince=0, lastRms=0, evPeakFrame=0;
        var history=[];
        state.running=true;
        if(opts.onState)opts.onState('listening');
        state.timer=setInterval(function(){
          if(!state.running) return;
          an.getFloatTimeDomainData(tbuf);
          an.getFloatFrequencyData(fbuf);
          var peak=0, sum2=0, zc=0, prev=evPrev;
          for(var i=0;i<tbuf.length;i++){ var v=tbuf[i], a=v<0?-v:v; if(a>peak)peak=a; sum2+=v*v; if((v>=0)!=(prev>=0))zc++; prev=v; }
          evPrev=prev;
          var rms=Math.sqrt(sum2/tbuf.length);
          var now=performance.now();
          // 高频能量占比（>4kHz）与频谱平坦度
          var sr=ac.sampleRate, binHz=sr/an.fftSize, hiFrom=Math.floor(4000/binHz);
          var hi=0, all=0, flatSum=0, flatSum2=0, flatN=0;
          for(var b=1;b<fbuf.length;b++){ var mag=Math.pow(10,fbuf[b]/20); all+=mag; if(b>=hiFrom)hi+=mag; if(mag>1e-7){ flatSum+=Math.log(mag); flatSum2+=mag; flatN++; } }
          var highRatio=all>0?hi/all:0;
          var flat=flatN>0?Math.exp(flatSum/flatN)/(flatSum2/flatN):0;
          if(!inEvent){
            // 事件起点：峰值电平（0~255 刻度）超过阈值（灵敏度越高门槛越低），并保底高于噪声地板
            var sens=Math.max(1,Math.min(100,Number(opts.sensitivity)||70));
            var thBase=Math.max(8, Number(opts.threshold)||180);
            var gate=thBase*(1-(sens-50)*0.005);   // sens=100 → 0.75×阈值；sens=1 → 1.25×
            if(peak*255>=gate && rms>floor*1.6){
              inEvent=true; evStart=now; evPeak=peak; evRms2=sum2; evFrames=1; evZc=zc; evHigh=highRatio; evFlatSum=flat; evFlatN=1; evPeakFrame=0;
              attackMs=0; riseFrames=0; belowSince=0;
            } else {
              // 地板跟随安静段缓慢更新
              floor=floor*0.985+rms*0.015;
            }
          } else {
            evFrames++;
            if(peak>evPeak){ evPeak=peak; evPeakFrame=evFrames; }
            evRms2+=sum2; evZc+=zc; evHigh=evHigh*0.7+highRatio*0.3; evFlatSum+=flat; evFlatN++;
            if(rms>lastRms*1.02) riseFrames++;
            if(rms<Math.max(floor*1.6,0.008)) belowSince++; else belowSince=0;
            var dur=now-evStart;
            if(attackMs===0&&peak>=evPeak*0.9) attackMs=dur;
            if(belowSince>=4||dur>900){
              // 事件结束：算 9 维特征 → 逻辑回归
              inEvent=false;
              var evRms=Math.sqrt(evRms2/(evFrames*tbuf.length));
              var crest=evRms>1e-6?evPeak/evRms:0;
              var level=Math.min(255,Math.round(evPeak*255));
              var feat=[level, crest, evHigh, evFlatSum/Math.max(1,evFlatN), evZc/Math.max(1,evFrames)/tbuf.length, attackMs, riseFrames*(1000*an.fftSize/ac.sampleRate), dur, evPeak>1e-6?evRms/evPeak:0];
              var z=MODEL.bias;
              for(var k=0;k<9;k++) z+=(feat[k]-MODEL.mean[k])/MODEL.scale[k]*MODEL.weights[k];
              var p=1/(1+Math.exp(-z));
              var th=ZL.clamp(0.72-(Number(opts.sensitivity)||70)/100*0.45, 0.2, 0.72);
              if(p>=th&&level>=8){ try{ opts.onClap(level, p); }catch(e){} }
              floor=floor*0.9+0.001*0.1;
            }
          }
          lastRms=rms;
          history.push(rms); if(history.length>400)history.shift();
        }, 20);
      }catch(e){ if(opts.onState)opts.onState('no-mic'); }
    }).catch(function(e){ if(opts.onState)opts.onState(e&&e.message==='preview'?'preview':'no-mic'); });
  }
  start();
  return { stop:stop };
};
})();
`
