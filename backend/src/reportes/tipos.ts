// Un reporte es una tabla: columnas con su tipo, filas y una fila de totales.
// La misma estructura se muestra en pantalla y se exporta a Excel y PDF.

export type TipoColumna =
  | 'texto'
  | 'dinero' // RD$ u otra moneda, 2 decimales
  | 'entero'
  | 'cantidad' // hasta 3 decimales
  | 'porcentaje'
  | 'fecha' // AAAA-MM-DD
  | 'fechahora'; // AAAA-MM-DD HH:MM, ya en hora de República Dominicana

export type Columna = {
  clave: string;
  titulo: string;
  tipo: TipoColumna;
  // Se suma en la fila de totales (dinero, entero, cantidad).
  total?: boolean;
};

export type Fila = Record<string, string | number | null>;

export type Reporte = {
  codigo: string;
  titulo: string;
  periodo: string; // texto ya armado: "Del 01/10/2026 al 12/10/2026"
  detalle?: string; // ej.: agente o cuenta del reporte
  columnas: Columna[];
  filas: Fila[];
  totales: Fila | null;
  notas: string[];
};

// Suma exacta (enteros) de las columnas marcadas como total.
export function calcularTotales(
  columnas: Columna[],
  filas: Fila[],
): Fila | null {
  const sumables = columnas.filter((c) => c.total);
  if (sumables.length === 0 || filas.length === 0) return null;
  const t: Fila = {};
  for (const c of sumables) {
    const escala = c.tipo === 'dinero' ? 2 : c.tipo === 'cantidad' ? 3 : 0;
    let suma = 0n;
    for (const f of filas) {
      const v = f[c.clave];
      if (v === null || v === undefined || v === '') continue;
      const txt = String(v);
      const neg = txt.startsWith('-');
      const [e, d = ''] = (neg ? txt.slice(1) : txt).split('.');
      const n =
        BigInt(e || '0') * 10n ** BigInt(escala) +
        BigInt((d + '000').slice(0, escala) || '0');
      suma += neg ? -n : n;
    }
    const neg = suma < 0n;
    const a = neg ? -suma : suma;
    const base = 10n ** BigInt(escala);
    t[c.clave] =
      escala === 0
        ? `${neg ? '-' : ''}${a}`
        : `${neg ? '-' : ''}${a / base}.${String(a % base).padStart(escala, '0')}`;
  }
  return t;
}
