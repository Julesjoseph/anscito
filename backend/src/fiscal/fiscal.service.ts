import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DatabaseService } from '../database/database.service';
import {
  CAMPOS_606,
  CAMPOS_607,
  centavos,
  fechaDgii,
  formaPago606,
  formasCobro607,
  limpiarDocumento,
  nombreArchivo,
  periodoValido,
  rangoPeriodo,
  texto2,
  tipoIdPorDocumento,
  txt606,
  txt607,
} from './formatos';
import type { Fila606, Fila607 } from './formatos';

// Formatos de envío de la DGII del mes: 606 (compras con NCF), 607 (e-CF
// emitidos: crédito fiscal, notas de crédito y consumo desde el monto
// configurado; el resto de consumo se resume), 608 y un estimado del ITBIS.
// Todo lo revisa el contador y se pre-valida con la herramienta de la DGII.

type Aviso = { documento: string; mensaje: string };

@Injectable()
export class FiscalService {
  constructor(private readonly db: DatabaseService) {}

  private periodo(v: unknown): string {
    const p = typeof v === 'string' ? v.trim() : '';
    if (!periodoValido(p))
      throw new BadRequestException('Período inválido (AAAAMM, ej. 202610)');
    return p;
  }

  private async rncEmpresa(): Promise<string | null> {
    const r = await this.db.query<{ rnc: string | null }>(
      'SELECT rnc FROM empresa LIMIT 1',
    );
    return r.rows[0]?.rnc ?? null;
  }

  // ---------- 606: compras ----------

