// 特色玩法「手势拍蚊子」的页面内 Canvas 代码（引擎见 swat-factory.ts）。
// 大蚊子（要拍 3 下）满屏乱飞；挥动鼠标扫过 = 拍击，点击 = 拍击，可选声控拍手。
// 素材：big_mosquito/mosquito.png + slap.mp3；环境蚊鸣复用 mosquito/mosquito.mp3。
import { SHARED_JS, MIC_CLAP_JS } from './shared'
import { buildSwatCode } from './swat-factory'

export const code = SHARED_JS + MIC_CLAP_JS + buildSwatCode({
  image: 'big_mosquito/mosquito.png',
  slap: 'big_mosquito/slap.mp3',
  buzz: 'mosquito/mosquito.mp3',
  bugName: '蚊子',
  sizeKey: 'bigMosquitoSize',
  hpKey: 'bigMosquitoHp',
  smallSizeKey: 'smallMosquitoSize',
  smallHpKey: 'smallMosquitoHp',
  cue: '挥手拍'
})
