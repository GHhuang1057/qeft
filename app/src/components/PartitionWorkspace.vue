<template>
  <section class="qeft-work">
    <div class="qeft-work__main">
      <!-- 主工具行 -->
      <div class="qeft-toolbar__row gh-mb3">
        <button class="gh-btn gh-btn--sm" :aria-disabled="!q.state.connected || q.busy" @click="onScan">
          {{ q.state.connected ? '刷新分区表' : '读取分区表' }}
        </button>
        <input v-model="keyword" class="gh-input qeft-search" type="search" placeholder="搜索分区…" />
        <span class="qeft-muted">已选 {{ selected.size }} / {{ rows.length }} 项 · {{ fmtBytes(selectedBytes) }}</span>
        <label class="gh-check"><input v-model="filters.all" type="checkbox" /><span>全选</span></label>

        <div class="gh-toolbar__spacer"></div>

        <details class="qeft-menu">
          <summary class="gh-btn gh-btn--sm">更多操作</summary>
          <div class="qeft-menu__body">
            <button class="qeft-menu__item qeft-menu__item--danger" :aria-disabled="!q.state.connected || q.busy" @click="onFactory">恢复出厂设置</button>
            <button class="qeft-menu__item" :aria-disabled="!q.state.connected || q.busy" @click="onReset">重启设备</button>
            <div class="qeft-menu__sep"></div>
            <button class="qeft-menu__item" :aria-disabled="q.busy" @click="q.setActiveSlot('a')">切换到槽位 A</button>
            <button class="qeft-menu__item" :aria-disabled="q.busy" @click="q.setActiveSlot('b')">切换到槽位 B</button>
            <button class="qeft-menu__item" :aria-disabled="!q.state.connected || q.busy" @click="q.getStorageInfo()">读取存储信息</button>
            <button class="qeft-menu__item" :aria-disabled="!q.luns.length" @click="q.exportPartitionsCsv()">导出分区表 CSV</button>
            <div class="qeft-menu__sep"></div>
            <label class="qeft-menu__item qeft-filebtn">
              从 rawprogram.xml 批量刷写…
              <input type="file" accept=".xml" hidden @change="onXml" />
            </label>
            <label class="qeft-menu__item qeft-filebtn">
              选择镜像目录（配合 XML）…
              <input type="file" multiple hidden @change="onImages" />
            </label>
            <button class="qeft-menu__item" @click="enterCustomMode">使用自定义扇区地址…</button>
          </div>
        </details>
      </div>

      <!-- XML 辅助信息行 -->
      <div v-if="source === 'xml' && xmlName" class="qeft-muted gh-mb3">
        XML <span class="qeft-kbd">{{ xmlName }}</span>：{{ rows.length }} 条 · 镜像匹配 {{ imageCount }} 个文件
      </div>

      <!-- 主表 -->
      <div class="gh-table-wrap qeft-tablebox">
        <table class="gh-table qeft-table">
          <thead>
            <tr>
              <th style="width: 34px"></th>
              <th style="width: 70px">LUN</th>
              <th>标签</th>
              <th style="width: 110px">大小</th>
              <th style="width: 200px">文件</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filtered.length">
              <td colspan="5">
                <div class="gh-empty">
                  <div class="gh-empty__title">暂无分区数据</div>
                  <div>{{ emptyHint }}</div>
                </div>
              </td>
            </tr>
            <tr
              v-for="r in filtered"
              :key="r.key"
              :class="{ 'qeft-row--selected': selected.has(r.key) }"
              @click="toggleRow(r.key)"
            >
              <td @click.stop><input v-model="checked" type="checkbox" :value="r.key" :disabled="q.busy" /></td>
              <td class="qeft-part__num">{{ r.lun }}</td>
              <td class="qeft-part__name" :title="`LUN${r.lun} · 起始 ${r.start} · ${r.sectors} 扇区`">{{ r.name }}</td>
              <td>{{ fmtBytes(r.sizeBytes) }}</td>
              <td @click.stop>
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

      <!-- 主操作行 -->
      <div class="qeft-toolbar__row gh-mt3">
        <button class="gh-btn gh-btn--primary" :aria-disabled="!canFlash || q.busy" @click="onFlash">
          刷入（已选 {{ flashCount }}）
        </button>
        <button class="gh-btn" :aria-disabled="!selectedRows.length || q.busy" @click="onDump">
          回读（已选 {{ selectedRows.length }}）
        </button>
        <button class="gh-btn gh-btn--ghost-danger" :aria-disabled="!selectedRows.length || q.busy" @click="onErase">
          擦除（已选 {{ selectedRows.length }}）
        </button>
        <div class="gh-toolbar__spacer"></div>
        <span v-if="q.state.activeSlot" class="qeft-muted">活动槽位 {{ q.state.activeSlot.toUpperCase() }}</span>
      </div>

      <!-- 进度 -->
      <div v-if="q.progress.text" class="qeft-progress-row gh-mt3">
        <div class="gh-progress"><div class="gh-progress__bar" :style="{ width: q.progress.pct + '%' }"></div></div>
        <span class="qeft-muted">{{ q.progress.text }} · {{ q.progress.pct }}%</span>
      </div>

      <!-- 导出记录 -->
      <details v-if="q.exports.length" class="gh-mt3">
        <summary class="qeft-muted">导出记录（{{ q.exports.length }}）</summary>
        <div v-for="x in q.exports" :key="x.id" class="qeft-toolbar__row qeft-mt2">
          <span class="gh-mono">{{ x.name }}</span>
          <span class="qeft-muted">{{ fmtBytes(x.size) }} · {{ x.ts }}</span>
          <div class="gh-toolbar__spacer"></div>
          <button class="gh-btn gh-btn--sm gh-btn--outline" @click="q.saveExport(x.id)">重新保存</button>
        </div>
      </details>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { fmtBytes, parseRawProgram } from '../composables/useQdl.js'

