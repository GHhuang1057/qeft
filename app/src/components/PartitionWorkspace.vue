<template>
  <section class="qeft-work">
    <div class="qeft-work__main">
    <!-- 数据源 -->
    <div class="qeft-toolbar__row gh-mb3">
      <label class="gh-check">
        <input v-model="source" type="radio" value="device" name="qeft-src" :disabled="q.busy" />
        <span>使用设备分区表</span>
      </label>
      <button class="gh-btn gh-btn--sm" :aria-disabled="!q.state.connected || q.busy" @click="onScan">读取设备分区表</button>

      <label class="gh-check">
        <input v-model="source" type="radio" value="xml" name="qeft-src" :disabled="q.busy" />
        <span>使用XML</span>
      </label>
      <label class="gh-btn gh-btn--sm gh-btn--outline qeft-filebtn">
        选择XML
        <input type="file" accept=".xml" hidden @change="onXml" />
      </label>
      <label class="gh-btn gh-btn--sm gh-btn--outline qeft-filebtn">
        选择镜像目录
        <input type="file" multiple hidden @change="onImages" />
      </label>

      <label class="gh-check">
        <input v-model="source" type="radio" value="custom" name="qeft-src" :disabled="q.busy" />
        <span>使用自定义地址</span>
      </label>
      <button class="gh-btn gh-btn--sm" :disabled="source !== 'custom' || q.busy" @click="addCustomRow">添加</button>
      <button class="gh-btn gh-btn--sm" :disabled="source !== 'custom' || !selected.size || q.busy" @click="removeSelected">删除</button>
    </div>

    <div v-if="xmlName" class="qeft-muted gh-mb3">
      XML: <span class="qeft-kbd">{{ xmlName }}</span> · {{ rows.length }} 条 ·
      镜像文件 {{ imageCount }} 个
    </div>

    <!-- 搜索与筛选 -->
    <div class="qeft-toolbar__row gh-mb3">
      <span class="qeft-toolbar__label">搜索分区:</span>
      <input v-model="keyword" class="gh-input qeft-search" type="search" placeholder="输入分区名…" />
      <span class="qeft-toolbar__label">
        已选择: {{ selected.size }} <span class="qeft-muted">/ 共 {{ rows.length }} 项 · {{ fmtBytes(selectedBytes) }}</span>
      </span>
      <label class="gh-check"><input v-model="filters.all" type="checkbox" /><span>全选</span></label>
      <label class="gh-check"><input v-model="filters.userdata" type="checkbox" /><span>用户数据分区</span></label>
      <label class="gh-check"><input v-model="filters.gpt" type="checkbox" /><span>分区表</span></label>
    </div>

    <!-- 主表 -->
    <div class="gh-table-wrap qeft-tablebox">
      <table class="gh-table qeft-table">
        <thead>
          <tr>
            <th style="width: 34px"></th>
            <th style="width: 70px">LUN</th>
            <th style="width: 48px">#</th>
            <th>标签</th>
            <th>起始扇区</th>
            <th>大小</th>
            <th>文件</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filtered.length">
            <td colspan="7">
              <div class="gh-empty">
                <div class="gh-empty__title">暂无分区数据</div>
                <div>
                  {{ source === 'device'
                    ? '连接设备后点「读取设备分区表」'
                    : source === 'xml'
                      ? '选择 rawprogram*.xml 与对应镜像文件'
                      : '点「添加」新增一条自定义地址' }}
                </div>
              </div>
            </td>
          </tr>
          <tr v-for="(r, i) in filtered" :key="r.key" :class="{ 'qeft-row--selected': selected.has(r.key) }">
            <td><input v-model="checked" type="checkbox" :value="r.key" :disabled="q.busy" /></td>
            <td>{{ r.lun }}</td>
            <td class="qeft-part__num">{{ i + 1 }}</td>
            <td class="qeft-part__name">{{ r.name }}</td>
            <td class="qeft-part__num">{{ r.start }}</td>
            <td>{{ fmtBytes(r.sizeBytes) }}</td>
            <td>
              <span v-if="r.file" class="gh-badge gh-badge--success" :title="r.file.name">{{ r.file.name }}</span>
              <label v-else class="gh-btn gh-btn--sm gh-btn--subtle qeft-filebtn">
                选择文件
                <input type="file" hidden @change="(e) => onRowFile(e, r)" />
              </label>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 进度 -->
    <div v-if="q.progress.text" class="qeft-progress-row gh-mt3">
      <div class="gh-progress"><div class="gh-progress__bar" :style="{ width: q.progress.pct + '%' }"></div></div>
      <span class="qeft-muted">{{ q.progress.text }} · {{ q.progress.pct }}%</span>
    </div>
    <!-- 导出记录 -->
    <div v-if="q.exports.length" class="qeft-toolbar qeft-mt3">
      <div class="qeft-toolbar__row">
        <span class="qeft-toolbar__label">导出记录</span>
        <span class="qeft-muted">（保存在浏览器「下载」文件夹，可重新保存）</span>
      </div>
      <div v-for="x in q.exports" :key="x.id" class="qeft-toolbar__row qeft-mt2">
        <span class="gh-mono">{{ x.name }}</span>
        <span class="qeft-muted">{{ fmtBytes(x.size) }} · {{ x.ts }}</span>
        <div class="gh-toolbar__spacer"></div>
        <button class="gh-btn gh-btn--sm gh-btn--outline" @click="q.saveExport(x.id)">重新保存</button>
      </div>
    </div>
    </div>

    <!-- 右侧操作栏 -->
    <aside class="qeft-rail">
      <div class="qeft-rail__head" @click="rail.basic = !rail.basic">
        <span>基础操作</span>
        <span class="qeft-rail__chev">{{ rail.basic ? '⌃' : '⌄' }}</span>
      </div>
      <div v-show="rail.basic" class="qeft-rail__body">
        <button class="qeft-rail__btn" :aria-disabled="!q.state.connected || q.busy" @click="onReadInfo">读信息</button>
        <button class="qeft-rail__btn" :aria-disabled="!canFlash || q.busy" @click="onFlash">刷入 (已选{{ flashCount }})</button>
        <button class="qeft-rail__btn" :aria-disabled="!canFlash || q.busy" @click="onDump">回读 (已选{{ selectedRows.length }})</button>
        <div class="qeft-rail__group">
          <button class="qeft-rail__btn" :aria-disabled="!selectedRows.length || q.busy" @click="onErase">擦除 (已选{{ selectedRows.length }})</button>
        </div>
        <div class="qeft-rail__group">
          <button class="qeft-rail__btn qeft-rail__btn--danger" :aria-disabled="!q.state.connected || q.busy" @click="onFactory">恢复出厂设置</button>
        </div>
        <button class="qeft-rail__btn" :aria-disabled="!q.state.connected || q.busy" @click="onReset">重启</button>
      </div>

      <div class="qeft-rail__head gh-mt4" @click="rail.more = !rail.more">
        <span>更多功能</span>
        <span class="qeft-rail__chev">{{ rail.more ? '⌃' : '⌄' }}</span>
      </div>
      <div v-show="rail.more" class="qeft-rail__body">
        <div class="qeft-row gh-mb2">
          <button class="gh-btn gh-btn--sm gh-btn--outline" :aria-disabled="q.busy" @click="q.setActiveSlot('a')">槽位 A</button>
          <button class="gh-btn gh-btn--sm gh-btn--outline" :aria-disabled="q.busy" @click="q.setActiveSlot('b')">槽位 B</button>
          <span class="qeft-muted">当前: {{ (q.state.activeSlot || '—').toUpperCase() }}</span>
        </div>
        <button class="qeft-rail__btn" :aria-disabled="!q.state.connected || q.busy" @click="q.getStorageInfo()">读取存储信息</button>
        <button class="qeft-rail__btn" :aria-disabled="!q.state.connected || q.busy" @click="q.getDeviceType()">读取设备类型</button>
        <button class="qeft-rail__btn" :aria-disabled="!q.luns.length" @click="q.exportPartitionsCsv()">导出分区表 CSV</button>
      </div>
    </aside>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { fmtBytes, parseRawProgram } from '../composables/useQdl.js'

