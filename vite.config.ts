import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Usa a porta do ambiente quando definida (preview do Claude Code); padrão 5173
  server: { port: Number(process.env.PORT) || 5173 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'RT Gestão de Obra',
        short_name: 'RT Obra',
        description: 'Inteligência Aplicada — RT Engenharia',
        theme_color: '#1B2A4A',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})
