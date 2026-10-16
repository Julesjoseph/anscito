import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { registrarAuditoria } from '../auditoria/auditoria';
import { hoyLocal } from '../cxc/estado';
import { DatabaseService } from '../database/database.service';
import { aExcel, aPdf } from '../reportes/exportar';
import type { Columna, Fila, Reporte } from '../reportes/tipos';
import { texto2 } from '../sanes/calendario';
import { numeroAsiento } from './asientos';
import { CIERRES, agrupar, inicioEjercicio, saldo, utilidad } from './libros';
import type { CuentaSaldo, Grupo } from './libros';

// Libro mayor por cuenta y estados financieros (estado de resultados y
// balance general). Suman TODOS los asientos: un anulado y su reverso se
// cancelan. Sin asientos de cierre todavía: el balance separa la utilidad
// del ejercicio (desde el inicio del año fiscal) de las acumuladas.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function fechaCorta(v: string): string {
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
}

type Filtros = { desde?: unknown; hasta?: unknown; cuentaId?: unknown };

@Injectable()
export class LibrosService {
  constructor(private readonly db: DatabaseService) {}

  private async cierre(): Promise<string> {
    const r = await this.db.query<{ valor: string }>(
      `SELECT valor FROM configuracion WHERE clave = 'contabilidad.cierre_fiscal'`,
    );
    const v = r.rows[0]?.valor ?? '12-31';
    return (CIERRES as readonly string[]).includes(v) ? v : '12-31';
  }

  // Fechas del período (por defecto: del inicio del año fiscal a hoy).
  private async periodo(f: Filtros) {
    const hoy = await hoyLocal(this.db);
    const cierre = await this.cierre();
    const hasta = texto(f.hasta) || hoy;
    const desde = texto(f.desde) || inicioEjercicio(hasta, cierre);
    if (!fechaValida(desde) || !fechaValida(hasta))
      throw new BadRequestException('Fecha inválida (AAAA-MM-DD)');
    if (desde > hasta)
      throw new BadRequestException('La fecha "desde" es después de "hasta"');
    return { desde, hasta, cierre };
  }

  // Saldos de todas las cuentas de detalle en un rango de fechas, con el
  // grupo de nivel 2 al que pertenecen.
  private async saldos(
    desde: string | null,
    hasta: string,
  ): Promise<CuentaSaldo[]> {
    const [cuentas, sumas] = await Promise.all([
      this.db.query<{
        id: string;
        codigo: string;
        nombre: string;
        tipo: string;
        naturaleza: string;
        padre_id: string | null;
        nivel: number;
      }>(
        'SELECT id, codigo, nombre, tipo, naturaleza, padre_id, nivel FROM cuentas_contables',
      ),
      this.db.query<{ cuenta_id: string; debitos: string; creditos: string }>(
        `SELECT l.cuenta_id, sum(l.debito)::numeric(16,2) AS debitos, sum(l.credito)::numeric(16,2) AS creditos
         FROM asiento_lineas l JOIN asientos a ON a.id = l.asiento_id
         WHERE a.fecha <= $1::date AND ($2::date IS NULL OR a.fecha >= $2::date)
         GROUP BY l.cuenta_id`,
        [hasta, desde],
      ),
    ]);
    const porId = new Map(cuentas.rows.map((c) => [c.id, c]));
    const grupoDe = (id: string): string => {
      let c = porId.get(id);
      while (c && c.nivel > 2 && c.padre_id) c = porId.get(c.padre_id);
      return c ? `${c.codigo} ${c.nombre}` : '';
    };
    const cent = (v: string) => {
      const [e, d = ''] = v.split('.');
      return BigInt(e) * 100n + BigInt((d + '00').slice(0, 2));
    };
    return sumas.rows
      .filter((s) => porId.has(s.cuenta_id))
      .map((s) => {
        const c = porId.get(s.cuenta_id)!;
        return {
          id: c.id,
          codigo: c.codigo,
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          grupo: grupoDe(c.id),
          debitos: cent(s.debitos),
          creditos: cent(s.creditos),
        };
      });
  }

  private seccion(s: { grupos: Grupo[]; total: bigint }) {
    return {
      total: texto2(s.total),
      grupos: s.grupos.map((g) => ({
        grupo: g.grupo,
        total: texto2(g.total),
        cuentas: g.cuentas.map((c) => ({ ...c, monto: texto2(c.monto) })),
      })),
    };
  }