  private async datos606(periodo: string) {
    const { desde, hasta } = rangoPeriodo(periodo);
    const r = await this.db.query<{
      numero: string;
      ncf: string;
      fecha: string;
      tipo_gasto: string;
      monto_bienes: string;
      monto_servicios: string;
      itbis: string;
      itbis_retenido: string;
      isr_retenido: string;
      tipo_retencion_isr: string | null;
      a_pagar: string;
      proveedor: string;
      documento: string | null;
      tipo_documento: string | null;
      pagado: string;
      fecha_pago: string | null;
      formas: string[] | null;
    }>(
      `SELECT c.numero, c.ncf, to_char(c.fecha_comprobante, 'YYYY-MM-DD') AS fecha, c.tipo_gasto,
              c.monto_bienes, c.monto_servicios, c.itbis, c.itbis_retenido, c.isr_retenido,
              c.tipo_retencion_isr, c.a_pagar, t.nombre AS proveedor, t.numero_documento AS documento,
              td.codigo AS tipo_documento,
              COALESCE((SELECT sum(p.monto) FROM compra_pagos p WHERE p.compra_id = c.id), 0)::numeric(16,2) AS pagado,
              (SELECT to_char(max(p.fecha), 'YYYY-MM-DD') FROM compra_pagos p WHERE p.compra_id = c.id) AS fecha_pago,
              (SELECT array_agg(DISTINCT p.forma) FROM compra_pagos p WHERE p.compra_id = c.id) AS formas
       FROM compras c JOIN terceros t ON t.id = c.proveedor_id
       LEFT JOIN tipos_documento td ON td.id = t.tipo_documento_id
       WHERE c.estado = 'registrada' AND c.ncf IS NOT NULL
         AND c.fecha_comprobante >= $1::date AND c.fecha_comprobante < $2::date
       ORDER BY c.fecha_comprobante, c.numero`,
      [desde, hasta],
    );
    const sinNcf = await this.db.query<{ n: number; total: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(total), 0)::numeric(16,2) AS total FROM compras
       WHERE estado = 'registrada' AND ncf IS NULL
         AND fecha_comprobante >= $1::date AND fecha_comprobante < $2::date`,
      [desde, hasta],
    );
    const avisos: Aviso[] = [];
    const filas: (Fila606 & { compra: string; proveedor: string })[] = [];
    for (const x of r.rows) {
      const compra = `CP-${String(x.numero).padStart(6, '0')}`;
      const doc = limpiarDocumento(x.documento);
      const tipoId =
        x.tipo_documento === 'rnc'
          ? '1'
          : x.tipo_documento === 'cedula'
            ? '2'
            : '';
      if (!doc || !tipoId)
        avisos.push({
          documento: compra,
          mensaje: `${x.proveedor}: el 606 pide el RNC o la cédula del proveedor`,
        });
      const pagado = centavos(x.pagado);
      const aPagar = centavos(x.a_pagar);
      const completo = pagado >= aPagar && pagado > 0n;
      const retiene =
        centavos(x.itbis_retenido) > 0n || centavos(x.isr_retenido) > 0n;
      if (retiene && !completo)
        avisos.push({
          documento: compra,
          mensaje:
            'Tiene retenciones y no está pagada completa: el 606 pide la fecha de pago (repórtela en el mes del pago o rectifique)',
        });
      if (centavos(x.isr_retenido) > 0n && !x.tipo_retencion_isr)
        avisos.push({
          documento: compra,
          mensaje: 'Tiene ISR retenido pero no dice el tipo de retención',
        });
      const bienes = centavos(x.monto_bienes);
      const servicios = centavos(x.monto_servicios);
      filas.push({
        compra,
        proveedor: x.proveedor,
        rnc: doc,
        tipoId,
        tipoBienes: x.tipo_gasto,
        ncf: x.ncf,
        ncfModificado: '',
        fechaComprobante: fechaDgii(x.fecha),
        fechaPago: completo ? fechaDgii(x.fecha_pago) : '',
        servicios: texto2(servicios),
        bienes: texto2(bienes),
        total: texto2(servicios + bienes),
        itbis: x.itbis,
        itbisRetenido: x.itbis_retenido,
        itbisProporcionalidad: '0.00',
        itbisCosto: '0.00',
        itbisAdelantar: x.itbis,
        itbisPercibido: '',
        tipoRetencion:
          centavos(x.isr_retenido) > 0n ? (x.tipo_retencion_isr ?? '') : '',
        retencionRenta: x.isr_retenido,
        isrPercibido: '',
        isc: '0.00',
        otrosImpuestos: '0.00',
        propina: '0.00',
        formaPago: formaPago606(pagado, aPagar, x.formas ?? []),
      });
    }
    const suma = (k: keyof Fila606) =>
      texto2(filas.reduce((a, f) => a + centavos(f[k]), 0n));
    return {
      filas,
      avisos,
      sinNcf: { cantidad: sinNcf.rows[0].n, total: sinNcf.rows[0].total },
      totales: {
        cantidad: filas.length,
        servicios: suma('servicios'),
        bienes: suma('bienes'),
        total: suma('total'),
        itbis: suma('itbis'),
        itbisRetenido: suma('itbisRetenido'),
        itbisAdelantar: suma('itbisAdelantar'),
        retencionRenta: suma('retencionRenta'),
      },
    };
  }

  // ---------- 607: ventas (e-CF emitidos) ----------

  private async datos607(periodo: string) {
    const { desde, hasta } = rangoPeriodo(periodo);
    const lim = await this.db.query<{ valor: string }>(
      `SELECT valor FROM configuracion WHERE clave = 'fiscal.consumo_607_desde'`,
    );
    const consumoDesde = centavos(lim.rows[0]?.valor ?? '250000.00');
    const r = await this.db.query<{
      tipo: string;
      encf: string;
      fecha: string;
      documento: string | null;
      comprador: string;
      base_imponible: string;
      itbis: string;
      total: string;
      ncf_modificado: string | null;
      tipo_modificado: string | null;
      total_modificado: string | null;
      pagos: { codigo: string; monto: string }[] | null;
    }>(
      `SELECT e.tipo, e.encf, to_char(e.fecha_emision, 'YYYY-MM-DD') AS fecha,
              e.comprador_documento AS documento, e.comprador_nombre AS comprador,
              e.base_imponible, e.itbis, e.total,
              m.encf AS ncf_modificado, m.tipo AS tipo_modificado, m.total AS total_modificado,
              (SELECT json_agg(json_build_object('codigo', f.codigo, 'monto', p.monto::text))
               FROM venta_pagos p JOIN formas_pago f ON f.id = p.forma_pago_id
               WHERE p.venta_id = e.venta_id) AS pagos
       FROM ecf e LEFT JOIN ecf m ON m.id = e.modifica_id
       WHERE e.estado = 'emitido' AND e.fecha_emision >= $1::date AND e.fecha_emision < $2::date
       ORDER BY e.fecha_emision, e.encf`,
      [desde, hasta],
    );
    const porEmitir = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ecf
       WHERE estado = 'por_emitir' AND created_at >= $1::date AND created_at < $2::date`,
      [desde, hasta],
    );
    const avisos: Aviso[] = [];
    const filas: (Fila607 & { comprador: string })[] = [];
    const consumo = { cantidad: 0, monto: 0n, itbis: 0n, total: 0n };
    for (const x of r.rows) {
      const total = centavos(x.total);
      // Consumo menor que el límite: va en el resumen de la Oficina Virtual.
      if (x.tipo === '32' && total < consumoDesde) {
        consumo.cantidad++;
        consumo.monto += centavos(x.base_imponible);
        consumo.itbis += centavos(x.itbis);
        consumo.total += total;
        continue;
      }
      const doc = limpiarDocumento(x.documento);
      if (!doc)
        avisos.push({
          documento: x.encf,
          mensaje: `${x.comprador}: el 607 pide el documento del comprador`,
        });
      const pagos = x.pagos ?? [];
      const cobro = formasCobro607(pagos);
      // Las formas de cobro deben sumar el total del comprobante.
      const cobrado = pagos.reduce((a, p) => a + centavos(p.monto), 0n);
      if (cobrado !== total && x.tipo !== '34')
        avisos.push({
          documento: x.encf,
          mensaje: `Lo cobrado (RD$${texto2(cobrado)}) no es igual al total (RD$${texto2(total)}): revise las formas de cobro`,
        });
      filas.push({
        comprador: x.comprador,
        rnc: doc,
        tipoId: tipoIdPorDocumento(doc),
        ncf: x.encf,
        ncfModificado: x.ncf_modificado ?? '',
        tipoIngreso: '01',
        fechaComprobante: fechaDgii(x.fecha),
        fechaRetencion: '',
        montoFacturado: x.base_imponible,
        itbis: x.itbis,
        itbisRetenido: '0.00',
        itbisPercibido: '',
        retencionRenta: '0.00',
        isrPercibido: '',
        isc: '0.00',
        otrosImpuestos: '0.00',
        propina: '0.00',
        ...cobro,
      });
    }
    const suma = (k: keyof Fila607) =>
      texto2(filas.reduce((a, f) => a + centavos(f[k]), 0n));
    // Las notas de crédito restan del ITBIS cobrado.
    const itbisNeto = r.rows.reduce(
      (a, x) => a + (x.tipo === '34' ? -centavos(x.itbis) : centavos(x.itbis)),
      0n,
    );
    return {
      filas,
      avisos,
      porEmitir: porEmitir.rows[0].n,
      consumo: {
        desde: texto2(consumoDesde),
        cantidad: consumo.cantidad,
        monto: texto2(consumo.monto),
        itbis: texto2(consumo.itbis),
        total: texto2(consumo.total),
      },
      itbisNeto: texto2(itbisNeto),
      totales: {
        cantidad: filas.length,
        montoFacturado: suma('montoFacturado'),
        itbis: suma('itbis'),
      },
    };
  }

  // ---------- Pantalla ----------

  async resumen(v: unknown) {
    const periodo = this.periodo(v);
    const [rnc, f606, f607] = await Promise.all([
      this.rncEmpresa(),
      this.datos606(periodo),
      this.datos607(periodo),
    ]);
    const ventas = centavos(f607.itbisNeto);
    const compras = centavos(f606.totales.itbisAdelantar);
    const diferencia = ventas - compras;
    return {
      periodo,
      rnc,
      f606,
      f607,
      // 608 (comprobantes anulados): un e-CF emitido se corrige con una nota
      // de crédito, que va en el 607; uno que no se emitió no tiene e-NCF.
      f608: { cantidad: 0 },
      itbis: {
        ventas: texto2(ventas),
        compras: texto2(compras),
        retenidoProveedores: f606.totales.itbisRetenido,
        aPagar: texto2(diferencia > 0n ? diferencia : 0n),
        saldoFavor: texto2(diferencia < 0n ? -diferencia : 0n),
      },
    };
  }

  // ---------- Archivos ----------

  async archivo(
    formato: string,
    tipo: string,
    v: unknown,
  ): Promise<{ archivo: Buffer; nombre: string; mime: string }> {
    if (formato !== '606' && formato !== '607')
      throw new BadRequestException('Formato inválido: 606 o 607');
    if (tipo !== 'txt' && tipo !== 'xlsx')
      throw new BadRequestException('Tipo de archivo inválido: txt o xlsx');
    const periodo = this.periodo(v);
    const rnc = await this.rncEmpresa();
    if (!rnc)
      throw new BadRequestException(
        'Registre el RNC de la empresa (pantalla Empresa) para generar el formato',
      );
    const filas =
      formato === '606'
        ? (await this.datos606(periodo)).filas
        : (await this.datos607(periodo)).filas;
    if (tipo === 'txt') {
      const txt =
        formato === '606'
          ? txt606(rnc, periodo, filas as Fila606[])
          : txt607(rnc, periodo, filas as Fila607[]);
      return {
        archivo: Buffer.from(txt, 'utf8'),
        nombre: nombreArchivo(formato, rnc, periodo, 'TXT'),
        mime: 'text/plain; charset=utf-8',
      };
    }
    const campos = (formato === '606' ? CAMPOS_606 : CAMPOS_607) as [
      string,
      string,
    ][];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(formato);
    ws.addRow(['RNC o Cédula', rnc]);
    ws.addRow(['Período', periodo]);
    ws.addRow(['Cantidad Registros', filas.length]);
    ws.addRow([]);
    const enc = ws.addRow(campos.map(([, n], i) => `${i + 1}. ${n}`));
    enc.font = { bold: true };
    for (const f of filas as unknown as Record<string, string>[])
      ws.addRow(campos.map(([k]) => f[k] ?? ''));
    ws.columns.forEach((c) => (c.width = 18));
    ws.addRow([]);
    ws.addRow([
      'Revisar con el contador y pre-validar con la herramienta de la DGII antes de enviar.',
    ]);
    return {
      archivo: Buffer.from(await wb.xlsx.writeBuffer()),
      nombre: nombreArchivo(formato, rnc, periodo, 'xlsx'),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
