import type { TimeWidgetConfig } from '../shared/types'
import { FRAME_W } from '../shared/countdownFrame'
import { emojiPageScript } from './emoji-assets'

// 记录窗口只排单行明细，字号、颜色和缩放沿用时间插件设置。
function rowLayout(cfg: TimeWidgetConfig): { nameSize: number; textSize: number; iconSize: number; cellH: number } {
  const nameSize = Math.max(10, Math.round((Number(cfg.giftNameSize) || 16) * 0.75))
  const textSize = Math.max(10, Math.round((Number(cfg.giftTextSize) || 16) * 0.75))
  const iconSize = Math.max(14, Math.round((Number(cfg.giftIconSize) || 42) * 0.43))
  const cellH = Math.max(28, iconSize + 10, Math.ceil(Math.max(nameSize, textSize) * 1.5) + 10)
  return { nameSize, textSize, iconSize, cellH }
}

export function timeLogMetrics(cfg: TimeWidgetConfig, count: number, width = FRAME_W): {
  w: number; h: number; rows: number; maxRows: number; cellH: number; scale: number; panelW: number
} {
  const scale = Math.max(0.4, Math.min(4, Number(cfg.scale) || 1))
  const maxRows = Math.max(1, Math.min(30, Math.trunc(Number(cfg.logRows) || 8)))
  const rows = Math.max(1, Math.min(maxRows, count))
  const panelW = Math.round(width * Math.max(1, Math.min(2.5, Number(cfg.giftPanelWidth) || 1)))
  const { cellH } = rowLayout(cfg)
  // Windows 无边框窗口仍有约 39px 的系统最小高度；预留到 40px，避免反复缩窗和透明空边。
  return { w: Math.round(panelW * scale), h: Math.max(40, Math.round(rows * cellH * scale)), rows, maxRows, cellH, scale, panelW }
}

function pageJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function compactTimeLogHtml(cfg: TimeWidgetConfig, width = FRAME_W): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>抽时间记录</title><style>
*{box-sizing:border-box}
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font-family:"Microsoft YaHei",sans-serif}
#stage{transform-origin:0 0}
#panel{width:var(--log-width);min-height:var(--log-min-height);color:var(--log-text);background:var(--log-bg);-webkit-app-region:drag;user-select:none;overflow:hidden}
#log-panel{display:grid;gap:0;min-height:inherit;grid-auto-rows:minmax(var(--log-row),1fr)}
.gift-cell{display:flex;align-items:center;gap:6px;min-width:0;min-height:var(--log-row);padding:0 8px;font-size:var(--log-name-size);line-height:1.4;overflow:hidden}
.gift-cell+.gift-cell{border-top:1px solid color-mix(in srgb,var(--log-text) 8%,transparent)}
.gift-icon{display:flex;flex:none;align-items:center;justify-content:center;width:var(--log-icon);height:var(--log-icon);overflow:hidden;border-radius:50%}
.gift-icon img{display:block;width:100%;height:100%;object-fit:cover}
.lg-face{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:color-mix(in srgb,var(--log-text) 10%,transparent);color:var(--log-muted);font-size:10px}
.gift-text{display:flex;align-items:baseline;gap:6px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}
.gift-name{flex:0 1 auto;max-width:52%;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.lg-gift{flex:1;min-width:0;font-size:var(--log-text-size);color:var(--log-muted);overflow:hidden;text-overflow:ellipsis}
.lg-delta{flex:none;max-width:48%;font-size:var(--log-text-size);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.lg-delta.add{color:var(--log-add)}
.lg-delta.sub{color:var(--log-sub)}
.lg-delta.zero{color:var(--log-muted)}
.lg-empty{justify-content:center;color:var(--log-muted);font-size:var(--log-text-size)}
body:is([data-theme="arcade"],[data-theme="terminal"]) .gift-icon{border-radius:0}
body:is([data-theme="paper"],[data-theme="ticket"],[data-theme="graphite"],[data-theme="theatre"]) .gift-icon{border-radius:3px}
</style>${emojiPageScript()}</head><body><div id="stage"><div id="panel"><div id="log-panel" role="list" aria-label="送礼记录"></div></div></div><script>
var cfg=${pageJson(cfg)},baseWidth=${width};
var zlText=window.__zlText||function(el,t){el.textContent=t;return el};
var rowLayout=${rowLayout.toString()};
var stage=document.getElementById('stage'),panel=document.getElementById('panel'),list=document.getElementById('log-panel');
var rowsData=[],lastKey='';
function fmtDelta(value){
  var neg=value<0,v=Math.abs(Math.round(value)),h=Math.floor(v/3600),m=Math.floor((v%3600)/60),s=v%60;
  var text=h?h+'小时'+(m?m+'分':''):m?m+'分'+(s?s+'秒':''):s+'秒';
  return (neg?'-':'+')+text;
}
function rgba(hex,alpha){var n=parseInt(String(hex).replace('#',''),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')'}
function initials(who){var el=document.createElement('span');el.className='lg-face';if(window.__emojiFace)window.__emojiFace(el,who);else el.textContent=Array.from(who)[0]||'观';return el}
function render(){
  list.textContent='';
  if(!rowsData.length){var empty=document.createElement('div');empty.className='gift-cell lg-empty';empty.textContent='暂无送礼记录';list.appendChild(empty);return}
  rowsData.slice(0,Math.max(1,Math.min(30,Number(cfg.logRows)||8))).forEach(function(row){
    var who=String(row.sender||'观众'),gift=String(row.name||''),delta=Math.round(Number(row.delta)||0);
    var cell=document.createElement('div');cell.className='gift-cell';cell.setAttribute('role','listitem');
    cell.title=new Date(row.ts).toLocaleTimeString('zh-CN',{hour12:false})+' '+who+' · '+gift+' · '+fmtDelta(delta);
    var icon=document.createElement('span');icon.className='gift-icon';icon.setAttribute('aria-hidden','true');
    if(row.avatar){var img=document.createElement('img');img.alt='';img.src=row.avatar;img.onerror=function(){this.replaceWith(initials(who))};icon.appendChild(img)}else icon.appendChild(initials(who));
    var text=document.createElement('div');text.className='gift-text';
    var name=document.createElement('span');name.className='gift-name';zlText(name,who);
    var item=document.createElement('span');item.className='lg-gift';zlText(item,gift);
    var amount=document.createElement('span');amount.className='lg-delta '+(delta<0?'sub':delta>0?'add':'zero');amount.textContent=fmtDelta(delta);
    text.appendChild(name);text.appendChild(item);cell.appendChild(icon);cell.appendChild(text);cell.appendChild(amount);list.appendChild(cell);
    var size=rowLayout(cfg).textSize;amount.style.fontSize=size+'px';
    while(amount.scrollWidth>amount.clientWidth&&size>9){size--;amount.style.fontSize=size+'px'}
  });
}
function applyConfig(next,width){
  if(Number.isFinite(width)&&width>0)baseWidth=width;
  cfg=next||cfg;document.body.dataset.theme=cfg.theme;
  var layout=rowLayout(cfg),scale=Math.max(0.4,Math.min(4,Number(cfg.scale)||1));
  var style=panel.style,text=cfg.giftNameColor||'white';
  style.setProperty('--log-width',Math.round(baseWidth*Math.max(1,Math.min(2.5,Number(cfg.giftPanelWidth)||1)))+'px');
  style.setProperty('--log-row',layout.cellH+'px');style.setProperty('--log-icon',layout.iconSize+'px');
  style.setProperty('--log-name-size',layout.nameSize+'px');style.setProperty('--log-text-size',layout.textSize+'px');
  style.setProperty('--log-text',text);style.setProperty('--log-muted','color-mix(in srgb,'+text+' 68%,transparent)');
  style.setProperty('--log-bg',rgba(cfg.cellBg,cfg.cellAlpha==null?0.92:cfg.cellAlpha));
  style.setProperty('--log-add',cfg.addColor||text);style.setProperty('--log-sub',cfg.subColor||text);
  stage.style.transform='scale('+scale+')';fitViewport();lastKey='';render();
}
function fitViewport(){panel.style.setProperty('--log-min-height',(innerHeight/Math.max(0.4,Math.min(4,Number(cfg.scale)||1)))+'px')}
window.addEventListener('resize',fitViewport);
window.__setConfig=applyConfig;
window.__log=function(rows){var next=Array.isArray(rows)?rows:[],key=JSON.stringify(next);
  if(key===lastKey)return {ok:true,count:next.length,same:true};
  lastKey=key;rowsData=next;render();return {ok:true,count:next.length};
};
applyConfig(cfg);
</script></body></html>`
}
