# -*- coding: utf-8 -*-
"""图书管理员整蛊（DarkMage）安装包：在上一版 zip 的基础上补齐 UE4SS 运行时，装完即用。

上一版（0.8.1）只带 ue4ss/Mods/DarkMage，INSTALL.txt 要求主播「需已安装 UE4SS」——主播机器上根本没有，
装完游戏里什么都不会发生。DON'T SCREAM 的包是带运行时的（dwmapi.dll + ue4ss/），两款游戏用的 UE4SS 同一版本
（sha256 一致），这里从图书管理员游戏目录取同一套文件。

用法：python tools/make-darkmage-zip.py <上一版zip> <游戏Binaries/Win64目录> <输出zip>
"""
import io, os, re, sys, zipfile, hashlib, json

prev_zip, win64, out = sys.argv[1], sys.argv[2], sys.argv[3]
RUNTIME_FILES = ['dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/UE4SS-settings.ini', 'ue4ss/LICENSE']
# UE4SS 内置 mod：按游戏目录 mods.txt 里启用的那几项带上（DarkMage 自己只依赖 Scripts 里的 json/ingame_hud/umg_hud，
# 控制台/蓝图加载这几项是游戏目录里一直开着的环境，照搬以免行为差异），外加 shared 库与 Keybinds。
BUILTIN_MODS = ['shared', 'Keybinds', 'ConsoleEnablerMod', 'ConsoleCommandsMod', 'CheatManagerEnablerMod', 'BPModLoaderMod', 'BPML_GenericFunctions']
MODS_TXT = """CheatManagerEnablerMod : 1
ConsoleCommandsMod : 1
ConsoleEnablerMod : 1
SplitScreenMod : 0
LineTraceMod : 0
BPML_GenericFunctions : 1
BPModLoaderMod : 1
KismetDebuggerMod : 0
EventViewerMod : 0
ActorDumperMod : 0
jsbLuaProfilerMod : 0

; Built-in keybinds, do not move up!
Keybinds : 1
"""
INSTALL_TXT = """把本 zip 解压到 Librarian-Win64-Shipping.exe 所在目录（Librarian/Binaries/Win64）。
包里已带 UE4SS 运行时（dwmapi.dll + ue4ss/），不用再单独装任何东西。
知了猴整蛊台 → 游戏库 → 图书管理员整蛊 → 安装，会自动做这一步。
装好后在知了猴整蛊台选择游戏「图书管理员」即可映射礼物 / 连直播间。
"""
SKIP_SUFFIX = ('.bak', '.log', '.dmp', '.pyc')
def skip(name):
    low = name.lower()
    return '__pycache__' in low or any(low.endswith(s) or ('.bak-' in low) for s in SKIP_SUFFIX)

src = zipfile.ZipFile(prev_zip)
seen = set()
zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6)
# 1) 上一版内容原样带过来（INSTALL.txt 换新）
# ★脚本文件与默认配置以游戏目录里的现行版本为准（0.8.3 起：main.lua 有新法术、config.json 有新参数），其余照搬上一版
REFRESH_PREFIX = 'ue4ss/Mods/DarkMage/Scripts/'
# 2026-09-13 起连接器三件也以游戏目录为准：精简连接器补了进场/弹幕行、douyin_room 换 09-13 版（以前只刷 Scripts/config/说明，
# 0.8.5 zip 里的连接器一直是 08 月的旧版）
REFRESH_FILES = ('ue4ss/Mods/DarkMage/config.json', 'ue4ss/Mods/DarkMage/说明.txt',
                 'ue4ss/Mods/DarkMage/connector.py', 'ue4ss/Mods/DarkMage/douyin_room.py', 'ue4ss/Mods/DarkMage/sign.js')
