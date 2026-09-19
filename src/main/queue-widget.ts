import { WIDGET_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
import { captureTitle } from './capture-output'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, onceOutputPageEvent } from './output-window'
// 整蛊排队展示窗口：把礼物规则执行队列摆到直播画面上——正在执行哪条、后面还排着谁送的什么。
// 复刻参考软件「整蛊排队」插件（图片框_整蛊排队）。队列本体在 entertainment.ts，这里只负责展示。
import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { readJson, writeJson } from './db'
import { execQueueSnapshot, onExecQueueChange } from './entertainment'
import { Ipc, type ExecQueueSnapshot, type QueueWidgetConfig, type QueueWidgetState } from '@shared/types'

let win: BrowserWindow | null = null
let config: QueueWidgetConfig = normalizeConfig(readJson<Partial<QueueWidgetConfig>>('queue-widget', {}))

function normalizeConfig(value?: Partial<QueueWidgetConfig>): QueueWidgetConfig {
  const num = (item: unknown, fallback: number, min: number, max: number) => {
    const n = Number(item)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback
  }
  return {
    skin: normalizeWidgetSkin(value?.skin),
    title: String(value?.title ?? '整蛊排队').trim() || '整蛊排队',
    maxRows: num(value?.maxRows, 8, 1, 100),
    showSender: value?.showSender !== false,
    showAction: value?.showAction !== false,
    background: value?.background === 'transparent' ? 'transparent' : 'green',
    width: num(value?.width, 420, 200, 3840),
    height: num(value?.height, 520, 160, 2160)
  }
}

function mediaSrc(value: string): string {
  const source = String(value || '').trim()
  if (!source || /^(?:https?|data|file):/i.test(source)) return source
  return 'file:///' + source.replace(/\\/g, '/')
}

