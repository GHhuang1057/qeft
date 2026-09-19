/**
 * QEFT 应用入口
 *
 * UI 使用 GeekHonize 设计系统（public/assets/ui/geekhonize-ui.min.css），
 * 应用自身的补充样式放在 styles/app.css，类名统一 qeft- 前缀，避免与设计系统冲突。
 */
import { createApp } from 'vue'
import App from './App.vue'
import './styles/app.css'

createApp(App).mount('#app')
