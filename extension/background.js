/**
 * QEFT Bridge —— 后台 Service Worker
 *
 * 职责：与页面/内容脚本通信（chrome.runtime），并持有到本机
 * Native Messaging Host（qeft-host，Node + node-usb/libusb）的连接。
 *
 * 消息形状：{ id, op, params } → 回 { id, ok, ... } / { id, ok:false, error }
 */

const HOST_NAME = 'com.geekhonize.qeft_host'

/** @type {chrome.runtime.Port|null} */
let nativePort = null
/** @type {Map<string, {resolve: Function, reject: Function}>} */
const pending = new Map()
let seq = 0

function nativeErrorText() {
  const err = chrome.runtime.lastError
  return err && err.message ? err.message : ''
}

function getNativePort() {
  if (nativePort) return nativePort

  nativePort = chrome.runtime.connectNative(HOST_NAME)

  nativePort.onMessage.addListener((msg) => {
    const p = msg && msg.id ? pending.get(msg.id) : null
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok === false) p.reject(new Error(msg.error || '本机宿主返回错误'))
    else p.resolve(msg)
  })

  nativePort.onDisconnect.addListener(() => {
    const detail = nativeErrorText()
    nativePort = null
    const error = new Error(
      detail
        ? `本机宿主连接断开：${detail}（检查 host 是否已安装、native messaging 清单是否注册）`
        : '本机宿主连接断开（host 是否已注册？）',
    )
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  })

  return nativePort
}

function callNative(op, params = {}, timeoutMs = 60000) {
  const port = getNativePort()
  const id = `bg${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`本机宿主响应超时：${op}（${timeoutMs}ms）`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    try {
      port.postMessage({ id, op, params })
    } catch (e) {
      clearTimeout(timer)
      pending.delete(id)
      nativePort = null
      reject(new Error(`发送到本机宿主失败：${e.message || e}`))
    }
  })
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'qeft-relay' && port.name !== 'qeft-bridge') return

  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg.op !== 'string') return
    try {
      const res = await callNative(msg.op, msg.params || {})
      port.postMessage({ id: msg.id, ok: true, ...res })
    } catch (e) {
      port.postMessage({ id: msg.id, ok: false, error: e.message || String(e) })
    }
  })

  port.onDisconnect.addListener(() => {
    // 页面关掉就关掉宿主，避免后台常驻占用 USB
    if (!pending.size) return
  })
})

// externally_connectable 直连（页面拿不到内容脚本时的兜底）
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.op !== 'string') return
  callNative(msg.op, msg.params || {})
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }))
  return true // 异步响应
})

chrome.runtime.onInstalled.addListener(() => {
  console.log('[QEFT Bridge] installed, host =', HOST_NAME)
})
