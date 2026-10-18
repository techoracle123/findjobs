import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            // Preserve strict CSRF checks behind this development-only proxy.
            // Rewrite only an Origin that really belongs to the frontend host;
            // foreign/null origins pass through unchanged and remain rejected.
            const origin = incoming.headers.origin
            const host = incoming.headers.host
            if (!origin || !host) return
            try {
              if (new URL(origin).host === host)
                outgoing.setHeader('origin', 'http://127.0.0.1:8787')
            } catch {
              /* Leave malformed origins for the API to reject. */
            }
          })
        },
      },
    },
  },
  build: { sourcemap: true },
})
