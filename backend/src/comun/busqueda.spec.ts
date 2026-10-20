import { normalizarBusqueda } from './busqueda';

describe('búsqueda con lector de código de barras', () => {
  it('cambia el separador del código por "-"', () => {
    expect(normalizarBusqueda("BEB'0001")).toBe('BEB-0001');
    expect(normalizarBusqueda("beb'0001")).toBe('BEB-0001');
    expect(normalizarBusqueda('BEB-0001')).toBe('BEB-0001');
    expect(normalizarBusqueda(' BEB´0001 ')).toBe('BEB-0001');
    expect(normalizarBusqueda('CUA2’0012')).toBe('CUA2-0012');
    expect(normalizarBusqueda('LEG?0001')).toBe('LEG-0001');
  });

  it('no cambia una búsqueda normal', () => {
    expect(normalizarBusqueda("D'Leon")).toBe("D'Leon");
    expect(normalizarBusqueda('agua')).toBe('agua');
    expect(normalizarBusqueda("O'Neal 2")).toBe("O'Neal 2");
    expect(normalizarBusqueda('0001')).toBe('0001');
    expect(normalizarBusqueda("BEB'01")).toBe("BEB'01");
  });
});
