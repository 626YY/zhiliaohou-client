// 点分版本号比较：>0 表示 a 更新。游戏库卡片/详情页/启动提示共用，判断「已装的 mod 有没有新版本」。
export function compareVersion(a: string, b: string): number {
  const pa = String(a || '').split('.').map((n) => Number(n) || 0)
  const pb = String(b || '').split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** 已装版本已知且清单版本更新 → 有更新可装。 */
export function modUpdateAvailable(manifestVersion: string, installedVersion?: string): boolean {
  return !!installedVersion && compareVersion(manifestVersion, installedVersion) > 0
}
