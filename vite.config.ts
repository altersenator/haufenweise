import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' sorgt dafür, dass alle Dateien relativ geladen werden.
// So läuft die App auch, wenn sie nicht im Hauptverzeichnis einer Domain liegt.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // Das Freistell-Modell und die Laufzeit sind groß, das ist hier gewollt.
    chunkSizeWarningLimit: 2000,
  },
})
