import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
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
