// Cada computadora recuerda cuál es su caja ("Esta computadora es la Caja 1").
// Se guarda solo en este navegador; si no se puede guardar, no hay caja.

const CLAVE = 'anscito.cajaId'

export function cajaDeEstaComputadora(): string | null {
  try {
    return localStorage.getItem(CLAVE)
  } catch {
    return null
  }
}

export function guardarCajaDeEstaComputadora(id: string | null) {
  try {
    if (id) localStorage.setItem(CLAVE, id)
    else localStorage.removeItem(CLAVE)
  } catch {
    // Sin almacenamiento disponible: habrá que elegirla otra vez.
  }
}
