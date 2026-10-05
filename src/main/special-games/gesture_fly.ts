// 特色玩法「手势拍苍蝇」的页面内 Canvas 代码（引擎见 swat-factory.ts）。
// 苍蝇满屏乱飞、飞累了落地爬行；挥动鼠标扫过 = 拍击，点击 = 拍击，可选声控拍手。
// 素材：gesture_fly/fly.png + fly_crawl_1/2.png（落地爬行帧）；拍击声复用 big_mosquito/slap.mp3。
import { SHARED_JS, MIC_CLAP_JS } from './shared'
import { buildSwatCode } from './swat-factory'

export const code = SHARED_JS + MIC_CLAP_JS + buildSwatCode({
  image: 'gesture_fly/fly.png',
  crawlImages: ['gesture_fly/fly_crawl_1.png', 'gesture_fly/fly_crawl_2.png'],
  slap: 'big_mosquito/slap.mp3',
  bugName: '苍蝇',
  sizeKey: 'bigFlySize',
  hpKey: 'bigFlyHp',
  smallSizeKey: 'smallFlySize',
  smallHpKey: 'smallFlyHp',
  cue: '挥手拍'
})
