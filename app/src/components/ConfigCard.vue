<template>
  <section class="qeft-toolbar">
    <!-- 第一行：设备 / 引导 / 配置 -->
    <div class="qeft-toolbar__row">
      <button class="gh-btn" :aria-expanded="open" @click="open = !open">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        选择设备 / 引导 / 配置
      </button>
      <span class="qeft-toolbar__summary">
        已选择:
        <b>{{ summaryTransport }}</b>
        <span class="qeft-muted">·</span>
        <b>{{ summaryProgrammer }}</b>
        <span v-if="q.state.connected" class="gh-badge gh-badge--success">已连接</span>
        <span v-else class="gh-badge gh-badge--neutral">未连接</span>
      </span>
    </div>

    <!-- 连接参数（引导镜像 + Firehose 配置 + 连接按钮） -->
    <div v-show="open" class="qeft-toolbar__body">
      <div class="qeft-formgrid gh-mb4">
        <div class="gh-field gh-mb0">
          <span class="gh-label">引导镜像 <span class="gh-req">*</span></span>
          <input class="gh-input" type="file" accept=".mbn,.elf,.bin,.img" :disabled="q.busy" @change="onProg" />
        </div>
        <div class="gh-field gh-mb0">
          <label class="gh-label" for="cfg-mem">存储类型</label>
          <select id="cfg-mem" v-model="q.state.cfg.memoryName" class="gh-select" :disabled="q.busy">
            <option value="UFS">UFS</option>
            <option value="emmc">eMMC</option>
            <option value="nand">NAND</option>
          </select>
        </div>
        <div class="gh-field gh-mb0">
          <label class="gh-label" for="cfg-ss">扇区大小</label>
          <select id="cfg-ss" v-model.number="q.state.cfg.sectorSize" class="gh-select" :disabled="q.busy">
            <option :value="4096">4096</option>
            <option :value="512">512</option>
          </select>
        </div>
        <div class="gh-field gh-mb0">
          <label class="gh-label" for="cfg-lun">LUN 数量</label>
          <input id="cfg-lun" v-model.number="q.state.cfg.maxlun" class="gh-input" type="number" min="1" max="16" :disabled="q.busy" />
        </div>
        <div class="gh-field gh-mb0">
          <label class="gh-switch" for="cfg-skip">
            <input id="cfg-skip" v-model="q.state.cfg.skipStorageInit" type="checkbox" true-value="1" false-value="0" :disabled="q.busy" />
            <span>SkipStorageInit</span>
          </label>
        </div>
      </div>

      <div class="qeft-row">
        <button class="gh-btn gh-btn--primary" :aria-disabled="q.busy || !q.state.programmer" @click="onConnect">
          <span v-if="q.busy" class="gh-spinner" aria-hidden="true"></span>
          {{ q.state.connected ? '重新连接（上传引导）' : '连接设备' }}
        </button>
        <button class="gh-btn gh-btn--outline" :aria-disabled="!q.state.connected" @click="q.disconnect()">断开</button>
        <button
          v-if="q.state.transport === 'sim' && !q.state.programmer"
          class="gh-btn gh-btn--outline gh-btn--sm"
          @click="useSampleProgrammer"
        >
          用示例镜像（模拟模式）
        </button>
        <button class="gh-btn gh-btn--link gh-btn--sm" :aria-expanded="advanced" @click="advanced = !advanced">
          {{ advanced ? '收起高级选项' : '高级选项' }}
        </button>
        <span class="qeft-muted">
          连接走 WebUSB（WinUSB 驱动）。提示：进 EDL 后 20 秒内完成连接，避免设备看门狗重启。
        </span>
      </div>

      <!-- 连接失败提示 -->
      <div v-if="q.state.lastError && !q.state.connected" class="gh-alert gh-alert--danger gh-mt4">
        <div class="gh-alert__body">
          <div class="gh-alert__title">连接失败</div>
          <div class="qeft-row gh-mt2">
            <span class="qeft-muted">{{ q.state.lastError }}</span>
            <button class="gh-btn gh-btn--sm gh-btn--outline" @click="onConnect">重试连接</button>
            <button v-if="driverError" class="gh-btn gh-btn--sm gh-btn--outline" @click="emit('need-driver')">驱动安装向导</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 高级 -->
    <div v-show="advanced" class="qeft-toolbar__body" style="margin-top: var(--gh-s3)">
      <span class="gh-label">传输通道（一般保持自动）</span>
      <div class="qeft-transport gh-mb4">
        <button
          v-for="t in transports"
          :key="t.id"
          type="button"
          class="qeft-transport__item"
          :aria-pressed="q.state.transport === t.id"
          :disabled="!transportAvailable(t.id)"
          @click="pickTransport(t.id)"
        >
          <span class="qeft-transport__label">{{ t.label }}</span>
          <span class="qeft-transport__hint">{{ t.hint }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { TRANSPORTS, fmtBytes } from '../composables/useQdl.js'

const props = defineProps({ q: { type: Object, required: true } })
const emit = defineEmits(['need-driver'])

// 连接失败且指向驱动问题时置真
const driverError = computed(() => {
  const msg = props.q.state.lastError || ''
  return !props.q.state.connected && /驱动|WinUSB|libusbK|claimInterface|USB 设备失败/i.test(msg)
})
// 窄屏默认折叠，先露出工作区；宽屏默认展开，方便首次配置
const open = ref(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true)
const advanced = ref(false)
const transports = TRANSPORTS

const summaryTransport = computed(() => {
  const t = transports.find((x) => x.id === props.q.state.transport)
  return t ? t.label : '—'
})
const summaryProgrammer = computed(() => {
  const p = props.q.state.programmer
  return p ? `${p.name} · ${fmtBytes(p.size)}` : '未选择引导'
})

function transportAvailable(id) {
  if (id === 'webusb') return props.q.state.env.webusb
  return true
}

function pickTransport(id) {
  props.q.state.transport = id
}

async function onProg(e) {
  const file = e.target.files?.[0]
  if (file) await props.q.setProgrammer(file)
}

function useSampleProgrammer() {
  const size = 24576
  const buf = new ArrayBuffer(size)
  const view = new Uint8Array(buf)
  let x = 0x1234567
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    view[i] = (x >>> 16) & 0xff
  }
  props.q.setProgrammer(new File([buf], 'prog_firehose_sim.elf'))
}

async function onConnect() {
  const ok = await props.q.connect()
  if (ok) await props.q.scanPartitions()
}
</script>
