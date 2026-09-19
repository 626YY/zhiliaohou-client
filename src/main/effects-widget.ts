import { captureTitle, mediaUrl, scriptJson } from './capture-output'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed } from './output-window'
// 礼物动画挂件窗口：一个绿幕/透明窗口跑 5 种特效，用真实礼物图。
//   抛物线飞入（复刻参考 H5 extracted_h5/22）：礼物图从底角抛物线飞到中央 → 爆裂 8 碎片 → 中央大图展示
//   礼物炸弹：从天而降砸到中央，白光一闪炸成一堆碎片飞散（碎片数随礼物个数涨）
//   礼物小车：小车载着礼物从右往左横穿（多个礼物叠成一摞 + ×N 角标）
//   烟花绽放：礼物当烟花弹升空，到顶炸出彩色粒子，礼物图放大定格
//   天上掉礼物：按礼物个数一片一片往下落，左右摇摆带旋转
// 礼物→特效的映射和自动播放开关由主进程常驻持有，页面切走照样播；数量不设上限，只有一个可调的单次出图上限防卡。
import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { GIFT_ICON_URLS } from '../shared/giftIcons'
import { giftNamesEqual } from '../shared/giftName'
import { findGiftImage } from './entertainment'
import { readJson, writeJson } from './db'
import type { ConnectorEvent, EffectKind, EffectsConfig } from '@shared/types'

// 注意顺序：模块顶层的 config 初始化会调用 normalizeConfig，它引用 EFFECT_KINDS，
// const 必须写在前面，否则主进程加载即抛 TDZ（typecheck 查不出来，只有真开才炸）。
export const EFFECT_KINDS: EffectKind[] = ['parabola', 'bomb', 'car', 'firework', 'rain']

let win: BrowserWindow | null = null
let ready: Promise<void> = Promise.resolve()
let config: EffectsConfig = normalizeConfig(readJson<Partial<EffectsConfig>>('effects-widget', {}))

function normalizeConfig(value?: Partial<EffectsConfig>): EffectsConfig {
  const kind = (item: unknown): EffectKind | 'none' =>
    item === 'none' || EFFECT_KINDS.includes(item as EffectKind) ? (item as EffectKind | 'none') : 'parabola'
  const clampNumber = (item: unknown, fallback: number, min: number, max: number) => {
    const n = Number(item)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  return {
    autoPlay: value?.autoPlay !== false,
    defaultEffect: kind(value?.defaultEffect),
    rules: Array.isArray(value?.rules)
      ? value.rules
        .map((rule) => ({ gift: String(rule?.gift ?? '').trim(), effect: kind(rule?.effect) as EffectKind }))
        .filter((rule) => rule.gift && rule.effect !== ('none' as EffectKind))
      : [],
    minDiamond: Math.max(0, Math.trunc(clampNumber(value?.minDiamond, 0, 0, 10_000_000))),
    // 图片尺寸/数量上限只做防爆夹紧，不是功能上限
    imageSize: Math.trunc(clampNumber(value?.imageSize, 60, 16, 400)),
    countCap: Math.trunc(clampNumber(value?.countCap, 30, 1, 500)),
    speed: clampNumber(value?.speed, 1, 0.25, 4),
    showText: value?.showText !== false,
    background: value?.background === 'transparent' ? 'transparent' : 'green',
    width: Math.trunc(clampNumber(value?.width, 540, 200, 3840)),
    height: Math.trunc(clampNumber(value?.height, 800, 200, 2160)),
    comboSeconds: clampNumber(value?.comboSeconds, 5, 0, 600)
  }
}

function pageConfig(cfg: EffectsConfig) {
  return { imageSize: cfg.imageSize, countCap: cfg.countCap, speed: cfg.speed, showText: cfg.showText, comboSeconds: cfg.comboSeconds, background: cfg.background }
}

const page = (cfg: EffectsConfig) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
body { background: ${cfg.background === 'green' ? '#00FF00' : 'transparent'}; position: relative; }
.gift { position: absolute; left: 0; top: 0; will-change: transform, opacity; pointer-events: none; }
.gift img { display: block; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 4px 6px rgba(0,0,0,.35)); }
.frag { position: absolute; left: 0; top: 0; will-change: transform, opacity; pointer-events: none; }
.frag img { display: block; width: 100%; height: 100%; object-fit: contain; }
.flash { position: absolute; left: 0; top: 0; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,220,120,.6) 40%, rgba(255,120,60,0) 70%); }
.spark { position: absolute; left: 0; top: 0; width: 6px; height: 6px; border-radius: 50%; pointer-events: none; }
.final { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(.2); opacity: 0; pointer-events: none;
  filter: drop-shadow(0 0 18px rgba(255,255,255,.75)); }
