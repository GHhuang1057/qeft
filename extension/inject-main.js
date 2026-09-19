/**
 * QEFT Bridge —— 注入页面的桥（MAIN world）
 *
 * 以 MAIN world 运行，能直接挂到 window.QEFT 供页面调用；
 * 与 isolated world 的 relay.js 通过 window.postMessage 通信。
 */
(() => {
  if (window.QEFT) return

  const EXT_ID = 'bflfbjgpjlhhgajeimapcodifjhmaloo'
  const pending = new Map()
  let seq = 0

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.__qeftRes !== true) return
    const p = pending.get(data.id)
    if (!p) return
    pending.delete(data.id)
    clearTimeout(p.timer)
    if (data.ok === false) p.reject(new Error(data.error || 'QEFT 桥接调用失败'))
    else p.resolve(data)
  })

  function request(op, params = {}, timeoutMs = 30000) {
    const id = `p${++seq}-${Date.now()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`QEFT 桥接调用超时：${op}（${timeoutMs}ms）`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      window.postMessage({ __qeftReq: true, id, op, params }, window.location.origin)
    })
  }

  let version = '0.1.0'
  try { version = window.chrome?.runtime?.getManifest?.().version || version } catch { /* MAIN world 拿不到 */ }
  window.QEFT = { request, extId: EXT_ID, version }
  window.dispatchEvent(new Event('qeft:ready'))
})()
