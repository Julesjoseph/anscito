import {
  armarCodigo,
  esCero,
  esEntera,
  normalizarCantidad,
} from './cantidades';

describe('normalizarCantidad', () => {
  it('acepta cantidades válidas con hasta 3 decimales', () => {
    expect(normalizarCantidad('25')).toBe('25.000');
    expect(normalizarCantidad('2.5')).toBe('2.500');
    expect(normalizarCantidad(' 0.125 ')).toBe('0.125');
    expect(normalizarCantidad(3)).toBe('3.000');
    expect(normalizarCantidad('0')).toBe('0.000');
    expect(normalizarCantidad('007')).toBe('7.000');
  });

  it('rechaza negativos, texto y más de 3 decimales', () => {
    expect(normalizarCantidad('-1')).toBeNull();
    expect(normalizarCantidad('dos')).toBeNull();
    expect(normalizarCantidad('1.2345')).toBeNull();
    expect(normalizarCantidad('1,5')).toBeNull();
    expect(normalizarCantidad('')).toBeNull();
    expect(normalizarCantidad(null)).toBeNull();
    expect(normalizarCantidad('1e3')).toBeNull();
  });
});

describe('esEntera / esCero', () => {
  it('distingue cantidades enteras de las que tienen decimales', () => {
    expect(esEntera('25.000')).toBe(true);
    expect(esEntera('2.500')).toBe(false);
    expect(esCero('0.000')).toBe(true);
    expect(esCero('10.000')).toBe(false);
  });
});

describe('armarCodigo', () => {
  it('completa con ceros hasta 4 dígitos', () => {
    expect(armarCodigo('PAP', 1)).toBe('PAP-0001');
    expect(armarCodigo('CAF', 13)).toBe('CAF-0013');
    expect(armarCodigo('TEC', 9999)).toBe('TEC-9999');
    expect(armarCodigo('TEC', 10000)).toBe('TEC-10000');
  });
});
