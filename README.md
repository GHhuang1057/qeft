# QEFT · QC EDL Flash Tool

浏览器端的高通 9008（EDL / Emergency Download）刷机工具。
无需安装任何本地刷机软件——打开网页、选好引导镜像即可对设备做分区表读取、镜像刷写、回读与擦除。

**线上地址：<https://flash.geekhonize.top>**

> ⚠️ 刷写分区可能导致设备变砖、丢失数据或失去保修。本工具为社区实现、非高通官方
> release，仅供学习研究，使用风险自负。

## 功能

- Sahara 引导上传（prog_firehose）→ Firehose 指令 → 分区表（主/备 GPT，CRC 校验）
- 分区刷写（整分区镜像与 sparse 格式均支持）、按分区名或扇区范围擦除、分块回读并导出
- rawprogram\*.xml 解析 + 镜像目录自动匹配批量刷写；自定义扇区地址写入
- A/B 槽位切换（set_active_slot 语义：GPT 属性位 + boot LUN）、存储信息读取
- 内置 **9008 设备模拟器**，无真机也能端到端演示与开发（20 项端到端回归全绿）
- 驱动安装向导（自托管 Zadig）与浏览器扩展一键安装（自托管 CRX + 企业策略）

## 架构

```
┌────────────────────────── 浏览器 ──────────────────────────┐
│  app/  Vue 3 + GeekHonize 设计系统（Fluent 风格）           │
│        └─ src/lib/qdl/    协议栈（vendored @andiradulescu/qdl）
│        └─ src/lib/sim/    9008 设备模拟器                   │
│        └─ src/lib/transports/  三通道传输层                  │
└──────────────┬──────────────────┬──────────────────────────┘
               │ WebUSB           │ 扩展
┌──────────────▼────────┐  ┌──────▼───────────────────────┐
│ navigator.usb（直连） │  │ extension/  MV3 扩展          │
└──────────────────────┘  │  └─ chrome.runtime.connectNative│
                          │ host/       Native Messaging 宿主│
                          │  └─ node-usb（libusb）访问设备    │
                          └──────────────────────────────┘
```

三种传输通道（`src/lib/transports/`），接口统一为 qdl 的 `usbClass`：

| 通道 | 依赖 | 适用 |
| --- | --- | --- |
| **WebUSB** | 浏览器 + WinUSB/libusbK 驱动 | 最简单，装好驱动即用 |
| **扩展 · 本机 libusb** | QEFT Bridge 扩展 + 本机宿主 | 设备枚举直接、不受页面授权状态影响 |
| **Web Serial** | 设备以 COM 口（QDLoader 驱动）暴露 | 兼容串口形态的 9008 |
| **模拟设备** | 无 | 无真机开发 / 演示 |

## 目录

```
app/         Vue 3 前端（Vite 构建，Cloudflare Workers 静态托管）
extension/   QEFT Bridge 浏览器扩展（MV3，扩展 ID 经 manifest 内置 key 固定）
host/        Native Messaging 宿主（Node + node-usb/libusb）
tools/       CRX3 打包与自托管更新清单生成
_ref/        参考资料（不入库）：Fh-loader 源码、edl-ng 等
```

## 快速开始

### 1. 网页版（零安装）

1. 浏览器打开 <https://flash.geekhonize.top>
2. 按「驱动与帮助」页向导安装 WinUSB 驱动（Zadig，站点直连下载）
3. 选择引导镜像 `prog_firehose_*.elf/.mbn`（必须与设备 SoC 匹配）→ 连接

### 2. 本地开发

```bash
git clone https://github.com/GHhuang1057/qeft.git
cd qeft/app
npm install
npm run dev        # http://localhost:5173（模拟设备模式无需真机）
npm test           # 9008 模拟器端到端回归（20 项）
```

### 3. 扩展 + 本机宿主

```bash
# 注册本机宿主（装 node-usb/libusb、写 Native Messaging 清单与注册表）
cd host && node setup.mjs && node test-host.mjs
# 扩展：浏览器「加载解压缩」选 extension/，或用站点提供的策略一键脚本
# 重新打包 CRX（需要 extension/key.pem，仅维护者持有）
node tools/make-crx.mjs
```

### 4. 部署（Cloudflare Workers 免费版）

```bash
cd app
npx wrangler deploy     # wrangler.toml 已绑定 flash.geekhonize.top（Custom Domain）
```

## 第三方组件

| 组件 | 许可 | 说明 |
| --- | --- | --- |
| [@andiradulescu/qdl](https://www.npmjs.com/package/@andiradulescu/qdl) v0.0.12 | MIT | Sahara/Firehose/GPT 协议栈，vendored 于 `app/src/lib/qdl/`（去除了 node-usb 依赖的 CLI 部分，含 QEFT 修补，见文件内 `QEFT patch` 注释） |
| [GeekHonize UI](https://geekhonize.top) | 内部设计系统 | `app/public/assets/ui/`，与 geekhonize.top 同源 |
| [Zadig](https://zadig.akeo.ie) | GPLv3 | WinUSB 驱动安装器，站点自托管镜像（`app/public/drivers/`） |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) / [crc-32](https://github.com/SheetJS/js-crc32) | MIT | qdl 运行时依赖 |
| 参考：[bkerler/edl](https://github.com/bkerler/edl)、[pmarchini/edl](https://github.com/andiradulescu/qdl)、fh_loader 源码 | — | 协议实现参考 |

## License

MIT © 2026 GeekHonize
