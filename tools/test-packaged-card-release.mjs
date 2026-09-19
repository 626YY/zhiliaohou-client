// 实际发行 EXE 的公网只读烟测：独立 profile / 假游戏路径；不注册、不登录、不发验证码。
// node tools/test-packaged-card-release.mjs [release/v0.3.47/win-unpacked/知了猴整蛊台.exe]
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
const exe = path.resolve(root, process.argv[2] || `release/v${version}/win-unpacked/知了猴整蛊台.exe`)
const output = path.join(root, 'output', 'playwright', 'packaged-card-release')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const isolated = await prepareIsolatedGameProfile(root, profile)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const passed = [], errors = []
const check = (label, condition) => {
  if (!condition) throw new Error(label)
  passed.push(label)
  console.log('PASS ' + label)
}
let app, ownPid, runtime
try {
  app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${profile}`], cwd: path.dirname(exe), env, timeout: 45000 })
  ownPid = app.process().pid
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(20000)
  runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), resources: process.resourcesPath, executable: process.execPath, pid: process.pid }))
  await fs.writeFile(path.join(output, 'runtime.json'), JSON.stringify({ runtime, profile, launcherPid: ownPid }, null, 2))
  check('actual packaged executable reports the release version', runtime.packaged === true && runtime.version === version && path.resolve(runtime.executable) === exe)
  check('actual app userData is the isolated profile from the startup flag', path.resolve(runtime.userData) === profile)
  check('no per-profile provider override exists', !(await fs.stat(path.join(profile, 'license-provider.json')).then(() => true, () => false)))
  const config = JSON.parse(await fs.readFile(path.join(runtime.resources, 'license-provider.json'), 'utf8'))
  const origin = 'https://47.251.93.171:8770/card'
  check('packaged default points to the official card service', config.provider === 'card' && config.baseUrl === origin && config.identityMode === 'existing')
  await page.waitForFunction(() => !!window.api?.cardState)
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
  const state = await api('cardState')
  check('real client connects online using resources configuration', state.ok && state.enabled && state.origin === origin && state.source === 'resources')
  check('real service requires email verification for existing identity', state.identityMode === 'existing' && state.registrationRequiresCode === true)
  check('fresh profile has no signed-in account', !state.user && await api('session') === null && (await api('listAccounts')).length === 0)

  // 只读 net.fetch 使用产品启动时安装的实际默认 Session 证书校验，不覆盖网络方法或证书回调。
  const published = await app.evaluate(async ({ net }, origin) => {
    const result = {}
    for (const [name, suffix] of [['health', '/health'], ['ed', '/api/v1/public-key'], ['rsa', '/api/v1/mod-public-key']]) {
      const response = await net.fetch(origin + suffix, { method: 'GET', redirect: 'error' })
      result[name] = { status: response.status, value: await response.json() }
    }
    return result
  }, origin)
  check('actual Electron TLS stack reads the public health endpoint', published.health.status === 200 && published.health.value.service === 'zhiliao-license')
  check('bundled Ed25519 key matches the published issuer', published.ed.status === 200 && published.ed.value.algorithm === 'Ed25519' && published.ed.value.key === config.publicKey)
  const modPin = config.modPublicKeys['game:4wheel-challenge']
  check('bundled RSA key and fingerprint match the published mod issuer', published.rsa.status === 200 && published.rsa.value.key_xml === modPin.keyXml && published.rsa.value.fingerprint === modPin.fingerprint)
  const modManifest = JSON.parse(await fs.readFile(path.join(runtime.resources, 'local-card-mod', 'manifest.json'), 'utf8'))
  const dll = await fs.readFile(path.join(runtime.resources, 'local-card-mod', 'WheelLive.dll'))
  check('packaged mod DLL hash and issuer fingerprint match its manifest', modManifest.fingerprint === modPin.fingerprint && createHash('sha256').update(dll).digest('hex') === modManifest.sha256)
  const settings = (await api('getSettings')).settings
  check('all three game paths remain inside this test profile', Object.entries(isolated.gamePaths).every(([id, filename]) => settings.gamePaths[id] === filename && filename.startsWith(profile + path.sep)))

  const mode = page.getByTestId('login-panel')
  await mode.waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="login-panel"]')?.getAttribute('data-card-loaded') === '1')
  check('main login keeps its original appearance while the service stays online', !/授权服务|卡密平台|已连接/.test(await mode.innerText()) && await mode.getAttribute('data-identity') === 'existing' && await mode.getAttribute('data-requires-code') === '1')
  check('main login shows email/password fields and no preview wording', await page.getByPlaceholder('邮箱 / 用户名').isVisible() && await page.getByPlaceholder('密码', { exact: true }).isVisible() && !/测试版|购买卡密/.test(await page.locator('body').innerText()))
  await page.screenshot({ path: path.join(output, '01-login.png') })
  await page.getByRole('button', { name: '没有账号？创建账号' }).click()
  check('registration guides show email code input and send button', await page.getByPlaceholder('邮箱验证码').isVisible() && await page.getByRole('button', { name: '发送验证码', exact: true }).isVisible() && await page.getByRole('button', { name: '注册', exact: true }).isVisible())
  await page.screenshot({ path: path.join(output, '02-registration.png') })
  await page.getByRole('button', { name: '← 返回登录' }).click()
  await page.getByRole('button', { name: '忘记密码，无法登录？' }).click()
  check('password recovery uses the email verification guide', await page.getByPlaceholder('邮箱验证码').isVisible() && await page.getByRole('button', { name: '重置密码', exact: true }).isVisible() && await page.getByTestId('card-reset-help').count() === 0)
  await page.screenshot({ path: path.join(output, '03-password-recovery.png') })
  await page.getByRole('button', { name: '← 返回登录' }).click()
  // 授权总开关（resources/license-policy.json，2026-09-19 起随包 enforce=false）：免检时未登录也不能被授权门拦住，
  // 只能因为「游戏路径 / 桥」这种真实原因失败；启用时仍必须被授权门拦住
  const policy = JSON.parse(await fs.readFile(path.join(runtime.resources, 'license-policy.json'), 'utf8').catch(() => '{"enforce":true}'))
  const launch = await api('launchGame')
  const bridge = await api('liveCmd', 'ping')
  if (policy.enforce === false) {
    check('license paused: unsigned launch is not blocked by the license gate', !/登录|卡密|授权/.test(launch.error || ''))
    check('license paused: unsigned bridge call is not blocked by the license gate', !/登录|卡密|授权/.test(bridge.error || ''))
  } else {
    check('unsigned user cannot launch a game', launch.ok === false && /登录|卡密|授权/.test(launch.error || ''))
    check('unsigned user cannot invoke the game bridge', bridge.ok === false && /登录|卡密|授权/.test(bridge.error || ''))
  }
  check('blocked actions leave the client signed out', await api('session') === null)
  check('all observed renderer pages are free of uncaught errors', errors.length === 0)
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ version, executable: exe, pid: ownPid, profile, runtime, passed, errors }, null, 2))
  console.log(`PACKAGED CARD RELEASE PASS ${passed.length}/${passed.length}`)
} finally {
  if (app) await app.close()
  if (ownPid) console.log('CLOSED OWN PACKAGED TEST PID ' + ownPid)
}
