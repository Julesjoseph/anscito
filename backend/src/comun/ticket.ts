// Comprobante "de filas" que la pantalla imprime directo y ajusta al papel
// (58 mm, 80 mm, ancho automático u hoja carta). Lo usan los recibos de
// envío, de SOL CASH y el cuadre de caja; sus PDF salen de los mismos datos.

export type ElementoTicket =
  | { tipo: 'linea' }
  | { tipo: 'titulo'; texto: string }
  | {
      tipo: 'fila';
      izq: string;
      der: string;
      negrita?: boolean;
      grande?: boolean;
    }
  | { tipo: 'nota'; texto: string; negrita?: boolean }
  | { tipo: 'firma'; texto: string };

export type Ticket = {
  documento: string; // ej.: "E-000012", nombre del archivo y de la ventana
  encabezado: { nombre: string; lineas: string[] };
  elementos: ElementoTicket[];
};

export function encabezado(e: {
  nombre_comercial: string;
  rnc?: string | null;
  telefono?: string | null;
  correo?: string | null;
}): Ticket['encabezado'] {
  return {
    nombre: e.nombre_comercial,
    lineas: [
      e.rnc ? `RNC: ${e.rnc}` : '',
      e.telefono ? `Tel: ${e.telefono}` : '',
      e.correo ?? '',
    ].filter(Boolean),
  };
}