  // ---------- Estados financieros ----------

  async estados(f: Filtros) {
    const { desde, hasta, cierre } = await this.periodo(f);
    const inicio = inicioEjercicio(hasta, cierre);
    const [periodo, alCorte, ejercicio, anteriores] = await Promise.all([
      this.saldos(desde, hasta),
      this.saldos(null, hasta),
      this.saldos(inicio, hasta),
      this.saldos(null, this.diaAnterior(inicio)),
    ]);
    // Estado de resultados del período.
    const ingresos = agrupar(periodo, ['ingreso']);
    const costos = agrupar(periodo, ['costo']);
    const gastos = agrupar(periodo, ['gasto']);
    const bruta = ingresos.total - costos.total;
    // Balance general a la fecha "hasta".
    const activos = agrupar(alCorte, ['activo']);
    const pasivos = agrupar(alCorte, ['pasivo']);
    const capital = agrupar(alCorte, ['capital']);
    const delEjercicio = utilidad(ejercicio);
    const acumuladas = utilidad(anteriores);
    const totalCapital = capital.total + acumuladas + delEjercicio;
    const pasivoCapital = pasivos.total + totalCapital;
    return {
      desde,
      hasta,
      cierreFiscal: cierre,
      inicioEjercicio: inicio,
      resultados: {
        ingresos: this.seccion(ingresos),
        costos: this.seccion(costos),
        gastos: this.seccion(gastos),
        utilidadBruta: texto2(bruta),
        utilidadNeta: texto2(bruta - gastos.total),
      },
      balance: {
        fecha: hasta,
        activos: this.seccion(activos),
        pasivos: this.seccion(pasivos),
        capital: this.seccion(capital),
        utilidadesAcumuladas: texto2(acumuladas),
        utilidadEjercicio: texto2(delEjercicio),
        totalCapital: texto2(totalCapital),
        totalPasivoCapital: texto2(pasivoCapital),
        cuadra: activos.total === pasivoCapital,
      },
    };
  }

