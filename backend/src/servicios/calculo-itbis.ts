// Cálculos de dinero con enteros (centavos) para no perder precisión.
// Redondeo: al centavo más cercano; la mitad sube (0.005 -> 0.01).

const MONTO = /^\d{1,12}(\.\d{1,2})?$/;
const TASA = /^\d{1,3}(\.\d{1,2})?$/;

export type Desglose = { base: string; itbis: string; total: string };

// Devuelve el monto normalizado con 2 decimales, o null si no es válido.
export function normalizarMonto(valor: unknown): string | null {
  const texto =
    typeof valor === 'number'
      ? String(valor)
      : typeof valor === 'string'
        ? valor.trim()
        : '';
  if (!MONTO.test(texto)) return null;
  return formatear(aCentavos(texto));
}

export function aCentavos(monto: string): bigint {
  const [entero, decimales = ''] = monto.split('.');
  return BigInt(entero) * 100n + BigInt(decimales.padEnd(2, '0'));
}

export function formatear(centavos: bigint): string {
  const entero = centavos / 100n;
  const resto = (centavos % 100n).toString().padStart(2, '0');
  return `${entero}.${resto}`;
}

// Tasa en centésimas de porcentaje: "18.00" -> 1800.
function tasaEnCentesimas(tasa: string): bigint {
  if (!TASA.test(tasa)) throw new Error(`Tasa inválida: ${tasa}`);
  const [entero, decimales = ''] = tasa.split('.');
  return BigInt(entero) * 100n + BigInt(decimales.padEnd(2, '0'));
}

function dividirRedondeando(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

export function calcularItbis(
  precio: string,
  tasa: string,
  precioIncluyeItbis: boolean,
): Desglose {
  const p = aCentavos(precio);
  const t = tasaEnCentesimas(tasa);

  if (precioIncluyeItbis) {
    const base = dividirRedondeando(p * 10000n, 10000n + t);
    return {
      base: formatear(base),
      itbis: formatear(p - base),
      total: formatear(p),
    };
  }

  const itbis = dividirRedondeando(p * t, 10000n);
  return {
    base: formatear(p),
    itbis: formatear(itbis),
    total: formatear(p + itbis),
  };
}
