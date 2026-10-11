// Normalización y validación de datos de clientes y proveedores.
// El documento solo se valida por formato y largo (según el patrón de su
// tipo en la tabla tipos_documento): no se calcula el dígito verificador ni
// se consulta a la DGII.

// "001-1234567-8" -> "00112345678"; "ab 123.45" -> "AB12345"
export function normalizarDocumento(valor: string): string {
  return valor.replace(/[\s.\-/]/g, '').toUpperCase();
}

// Oculta todo menos los 3 últimos caracteres: "00112345678" -> "********678".
export function enmascarar(numero: string | null): string | null {
  if (numero === null) return null;
  if (numero.length <= 3) return '*'.repeat(numero.length);
  return '*'.repeat(numero.length - 3) + numero.slice(-3);
}

// Teléfono o WhatsApp: dígitos con +, espacios, guiones o paréntesis;
// entre 7 y 15 dígitos (estándar internacional E.164).
export function telefonoValido(valor: string): boolean {
  if (!/^\+?[0-9\s\-()]+$/.test(valor)) return false;
  const digitos = valor.replace(/\D/g, '').length;
  return digitos >= 7 && digitos <= 15;
}

export function correoValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor) && valor.length <= 150;
}
