import { ConflictException } from '@nestjs/common';

// Código de cliente SCITO-1801 + 4 cifras: lo pone la base de datos al crear
// el cliente (migración 026, secuencia terceros_codigo_cliente_seq).

export const MAXIMO_CLIENTES = 9999;

// Si la secuencia llegó a su máximo, PostgreSQL da el error 2200H (sequence_generator_limit_exceeded); se cambia
// por un mensaje claro. Devuelve null si el error es otro.
export function errorCodigoCliente(e: unknown): ConflictException | null {
  const x = e as { code?: string; message?: string };
  if (
    x?.code === '2200H' &&
    /terceros_codigo_cliente_seq/.test(x.message ?? '')
  )
    return new ConflictException(
      `Se acabaron los códigos de cliente (SCITO-1801 + 4 cifras: hasta ${MAXIMO_CLIENTES.toLocaleString('en-US')} clientes). ` +
        'Pida al administrador que amplíe el código para poder registrar más clientes.',
    );
  return null;
}
