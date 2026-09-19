// 倒计时的时间文字：设置页预览和直播挂件必须一字不差，所以只留这一份实现。
//
// 之前两边各写了一套：预览永远输出「00:05:00」，挂件不足一小时时输出「05:00」。
// 主播在设置页看到的排版和真上播的挂件对不上（字数不同，自适应字号也就不同）。
//
// 挂件页是主进程拼字符串生成的 HTML，靠 formatCountdown.toString() 把这段源码原样注进去，
// 所以这个函数必须自给自足：不能调用模块里的其他函数，不能用会被编译成外部引用的语法。
export function formatCountdown(value: number, showNegative: boolean): string {
  const seconds = showNegative ? Math.trunc(value) : Math.max(0, Math.trunc(value))
  const negative = seconds < 0 ? '-' : ''
  const absolute = Math.abs(seconds)
  const day = Math.floor(absolute / 86400)
  const hour = Math.floor((absolute % 86400) / 3600)
  const minute = Math.floor((absolute % 3600) / 60)
  const second = absolute % 60
  const pad = (n: number): string => (n < 10 ? '0' + n : String(n))
  // 定稿格式：不足一小时只显示 分:秒；有小时或天数时，小时补零不省略。
  return negative + (day ? day + '天' : '') + (day || hour ? pad(hour) + ':' : '') + pad(minute) + ':' + pad(second)
}

/** 注入挂件页用的源码（挂件页里就叫 fmt）。 */
export function countdownFormatSource(): string {
  return 'var fmt=' + formatCountdown.toString() + ';'
}
