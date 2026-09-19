import fs from 'node:fs'
import path from 'node:path'
import initSqlJs from 'sql.js'
import JSZip from 'jszip'

const target = path.resolve(process.argv[2] || 'output/playwright/transparent-db-fixture')
fs.mkdirSync(target, { recursive: true })

const SQL = await initSqlJs({ locateFile: (file) => path.resolve('node_modules/sql.js/dist', file) })
const now = Math.floor(Date.now() / 1000)
const image = fs.readFileSync(path.resolve('build/icon.png'))

const gf = new SQL.Database()
gf.run('CREATE TABLE giftlist (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, platform TEXT NULL, name TEXT NULL, giftid TEXT NULL, diamondcount INTEGER NULL, giftdata BLOB NULL, userid INTEGER NULL)')
const giftInsert = gf.prepare('INSERT INTO giftlist (time,createtime,platform,name,giftid,diamondcount,giftdata,userid) VALUES (?,?,?,?,?,?,?,?)')
giftInsert.run([now, now, 'dy', '回归嘉年华', 'fixture-30000', 30000, new Uint8Array(image), 0])
giftInsert.run([now, now, 'dy', '回归文字礼物', 'fixture-text', 1, new Uint8Array(Buffer.from('{"imageurl":"https://example.invalid/gift.png","kind":"fixture"}', 'utf8')), 0])
giftInsert.free()
const gfBytes = gf.export()
gf.close()

const config = new SQL.Database()
config.run('CREATE TABLE baseinfo (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, program_name TEXT NULL, font_size TEXT NULL, font_str TEXT NULL, colorstr TEXT NULL, strok_color TEXT NULL, spacing_size TEXT NULL, scale TEXT NULL, isrolling TEXT NULL, looogtxt TEXT NULL, imgdir TEXT NULL)')
config.run('CREATE TABLE programlist (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, program_name TEXT NULL, giftpro BLOB NULL)')
config.run('CREATE TABLE programlistimg (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, program_name TEXT NULL, giftpro BLOB NULL)')
config.run('CREATE TABLE giftver (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, name TEXT NULL, ver INTEGER NULL)')
config.run('CREATE TABLE colorlist (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, time INTEGER NULL, createtime INTEGER NULL, color_name TEXT NULL, colorv BLOB NULL)')
config.run('INSERT INTO baseinfo (time,createtime,program_name,font_size,font_str,colorstr,strok_color,spacing_size,scale,isrolling,looogtxt,imgdir) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [now, now, '回归普通方案', '64', '微软雅黑', '#ffcc00', '#101010', '3', '1080x1920(竖)', 'up', '回归透明图', ''])

const textMenu = {
  program: '回归文字菜单标题',
  programName: '回归文字菜单',
  listPro: [
    { platform: 'dy', name: '回归嘉年华', giftid: 'fixture-30000', diamondcount: 30000 },
    { platform: 'dy', name: '回归文字礼物', giftid: 'fixture-text', diamondcount: 1 }
  ]
}
config.run('INSERT INTO programlist (time,createtime,program_name,giftpro) VALUES (?,?,?,?)', [now, now, '回归文字菜单', new Uint8Array(Buffer.from(JSON.stringify(textMenu), 'utf8'))])
config.run('INSERT INTO programlistimg (time,createtime,program_name,giftpro) VALUES (?,?,?,?)', [now, now, '回归未知图片菜单', new Uint8Array([0, 255, 17, 34, 51, 68, 85, 102])])
config.run('INSERT INTO giftver (time,createtime,name,ver) VALUES (?,?,?,?)', [now, now, 'dy', 321])
config.run('INSERT INTO colorlist (time,createtime,color_name,colorv) VALUES (?,?,?,?)', [now, now, '回归配色', new Uint8Array(Buffer.from('["#ffcc00","#101010"]', 'utf8'))])
const configBytes = config.export()
config.close()

const gfPath = path.join(target, 'gf.db')
const configPath = path.join(target, 'config.db')
const zipPath = path.join(target, 'transparent-fixture.zip')
fs.writeFileSync(gfPath, Buffer.from(gfBytes))
fs.writeFileSync(configPath, Buffer.from(configBytes))

const zip = new JSZip()
zip.file('gf.db', gfBytes)
zip.file('config.db', configBytes)
fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

console.log(JSON.stringify({ gfPath, configPath, zipPath }, null, 2))
