// Cálculos de un envío con aritmética entera (sin decimales flotantes).
// Montos con 2 decimales; tasa con hasta 6; porcentajes con hasta 2.
// Redondeo: mitad hacia arriba, como en el resto del sistema.

export type Tarifa = {
  tasa: string; // HTG por 1 RD$
  comision_pct: string;
  comision_agente_pct: string;
};

export type CalculoEnvio = {
  monto_enviado: string;
  tasa: string;
  monto_recibir: string;
  comision_pct: string;
  comision: string;
  total_pagar: string;
  comision_agente_pct: string;
  comision_agente: string;
  comision_scito: string;
};

// "12.5" con 6 decimales -> 12500000n
function escalar(v: string, decimales: number): bigint {
  const [e, d = ''] = v.split('.');
  return (
    BigInt(e || '0') * 10n ** BigInt(decimales) +
    BigInt((d + '0'.repeat(decimales)).slice(0, decimales) || '0')
  );
}

// a / b redondeando la mitad hacia arriba (a y b positivos).
function dividir(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}

function texto2(centavos: bigint): string {
  return `${centavos / 100n}.${String(centavos % 100n).padStart(2, '0')}`;
}

export function calcularEnvio(
  montoEnviado: string,
  tarifa: Tarifa,
  propio: boolean,
): CalculoEnvio {
  const enviado = escalar(montoEnviado, 2); // centavos de RD$
  const tasa = escalar(tarifa.tasa, 6);
  const pct = escalar(tarifa.comision_pct, 2); // 10.00 -> 1000
  const pctAgente = propio ? 0n : escalar(tarifa.comision_agente_pct, 2);

  const recibir = dividir(enviado * tasa, 1_000_000n); // centavos de HTG
  const comision = dividir(enviado * pct, 10_000n);
  const comisionAgente = dividir(comision * pctAgente, 10_000n);
  return {
    monto_enviado: texto2(enviado),
    tasa: tarifa.tasa,
    monto_recibir: texto2(recibir),
    comision_pct: tarifa.comision_pct,
    comision: texto2(comision),
    total_pagar: texto2(enviado + comision),
    comision_agente_pct: propio ? '0.00' : tarifa.comision_agente_pct,
    comision_agente: texto2(comisionAgente),
    comision_scito: texto2(comision - comisionAgente),
  };
}

export function numeroEnvio(n: number | string): string {
  return `E-${String(n).padStart(6, '0')}`;
}

// Teléfono de Haití: 8 dígitos (o 509 + 8) -> 509-XX-XX-XXXX. Acepta la
// letra O escrita en lugar del cero. null si no es válido.
export function telefonoHaiti(valor: string): string | null {
  const d = valor.toUpperCase().replace(/O/g, '0').replace(/\D/g, '');
  const ocho = d.length === 11 && d.startsWith('509') ? d.slice(3) : d;
  if (ocho.length !== 8) return null;
  return `509-${ocho.slice(0, 2)}-${ocho.slice(2, 4)}-${ocho.slice(4)}`;
}
