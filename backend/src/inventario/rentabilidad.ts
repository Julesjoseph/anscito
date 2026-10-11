import { aCentavos, formatear } from '../servicios/calculo-itbis';

// Ganancia y porcentajes con enteros (centavos), sin ITBIS: el ITBIS no es
// ganancia, se cobra al cliente y se entrega a la DGII.

export type Rentabilidad = {
  ganancia: string; // por unidad, en RD$
  margen: string | null; // ganancia / precio, en % con 1 decimal
  sobreCosto: string | null; // ganancia / costo, en % con 1 decimal
};

function aCentavosConSigno(monto: string): bigint {
  return monto.startsWith('-') ? -aCentavos(monto.slice(1)) : aCentavos(monto);
}

function formatearConSigno(c: bigint): string {
  return c < 0n ? `-${formatear(-c)}` : formatear(c);
}

// num / den en porcentaje con 1 decimal; la mitad se aleja del cero.
export function porcentaje(num: bigint, den: bigint): string | null {
  if (den <= 0n) return null;
  const negativo = num < 0n;
  const abs = negativo ? -num : num;
  const decimas = (abs * 2000n + den) / (2n * den); // décimas de %
  const texto = `${decimas / 10n}.${decimas % 10n}`;
  return negativo && decimas > 0n ? `-${texto}` : texto;
}

// costo y precio por unidad, ambos sin ITBIS.
export function rentabilidad(costo: string, precioBase: string): Rentabilidad {
  const c = aCentavosConSigno(costo);
  const p = aCentavosConSigno(precioBase);
  const g = p - c;
  return {
    ganancia: formatearConSigno(g),
    margen: porcentaje(g, p),
    sobreCosto: porcentaje(g, c),
  };
}

// Diferencia de dos montos (pueden ser negativos), para totales.
export function restar(a: string, b: string): string {
  return formatearConSigno(aCentavosConSigno(a) - aCentavosConSigno(b));
}

export function margenTotal(ganancia: string, venta: string) {
  return porcentaje(aCentavosConSigno(ganancia), aCentavosConSigno(venta));
}
