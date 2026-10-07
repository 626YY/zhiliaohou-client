// 开奖配音的文件名（随包的 box_voice/ 和本机缓存 special-voice/ 共用一套）：sha1(声音|语速|句子) 前 16 位。
// 单独一个纯文件，tools/gen-special-voice.mjs 生成随包配音时也引它，保证两边算出来的名字一样。
import crypto from 'crypto'

export function voiceFileName(voice: string, rate: number, text: string): string {
  const key = `${voice}|${Math.round(Number(rate) || 0)}|${String(text).trim()}`
  return `v-${crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 16)}.mp3`
}
