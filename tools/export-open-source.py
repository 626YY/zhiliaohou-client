from pathlib import Path
import hashlib,json,shutil,subprocess,zipfile,yaml

root=Path.cwd().resolve()
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
(root/'output/open-source-audit').mkdir(parents=True,exist_ok=True)
dest=root/'output/open-source/zhiliaohou-client'
marker=dest/'.prepared-by-zhiliaohou-export'
if dest.exists() and any(dest.iterdir()) and not marker.exists():
    raise RuntimeError('Refusing to overwrite an unrelated export directory')
if (dest/'.git').exists() and subprocess.check_output(['git','-C',str(dest),'status','--porcelain'],text=True).strip():
    raise RuntimeError('Commit or save changes in the existing source export before refreshing it')
dest.mkdir(parents=True,exist_ok=True)
marker.write_text('Managed source export for 626YY/zhiliaohou-client\n',encoding='utf-8')
copied=[];excluded=[]
def copy(relative):
    source=root/relative
    target=dest/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(source,target)
    copied.append(str(relative).replace('\\','/'))

root_files=['package.json','package-lock.json','electron.vite.config.ts','postcss.config.js','tailwind.config.js','tsconfig.json','tsconfig.node.json','tsconfig.web.json','.npmrc','.nvmrc','LICENSE','README.md','THIRD_PARTY_NOTICES.md']
for name in root_files:copy(Path(name))
for folder in ['src','tools','connector-assets','assets/emoji72','public']:
    for source in sorted((root/folder).rglob('*')):
        if not source.is_file():continue
        if source.is_symlink() or not source.resolve().is_relative_to(root):raise RuntimeError('External symlink is not exportable')
        rel=source.relative_to(root)
        posix=rel.as_posix()
        if '__pycache__' in rel.parts or '.bak' in source.name or source.suffix in ['.pyc','.log','.zip','.exe','.dll','.pdb']:
            excluded.append(posix);continue
        if posix.startswith('src/renderer/public/mod-images/'):
            excluded.append(posix);continue
        if posix.startswith('tools/') and source.name.startswith(('publish','deploy')):
            excluded.append(posix);continue
        copy(rel)
for name in ['afterPack.js','icon.ico','icon.png','icon-256.png','license-policy.json','license-provider.json','更新说明.txt']:
    copy(Path('build')/name)

# 只取已提交（git HEAD）的 Mod 清单，工作区里还没提交、没上线的清单改动不进公开快照。
archive=root/'output/open-source-audit/catalog-head.zip'
subprocess.run(['git','archive','--format=zip','--output='+str(archive),'HEAD','mods-catalog'],check=True)
with zipfile.ZipFile(archive) as z:
    for item in z.infolist():
        name=item.filename
        if item.is_dir() or Path(name).suffix.lower() not in ['.json','.md','.txt']:
            continue
        target=(dest/name).resolve()
        if not target.is_relative_to(dest):raise RuntimeError('Invalid archive member')
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(z.read(item))
        copied.append(name)

# 保留平台礼物元数据，不在源码仓库再分发平台图片。
for source in (root/'gift-assets/douyin').glob('*.json'):copy(source.relative_to(root))
(dest/'gift-assets/douyin/README.md').write_text('# 礼物图\n\n本目录保留同步用元数据。平台礼物图片不随源码快照分发；需要时运行 `npm run gifts:sync`，并遵循素材来源的相关许可。\n',encoding='utf-8')

# 旧版时间框数据来自既有二进制资源；公开代码保留三种模式，使用本项目独立的矢量框替代这些位图。
(dest/'src/shared/countdownArt.ts').write_text('''// 公开源码快照的通用矢量替代框；原生产位图未再分发。
import { frameDataUri } from './countdownFrame'
export const COUNTDOWN_ART = {
  mode1_cyan: frameDataUri({variant:'paper',stroke:'#218cad',fill:'#e6f7fa',fillAlpha:1,strokeWidth:2,glow:false}),
  mode1_orange: frameDataUri({variant:'paper',stroke:'#b56733',fill:'#fff2de',fillAlpha:1,strokeWidth:2,glow:false}),
  mode2_frame: frameDataUri({variant:'paper',stroke:'#705989',fill:'#f2eafa',fillAlpha:1,strokeWidth:2,glow:false})
}
''',encoding='utf-8')

