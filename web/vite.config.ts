import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 前端全部数据面走 BFF（登录 cookie 也在 BFF 域下）
      '/api': 'http://127.0.0.1:58090',
    },
  },
})
