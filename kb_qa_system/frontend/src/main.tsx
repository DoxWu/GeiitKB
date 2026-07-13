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

// D5-03 PWA：生产环境注册 Service Worker
// 作用：缓存静态资源，支持离线访问和快速加载
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
