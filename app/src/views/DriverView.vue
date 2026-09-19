<template>
  <div class="qeft-stack">
    <!-- 状态自检 -->
    <section class="gh-panel">
      <div class="gh-panel__head">
        <h3>驱动与帮助</h3>
        <div class="gh-panel__head-actions">
          <button class="gh-btn gh-btn--sm gh-btn--outline" :disabled="checking" @click="detect">
            <span v-if="checking" class="gh-spinner" aria-hidden="true"></span>
            重新检测
          </button>
        </div>
      </div>
      <div class="gh-panel__body">
        <dl class="gh-kv">
          <dt>WebUSB</dt>
          <dd>
            <span class="gh-badge" :class="usbOk ? 'gh-badge--success' : 'gh-badge--danger'">
              {{ usbOk ? '可用' : '不可用' }}
            </span>
            <span class="qeft-muted gh-ml2">已授权设备 {{ usbDevices }} 台</span>
          </dd>
          <dt>运行环境</dt>
          <dd>{{ secure ? '安全上下文' : '非安全上下文（WebUSB 不可用）' }} · {{ platform }}</dd>
        </dl>
        <div class="gh-alert gh-alert--info gh-mt4">
          <div class="gh-alert__body">
            <div class="gh-alert__title">结论</div>
            <div>{{ verdict }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- WinUSB 安装向导 -->
    <section class="gh-panel">
      <div class="gh-panel__head"><h3>WinUSB 驱动安装（Zadig）</h3></div>
      <div class="gh-panel__body gh-prose">
        <p>
          QEFT 通过 WebUSB 与 9008 通信，要求设备绑定 <b>WinUSB</b> 驱动。系统自带的
          「Qualcomm HS-USB QDLoader 9008 (COMx)」串口驱动无法被浏览器访问，用 Zadig 替换即可。
        </p>
        <ol>
          <li><b>进入 9008 模式</b>：设备进 EDL 后，任务栏会响一声。</li>
          <li>
            <b>下载并运行 Zadig</b>（免安装）：
            <span class="qeft-row gh-mt2">
              <a class="gh-btn gh-btn--primary gh-btn--sm" href="/drivers/zadig-2.9.exe" download>下载 Zadig 2.9（本站直连）</a>
              <a class="gh-btn gh-btn--outline gh-btn--sm" href="https://zadig.akeo.ie/" target="_blank" rel="noopener">官方站点</a>
            </span>
          </li>
          <li>
            菜单 <b>Options → List All Devices</b>，下拉选择
            <span class="qeft-kbd">Qualcomm HS-USB QDLoader 9008 (COMx)</span>（没有就选 <span class="qeft-kbd">9008</span>）。
          </li>
          <li>
            右侧驱动选 <b>WinUSB</b>（装完仍报错可改 <b>libusbK</b>），点 <b>Install Driver</b>，
            等待 <span class="qeft-kbd">Driver Installation: SUCCESS</span>。
          </li>
          <li>
            <b>完全退出并重开浏览器</b>，回到「深度刷机」页连接。
          </li>
        </ol>

        <div class="gh-alert gh-alert--danger gh-mt4">
          <div class="gh-alert__body">
            <div class="gh-alert__title">驱动「回跳」根治（重要）</div>
            <div>
              每次重进 EDL 时 Windows 可能又把 QDLoader 绑回去（表现为连接报「打开 USB 设备失败」，
              但自检显示已授权=1）。根治：把 QDLoader 从驱动库删除，让系统只剩 WinUSB 可选。
              <b>管理员</b> PowerShell 执行：
              <pre class="gh-codeblock gh-mt2">pnputil /enum-drivers          # 找到 qdloader /高通 9008 相关的 oemXX.inf
pnputil /delete-driver oemXX.inf /uninstall</pre>
              然后重进 EDL → 设备管理器里 9008 应无 COM 口 → 重启浏览器 → 连接。
              <b>代价</b>：QFIL 等串口工具不再可用（要用时重装 QDLoader 驱动即可）。
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 常见问题 -->
    <section class="gh-panel">
      <div class="gh-panel__head"><h3>常见问题</h3></div>
      <div class="gh-panel__body">
        <dl class="gh-kv">
          <dt>Zadig 里没有 9008</dt>
          <dd>设备未进入 EDL。先确认设备管理器有 9008 条目。</dd>
          <dt>装完仍打开失败</dt>
          <dd>换 libusbK 重装；或重启浏览器；确认没有其它程序占用设备。</dd>
          <dt>WebUSB 弹不出选择框</dt>
          <dd>必须 HTTPS 或 localhost。本页为 <span class="qeft-kbd">{{ origin }}</span>。</dd>
          <dt>连接后很快失败</dt>
          <dd>9008 有约 20 秒看门狗：进 EDL 后先在网页选好引导镜像，再进 EDL，20 秒内点连接。</dd>
          <dt>Linux / macOS</dt>
          <dd>无需 Zadig。Linux 下若被 qcserial 内核驱动占用，unbind 后再连。</dd>
        </dl>
        <p class="qeft-muted gh-mt4">
          Zadig 为 libwdi 项目产物（GPLv3，
          <a href="https://github.com/pbatard/libwdi" target="_blank" rel="noopener">源码</a>），
          本站仅做下载镜像，请以官方站点为准。
        </p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({ q: { type: Object, required: true } })

const checking = ref(false)
const usbOk = ref(false)
const usbDevices = ref(0)

const secure = computed(() => props.q.state.env.secure)
const origin = computed(() => props.q.state.env.origin)
const platform = computed(() => {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return '未知'
})

const verdict = computed(() => {
  if (platform.value !== 'Windows') {
    return usbOk.value
      ? '非 Windows 平台无需安装驱动，可直接尝试连接。'
      : '非 Windows 平台：请检查内核驱动占用（Linux 的 qcserial）后重试。'
  }
  if (!secure.value) return '当前不是安全上下文，WebUSB 无法使用；请用 https 或 localhost 打开。'
  if (usbDevices.value > 0) return '已有已授权的 9008 设备，可以直接到「深度刷机」页连接。'
  if (!usbOk.value) return '当前浏览器不支持 WebUSB，请换 Chrome / Edge。'
  return '未发现 9008 设备：先让设备进入 EDL，然后按上方向导安装 WinUSB 驱动。'
})

async function detect() {
  checking.value = true
  try {
    usbOk.value = 'usb' in navigator
    usbDevices.value = usbOk.value ? (await navigator.usb.getDevices()).length : 0
    props.q.log(`驱动自检：WebUSB=${usbOk.value} 已授权=${usbDevices.value}`, 'debug')
  } finally {
    checking.value = false
  }
}

onMounted(detect)
</script>
