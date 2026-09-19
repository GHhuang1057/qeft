/**
 * QEFT 模拟设备（Simulated Qualcomm 9008）
 *
 * 实现一个与 qdl 的 `usbClass` 接口兼容（connected / connect / read / write）的假设备，
 * 内部完整模拟：
 *   - Sahara 握手 / 命令模式 / 序列号读取 / 镜像传输（READ_DATA_64 + END_IMAGE_TX + DONE）
 *   - Firehose XML（configure / read / program / erase / power / getstorageinfo / devicetype）
 *   - UFS 磁盘 + 合法的主/备 GPT（含 CRC32）
 *
 * 用途：
 *   1) 在无真机的情况下端到端验证 @andiradulescu/qdl 协议栈是否真的可用；
 *   2) 前端开发 / 演示（QEFT 的「模拟设备」模式）。
 *
 * 协议常量与 qdl 的 saharaDefs.js 保持一致。
 */
import CRC32 from 'crc-32'

/* ------------------------------------------------------------------ *
 * Sahara 协议常量（镜像自 qdl/saharaDefs.js）
 * ------------------------------------------------------------------ */
export const SAHARA_CMD = {
  HELLO_REQ: 0x01,
  HELLO_RSP: 0x02,
  END_TRANSFER: 0x04,
  DONE_REQ: 0x05,
  DONE_RSP: 0x06,
  RESET_RSP: 0x08,
  CMD_READY: 0x0b,
  SWITCH_MODE: 0x0c,
  EXECUTE_REQ: 0x0d,
  EXECUTE_RSP: 0x0e,
  EXECUTE_DATA: 0x0f,
  READ_DATA_64: 0x12,
}
export const SAHARA_MODE = { IMAGE_TX_PENDING: 0x00, COMMAND: 0x03 }
export const SAHARA_STATUS_SUCCESS = 0x00

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */
function concatUint8Array(arrays) {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.byteLength }
  return out
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

/** GUID 字符串 -> 16 字节（与 qdl/gpt-structs.js 的 guid() 布局一致） */
export function guidToBytes(str) {
  const p = String(str).split('-')
  if (p.length !== 5) throw new Error(`Invalid GUID: ${str}`)
  const b = new Uint8Array(16)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, parseInt(p[0], 16), true)
  dv.setUint16(4, parseInt(p[1], 16), true)
  dv.setUint16(6, parseInt(p[2], 16), true)
  const cs = parseInt(p[3], 16)
  dv.setUint8(8, (cs >> 8) & 0xff)
  dv.setUint8(9, cs & 0xff)
  for (let i = 0; i < 6; i++) dv.setUint8(10 + i, parseInt(p[4].substr(i * 2, 2), 16))
  return b
}

export const EFI_UNUSED = '00000000-0000-0000-0000-000000000000'
export const EFI_BASIC_DATA = 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7'

/* ------------------------------------------------------------------ *
 * GPT 构造
 * ------------------------------------------------------------------ */
function buildGptHeader(o) {
  const h = new Uint8Array(92)
  const dv = new DataView(h.buffer)
  for (let i = 0; i < 8; i++) h[i] = 'EFI PART'.charCodeAt(i)
  dv.setUint32(8, 0x00010000, true)   // revision 1.0
  dv.setUint32(12, 92, true)          // headerSize
  dv.setInt32(16, 0, true)            // headerCrc32（计算时置 0）
  dv.setUint32(20, 0, true)           // reserved
  dv.setBigUint64(24, BigInt(o.currentLba), true)
  dv.setBigUint64(32, BigInt(o.alternateLba), true)
  dv.setBigUint64(40, BigInt(o.firstUsableLba), true)
  dv.setBigUint64(48, BigInt(o.lastUsableLba), true)
  h.set(guidToBytes(o.diskGuid), 56)
  dv.setBigUint64(72, BigInt(o.partEntriesStartLba), true)
  dv.setUint32(80, o.numPartEntries, true)
  dv.setUint32(84, o.partEntrySize, true)
  dv.setInt32(88, o.partEntriesCrc32 | 0, true)
  dv.setInt32(16, CRC32.buf(h, 0) | 0, true)
  return h
}

