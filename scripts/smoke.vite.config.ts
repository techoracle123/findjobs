import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Builds the app as a single IIFE bundle so it can be executed inside jsdom,
 * which does not support ES modules in <script> tags.
 */
export default defineConfig({
  plugins: [react()],
  // Library mode does not substitute process.env.NODE_ENV, which React's
  // runtime reads, so it is replaced here.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-smoke',
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/smoke-entry.tsx',
      formats: ['iife'],
      name: 'RoleSignalSmoke',
      fileName: () => 'smoke.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
