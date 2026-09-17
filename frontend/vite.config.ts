import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_DEV_BACKEND || 'http://localhost:8000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // The email designer (GrapesJS + the MJML compiler) is one lazily loaded ~2.4 MB chunk by design.
    build: { chunkSizeWarningLimit: 2600 },
    test: { environment: 'jsdom', env: { VITE_DEFAULT_TENANT: 'NWA' } },
    server: {
      port: 5173,
      // Same-origin in development: the browser talks to Vite, Vite forwards /api to Django (no CORS, no mixed hosts).
      proxy: {
        '/api': { target: backend, changeOrigin: false },
        '/media': { target: backend, changeOrigin: false }, // uploaded images in development (a CDN in production)
      },
    },
  }
})
