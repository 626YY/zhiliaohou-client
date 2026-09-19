// 十款事件触发型进场特效。装饰最多八枚，循环动效随横幅移除而停止。
export const ENTRANCE_EFFECTS = [
  { id: 'meteor', name: '流星降临', tag: '划破夜空 · 闪耀登场', mark: '✦', bg: '#121a38', ink: '#f3f7ff', accent: '#9bcaff', secondary: '#be9eff' },
  { id: 'thunder', name: '雷霆登场', tag: '高能预警', mark: 'ϟ', bg: '#242117', ink: '#fffce7', accent: '#ffe263', secondary: '#fff8b2' },
  { id: 'royal', name: '王者加冕', tag: '王者驾到 · 全场瞩目', mark: '♛', bg: '#351724', ink: '#fff1cb', accent: '#edbd67', secondary: '#b96764' },
  { id: 'comic', name: '漫画暴击', tag: '全！场！注！意！', mark: '!!', bg: '#fff0bc', ink: '#302448', accent: '#fa567f', secondary: '#4dc3e8' },
  { id: 'cyber', name: '赛博入侵', tag: '信号接入 / 身份确认', mark: '⌘', bg: '#102b2b', ink: '#eeffff', accent: '#6bffce', secondary: '#e287ff' },
  { id: 'festival', name: '花火庆典', tag: '为你点亮整个夜晚', mark: '✺', bg: '#3a1741', ink: '#fff3fd', accent: '#ffb9e7', secondary: '#ffd978' },
  { id: 'phoenix', name: '烈焰之翼', tag: '燃尽黑夜 · 荣耀归来', mark: '✧', bg: '#391910', ink: '#fff3db', accent: '#ffbf6b', secondary: '#f86137' },
  { id: 'spotlight', name: '巨星亮相', tag: '今夜的聚光灯属于你', mark: '★', bg: '#202136', ink: '#ffffff', accent: '#e2d5ff', secondary: '#b9ceff' },
  { id: 'portal', name: '星际传送', tag: '跃迁完成 · 欢迎抵达', mark: '◈', bg: '#231a44', ink: '#f6f0ff', accent: '#c3a3ff', secondary: '#89e6ff' },
  { id: 'frost', name: '冰晶降临', tag: '凛冬之光 · 闪耀来临', mark: '❄', bg: '#e5f6ff', ink: '#1a4764', accent: '#306f98', secondary: '#84cfe8' }
] as const

export type EntranceEffectId = typeof ENTRANCE_EFFECTS[number]['id']
export const isEntranceEffect = (id: unknown): id is EntranceEffectId => ENTRANCE_EFFECTS.some((effect) => effect.id === id)
const escapeHtml = (text: string): string => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

// 预览和真实输出使用同一份安全标记；昵称、规则文案、头像都按数据转义。
export function entranceEffectMarkup(id: unknown, name: string, message: string, avatar = ''): string {
  const effect = ENTRANCE_EFFECTS.find((item) => item.id === id)
  if (!effect) return ''
  const particles = Array.from({ length: 8 }, (_, index) => `<i class="arrival-particle" style="--i:${index};--y:${12 + index % 3 * 27}%" aria-hidden="true"></i>`).join('')
  const photo = /^(?:https?:|file:|data:image\/)/i.test(avatar) ? `<img class="arrival-avatar" src="${escapeHtml(avatar)}" alt="">` : ''
  return `<div class="arrival" data-entrance-effect="${effect.id}"><div class="arrival-ornament" aria-hidden="true">${effect.mark}</div>${particles}
    <div class="arrival-copy"><span class="arrival-eyebrow">${effect.tag}</span><strong class="arrival-name">${escapeHtml(name)}</strong>
    <span class="arrival-message">${escapeHtml(message.replace(/\{name\}/g, name))}</span></div>${photo}</div>`
}

