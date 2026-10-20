import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { host: '127.0.0.1', port: 3004, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4310', '/widget': 'http://127.0.0.1:4310' } },
  preview: { host: '127.0.0.1', port: 3004, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4310', '/widget': 'http://127.0.0.1:4310' } },
})
