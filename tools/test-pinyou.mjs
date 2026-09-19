import assert from 'node:assert/strict'
import { convertPinyouTable, triggerFromName, keyToHoldName, parsePinyouScript, extractJsonObjects, findGiftTable, findGiftTables } from '../src/shared/pinyou.ts'
import { ruleActionLabel, splitVideoParam, joinVideoParam } from '../src/shared/entertainmentLabels.ts'
const table = {
  '点赞触发(1000)': { 动作: { 执行功能:'正常按键', 功能代码:'ESCAPE', 次数时间:'2次', 执行次数:'3', 优先等级:'即时', 执行倍数:'假' } },
  '3个小心心': { 动作: { 执行功能:'手游-自动前进', 次数时间:'3秒', 执行次数:'2', 优先等级:'插队', 执行倍数:'真' } },
  '鼠标右键弹起': { 动作: { 执行功能:'鼠标右键弹起', 次数时间:'', 执行次数:'1', 优先等级:'2' } },
  '视频': { 视频: { 视频目录:'绿幕', 视频文件:'x.mp4', 视频时间:'自动', 执行次数:'1', 优先等级:'1' } }
}
const p = convertPinyouTable(table,'x','x.py')
console.log(JSON.stringify(p.rules,null,2))
// 执行次数 3 × 次数时间 2次 = 每次触发敲 6 下（两层相乘，不是取大）
if (p.rules[0].triggerType !== 'like' || p.rules[0].times !== 1000 || p.rules[0].queueMode !== 'instant' || p.rules[0].repeat !== 6 || p.rules[0].multiply !== false) throw Error('like mapping')
const mobile = p.rules.find(r=>r.commandCmd==='mobile')
if (mobile?.giftName !== '小心心' || mobile.commandParam !== 'fwd|3000' || mobile.queueMode !== 'jump' || mobile.multiply !== true || mobile.times !== 3) throw Error('mobile mapping '+JSON.stringify(mobile))
const video = p.rules.find(r=>r.commandCmd==='video-play')
if (video?.commandParam !== '绿幕\\x.mp4|0') throw Error('video auto '+video?.commandParam)
if (keyToHoldName('ESCAPE') !== 'ESC' || triggerFromName('小心心×3').times !== 3) throw Error('aliases')
if (triggerFromName('点赞触发（1000）').times !== 1000) throw Error('fullwidth like')
const speed = convertPinyouTable({ '中速': { 动作: { 执行功能:'手游-自动转圈', 次数时间:'中等' } } }, 'speed', 'x.py')
if (speed.rules[0]?.commandParam !== 'turn|1000') throw Error('speed preset '+JSON.stringify(speed.rules))
const mousePoint = convertPinyouTable({ '坐标': { 动作: { 执行功能:'鼠标左键点击', 功能代码:'100,200' } } }, 'mouse', 'x.py')
if (mousePoint.rules[0]?.commandParam !== 'click-left|100|200') throw Error('mouse coordinates '+JSON.stringify(mousePoint.rules))
const parsed = parsePinyouScript('按键: Ctrl+A\n延时: 0.2秒\n长按 W,300毫秒\n鼠标: 右键\n发送文本: 测试\n弹起: W\n未知命令: abc')
if (parsed.commands.length !== 6 || parsed.commands[0].cmd !== 'key-sequence' || parsed.commands[1].param !== '200' || parsed.commands[2].cmd !== 'key-hold' || parsed.commands[5].cmd !== 'key-up' || parsed.unknown.length !== 1) throw Error('script parser '+JSON.stringify(parsed))
const withScript = convertPinyouTable({ '脚本礼物': { 动作: { 执行功能:'执行脚本', 执行脚本:'demo.脚本' } } }, 'script', 'x.py', { scriptContents: { 'demo.脚本': '按键: M\n延时: 10毫秒\n鼠标: 左键' } })
if (withScript.rules[0]?.commandCmd !== 'script-sequence' || !withScript.rules[0]?.commandParam?.includes('key-sequence')) throw Error('script import '+JSON.stringify(withScript))
const random = convertPinyouTable({ '随机': { 视频: { 视频目录:'盲盒', 视频文件:'随机播放' }, 动作: { 执行功能:'播放音效', 音效文件:'随机音效1' } } }, 'random', 'x.py', { videos:'C:\\video', sounds:'C:\\sound' })
if (!random.rules.some(r => r.commandCmd === 'video-random') || !random.rules.some(r => r.commandCmd === 'sound-random')) throw Error('random assets '+JSON.stringify(random))
const pre = convertPinyouTable({ '预播': { 视频: { 视频目录:'绿幕', 视频文件:'main.mp4', 预播文件:'pre.mp4' } } }, 'pre', 'x.py')
const preSteps = JSON.parse(pre.rules[0]?.commandParam || '[]')
if (pre.rules[0]?.commandCmd !== 'script-sequence' || preSteps[0]?.cmd !== 'video-play-wait' || preSteps[1]?.param !== '绿幕\\main.mp4|0') throw Error('preplay order '+JSON.stringify(pre.rules))
// 2026-09-06 审查清单补的用例
const lockT = convertPinyouTable({ '锁键盘': { 动作: { 执行功能:'锁定键盘', 次数时间:'3秒' } }, '锁屏': { 动作: { 执行功能:'锁定屏幕' } } }, 'lock', 'x.py')
if (lockT.rules.length !== 2 || lockT.rules[0].commandParam !== '全部|3000' || lockT.rules[1].systemCmd !== 'lock' || lockT.skipped.length !== 0) throw Error('lock mapping '+JSON.stringify(lockT))
const locks = convertPinyouTable({
  WSAD: { 动作: { 执行功能: '锁定WSAD', 次数时间: '5秒' } },
  WASD: { 动作: { 执行功能: '锁定 WASD 2 秒' } },
  减少: { 动作: { 执行功能: '减少锁定时间', 次数时间: '0.5秒' } },
  增加: { 动作: { 执行功能: '增加锁定时间', 功能代码: '2秒' } },
  解锁: { 动作: { 执行功能: '解锁' } },
  单键: { 动作: { 执行功能: '锁定按键', 功能代码: 'W', 次数时间: '2000毫秒' } },
  缺时长: { 动作: { 执行功能: '锁定键盘' } },
  零时长: { 动作: { 执行功能: '减少锁定时间', 次数时间: '0秒' } },
  保留Esc: { 动作: { 执行功能: '锁定按键', 功能代码: 'Esc', 次数时间: '1秒' } },
  鼠标: { 动作: { 执行功能: '锁定鼠标', 次数时间: '1秒' } }
}, 'locks', 'x.py')
const lockBy = Object.fromEntries(locks.rules.map(r => [r.giftName, r]))
for (const [name, param] of Object.entries({ WSAD: 'W,A,S,D|5000', WASD: 'W,A,S,D|2000', 减少: '调整|-500', 增加: '调整|2000', 单键: 'W|2000' })) {
  if (lockBy[name]?.commandCmd !== 'key-lock' || lockBy[name]?.commandParam !== param) throw Error('key-lock import '+name+' '+JSON.stringify(lockBy[name]))
}
if (lockBy['解锁']?.commandCmd !== 'key-unlock' || locks.skipped.length !== 4 || locks.rules.length !== 6) throw Error('unlock / invalid locks '+JSON.stringify(locks))
console.log('PASS key-lock import: all / WSAD / WASD / single / decrease / increase / unlock / invalid / Esc / mouse')
const likeT = convertPinyouTable({ '点赞触发': { 动作: { 执行功能:'正常按键', 功能代码:'M' } } }, 'like', 'x.py')
if (likeT.rules[0]?.triggerType !== 'like' || likeT.rules[0]?.multiply !== false) throw Error('like multiply '+JSON.stringify(likeT.rules))
const cjk = convertPinyouTable({ '怪键': { 动作: { 执行功能:'正常按键', 功能代码:'跳' } } }, 'cjk', 'x.py')
if (cjk.rules.length !== 0 || cjk.skipped.length !== 1) throw Error('cjk key should be skipped '+JSON.stringify(cjk))
const misc = convertPinyouTable({ '杀': { 动作: { 执行功能:'结束程序', 功能代码:'notepad.exe' } }, '图': { 动作: { 执行功能:'播放动图', 功能代码:'a.gif' } }, '停': { 动作: { 执行功能:'停止视频' } }, '跳': { 动作: { 执行功能:'自动跳跃（空格）' } }, '蹲': { 动作: { 执行功能:'自动下蹲（Ctrl）', 次数时间:'2秒' } }, '退': { 动作: { 执行功能:'大退（Alt+F4）' } } }, 'misc', 'x.py')
const by = Object.fromEntries(misc.rules.map(r => [r.giftName, r]))
if (by['杀']?.systemCmd !== 'kill' || by['图']?.commandCmd !== 'video-gif' || by['停']?.commandCmd !== 'video-stop') throw Error('misc cmds '+JSON.stringify(misc.rules))
if (by['跳']?.keySeq !== ' ' || by['蹲']?.commandParam !== 'CTRL,2000' || by['退']?.keySeq !== '%{F4}') throw Error('paren keys '+JSON.stringify(misc.rules))
const noSound = convertPinyouTable({ '哑': { 动作: { 执行功能:'播放音效' } } }, 's', 'x.py')
if (noSound.skipped.length !== 1) throw Error('empty sound should be reported')
if (keyToHoldName('CONTROL') !== 'CTRL' || keyToHoldName('左') !== 'LEFT') throw Error('hold aliases')
// P0-2: 引号与残缺包装不吞表；只认表，不把单条/设置当作方案。
const tiny = { '小心心': { 动作: { 执行功能: '正常按键', 功能代码: 'M' } } }
const tinyJson = JSON.stringify(tiny)
assert.deepEqual(extractJsonObjects(`说明 "花括号 { 不属于 JSON" ${tinyJson}`), [tinyJson])
assert.deepEqual(extractJsonObjects(`残缺 { 前导文字 ${tinyJson}`), [tinyJson])
assert.deepEqual(extractJsonObjects(`残缺 { ${tinyJson} }`), [tinyJson])
const quoted = JSON.stringify({ '礼物': { 动作: { 执行功能: '发送文本', 功能代码: '引号 " 与反斜线 \\ 与 } {' } } })
assert.deepEqual(extractJsonObjects(quoted), [quoted])
const wrapper = JSON.stringify({ '方案一': tiny, '方案二': { '关注': tiny['小心心'] } })
assert.deepEqual(extractJsonObjects(wrapper), [wrapper])
assert.equal(findGiftTables(JSON.parse(wrapper)).length, 2)
assert.equal(findGiftTables([tiny, tiny]).length, 2)
const mixedTables = findGiftTables({ ...tiny, '更多方案': [tiny, tiny] })
assert.equal(mixedTables.length, 3)
assert.ok(mixedTables.every(t => Object.keys(t).join(',') === '小心心'))
assert.equal(findGiftTable(tiny['小心心']), null)
assert.equal(findGiftTable({ '全局设置': { 视频: { 视频文件: '背景.mp4' } } }), null)
assert.equal(findGiftTable({ 动作: { 执行功能: '正常按键' }, 视频: { 视频文件: '背景.mp4' } }), null)
assert.deepEqual(findGiftTable(tiny), tiny)
assert.equal(findGiftTables({ '视频': { 视频: { 视频文件: 'main.mp4' } } }).length, 1)
const simultaneous = convertPinyouTable({ '连招': { 动作: { 执行功能: '同时按多个键', 功能代码: 'Ctrl+A+B' } } }, 'multi', 'x.py')
assert.equal(simultaneous.rules[0].keySeq, '^(ab)')
assert.match(simultaneous.notes[0].text, /顺序敲击/)
assert.equal(ruleActionLabel({ actionType: 'command', commandCmd: 'mobile', commandParam: 'fwd|3000' }), '手游动作 自动前进 3秒')
assert.equal(ruleActionLabel({ actionType: 'command', commandCmd: 'mouse', commandParam: 'click-right|0|200' }), '鼠标 右键单击（0, 200）')
console.log('PASS P0-2 parser: quoted braces / malformed prefix / maximal JSON / multiple plans / reject entry and settings / simultaneous-key note / Chinese labels')

