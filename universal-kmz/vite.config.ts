import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const productionCsp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self' https://*.googleapis.com https://*.gstatic.com",
    "connect-src 'self' https://*.googleapis.com https://*.gstatic.com",
    "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://*.googleapis.com",
    "font-src 'self' data: https://*.gstatic.com",
    "worker-src 'self' blob:",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'production-content-security-policy',
        transformIndexHtml(html: string) {
          if (mode !== 'production') return html;
          return html.replace(
            '</head>',
            `    <meta http-equiv="Content-Security-Policy" content="${productionCsp}" />\n  </head>`
          );
        }
      }
    ],
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
