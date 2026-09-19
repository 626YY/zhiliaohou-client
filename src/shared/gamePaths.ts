// 游戏 exe 路径的「什么才算对」——一处定义，自动探测 / 手动选择 / 启动前校验都用它。
//   2026-09-07：主播反馈「重装 mod 后检测不到游戏运行」，查下来是路径认错，有三种走法都会踩：
//   ① 手选 exe 选到游戏根目录的启动器（DON'T SCREAM 根目录那个叫 `Dont_Scream.exe`，
//      真正要的是 `DontScream/Binaries/Win64/DontScream-Win64-Shipping.exe`）。
//      mod 目录是拿 exe 所在目录推的（mods.ts::markerPath），选错一层，mod 就装到游戏根，
//      而 UE4SS 只认 Binaries/Win64，于是「装完了却检测不到」。
//   ② 查游戏在不在跑用的是 exe 文件名（game-launcher.ts::queryGameState）。轮椅真实文件名是
//      `4Wheel Challenge.exe`（**带空格**），存成 `4WheelChallenge.exe` 就永远查不到进程。
//   ③ 路径以前只判 `existsSync`，测试夹具留下的 0 字节假 exe 也算「已定位」，
//      自动探测看见有路径就跳过，再也不会纠正（用户机器上轮椅就一直指着
//      `C:\Temp\zhiliao-backend-audit-fixture\4WheelChallenge.exe`）。
//
// 所以这里同时管两件事：判「合不合格」(checkGamePath) 和「从选错的路径往哪找对的」(searchRootFor)。
// 纯逻辑、不碰文件系统（存在性和大小由调用方探好传进来），单测 tools/test-game-paths.mjs。

/** 一款游戏的 exe 路径规则。新增游戏在这里加一条即可。 */
export interface GamePathRule {
  /** 正确 exe 的**文件名**必须整体匹配（挡住启动器、崩溃处理器、卸载程序） */
  exe: RegExp
  /** Steam `steamapps/common` 下的游戏目录名匹配（用来定位「游戏根」往下重找） */
  dir: RegExp
  /** 出错时给主播看的正确样子 */
  sample: string
}

export const GAME_PATH_RULES: Record<string, GamePathRule> = {
  '4wheel-challenge': {
    // 真实文件名是「4Wheel Challenge.exe」，带空格；同目录还有 UnityCrashHandler64.exe / unins000.exe
    exe: /^4wheel[ _-]?challenge\.exe$/i,
    dir: /4wheel/i,
    sample: 'steamapps\\common\\4WheelChallenge\\4Wheel Challenge.exe'
  },
  dontscream: {
    // 游戏根目录那个 Dont_Scream.exe 是启动器，选它 mod 会装错层
    exe: /^dontscream-win64-shipping\.exe$/i,
    dir: /scream/i,
    sample: "steamapps\\common\\DON'T SCREAM\\DontScream\\Binaries\\Win64\\DontScream-Win64-Shipping.exe"
  },
  librarian: {
    exe: /^librarian-win64-shipping\.exe$/i,
    dir: /librarian/i,
    sample:
      'steamapps\\common\\Librarian Tidy Up the Arcane Library!\\Librarian\\Binaries\\Win64\\Librarian-Win64-Shipping.exe'
  }
}

export type GamePathCode =
  | 'ok'
  /** 没填 */
  | 'empty'
  /** 文件不在了（游戏卸载 / 换盘 / 路径手改错） */
  | 'missing'
  /** 0 字节：测试夹具或下载了一半 */
  | 'zero'
  /** 在临时目录里：夹具残留，绝不是真游戏 */
  | 'temp'
  /** 是个 exe，但不是这款游戏要的那个（多半选到了启动器） */
  | 'wrong-exe'
  /** 清单里没有这款游戏的规则 —— 只做基本存在性检查，不拦 */
  | 'no-rule'

export interface GamePathVerdict {
  ok: boolean
  code: GamePathCode
  /** 给主播看的一句话；ok 时为空 */
  reason: string
}