const props = defineProps({ q: { type: Object, required: true } })

const source = ref('device')
const keyword = ref('')
const selected = ref(new Set())
const checked = computed({
  get: () => [...selected.value],
  set: (arr) => { selected.value = new Set(arr) },
})
const filters = ref({ all: false })
const xmlName = ref('')
const imageCount = ref(0)
const imageMap = ref(new Map())
let rowSeq = 0
const rows = ref([])

/* ---------- 数据源 ---------- */
watch(source, (s) => {
  selected.value = new Set()
  imageCount.value = 0
  imageMap.value = new Map()
  xmlName.value = ''
  rows.value = s === 'device' ? flattenDevice() : []
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
    l.partitions.forEach((p) => {
      out.push({
        key: `d${++rowSeq}`,
        source: 'device',
        lun: l.lun,
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
  source.value = 'xml'
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

function enterCustomMode() {
  source.value = 'custom'
  if (!rows.value.length) addCustomRow()
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

function toggleRow(key) {
  const next = new Set(selected.value)
  next.has(key) ? next.delete(key) : next.add(key)
  selected.value = next
}

/* ---------- 筛选与选择 ---------- */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return kw ? rows.value.filter((r) => String(r.name).toLowerCase().includes(kw)) : rows.value
})

watch(filters, (f) => {
  if (f.all) selected.value = new Set(rows.value.map((r) => r.key))
}, { deep: true })

const selectedRows = computed(() => rows.value.filter((r) => selected.value.has(r.key)))
const selectedBytes = computed(() => selectedRows.value.reduce((s, r) => s + Number(r.sizeBytes || 0), 0))
const flashCount = computed(() => selectedRows.value.filter((r) => !!r.file).length)
const canFlash = computed(() => props.q.state.connected && selectedRows.value.some((r) => r.file))

const emptyHint = computed(() => {
  if (source.value === 'device') return props.q.state.connected ? '点「刷新分区表」' : '连接设备后自动出现'
  if (source.value === 'xml') return '从「更多操作」选择 rawprogram*.xml 与镜像目录'
  return '已进入自定义地址模式，勾选行并「选择文件」后可写入'
})

/* ---------- 操作 ---------- */
async function onFlash() {
  const targets = selectedRows.value.filter((r) => r.file)
  if (!targets.length) { props.q.log('所选行没有可刷写的镜像文件', 'warn'); return }
  for (const r of targets) {
    const ok = r.source === 'device'
      ? await props.q.flashPartition(r.name, r.file)
      : await props.q.programRaw({
          lun: r.lun, start: r.start, sectors: r.sectors, sectorSize: r.sectorSize,
          blob: sliceBlob(r), label: r.name,
        })
    if (!ok) return
  }
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
  if (!window.confirm('确认重启设备？设备将离开 Firehose。')) return
  await props.q.reset()
}
</script>