function buildPartEntry({ type, unique, start, end, attributes, name }) {
  const e = new Uint8Array(128)
  const dv = new DataView(e.buffer)
  e.set(guidToBytes(type), 0)
  e.set(guidToBytes(unique), 16)
  dv.setBigUint64(32, BigInt(start), true)
  dv.setBigUint64(40, BigInt(end), true)
  dv.setBigUint64(48, BigInt(attributes), true)
  const n = Math.min(String(name).length, 35)
  for (let i = 0; i < n; i++) dv.setUint16(56 + i * 2, String(name).charCodeAt(i), true)
  return e
}

/** A/B 槽位属性位（Qualcomm ABL，见 qdl/gpt.js） */
export function abAttributes({ priority = 0, active = false, retry = 0, successful = false, unbootable = false } = {}) {
  let a = 0n
  a |= BigInt(priority & 0x3) << 48n
  if (active) a |= 1n << 50n
  a |= BigInt(retry & 0x7) << 51n
  if (successful) a |= 1n << 54n
  if (unbootable) a |= 1n << 55n
  return a
}

/**
 * 构造一个 UFS LUN 的 GPT 扇区集合。
 * 返回 Map<lba, Uint8Array(sectorSize)>，未覆盖的 LBA 读为全 0。
 */
export function buildGptSectors({
  sectorSize = 4096,
  totalSectors = 8192,
  numPartEntries = 128,
  partitions = [],
  diskGuid = '11112222-3333-4444-5555-666677778888',
} = {}) {
  const partEntrySize = 128
  const entriesBytes = numPartEntries * partEntrySize
  const entriesSectors = Math.ceil(entriesBytes / sectorSize)

  const array = new Uint8Array(entriesBytes)
  partitions.forEach((p, i) => {
    array.set(buildPartEntry({
      type: p.type || EFI_BASIC_DATA,
      unique: p.unique || `0000000${(i + 1).toString(16)}-0000-0000-0000-000000000000`,
      start: p.start,
      end: p.end,
      attributes: p.attributes ?? 0n,
      name: p.name,
    }), i * partEntrySize)
  })
  const partEntriesCrc32 = CRC32.buf(array, 0)

  const alternateLba = totalSectors - 1
  const primaryEntriesStart = 2
  const backupEntriesStart = alternateLba - entriesSectors
  const firstUsableLba = primaryEntriesStart + entriesSectors
  const lastUsableLba = backupEntriesStart - 1

  const sectors = new Map()
  const putBytes = (lba, bytes) => {
    let off = 0
    while (off < bytes.length) {
      const s = new Uint8Array(sectorSize)
      const chunk = bytes.subarray(off, Math.min(off + sectorSize, bytes.length))
      s.set(chunk, 0)
      sectors.set(lba, s)
      off += sectorSize
      lba += 1
    }
  }

  putBytes(1, buildGptHeader({
    currentLba: 1, alternateLba,
    firstUsableLba, lastUsableLba, diskGuid,
    partEntriesStartLba: primaryEntriesStart,
    numPartEntries, partEntrySize, partEntriesCrc32,
  }))
  putBytes(primaryEntriesStart, array)
  putBytes(backupEntriesStart, array)
  putBytes(alternateLba, buildGptHeader({
    currentLba: alternateLba, alternateLba: 1,
    firstUsableLba, lastUsableLba, diskGuid,
    partEntriesStartLba: backupEntriesStart,
    numPartEntries, partEntrySize, partEntriesCrc32,
  }))

  return { sectors, totalSectors, sectorSize, alternateLba }
}

/** 默认演示分区表（LUN0） */
export function defaultPartitions() {
  return [
    { name: 'boot_a', start: 64, end: 127, attributes: abAttributes({ priority: 3, active: true, retry: 7 }) },
    { name: 'boot_b', start: 128, end: 191, attributes: abAttributes({ priority: 2 }) },
    { name: 'vendor_a', start: 192, end: 1023 },
    { name: 'vendor_b', start: 1024, end: 1855 },
    { name: 'system_a', start: 1856, end: 5000 },
    { name: 'system_b', start: 5001, end: 8144 },
    { name: 'persist', start: 8145, end: 8186 },
  ]
}

/* ------------------------------------------------------------------ *
 * Sahara 封包
 * ------------------------------------------------------------------ */
function packU32(values) {
  const b = new Uint8Array(values.length * 4)
  const dv = new DataView(b.buffer)
  values.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true))
  return b
}

