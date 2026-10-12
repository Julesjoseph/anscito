// Cómo arrancó esta pantalla. Se configura al arrancar (variables VITE_*);
// sin configurar, es el sistema real de siempre.

// Dirección del servidor (el demo usa otro puerto y otra base de datos).
export const API_URL: string =
  import.meta.env.VITE_API_URL || 'http://localhost:3000'

// Modo demo (entrenamiento): muestra una franja de aviso en todas las pantallas.
export const MODO_DEMO: boolean = import.meta.env.VITE_MODO === 'demo'
