import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';
import { centavos, texto2 } from '../sanes/calendario';

// Registrar un asiento (partida doble). Lo usan los asientos manuales, la
// apertura, los reversos y, más adelante, los asientos automáticos de cada
// módulo. La base de datos vuelve a revisar al terminar la transacción que
// cuadre, que las cuentas acepten movimientos y que el mes esté abierto.

type Consulta = Pick<DatabaseService, 'query'>;

export type LineaAsiento = {
  cuentaId: string;
  debito: string; // "0.00" o un monto
  credito: string;
  descripcion?: string | null;
  terceroId?: string | null;
  unidadNegocioId?: string | null;
};

export function numeroAsiento(n: number | string) {
  return `AS-${String(n).padStart(6, '0')}`;
}

// Débitos y créditos en centavos (nunca con Number).
export function totalesAsiento(lineas: LineaAsiento[]) {
  const debito = lineas.reduce((a, l) => a + centavos(l.debito), 0n);
  const credito = lineas.reduce((a, l) => a + centavos(l.credito), 0n);
  return { debito, credito };
}

export async function registrarAsiento(
  c: Consulta,
  datos: {
    fecha: string;
    concepto: string;
    origen: string;
    documento?: string | null;
    reversoDe?: string | null;
    origenTabla?: string | null; // asiento automático: de qué operación viene
    origenId?: string | null;
    lineas: LineaAsiento[];
    usuarioId: string;
  },
): Promise<{ id: string; numero: string; codigo: string }> {
  if (datos.lineas.length < 2)
    throw new BadRequestException('Un asiento lleva al menos dos líneas');
  const { debito, credito } = totalesAsiento(datos.lineas);
  if (debito === 0n || debito !== credito)
    throw new BadRequestException(
      `El asiento no cuadra: débitos RD$${texto2(debito)} y créditos RD$${texto2(credito)}`,
    );
  const n = (
    await c.query<{ valor: string }>(
      `UPDATE contadores SET valor = valor + 1 WHERE clave = 'asientos' RETURNING valor`,
    )
  ).rows[0].valor;
  const r = await c.query<{ id: string }>(
    `INSERT INTO asientos (numero, fecha, concepto, origen, documento, reverso_de, origen_tabla, origen_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      n,
      datos.fecha,
      datos.concepto.slice(0, 300),
      datos.origen,
      datos.documento ?? null,
      datos.reversoDe ?? null,
      datos.origenTabla ?? null,
      datos.origenId ?? null,
      datos.usuarioId,
    ],
  );
  const id = r.rows[0].id;
  for (const l of datos.lineas)
    await c.query(
      `INSERT INTO asiento_lineas (asiento_id, cuenta_id, debito, credito, descripcion, tercero_id, unidad_negocio_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        l.cuentaId,
        l.debito,
        l.credito,
        l.descripcion ?? null,
        l.terceroId ?? null,
        l.unidadNegocioId ?? null,
      ],
    );
  return { id, numero: n, codigo: numeroAsiento(n) };
}

// Anular un asiento: queda "anulado" y se registra su reverso (débitos y
// créditos al revés), en la fecha del original si su mes está abierto o,
// si no, en la fecha "hoy". Lo usan la anulación manual y la automática
// (cuando se anula la operación que lo generó).
export async function anularAsientoEn(
  c: Consulta,
  datos: { id: string; motivo: string; usuarioId: string; hoy: string },
): Promise<{ reverso: string; fechaReverso: string; codigo: string }> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    origen: string;
    estado: string;
    documento: string | null;
  }>(
    `SELECT numero, to_char(fecha, 'YYYY-MM-DD') AS fecha, origen, estado, documento
     FROM asientos WHERE id = $1 FOR UPDATE`,
    [datos.id],
  );
  if (r.rowCount === 0) throw new BadRequestException('Asiento no encontrado');
  const a = r.rows[0];
  if (a.origen === 'reverso')
    throw new BadRequestException('Un asiento de reverso no se anula');
  if (a.estado === 'anulado')
    throw new BadRequestException('El asiento ya está anulado');
  const cerrado = await c.query(
    `SELECT 1 FROM periodos_contables
     WHERE anio = extract(year FROM $1::date) AND mes = extract(month FROM $1::date) AND estado = 'cerrado'`,
    [a.fecha],
  );
  const fecha = (cerrado.rowCount ?? 0) > 0 ? datos.hoy : a.fecha;
  const lineas = await c.query<{
    cuenta_id: string;
    debito: string;
    credito: string;
    descripcion: string | null;
    tercero_id: string | null;
    unidad_negocio_id: string | null;
  }>(
    `SELECT cuenta_id, debito, credito, descripcion, tercero_id, unidad_negocio_id
     FROM asiento_lineas WHERE asiento_id = $1 ORDER BY id`,
    [datos.id],
  );
  const codigo = numeroAsiento(a.numero);
  await c.query(
    `UPDATE asientos SET estado = 'anulado', anulado_por = $2, anulado_en = now(), motivo_anulacion = $3
     WHERE id = $1`,
    [datos.id, datos.usuarioId, datos.motivo.slice(0, 500)],
  );
  const rev = await registrarAsiento(c, {
    fecha,
    concepto: `Reverso de ${codigo}: ${datos.motivo}`,
    origen: 'reverso',
    documento: a.documento,
    reversoDe: datos.id,
    lineas: lineas.rows.map((l) => ({
      cuentaId: l.cuenta_id,
      debito: l.credito,
      credito: l.debito,
      descripcion: l.descripcion,
      terceroId: l.tercero_id,
      unidadNegocioId: l.unidad_negocio_id,
    })),
    usuarioId: datos.usuarioId,
  });
  return { reverso: rev.codigo, fechaReverso: fecha, codigo };
}
