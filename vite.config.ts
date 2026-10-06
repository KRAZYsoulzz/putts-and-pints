import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'logo.jpg'],
      manifest: {
        name: 'Putts & Pints | Tournament Manager',
        short_name: 'Putts & Pints',
        description: 'Putts and Pints Tournament Manager and Season Standings',
        theme_color: '#0B1220',
        background_color: '#0B1220',
        display: 'standalone',
        icons: [
          {
            src: 'logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