export const ENTRANCE_EFFECT_CSS = ENTRANCE_EFFECTS.map((effect) => `[data-entrance-effect="${effect.id}"]{--arrival-bg:${effect.bg};--arrival-ink:${effect.ink};--arrival-accent:${effect.accent};--arrival-secondary:${effect.secondary}}`).join('\n') + `
.arrival {isolation:isolate;box-sizing:border-box;position:relative;width:100%;min-width:0;height:118px;max-height:calc(100vh - 16px);padding:12px 76px 12px 30px;overflow:hidden;color:var(--arrival-ink);background:var(--arrival-bg);border:2px solid var(--arrival-accent);border-radius:12px;display:flex;align-items:center;font-family:'Microsoft YaHei',sans-serif}
.arrival-copy {z-index:2;position:relative;min-width:0;width:100%;display:flex;align-items:flex-start;flex-direction:column}
.arrival-eyebrow {font-size:10px;font-weight:700;letter-spacing:3px;color:var(--arrival-accent);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arrival-name {font-size:42px;line-height:1.16;letter-spacing:2px;font-weight:900;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:arrival-name .65s cubic-bezier(.18,.85,.2,1.2) both}
.arrival-message {margin-top:4px;font-size:12px;opacity:.88;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.arrival-ornament {position:absolute;right:18px;top:50%;transform:translateY(-50%) rotate(12deg);font-size:70px;line-height:1;color:var(--arrival-accent);opacity:.72;z-index:1}
.arrival-avatar {position:absolute;right:25px;top:36px;width:46px;height:46px;object-fit:cover;border-radius:50%;border:2px solid var(--arrival-accent);z-index:2}
.arrival::before,.arrival::after {content:'';position:absolute;pointer-events:none;z-index:0}
.arrival-particle {position:absolute;left:calc(8% + var(--i)*12%);top:var(--y);width:5px;height:5px;border-radius:50%;background:var(--arrival-secondary);opacity:0;animation:arrival-spark 1.6s calc(var(--i)*.045s) ease-out both}
@keyframes arrival-name {from {opacity:0;transform:translateX(-28px) scale(1.12)}to {opacity:1;transform:none}}
@keyframes arrival-spark {0% {opacity:0;transform:translateY(24px) scale(.1)}30%{opacity:.9}100%{opacity:0;transform:translateY(-45px) scale(1.4)}}
[data-entrance-effect="meteor"] {clip-path:polygon(18px 0,100% 0,calc(100% - 18px) 100%,0 100%);border-radius:0;background:linear-gradient(105deg,var(--arrival-bg) 50%,var(--arrival-secondary))}
[data-entrance-effect="meteor"]::before {width:180px;height:3px;right:-30px;top:25px;background:var(--arrival-ink);box-shadow:0 20px var(--arrival-accent),40px 42px var(--arrival-accent);transform:rotate(-32deg);animation:arrival-meteor 3.8s ease-out infinite}
[data-entrance-effect="meteor"] .arrival-name {text-shadow:3px 3px var(--arrival-bg),0 0 18px var(--arrival-accent)}
@keyframes arrival-meteor {from {transform:translate(190px,-80px) rotate(-32deg);opacity:0}to {transform:rotate(-32deg);opacity:1}}
[data-entrance-effect="thunder"] {border-radius:0;border-width:3px;background:repeating-linear-gradient(115deg,transparent 0 36px, rgb(255 226 99 / .06) 36px 38px),var(--arrival-bg)}
[data-entrance-effect="thunder"]::after {inset:0 12% 0 auto;width:80px;background:var(--arrival-accent);clip-path:polygon(38% 0,100% 0,62% 40%,85% 40%,0 100%,29% 49%,8% 49%);opacity:.3}
[data-entrance-effect="thunder"] .arrival-name {color:var(--arrival-accent);text-shadow:3px 3px var(--arrival-bg),-2px -1px var(--arrival-secondary);animation:arrival-thunder .65s steps(1) both}
@keyframes arrival-thunder {0%,20%{transform:translateX(-12px);opacity:.2}10%,40%{transform:translateX(8px)}30%,60%{transform:translateX(-3px)}100%{transform:none;opacity:1}}
[data-entrance-effect="royal"] {border:3px double var(--arrival-accent);outline:1px solid var(--arrival-accent);outline-offset:-8px;border-radius:5px;padding-left:32px}
[data-entrance-effect="royal"] .arrival-name {color:var(--arrival-accent);text-shadow:0 2px var(--arrival-bg),0 4px var(--arrival-secondary);letter-spacing:5px}
[data-entrance-effect="royal"]::before {inset:0;background:linear-gradient(110deg,transparent 25%,rgb(237 189 103 / .18) 45%,transparent 60%);animation:arrival-gloss 1.4s ease-out both}
@keyframes arrival-gloss {from{transform:translateX(-100%)}to{transform:translateX(100%)}}
[data-entrance-effect="comic"] {border:4px solid var(--arrival-ink);border-radius:0;box-shadow:5px 5px 0 var(--arrival-accent);background-image:radial-gradient(var(--arrival-secondary) 1px,transparent 1px);background-size:8px 8px;transform:rotate(-1deg)}
[data-entrance-effect="comic"] .arrival-copy {align-items:center}
[data-entrance-effect="comic"] .arrival-eyebrow {background:var(--arrival-ink);color:var(--arrival-bg);padding:2px 10px;letter-spacing:2px;transform:rotate(-2deg)}
[data-entrance-effect="comic"] .arrival-name {color:var(--arrival-ink);text-shadow:3px 3px var(--arrival-accent);font-style:italic;animation:arrival-comic .7s ease-out both}
@keyframes arrival-comic {0%{transform:scale(2);opacity:0}45%{transform:scale(.9);opacity:1}70%{transform:scale(1.08)}100%{transform:none}}
[data-entrance-effect="cyber"] {border-radius:0;clip-path:polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,24px 100%,0 calc(100% - 24px));background-image:repeating-linear-gradient(0deg,transparent 0 4px,rgb(107 255 206 / .08) 4px 5px)}
[data-entrance-effect="cyber"] .arrival-name {text-shadow:-3px 0 var(--arrival-secondary),3px 0 var(--arrival-accent);animation:arrival-thunder .5s steps(1)}
[data-entrance-effect="cyber"]::after {top:0;bottom:0;width:4px;background:var(--arrival-accent);animation:arrival-scan 1.2s ease-out both}
@keyframes arrival-scan {from{transform:translateX(0);opacity:.9}to{transform:translateX(650px);opacity:0}}
[data-entrance-effect="festival"] {border:2px solid var(--arrival-accent);border-radius:36px 8px;background:radial-gradient(ellipse at right top,var(--arrival-secondary),transparent 50%),var(--arrival-bg)}
[data-entrance-effect="festival"] .arrival-name {text-shadow:2px 2px var(--arrival-bg),0 0 12px var(--arrival-accent)}
[data-entrance-effect="festival"] .arrival-particle {width:7px;height:13px;border-radius:1px;animation:arrival-confetti 1.8s calc(var(--i)*.04s) ease-out both}
@keyframes arrival-confetti {0%{opacity:0;transform:translateY(-65px) rotate(0)}20%{opacity:1}100%{opacity:0;transform:translateY(95px) rotate(200deg)}}
[data-entrance-effect="phoenix"] {border:0;border-bottom:3px solid var(--arrival-accent);border-radius:70% 3px 3px 3px / 18% 3px 3px 3px;padding-left:40px}
[data-entrance-effect="phoenix"]::before {right:0;bottom:0;width:55%;height:100%;background:linear-gradient(145deg,transparent,var(--arrival-secondary));clip-path:polygon(100% 0,70% 48%,85% 30%,68% 65%,98% 45%,60% 87%,100% 76%,100% 100%,0 100%);animation:arrival-wing .8s ease-out}
[data-entrance-effect="phoenix"] .arrival-name {color:var(--arrival-accent);text-shadow:0 2px var(--arrival-bg),0 0 15px var(--arrival-secondary)}
@keyframes arrival-wing {from{transform:scaleX(.2);transform-origin:right;opacity:0}to{transform:scaleX(1);opacity:1}}
[data-entrance-effect="spotlight"] {border:1px solid var(--arrival-accent);border-radius:8px}
[data-entrance-effect="spotlight"]::before {inset:-40% 10%;background:conic-gradient(from 150deg at 50% 0,transparent 0 9deg,rgb(226 213 255 / .32) 10deg 45deg,transparent 46deg);animation:arrival-light 1s ease-out both}
[data-entrance-effect="spotlight"] .arrival-copy {align-items:center}
[data-entrance-effect="spotlight"] .arrival-name {letter-spacing:5px;text-shadow:0 0 14px var(--arrival-secondary)}
@keyframes arrival-light {from{transform:rotate(-35deg);opacity:0}to{transform:rotate(0);opacity:1}}
[data-entrance-effect="portal"] {border-radius:60px;border:2px solid var(--arrival-secondary);padding-left:40px}
[data-entrance-effect="portal"]::before,[data-entrance-effect="portal"]::after {right:-10px;top:-25px;width:165px;height:165px;border:5px double var(--arrival-accent);border-radius:50%;transform:rotate(-25deg) scaleX(.5);animation:arrival-portal .85s ease-out,arrival-orbit 5s .85s ease-in-out infinite alternate}
[data-entrance-effect="portal"]::after {right:10px;border-color:var(--arrival-secondary);opacity:.4}
[data-entrance-effect="portal"] .arrival-name {text-shadow:3px 0 var(--arrival-bg),0 0 15px var(--arrival-accent)}
@keyframes arrival-portal {from{transform:rotate(-80deg) scale(.1);opacity:0}to{transform:rotate(-25deg) scaleX(.5);opacity:1}}
@keyframes arrival-orbit {from{transform:rotate(-25deg) scaleX(.5);opacity:.55}to{transform:rotate(20deg) scaleX(.65);opacity:1}}
[data-entrance-effect="frost"] {clip-path:polygon(18px 0,95% 0,100% 20%,calc(100% - 10px) 100%,0 100%,0 18px);border-radius:0;background:linear-gradient(125deg,var(--arrival-bg),var(--arrival-ink) 250%)}
[data-entrance-effect="frost"]::before {inset:0;background:linear-gradient(140deg,transparent 45%,rgb(255 255 255 / .7) 46% 47%,transparent 48%),linear-gradient(70deg,transparent 65%,var(--arrival-secondary) 66% 67%,transparent 68%)}
[data-entrance-effect="frost"] .arrival-name {text-shadow:2px 2px white,4px 4px var(--arrival-secondary)}
.banner:has(.arrival) {width:calc(100% - 18px);padding:0;max-height:none;background:none;border:0;box-shadow:none;overflow:visible}
@media(max-width:360px){.arrival{padding-left:16px;padding-right:48px}.arrival-name{font-size:28px;letter-spacing:0}.arrival-ornament{right:8px;font-size:44px}.arrival-eyebrow{letter-spacing:1px}.arrival-avatar{right:8px;width:30px;height:30px}}
@media(max-height:85px){.arrival {height:calc(100vh - 12px);padding-block:4px}.arrival-name{font-size:24px}.arrival-eyebrow,.arrival-message{display:none}}
`
