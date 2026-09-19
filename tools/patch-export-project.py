# -*- coding: utf-8 -*-
"""单个项目 / 单个预设的导出，以及导入时把素材路径改到本机（2026-09-08 用户：
  「增加一个可以导出预设，或者单独项目的设置导出」
  「就比如别的主播也想要这个项目的话，可以直接导出这个项目给别人」）

要点：**别人的素材目录跟你的不一样**。导出的 JSON 里 commandParam 是绝对路径
（`F:\\知了猴工作室\\视频\\虚拟主播时间`），对方机器上根本没这个路径 —— 直接导入等于一堆
按不动的规则。所以导入时按【项目文件夹名】在对方自己的品游素材目录里重新定位，
定位不到的如实报出来（缺哪个项目文件夹）。

改动：
  pinyou-project.ts  relocateRules()：按项目名把路径改到本机素材目录
  types.ts / ipc.ts / preload  一个通道 pinyou:relocate-rules
用法：python tools/patch-export-project.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731


def edit(rel, pairs):
    path = P(*rel.split('/'))
    src = io.open(path, encoding='utf-8').read()
    out = src
    bad = []
    for marker, old, new in pairs:
        if marker in out:
            print('  [%s] 已有 %s' % (rel, marker[:34]))
            continue
        if old not in out:
            bad.append(old.strip().splitlines()[0][:66])
            continue
        out = out.replace(old, new, 1)
    for b in bad:
        print('！[%s] 锚点没对上：%s' % (rel, b))
    if bad:
        return False
    if out != src:
        io.open(path, 'w', encoding='utf-8', newline='').write(out)
        print('  [%s] %d → %d' % (rel, len(src), len(out)))
    return True


ok = True

# ---------------- pinyou-project.ts ----------------
RELOCATE = '''
/**
 * 把别人导出的规则里的素材路径改到本机的素材目录。
 *
 * 导出的 JSON 带的是绝对路径（对方机器上的 `F:\\知了猴工作室\\视频\\虚拟主播时间`），
 * 本机素材目录大概率不在同一个盘。按【项目文件夹名】在本机素材库里重新定位：
 * 路径里从后往前找第一个能对上本机项目名的段，把它前面那截换成本机的项目目录。
 *
 * 找不到的不瞎改（保留原路径），并把缺的项目名报回去 —— 对方缺的是视频素材本身，
 * 得让主播知道「把这个文件夹放进你的素材目录」。
 */
export function relocateRules(rules: unknown[]): {
  rules: Record<string, unknown>[]
  moved: number
  missing: string[]
} {
  const projects = listProjects().projects
  const byName = new Map(projects.map((p) => [p.name, p.dir]))
  const missing = new Set<string>()
  let moved = 0

  const relocatePath = (raw: string): string | null => {
    const parts = String(raw || '').split(/[\\\\/]/).filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      const dir = byName.get(parts[i])
      if (!dir) continue
      const next = path.join(dir, ...parts.slice(i + 1))
      if (fs.existsSync(next)) return next
      // 项目文件夹在、但里面少这个视频：仍然改到本机项目目录（规则还能用，缺的是素材）
      return next
    }
    // 一个段都对不上：把看起来像项目名的那段（最后一个目录名）报出来
    const guess = parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1]
    if (guess) missing.add(guess)
    return null
  }

  const fixParam = (value: unknown): string | null => {
    const raw = String(value ?? '')
    if (!raw) return null
    // 参数形如 `<路径>` / `<路径>|绿幕2` / `<视频>|3.5`
    const cut = raw.lastIndexOf('|')
    const head = cut > 1 ? raw.slice(0, cut) : raw
    const tail = cut > 1 ? raw.slice(cut) : ''
    if (fs.existsSync(head)) return null // 本机就有这条路径，不动
    const next = relocatePath(head)
    return next ? next + tail : null
  }

  const MEDIA_CMDS = new Set(['project-random', 'video-play', 'video-random', 'sound-random', 'video-gif'])
  const out = (Array.isArray(rules) ? rules : []).map((item) => {
    const rule = { ...(item as Record<string, unknown>) }
    if (rule.actionType === 'command' && MEDIA_CMDS.has(String(rule.commandCmd))) {
      const next = fixParam(rule.commandParam)
      if (next) {
        rule.commandParam = next
        moved += 1
      }
    }
    if (Array.isArray(rule.extraActions)) {
      rule.extraActions = (rule.extraActions as Record<string, unknown>[]).map((action) => {
        if (!action || action.actionType !== 'command' || !MEDIA_CMDS.has(String(action.commandCmd))) return action
        const next = fixParam(action.commandParam)
        if (!next) return action
        moved += 1
        return { ...action, commandParam: next }
      })
    }
    return rule
  })
  return { rules: out, moved, missing: [...missing] }
}
'''

ok &= edit('src/main/pinyou-project.ts', [
    ('export function relocateRules', '\nexport function projectEntries(', RELOCATE + '\nexport function projectEntries('),
])

# ---------------- types.ts：通道 ----------------
ok &= edit('src/shared/types.ts', [
    ("PinyouRelocateRules:", "  PinyouTimeImport: 'pinyou:time-import',",
     "  PinyouTimeImport: 'pinyou:time-import',\n  PinyouRelocateRules: 'pinyou:relocate-rules',"),
])

# ---------------- ipc.ts：处理器 ----------------
ok &= edit('src/main/ipc.ts', [
    ('Ipc.PinyouRelocateRules', "  ipcMain.handle(Ipc.ModsDiagnose, (_e, gameId?: string) => exportModDiagnosis(gameId))",
     """  // 导入别人导出的项目：把素材路径改到本机的品游素材目录（对方的盘符/目录跟你不一样）
  ipcMain.handle(Ipc.PinyouRelocateRules, async (_e, rules: unknown[]) => {
    const { relocateRules } = await import('./pinyou-project')
    return relocateRules(Array.isArray(rules) ? rules : [])
  })
  ipcMain.handle(Ipc.ModsDiagnose, (_e, gameId?: string) => exportModDiagnosis(gameId))"""),
])

# ---------------- preload ----------------
ok &= edit('src/preload/index.ts', [
    ('pinyouRelocateRules: (rules: EntertainmentRule[])', """  mediaList: (dir: string) => Promise<{ dir: string; files: MediaFileInfo[]; error?: string }>""",
     """  /** 导入别人导出的规则时，把素材路径改到本机素材目录；missing = 本机缺的项目文件夹 */
  pinyouRelocateRules: (rules: EntertainmentRule[]) => Promise<{
    rules: EntertainmentRule[]
    moved: number
    missing: string[]
  }>
  mediaList: (dir: string) => Promise<{ dir: string; files: MediaFileInfo[]; error?: string }>"""),
    ('Ipc.PinyouRelocateRules, rules', "  pinyouTimeImport: (dirs) => ipcRenderer.invoke(Ipc.PinyouTimeImport, dirs),",
     "  pinyouTimeImport: (dirs) => ipcRenderer.invoke(Ipc.PinyouTimeImport, dirs),\n"
     "  pinyouRelocateRules: (rules) => ipcRenderer.invoke(Ipc.PinyouRelocateRules, rules),"),
])

print('\n' + ('写入完成' if ok else '★有锚点没对上'))
sys.exit(0 if ok else 2)
