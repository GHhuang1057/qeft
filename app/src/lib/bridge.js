/**
 * QEFT 扩展桥接客户端
 *
 * 浏览器页面本身拿不到 libusb。链路是：
 *
 *   页面(main world) ──postMessage──▶ 内容脚本(isolated) ──chrome.runtime──▶ 后台 SW
 *        ──chrome.runtime.connectNative──▶ 本机 qeft-host（Node + node-usb/libusb）
 *                                              └──▶ USB 设备
 *
 * 页面侧只需要 window.QEFT（由扩展以 MAIN world 注入）。若扩展未安装，
 * 退化为 externally_connectable 直连（需要已知扩展 ID）。
 *
 * 二进制在浏览器内部用 Uint8Array 结构化克隆传递，只有到本机宿主那一跳才转 base64。
 */

const DEFAULT_TIMEOUT = 20000
export const EXT_ID = 'bflfbjgpjlhhgajeimapcodifjhmaloo'

export class BridgeClient {
  constructor() {
    this._seq = 0
    this._source = null
    this._ready = null
    this._extPort = null
    this._pending = new Map()
  }

  /** 探测可用的桥接方式；返回 { available, source, extId } */
  static detect() {
    if (typeof window === 'undefined') return { available: false, source: null }
    if (window.QEFT && typeof window.QEFT.request === 'function') {
      return { available: true, source: 'content-script', extId: window.QEFT.extId || EXT_ID }
    }
    if (typeof window.chrome?.runtime?.connect === 'function') {
      return { available: true, source: 'externally-connectable', extId: EXT_ID }
    }
    return { available: false, source: null, extId: null }
  }

  async connect() {
    if (this._ready) return this._ready
    this._ready = (async () => {
      const d = BridgeClient.detect()
      if (!d.available) throw new Error('未检测到 QEFT 桥接扩展（请先安装扩展并确认本机宿主已注册）')
      this._source = d.source
      const info = await this.call('hello', {}, 10000)
      return { source: d.source, ...info }
    })()
    return this._ready
  }

  call(op, params = {}, timeoutMs = DEFAULT_TIMEOUT) {
    const id = `q${++this._seq}`
    if (this._source === 'content-script' || BridgeClient.detect().source === 'content-script') {
      return window.QEFT.request(op, params, timeoutMs)
    }
    return this.#callExternally(id, op, params, timeoutMs)
  }

  /** externally_connectable 直连（扩展未注入内容脚本时的兜底） */
  #callExternally(id, op, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this._extPort) {
        try {
          this._extPort = window.chrome.runtime.connect(EXT_ID, { name: 'qeft-bridge' })
        } catch (e) {
          return reject(new Error(`无法连接 QEFT 扩展：${e.message || e}`))
        }
        this._extPort.onMessage.addListener((msg) => {
          const p = this._pending.get(msg.id)
          if (!p) return
          this._pending.delete(msg.id)
          clearTimeout(p.timer)
          msg.ok === false ? p.reject(new Error(msg.error || '桥接调用失败')) : p.resolve(msg)
        })
        this._extPort.onDisconnect.addListener(() => {
          const err = window.chrome.runtime.lastError
          const msg = err?.message ? `扩展连接已断开：${err.message}` : '扩展连接已断开'
          for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(new Error(msg)) }
          this._pending.clear()
          this._extPort = null
        })
      }
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error(`桥接调用超时：${op}（${timeoutMs}ms）`))
      }, timeoutMs)
      this._pending.set(id, { resolve, reject, timer })
      try {
        this._extPort.postMessage({ id, op, params })
      } catch (e) {
        clearTimeout(timer)
        this._pending.delete(id)
        reject(new Error(`桥接发送失败：${e.message || e}`))
      }
    })
  }

  disconnect() {
    try { this._extPort?.disconnect?.() } catch { /* ignore */ }
    this._extPort = null
    this._ready = null
    this._pending.clear()
  }
}

let _client = null
export function bridge() {
  if (!_client) _client = new BridgeClient()
  return _client
}

export default bridge