function helloReq(version = 2, versionSupported = 1, mode = 0) {
  return packU32([SAHARA_CMD.HELLO_REQ, 0x30, version, versionSupported, 0, mode, 0, 0, 0, 0, 0, 0])
}
function cmdReady() { return packU32([SAHARA_CMD.CMD_READY, 0x08]) }
function executeRsp(clientCmd, dataLen) { return packU32([SAHARA_CMD.EXECUTE_RSP, 0x10, clientCmd, dataLen]) }
function readData64(imageId, offset, len) {
  const b = new Uint8Array(32)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, SAHARA_CMD.READ_DATA_64, true)
  dv.setUint32(4, 0x20, true)
  dv.setBigUint64(8, BigInt(imageId), true)
  dv.setBigUint64(16, BigInt(offset), true)
  dv.setBigUint64(24, BigInt(len), true)
  return b
}
function endImageTx(imageId, status) { return packU32([SAHARA_CMD.END_TRANSFER, 0x10, imageId, status]) }
function doneRsp(status = 1) { return packU32([SAHARA_CMD.DONE_RSP, 0x0c, status]) }

/* ------------------------------------------------------------------ *
 * 模拟设备
 * ------------------------------------------------------------------ */
const XML_ENV = '<?xml version="1.0" ?><data>'

function xmlResponse(inner) { return `${XML_ENV}${inner}</data>` }

export class SimUsb {
  /**
   * @param {object} [opts]
   * @param {number} [opts.sectorSize]
   * @param {number} [opts.totalSectors]
   * @param {Array}  [opts.partitions]
   * @param {number} [opts.serial]
   * @param {number} [opts.imageId]
   * @param {number} [opts.saharaChunk]  每次 READ_DATA_64 请求的块大小
   * @param {(line: string) => void} [opts.onLog]
   */
  constructor(opts = {}) {
    // --- usbClass 兼容字段 ---
    this.device = { opened: true }
    this.epIn = { endpointNumber: 1, packetSize: 512, direction: 'in', type: 'bulk' }
    this.epOut = { endpointNumber: 1, packetSize: 512, direction: 'out', type: 'bulk' }
    this.maxSize = 512
    this._connected = false

    this.sectorSize = opts.sectorSize ?? 4096
    this.serial = opts.serial ?? 0x0aa94efd
    this.imageId = opts.imageId ?? 13
    this.saharaChunk = opts.saharaChunk ?? 4096
    /** 待传输引导镜像的总长度；由 armImageTransfer() 或构造参数设定 */
    this._loaderTotal = opts.programmerLength ?? 0
    this._maxRequest = this._loaderTotal
    this.onLog = opts.onLog || (() => {})
    this.storageType = opts.storageType ?? 'UFS'

    const built = buildGptSectors({
      sectorSize: this.sectorSize,
      totalSectors: opts.totalSectors ?? 8192,
      partitions: opts.partitions ?? defaultPartitions(),
    })
    this.sectors = built.sectors
    this.totalSectors = built.totalSectors
    this.alternateLba = built.alternateLba

    /** 设备 -> 主机 的字节流 */
    this._rx = []
    this._rxLen = 0
    /** 主机 -> 设备：Sahara 状态机 */
    this.phase = 'init'          // init | command | imgtx | firehose
    this.loader = new Uint8Array(0)
    /** 主机 -> 设备：Firehose program 状态 */
    this._program = null
    this.flashed = new Map()     // `${lun}:${startSector}` -> Uint8Array（便于测试回读校验）
    this.erased = []
    this.events = []
  }

  get connected() { return this._connected }

  async connect() {
    this._connected = true
    this.phase = 'init'
    // 9008 设备上电即主动发 HELLO
    this._push(helloReq())
    this.onLog('[sim] 设备进入 Sahara，已发出 HELLO_REQ')
    return true
  }

  async close() { this._connected = false }

  /* ---------------- 读通道 ---------------- */
  _push(bytes) {
    let off = 0
    while (off < bytes.length) {
      const chunk = bytes.subarray(off, Math.min(off + this.maxSize, bytes.length))
      this._rx.push(new Uint8Array(chunk))
      this._rxLen += chunk.length
      off += this.maxSize
    }
  }

  /** 等待并取出至多 n 字节；无数据时阻塞到超时返回空 */
  async _take(n, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs
    while (this._rx.length === 0) {
      if (Date.now() > deadline) return new Uint8Array(0)
      await sleep(1)
    }
    const head = this._rx[0]
    if (n >= head.length) { this._rx.shift(); this._rxLen -= head.length; return head }
    const out = head.subarray(0, n)
    this._rx[0] = head.subarray(n)
    this._rxLen -= n
    return new Uint8Array(out)
  }

