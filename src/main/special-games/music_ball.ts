// 特色玩法「音乐球」的页面内 Canvas 代码。
// 彩球踩着节拍从右缘滚向判定圈（主时钟=音频 currentTime，绝不另起动画钟），到圈播扩散环；
// burst 节拍放 500ms 大爆发（渐变核心+12 射线+黄金角粒子）；下轨响度水晶柱。纯观赏。
// 操作：start 从头开始（正在播就重开）/ pause / resume / stop（兼容旧值：clear=stop，spawn=start）。
// 素材：music_ball/default_music.mp3 + default_beats.json（节拍/响度时间线）。
// 自定义音乐（cfg.musicPath，走 api.fileUrl）：读文件 → OfflineAudioContext 解码（22.05kHz）→ 谱通量起音检测
//   （cfg.beatSensitivity 0~100 控制门限与最小间隔，越高球越密）→ 生成与 default_beats.json 同结构的 beats/loudness；
//   分析失败回退内置节拍，音乐本身放不了回退内置音乐。分析在 setTimeout 分片里跑，不卡画面。
// 静音：音乐照常播放但 muted（时钟 = audio.currentTime，静音也得往前走），mute(on) 同步。
// ★禁止在本字符串里使用反引号或 ${…}（主进程按模板串注入）。
import { SHARED_JS } from './shared'

