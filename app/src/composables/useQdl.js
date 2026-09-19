/**
 * QEFT 主控制器
 *
 * 把 qdl 协议栈 + 传输通道 + 设备状态组织成前端可直接绑定的响应式状态。
 * 所有操作都往 logs 里写结构化日志，并驱动 progress。
 */
import { reactive, ref } from 'vue'
import { qdlDevice } from '../lib/qdl/qdl.js'
import { WebUsbTransport, webUsbSupported } from '../lib/transports/webusb.js'
import { SimUsb } from '../lib/sim/device-sim.js'
import { installLateRebuffer } from '../lib/late-buffer.js'

installLateRebuffer()

export const TRANSPORTS = [
  { id: 'auto', label: '自动（推荐）', hint: '按可用性自动选择通道，静默优先' },
  { id: 'webusb', label: 'WebUSB', hint: '浏览器直连，需 WinUSB 驱动' },
  { id: 'sim', label: '模拟设备', hint: '无真机时验证流程 / 演示' },
]

export function useQdl() {
  const logs = ref([])
  const exports = ref([])   // 导出记录：{ id, name, size, blob, ts }
  let exportSeq = 0
  const busy = ref(false)
  const progress = reactive({ pct: 0, text: '' })
  const luns = ref([])
  const activeLun = ref(0)

  const state = reactive({
    transport: 'auto',
    status: '未连接',
    connected: false,
    mode: null,
    serial: '',
    deviceInfo: null,
    programmer: null,      // { name, size, buffer }
    storageInfo: null,
    deviceType: null,
    activeSlot: null,
    cfg: {
      memoryName: 'UFS',
      skipStorageInit: 0,
      sectorSize: 4096,
      maxlun: 6,
      zlpAwareHost: 1,
      skipWrite: 0,
    },
    lastError: '',
    env: {
      secure: typeof window !== 'undefined' ? !!window.isSecureContext : false,
      origin: typeof location !== 'undefined' ? location.origin : '',
      webusb: webUsbSupported(),
    },
  })

  let transport = null
  let dev = null

  /* ---------------- 日志 ---------------- */
  function log(msg, level = 'info') {
    logs.value.push({ ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level, msg })
    if (logs.value.length > 3000) logs.value.splice(0, logs.value.length - 3000)
  }
  function clearLogs() { logs.value = [] }

  /** 捕获 qdl 内部日志（它直接写 console） */
  function withConsoleCapture(fn) {
    const keys = ['debug', 'info', 'warn', 'error', 'log']
    const orig = {}
    for (const k of keys) orig[k] = console[k]
    const push = (level) => (...args) => {
      const text = args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ')
      if (text) log(text, level === 'log' ? 'info' : level)
    }
    for (const k of keys) console[k] = push(k === 'log' ? 'info' : k)
    try { return fn() } finally { for (const k of keys) console[k] = orig[k] }
  }
  function safeJson(v) {
    try { return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)) } catch { return String(v) }
  }

  function setProgress(pct, text) {
    progress.pct = Math.max(0, Math.min(100, Math.round(pct)))
    progress.text = text || ''
  }

  /* ---------------- 传输通道 ---------------- */

  function createTransport(kind = state.transport) {
    switch (kind) {
      case 'webusb': return new WebUsbTransport()
      case 'sim': {
        const sim = new SimUsb({
          onLog: (l) => log(l, 'debug'),
        })
        return sim
      }
      default: throw new Error(`未知传输通道：${kind}`)
    }
  }

  async function listDevices() {
    try {
      const t = new WebUsbTransport()
      if (state.transport === 'webusb' || state.transport === 'auto') return await t.listDevices()
      return []
    } catch (e) {
      log(`枚举设备失败: ${e.message || e}`, 'error')
      return []
    }
  }

  /* ---------------- 引导镜像 ---------------- */
  function setProgrammer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const buf = reader.result
        state.programmer = { name: file.name, size: file.size, buffer: buf }
        if (state.transport === 'sim') {
          // 模拟器需要提前知道镜像总长才能分包请求
          transport = createTransport('sim')
          transport.armImageTransfer(buf.byteLength)
        }
        log(`已加载引导镜像 ${file.name}（${(file.size / 1024).toFixed(1)} KB）`)
        resolve(state.programmer)
      }
      reader.onerror = () => reject(new Error('读取引导镜像失败'))
      reader.readAsArrayBuffer(file)
    })
  }

  /* ---------------- 连接（自动通道选择） ---------------- */

  /**
   * 组装自动连接计划：已授权设备静默直连，其次弹一次授权框。
   */
  async function buildConnectPlan() {
    const plan = []
    try {
      const t = new WebUsbTransport()
      for (const d of await t.listDevices()) {
        plan.push({ kind: 'webusb', label: `WebUSB（已授权 ${d.name}）`, device: d.raw })
      }
    } catch { /* ignore */ }
    if (state.env.webusb) plan.push({ kind: 'webusb', label: 'WebUSB（弹窗选择）' })
    return plan
  }

  async function openTransport(kind, step = {}) {
    if (kind === 'webusb' && step.device) { await transport.connectDevice(step.device); return }
    await transport.connect()
  }

  /** 传输层打通后的 qdl 握手 + Configure（与通道无关） */
  async function qdlHandshake() {
    const device = new qdlDevice(state.programmer.buffer)
    await withConsoleCapture(() => device.connect(transport))

    state.connected = true
    state.mode = device.mode
    state.serial = device.sahara?.serial || ''
    dev = device
    log(`已进入 Firehose${state.serial ? ` · 序列号 ${state.serial}` : ''}`)

    // qdl 内部 connect() 会用默认配置跑一次 configure；若用户改过配置则重新下发
    const fh = device.firehose
    const c = state.cfg
    const needsReconfigure =
      fh.cfg.MemoryName !== c.memoryName ||
      Number(fh.cfg.SkipStorageInit) !== Number(c.skipStorageInit) ||
      Number(fh.cfg.SECTOR_SIZE_IN_BYTES) !== Number(c.sectorSize) ||
      Number(fh.cfg.maxlun) !== Number(c.maxlun) ||
      Number(fh.cfg.ZLPAwareHost) !== Number(c.zlpAwareHost)
    if (needsReconfigure) {
      fh.cfg.MemoryName = c.memoryName
      fh.cfg.SkipStorageInit = Number(c.skipStorageInit)
      fh.cfg.SECTOR_SIZE_IN_BYTES = Number(c.sectorSize)
      fh.cfg.maxlun = Number(c.maxlun)
      fh.cfg.ZLPAwareHost = Number(c.zlpAwareHost)
      log(`重新下发 Configure：MemoryName=${c.memoryName} 扇区=${c.sectorSize} LUN 数=${c.maxlun}`)
      await withConsoleCapture(() => fh.configure())
    }
    return device
  }

  async function connect() {
    if (!state.programmer) { log('请先选择 prog_firehose 引导镜像', 'error'); return false }
    busy.value = true
    state.status = '连接中…'
    state.lastError = ''
    setProgress(0, '准备连接')

    // sim 是显式手动模式，不走自动计划
    const auto = state.transport === 'auto'
    let plan = auto ? await buildConnectPlan() : [{ kind: state.transport, label: TRANSPORTS.find((t) => t.id === state.transport)?.label || state.transport }]
    if (!plan.length) {
      log('没有可用通道：未发现桥接扩展 / 已授权端口 / 已授权设备，且浏览器缺少弹窗通道。检查驱动与扩展后再试', 'error')
      state.status = '连接失败（无可用通道）'
      busy.value = false
      return false
    }
    log(`自动通道计划（${plan.length} 步）：${plan.map((p) => p.label).join(' → ')}`, 'debug')

    let lastErr = null
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i]
      state.status = `连接中（${step.label}）…`
      setProgress((i / plan.length) * 80, `尝试 ${step.label}`)
      try {
        transport = createTransport(step.kind)
        if (step.kind === 'sim') transport.armImageTransfer(state.programmer.buffer.byteLength)
        await openTransport(step.kind, step)
        log(`通道就绪：${step.label}`)
        await qdlHandshake()
        state.transport = step.kind
        state.status = '已连接'
        setProgress(100, '已连接')
        state.deviceInfo = transport.device ? { vid: transport.device.vendorId, pid: transport.device.productId } : null
        log(`Firehose 就绪 · LUN 列表 ${dev.firehose.luns.join(',')}`)
        busy.value = false
        return true
      } catch (e) {
        lastErr = e
        const msg = String(e.message || e)
        log(`[${step.label}] 失败: ${msg.slice(0, 180)}`, 'warn')
        // 浏览器一次用户手势只允许弹一个授权框；手势耗尽后继续跑只会报错，
        // 直接终止本轮并提示用户再点一次连接
        if (/user gesture/i.test(msg)) {
          state.lastError = '授权弹窗未完成：请再点一次「连接设备」，在弹窗中选中设备后确认'
          log(state.lastError, 'warn')
          state.status = '等待再次点击连接'
          busy.value = false
          return false
        }
        try { await transport?.close?.() } catch { /* ignore */ }
        transport = null
        if (auto) {
          const rest = await buildConnectPlan()
          plan = plan.slice(0, i + 1).concat(rest.filter((r) => !plan.slice(0, i + 1).some((p) => p.label === r.label)))
        }
      }
    }

    state.lastError = String(lastErr?.message || lastErr || '所有通道均失败')
    log(`连接失败（已尝试所有通道）: ${state.lastError}`, 'error')
    state.status = '连接失败'
    busy.value = false
    return false
  }

  async function disconnect() {
    try { if (transport) await transport.close() } catch { /* ignore */ }
    transport = null
    dev = null
    state.connected = false
    state.mode = null
    state.status = '已断开'
    luns.value = []
    log('已断开设备')
  }

  function requireDevice() {
    if (!dev) throw new Error('尚未连接设备')
    return dev
  }

  /* ---------------- 分区表 ---------------- */
  async function scanPartitions() {
    const d = requireDevice()
    busy.value = true
    state.status = '读取分区表…'
    setProgress(0, '读取分区表')
    const out = []
    try {
      const list = d.firehose.luns?.length ? d.firehose.luns : [0]
      for (let i = 0; i < list.length; i++) {
        const lun = list[i]
        setProgress((i / list.length) * 100, `读取 LUN${lun}`)
        try {
          const gpt = await withConsoleCapture(() => d.getGpt(lun))
          const parts = gpt.getPartitions().map((p) => ({
            name: p.name,
            start: p.start,
            end: p.end,
            sectors: p.sectors,
            sizeBytes: Number(p.sectors) * Number(gpt.sectorSize),
            attributes: p.attributes,
            type: p.type,
            uuid: p.uuid,
          }))
          if (parts.length) {
            out.push({ lun, sectorSize: Number(gpt.sectorSize), partitions: parts })
            log(`LUN${lun}: ${parts.length} 个分区（扇区 ${gpt.sectorSize}B）`)
          }
        } catch (e) {
          log(`LUN${lun} 读取失败: ${String(e.message || e).slice(0, 160)}`, 'warn')
        }
      }
      luns.value = out
      activeLun.value = out.length ? out[0].lun : 0
      state.status = out.length ? `分区表已加载（${out.length} 个 LUN）` : '未读到任何分区表'
      setProgress(100, state.status)
      return out
    } catch (e) {
      log(`读取分区表失败: ${e.message || e}`, 'error')
      state.status = '读取分区表失败'
      return []
    } finally {
      busy.value = false
    }
  }

  /* ---------------- 刷写 / 擦除 / 读取 ---------------- */
  async function flashPartition(name, file) {
    const d = requireDevice()
    busy.value = true
    state.status = `刷写 ${name}…`
    const total = file.size
    try {
      const ok = await withConsoleCapture(() => d.flashBlob(name, file, (n) => {
        setProgress(total ? (n / total) * 100 : 0, `刷写 ${name} ${fmtBytes(n)}/${fmtBytes(total)}`)
      }))
      if (!ok) throw new Error('设备返回失败')
      log(`刷写完成：${name} ← ${file.name}（${fmtBytes(total)}）`)
      state.status = `已刷写 ${name}`
      setProgress(100, `已刷写 ${name}`)
      return true
    } catch (e) {
      log(`刷写 ${name} 失败: ${e.message || e}`, 'error')
      state.status = '刷写失败'
      return false
    } finally {
      busy.value = false
    }
  }

  async function erasePartition(name) {
    const d = requireDevice()
    if (!window.confirm(`确认擦除分区 ${name}？该操作不可撤销。`)) return false
    busy.value = true
    try {
      await withConsoleCapture(() => d.erase(name))
      log(`已擦除分区 ${name}`)
      state.status = `已擦除 ${name}`
      return true
    } catch (e) {
      log(`擦除 ${name} 失败: ${e.message || e}`, 'error')
      return false
    } finally {
      busy.value = false
    }
  }

  async function readPartition({ lun, start, sectors, fileName }) {
    const d = requireDevice()
    busy.value = true
    state.status = `读取 ${fileName}…`
    // 分块回读：单次命令过大既容易超时，也没有进度反馈
    const CHUNK_SECTORS = 2048 // 4096B 扇区下约 8MB/块
    try {
      const sectorSize = Number(d.firehose.cfg.SECTOR_SIZE_IN_BYTES) || 4096
      const total = Number(sectors)
      const parts = []
      for (let off = 0; off < total; off += CHUNK_SECTORS) {
        const n = Math.min(CHUNK_SECTORS, total - off)
        setProgress((off / total) * 100, `读取 ${fileName} ${fmtBytes(off * sectorSize)}/${fmtBytes(total * sectorSize)}`)
        const buf = await withConsoleCapture(() => d.firehose.cmdReadBuffer(lun, BigInt(start) + BigInt(off), n))
        parts.push(buf)
      }
      let size = 0
      for (const p of parts) size += p.length
      const merged = new Uint8Array(size)
      let pos = 0
      for (const p of parts) { merged.set(p, pos); pos += p.length }
      const blob = new Blob([merged])
      downloadBlob(blob, fileName)
      // 记录导出，允许随时重新保存（只留最近几份，防内存爆）
      exports.value.unshift({ id: `e${++exportSeq}`, name: fileName, size: merged.length, blob, ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
      const MAX_EXPORTS = 3
      const totalBytes = () => exports.value.reduce((s, x) => s + x.size, 0)
      while (exports.value.length > MAX_EXPORTS || totalBytes() > 512 * 1024 * 1024) {
        if (exports.value.length <= 1) { exports.value.splice(1); break }
        exports.value.pop()
      }
      log(`已导出 ${fileName}（${fmtBytes(merged.length)}，${Math.ceil(total / CHUNK_SECTORS)} 块）· 已保存到浏览器下载目录`)
      state.status = '导出完成'
      setProgress(100, '导出完成')
      return merged
    } catch (e) {
      log(`读取失败: ${e.message || e}`, 'error')
      log('提示：回读中途失败后设备流可能残留数据，建议点一次「重启」重新进 9008 再操作', 'warn')
      state.status = '读取失败'
      return null
    } finally {
      busy.value = false
    }
  }

  /**
   * 按 rawprogram.xml 批量刷写。
   * entries 由 parseRawProgram() 产生；fileMap: filename -> File/Blob
   */
  async function flashRawProgram(entries, fileMap) {
    const d = requireDevice()
    busy.value = true
    const fh = d.firehose
    const sectorSize = Number(fh.cfg.SECTOR_SIZE_IN_BYTES)
    let done = 0
    try {
      for (const e of entries) {
        const file = fileMap[e.filename] || fileMap[e.filename?.toLowerCase()]
        if (!file) { log(`跳过 ${e.filename}（未提供文件）`, 'warn'); continue }
        const ss = Number(e.SECTOR_SIZE_IN_BYTES || sectorSize)
        const start = BigInt(e.start_sector)
        const sectors = Number(e.num_partition_sectors)
        setProgress((done / entries.length) * 100, `刷写 ${e.filename}`)
        const savedSectorSize = fh.cfg.SECTOR_SIZE_IN_BYTES
        fh.cfg.SECTOR_SIZE_IN_BYTES = ss
        try {
          const offset = Number(e.file_sector_offset || 0) * ss
          const length = Math.min(Number(e.size_in_bytes || 0) || file.size - offset, file.size - offset)
          const blob = file.slice(offset, offset + length)
          const ok = await withConsoleCapture(() => fh.cmdProgram(Number(e.physical_partition_number || 0), start, blob, () => {}))
          if (!ok) throw new Error(`设备拒绝 ${e.filename}`)
          log(`[${++done}/${entries.length}] ${e.filename} → LUN${e.physical_partition_number || 0} @${start} × ${sectors}`)
        } finally {
          fh.cfg.SECTOR_SIZE_IN_BYTES = savedSectorSize
        }
      }
      setProgress(100, `批量刷写完成（${done} 项）`)
      state.status = `批量刷写完成（${done} 项）`
      return done
    } catch (e) {
      log(`批量刷写失败: ${e.message || e}`, 'error')
      state.status = '批量刷写失败'
      return done
    } finally {
      busy.value = false
    }
  }

  /* ---------------- 其它设备操作 ---------------- */

  /**
   * 通用擦除：设备分区表行按分区名擦除；XML / 自定义地址行按扇区范围擦除。
   * rows: [{ source, name, lun, start, sectors }]
   * 返回成功擦除的数量。
   */
  async function eraseRows(rows) {
    const d = requireDevice()
    if (!rows.length) return 0
    if (!window.confirm(`确认擦除选中的 ${rows.length} 个分区？\n该操作不可撤销，数据将全部丢失。`)) return 0
    busy.value = true
    let done = 0
    try {
      for (const r of rows) {
        setProgress((done / rows.length) * 100, `擦除 ${r.name}`)
        if (r.source === 'device') {
          await withConsoleCapture(() => d.erase(r.name))
        } else {
          await withConsoleCapture(() => d.firehose.cmdErase(Number(r.lun || 0), BigInt(r.start), Number(r.sectors)))
        }
        log(`已擦除 ${r.name}（LUN${r.lun} @${r.start} × ${r.sectors}）`)
        done += 1
      }
      setProgress(100, `擦除完成（${done} 项）`)
      state.status = `擦除完成（${done} 项）`
      return done
    } catch (e) {
      log(`擦除失败: ${e.message || e}`, 'error')
      state.status = '擦除失败'
      return done
    } finally {
      busy.value = false
    }
  }

  /** 恢复出厂：擦除所有 LUN（保留分区表与 persist），等价 qdl eraseLun(preserve) */
  async function eraseFactory() {
    const d = requireDevice()
    const luns = d.firehose.luns?.length ? d.firehose.luns : [0]
    if (!window.confirm(`恢复出厂将擦除 ${luns.length} 个 LUN 的全部数据（仅保留分区表 / persist）。\n确认继续？`)) return false
    busy.value = true
    try {
      for (const lun of luns) {
        setProgress((lun / luns.length) * 100, `擦除 LUN${lun}`)
        await withConsoleCapture(() => d.eraseLun(lun))
        log(`LUN${lun} 已擦除（保留 gpt/mbr/persist）`)
      }
      setProgress(100, '恢复出厂完成')
      state.status = '恢复出厂完成'
      return true
    } catch (e) {
      log(`恢复出厂失败: ${e.message || e}`, 'error')
      state.status = '恢复出厂失败'
      return false
    } finally {
      busy.value = false
    }
  }

  /** 自定义地址 / 单条 XML 行刷写：直接按扇区写入 */
  async function programRaw({ lun = 0, start, sectors, sectorSize, blob, label = 'raw' }) {
    const d = requireDevice()
    const fh = d.firehose
    busy.value = true
    const saved = fh.cfg.SECTOR_SIZE_IN_BYTES
    if (sectorSize) fh.cfg.SECTOR_SIZE_IN_BYTES = Number(sectorSize)
    try {
      const ok = await withConsoleCapture(() => fh.cmdProgram(Number(lun), BigInt(start), blob, (n) => {
        setProgress(blob.size ? (n / blob.size) * 100 : 0, `刷写 ${label} ${fmtBytes(n)}/${fmtBytes(blob.size)}`)
      }))
      if (!ok) throw new Error('设备返回失败')
      log(`已写入 ${label} → LUN${lun} @${start} × ${sectors}`)
      state.status = `已写入 ${label}`
      setProgress(100, `已写入 ${label}`)
      return true
    } catch (e) {
      log(`写入 ${label} 失败: ${e.message || e}`, 'error')
      state.status = '写入失败'
      return false
    } finally {
      fh.cfg.SECTOR_SIZE_IN_BYTES = saved
      busy.value = false
    }
  }

  async function getStorageInfo() {
    try {
      const info = await withConsoleCapture(() => requireDevice().getStorageInfo())
      state.storageInfo = info
      log(`存储信息: ${safeJson(info)}`)
      return info
    } catch (e) { log(`读取存储信息失败: ${e.message || e}`, 'warn'); return null }
  }

  async function getDeviceType() {
    try {
      const t = await withConsoleCapture(() => requireDevice().getDeviceType())
      state.deviceType = t
      log(`设备类型: ${t}`)
      return t
    } catch {
      // 大量 prog_firehose 没实现 <devicetype> 指令，属于正常现象，不算失败
      log('设备未实现 <devicetype> 指令（部分 prog 不支持，可忽略）', 'debug')
      return null
    }
  }

  async function setActiveSlot(slot) {
    try {
      await withConsoleCapture(() => requireDevice().setActiveSlot(slot))
      state.activeSlot = slot
      log(`已切换活动槽位为 ${slot.toUpperCase()}`)
      return true
    } catch (e) { log(`切换槽位失败: ${e.message || e}`, 'error'); return false }
  }

  async function reset() {
    try {
      // 若之前有回读中途失败，流里可能残留 raw 数据；先短超时排空再发重启，
      // 否则 power 命令的应答会被残渣挤掉导致超时
      try {
        for (let i = 0; i < 8; i++) {
          const idle = await Promise.race([
            transport?.read?.() ?? Promise.resolve(null),
            new Promise((r) => setTimeout(() => r(null), 150)),
          ])
          if (!idle || !idle.length) break
          log(`重启前排空残留数据 ${idle.length}B`, 'debug')
        }
      } catch { /* ignore */ }
      await withConsoleCapture(() => requireDevice().reset())
      log('已发送重启命令')
      await disconnect()
      return true
    } catch (e) {
      log(`重启失败: ${e.message || e}（设备可能已离开 Firehose，重进 9008 即可）`, 'error')
      state.status = '重启失败（设备可能已重启，直接重进 9008）'
      return false
    }
  }

  /* ---------------- 导出 ---------------- */
  function saveExport(id) {
    const item = exports.value.find((x) => x.id === id)
    if (!item) return
    downloadBlob(item.blob, item.name)
    log(`已重新保存 ${item.name}（${fmtBytes(item.size)}）到浏览器下载目录`)
  }

  function exportPartitionsCsv() {
    const cur = luns.value.find((l) => l.lun === activeLun.value)
    if (!cur) { log('暂无分区表可导出', 'warn'); return }
    const header = ['lun', 'name', 'first_lba', 'last_lba', 'sectors', 'size_bytes', 'size_human', 'attributes', 'type', 'uuid']
    const rows = [header.join(',')].concat(cur.partitions.map((p) => [
      cur.lun, `"${String(p.name).replace(/"/g, '""')}"`, p.start, p.end, p.sectors,
      p.sizeBytes, fmtBytes(p.sizeBytes), p.attributes, p.type, p.uuid,
    ].join(',')))
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), `qeft_gpt_lun${cur.lun}.csv`)
    log('已导出分区表 CSV')
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return reactive({
    state, logs, busy, progress, luns, activeLun, exports,
    saveExport,
    listDevices, setProgrammer, connect, disconnect,
    scanPartitions, flashPartition, erasePartition, readPartition, flashRawProgram,
    eraseRows, eraseFactory, programRaw,
    getStorageInfo, getDeviceType, setActiveSlot, reset,
    exportPartitionsCsv, clearLogs, log,
  })
}

/* ---------------- rawprogram.xml 解析 ---------------- */
export function parseRawProgram(xmlText) {
  const entries = []
  const re = /<program\s+([^>]+?)\/?>/g
  let m
  while ((m = re.exec(xmlText))) {
    const attrs = m[1]
    const get = (k) => {
      const mm = new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(attrs)
      return mm ? mm[1] : ''
    }
    entries.push({
      filename: get('filename'),
      label: get('label'),
      start_sector: get('start_sector'),
      num_partition_sectors: get('num_partition_sectors'),
      physical_partition_number: get('physical_partition_number'),
      SECTOR_SIZE_IN_BYTES: get('SECTOR_SIZE_IN_BYTES'),
      file_sector_offset: get('file_sector_offset'),
      size_in_bytes: get('size_in_bytes'),
    })
  }
  return entries
}

export function fmtBytes(n) {
  const v = Number(n || 0)
  if (v < 1024) return `${v} B`
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(2)} MB`
  return `${(v / 1024 ** 3).toFixed(2)} GB`
}

export default useQdl
