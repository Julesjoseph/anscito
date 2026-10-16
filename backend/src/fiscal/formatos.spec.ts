import {
  fechaDgii,
  formaPago606,
  formasCobro607,
  nombreArchivo,
  periodoValido,
  rangoPeriodo,
  tipoIdPorDocumento,
  txt606,
} from './formatos';
import type { Fila606 } from './formatos';

describe('formatos DGII', () => {
  it('período AAAAMM y su rango de fechas', () => {
    expect(periodoValido('202610')).toBe(true);
    expect(periodoValido('202613')).toBe(false);
    expect(periodoValido('2026-10')).toBe(false);
    expect(rangoPeriodo('202610')).toEqual({
      desde: '2026-10-01',
      hasta: '2026-11-01',
    });
    expect(rangoPeriodo('202612')).toEqual({
      desde: '2026-12-01',
      hasta: '2027-01-01',
    });
    expect(fechaDgii('2026-10-05')).toBe('20261005');
    expect(fechaDgii(null)).toBe('');
  });

  it('tipo de identificación por el documento', () => {
    expect(tipoIdPorDocumento('130000000')).toBe('1');
    expect(tipoIdPorDocumento('00100000001')).toBe('2');
    expect(tipoIdPorDocumento('AB12345')).toBe('3');
    expect(tipoIdPorDocumento('')).toBe('');
  });

  it('forma de pago del 606', () => {
    expect(formaPago606(0n, 1000n, [])).toBe('04');
    expect(formaPago606(500n, 1000n, ['efectivo'])).toBe('07');
    expect(formaPago606(1000n, 1000n, ['efectivo'])).toBe('01');
    expect(formaPago606(1000n, 1000n, ['banco'])).toBe('02');
    expect(formaPago606(1000n, 1000n, ['efectivo', 'banco'])).toBe('07');
  });

  it('formas de cobro del 607', () => {
    expect(
      formasCobro607([
        { codigo: 'efectivo', monto: '100.50' },
        { codigo: 'transferencia', monto: '200.00' },
        { codigo: 'credito', monto: '50.00' },
        { codigo: 'efectivo', monto: '0.50' },
      ]),
    ).toEqual({
      efectivo: '101.00',
      chequeTransferencia: '200.00',
      tarjeta: '0.00',
      credito: '50.00',
      bonos: '0.00',
      permuta: '0.00',
      otras: '0.00',
    });
  });

  it('TXT del 606: encabezado y 23 campos por línea', () => {
    const f: Fila606 = {
      rnc: '101000000',
      tipoId: '1',
      tipoBienes: '02',
      ncf: 'B0100000001',
      ncfModificado: '',
      fechaComprobante: '20261005',
      fechaPago: '20261005',
      servicios: '1000.00',
      bienes: '0.00',
      total: '1000.00',
      itbis: '180.00',
      itbisRetenido: '0.00',
      itbisProporcionalidad: '0.00',
      itbisCosto: '0.00',
      itbisAdelantar: '180.00',
      itbisPercibido: '',
      tipoRetencion: '',
      retencionRenta: '0.00',
      isrPercibido: '',
      isc: '0.00',
      otrosImpuestos: '0.00',
      propina: '0.00',
      formaPago: '01',
    };
    const [enc, linea] = txt606('130000000', '202610', [f]).split('\r\n');
    expect(enc).toBe('606|130000000|202610|1');
    expect(linea.split('|')).toHaveLength(23);
    expect(linea).toBe(
      '101000000|1|02|B0100000001||20261005|20261005|1000.00|0.00|1000.00|180.00|0.00|0.00|0.00|180.00|||0.00||0.00|0.00|0.00|01',
    );
    expect(nombreArchivo('606', '130000000', '202610', 'TXT')).toBe(
      'DGII_F_606_130000000_202610.TXT',
    );
  });
});
