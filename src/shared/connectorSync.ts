// 连接器组件同步的纯判定（无 fs / 无 electron，可直接单测）：游戏目录里那份要不要换成客户端自带的。
//   版本标记：文件头 6000 字符内的 DOUYIN_ROOM_VERSION / CONNECTOR_VERSION = "YYYY-MM-DD[.n]"，按字串比。
//   connector.py 特殊：没有标记的分三种——
//     · 我们自己的老包连接器（0.2.12 及更早的 DS 包、1.0.0.10 轮椅安装包）：log 前缀 `[connector] `、有单实例互斥 → 当作最旧版本换掉
//     · 图书管理员的薄连接器（前缀 `[darkmage-connector]`）/ 主播自己改的脚本 → 不动
export function moduleVersionOf(content: string): string {
  return String(content || '').slice(0, 6000).match(/^(?:DOUYIN_ROOM_VERSION|CONNECTOR_VERSION)\s*=\s*["']([\w.-]+)["']/m)?.[1] ?? ''
}

const OUR_FULL_CONNECTOR = /print\("\[connector\] "|def acquire_single_instance/

export function isOurFullConnector(content: string): boolean {
  return OUR_FULL_CONNECTOR.test(String(content || '').slice(0, 200_000))
}

/**
 * 要不要用客户端自带的副本覆盖游戏目录里的这份。
 * @param name 文件名；@param have 游戏目录副本内容（不存在传 null）；@param want 客户端自带副本内容
 */
export function shouldReplaceModule(name: string, have: string | null, want: string): { replace: boolean; reason: string } {
  const wantVer = moduleVersionOf(want)
  if (!wantVer) return { replace: false, reason: '客户端自带副本没有版本标记' }
  if (have === null) {
    // connector.py 缺失说明这份 mod 用的是别的连接器（薄连接器），不补；其它组件缺了就补
    return name === 'connector.py' ? { replace: false, reason: '没有 connector.py，不是我们的完整连接器' } : { replace: true, reason: '缺失，补齐' }
  }
  const haveVer = moduleVersionOf(have)
  if (haveVer) return haveVer >= wantVer ? { replace: false, reason: `已是 ${haveVer}` } : { replace: true, reason: `${haveVer} → ${wantVer}` }
  if (name === 'connector.py') {
    return isOurFullConnector(have)
      ? { replace: true, reason: `老包里无版本标记的完整连接器 → ${wantVer}` }
      : { replace: false, reason: '不是我们的完整连接器（薄连接器/自改脚本），不动' }
  }
  return { replace: true, reason: `无版本标记 → ${wantVer}` }
}
