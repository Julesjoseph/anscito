// Texto de búsqueda de productos y servicios. Un lector de código de barras
// escribe como un teclado de EE. UU.; si Windows está en español, la tecla
// del guion sale como apóstrofo ("BEB'0001" en vez de "BEB-0001"). Si el
// texto tiene la forma de un código (prefijo + separador + número), el
// separador se cambia por "-". Una búsqueda normal ("D'Leon") no cambia.

const CODIGO_LEIDO = /^([A-Za-z0-9.]{2,10})['´`’‘?_\-]([0-9]{3,})$/;

export function normalizarBusqueda(texto: string): string {
  const t = texto.trim();
  const m = CODIGO_LEIDO.exec(t);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : t;
}
