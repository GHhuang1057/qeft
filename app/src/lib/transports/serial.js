/**
 * Web Serial 传输通道
 *
 * 部分设备以 USB CDC-ACM 串口（COM 口）形式暴露 9008。Sahara / Firehose 在
 * 串口上的报文与 USB bulk 完全一致，所以这里把 Web Serial 包装成 qdl 需要的
 * usbClass 接口（connected / connect / read / write），让上层协议栈无差别使用。
 */
export function webSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

import { takeLate } from '../late-buffer.js'

function concat(a, b) {
  const c = new Uint8Array(a.length + b.length)
  c.set(a, 0)
  c.set(b, a.length)
  return c
}

export class SerialTransport {
  constructor({ baudRate = 115200 } = {}) {
    this.kind = 'serial'
    this.baudRate = baudRate
    this.device = null
    this.epIn = { endpointNumber: 0 }
    this.epOut = { endpointNumber: 0 }
    this.maxSize = 4096
    this.port = null
    this.reader = null
    this.writer = null
    this._buf = new Uint8Array(0)
    // qdl 的 runWithTimeout 超时后会「遗弃」读 promise，但底层 reader 的读并没有取消；
    // 若此时再发起 read() 会形成并发读，Web Serial 会立刻拒绝（表现为瞬间超时）。
    // 用内部队列把所有读操作串行化，遗弃的读最多多消费一次数据，不会报错。
    this._readQueue = Promise.resolve()
  }

  /** 底层单次读（必须串行调用） */
  async _rawRead() {
    const { value, done } = await this.reader.read()
    if (done) throw new Error('串口已关闭')
    return value || new Uint8Array(0)
  }

  get connected() {
    return !!(this.port && this.port.readable && this.port.writable)
  }

  async connect() {
    if (!webSerialSupported()) throw new Error('当前浏览器不支持 Web Serial（需 Chrome / Edge 等 Chromium 内核）')
    const port = await navigator.serial.requestPort()
    await this.#open(port)
  }

  /** 已授权过的端口列表（无需用户手势） */
  static async listKnownPorts() {
    if (!webSerialSupported()) return []
    try { return await navigator.serial.getPorts() } catch { return [] }
  }

  async connectPort(port) {
    await this.#open(port)
  }

  async #open(port) {
    try {
      await port.open({ baudRate: this.baudRate, flowControl: 'hardware' })
    } catch {
      await port.open({ baudRate: this.baudRate })
    }
    this.port = port
    this.reader = port.readable.getReader()
    this.writer = port.writable.getWriter()
    this._buf = new Uint8Array(0)
    const info = port.getInfo()
    this.device = {
      vendorId: info.usbVendorId || 0,
      productId: info.usbProductId || 0,
      opened: true,
    }
  }

  async close() {
    try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock() } } catch { /* ignore */ }
    try { if (this.writer) this.writer.releaseLock() } catch { /* ignore */ }
    try { if (this.port) await this.port.close() } catch { /* ignore */ }
    this.port = null
    this.reader = null
    this.writer = null
    this.device = null
    this._buf = new Uint8Array(0)
  }

  /** 读一次（length=0）或读到指定长度；并发调用自动入队串行化 */
  read(length = 0) {
    const task = this._readQueue.then(() => this._readImpl(length))
    this._readQueue = task.catch(() => { /* 队列不断链 */ })
    return task
  }

  async _readImpl(length = 0) {
    if (!this.reader) throw new Error('串口未打开')
    if (!length) {
      if (this._buf.length) {
        const out = this._buf
        this._buf = new Uint8Array(0)
        return out
      }
      // 迟到回收数据（被遗弃读 promise 里救回来的字节）优先消费
      const late = takeLate()
      if (late && late.length) return late
      return this._rawRead()
    }
    while (this._buf.length < length) {
      const late = takeLate()
      if (late && late.length) {
        this._buf = concat(this._buf, late)
        continue
      }
      const chunk = await this._rawRead()
      this._buf = concat(this._buf, chunk)
    }
    const out = this._buf.slice(0, length)
    this._buf = this._buf.slice(length)
    return out
  }

  async write(data) {
    if (!this.writer) throw new Error('串口未打开')
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
    if (!u8.length) return
    await this.writer.write(u8)
    // bulk-OUT 长度恰为 64 的整数倍时要补 ZLP，否则设备会把它和下一包粘在一起
    if (u8.length % 64 === 0) {
      try { await this.writer.write(new Uint8Array(0)) } catch { /* ignore */ }
    }
  }
}

export default SerialTransport
