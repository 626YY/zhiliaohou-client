# -*- coding: utf-8 -*-
"""把分组开关 / 预设通道接到 ipc.ts 和 preload（两头都得有，见项目架构铁律）。
用法：python tools/patch-presets-ipc.py"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731


def edit(rel, pairs):
    path = P(*rel.split('/'))
    src = io.open(path, encoding='utf-8').read()
    out = src
    for old, new in pairs:
        key = new.strip().splitlines()[0]
        if key in out:
            print('  [%s] 已有「%s」，跳过' % (rel, key[:40]))
            continue
        if old not in out:
            print('！[%s] 找不到锚点：%s' % (rel, old.strip().splitlines()[0][:60]))
            return False
        out = out.replace(old, new, 1)
    if out != src:
        io.open(path, 'w', encoding='utf-8', newline='').write(out)
        print('  [%s] %d → %d' % (rel, len(src), len(out)))
    return True


ok = True

# ---------------- ipc.ts ----------------
ok &= edit('src/main/ipc.ts', [
    # 从 entertainment 多导出几个函数
    ("  listGiftImages, rulesPausedState } from './entertainment'",
     "  listGiftImages, rulesPausedState,\n"
     "  ruleGroups, toggleRuleGroup, listPresets, savePreset, removePreset, applyPreset } from './entertainment'"),
    # 处理器
    ("  ipcMain.handle(Ipc.EntertainmentSendKeys, (_e, keySeq) =>",
     """  // ---- 规则分组与预设：「今晚开哪几个项目」----
  // 分组一般就是品游项目名（导入时自动填），预设存的是「开哪几个组」。
  // 放主进程是因为规则的权威在这儿，透明图菜单和连接器匹配都要读同一份。
  ipcMain.handle(Ipc.EntertainmentGroupToggle, (_e, group, on) =>
    toggleRuleGroup(String(group ?? ''), on !== false)
  )
  ipcMain.handle(Ipc.EntertainmentPresetList, () => ({ presets: listPresets(), groups: ruleGroups() }))
  ipcMain.handle(Ipc.EntertainmentPresetSave, (_e, preset) => savePreset(preset))
  ipcMain.handle(Ipc.EntertainmentPresetRemove, (_e, id) => removePreset(String(id ?? '')))
  ipcMain.handle(Ipc.EntertainmentPresetApply, (_e, id) => applyPreset(String(id ?? '')))
  ipcMain.handle(Ipc.EntertainmentSendKeys, (_e, keySeq) =>"""),
])

# ---------------- preload：类型 + 实现 ----------------
ok &= edit('src/preload/index.ts', [
    ('  type EntertainmentRule,\n', '  type EntertainmentRule,\n  type EntertainmentPreset,\n'),
    ('  entertainmentRuleRemove: (id: string) => Promise<{ ok: boolean }>\n',
     """  entertainmentRuleRemove: (id: string) => Promise<{ ok: boolean }>
  /** 整组规则开关（一个组 = 一个品游项目）；skipped = 还没绑礼物所以开不起来的条数 */
  entertainmentGroupToggle: (
    group: string,
    on: boolean
  ) => Promise<{ ok: boolean; changed: number; skipped: number }>
  entertainmentPresetList: () => Promise<{
    presets: EntertainmentPreset[]
    groups: { group: string; total: number; enabled: number }[]
  }>
  entertainmentPresetSave: (preset: {
    id?: string
    name: string
    groups: string[]
  }) => Promise<{ ok: boolean; id?: string; error?: string }>
  entertainmentPresetRemove: (id: string) => Promise<{ ok: boolean }>
  entertainmentPresetApply: (
    id: string
  ) => Promise<{ ok: boolean; error?: string; on: number; off: number; skipped: number }>
"""),
    ("""  entertainmentRuleRemove: (id) =>
    ipcRenderer.invoke(Ipc.EntertainmentRuleRemove, id),""",
     """  entertainmentRuleRemove: (id) =>
    ipcRenderer.invoke(Ipc.EntertainmentRuleRemove, id),
  entertainmentGroupToggle: (group, on) =>
    ipcRenderer.invoke(Ipc.EntertainmentGroupToggle, group, on),
  entertainmentPresetList: () => ipcRenderer.invoke(Ipc.EntertainmentPresetList),
  entertainmentPresetSave: (preset) =>
    ipcRenderer.invoke(Ipc.EntertainmentPresetSave, preset),
  entertainmentPresetRemove: (id) =>
    ipcRenderer.invoke(Ipc.EntertainmentPresetRemove, id),
  entertainmentPresetApply: (id) =>
    ipcRenderer.invoke(Ipc.EntertainmentPresetApply, id),"""),
])

# ---------------- 导入时填分组（品游项目名）----------------
ok &= edit('src/main/ipc.ts', [
    ("""          remark: `品游 ${project}`,""",
     """          remark: `品游 ${project}`,
          group: project,            // ★分组 = 项目名：主播按项目整组开关、存预设"""),
    ("""        remark: info ? `品游项目：${info.videos} 个视频${info.paired ? `，其中 ${info.paired} 个带动作` : '（纯视频）'}` : '品游项目'""",
     """        group: name,          // ★分组 = 项目名
        remark: info ? `品游项目：${info.videos} 个视频${info.paired ? `，其中 ${info.paired} 个带动作` : '（纯视频）'}` : '品游项目'"""),
])

print('\n' + ('全部写入完成' if ok else '★有锚点没对上，先看上面的提示'))
sys.exit(0 if ok else 2)