export const code = SHARED_JS + `
window.registerGame((function(){
  var ZL=window.__ZL;
  var api=null;
  var OPS=['start','pause','resume','stop'];
  var beats=null, loudness=null;   // 当前这局的节拍/响度（按时间排序）
  var builtin=null;                // 内置节拍（default_beats.json，加载一次）
  var builtinLoading=null;         // 加载中的 Promise
  var cache={}, cacheKeys=[];      // 自定义音乐分析结果缓存（路径+灵敏度）
  var audio=null, audioCustom=false;
  var source='';                   // builtin / analyzed / fallback（分析失败用内置节拍）
  var state='idle';                // idle / loading / countdown / playing / paused
  var encore=0;                    // 播放中又点的歌：排队，这首放完接着放
  var pausedFrom='', countdownLeft=0, pauseAfterLoad=false;
  var countdownEnd=0;
  var loadToken=0, loadText='';
  var nowMs=0;
  var effects=[];                  // {kind:'ring'|'burst',t0,x,y,color,strength}
  var lastPos=-1e9;

  var PITCH_COLORS=['#ff526f','#ffcf45','#3ee6df','#aa78ff'];
  var SR=22050, FFT_N=1024, HOP=256;

  function num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
  function volume(){ return Math.max(0,Math.min(100,num(api.cfg.volume,90))); }
  function travel(){ return Math.max(800,Math.min(5000,num(api.cfg.travelMs,2200))); }
  function ballSize(){ return Math.max(20,Math.min(160,num(api.cfg.ballSize,44))); }
  function burstTh(){ return 0.93-Math.max(0,Math.min(100,num(api.cfg.burstSensitivity,68)))*0.0043; }
  function syncOffset(){ return Math.max(-2000,Math.min(2000,num(api.cfg.syncOffsetMs,0))); }
  function countdownSec(){ return Math.max(0,Math.min(30,num(api.cfg.countdownSec,3))); }
  function beatSens(){ return Math.max(0,Math.min(100,num(api.cfg.beatSensitivity,65))); }
  function builtinMusic(){ return api.asset('music_ball/default_music.mp3'); }

  function contentRect(){
    var w=Math.min(760,Math.max(300,api.W*0.7));
    var h=Math.min(760,Math.max(280,api.H*0.52));
    return { x:(api.W-w)/2, y:api.H*0.22, w:w, h:h };
  }

  // —— 读文件：fetch，不行再退 XHR（file:// 页面两条路都留着）——
  function loadUrl(url,type){
    return new Promise(function(resolve,reject){
      function viaXhr(){
        try{
          var x=new XMLHttpRequest();
          x.open('GET',url); x.responseType=type;
          x.onload=function(){ if(x.response!=null&&(type!=='arraybuffer'||x.response.byteLength>0)) resolve(x.response); else reject(new Error('empty')); };
          x.onerror=function(){ reject(new Error('xhr')); };
          x.send();
        }catch(e){ reject(e); }
      }
      try{
        fetch(url).then(function(r){
          if(!r.ok&&r.status!==0) throw new Error('http '+r.status);
          return type==='json'?r.json():r.arrayBuffer();
        }).then(resolve).catch(viaXhr);
      }catch(e){ viaXhr(); }
    });
  }

  function loadBuiltin(){
    if(builtin) return Promise.resolve(builtin);
    if(builtinLoading) return builtinLoading;
    builtinLoading=loadUrl(api.asset('music_ball/default_beats.json'),'json').then(function(j){
      builtin={ beats:sortByTime((j&&j.beats)||[]), loudness:sortByTime((j&&j.loudness)||[]) };
      return builtin;
    }).catch(function(){
      builtin={ beats:[], loudness:[] };
      return builtin;
    });
    return builtinLoading;
  }
  function sortByTime(arr){ return arr.slice().sort(function(a,b){ return a.time_ms-b.time_ms; }); }

  // —— 离线节拍分析（谱通量起音检测）——
  var fftRev=null, fftCos=null, fftSin=null;
  function fftInit(){
    if(fftRev) return;
    fftRev=new Uint16Array(FFT_N); fftCos=new Float32Array(FFT_N/2); fftSin=new Float32Array(FFT_N/2);
    var bits=Math.round(Math.log(FFT_N)/Math.LN2), i;
    for(i=0;i<FFT_N;i++){ var r=0,x=i; for(var b=0;b<bits;b++){ r=(r<<1)|(x&1); x>>=1; } fftRev[i]=r; }
    for(i=0;i<FFT_N/2;i++){ fftCos[i]=Math.cos(-2*Math.PI*i/FFT_N); fftSin[i]=Math.sin(-2*Math.PI*i/FFT_N); }
  }
  // 原地基 2 FFT
  function fft(re,im){
    var n=FFT_N,i,j,t;
    for(i=0;i<n;i++){ j=fftRev[i]; if(j>i){ t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
    for(var size=2;size<=n;size<<=1){
      var half=size>>1, step=n/size;
      for(i=0;i<n;i+=size){
        for(j=0;j<half;j++){
          var k=j*step, wr=fftCos[k], wi=fftSin[k];
          var a=i+j, b=a+half;
          var xr=re[b]*wr-im[b]*wi, xi=re[b]*wi+im[b]*wr;
          re[b]=re[a]-xr; im[b]=im[a]-xi;
          re[a]+=xr; im[a]+=xi;
        }
      }
    }
  }

  function decode(buf){
    var OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!OAC) return Promise.reject(new Error('no-audio'));
    var oc=new OAC(1,1,SR);   // 解码时顺带重采样到 22.05kHz
    return new Promise(function(resolve,reject){
      var p=oc.decodeAudioData(buf,resolve,reject);
      if(p&&p.then) p.then(resolve,reject);
    });
  }

  function percentile(arr,q){
    if(!arr.length) return 0;
    var s=Array.prototype.slice.call(arr).sort(function(a,b){ return a-b; });
    return s[Math.min(s.length-1,Math.max(0,Math.floor(q*(s.length-1))))];
  }

  // 分片计算每帧：谱通量（≤8kHz 对数幅度正增量之和）、能量、谱质心
  function analyzeBuffer(ab,sens,token){
    return new Promise(function(resolve){
      var sr=ab.sampleRate, len=ab.length, chs=Math.min(2,ab.numberOfChannels), i, c;
      var ch=[];   // 声道数据是视图，不复制（长歌省几十 MB）；多于两声道只取前两个
      for(c=0;c<chs;c++) ch.push(ab.getChannelData(c));
      var frames=Math.floor((len-FFT_N)/HOP)+1;
      if(!(frames>32)){ resolve(null); return; }
      fftInit();
      var win=new Float32Array(FFT_N);
      for(i=0;i<FFT_N;i++) win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(FFT_N-1));
      var re=new Float32Array(FFT_N), im=new Float32Array(FFT_N), prev=new Float32Array(FFT_N/2);
      var flux=new Float32Array(frames), cent=new Float32Array(frames), energy=new Float32Array(frames);
      var binHz=sr/FFT_N, maxBin=Math.min(FFT_N/2, Math.floor(8000/binHz));
      var f=0;
      function chunk(){
        if(token!==loadToken){ resolve(null); return; }
        var end=Math.min(frames,f+300);
        for(;f<end;f++){
          var off=f*HOP, e2=0, k;
          for(k=0;k<FFT_N;k++){ var v=chs>1?(ch[0][off+k]+ch[1][off+k])*0.5:ch[0][off+k]; e2+=v*v; re[k]=v*win[k]; im[k]=0; }
          energy[f]=Math.sqrt(e2/FFT_N);
          fft(re,im);
          var fl=0, cs=0, ms=0;
          for(k=1;k<maxBin;k++){
            var mag=Math.sqrt(re[k]*re[k]+im[k]*im[k]);
            var lm=Math.log(1+mag);
            var dl=lm-prev[k]; if(dl>0) fl+=dl;
            prev[k]=lm;
            cs+=k*mag; ms+=mag;
          }
          flux[f]=fl; cent[f]=ms>1e-9?cs/ms*binHz:0;
        }
        if(f<frames) setTimeout(chunk,0);
        else resolve(pickBeats(flux,cent,energy,frames,sr,sens,ab.duration));
      }
      chunk();
    });
  }

  // 自适应门限挑起音峰 → 节拍；灵敏度越高门限越低、最小间隔越短（球越密）
  function pickBeats(flux,cent,energy,frames,sr,sens,duration){
    var hopMs=HOP/sr*1000, s=sens/100, i;
    var odf=new Float32Array(frames);
    for(i=0;i<frames;i++) odf[i]=(flux[Math.max(0,i-1)]+2*flux[i]+flux[Math.min(frames-1,i+1)])/4;
    var pre=new Float64Array(frames+1);
    for(i=0;i<frames;i++) pre[i+1]=pre[i]+odf[i];
    var gmean=pre[frames]/frames;
    // 参数按内置歌（预分析 167 拍）标定：默认灵敏度 65 ≈ 180 拍、与预分析节拍 F 值≈0.65、无系统时差
    var wn=Math.max(3,Math.round(400/hopMs));
    var mult=1.5-0.85*s;
    var floor=gmean*0.4*(1-s)*(1-s);
    var minGap=Math.max(1,Math.round(Math.max(100,500-400*s)/hopMs));
    var peaks=[], last=-1e9;
    for(i=1;i<frames-1;i++){
      if(!(odf[i]>odf[i-1]&&odf[i]>=odf[i+1])) continue;
      var lo=Math.max(0,i-wn), hi=Math.min(frames,i+wn+1);
      var local=(pre[hi]-pre[lo])/(hi-lo);
      if(odf[i]<=local*mult+floor) continue;
      if(i-last<minGap){
        // 间隔太近：留更强的那个
        if(peaks.length&&odf[i]>odf[peaks[peaks.length-1]]){ peaks[peaks.length-1]=i; last=i; }
        continue;
      }
      peaks.push(i); last=i;
    }
    if(peaks.length<4) return null;
    // 响度时间线：每 50ms 一个点，按全曲 98 分位归一
    var slot=50, nSlots=Math.max(1,Math.ceil(duration*1000/slot)), lv=new Float32Array(nSlots), cnt=new Float32Array(nSlots);
    for(i=0;i<frames;i++){ var si=Math.min(nSlots-1,Math.floor((i*HOP+FFT_N/2)/sr*1000/slot)); lv[si]+=energy[i]; cnt[si]++; }
    for(i=0;i<nSlots;i++) lv[i]=cnt[i]?lv[i]/cnt[i]:0;
    var lref=percentile(lv,0.98)||1;
    var loud=[];
    for(i=0;i<nSlots;i++) loud.push({ time_ms:i*slot, level:Math.round(Math.max(0.05,Math.min(1,Math.pow(lv[i]/lref,1.3)))*1000)/1000 });
    // 节拍强度：峰值按 90 分位归一；音高：起音附近的谱质心在全曲里的名次
    var pv=[], cv=[];
    for(i=0;i<peaks.length;i++){
      pv.push(odf[peaks[i]]);
      var a=0,n=0; for(var k=peaks[i];k<Math.min(frames,peaks[i]+4);k++){ a+=cent[k]; n++; }
      cv.push(n?a/n:0);
    }
    var pref=percentile(pv,0.9)||1;
    // 名次（0~1）：值在全曲同类里排第几
    function rankIn(sorted,v){ var lo=0, hi=sorted.length; while(lo<hi){ var mid=(lo+hi)>>1; if(sorted[mid]<v) lo=mid+1; else hi=mid; } return sorted.length>1?lo/(sorted.length-1):0.5; }
    var times=[], strengths=[], mix=[];
    for(i=0;i<peaks.length;i++){
      var t=Math.round((peaks[i]*HOP+FFT_N/2)/sr*1000);
      var st=0.45+0.55*Math.min(1,pv[i]/pref);
      times.push(t); strengths.push(st);
      mix.push(0.6*st+0.4*loud[Math.min(loud.length-1,Math.floor(t/slot))].level);
    }
    var sortedC=cv.slice().sort(function(x,y){ return x-y; });
    var sortedM=mix.slice().sort(function(x,y){ return x-y; });
    var out=[];
    for(i=0;i<peaks.length;i++){
      var pitch=Math.max(0,Math.min(1,rankIn(sortedC,cv[i])));
      // 爆发分按「强度+响度」在全曲的名次铺到 0.5~0.98：默认爆发灵敏度下约七成节拍放大招（和内置节拍相当），任何歌都一样好调
      var burst=0.5+0.48*rankIn(sortedM,mix[i]);
      out.push({ time_ms:times[i], strength:Math.round(strengths[i]*1000)/1000, pitch:Math.round(pitch*1000)/1000, pitch_band:Math.min(3,Math.floor(pitch*4)), burst_score:Math.round(burst*1000)/1000 });
    }
    var iois=[];
    for(i=1;i<out.length;i++) iois.push(out[i].time_ms-out[i-1].time_ms);
    var med=percentile(iois,0.5)||500;
    return { analysis_version:3, beats:out, loudness:loud, duration_ms:Math.round(duration*1000), bpm:Math.round(60000/med*10)/10, source:'analyzed' };
  }

  function analyzeMusic(url,sens,token){
    var key=url+'|'+sens;
    if(cache[key]) return Promise.resolve(cache[key]);
    return loadUrl(url,'arraybuffer').then(decode).then(function(ab){
      if(token!==loadToken) return null;
      return analyzeBuffer(ab,sens,token);
    }).then(function(res){
      if(res){
        cache[key]=res; cacheKeys.push(key);
        if(cacheKeys.length>4) delete cache[cacheKeys.shift()];
      }
      return res;
    }).catch(function(){ return null; });
  }

  // —— 播放控制 ——
  function dropAudio(){
    if(!audio) return;
    audio.onerror=null;
    try{ audio.pause(); audio.removeAttribute('src'); audio.load(); }catch(e){}
    audio=null;
  }
  function makeAudio(url,custom){
    dropAudio();
    var a=new Audio(url);
    a.preload='auto';
    a.volume=volume()/100;
    a.muted=api.muted();
    a.onerror=function(){ if(audio===a) audioFailed(); };
    audio=a; audioCustom=custom;
  }
  // 自定义音乐放不了 → 换内置音乐 + 内置节拍从头来；内置也放不了就停
  function audioFailed(){
    if(audioCustom&&state!=='idle') begin(true);
    else stop();
  }

  function positionMs(){
    if(state==='countdown') return (nowMs-countdownEnd)+syncOffset();   // 负时间提前滚入
    if(state==='paused'&&pausedFrom==='countdown') return -countdownLeft+syncOffset();
    if((state==='playing'||state==='paused')&&audio) return audio.currentTime*1000+syncOffset();
    if(state==='loading') return -countdownSec()*1000+syncOffset();
    return 0;
  }

  function enterCountdown(){
    try{ audio.currentTime=0; }catch(e){}
    effects=[]; lastPos=-1e9;
    if(pauseAfterLoad){
      pauseAfterLoad=false;
      state='paused'; pausedFrom='countdown'; countdownLeft=countdownSec()*1000;
      return;
    }
    if(countdownSec()>0){
      state='countdown';
      countdownEnd=nowMs+countdownSec()*1000;
    }else playNow();
  }
  function playNow(){
    state='playing';
    if(audio){ audio.muted=api.muted(); audio.play().catch(function(){}); }
  }

  // 开一局：自定义音乐先分析节拍（分析中显示提示），内置音乐用预分析好的节拍
  function begin(forceBuiltin){
    var token=++loadToken;
    effects=[]; lastPos=-1e9; pauseAfterLoad=false;
    beats=null; loudness=null;
    var custom=forceBuiltin?'':String(api.cfg.musicPath||'').trim();
    state='loading';
    if(custom){
      var url=api.fileUrl(custom);
      loadText='正在分析节拍…';
      makeAudio(url,true);
      analyzeMusic(url,beatSens(),token).then(function(res){
        if(token!==loadToken) return null;
        if(res){ beats=res.beats; loudness=res.loudness; source='analyzed'; return true; }
        return loadBuiltin().then(function(b){ beats=b.beats; loudness=b.loudness; source='fallback'; return true; });
      }).then(function(ok){
        if(ok&&token===loadToken){ enterCountdown(); ZL.kick(); }
      });
    }else{
      loadText='';
      makeAudio(builtinMusic(),false);
      loadBuiltin().then(function(b){
        if(token!==loadToken) return;
        beats=b.beats; loudness=b.loudness; source='builtin';
        enterCountdown(); ZL.kick();
      });
    }
  }

  function pause(){
    if(state==='loading'){ pauseAfterLoad=true; return; }
    if(state==='countdown'){ countdownLeft=Math.max(0,countdownEnd-nowMs); pausedFrom='countdown'; state='paused'; }
    else if(state==='playing'){ if(audio){ try{ audio.pause(); }catch(e){} } pausedFrom='playing'; state='paused'; }
  }
  function resume(){
    if(state==='loading'){ pauseAfterLoad=false; return; }
    if(state!=='paused') return;
    if(pausedFrom==='countdown'){ state='countdown'; countdownEnd=nowMs+countdownLeft; }
    else playNow();
  }
  // 播放中又来点歌：queue = 排队接着放（默认）/ restart = 从头重新放 / ignore = 不理会
  function whilePlaying(){ var m=String(api.cfg.whilePlaying||'queue'); return (m==='restart'||m==='ignore')?m:'queue'; }
  function stop(){
    loadToken++;
    encore=0;
    state='idle'; pausedFrom=''; pauseAfterLoad=false;
    dropAudio();
    effects=[];
  }

  // 二分：第一个 time_ms >= t 的下标
  function lowerBound(arr,t){
    var lo=0, hi=arr.length;
    while(lo<hi){ var mid=(lo+hi)>>1; if(arr[mid].time_ms<t) lo=mid+1; else hi=mid; }
    return lo;
  }
  // 时间窗 (lo,hi] 内的元素（lo 开区间：同一个节拍不会触发两次）
  function sliceOpen(arr,lo,hi){
    var out=[];
    if(!arr) return out;
    for(var i=lowerBound(arr,lo);i<arr.length&&arr[i].time_ms<=hi;i++) if(arr[i].time_ms>lo) out.push(arr[i]);
    return out;
  }
  function sliceClosed(arr,lo,hi){
    var out=[];
    if(!arr) return out;
    for(var i=lowerBound(arr,lo);i<arr.length&&arr[i].time_ms<=hi;i++) out.push(arr[i]);
    return out;
  }

  function drawBall(ctx,x,y,r,color,strength){
    // 外光晕
    var g0=ctx.createRadialGradient(x,y,r*0.4,x,y,r*2);
    g0.addColorStop(0,color);
    g0.addColorStop(0.72,color);
    g0.addColorStop(1,'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha*=0.35;
    ctx.fillStyle=g0;
    ctx.beginPath(); ctx.arc(x,y,r*2,0,6.2832); ctx.fill();
    ctx.restore();
    // 球体
    var g=ctx.createRadialGradient(x-r*0.35,y-r*0.4,r*0.1,x,y,r);
    g.addColorStop(0,'#ffffff');
    g.addColorStop(0.35,color);
    g.addColorStop(1,'rgba(0,0,0,0.65)');
    ctx.save();
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.fill();
    ctx.lineWidth=Math.max(1,r*0.07); ctx.strokeStyle='#fff'; ctx.stroke();
    if(strength>0.82){
      ctx.strokeStyle='rgba(255,255,255,0.85)';
      ctx.lineWidth=Math.max(1.5,r*0.12);
      ctx.beginPath(); ctx.arc(x,y,r*1.15,-2.2,-1.0); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBurst(ctx,e,p){
    // 500ms 大爆发：渐变核心 + 白核 + 12 射线 + 黄金角粒子
    var bs=ballSize();
    var core=bs*(0.5+2.2*p)*(0.86+e.strength*0.3);
    var alpha=Math.pow(1-p,1.35);
    ctx.save();
    ctx.globalAlpha*=alpha;
    var g=ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,core);
    g.addColorStop(0,'#ffffff');
    g.addColorStop(0.3,e.color);
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(e.x,e.y,core,0,6.2832); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,'+(alpha*0.9)+')';
    ctx.beginPath(); ctx.arc(e.x,e.y,core*0.3,0,6.2832); ctx.fill();
    ctx.strokeStyle=e.color;
    ctx.lineWidth=Math.max(1.5,bs*0.06); ctx.lineCap='round';
    var ray,i;
    for(ray=0;ray<12;ray++){
      var a=ray*Math.PI/6+ray*0.17;
      var r0=core*(0.42+0.12*p), r1=core*(1.16+(ray%3)*0.2);
      ctx.beginPath();
      ctx.moveTo(e.x+Math.cos(a)*r0, e.y+Math.sin(a)*r0);
      ctx.lineTo(e.x+Math.cos(a)*r1, e.y+Math.sin(a)*r1);
      ctx.stroke();
    }
    var n=Math.round(20+e.strength*18);
    for(i=0;i<n;i++){
      var pa=i*2.39996;
      var dist=bs*(0.45+p*(2.2+(i%7)*0.28));
      var px=e.x+Math.cos(pa)*dist, py=e.y+Math.sin(pa)*dist*0.76;
      var pr=Math.max(1.5, bs*(0.14-0.075*p)*(0.75+(i%3)*0.18));
      ctx.fillStyle=(i%3===0)?'#ffffff':e.color;
      ctx.beginPath(); ctx.arc(px,py,pr,0,6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function bigText(ctx,text,x,y,fs){
    ctx.save();
    ctx.font='700 '+fs+'px "Microsoft YaHei",sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineJoin='round'; ctx.lineWidth=Math.max(3,fs*0.1); ctx.strokeStyle='rgba(0,0,0,0.55)';
    ctx.strokeText(text,x,y);
    ctx.fillStyle='#fff';
    ctx.fillText(text,x,y);
    ctx.restore();
  }

  return {
    init:function(a){ api=a; ZL.bind(a); },
    resize:function(){},
    config:function(){ if(audio) audio.volume=volume()/100; },
    mute:function(on){ if(audio) audio.muted=!!on; },
    apply:function(cmd){
      var raw=String((cmd&&cmd.operation)||'').trim().toLowerCase();
      var op=raw==='clear'?'stop':(raw==='restart'?'start':ZL.op(cmd,OPS));
      if(op==='stop'){ stop(); return; }
      if(op==='pause'){ pause(); return; }
      if(op==='resume'){ resume(); return; }
      var name=ZL.who(cmd);
      if(state!=='idle'&&whilePlaying()!=='restart'){
        if(whilePlaying()==='ignore') return;
        encore=Math.min(encore+1,99);
        if(name) api.banner(name+' 又点了一首音乐球，这首放完接着放');
        return;
      }
      begin(false);
      if(name) api.banner(name+' 点了一首音乐球');
    },
    tick:function(dt){
      var step=dt*api.speed();
      nowMs+=step;
      if(state==='idle'||state==='paused') return false;
      if(state==='loading') return true;   // 转圈等节拍分析
      if(state==='countdown' && nowMs>=countdownEnd) playNow();
      var pos=positionMs();
      var R=contentRect();
      var jx=R.x+R.w*0.27, ly=R.y+R.h*0.2;
      // 节拍越线 → 特效
      var crossed=sliceOpen(beats,lastPos,pos);
      for(var i=0;i<crossed.length;i++){
        var b=crossed[i];
        var col=PITCH_COLORS[b.pitch_band&3];
        effects.push({ kind:'ring', t0:nowMs, x:jx, y:ly+(0.5-b.pitch)*Math.min(R.h*0.105,82), color:col, strength:b.strength });
        if(b.burst_score>=burstTh()) effects.push({ kind:'burst', t0:nowMs, x:jx, y:ly, color:col, strength:b.strength });
      }
      lastPos=pos;
      for(var k=effects.length-1;k>=0;k--){
        var age=nowMs-effects[k].t0;
        if(effects[k].kind==='ring'&&age>210) effects.splice(k,1);
        else if(effects[k].kind==='burst'&&age>500) effects.splice(k,1);
      }
      // 播完：循环就从头再来，否则收工
      if(state==='playing'&&audio&&audio.ended){
        if(api.cfg.loop===true){ try{ audio.currentTime=0; }catch(e){} lastPos=-1e9; audio.play().catch(function(){}); }
        else if(encore>0){ encore--; begin(false); return true; }   // 排队的接着放
        else { stop(); return false; }
      }
      return true;
    },
    draw:function(ctx){
      if(state==='idle') return;
      var R=contentRect();
      var pos=positionMs();
      var bs=ballSize();
      var jx=R.x+R.w*0.27, ly=R.y+R.h*0.2, vy=R.y+R.h*0.68;
      var startX=R.x+R.w+bs*1.5;
      ctx.save();
      // 裁剪到内容区外扩 4px
      ctx.beginPath(); ctx.rect(R.x-4,R.y-4,R.w+8,R.h+8); ctx.clip();
      // 轨道线：judge_x → 右缘，白→青渐变
      var grad=ctx.createLinearGradient(jx,0,R.x+R.w-24,0);
      grad.addColorStop(0,'rgba(255,255,255,0.75)');
      grad.addColorStop(0.35,'rgba(77,240,238,0.49)');
      grad.addColorStop(1,'rgba(77,240,238,0.03)');
      ctx.strokeStyle=grad; ctx.lineWidth=4; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(jx,ly); ctx.lineTo(R.x+R.w-24,ly); ctx.stroke();
      // 判定圈：白环 + 光晕 + 到响度层的虚线
      var jr=bs*0.78;
      var jg=ctx.createRadialGradient(jx,ly,jr*0.4,jx,ly,jr*2);
      jg.addColorStop(0,'rgba(255,255,255,0.1)');
      jg.addColorStop(0.72,'rgba(44,250,231,0.12)');
      jg.addColorStop(1,'rgba(44,250,231,0)');
      ctx.fillStyle=jg;
      ctx.beginPath(); ctx.arc(jx,ly,jr*2,0,6.2832); ctx.fill();
      ctx.lineWidth=5; ctx.strokeStyle='#fff';
      ctx.beginPath(); ctx.arc(jx,ly,jr,0,6.2832); ctx.stroke();
      ctx.save();
      ctx.setLineDash([4,5]);
      ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(jx,ly+jr+4); ctx.lineTo(jx,vy-14); ctx.stroke();
      ctx.restore();
      // 响度水晶柱
      var lws=sliceClosed(loudness,pos-100,pos+travel());
      var i;
      for(i=0;i<lws.length;i++){
        var L=lws[i];
        var dL=L.time_ms-pos;
        var x=jx+dL/travel()*(startX-jx);
        var lv=Math.max(0,Math.min(1,Number(L.level)||0));
        var ch=Math.max(7,R.h*0.16*lv);
        var hw=Math.max(3,Math.min(8,R.w*0.0085));
        ctx.save();
        ctx.fillStyle='rgb('+Math.round(42+220*lv)+','+Math.round(225-145*lv)+','+Math.round(242-25*lv)+')';
        ctx.globalAlpha*=0.85;
        ctx.beginPath();
        ctx.moveTo(x,vy-ch);
        ctx.lineTo(x+hw,vy-ch*0.72);
        ctx.lineTo(x+hw,vy+ch*0.72);
        ctx.lineTo(x,vy+ch);
        ctx.lineTo(x-hw,vy+ch*0.72);
        ctx.lineTo(x-hw,vy-ch*0.72);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha*=0.5;
        ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1; ctx.stroke();
        ctx.restore();
      }
      // 响度基线 + 中心圆
      ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(R.x+8,vy+R.h*0.06); ctx.lineTo(R.x+R.w-8,vy+R.h*0.06); ctx.stroke();
      ctx.fillStyle='rgba(20,20,25,0.51)';
      ctx.beginPath(); ctx.arc(jx,vy,11,0,6.2832); ctx.fill();
      ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke();
      // 窗口内的节拍球
      var vis=sliceClosed(beats,Math.max(0,pos),pos+travel());
      for(i=0;i<vis.length;i++){
        var b=vis[i];
        var delta=b.time_ms-pos;
        var bx=jx+delta/travel()*(startX-jx);
        var spread=Math.max(0,Math.min(1,delta/(travel()*0.42)));
        var by=ly+(0.5-b.pitch)*Math.min(R.h*0.105,82)*spread;
        var br=bs*(0.38+0.2*b.strength);
        drawBall(ctx,bx,by,br,PITCH_COLORS[b.pitch_band&3],b.strength);
      }
      // 特效
      for(i=0;i<effects.length;i++){
        var e=effects[i];
        var age=nowMs-e.t0;
        if(e.kind==='ring'){
          var p=age/210;
          ctx.save();
          ctx.globalAlpha*=(1-p);
          ctx.lineWidth=5; ctx.strokeStyle=e.color;
          ctx.beginPath(); ctx.arc(e.x,e.y,bs*(0.66+1.35*p),0,6.2832); ctx.stroke();
          ctx.restore();
        }else{
          drawBurst(ctx,e,age/500);
        }
      }
      // 提示文案
      // 这个玩法不收音，以前写「球到圈时喊」主播喊了没反应
      var cue='跟着节拍，球到圈就炸';
      var cfs=24;
      ctx.save();
      ctx.font='700 '+cfs+'px "Microsoft YaHei",sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.lineJoin='round'; ctx.lineWidth=4; ctx.strokeStyle='rgba(0,0,0,0.55)';
      ctx.strokeText(cue,jx,ly+bs+10);
      ctx.fillStyle='#fff';
      ctx.fillText(cue,jx,ly+bs+10);
      ctx.restore();
      // 倒计时 / 暂停 / 分析中
      var dfs=Math.max(46,Math.min(R.w,R.h)*0.105);
      if(state==='countdown') bigText(ctx,String(Math.max(1,Math.ceil((countdownEnd-nowMs)/1000))),R.x+R.w/2,R.y+R.h*0.76,dfs);
      else if(state==='paused') bigText(ctx,'已暂停',R.x+R.w/2,R.y+R.h/2,Math.max(30,R.h*0.07));
      else if(state==='loading'){
        // 转圈 + 文案
        var sx=R.x+R.w/2, sy=R.y+R.h*0.76, sr=Math.max(14,dfs*0.32);
        ctx.save();
        ctx.lineWidth=4; ctx.lineCap='round'; ctx.strokeStyle='rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(sx,sy,sr,nowMs/160,nowMs/160+4.2); ctx.stroke();
        ctx.restore();
        if(loadText) bigText(ctx,loadText,sx,sy+sr+Math.max(18,dfs*0.4),Math.max(18,dfs*0.38));
      }
      ctx.restore();
    },
    // 只读调试钩子（离线验收用，生产不调用）
    debug:function(){
      var bursts=0, th=burstTh(), bands=[0,0,0,0];
      if(beats) for(var i=0;i<beats.length;i++){ if(beats[i].burst_score>=th) bursts++; bands[beats[i].pitch_band&3]++; }
      return { state:state, encore:encore, pausedFrom:pausedFrom, source:source, beats:beats?beats.length:0, bursts:bursts, bands:bands, loudness:loudness?loudness.length:0,
        sample:beats&&beats.length?beats[Math.floor(beats.length/2)]:null, position:positionMs(), media:audio?[audio]:[] };
    }
  };
})());
`
