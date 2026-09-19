// Opt-in real game diagnostic. Starts only an isolated hidden client.
// The game must already be running; --enter-test-map changes this test game to DS_Forest_01.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const exeArg = process.argv.indexOf('--game-exe')
assert.ok(exeArg >= 0 && process.argv[exeArg + 1], '--game-exe is required')
const gameExe = path.resolve(process.argv[exeArg + 1])
assert.match(path.basename(gameExe), /^DontScream-Win64-Shipping\.exe$/i)
await fs.access(gameExe)
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/dontscream-link')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
settings.currentGameId = 'dontscream'
settings.gamePaths.dontscream = gameExe
await fs.writeFile(path.join(profile, 'data/settings.json'), JSON.stringify(settings))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const modLog = path.join(path.dirname(gameExe), 'ue4ss/zhiliao.log')
const probe = path.join(path.dirname(gameExe), 'ue4ss/probe.txt')
const logBefore = await fs.readFile(modLog, 'utf8')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], states = [], replies = []
const pass = name => { checks.push(name); console.log('PASS ' + name) }
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000
})
async function delta() { return (await fs.readFile(modLog, 'utf8')).slice(logBefore.length) }
async function until(fn, label, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const result = await fn()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Timed out: ' + label)
}
let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.liveState)
  const state = await page.evaluate(() => window.api.liveState())
  states.push(state)
  assert.equal(state.running, true, 'the test game must already be running')
  assert.equal(state.bridgeOk, true)
  assert.equal(path.resolve(state.path), path.join(path.dirname(gameExe), 'ue4ss/Mods/zhiliao/bridge.txt'))
  pass('actual client detects the running game and correct bridge')
  console.log('STATE ' + JSON.stringify(state))
  const reply = await page.evaluate(() => window.api.livePrank('mummyrun'))
  replies.push(reply)
  assert.equal(reply.ok, true, reply.error)
  await until(async () => /mummyrun/.test(await delta()), 'mod receives client prank', 15000)
  pass('real preload/IPC writes a command read by the real Lua mod')
  console.log('MOD ' + (await delta()).trim())
  if (process.argv.includes('--enter-test-map')) {
    await fs.appendFile(probe, 'open DS_Forest_01\n', 'utf8')
    await until(async () => /SpawnScare.*mummyrun.*ok=true ret=true/.test(await delta()), 'pending prank executes in the forest', 90000)
    pass('menu pending command executes after loading the forest')
    states.push(await page.evaluate(() => window.api.liveState()))
    const beforeGift = (await fs.readFile(modLog, 'utf8')).length
    const gift = await page.evaluate(() => window.api.liveCmd('gift 抖音 1'))
    replies.push(gift)
    assert.equal(gift.ok, true, gift.error)
    await until(async () => {
      const text = (await fs.readFile(modLog, 'utf8')).slice(beforeGift)
      return text.includes('gift -> 抖音') && /SpawnScare.*ok=true ret=true/.test(text)
    }, 'gift mapping executes in game', 30000)
    pass('real client gift command maps and spawns a scare in game')
  }
} catch (error) {
  failure = String(error.stack || error)
  console.error(failure)
} finally {
  const log = await delta().catch(() => '')
  await fs.writeFile(path.join(profile, 'mod-delta.log'), log)
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({
    checks, states, replies, failure, profile, gameExe,
    limitations: ['isolated hidden client; no live room or paid gifts', 'SpawnScare acceptance is not a visual-effects assessment']
  }, null, 2))
  await app.close()
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
