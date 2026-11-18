import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** The release this build is: CEP_VERSION when the install sets it, else the checkout's tag (git describe), else 'dev'. */
function buildVersion(env: Record<string, string>): string {
  if (env.CEP_VERSION) return env.CEP_VERSION
  try {
    return execSync('git describe --tags --always', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
}

/** dist/version.json: an open page compares it with the build it runs (the upgrade notice offers Reload when they differ). */
function versionFile(version: string): Plugin {
  return {
    name: 'cep-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version })}
` })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_DEV_BACKEND || 'http://localhost:8000'
  // Names the dev server may be reached on besides localhost, e.g. a staging hostname in front of it (comma-separated).
  // Vite refuses any other Host header, so a server behind a proxy sets this in its own frontend/.env.local, not here.
  const version = buildVersion(env)
  const allowedHosts = (env.VITE_DEV_ALLOWED_HOSTS || '').split(',').map((host) => host.trim()).filter(Boolean)

  return {
    plugins: [react(), tailwindcss(), versionFile(version)],
    define: { __CEP_VERSION__: JSON.stringify(version) },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // The email designer (GrapesJS + the MJML compiler) is one lazily loaded ~2.4 MB chunk by design.
    // One chunk per suite component: App.tsx lazy-imports apps/<key>/routes, so a component's pages and their own
    // dependencies become one chunk, named after the component; the designer and the journey canvas stay lazy inside it.
    // scripts/check-budgets.mjs holds the shell (index) and each component to its budget after the build.
    build: {
      chunkSizeWarningLimit: 2600,
      rollupOptions: {
        output: {
          chunkFileNames(chunk) {
            const facade = (chunk.facadeModuleId || '').replace(/\\/g, '/')
            const component = facade.match(/\/src\/apps\/([a-z0-9_]+)\/routes\.tsx$/)
            return component ? `assets/${component[1]}-[hash].js` : 'assets/[name]-[hash].js'
          },
        },
      },
    },
    // css.include: src/lib/theme.test.ts reads index.css?raw to check the theme blocks (Vitest empties CSS otherwise)
    test: { css: { include: [/index\.css/] }, environment: 'jsdom', env: { VITE_DEFAULT_TENANT: 'NWA', VITE_LOADING_HOLD_MS: '0' }, testTimeout: 20_000, setupFiles: ['./src/test/setup.ts'] },
    server: {
      port: 5173,
      ...(allowedHosts.length ? { allowedHosts } : {}),
      // Behind a CDN the dev server's modules and stylesheet must never be cached: a browser that kept the old index.css for
      // four hours (Cloudflare's default browser TTL) showed the new markup with the old styles after a deploy.
      headers: { 'Cache-Control': 'no-store' },
      // the User Guide's chapters (docs/manuals) are imported into the help panel from outside frontend/
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../docs/manuals', import.meta.url))] },
      // Same-origin in development: the browser talks to Vite, Vite forwards Django's paths to Django (no CORS, no
      // mixed hosts). The same split Nginx does in production: /api, /admin and /healthz to the API, /static to its
      // collected files, /media to uploads.
      proxy: {
        '/api': { target: backend, changeOrigin: false },
        '/admin': { target: backend, changeOrigin: false }, // the platform back-office (Django admin)
        '/healthz': { target: backend, changeOrigin: false },
        '/static': { target: backend, changeOrigin: false }, // the back-office's own CSS and JS (runserver serves them in DEBUG)
        '/media': { target: backend, changeOrigin: false }, // uploaded images in development (a CDN in production)
      },
    },
  }
})
