<template>
  <div class="qeft-logdrawer" :data-open="open ? 'true' : 'false'">
    <button class="qeft-logdrawer__bar" type="button" :aria-expanded="open" @click="open = !open">
      <span :class="open ? '' : 'qeft-logdrawer__hint'">{{ open ? '收起日志' : '点击此处展开日志' }}</span>
      <span class="qeft-logdrawer__meta">
        {{ countText }}
        <span class="qeft-logdrawer__chev">{{ open ? '⌄' : '⌃' }}</span>
      </span>
    </button>
    <div v-show="open" class="qeft-logdrawer__body">
      <div class="qeft-logdrawer__tools">
        <select v-model="level" class="gh-select" style="width: 110px">
          <option value="all">全部</option>
          <option value="info">信息</option>
          <option value="warn">警告</option>
          <option value="error">错误</option>
          <option value="debug">调试</option>
        </select>
        <label class="gh-switch">
          <input v-model="follow" type="checkbox" />
          <span>自动滚动</span>
        </label>
        <div class="gh-toolbar__spacer"></div>
        <button class="gh-btn gh-btn--sm gh-btn--subtle" @click="q.clearLogs()">清空</button>
      </div>
      <div ref="box" class="qeft-log" role="log" aria-live="polite">
        <div v-if="!visible.length" class="qeft-muted">暂无日志</div>
        <div v-for="(l, i) in visible" :key="i" class="qeft-log__line" :data-level="l.level">
          <span class="qeft-log__ts">{{ l.ts }}</span>
          <span class="qeft-log__msg">{{ l.msg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({ q: { type: Object, required: true } })
const open = ref(false)
const level = ref('all')
const follow = ref(true)
const box = ref(null)

const visible = computed(() => {
  if (level.value === 'all') return props.q.logs
  return props.q.logs.filter((l) => l.level === level.value)
})
const countText = computed(() => {
  const errs = props.q.logs.filter((l) => l.level === 'error').length
  const warns = props.q.logs.filter((l) => l.level === 'warn').length
  return `${props.q.logs.length} 条${errs ? ` · 错误 ${errs}` : ''}${warns ? ` · 警告 ${warns}` : ''}`
})

watch(visible, async () => {
  if (!follow.value || !open.value) return
  await nextTick()
  const el = box.value
  if (el) el.scrollTop = el.scrollHeight
})
</script>
