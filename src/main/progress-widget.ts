import { WIDGET_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
import { captureTitle } from './capture-output'
import { outputsAlwaysOnTop, registerOutputWindow, createCaptureOutputWindow, onOutputWindowClosed, onceOutputPageEvent } from './output-window'
// 礼物积分进度条：主进程常驻计分 + 绿幕挂件窗口。
// 美术 1:1 复刻参考软件 H5（extracted_h5/10_礼物积分进度条.html）：
//   绿幕 #00FF00 + 深紫渐变金边面板(420px, 3px #FFD700 边, 圆角16) + 金色标题(20px 900 字重, 虚线分隔)
//   + 36px 胶囊进度条(金渐变填充, 中央白字) + 里程碑圆点(达成变金发光) + 可拖动。
// 计分规则（每个礼物几分 / 按钻石价 / 积分表）、里程碑达成动作（音效/脚本）全在这里执行，
// 页面只是编辑器，切走照样累计——老实现页面和主进程各加一次分，窗口开着时一份礼物记两次。
import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { readJson, writeJson } from './db'
import { giftNamesEqual } from '../shared/giftName'
import { findGiftImage, runScript } from './entertainment'
import { Ipc, type ConnectorEvent, type ProgressConfig, type ProgressState } from '@shared/types'

let win: BrowserWindow | null = null
let config: ProgressConfig = normalizeConfig(readJson<Partial<ProgressConfig>>('progress', {}))
let score = 0
let reached: number[] = []
{
  const saved = readJson<{ score?: number; reached?: number[] }>('progress-score', {})
  score = Math.max(0, Number(saved.score) || 0)
  reached = Array.isArray(saved.reached) ? saved.reached.map(Number).filter(Number.isFinite) : []
}
let resetTimer: ReturnType<typeof setTimeout> | null = null

function normalizeConfig(value?: Partial<ProgressConfig>): ProgressConfig {
  return {
    skin: normalizeWidgetSkin(value?.skin),
    title: String(value?.title ?? '礼物积分').trim() || '礼物积分',
    target: Math.max(1, Math.trunc(Number(value?.target) || 100)),
    autoAdd: value?.autoAdd !== false,
    scoreMode: value?.scoreMode === 'diamond' || value?.scoreMode === 'table' ? value.scoreMode : 'count',
    defaultScore: Math.max(0, Number(value?.defaultScore ?? 1) || 0),
    giftScores: Array.isArray(value?.giftScores)
      ? value.giftScores.map((item) => ({ gift: String(item?.gift ?? '').trim(), score: Math.max(0, Number(item?.score) || 0) })).filter((item) => item.gift)
      : [],
    milestones: Array.isArray(value?.milestones)
      ? value.milestones.map((item) => ({
        score: Math.max(0, Number(item?.score) || 0),
        note: String(item?.note ?? ''),
        sound: String(item?.sound ?? '').trim() || undefined,
        script: String(item?.script ?? '').trim() || undefined
      }))
      : [],
    resetOnTarget: value?.resetOnTarget === true
  }
}

const esc = (s: string) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const page = (cfg: ProgressConfig) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #00FF00; font-family: 'Microsoft YaHei', Arial, sans-serif; overflow: hidden;
  width: 100vw; height: 100vh; user-select: none; }
.progress-box { position: absolute; left: 24px; top: 24px; width: 420px;
  background: linear-gradient(135deg, rgba(20,24,60,0.92), rgba(60,30,90,0.88));
  border: 3px solid #FFD700; border-radius: 16px; padding: 14px 16px; color: #fff;
  overflow: hidden; cursor: grab;
  box-shadow: 0 8px 28px rgba(0,0,0,0.4), inset 0 0 18px rgba(255,255,255,0.08); }
