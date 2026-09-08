import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// Microphone and speech recognition only work on HTTPS, so the dev server is HTTPS unless started with --mode http.
// Set VITE_BASE (e.g. /disc-reader/) when hosting under a sub-path such as GitHub Pages.
export default defineConfig(({ mode }) => ({
  base: process.env['VITE_BASE'] ?? '/',
  server: { host: true },
  plugins: [
    ...(mode === 'http' ? [] : [basicSsl()]),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        // Everything the app needs is precached, so it opens with no network at all.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Disc Reader',
        short_name: 'Disc Reader',
        description: 'Type disc golf flight numbers, see and compare flight paths',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
}))
