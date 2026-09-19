#!/usr/bin/env node
/**
 * 宿主自检：以 Native Messaging 帧协议直接喂几条命令，验证
 *   1) node-usb（libusb）能加载；
 *   2) 帧编解码正确；
 *   3) 能枚举 USB 设备（有无 9008 都应返回 ok）。
 *
 * 运行： node test-host.mjs
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST_DIR = dirname(fileURLToPath(import.meta.url))
const nodeExe = process.execPath
const script = join(HOST_DIR, 'qeft-host.mjs')

const child = spawn(nodeExe, [script], { stdio: ['pipe', 'pipe', 'inherit'] })

let buf = Buffer.alloc(0)
const results = []

child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0)
    if (buf.length < 4 + len) break
    const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'))
    buf = buf.subarray(4 + len)
    results.push(msg)
  }
})

function send(obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32LE(data.length, 0)
  child.stdin.write(head)
  child.stdin.write(data)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let pass = 0
  let fail = 0

  send({ id: 't1', op: 'hello' })
  await wait(1500)
  const hello = results.find((r) => r.id === 't1')
  if (hello?.ok) { pass++; console.log(`  ✓ hello: v${hello.version} · ${hello.platform} · libusb ${hello.libusb}`) }
  else { fail++; console.log('  ✗ hello 失败', hello) }

  send({ id: 't2', op: 'list' })
  await wait(4000)
  const list = results.find((r) => r.id === 't2')
  if (list?.ok) {
    pass++
    console.log(`  ✓ list: 发现 ${list.devices.length} 台 USB 设备（过滤 9008 后）`)
    for (const d of list.devices) {
      console.log(`      ${d.vid.toString(16)}:${d.pid.toString(16)} bus=${d.bus} addr=${d.address} name=${d.name || '?'} serial=${d.serial || '?'}${d.error ? ` [${d.error}]` : ''}`)
    }
    if (!list.devices.length) console.log('      （未接入 9008 设备——这是正常的，只要不报错就说明 libusb 工作正常）')
  } else { fail++; console.log('  ✗ list 失败', list) }

  send({ id: 't3', op: 'ping' })
  await wait(800)
  const ping = results.find((r) => r.id === 't3')
  if (ping?.ok) { pass++; console.log('  ✓ ping 通道正常') } else { fail++; console.log('  ✗ ping 失败', ping) }

  child.kill()
  console.log(`\n=== 宿主自检: ${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); child.kill(); process.exit(1) })
