#!/usr/bin/env node
/**
 * QEFT Native Messaging Host —— 本机 libusb 宿主
 *
 * 由 Chrome/Edge 扩展通过 chrome.runtime.connectNative 启动，stdin/stdout 走
 * Chrome Native Messaging 帧（u32 LE 长度 + JSON）。USB 访问用 node-usb
 * （libusb 的 Node 绑定），因此 Windows 上设备需绑定 WinUSB/libusbK 驱动。
 *
 * 协议（二进制一律 base64）：
 *   →  { id, op: 'hello' }
 *   ←  { id, ok, version, platform }
 *   →  { id, op: 'list' }                          ← { id, ok, devices:[...] }
 *   →  { id, op: 'open',  serial?, vid?, pid? }    ← { id, ok, maxSize }
 *   →  { id, op: 'read',  length }                 ← { id, ok, data }
 *   →  { id, op: 'write', data }                   ← { id, ok, written }
 *   →  { id, op: 'close' }                         ← { id, ok }
 *   →  { id, op: 'ping' }                          ← { id, ok, t }
 */
import usb from 'usb'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

const VENDOR_IDS = [0x05c6, 0x3801]
const PRODUCT_ID = 0x9008
const READ_TIMEOUT_MS = 5000
const MAX_READ_BYTES = 256 * 1024 // 宿主→浏览器单条消息上限 1MB，base64 后仍要留余量

function log(...args) {
  process.stderr.write(`[qeft-host] ${args.join(' ')}\n`)
}

/* ------------------------------------------------------------------ *
 * Native Messaging 帧协议
 * ------------------------------------------------------------------ */
let inBuf = Buffer.alloc(0)
const queue = []
let draining = false

function send(msg) {
  const data = Buffer.from(JSON.stringify(msg), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32LE(data.length, 0)
  process.stdout.write(head)
  process.stdout.write(data)
}

process.stdin.on('data', (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk])
  while (inBuf.length >= 4) {
    const len = inBuf.readUInt32LE(0)
    if (len > 64 * 1024 * 1024) {
      log('消息过大，丢弃')
      inBuf = Buffer.alloc(0)
      return
    }
    if (inBuf.length < 4 + len) break
    const raw = inBuf.subarray(4, 4 + len)
    inBuf = inBuf.subarray(4 + len)
    let msg
    try { msg = JSON.parse(raw.toString('utf8')) } catch (e) { log('JSON 解析失败: ' + e.message); continue }
    queue.push(msg)
  }
  drain()
})

process.stdin.on('end', () => {
  log('stdin 关闭，退出')
  closeDevice()
  process.exit(0)
})

async function drain() {
  if (draining) return
  draining = true
  while (queue.length) {
    const msg = queue.shift()
    try {
      const res = await handle(msg)
      send({ id: msg.id, ok: true, ...res })
    } catch (e) {
      const err = e && e.message ? e.message : String(e)
      log(`op=${msg?.op} 失败: ${err}`)
      send({ id: msg.id, ok: false, error: err })
    }
  }
  draining = false
}

/* ------------------------------------------------------------------ *
 * libusb 操作
 * ------------------------------------------------------------------ */
let dev = null
let iface = null
let inEp = null
let outEp = null
let maxSize = 512

function isQdl(d) {
  const desc = d.deviceDescriptor
  return VENDOR_IDS.includes(desc.idVendor) && desc.idProduct === PRODUCT_ID
}

function getStr(device, index) {
  return new Promise((resolve) => {
    if (!index) return resolve('')
    try {
      device.getStringDescriptor(index, (err, str) => resolve(err ? '' : String(str || '')))
    } catch { resolve('') }
  })
}

/** 打开设备读字符串后立即关闭（只用于枚举展示） */
async function probeInfo(d) {
  const out = {
    vid: d.deviceDescriptor.idVendor,
    pid: d.deviceDescriptor.idProduct,
    bus: d.busNumber,
    address: d.deviceAddress,
    name: '',
    manufacturer: '',
    serial: '',
  }
  try {
    d.open()
    out.manufacturer = await getStr(d, d.deviceDescriptor.iManufacturer)
    out.name = await getStr(d, d.deviceDescriptor.iProduct)
    out.serial = await getStr(d, d.deviceDescriptor.iSerialNumber)
    d.close()
  } catch (e) {
    out.error = String(e && e.message ? e.message : e)
  }
  return out
}

function qdlDeviceList() {
  return usb.getDeviceList().filter(isQdl)
}

