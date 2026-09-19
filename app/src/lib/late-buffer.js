/**
 * 迟到数据回收缓冲（QEFT patch）
 *
 * qdl 的 runWithTimeout 会在超时后「遗弃」底层读 promise，但 USB/串口上真正
 * 到达的数据不会消失——它会落进那个已被放弃的 promise 里。如果不回收，
 * QDLoader 驱动吞掉首个 HELLO 后设备重发的数据就会凭空丢失。
 *
 * runWithTimeout（qdl/utils.js，已打补丁）在超时分支把 promise 的最终结果
 * 交给 globalThis.__qeftLateRebuffer，由这里暂存，供下一次读取优先消费。
 * 约束：同一时刻只有一台设备在用，全局单例缓冲即可。
 */
const pending = []

export function pushLate(data) {
  if (data && data.length) {
    pending.push(data instanceof Uint8Array ? data : new Uint8Array(data))
  }
}

export function takeLate() {
  return pending.length ? pending.shift() : null
}

export function hasLate() {
  return pending.length > 0
}

export function installLateRebuffer() {
  if (typeof globalThis.__qeftLateRebuffer === 'undefined') {
    globalThis.__qeftLateRebuffer = pushLate
  }
}
