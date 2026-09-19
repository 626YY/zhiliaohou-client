# -*- coding: utf-8 -*-
"""接通「导出项目=文件夹 / 从文件夹导入项目 / 新建项目」三个通道，并把界面上的「品游」字样去掉。
用户 2026-09-08：「就不要叫导入品游项目了，就叫导入项目」「品游俩字可以不要出现了」
                「导出项目的时候应该导出的是一个文件夹」「你还得做个新建项目」
用法：python tools/patch-project-folder.py"""
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
        if marker and marker in out:
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

# ---------------- 通道 ----------------
ok &= edit('src/shared/types.ts', [
    ('ProjectExport:', "  PinyouRelocateRules: 'pinyou:relocate-rules',",
     """  PinyouRelocateRules: 'pinyou:relocate-rules',
  ProjectExport: 'project:export',
  ProjectImportFolder: 'project:import-folder',
  ProjectCreate: 'project:create',"""),
])

# ---------------- ipc.ts ----------------
ok &= edit('src/main/ipc.ts', [
    ('Ipc.ProjectExport', "  ipcMain.handle(Ipc.ModsDiagnose, (_e, gameId?: string) => exportModDiagnosis(gameId))",
     """  // 导出一个项目成【文件夹】：素材 + 项目规则.json，别人「导入项目」直接读
  ipcMain.handle(Ipc.ProjectExport, async (_e, project: string, rules: unknown[]) => {
    const picked = await dialog.showOpenDialog({
      title: '选择导出到哪个位置（会在里面建一个项目文件夹）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
    const { exportProject } = await import('./project-folder')
    return exportProject(String(project || ''), Array.isArray(rules) ? rules : [], picked.filePaths[0])
  })
  // 从文件夹导入项目（别人发来的项目文件夹，或者任意一个装着视频的文件夹）
  ipcMain.handle(Ipc.ProjectImportFolder, async (_e, dir?: string) => {
    let from = String(dir || '')
    if (!from) {
      const picked = await dialog.showOpenDialog({
        title: '选择项目文件夹（里面是视频，或别人导出的项目）',
        properties: ['openDirectory']
      })
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
      from = picked.filePaths[0]
    }
    const { importProjectFolder } = await import('./project-folder')
    const result = importProjectFolder(from)
    if (!result.ok) return result
    let added = 0
    const skipped: string[] = []
    for (const rule of result.rules || []) {
      const r = addRule(rule as never)
      if (r.ok) added += 1
      else skipped.push(String((rule as Record<string, unknown>).name || '') + '：' + (r.error || '建不了'))
    }
    return { ...result, added, skipped }
  })
  // 新建项目：素材目录里建文件夹 + 复制选中的视频 + 按条目建规则
  ipcMain.handle(Ipc.ProjectCreate, async (_e, name: string, files?: string[]) => {
    const { createProject } = await import('./project-folder')
    const result = createProject(String(name || ''), Array.isArray(files) ? files : [])
    if (!result.ok) return result
    let added = 0
    for (const rule of result.rules || []) if (addRule(rule as never).ok) added += 1
    return { ...result, added }
  })
  ipcMain.handle(Ipc.ModsDiagnose, (_e, gameId?: string) => exportModDiagnosis(gameId))"""),
])

# ---------------- preload ----------------
ok &= edit('src/preload/index.ts', [
    ('projectExport: (', """  mediaList: (dir: string) => Promise<{ dir: string; files: MediaFileInfo[]; error?: string }>""",
     """  /** 导出一个项目成文件夹（素材 + 项目规则.json），别人「导入项目」能直接读 */
  projectExport: (
    project: string,
    rules: EntertainmentRule[]
  ) => Promise<{ ok: boolean; canceled?: boolean; error?: string; dir?: string; files?: number; bytes?: number; withMedia?: boolean }>
  /** 从文件夹导入项目（不传路径就弹选择框）；added = 建成的规则条数 */
  projectImportFolder: (dir?: string) => Promise<{
    ok: boolean
    canceled?: boolean
    error?: string
    project?: string
    dir?: string
    added?: number
    copied?: number
    fromManifest?: boolean
    skipped?: string[]
  }>
  /** 新建项目：素材目录里建文件夹 + 复制视频 + 自动建规则 */
  projectCreate: (
    name: string,
    files?: string[]
  ) => Promise<{ ok: boolean; error?: string; dir?: string; copied?: number; added?: number }>
  mediaList: (dir: string) => Promise<{ dir: string; files: MediaFileInfo[]; error?: string }>"""),
    ('Ipc.ProjectExport', "  pinyouRelocateRules: (rules) => ipcRenderer.invoke(Ipc.PinyouRelocateRules, rules),",
     """  pinyouRelocateRules: (rules) => ipcRenderer.invoke(Ipc.PinyouRelocateRules, rules),
  projectExport: (project, rules) => ipcRenderer.invoke(Ipc.ProjectExport, project, rules),
  projectImportFolder: (dir) => ipcRenderer.invoke(Ipc.ProjectImportFolder, dir),
  projectCreate: (name, files) => ipcRenderer.invoke(Ipc.ProjectCreate, name, files),"""),
])

print('\n' + ('写入完成' if ok else '★有锚点没对上'))
sys.exit(0 if ok else 2)
