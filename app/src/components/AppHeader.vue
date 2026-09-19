<template>
  <header class="gh-header">
    <nav class="gh-nav">
      <div class="gh-container">
        <a class="gh-brand" href="/" title="QEFT · QC EDL Flash Tool">
          <span class="gh-brand__logo" aria-hidden="true"></span>
          <span>QEFT</span>
        </a>
        <span class="qeft-muted gh-hide-sm">QC EDL Flash Tool · 9008</span>

        <div class="qeft-nav__right">
          <span class="qeft-status" :data-state="statusState">
            <span v-if="q.busy" class="gh-spinner" aria-hidden="true"></span>
            {{ q.state.status }}
          </span>
          <div class="gh-theme-toggle" role="group" aria-label="主题切换">
            <button type="button" :aria-pressed="theme === 'light'" aria-label="浅色" @click="setTheme('light')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
              </svg>
            </button>
            <button type="button" :aria-pressed="theme === 'dark'" aria-label="深色" @click="setTheme('dark')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
              </svg>
            </button>
            <button type="button" :aria-pressed="theme === 'auto'" aria-label="跟随系统" @click="setTheme('auto')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <rect x="2" y="4" width="20" height="13" rx="2" />
                <path d="M8 21h8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </nav>
  </header>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({ q: { type: Object, required: true } })

const THEME_KEY = 'gh-theme'
const theme = ref('auto')

onMounted(() => {
  try { theme.value = localStorage.getItem(THEME_KEY) || 'auto' } catch { theme.value = 'auto' }
})

function setTheme(next) {
  theme.value = next
  try { localStorage.setItem(THEME_KEY, next) } catch { /* ignore */ }
  document.documentElement.setAttribute('data-theme', next)
}

const statusState = computed(() => {
  const s = props.q.state.status || ''
  if (props.q.busy) return 'busy'
  if (/失败|错误|未支持|不支持/.test(s)) return 'error'
  if (/已连接|完成|已加载|已刷写|已擦除/.test(s)) return 'ok'
  return 'idle'
})
</script>
