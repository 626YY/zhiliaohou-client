import { WIDGET_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
import { captureTitle } from './capture-output'
import { outputsAlwaysOnTop, registerOutputWindow, createCaptureOutputWindow, onOutputWindowClosed, onceOutputPageEvent } from './output-window'
// 礼物心愿 A/B：主进程常驻计数 + 绿幕挂件窗口。
// 美术复刻参考软件 H5（extracted_h5/21_礼物心愿.html）：
//   绿幕 + 两组 vote-box（A 左 B 右，各 380px）金边(3px #FFD700)深紫渐变面板（与积分条同风格族）：
//   金色标题(20px/900/字距2/虚线分隔) + 心愿行（礼物图 48px + 名字 + n/target 进度 + 进度条），达成行金色高亮。
// 计数、达成动作（音效/脚本）全在这里做，页面只是编辑器；老实现页面和主进程各记一次，窗口开着时一份礼物记两次。
import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { readJson, writeJson } from './db'
import { giftNamesEqual } from '../shared/giftName'
import { findGiftImage, runScript } from './entertainment'
import { Ipc, type ConnectorEvent, type WishConfig, type WishGroup, type WishItem, type WishWidgetState } from '@shared/types'
import { announce } from './announce'

let win: BrowserWindow | null = null
let config: WishConfig = normalizeConfig(readJson<Partial<WishConfig>>('wish', {}))

function normalizeWish(value: Partial<WishItem> | undefined): WishItem {
  return {
    gift: String(value?.gift ?? '').trim(),
    target: Math.max(1, Math.trunc(Number(value?.target) || 1)),
    count: Math.max(0, Math.trunc(Number(value?.count) || 0)),
    img: String(value?.img ?? '').trim() || undefined,
    sound: String(value?.sound ?? '').trim() || undefined,
    script: String(value?.script ?? '').trim() || undefined,
    done: value?.done === true
  }
}

function normalizeGroup(value: Partial<WishGroup> | undefined, fallbackTitle: string): WishGroup {
  return {
    title: String(value?.title ?? '').trim() || fallbackTitle,
    wishes: Array.isArray(value?.wishes) ? value.wishes.map(normalizeWish).filter((wish) => wish.gift) : []
  }
}

function normalizeConfig(value?: Partial<WishConfig>): WishConfig {
  const groups = Array.isArray(value?.groups) ? value.groups : []
  return {
    skin: normalizeWidgetSkin(value?.skin),
    groups: [normalizeGroup(groups[0], '礼物心愿'), normalizeGroup(groups[1], '心愿 B')],
    showB: value?.showB === true,
    autoAdd: value?.autoAdd !== false
  }
}

const mediaSrc = (value?: string) => {
  const source = String(value || '').trim()
  if (!source || /^(?:https?|data|file):/i.test(source)) return source
  return 'file:///' + source.replace(/\\/g, '/')
}

const page = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #00FF00; font-family: 'Microsoft YaHei', Arial, sans-serif; overflow: hidden;
  width: 100vw; height: 100vh; user-select: none; }
#wrap { position: absolute; left: 24px; top: 24px; display: flex; gap: 20px; align-items: flex-start; cursor: grab; }
#wrap.dragging { opacity: 0.9; cursor: grabbing; }
.vote-box { width: 380px;
  background: linear-gradient(135deg, rgba(20,24,60,0.9), rgba(60,30,90,0.85));
  border: 3px solid #FFD700; border-radius: 16px; padding: 12px 14px; color: #fff; overflow: hidden;
  box-shadow: 0 8px 28px rgba(0,0,0,0.4), inset 0 0 18px rgba(255,255,255,0.08); }
