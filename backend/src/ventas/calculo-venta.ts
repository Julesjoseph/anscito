import {
  aCentavos,
  calcularItbis,
  formatear,
} from '../servicios/calculo-itbis';

// Cálculo de una línea de venta con enteros (centavos y milésimas):
//   bruto     = precio × cantidad (redondeado al centavo, la mitad sube)
//   importe   = bruto − descuento
//   base/ITBIS/total según la tasa y si el precio incluye ITBIS.
// El ITBIS se calcula DESPUÉS del descuento (sobre lo que se cobra).

export type LineaCalculada = {
  bruto: string;
  descuento: string;
  base: string;
  itbis: string;
  total: string;
};

function milesimas(cantidad: string): bigint {
  const [e, d = ''] = cantidad.split('.');
  return BigInt(e) * 1000n + BigInt(d.padEnd(3, '0'));
}

// precio (RD$) × cantidad, redondeado al centavo.
export function bruto(precio: string, cantidad: string): string {
  const c = aCentavos(precio) * milesimas(cantidad);
  return formatear((2n * c + 1000n) / 2000n);
}

// ¿El descuento cabe dentro del máximo (porcentaje como "10.00")?
export function descuentoPermitido(
  brutoLinea: string,
  descuento: string,
  maximoPct: string,
): boolean {
  const [e, d = ''] = maximoPct.split('.');
  const pctCentesimas = BigInt(e) * 100n + BigInt(d.padEnd(2, '0'));
  // descuento / bruto <= pct / 100  ⇔  descuento × 10000 <= bruto × pct(centésimas)
  return aCentavos(descuento) * 10000n <= aCentavos(brutoLinea) * pctCentesimas;
}

export function calcularLinea(
  precio: string,
  cantidad: string,
  descuento: string,
  tasa: string,
  precioIncluyeItbis: boolean,
): LineaCalculada {
  const b = bruto(precio, cantidad);
  const importe = aCentavos(b) - aCentavos(descuento);
  if (importe < 0n)
    throw new Error('El descuento no puede ser mayor que la línea');
  const d = calcularItbis(formatear(importe), tasa, precioIncluyeItbis);
  return { bruto: b, descuento, base: d.base, itbis: d.itbis, total: d.total };
}

// Suma de montos en texto, sin decimales flotantes.
export function sumar(montos: string[]): string {
  return formatear(montos.reduce((s, m) => s + aCentavos(m), 0n));
}

export function restar(a: string, b: string): string {
  return formatear(aCentavos(a) - aCentavos(b));
}

export function mayorOIgual(a: string, b: string): boolean {
  return aCentavos(a) >= aCentavos(b);
}
