// Modo día o noche: lo elige cada usuario y se recuerda en este equipo
// (localStorage). El modo noche pone la clase "dark" en <html>; los colores
// se cambian en index.css. Lo impreso y los PDF siguen en claro.

export type Tema = 'dia' | 'noche'

const CLAVE = 'anscito.tema'

export function leerTema(): Tema {
  try {
    return localStorage.getItem(CLAVE) === 'noche' ? 'noche' : 'dia'
  } catch {
    return 'dia'
  }
}

export function aplicarTema(tema: Tema) {
  document.documentElement.classList.toggle('dark', tema === 'noche')
  try {
    localStorage.setItem(CLAVE, tema)
  } catch {
    // Sin almacenamiento (ventana privada): el modo dura hasta cerrar.
  }
}
