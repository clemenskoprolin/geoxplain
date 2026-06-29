/**
 * Vite build config for the anywidget ESM bundle.
 *
 * Output: geoxplain/static/widget.js  +  widget.css
 *
 * Run with:  npm run build:widget
 *
 * Development (HMR) note:
 *   Start the normal dev server (`npm run dev`) and point the Python widget at
 *   the dev server instead of the packaged file:
 *
 *     import anywidget, pathlib
 *     w = GeoXplainWidget()
 *     w.set_trait('_esm', pathlib.Path('http://localhost:5173/src/widget/index.tsx'))
 *
 *   anywidget will proxy the ESM request to Vite so you get full HMR.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  // The widget bundle is served from a notebook-specific URL, not the site root.
  // Relative asset URLs keep worker chunks and other emitted files resolvable.
  base: './',
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  build: {
    // Emit into the Python package's static directory
    outDir: path.resolve(__dirname, '../geoxplain/static'),
    // Don't wipe the directory — it may contain other assets
    emptyOutDir: false,

    lib: {
      entry: path.resolve(__dirname, 'src/widget/index.tsx'),
      formats: ['es'],
      // Produces widget.js (no hash suffix for stable _esm path)
      fileName: () => 'widget.js',
    },

    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        // Rename extracted CSS to widget.css (stable path for _css trait)
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'widget.css' : (assetInfo.name ?? 'asset'),
        // Keep all chunks in the same directory so relative imports resolve
        chunkFileNames: 'widget-[hash].js',
      },
    },
  },
})
