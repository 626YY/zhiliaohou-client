// 时间插件和其他挂件共用的五套新皮肤；动态只移动装饰层，正文与计时不重绘。
export const ADDITIONAL_WIDGET_SKINS = [
  { id: 'nebula', name: '星云跃迁', note: '动态 · 星轨缓缓掠过', bg: '#171d38', surface: '#262e50', text: '#eff4ff', muted: '#b2bfdf', accent: '#b9b2ff', line: '#65759c', radius: '20px 4px 20px 4px', motion: true },
  { id: 'sunset', name: '落日海岸', note: '动态 · 海面暖光呼吸', bg: '#332031', surface: '#482b3d', text: '#fff1e7', muted: '#dfb8be', accent: '#ffb58f', line: '#a3747e', radius: '24px 24px 5px 5px', motion: true },
  { id: 'gilded', name: '鎏金礼赞', note: '动态 · 金属斜光流动', bg: '#26231d', surface: '#383126', text: '#fff4dc', muted: '#d6c7a7', accent: '#edc47b', line: '#947a4f', radius: '2px 18px 2px 18px', motion: true },
  { id: 'glacier', name: '冰川档案', note: '静态 · 冰白切面', bg: '#edf5f7', surface: '#d8e8ee', text: '#203d4b', muted: '#476878', accent: '#316b83', line: '#90b0bd', radius: '14px 3px 14px 3px', motion: false },
  { id: 'graphite', name: '石墨仪表', note: '静态 · 工业刻度', bg: '#242729', surface: '#33383b', text: '#f2f3ed', muted: '#c0c7c4', accent: '#cddd9c', line: '#718079', radius: '6px', motion: false }
] as const

// 展示挂件共用的外观令牌；不包含任何礼物、计时或执行规则。
export const WIDGET_SKINS = [
  { id: 'classic', name: '原版', note: '沿用原有外观', bg: '#241d39', surface: '#332747', text: '#fff5e4', muted: '#d2bedc', accent: '#ffd166', line: '#8d7045', radius: '16px' },
  { id: 'theatre', name: '黑金剧场', note: '细金线 · 剧场铭牌', bg: '#191918', surface: '#292720', text: '#fff2d5', muted: '#cbbb9b', accent: '#dfbe7c', line: '#74613e', radius: '4px' },
  { id: 'aurora', name: '极光航站', note: '冷光 · 航站仪表', bg: '#102b35', surface: '#183d48', text: '#edfaff', muted: '#a0c9d0', accent: '#87ddea', line: '#477783', radius: '18px 4px 18px 4px' },
  { id: 'sakura', name: '樱花来信', note: '柔粉 · 信封花笺', bg: '#fff3f5', surface: '#f4dde4', text: '#52283d', muted: '#785468', accent: '#a73e67', line: '#c486a0', radius: '22px' },
  { id: 'paper', name: '手帐纸笺', note: '纸白 · 墨色刻度', bg: '#f5f0e5', surface: '#e8e1d3', text: '#303d41', muted: '#586669', accent: '#386672', line: '#91a3a1', radius: '3px' },
  { id: 'arcade', name: '像素街机', note: '像素 · 游戏面板', bg: '#231b36', surface: '#36284e', text: '#f8efff', muted: '#c6b5df', accent: '#c9a3ff', line: '#80629f', radius: '0px' },
  ...ADDITIONAL_WIDGET_SKINS
] as const

export type WidgetSkinId = typeof WIDGET_SKINS[number]['id']
export const MODERN_WIDGET_SKINS = WIDGET_SKINS.filter((skin) => skin.id !== 'classic')
export function normalizeWidgetSkin(value: unknown): WidgetSkinId {
  return WIDGET_SKINS.find((skin) => skin.id === value)?.id || 'classic'
}
export function widgetSkin(value: unknown) {
  return WIDGET_SKINS.find((skin) => skin.id === value) || WIDGET_SKINS[0]
}

