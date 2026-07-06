import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const browserKey = env.GOOGLE_MAPS_BROWSER_KEY || env.VITE_GOOGLE_MAPS_BROWSER_KEY || '';
  const mapId = env.GOOGLE_MAPS_MAP_ID || env.VITE_GOOGLE_MAPS_MAP_ID || '';

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GOOGLE_MAPS_BROWSER_KEY': JSON.stringify(browserKey),
      'process.env.GOOGLE_MAPS_MAP_ID': JSON.stringify(mapId),
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(browserKey)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
