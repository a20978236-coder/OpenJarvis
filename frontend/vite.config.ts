import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { handAssetsPlugin } from './scripts/hand-assets.mjs';
import { compressAssetsPlugin } from './scripts/compress-assets.mjs';

// VITE_SUPABASE_ANON_KEY is intentionally NOT required here: a missing key
// disables the savings leaderboard at runtime (see src/lib/supabase.ts) rather
// than failing the build, so the package/app stays publishable without it.
// jarvis gui sets the proxy target without exposing an absolute API URL to the
// browser, so requests stay on Vite's origin even on a custom frontend port.
const apiTarget = process.env.OPENJARVIS_VITE_PROXY_TARGET
  || process.env.VITE_API_URL
  || 'http://localhost:8000';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    handAssetsPlugin(),
    compressAssetsPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'HELL',
        short_name: 'HELL',
        description: 'Personal AI assistant',
        id: '/',
        // Installed iPhone app opens the mobile UI; desktop stays at '/'.
        start_url: '/m',
        scope: '/',
        theme_color: '#050b1a',
        background_color: '#050b1a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Offline: serve the cached app shell for page navigations so the
        // installed app still opens without a connection (API calls are
        // excluded below and fail visibly instead of returning HTML).
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/v1\//, /^\/health/, /^\/dashboard/, /^\/api\//, /^\/mediapipe\//],
        // Hand tracking (~20 MB) is not precached; it's fetched the first time
        // camera hand gestures are turned on, then kept for offline use.
        globIgnores: ['mediapipe/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/mediapipe/'),
            handler: 'CacheFirst',
            options: { cacheName: 'hell-hand-tracking', expiration: { maxEntries: 8 } },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: '../src/openjarvis/server/static',
    emptyOutDir: true,
    // Preserve the Vite 6 browser baseline for existing desktop webviews.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Only the named packages go into each group; shared helpers they
          // depend on stay where they are used, so the iPhone dashboard does
          // not pull in the desktop charts just for a tiny shared utility.
          includeDependenciesRecursively: false,
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom)[\\/]/ },
            {
              name: 'markdown',
              test: /node_modules[\\/](react-markdown|rehype-highlight|remark-gfm)[\\/]/,
            },
            // No group for the charts library (recharts): with
            // includeDependenciesRecursively off, its own dependencies stayed
            // in the Dashboard page's chunk, the two chunks imported each
            // other, and the desktop Dashboard crashed on open ("u is not a
            // function"). Left alone, recharts and its helpers are bundled
            // together with the lazy-loaded Dashboard page, which is the only
            // screen that uses them, so the iPhone app still never downloads it.
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // ws: true is required for the /v1/agents/events WebSocket. Without it
      // Vite proxies the HTTP request but not the upgrade, so the socket never
      // opens — no error, no close event, just silence — and every live agent
      // view sits empty in dev while working in a production build.
      '/v1': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
      '/health': apiTarget,
      '/api': apiTarget,
    },
  },
});