.vote-title { text-align: center; font-size: 20px; font-weight: 900; color: #FFD700;
  padding: 4px 0 8px 0; border-bottom: 2px dashed rgba(255,215,0,0.4); margin-bottom: 10px;
  letter-spacing: 2px; text-shadow: 0 2px 6px rgba(0,0,0,0.5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vote-rows { display: flex; flex-direction: column; gap: 8px; }
.vote-row { display: flex; gap: 10px; align-items: center; padding: 7px 8px; border-radius: 12px;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); }
.vote-row.done { background: rgba(255,215,0,0.18); border-color: rgba(255,215,0,0.6); animation: done .6s ease-out 1; }
@keyframes done { 0% { transform: scale(1); } 40% { transform: scale(1.04); box-shadow: 0 0 22px #FFD700; } 100% { transform: scale(1); } }
.vote-row img { width: 48px; height: 48px; object-fit: contain; flex-shrink: 0; }
.row-main { flex: 1; min-width: 0; }
.row-name { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vote-row.done .row-name { color: #FFD700; }
.row-bar { margin-top: 5px; height: 10px; border-radius: 999px; background: rgba(0,0,0,0.4);
  border: 1px solid rgba(255,255,255,0.2); overflow: hidden; }
.row-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #FFD700, #FF9800);
  transition: width 0.4s ease; }
.row-num { font-size: 14px; font-weight: 900; white-space: nowrap; flex-shrink: 0; }
.vote-row.done .row-num { color: #FFD700; }
.row-num .hit { color: #FFD700; }
.empty { text-align: center; color: rgba(255,255,255,.55); font-size: 13px; padding: 10px 0; }
${WIDGET_SKIN_CSS}

body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-title,.vote-title,.title b,.now .gift,.milestone.reached .milestone-label,.row-num .hit,.vote-row.done .row-name,.vote-row.done .row-num) {color:var(--ws-accent);text-shadow:none;letter-spacing:.5px}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-score,.milestone,.row-num,.row-name) {color:var(--ws-text);text-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-header,.vote-title,.title) {border-bottom:1px solid var(--ws-line)}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.bar-fill,.row-fill,.milestone.reached .milestone-dot) {background:var(--ws-accent);box-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.bar-section,.row-bar,.vote-row,.now,.row) {background:var(--ws-surface);border:1px solid var(--ws-line);box-shadow:none;animation:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.title span,.sub,.idx,.more,.empty,.now.idle) {color:var(--ws-muted)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .tag {background:var(--ws-accent);color:var(--ws-bg)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .bar-text {color:var(--ws-text);mix-blend-mode:normal}
</style>
</head>
<body>
<div id="wrap"></div>
<script>
  var CFG = { groups: [{ title: '礼物心愿', wishes: [] }, { title: '心愿 B', wishes: [] }], showB: false };
  function esc2(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function renderGroup(group) {
    var box = document.createElement('div');
    box.className = 'vote-box skin-panel';
    var title = document.createElement('div');
    title.className = 'vote-title';
    title.textContent = group.title;
    box.appendChild(title);
    var rows = document.createElement('div');
    rows.className = 'vote-rows';
    if (!group.wishes.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = '还没有心愿礼物'; rows.appendChild(e); }
    group.wishes.forEach(function (w) {
      var done = w.count >= w.target;
      var pct = Math.min(100, (w.count * 100) / w.target);
      var div = document.createElement('div');
      div.className = 'vote-row' + (done ? ' done' : '');
      div.innerHTML =
        (w.img ? '<img src="' + esc2(w.img) + '" onerror="this.style.display=\\'none\\'">' : '') +
        '<div class="row-main"><div class="row-name">' + esc2(w.gift) + (done ? ' ✔' : '') + '</div>' +
        '<div class="row-bar"><div class="row-fill" style="width:' + pct + '%"></div></div></div>' +
        '<div class="row-num"><span class="hit">' + w.count + '</span> / ' + w.target + '</div>';
      rows.appendChild(div);
    });
    box.appendChild(rows);
    return box;
  }
  function render() {
    document.body.dataset.widgetSkin = CFG.skin || 'classic';
    var wrap = document.getElementById('wrap');
    wrap.innerHTML = '';
    wrap.appendChild(renderGroup(CFG.groups[0]));
    if (CFG.showB) wrap.appendChild(renderGroup(CFG.groups[1]));
  }
  render();
  window.__update = function (cfg) { CFG = cfg; render(); };

  // 拖动
  var wrap = document.getElementById('wrap');
  var dragging = false, ox = 0, oy = 0;
  wrap.addEventListener('mousedown', function (e) {
    dragging = true; ox = e.screenX - window.screenX; oy = e.screenY - window.screenY;
    wrap.classList.add('dragging'); e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    try { window.moveTo(e.screenX - ox, e.screenY - oy); } catch (err) {}
  });
  document.addEventListener('mouseup', function () { dragging = false; wrap.classList.remove('dragging'); });
</script>
</body></html>`

function pageConfig() {
  return {
    skin: config.skin,
    showB: config.showB,
    groups: config.groups.map((group) => ({
      title: group.title,
      wishes: group.wishes.map((wish) => ({ gift: wish.gift, target: wish.target, count: wish.count, img: mediaSrc(wish.img || autoImage(wish.gift)) }))
    }))
  }
}

function autoImage(gift: string): string {
  return findGiftImage(gift)?.path || ''
}

function push(): void {
  if (win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(`window.__update && window.__update(${JSON.stringify(pageConfig())})`).catch(() => {})
  }
  const state = wishWindowState()
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed() && target !== win) target.webContents.send(Ipc.WishChanged, state)
  }
}

// 落盘防抖：每个礼物事件都 fsync 一次会把主线程拖住（热门房每秒几十事件），800ms 内合并成一次；退出前冲刷
let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, 800)
}
app.on('before-quit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saveNow()
  }
})
function saveNow(): void {
  writeJson('wish', config)
}

function playSound(soundPath: string): void {
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed() && target !== win) target.webContents.send(Ipc.EntertainmentSound, { path: soundPath, mode: 'sync' })
  }
}

export function openWishWindow(): { ok: boolean; error?: string } {
  try {
    if (win) {
      try { win.close() } catch { /* ignore */ }
      win = null
    }
    const tmp = path.join(app.getPath('userData'), 'wish-widget.html')
    fs.writeFileSync(tmp, page())
    win = createCaptureOutputWindow({
      title: '心愿单',
      width: config.showB ? 860 : 460,
      height: 460,
      frame: false,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: true,
      skipTaskbar: true,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '心愿单')
    win.loadFile(tmp)
    registerOutputWindow(win)
    onOutputWindowClosed(win, () => { win = null })
    onceOutputPageEvent(win, 'did-finish-load', () => push())
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开心愿窗口失败：' + (e as Error).message }
  }
}

export function closeWishWindow(): { ok: boolean } {
  try { win?.close() } catch { /* ignore */ }
  win = null
  return { ok: true }
}

export function wishWindowState(): WishWidgetState {
  return {
    open: !!win && !win.isDestroyed(),
    config: { ...config, groups: [
      { ...config.groups[0], wishes: config.groups[0].wishes.map((w) => ({ ...w })) },
      { ...config.groups[1], wishes: config.groups[1].wishes.map((w) => ({ ...w })) }
    ] }
  }
}

export function configureWish(value: Partial<WishConfig>): { ok: boolean } {
  const previousShowB = config.showB
  config = normalizeConfig({ ...config, ...value })
  save()
  if (win && !win.isDestroyed() && previousShowB !== config.showB) {
    win.setSize(config.showB ? 860 : 460, win.getSize()[1])
  }
  push()
  return { ok: true }
}

// 清零：group 不传=两组全清；gift 不传=整组清
export function wishReset(group?: 0 | 1, gift?: string): { ok: boolean } {
  config.groups.forEach((item, index) => {
    if (group != null && index !== group) return
    item.wishes.forEach((wish) => {
      if (gift && !giftNamesEqual(wish.gift, gift)) return
      wish.count = 0
      wish.done = false
    })
  })
  save()
  push()
  return { ok: true }
}

// 礼物事件由主进程常驻运行时调用；数量按真实连击数累加（用户铁律：不设上限）
export function handleWishGift(event: ConnectorEvent): void {
  if (event.type !== 'gift' || !event.giftName || !config.autoAdd) return
  const amount = Math.max(1, Math.trunc(Number(event.count) || 1))
  let changed = false
  for (const group of config.groups) {
    for (const wish of group.wishes) {
      if (!giftNamesEqual(wish.gift, event.giftName)) continue
      changed = true
      wish.count += amount
      if (!wish.img && event.giftImage) wish.img = event.giftImage
      if (wish.count >= wish.target && !wish.done) {
        wish.done = true
        if (wish.sound) playSound(wish.sound)
        if (wish.script) runScript(wish.script)
        // AI 语音播报：念「心愿达成，小心心100个」；配了达成音效的默认不念
        announce('progress', `心愿达成，${wish.gift}${wish.target}个`, { hasOwnMedia: !!wish.sound })
      }
    }
  }
  if (changed) {
    save()
    push()
  }
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
})
