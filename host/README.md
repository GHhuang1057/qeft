# QEFT 本机宿主（Native Messaging Host + libusb）

Node + [`node-usb`](https://github.com/node-usb/node-usb)（libusb 的 Node 绑定）实现的
Chrome Native Messaging 宿主。由 QEFT Bridge 扩展通过 `chrome.runtime.connectNative` 启动，
把浏览器里的 USB 请求转成 libusb 调用。

## 安装

```bash
cd host
node setup.mjs
```

`setup.mjs` 会：

1. 安装 `node-usb`（自带 Windows 预编译 libusb，无需本机编译）；
2. 生成 `run-host.cmd`（写入当前 node 可执行文件的绝对路径）；
3. 生成 Native Messaging 清单 `com.geekhonize.qeft_host.json`；
4. 把清单路径注册进 HKCU（Chrome / Edge / Chromium / Brave）。

> 某些受管控环境会拦截 `reg.exe`。若注册表那一步失败，请手动执行：
> `reg add HKCU\Software\Google\Chrome\NativeMessagingHosts\com.geekhonize.qeft_host /ve /d "<host 目录>\com.geekhonize.qeft_host.json" /f`
> （Edge 把 `Google\Chrome` 换成 `Microsoft\Edge`。）

## 自检

```bash
node test-host.mjs
```

以帧协议直接喂 `hello` / `list` / `ping` 三条命令，验证 libusb 加载、枚举与帧编解码。
未插 9008 设备时 `list` 返回 0 台也属于正常，只要不报错就说明 libusb 可用。

## 协议

stdin/stdout 走 Native Messaging 帧（`u32 LE 长度 + JSON`），二进制一律 base64。

| 请求 | 响应 |
| --- | --- |
| `{id, op:"hello"}` | `{ok, version, platform, libusb}` |
| `{id, op:"list"}` | `{ok, devices:[{vid,pid,bus,address,name,manufacturer,serial}]}` |
| `{id, op:"open", serial?, vid?, pid?}` | `{ok, maxSize, device}` |
| `{id, op:"read", length}` | `{ok, data(base64), length}` |
| `{id, op:"write", data(base64)}` | `{ok, written}` |
| `{id, op:"close"}` | `{ok}` |

宿主 → 浏览器单条消息上限 1MB（Chrome 限制），所以 `read` 最多返回 256KB 二进制，
上层（`web-vue/src/lib/transports/bridge.js`）负责分片拼接。

## 已知问题

- Windows 上设备必须绑定 **WinUSB / libusbK** 驱动，否则 `open` 报
  `claimInterface 失败`。用 Zadig 安装 WinUSB。
- `write` 不主动补 ZLP；libusb 在传输长度为 0 时会发零长包，上层在
  64 字节整数倍时补一个空写即可（与 Web Serial 行为一致）。
