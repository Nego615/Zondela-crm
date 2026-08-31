import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Builds the shareable static preview (see preview/). The app source is used
// as-is; only the Supabase client is swapped for an in-memory mock, so the
// preview can never reach a real database.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const norm = (p: string) => p.replace(/\\/g, '/')

const REAL_CLIENT = norm(here('./src/lib/supabase.ts'))
// Must be normalised: preview/main.tsx imports this same file directly, and if
// the two ids differ only by path separator Vite treats them as two modules —
// giving the role switcher its own copy of the mock's state, silently.
const MOCK_CLIENT = norm(here('./preview/mock-supabase.ts'))

function swapSupabaseForMock(): Plugin {
  return {
    name: 'swap-supabase-for-mock',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Resolve normally first, then compare against the real client's path.
      // Matching the resolved file rather than the import string keeps this
      // working regardless of how deep the importing file sits.
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && norm(resolved.id).split('?')[0] === REAL_CLIENT) return MOCK_CLIENT
      return null
    },
  }
}

export default defineConfig({
  root: here('./preview'),
  base: './',
  plugins: [react(), swapSupabaseForMock()],
  build: {
    outDir: here('./dist-preview'),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { output: { codeSplitting: false } },
  },
})
