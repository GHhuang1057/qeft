#!/usr/bin/env node
/**
 * 打包 QEFT Bridge 为 CRX3 并生成自托管更新清单
 *
 *   node tools/make-crx.mjs
 *
 * 产物（写入 web-vue/public/extensions/）：
 *   - qeft-bridge.crx   CRX3 签名包（extension/ + manifest 内置 key 对应的私钥签名）
 *   - updates.xml       GUpdate 协议更新清单（企业策略 ExtensionInstallForcelist 用）
 *   - qeft-bridge-<v>.zip  商店 / 手动加载用压缩包
 *
 * CRX3 格式（components/crx_file/crx3.proto）：
 *   "Cr24" + u32le(3) + u32le(header_len) + CrxFileHeader + zip
 *   CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2;
 *                   bytes signed_header_data = 10000 }
 *   AsymmetricKeyProof { bytes signature = 1; bytes proof = 2 }
 *   signed_header_data = SignedHeaderData { bytes crx_id = 1 }  序列化
 *   crx_id = SHA256(SPKI DER) 前 16 字节；signature = RSA-SHA256(signed_header_data)
 */
import { createHash, createPrivateKey, createSign, createPublicKey } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXT_DIR = join(ROOT, 'extension')
const OUT_DIR = join(ROOT, 'web-vue', 'public', 'extensions')
const VERSION = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8')).version
const SITE = 'https://flash.geekhonize.top/extensions'

const privateKey = createPrivateKey(readFileSync(join(EXT_DIR, 'key.pem'), 'utf8'))
const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
const digest = createHash('sha256').update(spki).digest()
// crx_id（签名头里）取前 16 字节；扩展 ID 用完整 32 字节哈希映射 a-p
const crxId = digest.subarray(0, 16)
const extId = [...digest].map((b) => String.fromCharCode(97 + (b % 16))).join('')

/* ---------------- protobuf 手工编码（结构固定，无需运行时库） ---------------- */
function lenBytes(n) {
  const out = []
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b) } while (n)
  return out
}
function tag(field, wire) { return lenBytes((field << 3) | wire) }
function bytesField(field, buf) {
  return [...tag(field, 2), ...lenBytes(buf.length), ...buf]
}
function nested(field, fn) {
  const inner = fn()
  return [...tag(field, 2), ...lenBytes(inner.length), ...inner]
}

/* ---------------- 1) zip ---------------- */
const zipPath = join(OUT_DIR, `qeft-bridge-${VERSION}.zip`)
mkdirSync(OUT_DIR, { recursive: true })
const files = ['manifest.json', 'background.js', 'relay.js', 'inject-main.js', 'README.md']
execFileSync('C:\\Windows\\System32\\tar.exe', [
  '--format', 'zip', '-cf', zipPath,
  ...files.map((f) => join(EXT_DIR, f)),
])
const zip = readFileSync(zipPath)

/* ---------------- 2) CRX3 ---------------- */
const signedHeaderData = Uint8Array.from(
  // SignedHeaderData { crx_id = 1 }
  bytesField(1, crxId),
)
const signature = createSign('sha256').update(signedHeaderData).sign(privateKey)

// AsymmetricKeyProof { signature = 1, proof = 2 }
const proofMsg = Uint8Array.from([
  ...bytesField(1, signature),
  ...bytesField(2, signedHeaderData),
])
// CrxFileHeader { sha256_with_rsa = 2, signed_header_data = 10000 }
const header = Uint8Array.from([
  ...nested(2, () => proofMsg),
  ...bytesField(10000, signedHeaderData),
])

const headerLen = Buffer.alloc(4)
headerLen.writeUInt32LE(header.length, 0)
const magic = Buffer.from('Cr24', 'ascii')
const version = Buffer.alloc(4)
version.writeUInt32LE(3, 0)

const crx = Buffer.concat([magic, version, headerLen, Buffer.from(header), zip])
const crxPath = join(OUT_DIR, 'qeft-bridge.crx')
writeFileSync(crxPath, crx)

/* ---------------- 3) 更新清单 ---------------- */
const updatesXml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extId}">
    <updatecheck codebase="${SITE}/qeft-bridge.crx" version="${VERSION}" />
  </app>
</gupdate>
`
writeFileSync(join(OUT_DIR, 'updates.xml'), updatesXml, 'utf8')

/* ---------------- 4) .cmd 规范化为 CRLF + 纯 ASCII ----------------
 * cmd.exe 要求 CRLF；含中文/UTF-8 会被 GBK 代码页搅碎（踩过：LF+中文导致命令行碎裂）。
 */
for (const cmdFile of ['install-extension.cmd', 'remove-extension.cmd']) {
  const p = join(OUT_DIR, cmdFile)
  if (!existsSync(p)) continue
  const ascii = readFileSync(p, 'latin1').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  writeFileSync(p, Buffer.from(ascii, 'latin1'))
}

console.log(`CRX3 打包完成`)
console.log(`  扩展 ID : ${extId}`)
console.log(`  CRX     : ${crxPath} (${crx.length} bytes)`)
console.log(`  ZIP     : ${zipPath} (${zip.length} bytes)`)
console.log(`  更新清单: ${join(OUT_DIR, 'updates.xml')} (version=${VERSION})`)
