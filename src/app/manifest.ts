import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pulse Terminal',
    short_name: 'Pulse',
    description: 'Advanced Portfolio Analytics Terminal',
    id: '/',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a1215',
    theme_color: '#0a1215',
    icons: [
      {
        src: '/pwa/pulse-v2-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/pulse-v2-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/pulse-v2-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