const page = (cfg: QueueWidgetConfig) => `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { background: ${cfg.background === 'green' ? '#00FF00' : 'transparent'}; font-family: "Microsoft YaHei", Arial, sans-serif; user-select: none; }
.box { position: absolute; left: 16px; top: 16px; right: 16px; bottom: 16px;
  background: linear-gradient(135deg, rgba(20,24,60,.92), rgba(60,30,90,.88)); border: 3px solid #FFD700; border-radius: 16px;
  padding: 12px 14px; color: #fff; box-shadow: 0 8px 28px rgba(0,0,0,.4), inset 0 0 18px rgba(255,255,255,.08); display: flex; flex-direction: column; overflow: hidden; }
.title { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px dashed rgba(255,215,0,.4); padding: 2px 0 8px; margin-bottom: 8px; }
.title b { font-size: 20px; font-weight: 900; color: #FFD700; letter-spacing: 2px; text-shadow: 0 2px 6px rgba(0,0,0,.5); }
.title span { font-size: 13px; color: rgba(255,255,255,.75); }
.now { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; margin-bottom: 8px;
  background: rgba(255,215,0,.18); border: 1px solid rgba(255,215,0,.65); box-shadow: 0 0 14px rgba(255,215,0,.35); animation: glow 1.2s ease-in-out infinite alternate; }
.now.idle { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.15); box-shadow: none; animation: none; color: rgba(255,255,255,.55); }
@keyframes glow { from { box-shadow: 0 0 8px rgba(255,215,0,.25); } to { box-shadow: 0 0 20px rgba(255,215,0,.6); } }
.tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #FFD700; color: #3a2a00; font-weight: 700; flex: none; }
.now.idle .tag { background: rgba(255,255,255,.2); color: #fff; }
.list { flex: 1; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
.row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 10px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15); animation: slide .25s ease-out; }
@keyframes slide { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
.idx { width: 20px; text-align: right; font-size: 13px; color: rgba(255,255,255,.6); flex: none; }
img { width: 36px; height: 36px; object-fit: contain; flex: none; }
.now img { width: 44px; height: 44px; }
.main { flex: 1; min-width: 0; }
.gift { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.now .gift { font-size: 17px; color: #FFD700; }
.sub { font-size: 12px; color: rgba(255,255,255,.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.more { text-align: center; font-size: 12px; color: rgba(255,255,255,.7); padding-top: 4px; }
.empty { text-align: center; font-size: 13px; color: rgba(255,255,255,.55); padding: 18px 0; }
${WIDGET_SKIN_CSS}

body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-title,.vote-title,.title b,.now .gift,.milestone.reached .milestone-label,.row-num .hit,.vote-row.done .row-name,.vote-row.done .row-num) {color:var(--ws-accent);text-shadow:none;letter-spacing:.5px}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-score,.milestone,.row-num,.row-name) {color:var(--ws-text);text-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-header,.vote-title,.title) {border-bottom:1px solid var(--ws-line)}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.bar-fill,.row-fill,.milestone.reached .milestone-dot) {background:var(--ws-accent);box-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.bar-section,.row-bar,.vote-row,.now,.row) {background:var(--ws-surface);border:1px solid var(--ws-line);box-shadow:none;animation:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.title span,.sub,.idx,.more,.empty,.now.idle) {color:var(--ws-muted)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .tag {background:var(--ws-accent);color:var(--ws-bg)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .bar-text {color:var(--ws-text);mix-blend-mode:normal}
</style></head>
<body data-widget-skin="${normalizeWidgetSkin(cfg.skin)}">
<div class="box skin-panel">
  <div class="title"><b id="title"></b><span id="count"></span></div>
  <div id="now" class="now idle"></div>
  <div class="list" id="list"></div>
  <div class="more" id="more"></div>
</div>
<script>
  var CFG = ${JSON.stringify(cfg)};
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function img(src) { return src ? '<img src="' + esc(src) + '" onerror="this.style.visibility=\\'hidden\\'">' : '<img style="visibility:hidden">'; }
  function line(item) {
    var parts = [];
    if (CFG.showSender && item.sender) parts.push(esc(item.sender));
    if (CFG.showAction && item.action) parts.push(esc(item.action));
    return parts.join(' · ');
  }
  window.__update = function (snap) {
    document.getElementById('title').textContent = CFG.title;
    var pending = snap.pending || [];
    var total = (typeof snap.total === 'number') ? snap.total : pending.length;
    document.getElementById('count').textContent = total ? ('排队 ' + total + ' 条') : '';
    var now = document.getElementById('now');
    if (snap.running) {
      now.className = 'now';
      now.innerHTML = '<span class="tag">执行中</span>' + img(snap.running.image) +
        '<div class="main"><div class="gift">' + esc(snap.running.gift) + '</div><div class="sub">' + line(snap.running) + '</div></div>';
    } else {
      now.className = 'now idle';
      now.innerHTML = '<span class="tag">空闲</span><div class="main"><div class="gift">等待礼物中…</div></div>';
    }
    var list = document.getElementById('list');
    var shown = pending.slice(0, CFG.maxRows);
    // 按 id 复用已有行：出队节拍只有 100 多毫秒，整块重建会让入场动画一直从透明重播，看起来像没内容
    var keep = {};
    for (var i = 0; i < shown.length; i++) keep[shown[i].id] = true;
    var old = list.querySelectorAll('.row, .empty');
    for (var j = 0; j < old.length; j++) {
      var node = old[j];
      if (node.className === 'empty' || !keep[node.getAttribute('data-id')]) node.remove();
    }
    for (var k = 0; k < shown.length; k++) {
      var it = shown[k];
      var d = list.querySelector('.row[data-id="' + it.id + '"]');
      if (!d) {
        d = document.createElement('div');
        d.className = 'row';
        d.setAttribute('data-id', it.id);
        d.innerHTML = '<span class="idx"></span>' + img(it.image) +
          '<div class="main"><div class="gift">' + esc(it.gift) + '</div><div class="sub">' + line(it) + '</div></div>';
      }
      d.querySelector('.idx').textContent = String(k + 1);
      // 保证顺序：第 k 行应当是 list 的第 k 个子节点
      if (list.children[k] !== d) list.insertBefore(d, list.children[k] || null);
    }
    document.getElementById('more').textContent = total > shown.length ? ('还有 ' + (total - shown.length) + ' 条排在后面') : '';
    if (!pending.length && !snap.running && !list.querySelector('.empty')) {
      var e = document.createElement('div'); e.className = 'empty'; e.textContent = '暂无排队'; list.appendChild(e);
    }
  };
  window.__config = function (next) { for (var k in next) CFG[k] = next[k]; document.body.dataset.widgetSkin=CFG.skin||'classic'; };
</script>
</body></html>`

