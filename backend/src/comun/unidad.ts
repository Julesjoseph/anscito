import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';

// Línea de negocio (unidad) opcional de un gasto: vacía = gastos generales
// (decisión del dueño: los gastos comunes no se reparten).

type Consulta = Pick<DatabaseService, 'query'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function leerUnidad(
  c: Consulta,
  v: unknown,
): Promise<{ id: string; nombre: string } | null> {
  const id =
    typeof v === 'string' || typeof v === 'number'
      ? String(v).trim().toLowerCase()
      : '';
  if (!id) return null;
  if (!UUID.test(id))
    throw new BadRequestException('Línea de negocio inválida');
  const r = await c.query<{ id: string; nombre: string }>(
    'SELECT id, nombre FROM unidades_negocio WHERE id = $1 AND is_active',
    [id],
  );
  if (r.rowCount === 0)
    throw new BadRequestException('La línea de negocio no existe');
  return r.rows[0];
}

// Lista para las pantallas.
export const SQL_UNIDADES =
  'SELECT id, nombre FROM unidades_negocio WHERE is_active ORDER BY lower(nombre)';
