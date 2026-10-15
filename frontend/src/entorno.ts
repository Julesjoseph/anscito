// Cómo arrancó esta pantalla. Se configura al arrancar (variables VITE_*);
// sin configurar, es el sistema real de siempre.

// Dirección del servidor. Sin configurar es el de PRUEBAS (3010); la versión
// publicada se arma con la del real (3000) o la del demo (3001).
// Si la pantalla se abre desde otro equipo (por Tailscale, con el nombre o la
// IP del servidor), "localhost" se cambia por esa misma dirección: así el
// celular o la PC de la casa buscan el servidor en la laptop servidor.
function direccionServidor(): string {
  const configurada: string = import.meta.env.VITE_API_URL || 'http://localhost:3010'
  const equipo = window.location.hostname
  if (equipo && equipo !== 'localhost' && equipo !== '127.0.0.1') {
    return configurada.replace('localhost', equipo)
  }
  return configurada
}

export const API_URL: string = direccionServidor()

// Modo demo (entrenamiento): muestra una franja de aviso en todas las pantallas.
export const MODO_DEMO: boolean = import.meta.env.VITE_MODO === 'demo'