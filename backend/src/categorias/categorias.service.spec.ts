import { codigoDesdeNombre } from './categorias.service';

describe('codigoDesdeNombre', () => {
  it('quita tildes, espacios y mayúsculas', () => {
    expect(codigoDesdeNombre('Diseño Gráfico')).toBe('diseno_grafico');
    expect(codigoDesdeNombre('  Fotocopias a color ')).toBe(
      'fotocopias_a_color',
    );
    expect(codigoDesdeNombre('Café & Snacks!')).toBe('cafe_snacks');
  });

  it('nunca queda vacío ni demasiado largo', () => {
    expect(codigoDesdeNombre('¡¡¡')).toBe('unidad');
    expect(codigoDesdeNombre('x'.repeat(80)).length).toBeLessThanOrEqual(26);
  });
});
