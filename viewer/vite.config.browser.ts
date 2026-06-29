import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const outDir = path.resolve(__dirname, '../geoxplain/static/browser')

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'remove-public-viewer-data',
      closeBundle() {
        const packagedViewerData = path.join(outDir, 'viewer_data.json')
        if (fs.existsSync(packagedViewerData)) {
          fs.rmSync(packagedViewerData)
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Fixed, hash-free filenames so the build artifact is stable in git history.
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'assets/index.css' : 'assets/[name][extname]',
      },
    },
  },
})
