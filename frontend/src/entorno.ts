// Cómo arrancó esta pantalla. Se configura al arrancar (variables VITE_*);
// sin configurar, es el sistema real de siempre.

// Dirección del servidor. Sin configurar es el de PRUEBAS (3010); la versión
// publicada se arma con la del real (3000) o la del demo (3001).
export const API_URL: string =
  import.meta.env.VITE_API_URL || 'http://localhost:3010'

// Modo demo (entrenamiento): muestra una franja de aviso en todas las pantallas.
export const MODO_DEMO: boolean = import.meta.env.VITE_MODO === 'demo'
