import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The backend serves `frontend/index.html` directly (see backend/app.py), so the build
// inlines every asset into that one file — no static mount, no CDN, works offline.
export default defineConfig({
  root: 'src',
  // root is 'src', so envDir would default there too; point it back at the frontend dir so
  // `.env` lives next to package.json (where .env.example and the Dockerfile expect it).
  envDir: '..',
  plugins: [react(), viteSingleFile()],
  // Use a regex key so the proxy only catches `/api/...` backend routes and not the
  // frontend's own `/api.js` module (a bare `'/api'` prefix would swallow it → blank page).
  server: { port: 5173, proxy: { '^/api/': 'http://127.0.0.1:8000' } },
  build: {
    outDir: '..',
    emptyOutDir: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 4000,
  },
})
