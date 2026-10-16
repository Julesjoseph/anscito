import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';
import { armarCodigo } from '../inventario/cantidades';

// Códigos automáticos de productos y servicios (decisión del dueño): prefijo
// de la categoría + número de 4 cifras (LEG-0001). Productos y servicios de
// una categoría usan el mismo contador, así un código no se repite.

type Consulta = Pick<DatabaseService, 'query'>;

// Base del prefijo sugerido: las 3 primeras letras del nombre, sin tildes ni
// símbolos ("Útiles escolares" → "UTI"). Si no alcanza, "CAT".
export function basePrefijo(nombre: string): string {
  const letras = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return letras.length >= 2 ? letras.slice(0, 3) : 'CAT';
}

// Prefijo sugerido y libre: la base o la base con un número (TRA, TRA2…).
export async function prefijoLibre(
  c: Consulta,
  nombre: string,
): Promise<string> {
  const base = basePrefijo(nombre);
  for (let n = 1; n < 100; n++) {
    const candidato = n === 1 ? base : `${base}${n}`;
    const r = await c.query('SELECT 1 FROM categorias WHERE prefijo = $1', [
      candidato,
    ]);
    if (r.rowCount === 0) return candidato;
  }
  throw new BadRequestException(
    'No se pudo sugerir un prefijo: escríbalo en Categorías',
  );
}

// Siguiente código libre de la categoría. La fila de la categoría queda
// bloqueada hasta terminar: dos personas no reciben el mismo número, y si
// algo falla el número no se pierde. Salta los códigos que ya existan.
export async function siguienteCodigo(
  c: Consulta,
  categoriaId: string,
): Promise<string> {
  for (let intento = 0; intento < 1000; intento++) {
    const n = await c.query<{
      prefijo: string | null;
      ultimo_numero: number;
      nombre: string;
    }>(
      `UPDATE categorias SET ultimo_numero = ultimo_numero + 1
       WHERE id = $1 RETURNING prefijo, ultimo_numero, nombre`,
      [categoriaId],
    );
    const x = n.rows[0];
    if (!x) throw new BadRequestException('La categoría no existe');
    if (!x.prefijo)
      throw new BadRequestException(
        `La categoría "${x.nombre}" no tiene prefijo. Asígnele uno en Categorías.`,
      );
    const codigo = armarCodigo(x.prefijo, x.ultimo_numero);
    const usado = await c.query(
      `SELECT 1 FROM productos WHERE codigo = $1
       UNION ALL SELECT 1 FROM servicios WHERE codigo = $1`,
      [codigo],
    );
    if (usado.rowCount === 0) return codigo;
  }
  throw new BadRequestException('No se encontró un código libre');
}
