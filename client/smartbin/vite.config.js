import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import process from 'node:process'

// Each build gets its own service-worker cache version, so a deploy never serves stale files
// and old caches are cleaned up automatically. Uses the commit on Vercel, a timestamp locally.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 10) || Date.now().toString(36)

function stampServiceWorker() {
  let outDir
  return {
    name: 'naav-stamp-service-worker',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    closeBundle() {
      const file = join(outDir, 'sw.js')
      if (!existsSync(file)) return
      writeFileSync(file, readFileSync(file, 'utf8').replace("'naav-__BUILD_ID__'", `'naav-${BUILD_ID}'`))
    },
  }
}

// Dev server: whenever a source file is saved, re-extract UI strings and keep the Kannada / Hindi
// dictionaries in step (machine-translating new strings when a translation API key is configured).
function i18nAutoSync() {
  let timer = null
  return {
    name: 'naav-i18n-sync',
    apply: 'serve',
    handleHotUpdate({ file }) {
      if (!/[\\/]src[\\/].*\.(jsx?|mjs)$/.test(file) || /[\\/]locales[\\/]/.test(file)) return
      clearTimeout(timer)
      timer = setTimeout(async () => {
        try {
          const { sync } = await import('./scripts/i18n-sync.mjs')
          await sync({ quiet: true, log: (m) => console.log(`[i18n] ${m}`) })
        } catch (err) {
          console.warn('[i18n] sync failed:', err.message)
        }
      }, 800)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stampServiceWorker(), i18nAutoSync()],
  build: {
    // The AI runtime (TensorFlow.js, ~1.2 MB) is one indivisible library. It is only downloaded
    // when the scanner opens, so it is allowed past the default 500 kB warning.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // Large third-party libraries get their own chunks: they change rarely, so browsers keep
        // them cached across our deploys and only re-download the small app code.
        // React and Rollup's shared CommonJS helpers go in their own chunk first; otherwise Rollup
        // places them inside whichever vendor chunk it meets first, and the entry page would then
        // have to download that whole chunk (e.g. the AI runtime) on the first visit.
        manualChunks(id) {
          if (id === '\0commonjsHelpers.js' || id.startsWith('\0vite/') || /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@tensorflow') || id.includes('@teachablemachine')) return 'vendor-ai'
          if (id.includes('html5-qrcode') || id.includes('react-webcam')) return 'vendor-camera'
          if (id.includes('leaflet')) return 'vendor-map'
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'vendor-charts'
          if (id.includes('@supabase')) return 'vendor-supabase'
          return undefined
        },
      },
    },
  },
})