// ===== 2026-09-06 二审：按品游 9.71「执行功能」全表 + 真实 .脚本 行格式逐条核对 =====
const conv = (table, roots) => convertPinyouTable(table, 't', 'x.py', roots)
const one = (fn, extra = {}, roots) => { const p = conv({ 礼: { 动作: { 执行功能: fn, ...extra } } }, roots); return { rule: p.rules[0], plan: p } }
// 1) 词序颠倒的锁定名：品游主分发里叫「键盘锁定 / 键盘解锁 / 鼠标锁定 / 鼠标解锁 / 锁定键盘鼠标」
assert.equal(one('键盘锁定', { 次数时间: '3秒' }).rule?.commandCmd, 'key-lock')
assert.equal(one('键盘锁定', { 次数时间: '3秒' }).rule?.commandParam, '全部|3000')
assert.equal(one('键盘解锁').rule?.commandCmd, 'key-unlock')
assert.equal(one('解锁WSAD').rule?.commandCmd, 'key-unlock')
assert.equal(one('锁定键盘鼠标', { 次数时间: '2秒' }).rule?.commandParam, '全部|2000')
assert.match(one('锁定键盘鼠标', { 次数时间: '2秒' }).plan.notes[0].text, /鼠标/)
for (const name of ['鼠标锁定', '鼠标解锁', '锁定鼠标', '解锁鼠标']) {
  const r = one(name, { 次数时间: '1秒' })
  assert.equal(r.rule, undefined, name + ' 不能导成鼠标点击')
  assert.match(r.plan.skipped[0].reason, /鼠标拦截/)
}
// 锁定屏幕 / 锁屏 仍然是锁 Windows；键盘锁定家族绝不落到它
for (const name of ['锁定键盘', '键盘锁定', '锁定WSAD', '减少锁定时间', '增加锁定时间', '锁定键盘鼠标']) {
  const r = one(name, { 次数时间: '1秒' })
  assert.notEqual(r.rule?.systemCmd, 'lock', name + ' 被导成了锁定屏幕')
}
assert.equal(one('锁定屏幕').rule?.systemCmd, 'lock')
assert.equal(one('自动关机').rule?.systemCmd, 'shutdown')
assert.equal(one('显示器息屏').rule?.systemCmd, 'displayoff')
// 2) 键盘弹起 → key-up
assert.deepEqual([one('键盘弹起', { 功能代码: 'Shift' }).rule?.commandCmd, one('键盘弹起', { 功能代码: 'Shift' }).rule?.commandParam], ['key-up', 'SHIFT'])
assert.equal(one('键盘弹起', { 功能代码: '跳' }).plan.skipped.length, 1)
// 3) 鼠标家族：坐标（含百分比）/ 双击坐标 / 长按坐标 / 拖动 / 多点 / 移到 / 左移右移不支持
assert.equal(one('鼠标点击坐标', { 功能代码: '80%,66%' }).rule?.commandParam, 'click-left|80%|66%')
assert.equal(one('鼠标双击坐标', { 功能代码: '100,200' }).rule?.commandParam, 'dblclick-left|100|200')
assert.equal(one('鼠标单击').rule?.commandParam, 'click-left')
assert.equal(one('鼠标单击', { 次数时间: '3次', 执行次数: '2' }).rule?.repeat, 6)
const hold = one('鼠标长按坐标', { 功能代码: '10,20', 次数时间: '2秒' })
assert.equal(hold.rule?.commandCmd, 'script-sequence')
assert.deepEqual(JSON.parse(hold.rule.commandParam).map(s => s.cmd + ':' + (s.param ?? '')), ['mouse:down-left|10|20', 'delay:2000', 'mouse:up-left'])
const drag = one('拖动A点到B点', { 功能代码: '10%,20%;30%,40%' })
assert.deepEqual(JSON.parse(drag.rule.commandParam).map(s => s.cmd + ':' + (s.param ?? '')), ['mouse:down-left|10%|20%', 'delay:100', 'mouse:move|30%|40%', 'delay:100', 'mouse:up-left'])
assert.equal(JSON.parse(one('点击A再拖动B到C', { 功能代码: '1,1 2,2 3,3' }).rule.commandParam).length, 7)
assert.equal(JSON.parse(one('鼠标点击多点坐标', { 功能代码: '1,1|2,2|3,3' }).rule.commandParam).filter(s => s.cmd === 'mouse').length, 3)
assert.match(one('拖动A点到B点', { 功能代码: '1,1' }).plan.skipped[0].reason, /需要 2 个坐标点/)
assert.equal(one('鼠标移到', { 功能代码: '50%,50%' }).rule?.commandParam, 'move|50%|50%')
assert.match(one('鼠标移到').plan.skipped[0].reason, /坐标/)
for (const name of ['鼠标左移', '鼠标右移', '中键单击', '滚轮向前']) assert.equal(one(name, { 功能代码: '20' }).rule, undefined, name)
assert.equal(one('鼠标操作', { 功能代码: '左键单击,80%,66%' }).rule?.commandParam, 'click-left|80%|66%')
// 4) 手游 / 游戏动作全表
const mobileNames = { 自动抬头: 'up', 自动低头: 'down', 原地转圈圈: 'turn', '原地转圈+开火': 'turnfire', '蹦迪-经典动作': 'dance', '蹦迪-偷袭': 'dance2', '自动前进（W）': 'fwd', '自动后退（S）': 'back', '自动左移（A）': 'lmove', '自动右移（D）': 'rmove' }
for (const [name, action] of Object.entries(mobileNames)) assert.equal(one(name, { 次数时间: '2秒' }).rule?.commandParam, action + '|2000', name)
assert.equal(one('蹦迪-左右探头（Q-E）').rule?.keySeq, 'qeqe')
assert.equal(one('自动趴下（Z）').rule?.keySeq, 'z')
assert.equal(one('自动丢枪（G）').rule?.keySeq, 'g')
assert.equal(one('自动下蹲（C）', { 次数时间: '1.5秒' }).rule?.commandParam, 'C,1500')
assert.equal(one('手游-自动跳跃（空格）').rule?.keySeq, ' ')
const hook = one('自动钩锁（Q+左键）')
assert.deepEqual(JSON.parse(hook.rule.commandParam).map(s => s.cmd + ':' + (s.param ?? '')), ['key-sequence:q', 'delay:100', 'mouse:click-left'])
assert.match(one('退出（CF房间）').plan.skipped[0].reason, /退出流程/)
assert.match(one('退出（CSGO）').plan.skipped[0].reason, /退出流程/)
// 5) 倒计时 / 计数 / 加班 / 转盘 / 播放视频 / 动作命令 / 品游插件
assert.deepEqual([one('倒计时加减', { 功能代码: '5~20' }).rule?.commandCmd, one('倒计时加减', { 功能代码: '5~20' }).rule?.commandParam], ['countdown-adjust', '5,20'])
assert.equal(one('倒计时减少', { 功能代码: '10' }).rule?.commandParam, '-10')
assert.equal(one('倒计时清零').rule?.commandCmd, 'countdown-clear')
assert.equal(one('计数加减', { 功能代码: '3' }).rule?.commandCmd, 'count-adjust')
assert.equal(one('计数清零').rule?.commandCmd, 'count-clear')
assert.equal(one('加班加减', { 功能代码: '60' }).rule?.commandCmd, 'overtime-adjust')
assert.equal(one('加班减少', { 功能代码: '60' }).rule?.commandParam, '-60')
assert.equal(one('加班乘以', { 功能代码: '2' }).rule?.commandCmd, 'overtime-mul')
assert.equal(one('加班除以', { 功能代码: '2' }).rule?.commandCmd, 'overtime-div')
assert.equal(one('加班清零').rule?.commandCmd, 'overtime-clear')
assert.match(one('加班加减').plan.skipped[0].reason, /数值/)
assert.equal(one('转盘抽奖').rule?.commandCmd, 'wheel-spin')
assert.equal(one('高级转盘').rule?.commandCmd, 'wheel-spin')
assert.equal(one('播放视频', { 功能代码: 'a.mp4' }, { videos: 'C:\\py\\视频' }).rule?.commandParam, 'C:\\py\\视频\\a.mp4|0')
assert.equal(one('播放视频').plan.skipped.length, 1)
assert.equal(one('动作命令', { 功能代码: '运行文件["D:\\x.exe" "a.mp4"]' }).rule?.commandCmd, 'run-file')
assert.equal(one('动作命令', { 功能代码: '运行文件["D:\\x.exe" "a.mp4"]' }).rule?.commandParam, '"D:\\x.exe" "a.mp4"')
for (const name of ['随机执行脚本', '物理脚本', 'OBS滤镜', 'OBS特效', 'OnlyClimb', 'PVZ命令', '禁用音效', '恢复音效', '减少转圈次数', '减少跳跃次数']) {
  const r = one(name, { 功能代码: 'x' })
  assert.equal(r.rule, undefined, name)
  assert.equal(r.plan.skipped.length, 1, name)
}
// 6) 真实 .脚本 行格式（解包里的示例脚本原文）
const realScript = parsePinyouScript(['正常按键:F10,1次', '延迟时间:0.3秒', '粘贴文本:bossrush 101', '正常按键:Enter,2次', '键盘弹起:Shift', '键盘锁定', '键盘按住:F2', '延迟时间:0.5秒', '键盘弹起:F2', '左键单击:80%,66%', '左键按住:20%,18%', '鼠标移到:80%,66%', '左键弹起:当前位置', '动作命令:运行文件["D:\\Program Files\\PotPlayer\\PotPlayerMini64.exe" "D:\\娱乐助手Pro\\视频\\进场\\大哥进场.mp4"]', 'OBS滤镜:游戏窗口\\人物扭曲[开]', '键盘锁定:5秒', '倒计时加减:30'].join('\n'))
assert.deepEqual(realScript.commands.map(s => s.cmd + ':' + (s.param ?? '')), [
  'key-sequence:{F10}', 'delay:300', 'paste-text:bossrush 101', 'key-sequence:{ENTER}', 'key-sequence:{ENTER}', 'key-up:SHIFT',
  'key-hold:F2,1000', 'delay:500', 'key-up:F2', 'mouse:click-left|80%|66%', 'mouse:down-left|20%|18%', 'mouse:move|80%|66%', 'mouse:up-left',
  'run-file:"D:\\Program Files\\PotPlayer\\PotPlayerMini64.exe" "D:\\娱乐助手Pro\\视频\\进场\\大哥进场.mp4"', 'key-lock:全部|5000', 'countdown-adjust:30'
])
assert.deepEqual(realScript.unknown, ['键盘锁定', 'OBS滤镜:游戏窗口\\人物扭曲[开]'])
// 7) 素材存在性：主进程给 exists 回调时，找不到的音效 / 视频 / 目录要提示
const missing = conv({ 甲: { 动作: { 执行功能: '播放音效', 音效文件: '没有.mp3' } }, 乙: { 视频: { 视频目录: '绿幕', 视频文件: '有.mp4' } }, 丙: { 视频: { 视频目录: '不存在目录', 视频文件: '随机播放' } } },
  { root: 'C:\\py', sounds: 'C:\\py\\音效', videos: 'C:\\py\\视频', exists: (p) => p === 'C:\\py\\视频\\绿幕\\有.mp4' })
