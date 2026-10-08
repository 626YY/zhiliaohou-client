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
      // 整个窗口登记一份：「全部清屏」时一起掐掉（window.__wipe）
      (window.__zlSounds=window.__zlSounds||[]).push(a);
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

// —— 麦克风玩法共用（声控拍蚊子 / 符咒封印 / 大蚊子苍蝇的声控模式 / 详情页的麦克风测试）——
// 识别逻辑和原版一致，设置项的含义、刻度、默认值也一致：
//   读数：每块（拍手 32ms / 喊叫 60ms）多声道取最响一路、线性插值到 16 kHz，
//         算 level / rms / peak / crest / high_ratio / flatness / zero_crossing。
//         level = (块有效值/32768)^0.28 × 300，即设置里「音量阈值」的 0~500 刻度（满幅约 300）。
//   拍手：起音门槛（音量 + 比底噪 / 比上一块的倍数）→ 候选声音结束时按灵敏度的规则门槛
//         + 训练好的掌声模型（clap_feature_model.json，按特征名取值）判定。
//         识别方式「只看音量」：过阈值且冷却到了就算，回落到阈值 55% 再武装。
//   喊叫：每 45ms 取这段时间里块的最大音量（没有新块是 0），过阈值且冷却到了算喊一声，回落到阈值 55% 再武装。
// 以前的版本特征口径和掌声模型训练时的定义对不上（峰值×255 当音量、毫秒数当倍数…），所以什么都认不出来（2026-10-07）。
// getUserMedia 失败 / 没麦克风时 onState('no-mic')，玩法退化为只能点；预览里不开麦克风 onState('preview')。
export const MIC_CLAP_JS = `
window.__ZL=window.__ZL||{};
(function(){
var ZL=window.__ZL;
var ANALYSIS_RATE=16000;
// 掌声模型：标准化逻辑回归（特征名、均值、尺度、权重与 assets/special-games/mosquito/clap_feature_model.json 一致）
var MODEL={
  features:['peak_level','crest','high_ratio','flatness','zero_crossing','attack','rise','duration_ms','fall_ratio'],
  mean:[143.49789516775488,5.536516841064406,0.29301040596879524,0.1402608128312133,0.18329266426678736,18.10632234855388,38.63211621516527,145.18518518518417,0.3002425568130497],
  scale:[37.54959288184503,1.9956685855037841,0.25251615672179256,0.11598695608659886,0.08438898417536708,26.070938834040774,36.433821462215704,94.6950568917177,0.2053283822036634],
  weights:[0.6118253682010399,0.5005396645906981,0.012943314258368185,-1.1188335402111822,2.5367725384605264,0.055762079005384525,0.531450681903995,-1.001805072996523,0.21673724346723677],
  bias:-0.8126118543251913,
  threshold:0.5
};
function modelProbability(v){
  var s=MODEL.bias;
  for(var i=0;i<MODEL.features.length;i++){
    var x=Number(v[MODEL.features[i]]); if(!isFinite(x)) x=0;
    s+=(x-MODEL.mean[i])/Math.max(1e-9,MODEL.scale[i])*MODEL.weights[i];
  }
  s=Math.max(-40,Math.min(40,s));
  return 1/(1+Math.exp(-s));
}

// —— 读数 ——
function fftPow2(re,im){
  var n=re.length,i,j,k,len,half,ang,wr,wi,cr,ci,ur,ui,vr,vi,t;
  for(i=1,j=0;i<n;i++){ var bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(len=2;len<=n;len<<=1){
    ang=-2*Math.PI/len; wr=Math.cos(ang); wi=Math.sin(ang); half=len>>1;
    for(i=0;i<n;i+=len){
      cr=1; ci=0;
      for(k=0;k<half;k++){
        ur=re[i+k]; ui=im[i+k];
        vr=re[i+k+half]*cr-im[i+k+half]*ci; vi=re[i+k+half]*ci+im[i+k+half]*cr;
        re[i+k]=ur+vr; im[i+k]=ui+vi; re[i+k+half]=ur-vr; im[i+k+half]=ui-vi;
        t=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=t;
      }
    }
  }
}
// 实数 FFT 的功率谱 |X_k|²，k=0..N/2（N 不是 2 的幂就直接算 DFT，常见采样率下 N 都是 512）
function powerSpectrum(x){
  var N=x.length, half=Math.floor(N/2)+1, out=new Float64Array(half), i, k;
  if(N>1&&(N&(N-1))===0){
    var re=new Float64Array(x), im=new Float64Array(N);
    fftPow2(re,im);
    for(k=0;k<half;k++) out[k]=re[k]*re[k]+im[k]*im[k];
  } else {
    for(k=0;k<half;k++){ var sr=0,si=0; for(i=0;i<N;i++){ var a=-2*Math.PI*k*i/N; sr+=x[i]*Math.cos(a); si+=x[i]*Math.sin(a); } out[k]=sr*sr+si*si; }
  }
  return out;
}
// 一块的指标（w：16 kHz、int16 单位；会被就地去直流）
function chunkMetrics(w,spectral){
  var n=w.length, i, mean=0, s2=0, peak=0;
  for(i=0;i<n;i++) mean+=w[i];
  mean/=n;
  for(i=0;i<n;i++){ w[i]-=mean; var a=w[i]<0?-w[i]:w[i]; if(a>peak) peak=a; s2+=w[i]*w[i]; }
  var rms=Math.sqrt(s2/n);
  var norm=Math.max(0,Math.min(1,rms/32768));
  var level=norm>0?Math.pow(norm,0.28)*300:0;
  var m={ level:Math.max(0,Math.min(500,level)), rms:rms, peak:peak, crest:peak/Math.max(1,rms), high_ratio:0, flatness:0, zero_crossing:0, duration_ms:n*1000/ANALYSIS_RATE };
  if(!spectral) return m;
  var zc=0;
  for(i=1;i<n;i++) if((w[i]<0)!==(w[i-1]<0)) zc++;
  m.zero_crossing=n>1?zc/(n-1):0;
  var x=new Float64Array(n);
  for(i=0;i<n;i++) x[i]=w[i]*(n>1?(0.5-0.5*Math.cos(2*Math.PI*i/(n-1))):1);
  var pw=powerSpectrum(x), half=pw.length, hiFrom=1800*n/ANALYSIS_RATE;
  var total=0, high=0, logSum=0, lin=0, cnt=half-1;
  for(i=1;i<half;i++){ total+=pw[i]; var p=pw[i]+1e-12; logSum+=Math.log(p); lin+=p; }
  for(i=0;i<half;i++) if(i>=hiFrom) high+=pw[i];
  m.high_ratio=high/Math.max(1e-12,total);
  m.flatness=(cnt>0&&total>0)?Math.exp(logSum/cnt)/(lin/cnt):0;
  return m;
}
// 多声道：各路去直流后取有效值最大的一路，换成 int16 单位
function loudest(chs,len){
  var best=null, bestRms=-1;
  for(var c=0;c<chs.length;c++){
    var ch=chs[c], mean=0, s2=0, i;
    for(i=0;i<len;i++) mean+=ch[i];
    mean/=len;
    for(i=0;i<len;i++){ var v=ch[i]-mean; s2+=v*v; }
    if(s2>bestRms){ bestRms=s2; best=ch; }
  }
  var out=new Float64Array(len);
  for(var j=0;j<len;j++) out[j]=best[j]*32768;
  return out;
}
// 线性插值换采样率（和 numpy.interp 一样，端点外取最后一个值）
function resample(w,target){
  var L=w.length; if(L===target) return w;
  var out=new Float64Array(target);
  for(var j=0;j<target;j++){ var x=j*L/target, i=Math.floor(x), f=x-i; out[j]=i>=L-1?w[L-1]:w[i]+(w[i+1]-w[i])*f; }
  return out;
}

// 连续读麦克风、按块出指标。opts: { chunkMs, spectral, deviceLabel, onChunk(metrics, 秒), onState(state) }
// ScriptProcessor 拿到每一个采样点（不靠定时器抽查，短促的掌声不会漏在两次查看之间）
ZL.micChunks=function(opts){
  var st={ stopped:false, stream:null, ac:null, sp:null };
  function stop(){
    st.stopped=true;
    try{ if(st.sp){ st.sp.onaudioprocess=null; st.sp.disconnect(); } }catch(e){}
    try{ if(st.ac) st.ac.close(); }catch(e){}
    try{ if(st.stream) st.stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
    st.sp=null; st.ac=null; st.stream=null;
  }
  ZL.getMic(opts.deviceLabel).then(function(stream){
    if(st.stopped){ try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} return; }
    try{
      st.stream=stream;
      var AC=window.AudioContext||window.webkitAudioContext;
      var ac=new AC(); st.ac=ac;
      var sr=ac.sampleRate;
      var src=ac.createMediaStreamSource(stream);
      var sp=ac.createScriptProcessor(1024,2,1); st.sp=sp;
      var mute=ac.createGain(); mute.gain.value=0;   // ScriptProcessor 要接到输出才会跑；增益 0，不出声
      src.connect(sp); sp.connect(mute); mute.connect(ac.destination);
      var L=Math.max(2,Math.round(sr*opts.chunkMs/1000));
      var target=Math.max(2,Math.round(L*ANALYSIS_RATE/sr));
      var bufs=[new Float32Array(L),new Float32Array(L)], fill=0, index=0;
      sp.onaudioprocess=function(ev){
        if(st.stopped) return;
        var inb=ev.inputBuffer, nch=Math.min(2,inb.numberOfChannels), chs=[], c;
        for(c=0;c<nch;c++) chs.push(inb.getChannelData(c));
        var n=chs[0].length, i=0;
        while(i<n){
          var take=Math.min(L-fill,n-i);
          for(c=0;c<nch;c++) bufs[c].set(chs[c].subarray(i,i+take),fill);
          fill+=take; i+=take;
          if(fill>=L){
            fill=0; index++;
            var m=chunkMetrics(resample(loudest(bufs.slice(0,nch),L),target),!!opts.spectral);
            try{ opts.onChunk(m,index*opts.chunkMs/1000); }catch(e){}
          }
        }
      };
      if(opts.onState) opts.onState('listening');
    }catch(e){ if(opts.onState) opts.onState('no-mic'); }
  }).catch(function(e){ if(opts.onState) opts.onState(e&&e.message==='preview'?'preview':'no-mic'); });
  return { stop:stop };
};

// —— 拍手识别 ——
function clapDetector(threshold,sensitivity,cooldownMs){
  var d={ threshold:threshold, sensitivity:Math.max(1,Math.min(100,Math.trunc(Number(sensitivity))||70)), cooldown_ms:Math.max(100,Math.trunc(Number(cooldownMs))||260),
    noise_rms:80, previous_rms:80, candidate:null, last_trigger:-1000, last:null };
  function req(){
    var s=d.sensitivity/100;
    return { rise:2.8-1.45*s, attack:2.1-0.8*s, high_ratio:0.22-0.14*s, flatness:0.1-0.065*s, zero_crossing:0.14-0.08*s, crest:2.8-1.2*s, max_duration:(120+140*s)/1000 };
  }
  function num(v){ var n=Number(v); return isFinite(n)?n:0; }
  d.feed=function(m,now){
    var level=Math.max(0,num(m.level)), rms=Math.max(0,num(m.rms)), r=req();
    var rise=rms/Math.max(45,d.noise_rms), attack=rms/Math.max(45,d.previous_rms), result=null;
    if(d.candidate){
      var c=d.candidate, elapsed=now-c.started;
      var fell=rms<=Math.max(d.noise_rms*1.7,c.peak_rms*0.38);
      if(fell){
        var f={ peak_level:c.peak_level, crest:c.crest, high_ratio:c.high_ratio, flatness:c.flatness, zero_crossing:c.zero_crossing, attack:c.attack, rise:c.rise, duration_ms:elapsed*1000, fall_ratio:rms/Math.max(1,c.peak_rms) };
        var spectral=c.high_ratio>=r.high_ratio&&(c.flatness>=r.flatness||c.zero_crossing>=r.zero_crossing);
        var impulsive=c.crest>=r.crest||c.attack>=r.attack*1.25;
        var p=modelProbability(f);
        var lt=Math.max(0.3,Math.min(0.76,MODEL.threshold+(70-d.sensitivity)*0.004));
        var learned=p>=lt&&impulsive;
        var cooled=(now-d.last_trigger)*1000>=d.cooldown_ms;
        f.probability=p; f.spectral=spectral; f.impulsive=impulsive;
        f.ok=elapsed<=r.max_duration&&learned&&cooled;
        if(f.ok){ result=c.peak_level; d.last_trigger=now; }
        d.last=f;
        d.candidate=null;
      } else {
        c.peak_level=Math.max(c.peak_level,level); c.peak_rms=Math.max(c.peak_rms,rms);
        c.crest=Math.max(c.crest,num(m.crest)); c.high_ratio=Math.max(c.high_ratio,num(m.high_ratio));
        c.flatness=Math.max(c.flatness,num(m.flatness)); c.zero_crossing=Math.max(c.zero_crossing,num(m.zero_crossing));
        c.attack=Math.max(c.attack,attack); c.rise=Math.max(c.rise,rise);
        if(elapsed>r.max_duration) d.candidate=null;
      }
    }
    if(!d.candidate&&result===null){
      if(level>=d.threshold&&rise>=r.rise&&attack>=r.attack){
        d.candidate={ started:now, peak_level:level, peak_rms:rms, crest:num(m.crest), high_ratio:num(m.high_ratio), flatness:num(m.flatness), zero_crossing:num(m.zero_crossing), attack:attack, rise:rise };
      } else if(level<d.threshold*0.72){
        d.noise_rms=d.noise_rms*0.94+rms*0.06;
      }
    }
    d.previous_rms=rms;
    return result;
  };
  return d;
}

// 拍手（32ms 一块）。opts: { threshold 0~500, sensitivity 1~100, cooldownMs, triggerMode 'clap'|'volume',
//   deviceLabel, onClap(音量), onState(state), onLevel(音量)?, onCandidate(特征)? }
ZL.startClap=function(opts){
  var th=Math.max(1,Math.min(500,Number(opts.threshold)||180));
  var cd=Math.max(100,Math.min(10000000,Math.trunc(Number(opts.cooldownMs))||260));
  var volumeOnly=String(opts.triggerMode||'clap')==='volume';
  var det=clapDetector(th,opts.sensitivity==null?70:opts.sensitivity,cd);
  var armed=true, last=-1e9, release=Math.max(5,th*0.55);
  return ZL.micChunks({ chunkMs:32, spectral:!volumeOnly, deviceLabel:opts.deviceLabel, onState:opts.onState, onChunk:function(m,t){
    if(opts.onLevel){ try{ opts.onLevel(m.level); }catch(e){} }
    if(volumeOnly){
      if(armed&&m.level>=th&&(t-last)*1000>=cd){ armed=false; last=t; try{ opts.onClap(m.level); }catch(e){} }
      else if(!armed&&m.level<=release) armed=true;
      return;
    }
    var lv=det.feed(m,t);
    if(det.last){ if(opts.onCandidate){ try{ opts.onCandidate(det.last); }catch(e){} } det.last=null; }
    if(lv!==null){ try{ opts.onClap(lv); }catch(e){} }
  }});
};

// 喊叫（60ms 一块、每 45ms 读一次）。opts: { threshold 0~500 或取值函数, cooldownMs 或取值函数,
//   deviceLabel, onShout(音量), onState(state), onLevel(音量)? }
ZL.startShout=function(opts){
  function val(v,d,lo,hi){ var n=Number(typeof v==='function'?v():v); return Math.max(lo,Math.min(hi,isFinite(n)&&n>0?n:d)); }
  var q=[], armed=true, last=-1e9;
  var h=ZL.micChunks({ chunkMs:60, spectral:false, deviceLabel:opts.deviceLabel, onState:opts.onState, onChunk:function(m){ q.push(m.level); } });
  var timer=setInterval(function(){
    var level=0;
    for(var i=0;i<q.length;i++) if(q[i]>level) level=q[i];
    q.length=0;
    if(opts.onLevel){ try{ opts.onLevel(level); }catch(e){} }
    var th=val(opts.threshold,240,1,500), cd=val(opts.cooldownMs,220,50,10000000), now=performance.now()/1000;
    if(armed&&level>=th&&(now-last)*1000>=cd){ armed=false; last=now; try{ opts.onShout(level); }catch(e){} }
    else if(!armed&&level<=Math.max(5,th*0.55)) armed=true;
  },45);
  return { stop:function(){ clearInterval(timer); h.stop(); } };
};
})();
`
