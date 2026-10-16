// Código de barras Code 128 (juego B: letras, números y símbolos ASCII 32 a
// 126), según la norma ISO/IEC 15417. Sin librerías: cada símbolo son 3
// barras y 3 espacios (11 módulos); el Stop lleva una barra final (13).
// Estructura: zona en blanco · Start B (104) · datos · control (módulo 103)
// · Stop · zona en blanco.

// Anchos (en módulos) de barra, espacio, barra, espacio, barra, espacio de
// cada valor 0 a 106 (tabla de la norma).
// prettier-ignore
export const PATRONES: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', // 0-7
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', // 8-15
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', // 16-23
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', // 24-31
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 32-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', // 40-47
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', // 48-55
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', // 56-63
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', // 64-71
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 72-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', // 80-87
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', // 88-95
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', // 96-103
  '211214', '211232', '2331112', // 104 Start B, 105 Start C, 106 Stop
];

export const START_B = 104;
export const STOP = 106;
export const ZONA_BLANCA = 10; // módulos en blanco a cada lado

// Valores del juego B de un texto (ASCII 32 a 126).
export function valoresB(texto: string): number[] {
  return texto.split('').map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126)
      throw new Error(`Carácter no permitido en Code 128 B: "${ch}"`);
    return c - 32;
  });
}

// Dígito de control: (Start + Σ valor × posición) módulo 103.
export function control(valores: number[]): number {
  return valores.reduce((a, v, i) => a + v * (i + 1), START_B) % 103;
}

// Símbolos completos: Start B, datos, control y Stop.
export function simbolos(texto: string): number[] {
  if (!texto) throw new Error('Texto vacío');
  const v = valoresB(texto);
  return [START_B, ...v, control(v), STOP];
}

// Anchos alternados (barra, espacio, barra…) en módulos, sin zonas blancas.
export function anchos(texto: string): number[] {
  return simbolos(texto).flatMap((s) => PATRONES[s].split('').map(Number));
}

// Total de módulos con las zonas en blanco.
export function modulosTotales(texto: string): number {
  return anchos(texto).reduce((a, b) => a + b, 0) + 2 * ZONA_BLANCA;
}

// Barras para dibujar: [inicio, ancho] en módulos, contando desde el borde
// izquierdo de la zona en blanco.
export function barras(texto: string): [number, number][] {
  const out: [number, number][] = [];
  let x = ZONA_BLANCA;
  anchos(texto).forEach((w, i) => {
    if (i % 2 === 0) out.push([x, w]);
    x += w;
  });
  return out;
}
