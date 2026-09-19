# 第三方代码

## src/lib/qdl

 vendored from npm package `@andiradulescu/qdl` v0.0.12，License: MIT。
 来源：https://www.npmjs.com/package/@andiradulescu/qdl

 取用其中的协议实现（sahara / firehose / gpt / sparse / usblib / xml / logger /
 tiny-struct），**不含** `cli.js` 与 `bin/` —— 那部分依赖 node-usb（原生模块），
 浏览器打包不需要。

 运行时依赖：`crc-32`、`fast-xml-parser`（已声明在 package.json）。

## public/assets/ui

 GeekHonize 设计系统产物（geekhonize-ui/dist），与 geekhonize.top、
 auth.geekhonize.top 共用。改样式请去 `F:\GeekHonizeWebSite\geekhonize-ui` 改源码并
 重新 `build.mjs` + `sync.mjs`，不要直接编辑这里的文件。