// 编辑预览与输出窗口共享装饰，不在小缩略图上持续开动画。
// 每块面板最多一个合成动画层；不使用模糊滤镜、Canvas 帧循环或大图。
export function pluginSkinDecorationCss(selector: (id: string) => string): string {
  const art: Record<string, string> = {
    nebula: 'background:radial-gradient(ellipse at 12% 8%,var(--plugin-glint) 0 1px,transparent 2px),radial-gradient(ellipse at 82% 82%,var(--plugin-glint) 0 1px,transparent 2px),linear-gradient(115deg,transparent 12%,var(--plugin-glint) 13%,transparent 14% 76%,var(--plugin-glint) 77%,transparent 78%);opacity:.14;animation:plugin-star-drift 12s ease-in-out infinite alternate',
    sunset: 'background:radial-gradient(ellipse at 98% 6%,var(--plugin-glint),transparent 32%),repeating-linear-gradient(0deg,transparent 0 7px,var(--plugin-glint) 8px 9px,transparent 10px 13px);mask-image:linear-gradient(90deg,transparent 70%,black);opacity:.13;animation:plugin-tide 8s ease-in-out infinite alternate',
    gilded: 'background:linear-gradient(120deg,transparent 20%,var(--plugin-glint) 47%,transparent 55% 75%,var(--plugin-glint) 77%,transparent 79%);opacity:.13;animation:plugin-gold-sweep 10s ease-in-out infinite',
    glacier: 'background:linear-gradient(135deg,var(--plugin-glint) 0 3%,transparent 3% 96%,var(--plugin-glint) 96%),linear-gradient(45deg,transparent 91%,var(--plugin-glint) 91% 92%,transparent 92%);opacity:.16',
    graphite: 'background:repeating-linear-gradient(90deg,var(--plugin-glint) 0 1px,transparent 1px 8px) left 8px bottom 5px / 40px 4px no-repeat,repeating-linear-gradient(90deg,var(--plugin-glint) 0 1px,transparent 1px 8px) right 8px top 5px / 40px 4px no-repeat;opacity:.6'
  }
  return ADDITIONAL_WIDGET_SKINS.map(skin => `${selector(skin.id)}{position:relative;overflow:hidden;--plugin-glint:${skin.accent}}
${selector(skin.id)}::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;${art[skin.id]}}`).join('\n') + `
@keyframes plugin-star-drift{from{transform:translate3d(-5%,0,0);opacity:.09}to{transform:translate3d(5%,0,0);opacity:.2}}
@keyframes plugin-tide{from{transform:translate3d(0,-3%,0);opacity:.08}to{transform:translate3d(0,3%,0);opacity:.18}}
@keyframes plugin-gold-sweep{0%,8%{transform:translate3d(-100%,0,0);opacity:0}30%{opacity:.18}85%,100%{transform:translate3d(100%,0,0);opacity:0}}
`
}

export const WIDGET_SKIN_CSS = WIDGET_SKINS.map((skin) => `[data-widget-skin="${skin.id}"] {
  --ws-bg:${skin.bg};--ws-surface:${skin.surface};--ws-text:${skin.text};--ws-muted:${skin.muted};
  --ws-accent:${skin.accent};--ws-line:${skin.line};--ws-radius:${skin.radius};
}`).join('\n') + `
[data-widget-skin]:not([data-widget-skin="classic"]) .skin-panel {
  background:var(--ws-bg);color:var(--ws-text);border:1px solid var(--ws-line);border-radius:var(--ws-radius);
  box-shadow:inset 0 3px var(--ws-accent),0 6px 16px rgb(0 0 0 / .18);
}
[data-widget-skin="paper"] .skin-panel {border-top:5px solid var(--ws-accent);box-shadow:3px 3px 0 var(--ws-line)}
[data-widget-skin="arcade"] .skin-panel {border:3px solid var(--ws-line);box-shadow:4px 4px 0 var(--ws-accent)}
[data-widget-skin="theatre"] .skin-panel {outline:1px solid var(--ws-line);outline-offset:-6px}
[data-widget-skin="sakura"] .skin-panel {border-style:dashed;box-shadow:inset 0 4px var(--ws-surface),0 4px 16px rgb(0 0 0 / .12)}
[data-widget-skin="aurora"] .skin-panel {position:relative;overflow:hidden}
[data-widget-skin="aurora"] .skin-panel::after {content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 40%,rgb(135 221 234 / .12) 50%,transparent 60%);transform:translateX(-100%);animation:skin-aurora 6s ease-in-out infinite}
@keyframes skin-aurora {0%,10%{transform:translateX(-100%);opacity:0}30%{opacity:1}80%,100%{transform:translateX(100%);opacity:0}}
` + pluginSkinDecorationCss(id => `[data-widget-skin="${id}"] :is(.skin-panel,.skin-motion-panel)`)

// 进场横幅的编辑预览与真实输出使用同一段 CSS。
export const ENTRANCE_SKIN_CSS = `
.entrance-banner {box-sizing:border-box;display:flex;align-items:center;gap:14px;max-width:100%;padding:16px 24px 16px 16px;min-width:0;font-family:"Microsoft YaHei",sans-serif}
.entrance-banner .avatar {width:52px;height:52px;flex:none;border-radius:50%;object-fit:cover;background:var(--ws-surface);color:var(--ws-accent);display:flex;align-items:center;justify-content:center;font-size:24px}
.entrance-banner .text {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:clamp(16px,4vw,28px);line-height:1.45}
.entrance-banner b {color:var(--ws-accent)}
.entrance-banner.skin-panel {min-height:86px}
[data-widget-skin="paper"] .entrance-banner .avatar {border-radius:4px;border:1px solid var(--ws-line)}
[data-widget-skin="arcade"] .entrance-banner .avatar {border-radius:0;border:2px solid var(--ws-line)}
[data-widget-skin="aurora"] .entrance-banner .avatar {border:1px solid var(--ws-accent);border-radius:12px 2px}
`