function findEndpoints() {
  for (let i = 0; i < dev.interfaces.length; i++) {
    const it = dev.interfaces[i]
    const eps = it.endpoints || []
    const inE = eps.find((e) => e.direction === 'in' && e.type === 'bulk')
    const outE = eps.find((e) => e.direction === 'out' && e.type === 'bulk')
    if (inE && outE) return { it, inE, outE }
  }
  return null
}

async function openDevice({ serial, vid, pid } = {}) {
  closeDevice()
  const list = qdlDeviceList()
  if (!list.length) throw new Error('未发现 9008 设备（VID 05c6/3801 · PID 9008）')

  let target = null
  let targetInfo = null
  for (const d of list) {
    if (vid && d.deviceDescriptor.idVendor !== vid) continue
    const info = await probeInfo(d)
    if (pid && d.deviceDescriptor.idProduct !== pid) continue
    if (serial && info.serial !== serial) continue
    target = d
    targetInfo = info
    break
  }
  if (!target) {
    target = list[0]
    targetInfo = await probeInfo(target)
    if (serial) log(`未找到序列号 ${serial} 的设备，改用第一台`)
  }

  target.open()
  dev = target
  const found = findEndpoints()
  if (!found) {
    closeDevice()
    throw new Error('设备接口上没有一对 bulk 端点（Windows 需用 Zadig 绑定 WinUSB/libusbK 驱动）')
  }
  try {
    await new Promise((resolve, reject) => found.it.claim((e) => (e ? reject(e) : resolve())))
  } catch (e) {
    closeDevice()
    throw new Error(`claimInterface 失败（驱动被占用或未绑定 WinUSB）：${e.message || e}`)
  }
  iface = found.it
  inEp = found.inE
  outEp = found.outE
  maxSize = inEp.maxPacketSize || 512
  inEp.timeout = READ_TIMEOUT_MS
  log(`已打开 ${targetInfo.vid.toString(16)}:${targetInfo.pid.toString(16)} serial=${targetInfo.serial} maxSize=${maxSize}`)
  return { maxSize, device: targetInfo }
}

function closeDevice() {
  if (iface) {
    try { iface.release(() => { try { dev?.close() } catch { /* ignore */ } }) } catch { /* ignore */ }
  } else if (dev) {
    try { dev.close() } catch { /* ignore */ }
  }
  dev = null
  iface = null
  inEp = null
  outEp = null
}

function bulkRead(length) {
  return new Promise((resolve, reject) => {
    if (!inEp) return reject(new Error('设备未打开'))
    inEp.transfer(length, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

function bulkWrite(buf) {
  return new Promise((resolve, reject) => {
    if (!outEp) return reject(new Error('设备未打开'))
    outEp.transfer(buf, (err) => (err ? reject(err) : resolve(buf.length)))
  })
}

async function readUpTo(length) {
  const want = Math.min(length, MAX_READ_BYTES)
  if (!want) return Buffer.alloc(0)
  const chunks = []
  let got = 0
  const deadline = Date.now() + READ_TIMEOUT_MS
  while (got < want && Date.now() < deadline) {
    const n = Math.min(want - got, 1024 * 1024)
    try {
      const data = await bulkRead(n)
      if (data && data.length) { chunks.push(Buffer.from(data)); got += data.length }
      else break
    } catch (e) {
      const msg = String(e.message || e)
      if (got) break // 已读到部分数据就算成功
      if (/timeout/i.test(msg)) throw new Error(`bulk IN 超时（${READ_TIMEOUT_MS}ms）`)
      throw e
    }
  }
  return Buffer.concat(chunks)
}

/* ------------------------------------------------------------------ *
 * 分发
 * ------------------------------------------------------------------ */
async function handle(msg) {
  switch (msg.op) {
    case 'hello':
      return { version: pkg.version, platform: process.platform, node: process.version, libusb: usb.LIBUSB_VERSION || '?' }

    case 'list': {
      const list = qdlDeviceList()
      const devices = []
      for (const d of list) devices.push(await probeInfo(d))
      return { devices }
    }

    case 'open': {
      const r = await openDevice(msg)
      return { maxSize: r.maxSize, device: r.device }
    }

    case 'read': {
      const length = Number(msg.length || 0)
      const data = await readUpTo(length)
      return { data: data.toString('base64'), length: data.length }
    }

    case 'write': {
      const buf = Buffer.from(String(msg.data || ''), 'base64')
      if (!buf.length) return { written: 0 }
      const written = await bulkWrite(buf)
      return { written }
    }

    case 'close':
      closeDevice()
      return {}

    case 'ping':
      return { t: Date.now() }

    default:
      throw new Error(`未知 op：${msg.op}`)
  }
}

log(`启动 v${pkg.version} (node ${process.version})`)
process.on('exit', () => closeDevice())
