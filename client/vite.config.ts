import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'The Siege',
        short_name: 'The Siege',
        description: 'Cooperative daily habit-challenge base defense',
        theme_color: '#1b2a44',
        background_color: '#141c2c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        globPatterns: ['**/*.{js,css,html,woff,woff2,png,json}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.webp$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'siege-art-v1',
              expiration: { maxEntries: 120, maxAgeSeconds: 365 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // PixiJS v8 (+ pixi-viewport) alone minifies to ~650 kB and is needed by every game screen,
    // so it lives in its own long-cacheable vendor chunk; the limit is sized to that one chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js', 'pixi-viewport'],
        },
      },
    },
  },
  server: { host: true },
  test: { environment: 'node' },
});