function push(snapshot: ExecQueueSnapshot): void {
  if (win && !win.isDestroyed()) {
    const safe = {
      running: snapshot.running ? { ...snapshot.running, image: mediaSrc(snapshot.running.image) } : null,
      pending: snapshot.pending.slice(0, config.maxRows + 1).map((item) => ({ ...item, image: mediaSrc(item.image) })).concat(
        // 只把前 maxRows+1 条带图传过去，后面的只要个数
        snapshot.pending.slice(config.maxRows + 1).map((item) => ({ ...item, image: '' }))
      )
    }
    win.webContents.executeJavaScript(`window.__update && window.__update(${JSON.stringify(safe)})`).catch(() => {})
  }
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed() && target !== win) target.webContents.send(Ipc.QueueChanged, snapshot)
  }
}

// 模块加载即订阅：窗口没开时也把队列变化推给主界面（规则页实时显示排队条数）
onExecQueueChange(push)

// ★所有开过的排队窗口都登记在这里。
//   2026-09-07 事故：切换「绿幕/透明」时走的是「关旧窗 → 开新窗」，而旧窗的 closed 回调
//   晚一步才触发，那时 win 已经指向新窗口，回调把【新窗口】的引用清成了 null。
//   于是屏幕上留着一个 win 指不到的孤儿窗口，点「关闭排队窗口」什么都关不掉，只能重启客户端。
//   有了这张表，即使引用错乱也能把窗口全部关掉。
const opened = new Set<BrowserWindow>()

export function openQueueWindow(value?: Partial<QueueWidgetConfig>): { ok: boolean; error?: string } {
  try {
    if (value) configureQueueWidget(value, false)
    if (win) {
      try { win.close() } catch { /* ignore */ }
      win = null
    }
    const tmp = path.join(app.getPath('userData'), 'queue-widget.html')
    fs.writeFileSync(tmp, page(config))
    win = createCaptureOutputWindow({
      title: '排队',
      width: config.width,
      height: config.height,
      frame: false,
      transparent: config.background === 'transparent',
      backgroundColor: config.background === 'transparent' ? undefined : '#00FF00',
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '排队')
    win.loadFile(tmp)
    registerOutputWindow(win)
    opened.add(win)
    const self = win
    // ★只在「当前引用还是我自己」时才清空：关旧窗时它的 closed 会晚一步到，
    //   那时 win 可能已经是新窗口了，无条件 win = null 会把新窗口弄丢
    onOutputWindowClosed(win, () => {
      opened.delete(self)
      if (win === self) win = null
    })
    onceOutputPageEvent(win, 'did-finish-load', () => push(execQueueSnapshot()))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开排队窗口失败：' + (e as Error).message }
  }
}

export function closeQueueWindow(): { ok: boolean } {
  // 不只关 win 指着的那一个：把登记过的排队窗口全关掉，孤儿窗口也能清掉
  for (const w of [...opened, win]) {
    if (!w || w.isDestroyed()) continue
    try { w.close() } catch { /* 已经没了 */ }
  }
  opened.clear()
  win = null
  return { ok: true }
}

export function queueWidgetState(): QueueWidgetState {
  const live = [...opened, win].some((w) => w && !w.isDestroyed())
  return { open: live, config: { ...config }, snapshot: execQueueSnapshot() }
}

export function configureQueueWidget(value: Partial<QueueWidgetConfig>, reopen = true): { ok: boolean } {
  const previous = config
  config = normalizeConfig({ ...config, ...value })
  writeJson('queue-widget', config)
  if (win && !win.isDestroyed()) {
    if (previous.background !== config.background && reopen) {
      openQueueWindow()
    } else {
      if (previous.width !== config.width || previous.height !== config.height) win.setSize(config.width, config.height)
      win.webContents.executeJavaScript(`window.__config && window.__config(${JSON.stringify(config)})`).catch(() => {})
      push(execQueueSnapshot())
    }
  }
  return { ok: true }
}

app.on('before-quit', () => {
  closeQueueWindow()
})
