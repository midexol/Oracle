import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
    // Frontend and backend are co-located on the same box - proxy /api
    // server-side to the backend's localhost port instead of exposing a
    // second public tunnel. The browser only ever talks to this origin.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
