// Calendario de turnos de un SAN y cálculos de dinero (enteros, sin
// decimales flotantes). Las fechas son AAAA-MM-DD.

export type Frecuencia = 'semanal' | 'quincenal' | 'mensual';

function partes(f: string): [number, number, number] {
  const [a, m, d] = f.split('-').map(Number);
  return [a, m, d];
}

function texto(a: number, m: number, d: number): string {
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function ultimoDia(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

function sumarDias(f: string, dias: number): string {
  const [a, m, d] = partes(f);
  const x = new Date(Date.UTC(a, m - 1, d + dias));
  return texto(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

// Días entre dos fechas (b − a).
export function diasEntre(a: string, b: string): number {
  const [a1, m1, d1] = partes(a);
  const [a2, m2, d2] = partes(b);
  return Math.round(
    (Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000,
  );
}

export function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = partes(v);
  return m >= 1 && m <= 12 && d >= 1 && d <= ultimoDia(a, m);
}

// Fechas de los turnos 1..n.
//  - semanal: cada 7 días desde el inicio.
//  - mensual: el mismo día de cada mes (si el mes es más corto, su último día).
//  - quincenal: los días 15 y 30 de cada mes (en febrero, el último día);
//    el primer turno es el primer 15 o 30 desde la fecha de inicio.
export function calendario(
  inicio: string,
  frecuencia: Frecuencia,
  n: number,
): string[] {
  const fechas: string[] = [];
  const [a0, m0, d0] = partes(inicio);
  if (frecuencia === 'semanal') {
    for (let k = 0; k < n; k++) fechas.push(sumarDias(inicio, 7 * k));
  } else if (frecuencia === 'mensual') {
    for (let k = 0; k < n; k++) {
      const total = m0 - 1 + k;
      const a = a0 + Math.floor(total / 12);
      const m = (total % 12) + 1;
      fechas.push(texto(a, m, Math.min(d0, ultimoDia(a, m))));
    }
  } else {
    let a = a0;
    let m = m0;
    // ¿Toca el 15 o el "30" de este mes?
    let segunda = d0 > 15;
    if (d0 > Math.min(30, ultimoDia(a, m))) {
      // Después del 30 (día 31): pasa al 15 del mes siguiente.
      segunda = false;
      m += 1;
      if (m > 12) {
        m = 1;
        a += 1;
      }
    }
    while (fechas.length < n) {
      fechas.push(texto(a, m, segunda ? Math.min(30, ultimoDia(a, m)) : 15));
      if (segunda) {
        m += 1;
        if (m > 12) {
          m = 1;
          a += 1;
        }
      }
      segunda = !segunda;
    }
  }
  return fechas;
}

// ---------- Dinero en centavos ----------

export function centavos(v: string): bigint {
  const neg = v.startsWith('-');
  const [e, d = ''] = (neg ? v.slice(1) : v).split('.');
  const n = BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2));
  return neg ? -n : n;
}

export function texto2(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

// monto × pct / 100, redondeando la mitad hacia arriba (centavos).
export function porcentaje(monto: string, pct: string): string {
  const m = centavos(monto);
  const p = centavos(pct); // 5.00 -> 500
  return texto2((m * p * 2n + 10_000n) / 20_000n);
}

// Cuota de una participación: completa o la mitad (la cuota siempre es par en centavos).
export function cuotaDe(cuota: string, parte: 'completo' | 'medio'): string {
  return parte === 'completo' ? cuota : texto2(centavos(cuota) / 2n);
}

// Su parte de la mano: cuota × números (o la mitad si es medio número).
export function manoDe(
  cuota: string,
  numeros: number,
  parte: 'completo' | 'medio',
): string {
  const mano = centavos(cuota) * BigInt(numeros);
  return texto2(parte === 'completo' ? mano : mano / 2n);
}

// Mora de una cuota pagada "hoy": solo si pasaron los días de gracia.
export function moraDe(
  cuota: string,
  vence: string,
  hoy: string,
  diasGracia: number,
  moraPct: string,
): { dias: number; mora: string } {
  const dias = Math.max(0, diasEntre(vence, hoy));
  return {
    dias,
    mora: dias > diasGracia ? porcentaje(cuota, moraPct) : '0.00',
  };
}
