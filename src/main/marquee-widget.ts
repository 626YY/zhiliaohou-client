import { WIDGET_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
import { captureTitle } from './capture-output'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed } from './output-window'
// 飘屏（复刻参考软件「飘屏」：透明置顶窗，礼物/弹幕/关注/进场消息滚动显示）
// 外观全部可调：样式（胶囊/弹幕/霓虹）、字号、颜色、底色透明度、停留时间、条数、位置、尺寸、文案模板。
// 事件消费在主进程常驻（页面切走照样飘），页面只推配置。
import { BrowserWindow, app, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import { readJson, writeJson } from './db'
import type { ConnectorEvent, MarqueeConfig, MarqueePosition, MarqueeStyle } from '@shared/types'
import { giftNamesEqual } from './connector-events'

// 主进程里的配置永远是补全过的（页面/存档可能缺字段）
type MarqueeSettings = Required<MarqueeConfig>

let win: BrowserWindow | null = null
let config: MarqueeSettings = normalizeConfig(readJson<Partial<MarqueeConfig>>('marquee', {}))

function normalizeConfig(value?: Partial<MarqueeConfig>): MarqueeSettings {
  const num = (item: unknown, fallback: number, min: number, max: number) => {
    const n = Number(item)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  const position: MarqueePosition = value?.position === 'bottom-right' || value?.position === 'top-left' || value?.position === 'top-right' ? value.position : 'bottom-left'
  const style: MarqueeStyle = value?.style === 'danmu' || value?.style === 'neon' ? value.style : normalizeWidgetSkin(value?.style) !== 'classic' ? normalizeWidgetSkin(value?.style) : 'pill'
  return {
    giftOn: value?.giftOn !== false,
    chatOn: value?.chatOn === true,
    gifts: Array.isArray(value?.gifts) ? value.gifts.map((gift) => String(gift || '').trim()).filter(Boolean) : [],
    chatKeywords: String(value?.chatKeywords || '').trim(),
    followOn: value?.followOn === true,
    memberOn: value?.memberOn === true,
    style,
    fontSize: Math.trunc(num(value?.fontSize, 18, 10, 120)),
    color: /^#[0-9a-fA-F]{6}$/.test(String(value?.color || '')) ? String(value?.color) : '#ffffff',
    bgOpacity: num(value?.bgOpacity, 0.55, 0, 1),
    keepMs: Math.trunc(num(value?.keepMs, 3500, 300, 600_000)),
    maxLines: Math.trunc(num(value?.maxLines, 6, 1, 50)),
    showImage: value?.showImage !== false,
    position,
    width: Math.trunc(num(value?.width, 420, 160, 3840)),
    height: Math.trunc(num(value?.height, 300, 80, 2160)),
    giftTemplate: String(value?.giftTemplate ?? '').trim() || '{name}：{gift}{count}',
    chatTemplate: String(value?.chatTemplate ?? '').trim() || '{name}：{text}'
  }
}

function mediaSrc(value?: string): string {
  const source = String(value || '').trim()
  if (!source || /^(?:https?|data|file):/i.test(source)) return source
  return 'file:///' + source.replace(/\\/g, '/')
}

function pageConfig(cfg: MarqueeSettings) {
  return {
    style: cfg.style, fontSize: cfg.fontSize, color: cfg.color, bgOpacity: cfg.bgOpacity, keepMs: cfg.keepMs,
    maxLines: cfg.maxLines, showImage: cfg.showImage, fromTop: cfg.position === 'top-left' || cfg.position === 'top-right',
    alignRight: cfg.position === 'bottom-right' || cfg.position === 'top-right'
  }
}

const page = (cfg: MarqueeSettings) => `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>
html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:transparent; }
#list { position:absolute; inset:0; display:flex; flex-direction:column; gap:8px; padding:12px; box-sizing:border-box; pointer-events:none; }
#list.bottom { justify-content:flex-end; }
#list.top { justify-content:flex-start; }
#list.right { align-items:flex-end; }
#list.left { align-items:flex-start; }
.msg { display:flex; align-items:center; gap:8px; max-width:100%; box-sizing:border-box; color:var(--c); font-weight:bold; font-size:var(--fs);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; animation: slideIn 0.25s ease-out forwards; font-family:"Microsoft YaHei", sans-serif; }
.msg span { overflow:hidden; text-overflow:ellipsis; }
.msg img { width:calc(var(--fs) * 1.9); height:calc(var(--fs) * 1.9); object-fit:contain; border-radius:6px; flex:none; }
/* 胶囊：黑底圆角 + 描边 */
.pill .msg { background:rgba(0,0,0,var(--bg)); border-radius:10px; padding:8px 14px;
  text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000; }
/* 弹幕：无底，纯描边文字 */
.danmu .msg { padding:2px 4px; text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000,0 0 6px rgba(0,0,0,.8); }
/* 霓虹：深底青边发光 */
.neon .msg { background:rgba(8,6,20,var(--bg)); border:2px solid #7df9ff; border-radius:12px; padding:8px 14px;
  box-shadow:0 0 12px #7df9ff, inset 0 0 10px rgba(125,249,255,.25); text-shadow:0 0 8px #7df9ff; }
.neon .msg b { color:#ff4de1; text-shadow:0 0 10px #ff4de1; }
.pill .msg b, .danmu .msg b { color:#ffd54a; }
@keyframes slideIn { from { transform: translateX(40px); opacity:0; } to { transform: translateX(0); opacity:1; } }
.right .msg { animation-name: slideInR; }
@keyframes slideInR { from { transform: translateX(-40px); opacity:0; } to { transform: translateX(0); opacity:1; } }
.fade { opacity:0 !important; transition: opacity 0.6s ease; }
${WIDGET_SKIN_CSS}
body[data-widget-skin]:not([data-widget-skin="classic"]) .msg {background:var(--ws-bg);color:var(--c);border:1px solid var(--ws-line);border-left:4px solid var(--ws-accent);border-radius:var(--ws-radius);padding:9px 14px;text-shadow:none;box-shadow:0 3px 10px rgb(0 0 0 / .15)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .msg b {color:var(--ws-accent);text-shadow:none}
</style></head>
<body><div id="list"></div>
<script>
  var CFG = ${JSON.stringify(pageConfig(cfg))};
  var list = document.getElementById('list');
  function applyCfg() {
    document.body.className = CFG.style;
    document.body.dataset.widgetSkin = ['pill','danmu','neon'].includes(CFG.style) ? 'classic' : CFG.style;
    list.className = (CFG.fromTop ? 'top' : 'bottom') + ' ' + (CFG.alignRight ? 'right' : 'left');
    document.documentElement.style.setProperty('--fs', CFG.fontSize + 'px');
    document.documentElement.style.setProperty('--c', CFG.color);
    document.documentElement.style.setProperty('--bg', String(CFG.bgOpacity));
  }
  applyCfg();
  window.__config = function (next) { for (var k in next) CFG[k] = next[k]; applyCfg(); };
  // 文案里用 {b}...{/b} 包住要高亮的部分（礼物名/关键词）
  window.__msg = function (text, img) {
    var d = document.createElement('div');
    d.className = 'msg skin-motion-panel';
    if (img && CFG.showImage) { var im = document.createElement('img'); im.src = img; im.onerror = function(){ this.style.display='none'; }; d.appendChild(im); }
    var sp = document.createElement('span');
    var parts = String(text).split(/\\{b\\}|\\{\\/b\\}/);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) { var b = document.createElement('b'); b.textContent = parts[i]; sp.appendChild(b); }
      else sp.appendChild(document.createTextNode(parts[i]));
    }
    d.appendChild(sp);
    if (CFG.fromTop) list.insertBefore(d, list.firstChild); else list.appendChild(d);
    while (list.children.length > CFG.maxLines) list.removeChild(CFG.fromTop ? list.lastChild : list.firstChild);
    setTimeout(function () { d.classList.add('fade'); setTimeout(function(){ if (d.parentNode) d.parentNode.removeChild(d); }, 650); }, CFG.keepMs);
  };
</script>
</body></html>`

function bounds(cfg: MarqueeSettings): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  const margin = 40
  const x = cfg.position === 'bottom-right' || cfg.position === 'top-right' ? area.x + area.width - cfg.width - margin : area.x + margin
  const y = cfg.position === 'top-left' || cfg.position === 'top-right' ? area.y + margin : area.y + area.height - cfg.height - margin
  return { x, y }
}

export function openMarquee(value?: Partial<MarqueeConfig>): { ok: boolean; error?: string } {
  try {
    if (value) configureMarquee(value, false)
    if (win) {
      try { win.close() } catch { /* ignore */ }
      win = null
    }
    const tmp = path.join(app.getPath('userData'), 'marquee-widget.html')
    fs.writeFileSync(tmp, page(config))
    const { x, y } = bounds(config)
    win = createCaptureOutputWindow({
      title: '飘屏',
      width: config.width,
      height: config.height,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '飘屏')
    win.loadFile(tmp)
    registerOutputWindow(win)
    onOutputWindowClosed(win, () => { win = null })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开飘屏失败：' + (e as Error).message }
  }
}

export function marqueeSend(text: string, imgSrc?: string): { ok: boolean } {
  try {
    if (!win || win.isDestroyed()) return { ok: false }
    win.webContents.executeJavaScript(
      `window.__msg && window.__msg(${JSON.stringify(String(text || ''))}, ${JSON.stringify(imgSrc || '')})`
    ).catch(() => {})
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function closeMarquee(): { ok: boolean } {
  try { win?.close() } catch { /* ignore */ }
  win = null
  return { ok: true }
}

export function marqueeState(): { open: boolean; config: MarqueeConfig } {
  return { open: !!win && !win.isDestroyed(), config: { ...config, gifts: [...config.gifts] } }
}

export function configureMarquee(value: Partial<MarqueeConfig>, apply = true): { ok: boolean } {
  const previous = config
  config = normalizeConfig({ ...config, ...value })
  writeJson('marquee', config)
  if (apply && win && !win.isDestroyed()) {
    const moved = previous.position !== config.position || previous.width !== config.width || previous.height !== config.height
    if (moved) {
      win.setResizable(true)
      win.setSize(config.width, config.height)
      win.setResizable(false)
      const { x, y } = bounds(config)
      win.setPosition(x, y)
    }
    win.webContents.executeJavaScript(`window.__config && window.__config(${JSON.stringify(pageConfig(config))})`).catch(() => {})
  }
  return { ok: true }
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(name|gift|count|text)\}/g, (_m, key: string) => values[key] ?? '')
}

export function handleMarqueeEvent(event: ConnectorEvent): void {
  if (!win || win.isDestroyed()) return
  const sender = String(event.sender || '')
  if (event.type === 'gift' && event.giftName && config.giftOn) {
    if (config.gifts.length && !config.gifts.some((gift) => giftNamesEqual(gift, event.giftName))) return
    const count = Math.max(1, Math.trunc(Number(event.count) || 1))
    const text = fill(config.giftTemplate || '{name}：{gift}{count}', { name: sender || '神秘观众', gift: `{b}${event.giftName}{/b}`, count: count > 1 ? ` ×${count}` : '', text: '' })
    marqueeSend(text, mediaSrc(event.giftImage))
    return
  }
  if (event.type === 'comment' && event.text && config.chatOn) {
    if (config.chatKeywords && !event.text.includes(config.chatKeywords)) return
    marqueeSend(fill(config.chatTemplate || '{name}：{text}', { name: sender, text: event.text, gift: '', count: '' }), mediaSrc(event.avatar))
    return
  }
  if ((event.type === 'follow' || event.type === 'badge') && config.followOn) {
    marqueeSend(`{b}${sender || '有人'}{/b} ${event.type === 'badge' ? '点亮了灯牌' : '关注了主播'}`, mediaSrc(event.avatar))
    return
  }
  if (event.type === 'member' && config.memberOn) {
    marqueeSend(`{b}${sender || '有人'}{/b} 来了`, mediaSrc(event.avatar))
  }
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
})
