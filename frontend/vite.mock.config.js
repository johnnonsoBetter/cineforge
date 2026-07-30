import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// TEMP: throwaway dev server to verify the loading UX against the fully-mocked backend on 8010.
// Not committed — safe to delete.
export default defineConfig({
  root: 'src',
  plugins: [react()],
  server: { port: 5175, proxy: { '^/api/': 'http://127.0.0.1:8010' } },
})
