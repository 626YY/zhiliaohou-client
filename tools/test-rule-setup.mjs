import {build} from 'esbuild'
import path from 'node:path'
import assert from 'node:assert/strict'
import {test} from 'node:test'
const root=path.resolve(import.meta.dirname,'..')
async function moduleOf(file){const r=await build({entryPoints:[path.join(root,file)],bundle:true,platform:'node',format:'esm',write:false,alias:{'@shared':path.join(root,'src/shared')}});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'))}
const {setupKind,setupRule,setupSource,mediaFileUrl}=await moduleOf('src/renderer/src/lib/ruleSetup.ts')
const {actionLabel}=await moduleOf('src/shared/entertainmentLabels.ts')
test('new video uses one natural playback and no empty extra action',()=>{
 const r=setupRule(undefined,'video','F:\\视频\\a #1.mp4','小心心')
 assert.equal(r.commandParam,'F:\\视频\\a #1.mp4|0');assert.deepEqual(r.extraActions,[]);assert.equal(r.times,1);assert.equal(r.enabled,true)
 assert.match(actionLabel(r),/播完结束/);assert.doesNotMatch(actionLabel(r),/循环/)
})
test('editing preserves non-basic parameters and only changes requested fields',()=>{
 const base={id:'old',name:'自定义名字',actionType:'command',commandCmd:'video-play',commandParam:'F:\\a.mp4|2.5|绿幕3固定',giftName:'鲜花',times:5,repeat:2,multiply:false,delayMs:700,queueMode:'jump',priority:9,chroma:true,enabled:false,extraActions:[{actionType:'key',keySeq:'{F9}',delayMs:500}]}
 const r=setupRule(base,'video','F:\\b.mp4','棒棒糖')
 assert.deepEqual(r,{...base,triggerType:'gift',commandParam:'F:\\b.mp4|2.5|绿幕3固定',giftName:'棒棒糖'})
 assert.equal(base.commandParam,'F:\\a.mp4|2.5|绿幕3固定')
})
test('adding one selected action preserves existing actions',()=>{
 const base={id:'1',actionType:'sound',soundPath:'old.wav',soundMode:'unique',soundVolume:35,giftName:'x',extraActions:[{actionType:'key',keySeq:'{F1}'}]}
 const extra={actionType:'command',commandCmd:'countdown-adjust',commandParam:'30'}
 const r=setupRule(base,'sound','new.wav','y',extra)
 assert.deepEqual(r.extraActions,[...base.extraActions,extra]);assert.equal(r.soundMode,'unique');assert.equal(r.soundVolume,35);assert.equal(base.extraActions.length,1)
})
test('skipping new actions retains actions already present',()=>{const b={id:'1',actionType:'key',keySeq:'{F1}',giftName:'x',extraActions:[{actionType:'key',keySeq:'{F2}'}]};assert.deepEqual(setupRule(b,'key','{F3}','z').extraActions,b.extraActions)})
test('project selection retains fixed output routing',()=>{const b={id:'1',actionType:'command',commandCmd:'project-random',commandParam:'F:\\项目A|绿幕2固定',giftName:'x'};assert.equal(setupRule(b,'box','F:\\项目B','y').commandParam,'F:\\项目B|绿幕2固定')})
test('advanced legacy video looping is not rewritten by simple editing',()=>{const b={id:'1',actionType:'command',commandCmd:'video-play',commandParam:'F:\\a.mp4|视频',giftName:'x'};const r=setupRule(b,'video','F:\\b.mp4','y');assert.equal(r.commandParam,'F:\\b.mp4|视频');assert.match(actionLabel(r),/循环/)})
test('unsupported actions stay distinguishable from guided actions',()=>{assert.equal(setupKind({actionType:'obs'}),undefined);assert.equal(setupKind({actionType:'command',commandCmd:'shutdown'}),undefined)})
test('local media URLs encode reserved characters and Chinese',()=>{assert.equal(mediaFileUrl('F:\\视频 #1\\a.mp4'),'file:///F:/%E8%A7%86%E9%A2%91%20%231/a.mp4')})
test('unselected video stays empty through advanced round trips',()=>{const draft=setupRule(undefined,'video','','');assert.equal(setupSource(draft),'');assert.equal(draft.name,'');const again=setupRule(draft,'video',setupSource(draft),'鲜花');assert.equal(setupSource(again),'');const picked=setupRule(again,'video','F:\\later.mp4','鲜花');assert.equal(picked.name,'视频：later.mp4')})

test('editing an existing ungrouped blind box does not silently regroup it',()=>{
  const base={id:'old-box',name:'原盲盒',actionType:'command',commandCmd:'project-random',commandParam:'F:\\原素材\\盲盒|绿幕3固定',giftName:'小心心',group:'',enabled:false,queueMode:'jump',multiply:false,times:5,repeat:2,extraActions:[{actionType:'command',commandCmd:'countdown-adjust',commandParam:'-60'}]}
  const next=setupRule(base,'box',setupSource(base),base.giftName)
  assert.equal(next.group,'');assert.equal(next.commandParam,base.commandParam);assert.equal(next.id,base.id);assert.equal(next.enabled,false);assert.equal(next.times,5);assert.equal(next.repeat,2);assert.equal(next.queueMode,'jump');assert.deepEqual(next.extraActions,base.extraActions)
})
