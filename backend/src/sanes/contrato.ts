// Texto del contrato del SAN: reemplaza los marcadores {{…}} de la plantilla
// con los datos del participante, del fiador y del SAN, en el idioma elegido.

export type Idioma = 'es' | 'fr' | 'ht';
export const IDIOMAS: Idioma[] = ['es', 'fr', 'ht'];

export const NOMBRE_IDIOMA: Record<Idioma, string> = {
  es: 'Español',
  fr: 'Français',
  ht: 'Kreyòl ayisyen',
};

const FRECUENCIA: Record<Idioma, Record<string, string>> = {
  es: {
    semanal: 'semanal',
    quincenal: 'quincenal (los días 15 y 30 de cada mes)',
    mensual: 'mensual',
  },
  fr: {
    semanal: 'hebdomadaire',
    quincenal: 'bimensuelle (le 15 et le 30 de chaque mois)',
    mensual: 'mensuelle',
  },
  ht: {
    semanal: 'semèn',
    quincenal: 'kenzèn (15 ak 30 chak mwa)',
    mensual: 'mwa',
  },
};

const PARTE: Record<Idioma, Record<string, string>> = {
  es: { completo: 'número completo', medio: 'medio número' },
  fr: { completo: 'numéro complet', medio: 'demi-numéro' },
  ht: { completo: 'nimewo antye', medio: 'mwatye nimewo' },
};

const FIRMAS: Record<Idioma, [string, string, string]> = {
  es: ['EL PARTICIPANTE', 'EL FIADOR', 'POR LA ADMINISTRADORA'],
  fr: ['LE PARTICIPANT', 'LE GARANT', "POUR L'ADMINISTRATEUR"],
  ht: ['PATISIPAN AN', 'GARANTI A', 'POU ADMINISTRATÈ A'],
};

export type DatosContrato = {
  empresa: string;
  empresa_rnc: string;
  empresa_direccion: string;
  participante: string;
  documento_tipo: string;
  documento: string;
  direccion: string;
  san_codigo: string;
  san_nombre: string;
  numero: string;
  parte: string; // completo | medio
  cuota: string;
  frecuencia: string; // semanal | quincenal | mensual
  cantidad_turnos: string;
  fecha_inicio: string;
  mano: string;
  fecha_mano: string;
  comision_pct: string;
  comision: string;
  dias_gracia: string;
  mora_pct: string;
  fiador: string;
  fiador_documento: string;
  fiador_direccion: string;
  ciudad: string;
  fecha: string;
};

// "2026-10-15" -> "15/10/2026"
export function fechaTexto(f: string): string {
  const [a, m, d] = f.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// "1000.00" -> "RD$1,000.00"
export function pesos(v: string): string {
  const [e, d = '00'] = v.split('.');
  return `RD$${e.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d.padEnd(2, '0')}`;
}

// "5.00" -> "5%", "2.50" -> "2.5%"
export function pct(v: string): string {
  return `${v.replace(/\.?0+$/, '')}%`;
}

// Bloque de firmas al final (tres líneas con su nombre debajo).
function firmas(idioma: Idioma, d: DatosContrato): string {
  const [p, f, a] = FIRMAS[idioma];
  const linea = '______________________________';
  return [
    `${linea}\n${p}: ${d.participante}`,
    `${linea}\n${f}: ${d.fiador}`,
    `${linea}\n${a}: ${d.empresa}`,
  ].join('\n\n');
}

export function llenarPlantilla(
  texto: string,
  idioma: Idioma,
  d: DatosContrato,
): string {
  const valores: Record<string, string> = {
    ...d,
    frecuencia: FRECUENCIA[idioma][d.frecuencia] ?? d.frecuencia,
    parte: PARTE[idioma][d.parte] ?? d.parte,
    firmas: firmas(idioma, d),
  };
  // Un marcador desconocido queda tal cual, para que se note al revisar.
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (todo, clave: string) =>
    clave in valores ? valores[clave] : todo,
  );
}

export const MARCADORES = [
  'empresa',
  'empresa_rnc',
  'empresa_direccion',
  'participante',
  'documento_tipo',
  'documento',
  'direccion',
  'san_codigo',
  'san_nombre',
  'numero',
  'parte',
  'cuota',
  'frecuencia',
  'cantidad_turnos',
  'fecha_inicio',
  'mano',
  'fecha_mano',
  'comision_pct',
  'comision',
  'dias_gracia',
  'mora_pct',
  'fiador',
  'fiador_documento',
  'fiador_direccion',
  'ciudad',
  'fecha',
  'firmas',
];