refreshed = []
for info in src.infolist():
    if info.is_dir() or skip(info.filename): continue
    if info.filename == 'INSTALL.txt': continue
    if info.filename in seen: continue   # 上一版 zip 里自身的重复条目（0.8.3 带了 6 份重复）不再往下滚
    if info.filename.startswith(REFRESH_PREFIX) or info.filename in REFRESH_FILES:
        disk = os.path.join(win64, info.filename.replace('/', os.sep))
        if os.path.isfile(disk):
            zout.write(disk, info.filename); seen.add(info.filename); refreshed.append(info.filename); continue
    zout.writestr(info, src.read(info.filename)); seen.add(info.filename)
print('refreshed from game dir:', refreshed)
zout.writestr('INSTALL.txt', INSTALL_TXT.encode('utf-8')); seen.add('INSTALL.txt')
# 2) 运行时
for rel in RUNTIME_FILES:
    p = os.path.join(win64, rel.replace('/', os.sep))
    if not os.path.isfile(p): raise SystemExit('缺运行时文件：' + p)
    if rel in seen: continue   # 上一版 zip 里已带（每代重复写会把包越滚越大：0.8.4 时 UE4SS.dll 重了三份）
    zout.write(p, rel); seen.add(rel)
# 3) 内置 mod 目录
for m in BUILTIN_MODS:
    d = os.path.join(win64, 'ue4ss', 'Mods', m)
    if not os.path.isdir(d): raise SystemExit('缺内置 mod：' + d)
    for root, _, files in os.walk(d):
        for f in files:
            full = os.path.join(root, f); rel = os.path.relpath(full, win64).replace(os.sep, '/')
            if skip(rel) or rel in seen: continue
            zout.write(full, rel); seen.add(rel)
# ★★ 3.5) 游戏目录 Scripts/ 下的【新文件】也要带上。上面那圈是按【上一版 zip 的条目】刷新的，
#   新增的 .lua 一个都进不来 —— 0.8.5 加 Scripts/zlpaths.lua 时就这么漏了一次，而 main.lua 里
#   require("zlpaths")，那个包装上去所有人的 mod 都会崩（比它要修的 bug 还严重）。
scripts_dir = os.path.join(win64, 'ue4ss', 'Mods', 'DarkMage', 'Scripts')
added_new = []
if os.path.isdir(scripts_dir):
    for f in sorted(os.listdir(scripts_dir)):
        full = os.path.join(scripts_dir, f)
        rel = REFRESH_PREFIX + f
        if not os.path.isfile(full) or skip(rel) or rel in seen: continue
        zout.write(full, rel); seen.add(rel); added_new.append(rel)
if added_new: print('new from game dir:', added_new)
if 'ue4ss/Mods/mods.txt' not in seen: zout.writestr('ue4ss/Mods/mods.txt', MODS_TXT.encode('utf-8')); seen.add('ue4ss/Mods/mods.txt')
mods_json = os.path.join(win64, 'ue4ss', 'Mods', 'mods.json')
if os.path.isfile(mods_json) and 'ue4ss/Mods/mods.json' not in seen: zout.write(mods_json, 'ue4ss/Mods/mods.json')
zout.close()
# ★收尾自检：每个 require("X") 都要在包里有 Scripts/X.lua，否则 mod 一加载就报错
with zipfile.ZipFile(out) as chk:
    names = set(chk.namelist())
    need = set()
    for n in [x for x in names if x.startswith(REFRESH_PREFIX) and x.endswith('.lua')]:
        body = chk.read(n).decode('utf-8', 'replace')
        need |= set(re.findall(r"""require\(\s*['"]([A-Za-z0-9_./-]+)['"]\s*\)""", body))
    missing = sorted(m for m in need if REFRESH_PREFIX + m + '.lua' not in names)
    if missing: raise SystemExit('！包里缺 require 的模块：%s（打包漏了新文件）' % missing)
    print('require 自检通过：%s' % sorted(need))
size = os.path.getsize(out); sha = hashlib.sha256(open(out, 'rb').read()).hexdigest()
print(json.dumps({'out': out, 'entries': len(seen) + 2, 'size': size, 'sha256': sha}, ensure_ascii=False))
