import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 构建时间戳：用于在「关于」页确认用户拿到的是最新版本（排查浏览器缓存）
  define: {
    __QEFT_BUILD__: JSON.stringify(new Date().toISOString().replace('T', ' ').slice(0, 16) + 'Z')
  },
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // treat @material/web custom elements as native (no Vue warning)
          isCustomElement: (tag) => tag.startsWith('md-')
        }
      }
    })
  ],
  server: { host: true, port: 5173 },
  // wasm is loaded via new URL(..., import.meta.url) inside the wasm glue,
  // Vite handles that as an asset automatically — no wasm plugin needed.
  assetsInclude: ['**/*.wasm']
})
