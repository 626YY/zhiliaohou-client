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
(dest/'CHANGELOG.md').write_text('# 更新记录\n\n## 0.3.70（2026-10-08）\n\n- 特色整蛊全部数值参数取消人为上限：参数规格的 `max` 改为防爆上限（计数 / 秒 1e6、毫秒 1e7、大小 400%、缩放 1000%、速度 10000%、同屏上限 20000），`sliderMax` 保留原来的常用范围给滑杆，输入框可以超出；玩法代码里写死的上限同步放开（扔垃圾单件 300px、垃圾桶 60% 宽、来电 600 秒、拍击半径 40% 等）。有天然边界的（音量、不透明度、灵敏度、0~500 音量刻度、抠图、视频占比、语速）不变。开奖画面的锣后停顿 / 念完停留 / 画面大小 / 排队上限同样处理。\n- 抓子弹：子弹比窗口还高时空着的列照样落一颗，不再永远排队。\n- 拆炸弹：落稳当下先滴一声（之后按原节奏越滴越急）；飘字按实测宽度排，旁边放不下先缩字号（最小六成）再夹回画面内。\n- `tools/verify-special-games.mjs` 新增「每个数值项填到防爆上限」检查（生成、点击、推帧、清场后画布全空）；`tools/soak-special.mjs` 随机改设置时九成取常用范围、一成取到上限。\n\n## 0.3.69（2026-10-08）\n\n- 新特色整蛊「拆炸弹」：四种炸弹（定时 / 卡通 / 礼物 / 超级），每根线暗藏拆除 / 加速 / 雷管 / 哑线 / 扣时效果（错线比例可调），剪下去停顿、心跳再揭晓；倒计时滴声越到最后越急；观众可送礼减时或帮拆；爆炸随机抽惩罚，满屏黑灰按住鼠标擦干净。炸弹、线、黑灰全部程序绘制，音效全部本地合成。\n- 新特色整蛊「礼物拔河」：观众送礼拉绳、主播狂点或按空格往回拽，限时判输赢；观众赢了主播被砸奶油 / 鸡蛋 / 番茄要擦干净，主播赢了放彩带。新增两玩法共用的「糊屏 + 按住擦干净」层（`src/main/special-games/wipe-layer.ts`）。\n- 下线「小新哎嘿」「音乐球」和锁链三款素材皮肤，老配置自动迁移（规则显示已下线、盲盒事件清理、皮肤回落霓虹）；特色整蛊素材全部换成原创图（素材目录仍不随源码分发）。\n- 当前游戏没装整蛊 mod 时，连接器使用客户端自带的一份在 `userData/connector` 运行（登录态、事件桥、礼物图、头像、本场统计都在这里）；自带 mod 清单默认下架，远端清单上架后才显示，没有可用游戏时隐藏游戏专用页面。\n- 直播窗口处理合并的鼠标移动点（`getCoalescedEvents`），快速划过时擦屏 / 挥刀 / 挥拍不丢点。\n- 盲盒默认事件库第 4 版（补两个新玩法）；特色整蛊动作支持自定义数量单位和开奖念法。\n\n## 0.3.68（2026-10-07）\n\n- 特色整蛊全面体检：切水果切开的水果不再被当成漏掉重抛（永远切不完）、不按住快速挥动也能切、漏掉的按设置再抛几次；顶金币砖块顶空消失、落地金币按设置自动收走、竖屏下金币能落定、消失的砖块不再吞点击。\n- 抓鸭子 / 扔粑粑 / 扔垃圾：攒批计时不再被连续礼物清零（排队的照常落下）、清空重置发射排期；改窗口大小（切竖屏）时场上物体挪回画面；拖出窗口不丢；落点避开垃圾桶。\n- 声控玩法：打完当帧关麦克风；拍手声控模式麦克风不可用时鼠标兜底；挥拍按真实时间测速；符咒封印麦克风打不开时可点画面破封。\n- 粉丝来电 / 来视频放不出来或卡住时保底挂断、关闭排队时清旧队列；音乐球「播放中又点歌」默认排队接着放；锁链失焦时不再卡住空格。\n- 新增 `tools/verify-special-playthrough.mjs`（按真实玩法玩到结束，横屏 / 竖屏 / 中途切竖屏）、`tools/soak-special.mjs`（特色整蛊窗口长跑压力）；页面测试钩子 `__frameStep`。\n\n## 0.3.67（2026-10-07）\n\n- 麦克风玩法（声控拍蚊子、符咒封印、手势拍蚊子 / 苍蝇的声控模式）的识别重做：32ms / 60ms 分块、16 kHz，音量刻度 (块有效值/32768)^0.28×300，拍手 = 起音门槛 + 灵敏度规则 + 掌声模型；新增「识别方式：识别拍手 / 只看音量」。\n- 特色整蛊详情页新增「麦克风测试」：实时音量条 + 阈值 / 分档刻度线 + 认出提示，点开始才开麦克风。\n- 「全部清屏」：每个玩法当场无声收干净（垃圾桶有东西要收时才显示、刀光只在有水果时画、锁链 / 符咒不演收场动画），横幅和正在放的音效一起收掉。\n- 下架的 mod 在没安装的电脑上不再出现在任何游戏选择里（已安装的照常可用）。\n- 新增 `tools/verify-special-clear.mjs`、`tools/verify-mic-detect.mjs`、`tools/verify-mic-games.mjs`、`tools/verify-mic-test-ui.mjs`、`tools/verify-delisted-game.mjs`。\n\n## 0.3.66（2026-10-07）\n\n- 免费模式：平台那边的拒绝 / 登录失效不再关闭输出、不退出账号（静默重登，连不上就转本机登录、之后自动连回）；只有主播自己退出 / 切换账号才关输出。\n- 服务器连不上时直接本机登录进入软件；注册收不到验证码时也能直接进入；恢复后自动连回并补报本机绑定的直播间。\n- 整蛊台 AI 语音播报：时间插件、转盘、九宫格、礼物触发、积分心愿、大哥进场、计数挑战、加班器出结果时念一句；每个模块页头一个开关（默认关），配了视频 / 声音的默认不念；设置页统一调声音、语速、音量，总开关同时管特色整蛊开奖配音。\n- 特色整蛊：礼物直接触发默认敲锣开奖（来电 / 来视频除外）；礼物联动每行「触发一次」；整蛊遥控页只放游戏整蛊。\n- 按键 / 鼠标 / 文本等 PowerShell 动作排队执行（限并发、超时结束），连刷礼物时不再瞬间冒出大量进程；出错提示改为主窗口内提示。\n- 新增 `tools/verify-free-always-on.mjs`、`tools/verify-announce.mjs`、`tools/test-ps-runner.mjs`。\n\n## 0.3.65（2026-10-07）\n\n- 特色整蛊盲盒开奖：锣声 + 「锁链+5」大字 + AI 配音（微软 Edge 在线朗读语音），连送逐条开奖；「开奖画面与配音」设置可调声音、语速、音量、位置、大小等。\n- 默认盲盒事件扩到 392 个（加减照时间盲盒那排数，乘除 2 / 3），常用句子的配音事先生成随安装包分发；事件可试听、改台词。\n- 盲盒事件可挂开奖视频，直播窗口里 WebGL 抠绿（自动从四角取底色）；每个玩法可按文件名批量导入视频。\n- 奖池 / 事件库按玩法分组折叠；「特色整蛊」窗口动画帧率上限（默认 30 帧）。\n- 新增 `tools/verify-special-reveal.mjs`、`tools/verify-special-box-upgrade.mjs`、`tools/gen-special-voice.mjs`。\n\n## 0.3.64（2026-10-05）\n\n- 特色整蛊 17 个玩法合成一个窗口「特色整蛊」：每个玩法一层画布、用到才加载，点击按图层归属（点中谁算谁），来电 / 来视频在最上层，计数面板自动排开；6 个玩法同时运行时 CPU 约为分开窗口的四分之一。\n- 特色整蛊盲盒改成「事件库 + 每个礼物勾选奖池」（和时间盲盒一致），连送多份一次抽完。\n- 新增 `tools/verify-special-window.mjs`（合并窗口回归）与 `tools/bench-special-window.mjs`（分开窗口 / 合并窗口性能对比）。\n\n## 0.3.63（2026-10-05）\n\n- 新增「特色整蛊」：17 个叠在直播画面上的互动玩法，接入礼物触发、转盘、九宫格、时间盲盒、整蛊遥控与基础引导；可直接上手玩的预览舞台。\n- 特色整蛊盲盒、固定/随机数量、横屏/竖屏一键切换、锁链五套程序化新皮肤、窗口快捷开关、基础/高级分层。\n- 礼物触发新增「游戏整蛊」动作；连接器支持哔哩哔哩直播间。\n- 萌宠时间皮肤按设计稿重排。\n- 说明：特色整蛊的图片、音效和视频素材（`assets/special-games/`）不随源码分发。\n\n## 0.3.62（2026-09-20）\n\n- 首次公开客户端源码快照。\n- 新增八套萌宠时间皮肤，与实时礼物菜单整套结合。\n- 独立配件轻摆、菜单伸缩、长文字与计时格式适配。\n- 保留客户端、连接器和通用开发验收工具，补充许可与构建说明。\n',encoding='utf-8')

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
# 2026-10-07 用户要求：公开快照里不能出现写代码用的那个 AI 助手的名字（提交说明里也不要带它的署名）——出现就停下。
# 只查进公开仓库的文件（复制过去的 + 脚本生成的）；导出目录里本地装的 node_modules 不进仓库，不查。
# 这个脚本自己也在快照里，所以要查的词用字符码拼出来，不在文件里写出原词。
NEEDLE=bytes([99,108,97,117,100,101])
mentions=[]
for rel in sorted(keep):
    p=dest/rel
    if not p.is_file():continue
    try:
        if NEEDLE in p.read_bytes().lower():mentions.append(rel)
    except OSError:pass
if mentions:raise RuntimeError('公开快照里出现了那个 AI 助手的名字，先改掉再导出：'+', '.join(mentions))
print('SOURCE SNAPSHOT PREPARED',len(copied),'files;',len(excluded),'excluded')
