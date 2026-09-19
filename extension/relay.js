/**
 * QEFT Bridge —— 中继（isolated world）
 *
 * 页面(main world)没有 chrome.* API，这里把 postMessage 请求转发给后台
 * Service Worker，由后者 connectNative 到本机 libusb 宿主。
 */
(() => {
  if (window.__QEFT_RELAY__) return
  window.__QEFT_RELAY__ = true

  let port = null

  function bg() {
    if (port) return port
    port = chrome.runtime.connect({ name: 'qeft-relay' })
    port.onDisconnect.addListener(() => {
      port = null
    })
    return port
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.__qeftReq !== true) return

    const reply = (payload) => {
      window.postMessage({ __qeftRes: true, id: data.id, ...payload }, window.location.origin)
    }

    let p
    try { p = bg() } catch (e) {
      return reply({ ok: false, error: `无法连接 QEFT 扩展后台：${e.message || e}` })
    }

    try {
      p.postMessage({ id: data.id, op: data.op, params: data.params || {} })
    } catch (e) {
      port = null
      reply({ ok: false, error: `桥接发送失败：${e.message || e}` })
    }
  })
})()