const props = defineProps({ q: { type: Object, required: true } })

const source = ref('device')
const keyword = ref('')
const selected = ref(new Set())
const checked = computed({
  get: () => [...selected.value],
  set: (arr) => { selected.value = new Set(arr) },
})
const filters = reactive({ all: false, userdata: false, gpt: false })
const rail = reactive({ basic: true, more: true })
const xmlName = ref('')
const imageCount = ref(0)
const imageMap = ref(new Map())
let rowSeq = 0
const rows = ref([])

const USERDATA_RE = /(userdata|cache|data|misc|metadata|persist|modemst|fsc|fsg)/i
const GPT_RE = /^(gpt|primarygpt|backupgpt|sbl1|hyp|pmic|xbl|tz|rpm|aboot|boot)$/i

/* ---------- 数据源 ---------- */
watch(source, async (s) => {
  selected.value = new Set()
  imageCount.value = 0
  imageMap.value = new Map()
  xmlName.value = ''
  if (s === 'device') {
    rows.value = flattenDevice()
  } else if (s === 'custom') {
    rows.value = []
  } else {
    rows.value = []
  }
})

watch(() => props.q.luns, () => {
  if (source.value === 'device') {
    rows.value = flattenDevice()
    selected.value = new Set()
  }
}, { deep: true })

