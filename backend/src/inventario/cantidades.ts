// Cantidades de inventario: hasta 3 decimales (numeric(14,3)), sin usar
// números de punto flotante.

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/;

// Devuelve la cantidad con 3 decimales ("2.5" -> "2.500"), o null si no es
// válida (negativa, texto, más de 3 decimales…).
export function normalizarCantidad(valor: unknown): string | null {
  const texto =
    typeof valor === 'number'
      ? String(valor)
      : typeof valor === 'string'
        ? valor.trim()
        : '';
  if (!CANTIDAD.test(texto)) return null;
  const [entero, decimales = ''] = texto.split('.');
  return `${BigInt(entero)}.${decimales.padEnd(3, '0')}`;
}

export function esEntera(cantidad: string): boolean {
  return cantidad.endsWith('.000');
}

export function esCero(cantidad: string): boolean {
  return /^0\.000$/.test(cantidad);
}

// "PAP", 7 -> "PAP-0007"
export function armarCodigo(prefijo: string, numero: number): string {
  return `${prefijo}-${String(numero).padStart(4, '0')}`;
}
