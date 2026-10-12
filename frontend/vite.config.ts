import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Entorno de PRUEBAS. El sistema real (5173) y el demo (5174) se sirven
  // desde la version publicada (carpeta SCITO-publicado).
  server: { port: 5180, strictPort: true },
})