function flattenDevice() {
  const out = []
  for (const l of props.q.luns) {
    l.partitions.forEach((p, i) => {
      out.push({
        key: `d${++rowSeq}`,
        source: 'device',
        lun: l.lun,
        index: i + 1,
        name: p.name,
        start: p.start,
        sectors: p.sectors,
        sizeBytes: p.sizeBytes,
        file: null,
      })
    })
  }
  return out
}

function onScan() {
  props.q.scanPartitions()
}

async function onXml(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const text = await file.text()
  const entries = parseRawProgram(text)
  const ss = Number(props.q.state.cfg.sectorSize)
  rows.value = entries
    .filter((en) => en.filename)
    .map((en) => {
      const sectors = Number(en.num_partition_sectors || 0)
      const sectorSize = Number(en.SECTOR_SIZE_IN_BYTES || ss)
      return {
        key: `x${++rowSeq}`,
        source: 'xml',
        lun: Number(en.physical_partition_number || 0),
        name: en.label || en.filename,
        start: en.start_sector,
        sectors,
        sizeBytes: sectors * sectorSize,
        sectorSize,
        fileSectorOffset: Number(en.file_sector_offset || 0),
        sizeInBytes: Number(en.size_in_bytes || 0),
        filename: en.filename,
        file: imageMap.value.get(en.filename) || imageMap.value.get(en.filename?.toLowerCase()) || null,
      }
    })
  xmlName.value = file.name
  props.q.log(`已解析 ${file.name}：${rows.value.length} 条 program 项`, 'info')
  e.target.value = ''
}

async function onImages(e) {
  const files = [...(e.target.files || [])]
  if (!files.length) return
  const map = new Map()
  for (const f of files) {
    map.set(f.name, f)
    map.set(f.name.toLowerCase(), f)
  }
  imageMap.value = map
  imageCount.value = files.length
  let matched = 0
  for (const r of rows.value) {
    if (r.source !== 'xml') continue
    r.file = map.get(r.filename) || map.get(r.filename?.toLowerCase()) || null
    if (r.file) matched += 1
  }
  props.q.log(`已加载 ${files.length} 个镜像，匹配到 ${matched} 条`, 'info')
  e.target.value = ''
}

function onRowFile(e, r) {
  const f = e.target.files?.[0]
  if (f) r.file = f
  e.target.value = ''
}

function addCustomRow() {
  rows.value.push({
    key: `c${++rowSeq}`,
    source: 'custom',
    lun: 0,
    name: `custom_${rows.value.length + 1}`,
    start: 0,
    sectors: 1,
    sizeBytes: Number(props.q.state.cfg.sectorSize),
    sectorSize: Number(props.q.state.cfg.sectorSize),
    file: null,
  })
}

