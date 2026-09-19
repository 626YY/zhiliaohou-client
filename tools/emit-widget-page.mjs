import fs from 'fs'
const mod = await import('file:///C:/kbshot/widget_bundle.mjs')
const page = mod.__page
const cfg = {
  mode: 'timer', slot: 'challenge', style: '',
  on: true, title: '今日挑战：不许翻车', initial: 3725, zeroText: '时间到！',
  clockSpeed: 1000, clockOn: true, countColor: 0, third: '送礼加时 · 翻车减时',
  pauseText: '', showRecord: false,
  gifts: [
    { name: '小心心', delta: '+1', img: '', op: '加减', before: 5, after: 5, text: '' },
    { name: '玫瑰', delta: '-2', img: '', op: '加减', before: 10, after: 10, text: '' },
    { name: '没有图的礼物', delta: '+3', img: '', op: '加减', before: 1, after: 1, text: '' }
  ],
  giftShow: true, giftCount: 6, showLock: true, showNegative: false, showSeconds: false,
  zeroHide: false, pauseAdjust: false, pauseGift: '', pauseTime: 0, hotkeys: [],
  mouseValue: 0, bgColor: '#000000', bgAlpha: 0.7, bgTransparent: false, posX: 0, posY: 0,
  titleColor: 3, numColor: 2, giftNameColor: 1, deltaColor: 5
}
fs.writeFileSync('C:/kbshot/widget_challenge.html', page(cfg, {}), 'utf8')
fs.writeFileSync('C:/kbshot/widget_overtime.html', page({ ...cfg, slot: 'overtime', style: '粉色萌仔', title: '我爱加班！我要996！', third: '加班中，勿扰' }, {}), 'utf8')
console.log('已生成两张挂件页面')
