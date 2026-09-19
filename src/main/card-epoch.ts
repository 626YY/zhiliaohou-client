// 卡密模式的「授权纪元」：登录 / 退出 / 授权被拒 / 平台掉线都会 +1。
// 任何跨 await 的执行链（延后动作、写桥前的异步查询、续租请求）都在开始时记下纪元，
// 回来后纪元变了就作废，防止「旧账号的动作在换号之后继续执行」。
// 单独一个无依赖的小模块：entertainment.ts / live-api.ts 等都要读它，而 card-auth.ts 又引用它们，不能成环。
let epoch = 0

export function cardEpoch(): number {
  return epoch
}

export function bumpCardEpoch(): number {
  epoch += 1
  return epoch
}