function removeSelected() {
  rows.value = rows.value.filter((r) => !selected.value.has(r.key))
  selected.value = new Set()
}

/* ---------- 筛选与选择 ---------- */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let list = rows.value
  if (kw) list = list.filter((r) => String(r.name).toLowerCase().includes(kw))
  if (filters.userdata) list = list.filter((r) => USERDATA_RE.test(r.name))
  if (filters.gpt) list = list.filter((r) => GPT_RE.test(r.name))
  return list
})

watch([filters, keyword], () => {
  if (filters.all) selected.value = new Set(filtered.value.map((r) => r.key))
}, { deep: true })

watch(filters.all, (v) => {
  selected.value = v ? new Set(filtered.value.map((r) => r.key)) : new Set()
})

const selectedRows = computed(() => rows.value.filter((r) => selected.value.has(r.key)))
const selectedBytes = computed(() => selectedRows.value.reduce((s, r) => s + Number(r.sizeBytes || 0), 0))
const flashCount = computed(() => selectedRows.value.filter((r) => !!r.file).length)
const canFlash = computed(() => props.q.state.connected && selectedRows.value.some((r) => r.file))

/* ---------- 操作 ---------- */
async function onReadInfo() {
  await props.q.getStorageInfo()
  await props.q.getDeviceType()
}

async function onFlash() {
  const targets = selectedRows.value.filter((r) => r.file)
  if (!targets.length) { props.q.log('所选行没有可刷写的镜像文件', 'warn'); return }
  if (targets.some((r) => r.source === 'device') || targets.length === 1) {
    for (const r of targets) {
      const ok = r.source === 'device'
        ? await props.q.flashPartition(r.name, r.file)
        : await props.q.programRaw({
            lun: r.lun, start: r.start, sectors: r.sectors, sectorSize: r.sectorSize,
            blob: sliceBlob(r), label: r.name,
          })
      if (!ok) return
    }
    return
  }
  // 纯 XML 批量：走 rawprogram 流程
  const entries = targets.map((r) => ({
    filename: r.filename || r.file.name,
    start_sector: String(r.start),
    num_partition_sectors: String(r.sectors),
    physical_partition_number: String(r.lun),
    SECTOR_SIZE_IN_BYTES: String(r.sectorSize || props.q.state.cfg.sectorSize),
    file_sector_offset: String(r.fileSectorOffset || 0),
    size_in_bytes: String(r.sizeInBytes || r.file.size),
  }))
  const fileMap = {}
  for (const r of targets) fileMap[r.filename || r.file.name] = r.file
  await props.q.flashRawProgram(entries, fileMap)
}

function sliceBlob(r) {
  const ss = Number(r.sectorSize || props.q.state.cfg.sectorSize)
  const offset = Number(r.fileSectorOffset || 0) * ss
  const length = r.sizeBytes || (r.file.size - offset)
  return r.file.slice(offset, offset + length)
}

async function onDump() {
  for (const r of selectedRows.value) {
    if (Number(r.sizeBytes) > 256 * 1024 * 1024 && !window.confirm(`${r.name} 约 ${fmtBytes(r.sizeBytes)}，读取耗时较长，继续？`)) return
    const buf = await props.q.readPartition({
      lun: r.lun, start: r.start, sectors: r.sectors,
      fileName: `${r.name}_lun${r.lun}.img`,
    })
    if (!buf) return
  }
}

async function onErase() {
  await props.q.eraseRows(selectedRows.value.map((r) => ({
    source: r.source, name: r.name, lun: r.lun, start: r.start, sectors: r.sectors,
  })))
  if (source.value === 'device') await props.q.scanPartitions()
}

async function onFactory() {
  await props.q.eraseFactory()
  if (source.value === 'device') await props.q.scanPartitions()
}

async function onReset() {
  if (!window.confirm('确认重启设备？')) return
  await props.q.reset()
}

defineExpose({ source })
</script>
