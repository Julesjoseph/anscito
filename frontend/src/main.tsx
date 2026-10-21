import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MODO_DEMO } from './entorno'
import { aplicarTema, leerTema } from './tema'

// El modo día/noche guardado se pone antes de dibujar (sin parpadeo).
aplicarTema(leerTema())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {MODO_DEMO && (
      <div className="sticky top-0 z-50 bg-amber-400 px-4 py-1 text-center text-sm font-medium text-amber-950">
        DEMO — entrenamiento. Los datos no son reales y se borran al reiniciar el demo.
      </div>
    )}
    <App />
  </StrictMode>,
)
