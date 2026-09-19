# QEFT Bridge（浏览器扩展）

Chrome / Edge MV3 扩展，把 QEFT 页面的 USB 请求转发给本机 libusb 宿主。

## 安装

1. 先装好本机宿主：见 [`../host/README.md`](../host/README.md)（`node setup.mjs`）。
2. 打开 `chrome://extensions`（Edge：`edge://extensions`）。
3. 开启「开发人员模式」→「加载解压缩的扩展」→ 选择本目录。
4. 扩展 ID 应为 **`bflfbjgpjlhhgajeimapcodifjhmaloo`**（manifest 内置固定 key，重装不变，
   本机宿主清单里的 `allowed_origins` 就是按这个 ID 写的）。

## 结构

| 文件 | 运行环境 | 职责 |
| --- | --- | --- |
| `inject-main.js` | MAIN world | 往页面挂 `window.QEFT = { request(op, params, timeout) }` |
| `relay.js` | isolated world | 监听页面 postMessage，转发给后台 SW |
| `background.js` | Service Worker | 持有 `connectNative('com.geekhonize.qeft_host')` 连接并多路复用 |
| `manifest.json` | — | MV3 清单，`externally_connectable` 兜底直连 |

链路：

```
页面 window.QEFT.request('list')
  → postMessage → relay.js → chrome.runtime.connect → background.js
  → chrome.runtime.connectNative('com.geekhonize.qeft_host') → libusb
```

## 允许的站点

`flash.geekhonize.top` + `localhost/127.0.0.1:5173/4173`（开发用）。
要加新站点，同时改 `manifest.json` 的 `host_permissions`、`externally_connectable.matches`
与两处 `content_scripts.matches`。

## 调试

- 后台 SW 日志：`chrome://extensions` → QEFT Bridge → 「服务工作进程」打开 DevTools。
- 内容脚本/页面桥日志：目标页 F12 Console。
- 宿主 stderr 会出现在 SW 的 `onDisconnect` 错误信息里（`lastError.message`）。
