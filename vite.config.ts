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
      registerType: 'prompt',
      includeAssets: ['fonts/*.woff2', 'icons/*.png', 'favicon.svg'],
      manifest: {
        name: '人生成就系统',
        short_name: '人生成就',
        description: '像 Minecraft 进度一样，记录人生里的每一个成就。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#120d0a',
        theme_color: '#120d0a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