.progress-box.dragging { opacity: 0.9; box-shadow: 0 0 28px #FFD700; cursor: grabbing; }
.progress-box.full { animation: full 0.8s ease-in-out 3; }
@keyframes full { 0%, 100% { box-shadow: 0 8px 28px rgba(0,0,0,0.4); } 50% { box-shadow: 0 0 36px #FFD700; } }
.progress-header { display: flex; align-items: center; justify-content: space-between;
  border-bottom: 2px dashed rgba(255,215,0,0.4); margin-bottom: 12px; padding: 4px 0 10px 0; }
.progress-title { font-size: 20px; font-weight: 900; color: #FFD700; letter-spacing: 2px;
  text-shadow: 0 2px 6px rgba(0,0,0,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.progress-score { font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; margin-left: 8px; }
.bar-section { position: relative; width: 100%; height: 36px; border-radius: 999px;
  background: rgba(0,0,0,0.4); border: 2px solid rgba(255,255,255,0.2); overflow: visible; }
.bar-fill { height: 100%; border-radius: 999px; transition: width 0.4s ease; min-width: 0;
  background: linear-gradient(90deg, #FFD700, #FF9800); }
.bar-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 16px; font-weight: 900; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.7);
  white-space: nowrap; z-index: 2; pointer-events: none; }
.milestones { position: relative; width: 100%; margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
.milestone { display: flex; align-items: center; gap: 7px; font-size: 14px; color: #fff; }
.milestone-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
  background: rgba(255,255,255,0.4); border: 2px solid rgba(255,215,0,0.6); transition: all 0.3s; }
.milestone.reached .milestone-dot { background: #FFD700; border-color: #fff; box-shadow: 0 0 8px #FFD700; }
.milestone.reached .milestone-label { color: #FFD700; font-weight: 700; }
${WIDGET_SKIN_CSS}

body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-title,.vote-title,.title b,.now .gift,.milestone.reached .milestone-label,.row-num .hit,.vote-row.done .row-name,.vote-row.done .row-num) {color:var(--ws-accent);text-shadow:none;letter-spacing:.5px}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-score,.milestone,.row-num,.row-name) {color:var(--ws-text);text-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.progress-header,.vote-title,.title) {border-bottom:1px solid var(--ws-line)}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.bar-fill,.row-fill,.milestone.reached .milestone-dot) {background:var(--ws-accent);box-shadow:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.bar-section,.row-bar,.vote-row,.now,.row) {background:var(--ws-surface);border:1px solid var(--ws-line);box-shadow:none;animation:none}
body[data-widget-skin]:not([data-widget-skin="classic"]) :is(.title span,.sub,.idx,.more,.empty,.now.idle) {color:var(--ws-muted)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .tag {background:var(--ws-accent);color:var(--ws-bg)}
body[data-widget-skin]:not([data-widget-skin="classic"]) .bar-text {color:var(--ws-text);mix-blend-mode:normal}
body[data-widget-skin="glacier"] .bar-text {background:var(--ws-bg);padding:1px 6px;border-radius:4px;text-shadow:none}
</style>
</head>
<body data-widget-skin="${normalizeWidgetSkin(cfg.skin)}">
<div class="progress-box skin-panel" id="box">
  <div class="progress-header">
    <div class="progress-title" id="title">${esc(cfg.title)}</div>
    <div class="progress-score"><span id="score">0</span> / <span id="target">100</span></div>
  </div>
  <div class="bar-section">
    <div class="bar-fill" id="fill" style="width:0%"></div>
    <div class="bar-text" id="pct">0%</div>
  </div>
  <div class="milestones" id="ms"></div>
</div>
<script>
  var SCORE = 0, TARGET = ${cfg.target}, MILESTONES = [], TITLE = ${JSON.stringify(cfg.title)};
  var wasFull = false;
  function render() {
    document.getElementById('title').textContent = TITLE;
    document.getElementById('score').textContent = SCORE;
    document.getElementById('target').textContent = TARGET;
    var pct = Math.min(100, (SCORE / TARGET) * 100);
    document.getElementById('fill').style.width = pct + '%';
    document.getElementById('pct').textContent = Math.floor(pct) + '%';
    var box = document.getElementById('box');
    if (pct >= 100 && !wasFull) { box.classList.remove('full'); void box.offsetWidth; box.classList.add('full'); }
    wasFull = pct >= 100;
    var ms = document.getElementById('ms');
    ms.innerHTML = '';
    MILESTONES.forEach(function (m) {
      var div = document.createElement('div');
      div.className = 'milestone' + (SCORE >= m.score ? ' reached' : '');
      div.innerHTML = '<span class="milestone-dot"></span><span class="milestone-label">' +
        m.score + ' · ' + String(m.note || '').replace(/</g, '&lt;') + '</span>';
      ms.appendChild(div);
    });
  }
  render();
  window.__update = function (score, target, milestones, title, skin) {
    if(skin)document.body.dataset.widgetSkin=skin;
    SCORE = Number(score) || 0;
    if (target != null) TARGET = Math.max(1, Number(target) || TARGET);
    if (Array.isArray(milestones)) MILESTONES = milestones;
    if (title != null) TITLE = title;
    render();
  };

  // 拖动
  var box = document.getElementById('box');
  var dragging = false, ox = 0, oy = 0;
  box.addEventListener('mousedown', function (e) {
    dragging = true; ox = e.screenX - window.screenX; oy = e.screenY - window.screenY;
    box.classList.add('dragging'); e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    try { window.moveTo(e.screenX - ox, e.screenY - oy); } catch (err) {}
  });
  document.addEventListener('mouseup', function () { dragging = false; box.classList.remove('dragging'); });
</script>
</body></html>`

// 落盘防抖：每个礼物事件都 fsync 一次会把主线程拖住（热门房每秒几十事件），800ms 内合并成一次；退出前冲刷
let persistScoreTimer: ReturnType<typeof setTimeout> | null = null
function persistScore(): void {
  if (persistScoreTimer) return
  persistScoreTimer = setTimeout(() => {
    persistScoreTimer = null
    persistScoreNow()
  }, 800)
}
app.on('before-quit', () => {
  if (persistScoreTimer) {
    clearTimeout(persistScoreTimer)
    persistScoreTimer = null
    persistScoreNow()
  }
})
function persistScoreNow(): void {
  writeJson('progress-score', { score, reached })
}

function push(): void {
  if (win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(
      `window.__update && window.__update(${score}, ${config.target}, ${JSON.stringify(config.milestones.map((m) => ({ score: m.score, note: m.note })))}, ${JSON.stringify(config.title)}, ${JSON.stringify(config.skin)})`
    ).catch(() => {})
  }
  const state = progressState()
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed() && target !== win) target.webContents.send(Ipc.ProgressChanged, state)
  }
}

function playSound(soundPath: string): void {
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed() && target !== win) target.webContents.send(Ipc.EntertainmentSound, { path: soundPath, mode: 'sync' })
  }
}

// 越过里程碑就触发一次动作（清零前不重复）；到目标且开了自动清零，亮 2.5 秒满条再归零
function afterScoreChange(): void {
  for (const milestone of config.milestones) {
    if (milestone.score <= 0 || score < milestone.score || reached.includes(milestone.score)) continue
    reached.push(milestone.score)
    if (milestone.sound) playSound(milestone.sound)
    if (milestone.script) runScript(milestone.script)
  }
  persistScore()
  push()
  if (config.resetOnTarget && score >= config.target && !resetTimer) {
    resetTimer = setTimeout(() => {
      resetTimer = null
      progressReset()
    }, 2500)
  }
}

export function openProgressWindow(): { ok: boolean; error?: string } {
  try {
    if (win) {
      try { win.close() } catch { /* ignore */ }
      win = null
    }
    const tmp = path.join(app.getPath('userData'), 'progress-widget.html')
    fs.writeFileSync(tmp, page(config))
    win = createCaptureOutputWindow({
      title: '积分条',
      width: 500,
      height: 320,
      frame: false,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: true,
      skipTaskbar: true,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '积分条')
    win.loadFile(tmp)
    registerOutputWindow(win)
    onOutputWindowClosed(win, () => { win = null })
    onceOutputPageEvent(win, 'did-finish-load', () => push())
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开积分条窗口失败：' + (e as Error).message }
  }
}

export function closeProgressWindow(): { ok: boolean } {
  try { win?.close() } catch { /* ignore */ }
  win = null
  return { ok: true }
}

export function progressState(): ProgressState {
  return {
    open: !!win && !win.isDestroyed(),
    config: { ...config, giftScores: config.giftScores.map((g) => ({ ...g })), milestones: config.milestones.map((m) => ({ ...m })) },
    score,
    reached: [...reached]
  }
}

export function configureProgress(value: Partial<ProgressConfig>): { ok: boolean } {
  config = normalizeConfig({ ...config, ...value })
  writeJson('progress', config)
  push()
  return { ok: true }
}

export function progressAdjust(delta: number): { ok: boolean; score: number } {
  score = Math.max(0, score + (Math.trunc(Number(delta)) || 0))
  afterScoreChange()
  return { ok: true, score }
}

export function progressReset(): { ok: boolean } {
  if (resetTimer) {
    clearTimeout(resetTimer)
    resetTimer = null
  }
  score = 0
  reached = []
  persistScore()
  push()
  return { ok: true }
}

function giftPrice(name: string, known?: number): number {
  if (known != null && Number.isFinite(known) && known > 0) return known
  return findGiftImage(name)?.diamondCount ?? 0
}

// 每个礼物值几分
function scoreOf(event: ConnectorEvent): number {
  const name = String(event.giftName || '')
  if (config.scoreMode === 'diamond') return giftPrice(name, event.diamondCount)
  if (config.scoreMode === 'table') {
    const row = config.giftScores.find((item) => giftNamesEqual(item.gift, name))
    return row ? row.score : config.defaultScore
  }
  return 1
}

// 礼物事件由主进程常驻运行时调用；数量按真实连击数累加（用户铁律：不设上限）
export function handleProgressGift(event: ConnectorEvent): void {
  if (event.type !== 'gift' || !event.giftName || !config.autoAdd) return
  const amount = Math.max(1, Math.trunc(Number(event.count) || 1)) * scoreOf(event)
  if (amount <= 0) return
  score += amount
  afterScoreChange()
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
  if (resetTimer) clearTimeout(resetTimer)
})
