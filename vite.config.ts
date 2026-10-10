/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // relative base so the build also works from a sub-path (GitHub Pages, previews)
  base: './',
  plugins: [
    react(),
    VitePWA({
      // a waiting version shows 「有新版本」 (src/pwa.ts, UpdateBar) instead of taking over mid-session
      registerType: 'prompt',
      // src/pwa.ts registers through virtual:pwa-register; no registerSW.js script is injected
      injectRegister: false,
      // the icons are already in globPatterns below; listing them twice only duplicates precache entries
      includeManifestIcons: false,
      manifest: {
        // No `id`: it would be resolved against the origin, so './' means the site root and two copies
        // on one origin (a GitHub Pages user site) would be one app. Without it the id is start_url,
        // which resolves against this manifest's own folder.
        name: '人生成就系统',
        short_name: '人生成就',
        description: '像 Minecraft 的进度一样，把人生里的每个成就记下来。',
        lang: 'zh-CN',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#120d0a',
        theme_color: '#120d0a',
        categories: ['lifestyle', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // everything the app needs offline: code, styles, the page, both fonts and the icons
        // (public/icons and public/favicon.svg come from tools/make-icons.mjs)
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
