import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'node:fs'

// Deployed to GitHub Pages as a PROJECT page, so the app is served from a subpath
// (/trading-sim/) rather than the domain root. `base` makes the built asset URLs match; in dev
// it stays "/" so `npm run dev` is unaffected. The router reads the same value via BASE_URL.
const base = process.env.GITHUB_PAGES ? '/trading-sim/' : '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      // GitHub Pages serves static files only: it has no server to rewrite unknown paths back
      // to index.html, so loading /trading-sim/stats directly (or refreshing it) would 404.
      // Shipping a copy of index.html as 404.html makes Pages serve the app for those paths,
      // and the router then resolves the URL client-side.
      name: 'spa-404-fallback',
      closeBundle() {
        try {
          copyFileSync('dist/index.html', 'dist/404.html')
        } catch {
          // index.html is absent on a non-standard build; nothing to fall back to.
        }
      },
    },
  ],
})
