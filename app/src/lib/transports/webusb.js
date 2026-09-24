/**
 * WebUSB 传输通道
 *
 * 直接复用 qdl 自带的 usbClass（它已经实现了 requestDevice / open /
 * claimInterface / transferIn / transferOut），这里只补两件事：
 *   1. 允许「先列出已授权设备再选择」，避免每次都弹系统选择框；
 *   2. 统一 close()，并暴露设备描述信息给 UI。
 */
import { usbClass } from '../qdl/usblib.js'
import { VENDOR_IDS, PRODUCT_ID, QDL_CLASS_CODE } from '../qdl/constants.js'
import { takeLate, hasLate } from '../late-buffer.js'

export const EDL_FILTERS = VENDOR_IDS.map((vendorId) => ({
  vendorId,
  productId: PRODUCT_ID,
  classCode: QDL_CLASS_CODE,
}))

/** 9008 设备是否可能已被系统驱动占用（Windows 常见：需要 WinUSB/libusbK 驱动） */
export function webUsbSupported() {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

function concatBytes(parts) {
  const total = parts.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

export class WebUsbTransport extends usbClass {
  constructor() {
    super()
    this.kind = 'webusb'
  }

  /** 已授权（之前用户手动选择过）的设备列表 */
  async listDevices() {
    if (!webUsbSupported()) return []
    const devices = await navigator.usb.getDevices()
    return devices
      .filter((d) => VENDOR_IDS.includes(d.vendorId) && d.productId === PRODUCT_ID)
      .map((d) => ({ ...describe(d), raw: d }))
  }

  /**
   * QEFT patch：usbClass.read 之上的迟到数据回收。
   * 遗弃读 promise 的结果会经 __qeftLateRebuffer 进入 late-buffer，这里优先消费。
   */
  async read(length = 0) {
    if (!length && hasLate()) {
      const late = takeLate()
      if (late && late.length) return late
    }
    if (length && hasLate()) {
      const parts = []
      let got = 0
      while (got < length && hasLate()) {
        const l = takeLate()
        parts.push(l)
        got += l.length
      }
      if (got >= length) return concatBytes(parts)
      if (got) return concatBytes([concatBytes(parts), await super.read(length - got)])
    }
    return super.read(length)
  }

  /** 弹出系统选择器让用户授权一台设备 */
  async requestDevice() {
    if (!webUsbSupported()) throw new Error('当前浏览器不支持 WebUSB（需 Chrome / Edge 等 Chromium 内核，且为 HTTPS 或 localhost）')
    const device = await navigator.usb.requestDevice({ filters: EDL_FILTERS })
    return describe(device)
  }

  /** 用已授权设备连接（device 来自 listDevices/requestDevice 的返回值） */
  async connectDevice(device) {
    if (!device) throw new Error('未指定设备')
    await this.#open(device)
  }

  async connect() {
    if (!webUsbSupported()) throw new Error('当前浏览器不支持 WebUSB')
    const device = await navigator.usb.requestDevice({ filters: EDL_FILTERS })
    await this.#open(device)
  }

  async #open(device) {
    this.device = device
    const ife = device.configurations?.[0]?.interfaces?.[0]?.alternates?.[0]
    if (!ife || ife.endpoints.length !== 2) {
      throw new Error('USB 接口异常：未找到一对 bulk 端点（设备驱动可能不对，Windows 需用 Zadig 绑定 WinUSB）')
    }
    let epIn = null
    let epOut = null
    for (const ep of ife.endpoints) {
      if (ep.type !== 'bulk') throw new Error('USB 接口端点不是 bulk 类型')
      if (ep.direction === 'in') epIn = ep
      else epOut = ep
    }
    this.epIn = epIn
    this.epOut = epOut
    this.maxSize = epIn.packetSize || 512
    try {
      await device.open()
      await device.selectConfiguration(1)
      await device.claimInterface(0)
    } catch (error) {
      try { await device.close() } catch { /* ignore */ }
      // ---- QEFT patch：细化失败原因，便于用户自查 ----
      const msg = String(error?.message || error)
      if (/not accessible|SecurityError/i.test(msg)) {
        throw new Error('设备被系统类驱动（QDLoader 串口驱动）占用，WebUSB 无法打开。请用 Zadig 重装 WinUSB（「驱动与帮助」页有向导），装完后重启浏览器再连。')
      }
      if (/NotFound/i.test(msg)) {
        throw new Error('设备接口打开失败：上一次会话可能仍占用接口。请完全退出浏览器后重开再试。')
      }
      throw new Error(`打开 USB 设备失败（${msg}）。排查顺序：1) 驱动被换回 QDLoader 串口驱动 → 用 Zadig 重装 WinUSB（「驱动与帮助」页有向导，含 pnputil 根治）；2) 旧会话未释放接口 → 完全退出浏览器重开；3) 设备已离开 9008 → 重进 EDL 再连`, { cause: error })
    }
  }

  async close() {
    try {
      if (this.device?.opened) {
        await this.device.releaseInterface(0).catch(() => {})
        await this.device.close()
      }
    } catch { /* ignore */ }
    this.device = null
    this.epIn = null
    this.epOut = null
  }

  describe() {
    return this.device ? describe(this.device) : null
  }
}

function describe(d) {
  return {
    id: `${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.serialNumber || ''}`,
    kind: 'webusb',
    vendorId: d.vendorId,
    productId: d.productId,
    serial: d.serialNumber || '',
    name: d.productName || d.manufacturerName || 'Qualcomm 9008',
  }
}

export default WebUsbTransport
