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
    `INSERT INTO asientos (numero, fecha, concepto, origen, documento, reverso_de, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      n,
      datos.fecha,
      datos.concepto,
      datos.origen,
      datos.documento ?? null,
      datos.reversoDe ?? null,
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
