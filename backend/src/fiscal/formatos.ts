// Formatos de envío de la DGII (Norma General 07-2018): filas del 606
// (compras) y del 607 (ventas) y su archivo TXT (campos separados por "|",
// primera línea: formato|RNC|período|cantidad). Funciones puras, sin base de
// datos. El TXT debe pre-validarse con la herramienta de la DGII antes de
// enviarlo; el contador lo revisa.

export type Fila606 = {
  rnc: string; // 1  RNC o cédula del proveedor
  tipoId: string; // 2  1 = RNC, 2 = cédula
  tipoBienes: string; // 3  01 a 11
  ncf: string; // 4
  ncfModificado: string; // 5
  fechaComprobante: string; // 6  AAAAMMDD
  fechaPago: string; // 7  AAAAMMDD o vacío
  servicios: string; // 8
  bienes: string; // 9
  total: string; // 10 servicios + bienes
  itbis: string; // 11
  itbisRetenido: string; // 12
  itbisProporcionalidad: string; // 13
  itbisCosto: string; // 14
  itbisAdelantar: string; // 15 itbis − itbisCosto
  itbisPercibido: string; // 16 (no habilitado: vacío)
  tipoRetencion: string; // 17 01 a 09 o vacío
  retencionRenta: string; // 18
  isrPercibido: string; // 19 (no habilitado: vacío)
  isc: string; // 20
  otrosImpuestos: string; // 21
  propina: string; // 22
  formaPago: string; // 23 01 a 07
};

export type Fila607 = {
  rnc: string; // 1  RNC, cédula o pasaporte del comprador (vacío si no hay)
  tipoId: string; // 2  1 = RNC, 2 = cédula, 3 = pasaporte
  ncf: string; // 3
  ncfModificado: string; // 4
  tipoIngreso: string; // 5  01 a 06
  fechaComprobante: string; // 6  AAAAMMDD
  fechaRetencion: string; // 7
  montoFacturado: string; // 8  sin impuestos
  itbis: string; // 9
  itbisRetenido: string; // 10
  itbisPercibido: string; // 11 (no habilitado: vacío)
  retencionRenta: string; // 12
  isrPercibido: string; // 13 (no habilitado: vacío)
  isc: string; // 14
  otrosImpuestos: string; // 15
  propina: string; // 16
  efectivo: string; // 17
  chequeTransferencia: string; // 18
  tarjeta: string; // 19
  credito: string; // 20
  bonos: string; // 21
  permuta: string; // 22
  otras: string; // 23
};

export const CAMPOS_606: [keyof Fila606, string][] = [
  ['rnc', 'RNC o Cédula'],
  ['tipoId', 'Tipo Id'],
  ['tipoBienes', 'Tipo Bienes y Servicios Comprados'],
  ['ncf', 'NCF'],
  ['ncfModificado', 'NCF o Documento Modificado'],
  ['fechaComprobante', 'Fecha Comprobante'],
  ['fechaPago', 'Fecha Pago'],
  ['servicios', 'Monto Facturado en Servicios'],
  ['bienes', 'Monto Facturado en Bienes'],
  ['total', 'Total Monto Facturado'],
  ['itbis', 'ITBIS Facturado'],
  ['itbisRetenido', 'ITBIS Retenido'],
  ['itbisProporcionalidad', 'ITBIS sujeto a Proporcionalidad (Art. 349)'],
  ['itbisCosto', 'ITBIS llevado al Costo'],
  ['itbisAdelantar', 'ITBIS por Adelantar'],
  ['itbisPercibido', 'ITBIS percibido en compras'],
  ['tipoRetencion', 'Tipo de Retención en ISR'],
  ['retencionRenta', 'Monto Retención Renta'],
  ['isrPercibido', 'ISR Percibido en compras'],
  ['isc', 'Impuesto Selectivo al Consumo'],
  ['otrosImpuestos', 'Otros Impuestos/Tasas'],
  ['propina', 'Monto Propina Legal'],
  ['formaPago', 'Forma de Pago'],
];

export const CAMPOS_607: [keyof Fila607, string][] = [
  ['rnc', 'RNC/Cédula o Pasaporte'],
  ['tipoId', 'Tipo Identificación'],
  ['ncf', 'Número Comprobante Fiscal'],
  ['ncfModificado', 'Número Comprobante Fiscal Modificado'],
  ['tipoIngreso', 'Tipo de Ingreso'],
  ['fechaComprobante', 'Fecha Comprobante'],
  ['fechaRetencion', 'Fecha de Retención'],
  ['montoFacturado', 'Monto Facturado'],
  ['itbis', 'ITBIS Facturado'],
  ['itbisRetenido', 'ITBIS Retenido por Terceros'],
  ['itbisPercibido', 'ITBIS Percibido'],
  ['retencionRenta', 'Retención Renta por Terceros'],
  ['isrPercibido', 'ISR Percibido'],
  ['isc', 'Impuesto Selectivo al Consumo'],
  ['otrosImpuestos', 'Otros Impuestos/Tasas'],
  ['propina', 'Monto Propina Legal'],
  ['efectivo', 'Efectivo'],
  ['chequeTransferencia', 'Cheque/Transferencia/Depósito'],
  ['tarjeta', 'Tarjeta Débito/Crédito'],
  ['credito', 'Venta a Crédito'],
  ['bonos', 'Bonos o Certificados de Regalo'],
  ['permuta', 'Permuta'],
  ['otras', 'Otras Formas de Ventas'],
];

