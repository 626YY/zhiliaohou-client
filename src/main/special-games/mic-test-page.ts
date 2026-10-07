// 详情页「麦克风测试」用的小页面（zlspecial://app/mictest.html，详情页里用隐藏的 iframe 打开）。
// 跑的是和直播窗口完全一样的识别代码（shared.ts 的 ZL.startClap / ZL.startShout），
// 把实时音量和「认出来了」回报给详情页；只在详情页发 start 之后才开麦克风，stop / 页面关掉就释放。
// 消息：详情页 → 本页 {source:'zl-mictest-host', type:'start', kind:'clap'|'shout', threshold, sensitivity, cooldownMs, triggerMode, deviceLabel} / {type:'stop'}
//       本页 → 详情页 {source:'zl-mictest', type:'ready'|'state'|'level'|'hit', state?, level?}
// ★页面脚本同样禁止反引号与 ${…}（和玩法代码一样按字符串拼进页面）。
import { SHARED_JS, MIC_CLAP_JS } from './shared'

const BRIDGE_JS = `
(function(){
  var ZL=window.__ZL;
  ZL.bind({ preview:false, asset:function(r){ return r; }, fileUrl:function(p){ return p; }, cfg:{} });
  var cur=null;
  function post(m){ m.source='zl-mictest'; try{ window.parent.postMessage(m,'*'); }catch(e){} }
  function stop(){ if(cur){ try{ cur.stop(); }catch(e){} cur=null; } }
  window.addEventListener('message',function(e){
    if(e.source!==window.parent) return;
    var d=e.data||{}; if(d.source!=='zl-mictest-host') return;
    if(d.type==='stop'){ stop(); return; }
    if(d.type!=='start') return;
    stop();
    var o={ deviceLabel:String(d.deviceLabel||''), threshold:Number(d.threshold), cooldownMs:Number(d.cooldownMs),
      onState:function(s){ post({ type:'state', state:s }); },
      onLevel:function(l){ post({ type:'level', level:l }); } };
    if(d.kind==='shout'){ o.onShout=function(l){ post({ type:'hit', level:l }); }; cur=ZL.startShout(o); }
    else { o.sensitivity=Number(d.sensitivity); o.triggerMode=String(d.triggerMode||'clap'); o.onClap=function(l){ post({ type:'hit', level:l }); }; cur=ZL.startClap(o); }
  });
  window.addEventListener('pagehide',stop);
  post({ type:'ready' });
})();
`

export function buildMicTestPage(): string {
  return '<!doctype html><html><head><meta charset="utf-8"><title>麦克风测试</title></head><body>'
    + '<script>' + SHARED_JS + '</script><script>' + MIC_CLAP_JS + '</script><script>' + BRIDGE_JS + '</script></body></html>'
}
