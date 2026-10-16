import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';
import { ServiciosService } from './servicios.service';

const ID = '11111111-1111-4111-8111-111111111111';

const valido = {
  codigo: 'imp-bn-01',
  nombre: 'Impresión blanco y negro',
  unidadNegocioId: ID,
  categoriaId: ID,
  unidadMedidaId: ID,
  impuestoId: ID,
  precio: '5',
  precioIncluyeItbis: false,
};

describe('ServiciosService.validar', () => {
  // validar no usa la base de datos.
  const servicio = new ServiciosService({} as DatabaseService);

  it('normaliza un servicio válido', () => {
    const d = servicio.validar(valido);
    // El código no viene de la pantalla: se crea al guardar.
    expect(d.codigo).toBe('');
    expect(d.precio).toBe('5.00');
    expect(d.costo).toBeNull();
    expect(d.descripcion).toBeNull();
  });

  it('acepta costo opcional', () => {
    expect(servicio.validar({ ...valido, costo: '1.5' }).costo).toBe('1.50');
    expect(servicio.validar({ ...valido, costo: '' }).costo).toBeNull();
  });

  it.each([
    ['precio negativo', { precio: '-1' }],
    ['precio con texto', { precio: 'cien' }],
    ['precio con 3 decimales', { precio: '1.005' }],
    ['precio vacío', { precio: '' }],
    ['costo negativo', { costo: '-0.01' }],
    ['nombre vacío', { nombre: '   ' }],
    ['unidad de negocio inválida', { unidadNegocioId: 'x' }],
    ['impuesto vacío', { impuestoId: '' }],
    ['interruptor ITBIS que no es sí/no', { precioIncluyeItbis: 'true' }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(() => servicio.validar({ ...valido, ...cambio })).toThrow(
      BadRequestException,
    );
  });
});

describe('ServiciosService.validar con categoría', () => {
  const servicio = new ServiciosService({} as DatabaseService);

  it('la categoría es obligatoria', () => {
    expect(() => servicio.validar({ ...valido, categoriaId: '' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      servicio.validar({ ...valido, categoriaId: undefined }),
    ).toThrow(BadRequestException);
  });

  it('acepta una categoría válida y rechaza una inválida', () => {
    expect(servicio.validar({ ...valido, categoriaId: ID }).categoria_id).toBe(
      ID,
    );
    expect(() =>
      servicio.validar({ ...valido, categoriaId: 'papeleria' }),
    ).toThrow(BadRequestException);
  });
});

describe('ServiciosService.validar con comisión', () => {
  const servicio = new ServiciosService({} as DatabaseService);

  it('sin indicarlo, la ganancia es por costo', () => {
    const d = servicio.validar({ ...valido, costo: '2' });
    expect(d.ganancia_tipo).toBe('costo');
    expect(d.comision_pct).toBeNull();
    expect(d.costo).toBe('2.00');
  });

  it('por comisión: normaliza el % y no usa el costo', () => {
    const d = servicio.validar({
      ...valido,
      costo: '2',
      gananciaTipo: 'comision',
      comisionPct: '20',
    });
    expect(d.ganancia_tipo).toBe('comision');
    expect(d.comision_pct).toBe('20.00');
    expect(d.costo).toBeNull();
    expect(
      servicio.validar({
        ...valido,
        gananciaTipo: 'comision',
        comisionPct: '12.5',
      }).comision_pct,
    ).toBe('12.50');
  });

  it.each(['0', '150', '-5', 'veinte', '', '10.123'])(
    'rechaza la comisión %s',
    (pct) => {
      expect(() =>
        servicio.validar({
          ...valido,
          gananciaTipo: 'comision',
          comisionPct: pct,
        }),
      ).toThrow(BadRequestException);
    },
  );
});