// ---------- Ayudas ----------

export function centavos(v: string | null | undefined): bigint {
  const s = (v ?? '0').trim() || '0';
  const neg = s.startsWith('-');
  const [e, d = ''] = (neg ? s.slice(1) : s).split('.');
  const c = BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2));
  return neg ? -c : c;
}

export function texto2(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

// "2026-10-05" → "20261005".
export function fechaDgii(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10).replace(/-/g, '') : '';
}

// Período "AAAAMM" válido (mes 01 a 12).
export function periodoValido(p: string): boolean {
  return /^\d{4}(0[1-9]|1[0-2])$/.test(p);
}

// Primer día del período y del siguiente ("AAAA-MM-01").
export function rangoPeriodo(p: string): { desde: string; hasta: string } {
  const a = Number(p.slice(0, 4));
  const m = Number(p.slice(4, 6));
  const sig =
    m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { desde: `${p.slice(0, 4)}-${p.slice(4, 6)}-01`, hasta: `${sig}-01` };
}

// Documento sin guiones ni espacios.
export function limpiarDocumento(v: string | null | undefined): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Tipo de identificación por el largo del documento (607: 1 RNC, 2 cédula,
// 3 pasaporte u otro). Vacío si no hay documento.
export function tipoIdPorDocumento(doc: string): string {
  if (!doc) return '';
  if (/^\d{9}$/.test(doc)) return '1';
  if (/^\d{11}$/.test(doc)) return '2';
  return '3';
}

// Forma de pago del 606: 01 efectivo, 02 cheque/transferencia/depósito,
// 04 compra a crédito, 07 mixto.
export function formaPago606(
  pagado: bigint,
  aPagar: bigint,
  formas: string[],
): string {
  if (pagado <= 0n) return '04';
  if (pagado < aPagar) return '07';
  const unicas = [...new Set(formas)];
  if (unicas.length === 1 && unicas[0] === 'efectivo') return '01';
  if (unicas.length === 1 && unicas[0] === 'banco') return '02';
  return '07';
}

// Reparte lo cobrado de una venta en las columnas de forma de pago del 607
// según el código de la forma de pago del sistema.
export function formasCobro607(
  pagos: { codigo: string; monto: string }[],
): Pick<
  Fila607,
  | 'efectivo'
  | 'chequeTransferencia'
  | 'tarjeta'
  | 'credito'
  | 'bonos'
  | 'permuta'
  | 'otras'
> {
  const s = {
    efectivo: 0n,
    chequeTransferencia: 0n,
    tarjeta: 0n,
    credito: 0n,
    bonos: 0n,
    permuta: 0n,
    otras: 0n,
  };
  for (const p of pagos) {
    const m = centavos(p.monto);
    if (p.codigo === 'efectivo') s.efectivo += m;
    else if (['transferencia', 'cheque', 'deposito'].includes(p.codigo))
      s.chequeTransferencia += m;
    else if (p.codigo.startsWith('tarjeta')) s.tarjeta += m;
    else if (p.codigo === 'credito') s.credito += m;
    else s.otras += m;
  }
  return {
    efectivo: texto2(s.efectivo),
    chequeTransferencia: texto2(s.chequeTransferencia),
    tarjeta: texto2(s.tarjeta),
    credito: texto2(s.credito),
    bonos: texto2(s.bonos),
    permuta: texto2(s.permuta),
    otras: texto2(s.otras),
  };
}

// ---------- Archivo TXT ----------

function linea<T>(fila: T, campos: [keyof T, string][]): string {
  return campos.map(([k]) => String(fila[k] ?? '')).join('|');
}

export function txt606(rnc: string, periodo: string, filas: Fila606[]): string {
  return (
    [
      `606|${rnc}|${periodo}|${filas.length}`,
      ...filas.map((f) => linea(f, CAMPOS_606)),
    ].join('\r\n') + '\r\n'
  );
}

export function txt607(rnc: string, periodo: string, filas: Fila607[]): string {
  return (
    [
      `607|${rnc}|${periodo}|${filas.length}`,
      ...filas.map((f) => linea(f, CAMPOS_607)),
    ].join('\r\n') + '\r\n'
  );
}

// Nombre que usa la herramienta de la DGII: DGII_F_606_RNC_AAAAMM.TXT
export function nombreArchivo(
  formato: '606' | '607',
  rnc: string,
  periodo: string,
  ext: 'TXT' | 'xlsx',
): string {
  return `DGII_F_${formato}_${rnc}_${periodo}.${ext}`;
}