  async read(length = 0) {
    if (!this._connected) throw new Error('[sim] 未连接')
    if (!length) return this._take(this.maxSize)
    const out = []
    let got = 0
    while (got < length) {
      const chunk = await this._take(Math.min(this.maxSize, length - got))
      if (!chunk.length) break
      out.push(chunk)
      got += chunk.length
    }
    return concatUint8Array(out)
  }

  /* ---------------- 写通道 ---------------- */
  async write(data, _wait = true) {
    if (!data || data.length === 0) return // ZLP
    if (this.phase !== 'firehose' && this._looksLikeSahara(data)) return this._handleSahara(data)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data)
    if (text.includes('<?xml')) return this._handleXml(text)

    // 裸数据：Sahara 镜像传输 or Firehose program 负载
    if (this.phase === 'imgtx') {
      this.loader = concatUint8Array([this.loader, data])
      this.onLog(`[sim] Sahara 收到镜像分片 ${data.length}B（累计 ${this.loader.length}）`)
      if (this._loaderTotal > 0 && this.loader.length >= this._loaderTotal) {
        this._push(endImageTx(this.imageId, SAHARA_STATUS_SUCCESS))
        this.onLog('[sim] 镜像接收完成 -> END_IMAGE_TX(status=0)')
      } else {
        this._nextReadData()
      }
      return
    }
    if (this.phase === 'firehose' && this._program) {
      const p = this._program
      p.buf = concatUint8Array([p.buf, data])
      if (p.buf.length >= p.expected) {
        const payload = p.buf.subarray(0, p.expected)
        this.flashed.set(`${p.lun}:${p.start}`, new Uint8Array(payload))
        this.#writeSectors(p.lun, p.start, payload)
        this.onLog(`[sim] program 完成 LUN${p.lun} @${p.start} ${payload.length}B`)
        this._program = null
        this._push(new TextEncoder().encode(xmlResponse('<response value="ACK" />')))
      }
      return
    }
    this.onLog(`[sim] 忽略未知写入 ${data.length}B`)
  }

  _looksLikeSahara(data) {
    if (data.length < 8) return false
    const cmd = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true)
    const len = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true)
    const known = Object.values(SAHARA_CMD)
    return known.includes(cmd) && len === data.length
  }

  _handleSahara(data) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const cmd = dv.getUint32(0, true)
    switch (cmd) {
      case SAHARA_CMD.HELLO_RSP: {
        const mode = dv.getUint32(20, true)
        if (mode === SAHARA_MODE.COMMAND) {
          this.phase = 'command'
          this._push(cmdReady())
          this.onLog('[sim] HELLO_RSP(mode=command) -> CMD_READY')
        } else {
          this.phase = 'imgtx'
          if (!this._maxRequest) {
            this.onLog('[sim] 警告：未设置 programmerLength，无法分包请求镜像')
          }
          this._nextReadData()
          this.onLog('[sim] HELLO_RSP(mode=image_tx_pending) -> 开始请求镜像')
        }
        return
      }
      case SAHARA_CMD.EXECUTE_REQ: {
        const mcmd = dv.getUint32(8, true)
        this._push(executeRsp(mcmd, 4))
        return
      }
      case SAHARA_CMD.EXECUTE_DATA: {
        const b = new Uint8Array(4)
        new DataView(b.buffer).setUint32(0, this.serial, true)
        this._push(b)
        return
      }
      case SAHARA_CMD.SWITCH_MODE: {
        // 真实设备切换模式后会重新 HELLO
        this.phase = 'init'
        this._push(helloReq())
        this.onLog('[sim] SWITCH_MODE -> 重新 HELLO_REQ')
        return
      }
      case SAHARA_CMD.DONE_REQ: {
        this.phase = 'firehose'
        this._push(doneRsp(1))
        this.onLog('[sim] DONE_REQ -> DONE_RSP(1)，进入 Firehose')
        return
      }
      default:
        this.onLog(`[sim] 未处理的 Sahara 命令 0x${cmd.toString(16)}`)
    }
  }

  _nextReadData() {
    const off = this.loader.length
    const len = Math.min(this.saharaChunk, this._maxRequest - off)
    this._push(readData64(this.imageId, off, len))
  }

  /** 由 UI/测试在传输前告知镜像总长，模拟设备按此分包 */
  armImageTransfer(loaderBytes) {
    this.loader = new Uint8Array(0)
    this._loaderTotal = loaderBytes
    this._maxRequest = loaderBytes
  }
  /* ---------------- Firehose XML ---------------- */
  _handleXml(text) {
    const tag = /<([a-z]+)\s/.exec(text)?.[1] || /<([a-z]+)\s*\/>/.exec(text)?.[1]
    const attr = (k) => {
      const m = new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(text)
      return m ? m[1] : undefined
    }
    this.events.push(tag)
    switch (tag) {
      case 'configure':
        this._push(new TextEncoder().encode(xmlResponse(
          '<log value="INFO: Calling handler for configure" />' +
          `<log value="INFO: Storage type set to value ${this.storageType}" />` +
          `<response value="ACK" MemoryName="${this.storageType}" MaxPayloadSizeToTargetInBytes="1048576" />`,
        )))
        return
      case 'read': {
        const lun = Number(attr('physical_partition_number') || 0)
        const start = BigInt(attr('start_sector'))
        const count = Number(attr('num_partition_sectors'))
        this._push(new TextEncoder().encode(xmlResponse('<response value="ACK" rawmode="true" />')))
        this._push(this.readSectors(lun, start, count))
        this._push(new TextEncoder().encode(xmlResponse('<response value="ACK" rawmode="false" />')))
        this.onLog(`[sim] read LUN${lun} @${start} × ${count}`)
        return
      }
      case 'program': {
        const lun = Number(attr('physical_partition_number') || 0)
        const start = BigInt(attr('start_sector'))
        const count = Number(attr('num_partition_sectors'))
        const sectorSize = Number(attr('SECTOR_SIZE_IN_BYTES') || this.sectorSize)
        this._program = { lun, start, expected: count * sectorSize, buf: new Uint8Array(0) }
        this._push(new TextEncoder().encode(xmlResponse('<response value="ACK" />')))
        this.onLog(`[sim] program LUN${lun} @${start} × ${count} 扇区（等待 ${count * sectorSize}B）`)
        return
      }
      case 'erase': {
        const lun = Number(attr('physical_partition_number') || 0)
        const start = BigInt(attr('start_sector'))
        const count = Number(attr('num_partition_sectors'))
        this.erased.push({ lun, start, count })
        this._push(new TextEncoder().encode(xmlResponse(
          '<log value="INFO: erase succeeded" /><response value="ACK" />',
        )))
        this.onLog(`[sim] erase LUN${lun} @${start} × ${count}`)
        return
      }
      case 'getstorageinfo':
        // 属性值用单引号包裹，内嵌 JSON 的双引号才不会破坏 XML
        this._push(new TextEncoder().encode(xmlResponse(
          `<log value='INFO: ${JSON.stringify({
            storage_info: {
              memory_type: this.storageType,
              total_blocks: this.totalSectors,
              block_size: this.sectorSize,
              num_physical: 1,
            },
          })}' /><response value="ACK" />`,
        )))
        return
      case 'devicetype':
        this._push(new TextEncoder().encode(xmlResponse('<response value="ACK" DeviceType="simulated" />')))
        return
      case 'power':
      case 'setbootablestoragedrive':
      case 'fixgpt':
      case 'nop':
        this._push(new TextEncoder().encode(xmlResponse('<response value="ACK" />')))
        return
      default:
        this._push(new TextEncoder().encode(xmlResponse('<response value="NAK" />')))
    }
  }

  /* ---------------- 磁盘 ---------------- */
  readSectors(lun, startLba, count) {
    const out = new Uint8Array(count * this.sectorSize)
    for (let i = 0; i < count; i++) {
      const lba = Number(startLba) + i
      const s = this.sectors.get(lba)
      if (s) out.set(s, i * this.sectorSize)
    }
    return out
  }

  #writeSectors(lun, startLba, bytes) {
    let off = 0
    let lba = Number(startLba)
    while (off < bytes.length) {
      const cur = this.sectors.get(lba) || new Uint8Array(this.sectorSize)
      const chunk = bytes.subarray(off, Math.min(off + this.sectorSize, bytes.length))
      cur.set(chunk, 0)
      this.sectors.set(lba, cur)
      off += this.sectorSize
      lba += 1
    }
  }
}

export default SimUsb
