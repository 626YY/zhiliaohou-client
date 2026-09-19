// 必须是 index.ts 第一个 import：每个挂件模块在被 import 时就各自挂一个 app.on('before-quit') 收尾，
// 超过 10 个 Node 会打「疑似内存泄漏」警告。放宽上限要在那些模块加载之前执行，所以单独成文件放最前面。
import { app } from 'electron'
import { getSettings } from './settings'

app.setMaxListeners(60)

// 直播伴侣的普通窗口捕获走 GDI：窗口要有一份 CPU 侧的画面才抓得到，全 GPU 合成的窗口
// 静止一会儿就会被采成黑屏。三档（改完重启生效）：
//   balanced   只关「GPU 合成」——显卡照样负责画（客户端不卡），合成回到 CPU，采集正常。默认。
//   compatible 连显卡绘制一起关，最保险也最吃 CPU（0.3.40 及以前的行为）。
//   hardware   全交给显卡，最快；采集端得支持 GPU 窗口，否则挂件会是黑的。
const renderMode = getSettings().renderMode
if (renderMode === 'compatible') app.disableHardwareAcceleration()
else if (renderMode !== 'hardware') app.commandLine.appendSwitch('disable-gpu-compositing')

// 绿幕抠像依赖稳定的 RGB 值，避免显示器 ICC 将纯绿映射成另一种颜色。
if (process.platform === 'win32' && !app.commandLine.hasSwitch('force-color-profile')) {
  app.commandLine.appendSwitch('force-color-profile', 'srgb')
}

// 没有音轨的视频在窗口被别的窗口完全挡住或最小化时，会被 Chromium 当成「后台视频」暂停：播到一半停住、
// 永远不触发播完，排队的素材全堵在它后面（2026-09-11 主播实测「积压二十条一条没播、卡最后一帧」，
// tools/verify-box-gift-stress.mjs 在隐藏窗口里稳定复现）。绿幕窗口常年被直播伴侣盖着，这个优化必须关；
// 带音轨的视频本来就不受影响。
// 进程模式（设置页「进程模式」，改完重启生效）。lean = Chromium process-per-site，所有本地文件页面合并进一个渲染进程：
// 空闲时工作集 1212MB → 453MB，但礼物密集时「私有提交内存」（系统 OOM 真正看的数）反而更高
// （6 分钟连轰平均 1133MB / 峰值 1391MB，独立进程 703MB / 903MB，tools/soak-stress.mjs 2026-09-19 对照），
// 且一个页面崩全部一起崩。所以默认 stable（每窗口独立进程），lean 只留给挂件多、礼物少的直播；
// 页面自动重载（exit-diag.ts）两种模式都兜底，lean 下反复崩会自动切回 stable。
if (getSettings().processMode === 'lean') app.commandLine.appendSwitch('process-per-site')
// 前进后退页面缓存：绿幕每条视频都是整页加载，Chromium 会把刚离开的页面整份缓存起来等「后退」，我们永远不后退，
// 纯属白占（实测关掉平均少 18%、停轰后少 23%）。默认关，设置里可开回来。

app.commandLine.appendSwitch('disable-background-media-suspend')
// 被别的窗口完全盖住的窗口，Windows 版 Chromium 会按「遮挡」当成隐藏处理（绿幕窗口常年在直播伴侣后面）；
// 关掉遮挡计算，让它们始终按可见窗口渲染、播放。渲染进程也不降优先级。
// ★同一个开关只能给一次（后给的会盖掉前面的），所有 disable-features 在这里合并
const disabledFeatures = ['CalculateNativeWinOcclusion']
if (getSettings().pageBackForwardCache !== true) disabledFeatures.push('BackForwardCache')
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