provider=root/'build/license-provider.json'
config=json.loads(provider.read_text(encoding='utf-8'))
assert not any('private' in key.lower() or 'secret' in key.lower() or 'password' in key.lower() or 'token' in key.lower() for key in config)
(dest/'build/license-provider.example.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

builder=yaml.safe_load((root/'electron-builder.yml').read_text(encoding='utf-8'))
builder['directories']['output']='release'
builder['win']['signAndEditExecutable']=False
builder.pop('publish',None)
builder['extraResources']=[x for x in builder['extraResources'] if x.get('from') not in ['ffmpeg','pyembed','output/local-card-mod']]
builder['extraResources'] += [{'from':'LICENSE','to':'LICENSE-client.txt'},{'from':'THIRD_PARTY_NOTICES.md','to':'THIRD_PARTY_NOTICES.md'}]
(dest/'electron-builder.yml').write_text(yaml.safe_dump(builder,allow_unicode=True,sort_keys=False),encoding='utf-8')

ignore='''node_modules/
out/
output/
release/
release-latest/
.playwright-cli/
pyembed/
ffmpeg/
*.log
*.tsbuildinfo
**/__pycache__/
*.py[cod]
*.bak*
.env*
!.env.example
**/*cookie*.txt
**/*.key
**/auth.json
**/settings.json
**/*.sqlite3
.prepared-by-zhiliaohou-export
'''
(dest/'.gitignore').write_text(ignore,encoding='utf-8')
(dest/'.gitattributes').write_text('* text=auto\n*.png binary\n*.jpg binary\n*.ico binary\n*.ttf binary\n*.mp3 binary\n',encoding='utf-8')
(dest/'CHANGELOG.md').write_text('# 更新记录\n\n## 0.3.65（2026-10-07）\n\n- 特色整蛊盲盒开奖：锣声 + 「锁链+5」大字 + AI 配音（微软 Edge 在线朗读语音），连送逐条开奖；「开奖画面与配音」设置可调声音、语速、音量、位置、大小等。\n- 默认盲盒事件扩到 392 个（加减照时间盲盒那排数，乘除 2 / 3），常用句子的配音事先生成随安装包分发；事件可试听、改台词。\n- 盲盒事件可挂开奖视频，直播窗口里 WebGL 抠绿（自动从四角取底色）；每个玩法可按文件名批量导入视频。\n- 奖池 / 事件库按玩法分组折叠；「特色整蛊」窗口动画帧率上限（默认 30 帧）。\n- 新增 `tools/verify-special-reveal.mjs`、`tools/verify-special-box-upgrade.mjs`、`tools/gen-special-voice.mjs`。\n\n## 0.3.64（2026-10-05）\n\n- 特色整蛊 17 个玩法合成一个窗口「特色整蛊」：每个玩法一层画布、用到才加载，点击按图层归属（点中谁算谁），来电 / 来视频在最上层，计数面板自动排开；6 个玩法同时运行时 CPU 约为分开窗口的四分之一。\n- 特色整蛊盲盒改成「事件库 + 每个礼物勾选奖池」（和时间盲盒一致），连送多份一次抽完。\n- 新增 `tools/verify-special-window.mjs`（合并窗口回归）与 `tools/bench-special-window.mjs`（分开窗口 / 合并窗口性能对比）。\n\n## 0.3.63（2026-10-05）\n\n- 新增「特色整蛊」：17 个叠在直播画面上的互动玩法，接入礼物触发、转盘、九宫格、时间盲盒、整蛊遥控与基础引导；可直接上手玩的预览舞台。\n- 特色整蛊盲盒、固定/随机数量、横屏/竖屏一键切换、锁链五套程序化新皮肤、窗口快捷开关、基础/高级分层。\n- 礼物触发新增「游戏整蛊」动作；连接器支持哔哩哔哩直播间。\n- 萌宠时间皮肤按设计稿重排。\n- 说明：特色整蛊的图片、音效和视频素材（`assets/special-games/`）不随源码分发。\n\n## 0.3.62（2026-09-20）\n\n- 首次公开客户端源码快照。\n- 新增八套萌宠时间皮肤，与实时礼物菜单整套结合。\n- 独立配件轻摆、菜单伸缩、长文字与计时格式适配。\n- 保留客户端、连接器和通用开发验收工具，补充许可与构建说明。\n',encoding='utf-8')

# 源码里删掉的文件，公开快照里也删掉：上面只会覆盖和新增，删掉的组件留在公开仓库里会引用已经不存在的接口、编译不过。
# 只动 git 跟踪的文件（.git、node_modules 不碰），脚本自己生成的文件保留。
generated={'src/shared/countdownArt.ts','build/license-provider.example.json','electron-builder.yml','.gitignore','.gitattributes','CHANGELOG.md','gift-assets/douyin/README.md'}
keep=set(copied)|generated
removed=[]
if (dest/'.git').exists():
    for rel in subprocess.check_output(['git','-C',str(dest),'ls-files','-z'],encoding='utf-8').split('\0'):
        if rel and rel not in keep and (dest/rel).is_file():
            (dest/rel).unlink();removed.append(rel)
if removed:print('REMOVED',len(removed),'files no longer in source:',', '.join(removed))

report={'source':str(root),'destination':str(dest),'version':version,'files':len(copied),'excluded':excluded,'removed':removed,'transformations':['Current source snapshot without private Git history','Committed Mod metadata only; no Mod/game binary archives','Platform gift images and game promotional images excluded','Production deployment tools excluded','Legacy extracted bitmap countdown frames replaced with independently authored SVG frames','Public build configuration excludes unavailable optional binaries and private publishing destination','Public keys retained; no signing private keys or account data included']}
(root/'output/open-source-audit/export-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SOURCE SNAPSHOT PREPARED',len(copied),'files;',len(excluded),'excluded')
