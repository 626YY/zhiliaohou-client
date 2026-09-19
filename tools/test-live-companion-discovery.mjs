// 只测试本地定位/保存；不启动直播伴侣、不连接推流、不读取用户直播配置。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { companionExecutable, companionRegistryLocations, discoverCompanion } from '../src/main/live-companion-discovery.ts'

const normalize = value => path.normalize(value).toLowerCase()
const files = new Set()
const folders = new Map()
const put = value => { files.add(normalize(value)); return value }
const probe = {
  fileExists: value => files.has(normalize(value)),
  directories: value => folders.get(normalize(value)) || []
}
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS discovery: ${name}`) }
const installed = 'C:\\Program Files (x86)\\webcast_mate'
const processExe = put(path.join('D:\\Apps\\webcast_mate', '12.6.0', '直播伴侣.exe'))
const defaultExe = put(path.join(installed, '直播伴侣 Launcher.exe'))
const registryExe = put(path.join('E:\\Live\\webcast_mate', '直播伴侣.exe'))
const selected = 'F:\\tools\\webcast_mate'
const selectedExe = put(path.join(selected, '12.10.0', '直播伴侣.exe'))
put(path.join(selected, '12.9.0', '直播伴侣.exe'))
folders.set(normalize(selected), ['12.9.0', '12.10.0', '13.0.0', 'resources', '..\\outside'])

check('running process path wins over defaults', () => assert.equal(discoverCompanion({ processes:[processExe], defaults:[installed] }, probe)?.exePath, processExe))
check('default directory launcher', () => assert.equal(discoverCompanion({ defaults:[installed] }, probe)?.exePath, defaultExe))
check('registry InstallLocation and quoted DisplayIcon', () => {
  const candidates = companionRegistryLocations([{ DisplayName:'抖音直播伴侣', InstallLocation:'Z:\\missing' }, { DisplayName:'webcast_mate', DisplayIcon:`"${registryExe}",0` }])
  assert.equal(discoverCompanion({registry:candidates}, probe)?.exePath, registryExe)
})
check('user directory selects newest usable numeric version', () => assert.equal(discoverCompanion({preferred:selected, processes:[processExe]}, probe)?.exePath, selectedExe))
check('version directory and quoted exe accepted', () => {
  assert.equal(companionExecutable(path.dirname(selectedExe), probe), selectedExe)
  assert.equal(companionExecutable(`"${processExe}"`, probe), processExe)
})
check('stale selection and vanished process fall through', () => assert.equal(discoverCompanion({preferred:'Z:\\gone',processes:['Z:\\gone\\直播伴侣.exe'],defaults:[installed]},probe)?.exePath,defaultExe))
check('Bilibili process, executable and registry rejected', () => {
  const bili = put('D:\\bilibili\\livehime.exe')
  assert.equal(companionExecutable(bili, probe),null)
  assert.equal(discoverCompanion({processes:[bili]},probe),null)
  assert.deepEqual(companionRegistryLocations([{DisplayName:'哔哩哔哩直播伴侣',InstallLocation:installed},{DisplayName:'bilibili livehime',DisplayIcon:defaultExe}]),[])
})
check('empty/unknown registry rows and missing installation', () => {
  assert.deepEqual(companionRegistryLocations([null,123,{}, {DisplayName:'Other app', InstallLocation:installed}]),[])
  assert.equal(discoverCompanion({},probe),null)
  assert.equal(companionExecutable('   ',probe),null)
})
check('Windows executable name matching is case insensitive', () => assert.equal(companionExecutable(processExe.replace('.exe','.EXE'),probe),processExe.replace('.exe','.EXE')))
check('malformed saved selection does not block fallback', () => assert.equal(discoverCompanion({preferred:{bad:true},defaults:[installed]},probe)?.exePath,defaultExe))

// 用真实 obs-service setter、settings、db 验证手选路径只在校验成功后持久化。
// 外部 OBS/系统探测用替身，数据写入独立临时目录。
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiliao-discovery-'))
const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const localFunctions = ['enableObsWebSocket','isObsRunning','launchObs','obsExePath','obsInstallDir','readSceneCollection','launchLiveCompanion']
const clientFunctions = ['obsConnect','obsDisconnect','obsListFilters','obsListScenes','obsSetFilterEnabled','obsSetScene','obsState','obsToggleFilter','onObsEvent','onObsStateChange']
try {
  const cache = new Map()
  function loadTs(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const mod = { exports:{} }; cache.set(filename,mod)
    const compiled = ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
    const localRequire = name => {
      if (name==='electron') return { app:{getPath:()=>temporary,on:()=>{}}, BrowserWindow:{getAllWindows:()=>[]} }
      if (name==='./obs-client') return Object.fromEntries(clientFunctions.map(key=>[key,()=>({})]))
      if (name==='./obs-local') return { ...Object.fromEntries(localFunctions.map(key=>[key,()=>({})])), validateLiveCompanionDirectory:dir=>!!companionExecutable(dir,probe), readObsWebSocketConfig:()=>({port:4455}), liveCompanionStatus:(_refresh,preferred)=>({preferred}) }
      if (name==='@shared/types') return loadTs(path.join(root,'src/shared/types.ts'))
      if (name.startsWith('.')) return loadTs(path.resolve(path.dirname(filename),`${name}.ts`))
      return require(name)
    }
    new Function('require','module','exports',compiled)(localRequire,mod,mod.exports)
    return mod.exports
  }
  const service=loadTs(path.join(root,'src/main/obs-service.ts'))
  const settings=loadTs(path.join(root,'src/main/settings.ts'))
  check('validated user choice persists through real settings/database',()=>{
    assert.equal(service.liveCompanionSetDirectory(selected).ok,true)
    assert.equal(settings.getSettings().liveCompanionDir,selected)
    assert.equal(service.liveCompanionState().preferred,selected)
    assert.equal(JSON.parse(fs.readFileSync(path.join(temporary,'data/settings.json'),'utf8')).liveCompanionDir,selected)
  })
  check('invalid choice preserves previous saved selection',()=>{
    assert.equal(service.liveCompanionSetDirectory('D:\\bilibili').ok,false)
    assert.equal(settings.getSettings().liveCompanionDir,selected)
  })
  console.log(`live companion discovery: ${passed}/${passed} PASS`)
} finally {
  assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()))
  fs.rmSync(temporary,{recursive:true,force:true})
}
