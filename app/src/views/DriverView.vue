<template>
  <div class="qeft-stack">
    <!-- 自检 -->
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
          <dt>运行环境</dt>
          <dd>
            {{ secure ? '安全上下文' : '非安全上下文（WebUSB 不可用）' }}
            · {{ platform }}
          </dd>
          <dt>WebUSB</dt>
          <dd>
            <span class="gh-badge" :class="usbOk ? 'gh-badge--success' : 'gh-badge--danger'">
              {{ usbOk ? '可用' : '不可用' }}
            </span>
            <span class="qeft-muted gh-ml2">已授权设备 {{ usbDevices }} 台</span>
          </dd>
          <dt>桥接扩展</dt>
          <dd>
            <span class="gh-badge" :class="q.state.bridge.available ? 'gh-badge--success' : 'gh-badge--neutral'">
              {{ q.state.bridge.available ? '已安装' : '未安装' }}
            </span>
            <span v-if="hostDevices >= 0" class="qeft-muted gh-ml2">宿主侧发现 {{ hostDevices }} 台 9008</span>
          </dd>
        </dl>

        <div class="gh-alert gh-alert--info gh-mt4">
          <div class="gh-alert__body">
            <div class="gh-alert__title">结论</div>
            <div>{{ verdict }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 扩展安装向导 -->
    <section class="gh-panel">
      <div class="gh-panel__head">
        <h3>QEFT Bridge 浏览器扩展</h3>
        <div class="gh-panel__head-actions">
          <span class="gh-badge" :class="q.state.bridge.available ? 'gh-badge--success' : 'gh-badge--neutral'">
            {{ q.state.bridge.available ? `已检测到（${q.state.bridge.source}）` : '未检测到' }}
          </span>
        </div>
      </div>
      <div class="gh-panel__body gh-prose">
        <div class="gh-alert gh-alert--info gh-mb4">
          <div class="gh-alert__body">
            <div class="gh-alert__title">为什么不能「网页点一下就装」？</div>
            <div>
              Chromium 出于安全禁止网页静默/拖拽安装扩展（非商店 CRX 双击或拖入会被直接拒绝），
              这一步绕不过。官方留了三个口子：<b>应用商店</b>（需开发者账号发布）、
              <b>开发者模式加载解压缩</b>（下面的手动步骤）、
              <b>企业策略自托管</b>——第三种就是我们提供的一键脚本：跑一次，浏览器重启后自动装好并随
              <span class="qeft-kbd">updates.xml</span> 自动更新，不需要开发者模式。
            </div>
          </div>
        </div>

        <p class="qeft-mb3">
          「扩展 · 本机 libusb」通道 = 本扩展（浏览器内转发）+ 本机宿主（node-usb/libusb）。两者都装好后刷新本页。
        </p>

        <h4 class="gh-mb2">方式 A · 一键脚本（推荐）</h4>
        <ol>
          <li>
            下载脚本（可先用记事本打开查看，只写一条注册表策略，无其它动作）：
            <span class="qeft-row gh-mt2">
              <a class="gh-btn gh-btn--primary gh-btn--sm" href="/extensions/install-extension.cmd" download>
                下载 install-extension.cmd
              </a>
              <a class="gh-btn gh-btn--outline gh-btn--sm" href="/extensions/remove-extension.cmd" download>卸载脚本</a>
              <a class="gh-btn gh-btn--outline gh-btn--sm" href="/extensions/qeft-bridge.crx" download>CRX 包（供策略安装）</a>
            </span>
          </li>
          <li>
            双击运行（若浏览器拦截下载，右键「保留」；或把下面命令粘贴到 PowerShell 执行）：
            <pre class="gh-codeblock qeft-mt2">reg add "HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /d "bflfbjgpjlhhgajeimapcodifjhmaloo;https://flash.geekhonize.top/extensions/updates.xml" /f
reg add "HKCU\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /d "bflfbjgpjlhhgajeimapcodifjhmaloo;https://flash.geekhonize.top/extensions/updates.xml" /f</pre>
          </li>
          <li><b>完全退出浏览器再打开</b>，扩展自动出现（扩展页里标记「由管理员安装」，策略方式由 updates.xml 自动更新）。</li>
          <li>继续装<b>本机宿主</b>（见下方第 5 步说明或扩展 README），然后回页「重新检测」。</li>
        </ol>

        <h4 class="gh-mb2 gh-mt4">方式 B · 手动加载解压缩（不想动注册表）</h4>
        <ol>
          <li>
            下载扩展包并解压到固定目录（以后不要删）：
            <span class="qeft-row gh-mt2">
              <a class="gh-btn gh-btn--outline gh-btn--sm" href="/extensions/qeft-bridge-0.1.0.zip" download>
                下载 qeft-bridge-0.1.0.zip
              </a>
            </span>
          </li>
          <li>
            地址栏打开 <span class="qeft-kbd">chrome://extensions</span>（Edge：
            <span class="qeft-kbd">edge://extensions</span>），开启右上角<b>「开发人员模式」</b>。
          </li>
          <li>点<b>「加载解压缩的扩展程序」</b>，选择解压出的 <span class="qeft-kbd">extension</span> 目录。</li>
          <li>
            核对扩展 ID 为
            <span class="qeft-kbd">{{ extId }}</span>
            （manifest 内置 key，ID 固定，与本机宿主清单 allowed_origins 一致）。
          </li>
        </ol>

        <h4 class="gh-mb2 gh-mt4">两 种方式共同的后置步骤</h4>
        <ol>
          <li value="5">
            <b>注册本机宿主</b>：在仓库 <span class="qeft-kbd">host/</span> 目录执行
            <span class="qeft-kbd">node setup.mjs</span>（安装 node-usb/libusb、生成 Native Messaging 清单并写注册表），
            再用 <span class="qeft-kbd">node test-host.mjs</span> 自检。
          </li>
          <li value="6">回到本页点右上角<b>「重新检测」</b>——桥接扩展变为「已检测到」即可使用。</li>
        </ol>

        <div class="gh-alert gh-alert--info gh-mt4">
          <div class="gh-alert__body">
            <div class="gh-alert__title">想真正「点一下就装」？</div>
            <div>
              只能走应用商店：Chrome Web Store（注册开发者 5 美元/次）或 Edge 加载项（免费），
              发布后即可挂「添加至 Chrome」官方按钮。本页的扩展包
              <span class="qeft-kbd">qeft-bridge-0.1.0.zip</span> 即商店可用的提交包。
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Windows 安装向导 -->
    <section class="gh-panel">
      <div class="gh-panel__head"><h3>Windows 驱动安装向导（WinUSB）</h3></div>
      <div class="gh-panel__body gh-prose">
        <p>
          QEFT 通过 WebUSB / 本机 libusb 与 9008 通信，要求设备绑定 <b>WinUSB</b> 或 <b>libusbK</b> 驱动。
          系统自带的「Qualcomm HS-USB QDLoader 9008 (COMx)」串口驱动<b>不能</b>被浏览器访问，
          会出现 <span class="qeft-kbd">打开 USB 设备失败（驱动未绑定为 WinUSB/libusbK？）</span> 这类错误。
          用 Zadig 替换驱动即可。
        </p>

        <ol>
          <li>
            <b>进入 9008 模式</b>：设备进 EDL 后，任务栏会响一声（设备管理器出现 9008 或 QDLoader 9008 端口）。
          </li>
          <li>
            <b>下载并运行 Zadig</b>（免安装）：
            <span class="qeft-row gh-mt2">
              <a class="gh-btn gh-btn--primary gh-btn--sm" href="/drivers/zadig-2.9.exe" download>下载 Zadig 2.9（本站直连）</a>
              <a class="gh-btn gh-btn--outline gh-btn--sm" href="https://zadig.akeo.ie/" target="_blank" rel="noopener">官方站点</a>
            </span>
          </li>
          <li>
            菜单 <b>Options → List All Devices</b>，在下拉框选择
            <span class="qeft-kbd">Qualcomm HS-USB QDLoader 9008 (COMx)</span>
            （若没有这一项，选 <span class="qeft-kbd">9008</span>）。
          </li>
          <li>
            右侧驱动选择 <b>WinUSB</b>（若装完仍报错可改 <b>libusbK</b> 再试），点 <b>Install Driver</b>，
            等待左下角出现 <span class="qeft-kbd">Driver Installation: SUCCESS</span>。
          </li>
          <li>
            回到本页点上方「重新检测」；然后到「深度刷机」页重新连接。
            <b>建议每次装完驱动后重启浏览器</b>（WebUSB 会重新枚举接口）。
          </li>
        </ol>

        <div class="gh-alert gh-alert--warning">
          <div class="gh-alert__body">
            <div class="gh-alert__title">驱动替换的影响与恢复</div>
            <ul style="margin: 0; padding-left: 1.2em">
              <li>替换后 9008 在系统中不再显示为串口（COM 口），其它依赖串口的刷机工具会找不到设备。</li>
              <li>要恢复串口：设备管理器 → 卸载该设备（勾选「删除驱动软件」），拔插后系统会重装高通 QDLoader 驱动。</li>
              <li>两套驱动可按需切换：QEFT 用 WinUSB，QFIL 等 QPST 工具用 QDLoader。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- 疑难排查 -->
    <section class="gh-panel">
      <div class="gh-panel__head"><h3>常见问题</h3></div>
      <div class="gh-panel__body">
        <dl class="gh-kv">
          <dt>Zadig 里没有 9008</dt>
          <dd>设备未进入 EDL，或驱动已被其它程序占用。先确认任务栏有设备接入提示音。</dd>
          <dt>装完仍报打开失败</dt>
          <dd>换 libusbK 重装；或重启浏览器 / 拔插设备；确认没有其它程序（QFIL、刷机匣等）占用设备。</dd>
          <dt>WebUSB 弹不出选择框</dt>
          <dd>必须 HTTPS 或 localhost；且同源下先授权过。本页为 <span class="qeft-kbd">{{ origin }}</span>。</dd>
          <dt>想用串口模式</dt>
          <dd>
            保持高通 QDLoader 驱动，在「选择设备 / 引导 / 配置」里把传输通道切到
            <b>Web Serial</b>（协议与 USB 相同，但速率受串口限制）。
          </dd>
          <dt>Linux / macOS</dt>
          <dd>
            无需 Zadig。Linux 下若被 qcserial 内核驱动占用，unbind 后再连；
            macOS 一般可直接访问。
          </dd>
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
import { EXT_ID } from '../lib/bridge.js'

const props = defineProps({ q: { type: Object, required: true } })

const extId = EXT_ID

const checking = ref(false)
const usbOk = ref(false)
const usbDevices = ref(0)
const hostDevices = ref(-1)

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
  if (!secure.value) return '当前不是安全上下文，WebUSB 无法使用；请用 https 或 localhost，或安装 QEFT Bridge 扩展走本机 libusb。'
  if (usbDevices.value > 0) return '已有已授权的 9008 设备，可以直接到「深度刷机」页连接。'
  if (!usbOk.value) return '当前浏览器不支持 WebUSB，请换 Chrome / Edge，或安装 QEFT Bridge 扩展。'
  if (hostDevices.value > 0) return '宿主侧已发现 9008 设备，但浏览器尚未授权：装好 WinUSB 驱动后用 WebUSB 授权一次即可。'
  return '未发现 9008 设备：先让设备进入 EDL，然后按下方向导安装 WinUSB 驱动。'
})

async function detect() {
  checking.value = true
  props.q.detectBridge()
  try {
    usbOk.value = 'usb' in navigator
    usbDevices.value = usbOk.value ? (await navigator.usb.getDevices()).length : 0
    if (props.q.state.bridge.available) {
      try {
        const list = await props.q.listDevices()
        hostDevices.value = list.length
      } catch {
        hostDevices.value = -1
      }
    } else {
      hostDevices.value = -1
    }
    props.q.log(`驱动自检：WebUSB=${usbOk.value} 已授权=${usbDevices.value} 宿主=${hostDevices.value}`, 'debug')
  } finally {
    checking.value = false
  }
}

onMounted(detect)

</script>
