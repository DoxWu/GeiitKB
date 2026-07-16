import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './store/themeStore'
import './index.css'
// highlight.js GitHub 主题样式（亮色）
// 作用：为 MarkdownRenderer 中的代码块提供语法高亮
// 暗色模式覆盖样式在 index.css 中通过 .dark 选择器定义
import 'highlight.js/styles/github.css'

// D5-04 暗色模式：在渲染前初始化主题，避免闪屏（FOUC）
// 作用：根据 localStorage 或系统偏好设置 <html> 的 dark class
initTheme()

// 缓存问题修复：移除 Service Worker 注册
// 原因：SW 缓存版本号固定（geiit-kb-v1），部署新版本时不清理旧缓存，
//       导致用户看到旧 index.html（引用已失效的 JS/CSS），需要手动清缓存才能恢复。
//       本项目不需要离线访问，nginx 已处理静态资源缓存，SW 弊大于利，故移除。
// 同时注销已注册的旧 SW，让现有用户也能恢复
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().then((success) => {
          if (success) console.info('已注销旧 Service Worker，缓存问题已修复')
        })
      })
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
