import type { DatabaseService } from '../database/database.service';

// Requisitos para entrar a un SAN (los usan el registro de números y los
// contratos): teléfono, ficha, fiador confirmado y al menos una referencia
// confirmada. El documento del participante y su foto son opcionales.

type Consulta = Pick<DatabaseService, 'query'>;

// Lo que le falta a una persona para entrar a un SAN (vacío = completo).
export async function faltantesFicha(
  c: Consulta,
  terceroId: string,
): Promise<string[]> {
  const r = await c.query<{
    ficha: boolean;
    telefono: boolean;
    fiador: boolean;
    fiador_ok: boolean;
    referencias_ok: number;
  }>(
    `SELECT EXISTS (SELECT 1 FROM san_fichas WHERE tercero_id = t.id) AS ficha,
            (t.telefono IS NOT NULL OR t.whatsapp IS NOT NULL) AS telefono,
            EXISTS (SELECT 1 FROM san_garantes WHERE tercero_id = t.id AND tipo = 'fiador' AND is_active) AS fiador,
            EXISTS (SELECT 1 FROM san_garantes WHERE tercero_id = t.id AND tipo = 'fiador' AND is_active AND confirmado) AS fiador_ok,
            (SELECT count(*)::int FROM san_garantes WHERE tercero_id = t.id AND tipo = 'referencia' AND is_active AND confirmado) AS referencias_ok
     FROM terceros t WHERE t.id = $1`,
    [terceroId],
  );
  if (r.rowCount === 0) return ['el cliente no existe'];
  const f = r.rows[0];
  const falta: string[] = [];
  if (!f.telefono) falta.push('teléfono o WhatsApp');
  if (!f.ficha) falta.push('ficha (ocupación y dirección)');
  if (!f.fiador) falta.push('fiador');
  else if (!f.fiador_ok) falta.push('confirmar el fiador');
  if (f.referencias_ok < 1) falta.push('al menos una referencia confirmada');
  return falta;
}
