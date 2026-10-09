import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Backend the dev server proxies /api to (the phone only ever talks to this Vite server).
const API_TARGET = process.env.CASTAWAY_API_URL ?? 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // listen on the LAN so a phone can open http://<laptop-ip>:5174
    port: 5174, // the desktop frontend uses 5173
    proxy: { '/api': API_TARGET },
  },
  preview: { host: true, port: 5174, proxy: { '/api': API_TARGET } },
})
