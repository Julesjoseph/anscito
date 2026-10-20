// Cálculos de la nómina, con aritmética entera (centavos). Los valores de
// ley llegan como texto de nomina_parametros (hasta 4 decimales) y nunca se
// escriben en el código.

export type Frecuencia = 'semanal' | 'quincenal' | 'mensual';

export type Parametros = {
  dias_mes: string; // 23.83
  horas_dia: string; // 8
  semanas_mes: string; // 4.3333
  recargo_extra: string; // 35 (%)
  recargo_extra_alto: string; // 100 (%)
  vacaciones_dias: string; // 14
  vacaciones_dias_5: string; // 18
};

export const CLAVES_PARAMETROS: (keyof Parametros)[] = [
  'dias_mes',
  'horas_dia',
  'semanas_mes',
  'recargo_extra',
  'recargo_extra_alto',
  'vacaciones_dias',
  'vacaciones_dias_5',
];

const X4 = 10_000n;

// "23.83" → 238300n (×10 000). Acepta hasta 4 decimales.
export function escala4(v: string): bigint {
  const t = v.trim();
  if (!/^\d{1,6}(\.\d{1,8})?$/.test(t))
    throw new Error(`Número inválido: ${v}`);
  const [e, d = ''] = t.split('.');
  return BigInt(e) * X4 + BigInt((d + '0000').slice(0, 4));
}

// "12.5" horas → 1250n (centésimas).
export function centesimas(v: string): bigint {
  const t = v.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t))
    throw new Error(`Número inválido: ${v}`);
  const [e, d = ''] = t.split('.');
  return BigInt(e) * 100n + BigInt((d + '00').slice(0, 2));
}

export function aCentavos(v: string): bigint {
  const neg = v.startsWith('-');
  const [e, d = ''] = (neg ? v.slice(1) : v).split('.');
  const n = BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2));
  return neg ? -n : n;
}

export function aTexto(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

// num / den redondeado a la unidad (la mitad hacia arriba); num, den ≥ 0.
function dividir(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n);
}

// Sueldo de un pago según la frecuencia: mensual completo, quincena = la
// mitad, semana = mensual ÷ semanas del mes.
export function sueldoPeriodo(
  mensual: string,
  frecuencia: Frecuencia,
  p: Parametros,
): string {
  const m = aCentavos(mensual);
  if (frecuencia === 'mensual') return aTexto(m);
  if (frecuencia === 'quincenal') return aTexto(dividir(m, 2n));
  return aTexto(dividir(m * X4, escala4(p.semanas_mes)));
}

// Valor de una hora normal: mensual ÷ días del mes ÷ horas del día.
export function valorHora(mensual: string, p: Parametros): string {
  return aTexto(
    dividir(
      aCentavos(mensual) * X4 * X4,
      escala4(p.dias_mes) * escala4(p.horas_dia),
    ),
  );
}

// Pago de las horas extra: horas × valor de la hora × (1 + recargo). Se
// calcula exacto y se redondea una sola vez al final.
export function montoExtra(
  mensual: string,
  horas: string,
  horasAlto: string,
  p: Parametros,
): string {
  const m = aCentavos(mensual);
  const h = centesimas(horas);
  const ha = centesimas(horasAlto);
  // hora = m / (dias × horas_dia); factor = 1 + recargo / 100
  // monto = m × h/100 × (100×X4 + R)/(100×X4) / (D/X4 × HD/X4)
  const base = 100n * X4;
  const num =
    m *
    (h * (base + escala4(p.recargo_extra)) +
      ha * (base + escala4(p.recargo_extra_alto))) *
    X4 *
    X4;
  const den = 100n * base * escala4(p.dias_mes) * escala4(p.horas_dia);
  return aTexto(dividir(num, den));
}

// Salario diario × días (vacaciones).
export function montoDias(
  mensual: string,
  dias: string,
  p: Parametros,
): string {
  return aTexto(
    dividir(
      aCentavos(mensual) * centesimas(dias) * X4,
      escala4(p.dias_mes) * 100n,
    ),
  );
}

// Días de vacaciones según los años cumplidos a la fecha.
export function diasVacaciones(
  ingreso: string,
  fecha: string,
  p: Parametros,
): string {
  const [a1, m1, d1] = ingreso.split('-').map(Number);
  const [a2, m2, d2] = fecha.split('-').map(Number);
  let anos = a2 - a1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) anos--;
  const v = anos >= 5 ? p.vacaciones_dias_5 : p.vacaciones_dias;
  return aTexto(escala4(v) / 100n);
}

function diaDelAno(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number);
  return (Date.UTC(a, m - 1, d) - Date.UTC(a, 0, 1)) / 86_400_000 + 1;
}

// Regalía pascual: la doceava parte de lo ganado en el año. Con el sueldo
// mensual de hoy: sueldo × días trabajados en el año ÷ días del año (un año
// completo = un sueldo). Se puede corregir a mano en el borrador.
export function regalia(
  mensual: string,
  ingreso: string,
  ano: number,
  hasta: string,
): string {
  const finAno = `${ano}-12-31`;
  const corte = hasta < finAno ? hasta : finAno;
  const desde = ingreso > `${ano}-01-01` ? ingreso : `${ano}-01-01`;
  if (desde > corte) return '0.00';
  const total = diaDelAno(finAno);
  const dias = BigInt(diaDelAno(corte) - diaDelAno(desde) + 1);
  return aTexto(dividir(aCentavos(mensual) * dias, BigInt(total)));
}