.final img { display: block; width: 100%; height: 100%; object-fit: contain; }
.car { position: absolute; bottom: 10%; width: 150px; height: 80px; pointer-events: none; will-change: transform; }
.car .body { position: absolute; left: 0; bottom: 16px; width: 150px; height: 36px; background: #e6a23c; border-radius: 12px 16px 6px 6px;
  box-shadow: inset 0 -7px 0 rgba(0,0,0,.18); }
.car .cab { position: absolute; left: 96px; bottom: 50px; width: 46px; height: 26px; background: #f7cf6a; border-radius: 8px 12px 0 0; }
.car .cab:after { content: ''; position: absolute; left: 8px; top: 5px; width: 26px; height: 14px; background: #bde3ff; border-radius: 4px; }
.car .wheel { position: absolute; bottom: 0; width: 30px; height: 30px; border-radius: 50%; background: #1d1d1d;
  border: 7px solid #9a9a9a; box-sizing: border-box; animation: wheel .35s linear infinite; }
.car .wheel:before { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 100%; margin-left: -2px; margin-top: -50%; background: #666; }
.car .load { position: absolute; left: 10px; bottom: 44px; width: 80px; height: 60px; }
.car .load img { position: absolute; left: 0; bottom: 0; object-fit: contain; filter: drop-shadow(0 3px 4px rgba(0,0,0,.35)); }
.car .badge { position: absolute; left: 70px; bottom: 90px; background: #ff3b30; color: #fff; font: bold 16px "Microsoft YaHei", sans-serif;
  padding: 2px 8px; border-radius: 12px; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
@keyframes wheel { to { transform: rotate(-360deg); } }
#text { position: absolute; left: 50%; bottom: 4%; transform: translateX(-50%); z-index: 50; pointer-events: none;
  font: bold 26px "Microsoft YaHei", sans-serif; color: #fff; white-space: nowrap; opacity: 0; transition: opacity .3s ease;
  background: rgba(0,0,0,.45); border-radius: 12px; padding: 6px 20px;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; }
#text b { color: #ffd54a; }
/* 连击角标：同一个人连送同一礼物，右上角叠出 ×N，越叠越大、抖一下 */
#combo { position: absolute; right: 6%; top: 8%; z-index: 60; pointer-events: none; opacity: 0; transform: scale(.6); transition: opacity .2s ease, transform .18s cubic-bezier(.2,1.6,.4,1);
  font: 900 44px "Microsoft YaHei", sans-serif; color: #fff; text-align: center; line-height: 1;
  text-shadow: 0 0 12px #ff8a3d, -2px -2px 0 #7a1f00, 2px -2px 0 #7a1f00, -2px 2px 0 #7a1f00, 2px 2px 0 #7a1f00; }
#combo.on { opacity: 1; }
#combo small { display: block; font-size: 16px; font-weight: 700; margin-top: 4px; color: #ffd54a; text-shadow: 0 0 8px rgba(0,0,0,.8); }
</style>
</head>
<body>
<div id="text"></div>
<div id="combo"></div>
<script>
  var CFG = ${JSON.stringify(pageConfig(cfg))};
  var W = window.innerWidth, H = window.innerHeight;
  window.addEventListener('resize', function () { W = window.innerWidth; H = window.innerHeight; });
  var active = 0, MAX_ACTIVE = 6, queue = [];
  var textTimer = 0;

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { return t * t * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dur(ms) { return ms / (CFG.speed || 1); }

  function mk(cls, src, size) {
    var el = document.createElement('div');
    el.className = cls;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    var im = document.createElement('img');
    im.src = src;
    // 礼物图没下载到/已下架时别让整个动画隐身：换成礼物盒表情顶上
    im.onerror = function () {
      el.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:' + Math.round(size * 0.8) + 'px;line-height:1">&#127873;</div>';
    };
    el.appendChild(im);
    document.body.appendChild(el);
    return el;
  }
  function place(el, x, y, rot, scale, alpha) {
    el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + (rot || 0) + 'deg) scale(' + (scale == null ? 1 : scale) + ')';
    if (alpha != null) el.style.opacity = alpha;
  }
  // 逐帧动画：step(t) 里 t 从 0 到 1，结束后回调
  function anim(ms, step, done) {
    var t0 = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - t0) / ms);
      step(t);
      if (t < 1) requestAnimationFrame(frame); else if (done) done();
    }
    requestAnimationFrame(frame);
  }
  function showText(sender, name, count) {
    if (!CFG.showText) return;
    var el = document.getElementById('text');
    el.innerHTML = '';
    if (sender) { el.appendChild(document.createTextNode(sender + ' 送出 ')); }
    var b = document.createElement('b');
    b.textContent = name + (count > 1 ? ' ×' + count : '');
    el.appendChild(b);
    el.style.opacity = 1;
    clearTimeout(textTimer);
    textTimer = setTimeout(function () { el.style.opacity = 0; }, 2600);
  }

  // ---- 碎片爆裂（抛物线 / 炸弹共用）----
  function burst(x, y, src, n, size, power, done) {
    var frags = [];
    for (var i = 0; i < n; i++) {
      var f = mk('frag', src, size);
      var a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
      frags.push({ el: f, vx: Math.cos(a) * rnd(power * 0.6, power), vy: Math.sin(a) * rnd(power * 0.6, power) - power * 0.4, rot: rnd(-720, 720) });
    }
    anim(dur(900), function (t) {
      for (var i = 0; i < frags.length; i++) {
        var p = frags[i];
        var px = x + p.vx * t;
        var py = y + p.vy * t + 900 * t * t; // 重力
        place(p.el, px, py, p.rot * t, 1 - t * 0.5, 1 - easeIn(t));
      }
    }, function () {
      for (var i = 0; i < frags.length; i++) frags[i].el.remove();
      if (done) done();
    });
  }
  function flash(x, y, r) {
    var el = document.createElement('div');
    el.className = 'flash';
    el.style.width = el.style.height = (r * 2) + 'px';
    document.body.appendChild(el);
    anim(dur(420), function (t) {
      var s = 0.2 + t * 1.2;
      el.style.transform = 'translate(' + (x - r) + 'px,' + (y - r) + 'px) scale(' + s + ')';
      el.style.opacity = 1 - t;
    }, function () { el.remove(); });
  }
  function finalShow(src, done) {
    var size = CFG.imageSize * 3;
    var el = mk('final', src, size);
    anim(dur(320), function (t) {
      var s = 0.2 + easeOut(t) * 0.8;
      el.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
      el.style.opacity = t;
    }, function () {
      setTimeout(function () {
        anim(dur(360), function (t) { el.style.opacity = 1 - t; }, function () { el.remove(); if (done) done(); });
      }, dur(900));
    });
  }

  // ---- 1. 抛物线飞入 ----
  function parabola(src, count, done) {
    var size = CFG.imageSize;
    var el = mk('gift', src, size);
    var fromLeft = Math.random() < 0.5;
    var x0 = fromLeft ? -size : W + size, y0 = H - size * 1.4;
    var cx = W / 2 - size / 2, cy = H / 2 - size / 2;
    var apex = H * 0.15 + rnd(0, H * 0.12);
    anim(dur(1100), function (t) {
      var x = x0 + (cx - x0) * t;
      var y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * apex + t * t * cy;
      place(el, x, y, t * 720, 1, 1);
    }, function () {
      el.remove();
      burst(cx, cy, src, Math.min(8 + Math.max(0, count - 1) * 2, 40), size, 260, null);
      finalShow(src, done);
    });
  }

  // ---- 2. 礼物炸弹 ----
  function bomb(src, count, done) {
    var size = CFG.imageSize * 1.3;
    var el = mk('gift', src, size);
    var x = W / 2 - size / 2, y0 = -size, y1 = H / 2 - size / 2;
    anim(dur(750), function (t) {
      var yy = y0 + (y1 - y0) * easeIn(t);
      place(el, x + Math.sin(t * 30) * 4, yy, Math.sin(t * 12) * 10, 1 + t * 0.2, 1);
    }, function () {
      el.remove();
      flash(W / 2, H / 2, Math.max(120, size * 2));
      var n = Math.min(12 + Math.max(0, count - 1) * 3, Math.max(12, CFG.countCap * 2));
      burst(W / 2 - size / 2, H / 2 - size / 2, src, n, CFG.imageSize, 420, done);
    });
  }

  // ---- 3. 礼物小车 ----
  function car(src, count, done) {
    var el = document.createElement('div');
    el.className = 'car';
    el.innerHTML = '<div class="body"></div><div class="cab"></div><div class="wheel" style="left:18px"></div><div class="wheel" style="left:104px"></div><div class="load"></div>';
    var load = el.querySelector('.load');
    var stack = Math.min(5, Math.max(1, count));
    var size = Math.min(CFG.imageSize, 60);
    for (var i = 0; i < stack; i++) {
      var im = document.createElement('img');
      im.src = src;
      im.style.width = im.style.height = size + 'px';
      im.style.left = (i * 8) + 'px';
      im.style.bottom = (i * 9) + 'px';
      im.style.zIndex = i;
      im.onerror = function () { this.style.visibility = 'hidden'; };
      load.appendChild(im);
    }
    if (count > 1) {
      var badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = '×' + count;
      el.appendChild(badge);
    }
    document.body.appendChild(el);
    var x0 = W + 170, x1 = -190;
    anim(dur(3400), function (t) {
      var x = x0 + (x1 - x0) * t;
      el.style.transform = 'translate(' + x + 'px,' + (Math.sin(t * 40) * 2) + 'px)';
    }, function () { el.remove(); if (done) done(); });
  }

  // ---- 4. 烟花绽放 ----
  function firework(src, count, done) {
    var size = CFG.imageSize * 0.6;
    var el = mk('gift', src, size);
    var x = rnd(W * 0.3, W * 0.7) - size / 2;
    var y0 = H + size, y1 = rnd(H * 0.22, H * 0.38);
    var trail = [];
    anim(dur(900), function (t) {
      var yy = y0 + (y1 - y0) * easeOut(t);
      place(el, x, yy, 0, 1, 1);
      if (Math.random() < 0.6) {
        var s = document.createElement('div');
        s.className = 'spark';
        s.style.background = '#ffd54a';
        s.style.transform = 'translate(' + (x + size / 2 + rnd(-4, 4)) + 'px,' + (yy + size) + 'px)';
        document.body.appendChild(s);
        trail.push(s);
        setTimeout((function (node) { return function () { node.remove(); }; })(s), 350);
      }
    }, function () {
      el.remove();
      var cx = x + size / 2, cy = y1 + size / 2;
      var colors = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#ff4dd2', '#ffffff'];
      var sparks = [];
      var n = 42 + Math.min(count, 20) * 2;
      for (var i = 0; i < n; i++) {
        var s = document.createElement('div');
        s.className = 'spark';
        s.style.background = colors[i % colors.length];
        s.style.boxShadow = '0 0 8px ' + colors[i % colors.length];
        document.body.appendChild(s);
        var a = (i / n) * Math.PI * 2 + rnd(-0.1, 0.1);
        var sp = rnd(140, 320);
        sparks.push({ el: s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
      }
      var big = mk('final', src, CFG.imageSize * 2.6);
      big.style.left = cx + 'px';
      big.style.top = cy + 'px';
      anim(dur(1400), function (t) {
        for (var i = 0; i < sparks.length; i++) {
          var p = sparks[i];
          p.el.style.transform = 'translate(' + (cx + p.vx * t) + 'px,' + (cy + p.vy * t + 220 * t * t) + 'px)';
          p.el.style.opacity = 1 - t;
        }
        var s2 = t < 0.3 ? 0.2 + easeOut(t / 0.3) * 0.9 : 1.1;
        big.style.transform = 'translate(-50%, -50%) scale(' + s2 + ')';
        big.style.opacity = t < 0.3 ? t / 0.3 : (t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1);
      }, function () {
        for (var i = 0; i < sparks.length; i++) sparks[i].el.remove();
        big.remove();
        if (done) done();
      });
    });
  }

  // ---- 5. 天上掉礼物 ----
  function rain(src, count, done) {
    var n = Math.min(Math.max(1, count), CFG.countCap);
    var size = CFG.imageSize;
    var left = n;
    for (var i = 0; i < n; i++) {
      (function (idx) {
        setTimeout(function () {
          var el = mk('gift', src, size);
          var x = rnd(0, W - size), sway = rnd(20, 60), rot = rnd(-360, 360), phase = rnd(0, 6);
          anim(dur(rnd(2200, 3200)), function (t) {
            var y = -size + (H + size) * t;
            place(el, x + Math.sin(t * 6 + phase) * sway, y, rot * t, 1, t > 0.85 ? (1 - t) / 0.15 : 1);
          }, function () { el.remove(); if (--left === 0 && done) done(); });
        }, idx * dur(120));
      })(i);
    }
  }

  var RUN = { parabola: parabola, bomb: bomb, car: car, firework: firework, rain: rain };

  // ---- 连击角标 ----
  var combo = { key: '', n: 0, at: 0, timer: 0 };
  function bumpCombo(name, sender, count) {
    if (!(CFG.comboSeconds > 0)) return;
    var key = (sender || '') + '|' + (name || '');
    var now = Date.now();
    if (combo.key === key && now - combo.at <= CFG.comboSeconds * 1000) combo.n += count; else combo.n = count;
    combo.key = key; combo.at = now;
    if (combo.n < 2) return;
    var el = document.getElementById('combo');
    var scale = Math.min(2.2, 1 + Math.log10(combo.n) * 0.6);
    el.innerHTML = '&times;' + combo.n + ' <small>' + (sender ? sender.replace(/</g, '&lt;') + ' ' : '') + '连击</small>';
    el.classList.remove('on'); void el.offsetWidth;
    el.style.transform = 'scale(' + (scale * 1.25) + ') rotate(' + (Math.random() * 10 - 5) + 'deg)';
    el.classList.add('on');
    setTimeout(function () { el.style.transform = 'scale(' + scale + ')'; }, 120);
    clearTimeout(combo.timer);
    combo.timer = setTimeout(function () { el.classList.remove('on'); }, CFG.comboSeconds * 1000);
  }

  window.__fire = function (kind, name, src, count, sender) {
    count = Math.max(1, Math.floor(Number(count) || 1));
    bumpCombo(name, sender, count);
    if (active >= MAX_ACTIVE) { if (queue.length < 60) queue.push([kind, name, src, count, sender]); return; }
    var run = RUN[kind] || parabola;
    active++;
    showText(sender || '', name || '', count);
    run(src, count, function () {
      active--;
      var next = queue.shift();
      if (next) window.__fire.apply(null, next);
    });
  };
  window.__config = function (next) { for (var k in next) CFG[k] = next[k]; document.body.style.background = CFG.background === 'green' ? '#00ff00' : 'transparent'; };
</script>
</body>
</html>`

function resolveImage(name: string, img?: string): string {
  if (img) return mediaUrl(img)
  const local = findGiftImage(name)
  if (local) return mediaUrl(local.path)
  if (GIFT_ICON_URLS[name]) return GIFT_ICON_URLS[name]
  return GIFT_ICON_URLS['小心心'] || ''
}

function giftPrice(name: string, known?: number): number {
  if (known != null && Number.isFinite(known)) return known
  return findGiftImage(name)?.diamondCount ?? 0
}

export function effectsConfig(): EffectsConfig {
  return { ...config, rules: config.rules.map((rule) => ({ ...rule })) }
}

export function openEffectsWindow(value?: Partial<EffectsConfig>): { ok: boolean; error?: string } {
  try {
    if (value) configureEffects(value, false)
    if (win && !win.isDestroyed()) {
      win.showInactive()
      return { ok: true }
    }
    const tmp = path.join(app.getPath('userData'), 'effects-widget.html')
    fs.writeFileSync(tmp, page(config))
    win = createCaptureOutputWindow({
      title: '礼物动画',
      width: config.width,
      height: config.height,
      frame: false,
      transparent: true,
      backgroundColor: config.background === 'transparent' ? undefined : '#00FF00',
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '礼物动画')
    const created = win
    ready = win.loadFile(tmp)
    void ready.catch((error) => console.warn('礼物动画加载失败', error.message))
    registerOutputWindow(win)
    onOutputWindowClosed(win, () => { if (win === created) win = null })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开礼物动画窗口失败：' + (e as Error).message }
  }
}

export function closeEffectsWindow(): { ok: boolean } {
  const closing = win
  win = null
  try { closing?.close() } catch { /* ignore */ }
  return { ok: true }
}

export function effectsState(): { open: boolean; config: EffectsConfig } {
  return { open: !!win && !win.isDestroyed(), config: effectsConfig() }
}

// 配置原位更新，保留直播伴侣正在捕获的窗口。
export function configureEffects(value: Partial<EffectsConfig>, _reopen = true): { ok: boolean } {
  const previous = config
  config = normalizeConfig({ ...config, ...value })
  writeJson('effects-widget', config)
  if (win && !win.isDestroyed()) {
    if (previous.width !== config.width || previous.height !== config.height) win.setSize(config.width, config.height)
    win.setBackgroundColor(config.background === 'green' ? '#00ff00' : '#00000000')
    runWhenReady(`window.__config(${scriptJson(pageConfig(config))})`)
  }
  return { ok: true }
}

export function effectsFire(kind: EffectKind, name: string, count = 1, img?: string, sender = ''): { ok: boolean } {
  try {
    if (!win || win.isDestroyed()) return { ok: false }
    const effect = EFFECT_KINDS.includes(kind) ? kind : 'parabola'
    const src = resolveImage(name, img)
    runWhenReady(
      `window.__fire && window.__fire(${JSON.stringify(effect)}, ${JSON.stringify(String(name || ''))}, ${JSON.stringify(src)}, ${Math.max(1, Math.trunc(count) || 1)}, ${JSON.stringify(String(sender || ''))})`
    )
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// 组合事件需要等待真实加载并在触发前复核取消状态；原普通礼物的异步入口保持不变。
export async function effectsFireChecked(kind: EffectKind, name: string, isCurrent: () => boolean, count = 1, img?: string): Promise<{ ok: boolean; error?: string }> {
  const target = win
  try {
    if (!target || target.isDestroyed()) return { ok: false, error: '礼物动画窗口未开启' }
    if (!EFFECT_KINDS.includes(kind)) return { ok: false, error: '请选择礼物动画' }
    await ready
    if (!isCurrent()) return { ok: false, error: '事件已取消' }
    if (target !== win || target.isDestroyed()) return { ok: false, error: '礼物动画窗口已关闭或替换' }
    const src = resolveImage(name, img)
    return await target.webContents.executeJavaScript(`(()=>{if(typeof window.__fire!=='function')return {ok:false,error:'礼物动画尚未就绪'};window.__fire(${scriptJson(kind)},${scriptJson(name)},${scriptJson(src)},${Math.max(1, Math.trunc(count) || 1)},'');return {ok:true}})()`)
  } catch (error) {
    return { ok: false, error: '礼物动画执行失败：' + (error as Error).message }
  }
}

function runWhenReady(script: string): void {
  const target = win
  void ready.then(() => {
    if (target && target === win && !target.isDestroyed()) return target.webContents.executeJavaScript(script)
  }).catch((error) => console.warn('礼物动画执行失败', error.message))
}

function effectFor(name: string): EffectKind | 'none' {
  const rule = config.rules.find((item) => giftNamesEqual(item.gift, name))
  return rule ? rule.effect : config.defaultEffect
}

// 连接器礼物事件入口（connector-runtime 统一分发）：窗口开着 + 自动播放开着才播。
export function handleEffectsGift(event: ConnectorEvent): void {
  if (event.type !== 'gift' || !event.giftName) return
  if (!config.autoPlay || !win || win.isDestroyed()) return
  const kind = effectFor(event.giftName)
  if (kind === 'none') return
  if (config.minDiamond > 0 && giftPrice(event.giftName, event.diamondCount) < config.minDiamond) return
  const count = Math.max(1, Math.trunc(Number(event.count) || 1))
  effectsFire(kind, event.giftName, count, event.giftImage || undefined, event.sender || '')
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
})
