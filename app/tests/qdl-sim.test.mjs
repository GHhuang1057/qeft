/**
 * qdl 端到端仿真验证
 *
 * 在没有真机的情况下，用模拟的 9008 设备跑完整链路，验证
 * @andiradulescu/qdl 是否真的可用：
 *
 *   Sahara 握手 → 读取序列号 → 上传 prog_firehose → 切换 Firehose
 *   → configure → 读取主/备 GPT → 刷写分区 → 擦除分区 → 读存储信息 → 重启
 *
 * 运行： node tests/qdl-sim.test.mjs
 */
import { qdlDevice } from '../src/lib/qdl/qdl.js'
import { SimUsb } from '../src/lib/sim/device-sim.js'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${detail}`) }
}

/** 确定性伪随机内容（避免全 0 掩盖 bug） */
function makeProgrammer(size = 24576) {
  const b = new Uint8Array(size)
  let x = 0x1234567
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    b[i] = (x >>> 16) & 0xff
  }
  return b
}

async function main() {
  console.log('=== QEFT · qdl 端到端仿真验证 ===\n')
  const logs = []
  const programmer = makeProgrammer()
  const sim = new SimUsb({ programmerLength: programmer.length, onLog: (l) => logs.push(l) })

  console.log('[1] 连接 + Sahara 上传引导镜像')
  await sim.connect()
  const dev = new qdlDevice(programmer.buffer)
  await dev.connect(sim)
  check('设备模式切换到 firehose', dev.mode === 'firehose', `实际=${dev.mode}`)
  check('引导镜像完整送达设备', sim.loader.length === programmer.length, `${sim.loader.length}/${programmer.length}`)
  check('引导镜像逐字节一致', Buffer.compare(Buffer.from(sim.loader), Buffer.from(programmer)) === 0)
  check('Sahara 读到设备序列号', typeof dev.sahara?.serial === 'string' && dev.sahara.serial.startsWith('0x'), String(dev.sahara?.serial))

  // 模拟器只有一个 LUN，收敛扫描范围
  dev.firehose.luns = [0]

  console.log('\n[2] 读取 GPT 分区表')
  const gpt = await dev.getGpt(0)
  const parts = gpt.getPartitions()
  const names = parts.map((p) => p.name)
  check('解析出分区', parts.length >= 5, `共 ${parts.length} 个`)
  check('包含 boot_a / boot_b', names.includes('boot_a') && names.includes('boot_b'), names.join(','))
  check('包含 system_a / persist', names.includes('system_a') && names.includes('persist'))
  const bootA = parts.find((p) => p.name === 'boot_a')
  check('boot_a 起始 LBA = 64', bootA?.start === 64n, String(bootA?.start))
  check('boot_a 扇区数 = 64', bootA?.sectors === 64n, String(bootA?.sectors))
  console.log(`    分区: ${names.join(', ')}`)

  console.log('\n[3] A/B 槽位识别')
  const slot = gpt.getActiveSlot()
  check('识别出当前活动槽位为 a', slot === 'a', String(slot))

  console.log('\n[4] 刷写分区 (flashBlob boot_a)')
  const payload = new Uint8Array(200 * 1024) // 204800 = 50 × 4096，整扇区对齐
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 7 + 11) & 0xff
  let lastProgress = 0
  const okFlash = await dev.flashBlob('boot_a', new Blob([payload]), (n) => { lastProgress = n })
  check('flashBlob 返回成功', okFlash === true)
  const written = sim.flashed.get(`0:${bootA.start}`)
  check('设备侧收到写入数据', !!written && written.length === payload.length, `${written?.length}/${payload.length}`)
  check('写入内容与源逐字节一致', !!written && Buffer.compare(Buffer.from(written), Buffer.from(payload)) === 0)
  check('进度回调被触发', lastProgress > 0, `last=${lastProgress}`)
  // 回读校验：从设备磁盘把 boot_a 读出来比对
  const reread = sim.readSectors(0, bootA.start, 50)
  check('回读分区内容与写入一致', Buffer.compare(Buffer.from(reread), Buffer.from(payload)) === 0)

  console.log('\n[5] 擦除分区 (erase vendor_a)')
  const okErase = await dev.erase('vendor_a')
  check('erase 返回成功', okErase === true)
  const er = sim.erased.find((e) => e.start === 192n)
  check('设备侧收到 erase 且范围正确', !!er && er.count === 832, sim.erased.map((e) => `lun${e.lun}@${e.start}+${e.count}`).join(','))

  console.log('\n[6] 设备信息')
  const info = await dev.getStorageInfo()
  check('getStorageInfo 返回 UFS', info?.memory_type === 'UFS', JSON.stringify(info))
  const dtype = await dev.getDeviceType()
  check('getDeviceType 有返回', !!dtype, String(dtype))

  console.log('\n[7] 重启')
  const okReset = await dev.reset()
  check('reset 返回成功', okReset === true)

  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
  if (fail) {
    console.log('失败项: ' + failures.join(' | '))
    if (logs.length) console.log('设备日志:\n  ' + logs.join('\n  '))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('\n仿真测试异常终止:', e)
  process.exit(1)
})
