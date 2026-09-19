// 发布前路径纠正和损坏修复回归：真实 IPC + OSS 安装，所有文件位于临时 profile。
// 不改名、删除或安装到用户的真实游戏目录。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
const root=path.resolve(import.meta.dirname,'..')
const out=path.join(root,'output/playwright/release-isolation')
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile)
const settingsFile=path.join(profile,'data/settings.json')
const settings=JSON.parse(await fs.readFile(settingsFile,'utf8'))
// 放在 profile 外的唯一验收目录，避免产品对 userData 测试路径的特许规则跳过路径纠正。
const game=await fs.mkdtemp(path.join(out,'game-dont-scream-'))
const bin=path.join(game,'DontScream/Binaries/Win64')
await fs.mkdir(bin,{recursive:true})
const ship=path.join(bin,'DontScream-Win64-Shipping.exe'), launcher=path.join(game,'DontScream.exe')
await fs.writeFile(ship,'non-executable test fixture');await fs.writeFile(launcher,'non-executable test fixture')
settings.currentGameId='dontscream';settings.gamePaths.dontscream=launcher
settings.gamePath=launcher;settings.gameExeName=path.basename(launcher)
await fs.writeFile(settingsFile,JSON.stringify(settings))
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const launch=()=>electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry,`--user-data-dir=${profile}`,'--no-sandbox'],cwd:root,env})
let app=await launch(),checks=0
const pass=(name)=>{checks++;console.log('PASS '+name)}
const exists=p=>fs.access(p).then(()=>true,()=>false)
const wait=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,200))}assert.fail('状态等待超时')}
const proxy=path.join(bin,'dwmapi.dll'),stray=path.join(game,'ue4ss/Mods/zhiliao/enabled.txt')
const breakFixture=async()=>{
  // 每个变更前校验真实绝对路径仍在本次临时目录中。
  for(const target of [proxy,stray])assert.ok(path.relative(game,path.resolve(target))&&!path.relative(game,path.resolve(target)).startsWith('..'))
  await fs.rename(proxy,proxy+'.test-backup')
  await fs.mkdir(path.dirname(stray),{recursive:true});await fs.writeFile(stray,'')
}
try{
  let page=await app.firstWindow()
  await page.waitForFunction(()=>!!window.api?.getSettings,null,{polling:50})
  await wait(async()=>path.normalize((await page.evaluate(()=>window.api.getSettings())).settings.gamePaths.dontscream).toLowerCase()===path.normalize(ship).toLowerCase(),12000)
  const s=(await page.evaluate(()=>window.api.getSettings())).settings
  assert.equal(path.normalize(s.gamePaths.dontscream).toLowerCase(),path.normalize(ship).toLowerCase())
  assert.deepEqual([s.gamePaths.librarian,s.gamePaths['4wheel-challenge']],[settings.gamePaths.librarian,settings.gamePaths['4wheel-challenge']])
  pass('启动把临时目录中的根启动器纠正到 Shipping，其他路径保持隔离')
  const install=await page.evaluate(()=>window.api.installMod('zhiliao-dontscream'))
  assert.equal(install.ok,true,install.error)
  assert.equal((await page.evaluate(()=>window.api.modHealth('dontscream'))).ok,true)
  pass('真实 OSS 安装到临时游戏目录后，健康检查通过')
  // 等首轮启动检查结束，再造损坏，区分手动修复与下一次启动自修。
  await page.waitForTimeout(5000)
  await breakFixture()
  const broken=await page.evaluate(()=>window.api.modHealth('dontscream'))
  assert.ok(broken.issues.some(i=>i.code==='missing-files'&&i.files.includes('dwmapi.dll')))
  assert.ok(broken.issues.some(i=>i.code==='misplaced'))
  assert.ok(!broken.issues.some(i=>i.code==='not-loaded'))
  const fix=await page.evaluate(()=>window.api.modRepair('dontscream'))
  assert.equal(fix.ok,true,fix.error)
  assert.equal(await exists(proxy),true);assert.equal(await exists(stray),false)
  assert.equal((await page.evaluate(()=>window.api.modHealth('dontscream'))).ok,true)
  pass('缺文件 + 错位副本被准确检出，手动修复恢复健康')
  await app.close()
  // 只删除本次临时文件的旧备份，下一次 rename 不覆盖。
  await fs.unlink(proxy+'.test-backup')
  await breakFixture()
  app=await launch();page=await app.firstWindow()
  await page.waitForFunction(()=>!!window.api?.modHealth,null,{polling:50})
  await wait(async()=>await exists(proxy)&&!(await exists(stray)),90000)
  await wait(async()=>{const text=await fs.readFile(path.join(profile,'logs/main.log'),'utf8').catch(()=>'');return text.includes('自动修复完成')})
  assert.equal((await page.evaluate(()=>window.api.modHealth('dontscream'))).ok,true)
  pass('重新启动自动修复损坏：真实文件恢复，日志记录自动修复完成')
  assert.equal((await page.evaluate(()=>window.api.modRepair('no-such-game'))).ok,false)
  pass('未知游戏明确拒绝修复')
}finally{await app.close().catch(()=>{})}
console.log(`隔离发布基础回归 ${checks}/${checks} PASS`)
