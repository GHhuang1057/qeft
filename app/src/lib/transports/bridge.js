/**
 * 扩展 + 本机 libusb 传输通道
 *
 * 把「页面 → 扩展 → 本机 libusb 宿主」这条链路包装成 qdl 需要的 usbClass 接口。
 * 与 WebUSB 通道相比：不要求页面运行在安全上下文之外也能用，且绕开浏览器
 * WebUSB 对接口占用的限制，直接由本机 libusb 处理（Windows 仍需 WinUSB 驱动）。
 */
import { bridge } from '../bridge.js'

/** 单次写入分片大小：本机消息体以 base64 传输，控制单条消息体积 */
const WRITE_CHUNK = 256 * 1024

export class BridgeTransport {
  constructor() {
    this.kind = 'bridge'
    this.device = null
    this.epIn = { endpointNumber: 1 }
    this.epOut = { endpointNumber: 1 }
    this.maxSize = 512
    this._opened = false
  }

  get connected() { return this._opened }

  async connect(serial = null) {
    const b = bridge()
    await b.connect()
    const list = await b.call('list')
    const devices = list.devices || []
    if (!devices.length) {
      throw new Error('本机未发现 9008 设备（VID 05c6/3801 · PID 9008）。请确认已进入 EDL 且驱动已绑定为 WinUSB/libusbK。')
    }
    const target = serial ? devices.find((d) => d.serial === serial) || devices[0] : devices[0]
    const res = await b.call('open', { serial: target.serial, vid: target.vid, pid: target.pid })
    if (!res.ok) throw new Error(res.error || '打开设备失败')
    this._opened = true
    this.device = target
    this.maxSize = res.maxSize || 512
    return target
  }

  async listDevices() {
    const b = bridge()
    await b.connect()
    const list = await b.call('list')
    return list.devices || []
  }

  async close() {
    if (!this._opened) return
    try { await bridge().call('close') } catch { /* ignore */ }
    this._opened = false
    this.device = null
  }

  async read(length = 0) {
    // 单条本机消息上限 1MB，这里分片取回再拼接
    const total = Number(length || 0)
    if (!total) {
      const res = await bridge().call('read', { length: 0 })
      return res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data || [])
    }
    const out = new Uint8Array(total)
    let got = 0
    while (got < total) {
      const want = Math.min(total - got, 256 * 1024)
      const res = await bridge().call('read', { length: want }, 60000)
      const chunk = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data || [])
      if (!chunk.length) break
      out.set(chunk.subarray(0, Math.min(chunk.length, total - got)), got)
      got += Math.min(chunk.length, total - got)
    }
    return got === total ? out : out.subarray(0, got)
  }

  async write(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data || [])
    if (!u8.length) return
    for (let off = 0; off < u8.length; off += WRITE_CHUNK) {
      const chunk = u8.subarray(off, Math.min(off + WRITE_CHUNK, u8.length))
      await bridge().call('write', { data: chunk }, 60000)
    }
  }
}

export default BridgeTransport