  private diaAnterior(fecha: string): string {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // ---------- Libro mayor de una cuenta ----------

  async mayor(f: Filtros) {
    const { desde, hasta } = await this.periodo(f);
    const cuentaId = texto(f.cuentaId).toLowerCase();
    if (!UUID.test(cuentaId)) throw new BadRequestException('Escoja la cuenta');
    const c = await this.db.query<{
      codigo: string;
      nombre: string;
      naturaleza: string;
      tipo: string;
    }>(
      'SELECT codigo, nombre, naturaleza, tipo FROM cuentas_contables WHERE id = $1',
      [cuentaId],
    );
    if (c.rowCount === 0) throw new NotFoundException('Cuenta no encontrada');
    const cuenta = c.rows[0];
    const ant = await this.db.query<{ debitos: string; creditos: string }>(
      `SELECT COALESCE(sum(l.debito), 0)::numeric(16,2) AS debitos, COALESCE(sum(l.credito), 0)::numeric(16,2) AS creditos
       FROM asiento_lineas l JOIN asientos a ON a.id = l.asiento_id
       WHERE l.cuenta_id = $1 AND a.fecha < $2::date`,
      [cuentaId, desde],
    );
    const movs = await this.db.query<{
      asiento_id: string;
      numero: string;
      fecha: string;
      concepto: string;
      documento: string | null;
      estado: string;
      debito: string;
      credito: string;
      descripcion: string | null;
    }>(
      `SELECT a.id AS asiento_id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.documento, a.estado,
              l.debito, l.credito, l.descripcion
       FROM asiento_lineas l JOIN asientos a ON a.id = l.asiento_id
       WHERE l.cuenta_id = $1 AND a.fecha BETWEEN $2::date AND $3::date
       ORDER BY a.fecha, a.numero, l.id LIMIT 5001`,
      [cuentaId, desde, hasta],
    );
    if (movs.rows.length > 5000)
      throw new BadRequestException(
        'Demasiados movimientos: escoja un período más corto',
      );
    const cent = (v: string) => {
      const [e, d = ''] = v.split('.');
      return BigInt(e) * 100n + BigInt((d + '00').slice(0, 2));
    };
    const signo = cuenta.naturaleza === 'deudora' ? 1n : -1n;
    const anterior = saldo({
      naturaleza: cuenta.naturaleza,
      debitos: cent(ant.rows[0].debitos),
      creditos: cent(ant.rows[0].creditos),
    });
    let corrido = anterior;
    let td = 0n;
    let tc = 0n;
    const movimientos = movs.rows.map((m) => {
      const d = cent(m.debito);
      const cr = cent(m.credito);
      td += d;
      tc += cr;
      corrido += signo * (d - cr);
      return {
        asientoId: m.asiento_id,
        asiento: numeroAsiento(m.numero),
        fecha: m.fecha,
        concepto: m.concepto,
        documento: m.documento,
        estado: m.estado,
        descripcion: m.descripcion,
        debito: texto2(d),
        credito: texto2(cr),
        saldo: texto2(corrido),
      };
    });
    return {
      desde,
      hasta,
      cuenta: { id: cuentaId, ...cuenta },
      saldoAnterior: texto2(anterior),
      movimientos,
      totales: { debitos: texto2(td), creditos: texto2(tc) },
      saldoFinal: texto2(corrido),
    };
  }

  // ---------- Excel y PDF ----------

  private filasSeccion(
    titulo: string,
    s: ReturnType<LibrosService['seccion']>,
    etiquetaTotal = `TOTAL ${titulo.toUpperCase()}`,
  ): Fila[] {
    const filas: Fila[] = [
      { codigo: '', cuenta: titulo.toUpperCase(), monto: null },
    ];
    for (const g of s.grupos) {
      filas.push({ codigo: '', cuenta: g.grupo, monto: null });
      for (const c of g.cuentas)
        filas.push({
          codigo: c.codigo,
          cuenta: `   ${c.nombre}`,
          monto: c.monto,
        });
      filas.push({ codigo: '', cuenta: `Total ${g.grupo}`, monto: g.total });
    }
    filas.push({
      codigo: '',
      cuenta: etiquetaTotal,
      monto: s.total,
    });
    return filas;
  }

  private async reporte(tipo: string, f: Filtros): Promise<Reporte> {
    const nota =
      'Catálogo y reglas sugeridos: deben validarse con el contador. Incluye todos los asientos (un anulado y su reverso se cancelan).';
    const cols: Columna[] = [
      { clave: 'codigo', titulo: 'Código', tipo: 'texto' },
      { clave: 'cuenta', titulo: 'Cuenta', tipo: 'texto' },
      { clave: 'monto', titulo: 'Monto (RD$)', tipo: 'dinero' },
    ];
    if (tipo === 'resultados' || tipo === 'balance') {
      const e = await this.estados(f);
      if (tipo === 'resultados') {
        const r = e.resultados;
        return {
          codigo: 'estado_resultados',
          titulo: 'Estado de resultados',
          periodo: `Del ${fechaCorta(e.desde)} al ${fechaCorta(e.hasta)}`,
          columnas: cols,
          filas: [
            ...this.filasSeccion('Ingresos', r.ingresos),
            ...this.filasSeccion('Costos', r.costos),
            { codigo: '', cuenta: 'UTILIDAD BRUTA', monto: r.utilidadBruta },
            ...this.filasSeccion('Gastos', r.gastos),
            {
              codigo: '',
              cuenta: 'UTILIDAD (PÉRDIDA) NETA',
              monto: r.utilidadNeta,
            },
          ],
          totales: null,
          notas: [nota, 'Antes del impuesto sobre la renta.'],
        };
      }
      const b = e.balance;
      return {
        codigo: 'balance_general',
        titulo: 'Balance general',
        periodo: `Al ${fechaCorta(b.fecha)}`,
        columnas: cols,
        filas: [
          ...this.filasSeccion('Activos', b.activos),
          ...this.filasSeccion('Pasivos', b.pasivos),
          ...this.filasSeccion('Capital', b.capital, 'Total capital aportado'),
          {
            codigo: '',
            cuenta: 'Utilidades acumuladas (años anteriores)',
            monto: b.utilidadesAcumuladas,
          },
          {
            codigo: '',
            cuenta: `Utilidad del ejercicio (desde ${fechaCorta(e.inicioEjercicio)})`,
            monto: b.utilidadEjercicio,
          },
          { codigo: '', cuenta: 'TOTAL CAPITAL', monto: b.totalCapital },
          {
            codigo: '',
            cuenta: 'TOTAL PASIVO Y CAPITAL',
            monto: b.totalPasivoCapital,
          },
        ],
        totales: null,
        notas: [
          nota,
          b.cuadra
            ? 'Activos = Pasivo + Capital.'
            : 'ATENCIÓN: el balance no cuadra; revise con el contador.',
        ],
      };
    }
    if (tipo === 'mayor') {
      const m = await this.mayor(f);
      return {
        codigo: 'libro_mayor',
        titulo: 'Libro mayor',
        periodo: `Del ${fechaCorta(m.desde)} al ${fechaCorta(m.hasta)}`,
        detalle: `${m.cuenta.codigo} ${m.cuenta.nombre}`,
        columnas: [
          { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
          { clave: 'asiento', titulo: 'Asiento', tipo: 'texto' },
          { clave: 'concepto', titulo: 'Concepto', tipo: 'texto' },
          { clave: 'debito', titulo: 'Débito', tipo: 'dinero', total: true },
          { clave: 'credito', titulo: 'Crédito', tipo: 'dinero', total: true },
          { clave: 'saldo', titulo: 'Saldo', tipo: 'dinero' },
        ],
        filas: [
          {
            fecha: m.desde,
            asiento: '',
            concepto: 'Saldo anterior',
            debito: null,
            credito: null,
            saldo: m.saldoAnterior,
          },
          ...m.movimientos.map((x) => ({
            fecha: x.fecha,
            asiento: x.asiento,
            concepto: [x.concepto, x.descripcion].filter(Boolean).join(' · '),
            debito: x.debito,
            credito: x.credito,
            saldo: x.saldo,
          })),
        ],
        totales: {
          debito: m.totales.debitos,
          credito: m.totales.creditos,
          saldo: m.saldoFinal,
        },
        notas: [
          `Saldo final: RD$${m.saldoFinal} (según la naturaleza de la cuenta).`,
        ],
      };
    }
    throw new BadRequestException(
      'Reporte inválido: mayor, resultados o balance',
    );
  }

  async exportar(tipo: string, formato: string, f: Filtros) {
    if (formato !== 'xlsx' && formato !== 'pdf')
      throw new BadRequestException('Formato inválido: xlsx o pdf');
    const r = await this.reporte(tipo, f);
    const e = (
      await this.db.query<{ nombre_comercial: string; rnc: string | null }>(
        'SELECT nombre_comercial, rnc FROM empresa WHERE id = 1',
      )
    ).rows[0];
    const zona =
      (
        await this.db.query<{ valor: string }>(
          `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
        )
      ).rows[0]?.valor ?? 'America/Santo_Domingo';
    const enc = {
      empresa: e?.nombre_comercial ?? 'SCITO ENTREPRISE',
      rnc: e?.rnc ?? null,
      generado: new Intl.DateTimeFormat('es-DO', {
        timeZone: zona,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date()),
    };
    const archivo =
      formato === 'xlsx' ? await aExcel(r, enc) : await aPdf(r, enc);
    return { archivo, nombre: `${r.codigo}.${formato}` };
  }

  // ---------- Cierre del año fiscal ----------

  async cambiarCierre(
    actorId: string,
    ip: string | undefined,
    datos: { cierre?: unknown },
  ) {
    const cierre = texto(datos.cierre);
    if (!(CIERRES as readonly string[]).includes(cierre))
      throw new BadRequestException(
        'Cierre fiscal: 12-31, 03-31, 06-30 o 09-30',
      );
    return this.db.transaccion(async (c) => {
      const r = await c.query<{ valor: string }>(
        `SELECT valor FROM configuracion WHERE clave = 'contabilidad.cierre_fiscal' FOR UPDATE`,
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Falta la configuración (migración 038)');
      const antes = r.rows[0].valor;
      if (antes === cierre) return { ok: true };
      await c.query(
        `UPDATE configuracion SET valor = $1, updated_by = $2, updated_at = now()
         WHERE clave = 'contabilidad.cierre_fiscal'`,
        [cierre, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'contabilidad.cierre_fiscal',
        entidad: 'configuracion',
        entidadId: 'contabilidad.cierre_fiscal',
        anterior: { cierre_fiscal: antes },
        nuevo: { cierre_fiscal: cierre },
        ip,
      });
      return { ok: true };
    });
  }
}