assert.equal(missing.rules.length, 3)
assert.deepEqual(missing.notes.map(n => n.gift), ['甲', '丙'])
assert.match(missing.notes[0].text, /没有\.mp3/)
assert.equal(one('播放动图', { 功能代码: 'a.gif' }, { root: 'C:\\py', videos: 'C:\\py\\视频', exists: (p) => p === 'C:\\py\\视频\\a.gif' }).rule?.commandParam, 'C:\\py\\视频\\a.gif')
console.log('PASS 2026-09-06 review: lock word order / key-up / mouse table (percent, drag, multi-point, hold) / mobile table / counters / wheel / run-file / real script lines / missing assets')
await import('./test-pinyou-storage.mjs')

// ===== 2026-09-07 收尾：视频「路径|秒数」拆合 / 标签 / 蹦迪-偷袭 =====
assert.deepEqual(splitVideoParam('D:/v/木鱼狗.mp4|0.967'), { path: 'D:/v/木鱼狗.mp4', seconds: '0.967' })
assert.deepEqual(splitVideoParam('D:/v/木鱼狗.mp4'), { path: 'D:/v/木鱼狗.mp4' })
assert.equal(joinVideoParam('D:/v/a.mp4', '3'), 'D:/v/a.mp4|3')
assert.equal(joinVideoParam('D:/v/a.mp4', ''), 'D:/v/a.mp4')
assert.equal(joinVideoParam('D:/v/a.mp4', 'abc'), 'D:/v/a.mp4')
assert.equal(joinVideoParam(splitVideoParam('D:/v/a.mp4|0.9').path, splitVideoParam('D:/v/a.mp4|0.9').seconds), 'D:/v/a.mp4|0.9')
assert.equal(ruleActionLabel({ actionType: 'command', commandCmd: 'video-play', commandParam: 'D:/v/木鱼狗.mp4|0.9' }), '播放视频 木鱼狗.mp4 最多0.9秒')
assert.equal(ruleActionLabel({ actionType: 'command', commandCmd: 'video-gif', commandParam: 'D:/v/a.gif' }), '播放动图 a.gif 播完结束')
assert.equal(ruleActionLabel({ actionType: 'command', commandCmd: 'script-sequence', commandParam: JSON.stringify([{ cmd: 'key-sequence', param: '{F10}' }, { cmd: 'delay', param: '500' }]) }), '动作脚本（2 步）')
// 0.3.42 视频「播到哪里」后缀：|绿幕N / |视频；不写 = 默认窗口
assert.deepEqual(splitVideoParam('D:/v/a.mp4|0.9|绿幕2'), { path: 'D:/v/a.mp4', seconds: '0.9', target: '绿幕2' })
assert.deepEqual(splitVideoParam('D:/v/a.mp4|视频'), { path: 'D:/v/a.mp4', target: '视频' })
assert.deepEqual(splitVideoParam('D:/v/a.mp4|0.9'), { path: 'D:/v/a.mp4', seconds: '0.9' })
assert.equal(joinVideoParam('D:/v/a.mp4', '3', '绿幕2'), 'D:/v/a.mp4|3|绿幕2')
assert.equal(joinVideoParam('D:/v/a.mp4', '', '视频'), 'D:/v/a.mp4|视频')
assert.equal(ruleActionLabel({ actionType: 'command', commandCmd: 'video-play', commandParam: 'D:/v/木鱼狗.mp4|0.9|绿幕2' }), '播放视频 木鱼狗.mp4 最多0.9秒 →绿幕2')
assert.equal(one('蹦迪-偷袭', { 次数时间: '2秒' }).rule?.commandParam, 'dance2|2000')
assert.equal(one('蹦迪-偷袭').plan.notes.filter((n) => /按蹦迪动作导入/.test(n)).length, 0)
console.log('PASS 2026-09-07 收尾: video param split/join / labels (秒·循环·品游脚本 N 步) / 蹦迪-偷袭 → dance2')

console.log('pinyou regression passed')
