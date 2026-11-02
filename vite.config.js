import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { renameSync } from 'node:fs'

// NanoMuse Komari theme
// Two outputs, built one after the other (`npm run build`), as in the ran theme:
//   - dist/index.html                 — the theme Komari serves; artwork stays in dist/ (copied from public/)
//   - preview/NanoMuse-preview.html   — offline preview: mock API and artwork inlined, opens from file://
const preview = process.env.BUILD_TARGET === 'preview'

/* The preview reuses index.html but boots through src/preview.js. */
const previewEntry = {
  name: 'nanomuse-preview-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: html =>
      html
        .replace('/src/main.ts', '/src/preview.ts')
        .replace('<title>Komari Monitor</title>', '<title>NanoMuse · 设计预览（模拟数据）</title>'),
  },
  closeBundle: () => renameSync('preview/index.html', 'preview/NanoMuse-preview.html'),
}

export default defineConfig({
  plugins: [...(preview ? [previewEntry] : []), viteSingleFile()],
  publicDir: preview ? false : 'public',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4_000,
    outDir: preview ? 'preview' : 'dist',
    emptyOutDir: true,
  },
})
