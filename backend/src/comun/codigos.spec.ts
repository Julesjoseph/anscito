import { basePrefijo } from './codigos';
import { armarCodigo } from '../inventario/cantidades';

describe('códigos automáticos', () => {
  it('prefijo sugerido: 3 primeras letras sin tildes', () => {
    expect(basePrefijo('Útiles escolares')).toBe('UTI');
    expect(basePrefijo('Legalización de documentos')).toBe('LEG');
    expect(basePrefijo('Ñame y yuca')).toBe('NAM');
    expect(basePrefijo('  café ')).toBe('CAF');
    expect(basePrefijo('7')).toBe('CAT');
  });

  it('código: prefijo + número de 4 cifras', () => {
    expect(armarCodigo('LEG', 1)).toBe('LEG-0001');
    expect(armarCodigo('REC', 12345)).toBe('REC-12345');
  });
});
