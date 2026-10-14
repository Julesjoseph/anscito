import { ConflictException } from '@nestjs/common';
import { errorCodigoCliente } from './codigo-cliente';

describe('errorCodigoCliente', () => {
  it('cambia el fin de la secuencia por un 409 en español', () => {
    const e = errorCodigoCliente({
      code: '2200H',
      message:
        'nextval: reached maximum value of sequence "terceros_codigo_cliente_seq" (9999)',
    });
    expect(e).toBeInstanceOf(ConflictException);
    expect(e?.message).toContain('Se acabaron los códigos de cliente');
  });

  it('deja pasar otros errores', () => {
    expect(
      errorCodigoCliente({ code: '23505', message: 'duplicate' }),
    ).toBeNull();
    expect(
      errorCodigoCliente({ code: '2200H', message: 'otra secuencia' }),
    ).toBeNull();
    expect(errorCodigoCliente(new Error('x'))).toBeNull();
  });
});