/** 调用方探好的文件信息（主进程用 fs 填，测试直接造） */
export interface PathProbe {
  exists: boolean
  /** 字节数；探不到填 -1 表示「不知道」，不据此判失败 */
  size: number
}

// 临时目录判定：AppData\Local\Temp、Windows\Temp 一定是；别的 \temp\ \tmp\ 段只有在不是 Steam 库（steamapps\common）时才算——
// 有人把 Steam 库建在 D:\Temp\SteamLibrary，以前一律判「假游戏」，这款游戏就彻底用不了
const TEMP_SYS = /[\\/]AppData[\\/]Local[\\/]Temp[\\/]|[\\/]Windows[\\/]Temp[\\/]/i
const TEMP_ANY = /[\\/](?:temp|tmp)[\\/]/i
const STEAM_LIB = /steamapps[\\/]common[\\/]/i
function isTempPath(p: string): boolean {
  return TEMP_SYS.test(p) || (TEMP_ANY.test(p) && !STEAM_LIB.test(p))
}

/** 取路径最后一段（同时认 \ 和 /，不依赖 node:path，好在渲染进程/测试里用） */
export function baseName(p: string): string {
  const parts = String(p || '').split(/[\\/]+/)
  return parts[parts.length - 1] || ''
}

/**
 * 判一条 exe 路径合不合格。
 * 注意顺序：先判存在，再判「是不是假的」，最后才判「是不是这款游戏的」——
 * 这样报给主播的原因是最具体的那个。
 */
export function checkGamePath(gameId: string, exePath: string, probe: PathProbe): GamePathVerdict {
  const p = String(exePath || '').trim()
  if (!p) return { ok: false, code: 'empty', reason: '还没设置游戏路径' }
  if (!probe.exists) return { ok: false, code: 'missing', reason: '这个文件不在了，游戏可能换了位置' }
  if (probe.size === 0) return { ok: false, code: 'zero', reason: '这个文件是空的，不是真的游戏程序' }
  if (isTempPath(p)) return { ok: false, code: 'temp', reason: '这是临时目录里的文件，不是真的游戏' }

  const rule = GAME_PATH_RULES[gameId]
  if (!rule) return { ok: true, code: 'no-rule', reason: '' }
  if (!rule.exe.test(baseName(p))) {
    return {
      ok: false,
      code: 'wrong-exe',
      reason: `选的不是游戏本体，应该选 ${baseName(rule.sample)}`
    }
  }
  return { ok: true, code: 'ok', reason: '' }
}

/**
 * 从一条（可能选错的）路径推出「该从哪个目录往下重找正确 exe」。
 *
 * 主播多半是在游戏目录里点错了文件，正确的 exe 就在同一棵目录树下：
 *   · 路径里有 `steamapps/common` → 取 common 的下一层（最稳，就是游戏根）
 *   · 否则从上往下取第一个名字匹配 rule.dir 的层（`DON'T SCREAM` 会先于 `DontScream` 命中）
 *   · 都不匹配 → 退回 exe 所在目录，至少在原地找一圈
 * 返回目录路径（不保证存在，调用方自己判）。
 */
export function searchRootFor(gameId: string, exePath: string): string {
  const p = String(exePath || '').trim()
  if (!p) return ''
  const sep = p.includes('\\') ? '\\' : '/'
  const parts = p.split(/[\\/]+/)
  parts.pop() // 去掉文件名，余下是 exe 所在目录

  const lower = parts.map((x) => x.toLowerCase())
  const common = lower.lastIndexOf('common')
  if (common >= 0 && lower[common - 1] === 'steamapps' && parts.length > common + 1) {
    return parts.slice(0, common + 2).join(sep)
  }

  const rule = GAME_PATH_RULES[gameId]
  if (rule) {
    for (let i = 0; i < parts.length; i++) {
      if (rule.dir.test(parts[i])) return parts.slice(0, i + 1).join(sep)
    }
  }
  return parts.join(sep)
}

/** 这款游戏正确 exe 的样子（给 UI 当 placeholder / 错误提示用） */
export function gamePathSample(gameId: string): string {
  return GAME_PATH_RULES[gameId]?.sample || ''
}
