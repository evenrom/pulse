import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pulse Terminal',
    short_name: 'Pulse',
    description: 'Advanced Portfolio Analytics Terminal',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a1215',
    theme_color: '#0a1215',
    icons: [
      {
        src: '/icon.svg',
        sizes: '192x192',
      },
      {
        src: '/icon.svg',
        sizes: '512x512',
      },
    ],
  }
}
