import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // 大模型调用走后端代理（server/ai-proxy.mjs），Key 不进前端；
    // 代理未启动时请求快速失败，前端自动降级为离线演示模式
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
});
