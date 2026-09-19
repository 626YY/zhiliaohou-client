import type {GuideLocator,GuideTarget} from './guideNavigation'
export type {GuideTarget}
export type WalkthroughStep={instruction:string;target:GuideTarget}
const button=(match:string):GuideLocator=>({kind:'button',match})
const field=(match:string):GuideLocator=>({kind:'field',match})
const text=(match:string):GuideLocator=>({kind:'text',match})
// any：按顺序取第一个在页面上找得到的（同一步在不同状态下对应不同控件，例如向导走到不同步骤）
const any=(...locators:GuideLocator[]):GuideTarget=>({any:locators})
export const FEATURE_WALKTHROUGHS:Record<string,[WalkthroughStep,WalkthroughStep,WalkthroughStep]>={
  gift:[{instruction:'点“新增规则”，选视频、音效或快捷键。向导会一次问一件事，不需要先填参数表。',target:button('^新增规则$')},{instruction:'跟着向导选择素材，再决定“设置动作”或“跳过”，最后选择触发礼物。都从“新增规则”进入。',target:button('^新增规则$')},{instruction:'在向导最后一步点“完成并启用”。视频还要点“准备播放窗口”，再到直播软件添加采集来源。',target:button('^新增规则$')}],
  transparent:[{instruction:'先填菜单标题。已配好礼物规则时，可以直接点“从礼物规则生成”。',target:field('^菜单标题$')},{instruction:'一行填一条，例如“小心心 = 屏幕反转”，再点“生成列表”。',target:field('^批量填写$')},{instruction:'检查右边的预览，满意后点“导出透明 PNG”，再添加到直播画面里。',target:button('导出透明 PNG|导出.*PNG|保存.*PNG|导出图片')}],
  wheel:[{instruction:'直接改每个奖项的名称；想给奖项配视频或声音，再点它旁边的“动作”。',target:field('^奖项 1 名称$')},{instruction:'填观众要送的礼物，再打开“收到礼物自动转”。不指定礼物时，任何礼物都可能触发。',target:field('^触发礼物$')},{instruction:'点“转盘窗口”打开画面，再到直播软件添加这个窗口。点“转起来”会试抽并执行中奖动作。',target:button('^转盘窗口$|^关闭窗口$')}],
  nine:[{instruction:'把格子里的文字改成奖项名称，中间的按钮用来抽奖。',target:field('^九宫格奖项 1$')},{instruction:'选择触发礼物并打开“收到礼物自动转”，观众送这份礼物才会自动抽。',target:field('^触发礼物$')},{instruction:'点“九宫格窗口”打开画面，再在直播软件添加窗口采集。',target:button('^九宫格窗口$|^关闭窗口$')}],
  effects:[{instruction:'在“默认特效”里选一种动画，先用默认大小和速度即可。',target:field('^默认特效$')},{instruction:'想让特定礼物用不同动画，就在下面填礼物名、选择特效并添加。',target:field('^礼物名$')},{instruction:'点“开启窗口”准备画面，再点下面某个动画试播，最后添加到直播采集。',target:button('^开启窗口$|^关闭窗口$')}],
  progress:[{instruction:'先填标题和目标积分，例如“今日目标”与“1000”。',target:field('^目标积分$')},{instruction:'选择怎么计算积分。也可以给某个礼物单独填写每个几分。',target:field('^计分方式$')},{instruction:'点“积分条窗口”打开画面，再添加到直播采集；心愿窗口在下面，可以分别使用。',target:button('^积分条窗口$|^关闭窗口$')}],
  green:[{instruction:'点“选择”挑视频或图片。也可以先不选文件，直接开一个空窗口，用来接收视频盲盒。',target:button('^选择$')},{instruction:'一个窗口通常就够用；想同时显示多路素材，再切换到其他编号。',target:button('^[1-4] 号')},{instruction:'点“打开 1 号窗口”，然后在直播软件添加窗口捕获并开启绿幕抠像。',target:button('打开 [1-4] 号窗口|关闭 [1-4] 号窗口')}],
  video:[{instruction:'点“选择”，从电脑选一个视频。没选文件时，开启按钮不可用。',target:button('^选择$')},{instruction:'需要暖场反复播放时打开“循环播放”；不需要反复播放就关闭它。',target:text('^循环播放$')},{instruction:'点“开启主窗口”，再将它添加到直播采集。VIP 窗口是另一路独立播放。',target:button('^开启主窗口$|^关闭主窗口$|^开启VIP窗口$|^关闭VIP窗口$')}],
  time:[{instruction:'下面的向导先问时长：点一个常用分钟数，或自己填分钟，再点“下一步”。第一次可以直接选 5 分钟。',target:any(field('^倒计时分钟$'),button('^下一步$'),text('^跟着设置倒计时$'))},{instruction:'点“下一步”后向导会问是否要礼物加减时间；要就点“设置礼物”，不需要就点“跳过”，原有设置会保留。',target:any(button('^设置礼物$'),button('^下一步$'),text('^跟着设置倒计时$'))},{instruction:'保存后点“开启倒计时窗口”。也可以直接点“开启现有倒计时”用已保存的设置，看到窗口后再添加直播采集。',target:button('^开启现有倒计时$|^关闭倒计时窗口$|^开启倒计时窗口$')}],
  challenge:[{instruction:'先选计时或计数，再填标题和初始数字。计时填秒数，计数填起始数量。',target:field('^初始数字$|^初始时间（秒）$')},{instruction:'礼物先显示成一条条摘要。点那一条的“编辑”，修改礼物名和它的影响。',target:button('^编辑$|^收起$')},{instruction:'点页头的“开启”，挑战画面就会出现；再到直播软件添加这个窗口。',target:button('^开启$|^关闭$')}],
  overtime:[{instruction:'先填加班标题和初始秒数；例如 600 是 10 分钟。',target:field('^加班初始（秒）$')},{instruction:'在礼物摘要旁点“编辑”，设置送这个礼物时增加或减少多少时间。',target:button('^编辑$|^收起$')},{instruction:'点页头“开启”，加班器窗口就能显示。再把它添加到直播采集里。',target:button('^开启$|^关闭$')}],
  marquee:[{instruction:'先决定飘什么：打开“礼物”或“弹幕”开关。暂时不筛选关键词也能使用。',target:text('^礼物$')},{instruction:'在“外观”里选样式和贴在屏幕哪个角，其他外观可以先用默认值。',target:field('^样式$')},{instruction:'点“开启飘屏”，用“试一试”看效果，再添加到直播采集。',target:button('^开启飘屏$|^关闭飘屏$')}],
  entrance:[{instruction:'先选横幅样式；可以只用横幅，不一定要准备视频。',target:field('^横幅样式$')},{instruction:'需要指定某类观众触发时，点“添加规则”，按规则选择范围和素材。',target:button('^添加规则$')},{instruction:'点“开启横幅窗口”，再用“模拟进场”检查效果；准备好后添加到直播采集。',target:button('^开启横幅窗口$|^关闭横幅窗口$')}],
  keyboard:[{instruction:'在“样式”里选卡通或专业，其他选项可以保持默认。',target:field('^样式$')},{instruction:'选好“配色”。窗口开启后，在其他软件按键即可看到显示效果。',target:field('^配色$')},{instruction:'点“开启窗口”显示按键，再添加到直播采集。“紧急恢复键盘”只在按键失灵时使用。',target:button('^开启窗口$|^关闭窗口$')}],
  sticker:[{instruction:'这是自动统计页，不需要先配置。点下面按钮会带你去“直播连接器”，连上直播间后收到的礼物会自动记录。',target:{route:'/connector'}},{instruction:'回到这里查看按礼物名称汇总的次数，离开页面也会继续统计。',target:text('^礼物贴纸统计$')},{instruction:'需要开始一场新统计时再点“清零”；平时不用操作，引导也不会替你清。',target:{kind:'button',match:'^清零$',focus:false}}],
  danmaku:[{instruction:'当前支持抖音。先在输入框填写自己的直播间号或地址。',target:field('^抖音直播间号 / 房间地址$')},{instruction:'核对直播间信息，确保账号已经完成需要的登录和授权。',target:field('^抖音直播间号 / 房间地址$')},{instruction:'点“连接”，状态显示已连接后再检查消息。这里不会替你开始直播。',target:button('^连接$|^断开$')}],
  protect:[{instruction:'先选择保护期间要暂停什么。可保持默认，直接开启保护。',target:text('^保护时跳过当前整蛊$')},{instruction:'想在保护期间播放视频，再打开“保护时播放视频”并选择文件；不需要可以跳过。',target:text('^保护时播放视频$')},{instruction:'点“开启保护”，需要恢复时点“结束保护”。保护暂停互动，不会阻止平台收礼。',target:button('^开启保护$|^结束保护$')}],
  tools:[{instruction:'先选要用的工具。“模拟事件”可以用来在本机测试，不需要真实送礼。',target:field('^送礼人$')},{instruction:'填测试礼物和个数。先打开要看的效果窗口，测试消息才有对应画面。',target:field('^礼物$')},{instruction:'点“送礼物”发送一份本机模拟事件，已启用的规则会照常执行。',target:button('^送礼物$')}],
  console:[{instruction:'这是手动操作页，不必先填一整套配置。需要暂停互动时，点“暂停整蛊”。',target:button('^暂停整蛊$|^恢复整蛊$')},{instruction:'需要发送文字时在“文本内容”填写内容，再选择发送或粘贴。',target:field('^文本内容$')},{instruction:'“发送文本”会把文字真的打进当前窗口。每个操作旁的按钮都会实际执行，请按需要使用。',target:button('^发送文本$|^粘贴文本$')}],
  obs:[{instruction:'用直播伴侣的主播点“打开直播伴侣”；显示未找到时先点“选择目录”指向安装位置。用 OBS 的主播看下一步。',target:any(button('^打开直播伴侣$|^已打开$|^启动中'),button('^选择目录$'))},{instruction:'用 OBS 时，先在 OBS 里开启远程接口，再点“连接 OBS”。只用直播伴侣可以跳过这一步。',target:button('^连接 OBS$|^断开$|^连接中')},{instruction:'“输出窗口总在最前”决定挂件是否压在游戏画面上。连接 OBS 后，下面会列出可开关的滤镜。',target:text('^输出窗口总在最前')}]
}
