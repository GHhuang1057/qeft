# QEFT · QC EDL Flash Tool

浏览器端的高通 9008（EDL / Emergency Download）刷机工具。
无需安装任何本地刷机软件——打开网页、选好引导镜像即可对设备做分区表读取、镜像刷写、回读与擦除。

**线上地址：<https://flash.geekhonize.top>**

> ⚠️ 刷写分区可能导致设备变砖、丢失数据或失去保修。本工具为社区实现、非高通官方
> release，仅供学习研究，使用风险自负。

## 功能

- Sahara 引导上传（prog_firehose）→ Firehose 指令 → 分区表（主/备 GPT，CRC 校验）
- 分区刷写（整分区镜像与 sparse 格式）、按分区名或扇区范围擦除、分块回读并导出
- rawprogram\*.xml 解析 + 镜像目录自动匹配批量刷写；自定义扇区地址写入
- A/B 槽位切换、存储信息读取、导出记录（可重复保存）
- 内置 **9008 设备模拟器**，无真机也能端到端演示与开发（20 项回归全绿）
- 驱动安装向导（自托管 Zadig 直链 + 驱动回跳根治指南）

## 连接方式：WebUSB（WinUSB 驱动）

唯一保留的连接通道，稳定且吞吐量高：

1. 浏览器打开 <https://flash.geekhonize.top>（Chrome / Edge 等 Chromium 内核）
2. 按「驱动与帮助」页向导给 9008 装 **WinUSB** 驱动（Zadig，站点直连下载）
3. 选好引导镜像 → 让设备进 EDL → **20 秒内**点「连接设备」（避开设备看门狗）

页面会自动完成授权与连接，不需要选择通道。

## 目录

```
app/    Vue 3 前端（Vite 构建，Cloudflare Workers 静态托管）
  └─ src/lib/qdl/        协议栈（vendored @andiradulescu/qdl + QEFT 修补）
  └─ src/lib/sim/        9008 设备模拟器
  └─ src/lib/transports/ WebUSB 传输层
```

## 本地开发

```bash
git clone https://github.com/GHhuang1057/qeft.git
cd qeft/app
npm install
npm run dev        # http://localhost:5173（模拟模式无需真机）
npm test           # 9008 模拟器端到端回归（20 项）
```

## 部署（Cloudflare Workers 免费版）

```bash
cd app
npx wrangler deploy     # wrangler.toml 已绑定 flash.geekhonize.top（Custom Domain）
```

## 第三方组件

| 组件 | 许可 | 说明 |
| --- | --- | --- |
| [@andiradulescu/qdl](https://www.npmjs.com/package/@andiradulescu/qdl) v0.1.12 | MIT | Sahara/Firehose/GPT 协议栈，vendored 于 `app/src/lib/qdl/`（去除 node-usb CLI 依赖，含 QEFT 修补，见文件内 `QEFT patch` 注释） |
| [GeekHonize UI](https://geekhonize.top) | 内部设计系统 | `app/public/assets/ui/`，与 geekhonize.top 同源 |
| [Zadig](https://zadig.akeo.ie) | GPLv3 | WinUSB 驱动安装器，站点自托管镜像（`app/public/drivers/`） |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) / [crc-32](https://github.com/SheetJS/js-crc32) | MIT | qdl 运行时依赖 |
| [bkerler/edl](https://github.com/bkerler/edl)、edl-ng | — | 协议与驱动处理策略参考 |

## License

MIT © 2026 GeekHonize
