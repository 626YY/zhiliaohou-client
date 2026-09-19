// 观众滚动条：底色 / 边线跟插件皮肤（格子底色 + 边框色）。2026-09-11 曾按要求做成透底，2026-09-13 用户改口：
// 直播伴侣抠绿幕时透底的字会一起被抠掉，「跟皮肤一个主题」。
// 30px 高度不变，8 秒没新记录淡出；昵称 / 礼物名里的 emoji 贴图。
// 2026-09-13：昵称、礼物名不再截断（用户「飞鸟🐦‍⬛…」被切成省略号），整条滚动条本来就会横向平移，长就长。
export const TIME_TICKER_CSS = `
#ticker{position:relative;width:100%;height:30px;box-sizing:border-box;overflow:hidden;background:var(--tk-bg,rgba(36,36,40,.92));border:1px solid var(--tk-line,rgba(255,255,255,.2));border-radius:6px;opacity:0;transition:opacity .25s ease;-webkit-app-region:drag}
#ticker.on{opacity:1}
#ticker-track{position:absolute;left:0;top:0;display:flex;align-items:center;gap:16px;width:max-content;height:100%;padding:0 8px;box-sizing:border-box;white-space:nowrap;transition:transform .35s cubic-bezier(.22,.61,.36,1)}
#ticker .tk{position:relative;display:flex;flex:0 0 auto;align-items:center;gap:6px;min-width:0;font-size:var(--tk-size,12px);line-height:1.4;font-weight:500;color:var(--tk-text);text-shadow:0 1px 3px rgba(0,0,0,.6)}
#ticker .tk+.tk::before{content:'';position:absolute;left:-9px;top:25%;height:50%;border-left:1px solid var(--tk-line)}
#ticker .tk img,#ticker .tk-empty{display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:var(--avatar-radius);object-fit:cover;background:color-mix(in srgb,var(--tk-text) 10%,transparent);color:var(--tk-muted);flex:none;font-size:10px}
#ticker .tk-name{flex:0 0 auto;white-space:nowrap}
#ticker .tk-gift{flex:0 0 auto;white-space:nowrap;color:var(--tk-muted);font-weight:400}
#ticker .tk-delta{flex:none;max-width:48%;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-variant-numeric:tabular-nums}
#ticker .tk-add{color:var(--tk-add)}
#ticker .tk-sub{color:var(--tk-sub)}
#ticker .tk-zero{color:var(--tk-muted)}
@media(prefers-reduced-motion:reduce){#ticker,#ticker-track{transition:none}}
`

export const TIME_TICKER_SCRIPT = `
var tickerHideTimer=0;
function tickerFace(name){var face=document.createElement('span');face.className='tk-empty';face.setAttribute('aria-hidden','true');if(window.__emojiFace)window.__emojiFace(face,name);else face.textContent=Array.from(name)[0]||'观';return face}
function tickerText(el,text){if(window.__zlText)window.__zlText(el,text);else el.textContent=text;return el}
// 头像晚到：连接器下载完才打「头像:」行，把已经上了滚动条的同一昵称换成真头像
window.__tickerAvatar=function(name,src){var n=0;document.querySelectorAll('#ticker .tk').forEach(function(row){if(row.dataset.name!==String(name))return;var face=row.querySelector('.tk-empty');if(!face)return;var image=document.createElement('img');image.alt='';image.src=src;image.onerror=function(){this.replaceWith(tickerFace(name))};face.replaceWith(image);n++});return n};
function fitTicker(){
  var box=document.getElementById('ticker'),track=document.getElementById('ticker-track');if(!box||!track)return;
  box.style.setProperty('--tk-max-width',Math.max(1,box.clientWidth-16)+'px');
  track.querySelectorAll('.tk-delta').forEach(function(el){var size=Math.max(10,Math.min(16,Math.round((cfg.giftNameSize||16)*.75)));el.style.fontSize=size+'px';
    while(el.scrollWidth>el.clientWidth&&size>9){size--;el.style.fontSize=size+'px'}
  });
  track.style.transform='translateX('+Math.min(0,box.clientWidth-track.scrollWidth)+'px)';
}
window.addEventListener('resize',fitTicker);
// 保留最近 12 条；新记录从右侧进入，8 秒无新记录淡出，倒计时高度不变。
window.__ticker=function(entry){
  var box=document.getElementById('ticker'),track=document.getElementById('ticker-track');
  if(!box||!track||!entry)return {ok:false};
  var name=String(entry.name||'观众'),row=document.createElement('div');row.className='tk';row.dataset.name=name;
  if(entry.avatar){var image=document.createElement('img');image.alt='';image.src=entry.avatar;image.onerror=function(){this.replaceWith(tickerFace(name))};row.appendChild(image)}
  else row.appendChild(tickerFace(name));
  var who=document.createElement('span');who.className='tk-name';tickerText(who,name);row.appendChild(who);
  if(entry.gift){var gift=document.createElement('span');gift.className='tk-gift';tickerText(gift,String(entry.gift));row.appendChild(gift)}
  var delta=Math.round(Number(entry.delta)||0),amount=document.createElement('span');amount.className='tk-delta '+(delta<0?'tk-sub':delta>0?'tk-add':'tk-zero');
  amount.textContent=fmtDelta(delta);row.appendChild(amount);row.title=name+' · '+String(entry.gift||'')+' · '+amount.textContent;
  track.appendChild(row);while(track.children.length>12)track.removeChild(track.firstChild);
  fitTicker();box.classList.add('on');clearTimeout(tickerHideTimer);
  tickerHideTimer=setTimeout(function(){box.classList.remove('on')},8000);
  return {ok:true,count:track.children.length};
};
`
