import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/websocket': 'ws://localhost:8787',
      '/github-webhook': 'http://localhost:8787',
    }
  }
})
