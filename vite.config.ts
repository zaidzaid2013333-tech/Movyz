import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  const buildId = process.env.MOVYZ_BUILD_ID || 'dev';

  return {
    define: {
      'import.meta.env.VITE_MOVYZ_BUILD_ID': JSON.stringify(buildId),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        selfDestroying: true,
        injectRegister: null,
        includeAssets: ['favicon.ico', 'pwa-icon.svg'],
        manifest: {
          name: 'MOVYZA - منصة السينما والدراما',
          short_name: 'MOVYZA',
          description: 'منصة المشاهدة السينمائية الأولى للأفلام والمسلسلات بجودة 4K',
          theme_color: '#07090e',
          background_color: '#07090e',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            {
              src: '/pwa-icon.svg',
              sizes: '192x192 512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': 'http://localhost:8787',
        '/health': 'http://localhost:8787',
      },
    },
  };
});
