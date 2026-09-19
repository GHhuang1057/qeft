#!/usr/bin/env node
/**
 * QEFT 本机宿主安装脚本
 *
 *   node setup.mjs
 *
 * 做四件事：
 *   1) 确保 node-usb（libusb 绑定）已安装到本目录；
 *   2) 生成 run-host.cmd（绝对路径指向当前 node 可执行文件）；
 *   3) 生成 Native Messaging 清单 com.geekhonize.qeft_host.json；
 *   4) 把清单路径注册进 HKCU（Chrome / Edge / Chromium / Brave）。
 *
 * 之后在浏览器里以「加载解压缩的扩展」方式加载 ../extension 即可。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST_DIR = dirname(fileURLToPath(import.meta.url))
const HOST_NAME = 'com.geekhonize.qeft_host'
const EXT_ID = 'bflfbjgpjlhhgajeimapcodifjhmaloo'
const ALLOWED_ORIGINS = [
  `chrome-extension://${EXT_ID}/`,
]

/** 子进程 PATH 里补上当前 node 所在目录，否则 usb 的 node-gyp-build 找不到 node */
function childEnv() {
  const sep = process.platform === 'win32' ? ';' : ':'
  const nodeDir = dirname(process.execPath)
  return { ...process.env, PATH: `${nodeDir}${sep}${process.env.PATH || ''}` }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: HOST_DIR,
    env: childEnv(),
    ...opts,
  })
  return r.status === 0
}

/* 1) 依赖 --------------------------------------------------------------- */
if (!existsSync(join(HOST_DIR, 'node_modules', 'usb'))) {
  console.log('[setup] node-usb not found, installing (ships prebuilt libusb)...')
  const nodeDir = dirname(process.execPath)
  const npmCli = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  let ok
  if (existsSync(npmCli)) {
    ok = run(process.execPath, [npmCli, 'install', '--no-audit', '--no-fund'])
  } else {
    ok = run('npm', ['install', '--no-audit', '--no-fund'], { shell: true })
  }
  if (!ok) {
    console.error('[setup] npm install failed. Please run "npm install" in host/ manually.')
    process.exit(1)
  }
}

/* 2) run-host.cmd ------------------------------------------------------- */
const isWin = process.platform === 'win32'
const nodeExe = process.execPath
const hostScript = join(HOST_DIR, 'qeft-host.mjs')
const launcher = join(HOST_DIR, isWin ? 'run-host.cmd' : 'run-host.sh')

if (isWin) {
  writeFileSync(launcher, `@echo off\r\n"${nodeExe}" "${hostScript}" %*\r\n`, 'utf8')
} else {
  writeFileSync(launcher, `#!/bin/sh\nexec "${nodeExe}" "${hostScript}" "$@"\n`, { mode: 0o755 })
}
console.log(`[setup] 启动器: ${launcher}`)

/* 3) Native Messaging 清单 --------------------------------------------- */
const manifest = {
  name: HOST_NAME,
  description: 'QEFT (QC EDL Flash Tool) 本机 libusb 宿主',
  path: launcher,
  type: 'stdio',
  allowed_origins: ALLOWED_ORIGINS,
}
const manifestPath = join(HOST_DIR, `${HOST_NAME}.json`)
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
console.log(`[setup] 清单:   ${manifestPath}`)

/* 4) 注册表 ------------------------------------------------------------ */
if (!isWin) {
  console.log('[setup] 非 Windows 平台请手动把清单放到：')
  console.log('        Chrome:  ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/  (macOS)')
  console.log('                 ~/.config/google-chrome/NativeMessagingHosts/                      (Linux)')
  process.exit(0)
}

const REG_PATHS = [
  ['Chrome', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts'],
  ['Edge', 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts'],
  ['Chromium', 'HKCU\\Software\\Chromium\\NativeMessagingHosts'],
  ['Brave', 'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts'],
]

for (const [browser, root] of REG_PATHS) {
  const key = `${root}\\${HOST_NAME}`
  const r = spawnSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
    encoding: 'utf8',
  })
  const ok = r.status === 0 && !/ERROR/i.test(r.stdout || '')
  console.log(`[setup] ${ok ? '✓' : '✗'} ${browser}  ${key}`)
  if (!ok && r.stderr) console.log('        ' + String(r.stderr).trim())
}

/* 收尾 ----------------------------------------------------------------- */
console.log('\n[setup] 完成。接下来：')
console.log(`  1. 浏览器打开 chrome://extensions（Edge: edge://extensions）`)
console.log(`  2. 打开「开发人员模式」→「加载解压缩的扩展」→ 选择 ${dirname(HOST_DIR)}\\extension`)
console.log(`     扩展 ID 应为 ${EXT_ID}`)
console.log('  3. 打开 https://flash.geekhonize.top ，传输通道选择「扩展 · 本机 libusb」')
console.log('\n提示：Windows 上 9008 设备需要 WinUSB/libusbK 驱动，可用 Zadig 绑定。')
console.log('      验证宿主：node ' + hostScript + ' 然后手动喂一帧 {\"op\":\"list\"} 看输出。')
