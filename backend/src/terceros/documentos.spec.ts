import {
  correoValido,
  enmascarar,
  normalizarDocumento,
  telefonoValido,
} from './documentos';

describe('normalizarDocumento', () => {
  it('quita guiones, espacios, puntos y barras y pasa a mayúsculas', () => {
    expect(normalizarDocumento('001-1234567-8')).toBe('00112345678');
    expect(normalizarDocumento(' 1-30-00000-1 ')).toBe('130000001');
    expect(normalizarDocumento('ab 123.45/6')).toBe('AB123456');
  });
});

describe('enmascarar', () => {
  it('deja ver solo los 3 últimos caracteres', () => {
    expect(enmascarar('00112345678')).toBe('********678');
    expect(enmascarar('130000001')).toBe('******001');
    expect(enmascarar('AB1')).toBe('***');
    expect(enmascarar(null)).toBeNull();
  });
});

describe('telefonoValido', () => {
  it('acepta formatos comunes', () => {
    expect(telefonoValido('809-555-1234')).toBe(true);
    expect(telefonoValido('(829) 555 1234')).toBe(true);
    expect(telefonoValido('+1 809 555 1234')).toBe(true);
    expect(telefonoValido('8095551234')).toBe(true);
  });

  it('rechaza texto, letras o largos imposibles', () => {
    expect(telefonoValido('llamar luego')).toBe(false);
    expect(telefonoValido('809-55A-1234')).toBe(false);
    expect(telefonoValido('12345')).toBe(false);
    expect(telefonoValido('1234567890123456')).toBe(false);
  });
});

describe('correoValido', () => {
  it('acepta correos normales y rechaza los mal escritos', () => {
    expect(correoValido('ventas@empresa.com.do')).toBe(true);
    expect(correoValido('juan.perez@gmail.com')).toBe(true);
    expect(correoValido('juan@gmail')).toBe(false);
    expect(correoValido('juan perez@gmail.com')).toBe(false);
    expect(correoValido('sin-arroba.com')).toBe(false);
  });
});
