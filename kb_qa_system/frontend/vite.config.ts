import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
    // 资源文件名哈希（长期缓存策略）
    rollupOptions: {
      output: {
        // 入口文件命名：assets/[name]-[hash].js
        entryFileNames: 'assets/[name]-[hash].js',
        // 代码块文件命名：assets/[name]-[hash].js
        chunkFileNames: 'assets/[name]-[hash].js',
        // 静态资源命名：assets/[name]-[hash].[ext]
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // 手动代码分割，将第三方依赖分离为独立 chunk
        manualChunks: {
          // React 核心（react、react-dom、react-router）
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // 状态管理与工具库
          'utils-vendor': ['zustand', 'lucide-react'],
        },
      },
    },
    // 警告阈值：单个 chunk 超过 500KB 时警告
    chunkSizeWarningLimit: 500,
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths(),
    // E2-01: Bundle 体积分析工具
    // 使用方式：ANALYZE=true npm run build
    // 生成 stats.html 可视化报告，识别体积瓶颈
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: "stats.html",
            open: true,
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
          }),
        ]
      : []),
  ],
})
