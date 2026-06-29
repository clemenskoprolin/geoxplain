import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Allow the dev server to serve files from the repo root (a superset of the
    // default `viewer/` scope). Only needed so the shader-compile bench under
    // ../tests/shader-bench can be loaded via Vite's /@fs/ while still resolving
    // the `@/` alias and `three`. Dev-only; no effect on the production build.
    fs: { allow: [path.resolve(__dirname, '..')] },
  },
})
