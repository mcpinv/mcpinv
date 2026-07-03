import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../bridge/dist/public',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${process.env['BRIDGE_PORT'] ?? 3000}`
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
})
