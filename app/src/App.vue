<template>
  <div class="qeft-shell">
    <AppHeader :q="q" />

    <div class="qeft-container">
      <div class="qeft-layout">
        <!-- 侧边导航：宽屏为竖排侧栏，窄屏自动变横向导航 -->
        <aside class="gh-docside qeft-side">
          <div class="gh-docside__title qeft-side__brand">QEFT · QC EDL Flash Tool</div>
          <ul class="gh-docside__list qeft-side__nav">
            <li v-for="v in views" :key="v.id">
              <a href="#" :aria-current="active === v.id ? 'page' : undefined" @click.prevent="active = v.id">
                {{ v.label }}
              </a>
            </li>
          </ul>

          <div class="qeft-side__cards">
            <div class="qeft-sidecard">
            <div class="qeft-sidecard__title">设备</div>
            <div class="qeft-sidecard__row">
              <span class="qeft-muted">状态</span>
              <span class="qeft-status" :data-state="statusState">{{ q.state.status }}</span>
            </div>
            <div class="qeft-sidecard__row">
              <span class="qeft-muted">通道</span>
              <span>{{ transportLabel }}</span>
            </div>
            <div class="qeft-sidecard__row">
              <span class="qeft-muted">序列号</span>
              <span class="gh-mono">{{ q.state.serial || '—' }}</span>
            </div>
            <div class="qeft-sidecard__row">
              <span class="qeft-muted">槽位</span>
              <span>{{ (q.state.activeSlot || '—').toUpperCase() }}</span>
            </div>
            <div class=qeft-sidecard__row>
              <span class=qeft-muted>存储</span>
              <span class=gh-mono>{{ storageText }}</span>
            </div>
          </div>

            <div class="qeft-sidecard qeft-sidecard--warn">
              <div class="qeft-sidecard__title">风险告知</div>
              <p class="qeft-muted" style="margin: 0">
                刷写分区可能导致设备变砖或数据丢失，请确认已备份并使用与设备匹配的固件与
                <span class="qeft-kbd">prog_firehose</span>。
              </p>
            </div>
          </div>
        </aside>

        <!-- 主工作区 -->
        <main class="gh-docmain">
          <template v-if="active === 'flash'">
            <ConfigCard :q="q" class="gh-mb4" @need-driver="active = 'driver'" />
            <PartitionWorkspace :q="q" />
          </template>

          <template v-else-if="active === 'driver'">
            <DriverView :q="q" />
          </template>


          <template v-else-if="active === 'about'">
            <section class="gh-panel">
              <div class="gh-panel__head"><h3>关于 QEFT</h3></div>
              <div class="gh-panel__body gh-prose">
                <p><b>QEFT（QC EDL Flash Tool）</b>是浏览器端的高通 9008 (EDL) 刷机工具。</p>
                <p>
                  协议栈基于 <span class="qeft-kbd">@andiradulescu/qdl</span>（MIT，已内嵌），
                  连接只走 <b>WebUSB + WinUSB 驱动</b>一条路：点连接后优先复用已授权的 9008 设备，
                  未授权时弹出设备选择框，没有其它通道可选。
                </p>
                <p>
                  代码仅复用协议逻辑、非高通官方 release；本工具与 GeekHonize 均不对刷机后果负责，
                  请自行承担风险。
                </p>
                <p class="qeft-muted">
                  版本 0.1.0 · 构建 <span class="gh-mono">{{ buildStamp }}</span> ·
                  <span class="gh-mono">flash.geekhonize.top</span>
                </p>
              </div>
            </section>
          </template>
        </main>
      </div>
    </div>

    <LogDrawer :q="q" />
  </div>
</template>

<script setup>
/* global __QEFT_BUILD__ */
import { computed, onMounted, ref, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import ConfigCard from './components/ConfigCard.vue'
import PartitionWorkspace from './components/PartitionWorkspace.vue'
import LogDrawer from './components/LogDrawer.vue'
import DriverView from './views/DriverView.vue'
import { useQdl, TRANSPORTS } from './composables/useQdl.js'

const q = useQdl()

const views = [
  { id: 'flash', label: '深度刷机' },
  { id: 'driver', label: '驱动与帮助' },
  { id: 'about', label: '关于' },
]

/* hash 路由：驱动向导等页面可深链（如 /#driver） */
function viewFromHash() {
  const h = window.location.hash.replace('#', '')
  return views.some((v) => v.id === h) ? h : 'flash'
}
const active = ref(viewFromHash())

function syncHash(v) {
  const want = v === 'flash' ? `${window.location.pathname}` : `#${v}`
  if (window.location.hash !== (v === 'flash' ? '' : `#${v}`)) {
    history.replaceState(null, '', want)
  }
}
window.addEventListener('hashchange', () => { active.value = viewFromHash() })

const transportLabel = computed(() => {
  const t = TRANSPORTS.find((x) => x.id === q.state.transport)
  return t ? t.label : '—'
})

const statusState = computed(() => {
  const s = q.state.status || ''
  if (q.busy) return 'busy'
  if (/失败|错误|未支持|不支持/.test(s)) return 'error'
  if (/已连接|完成|已加载|已刷写|已擦除/.test(s)) return 'ok'
  return 'idle'
})

const storageText = computed(() => {
  const s = q.state.storageInfo
  if (!s) return '—'
  return `${s.prod_name || s.memory_type || '?'}${s.memory_type ? ' · ' + s.memory_type : ''}`
})

const buildStamp = __QEFT_BUILD__

onMounted(() => {
  syncHash(active.value)
  q.log('QEFT 已就绪，选择引导镜像并连接设备')
})

watch(active, (v) => syncHash(v))
</script>
