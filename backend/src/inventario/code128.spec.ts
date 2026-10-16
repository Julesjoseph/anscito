import {
  PATRONES,
  anchos,
  barras,
  control,
  modulosTotales,
  simbolos,
  valoresB,
} from './code128';

describe('Code 128 B', () => {
  // Propiedades de la tabla oficial (independientes de este código): cada
  // símbolo suma 11 módulos (Stop 13), las barras suman un número par y los
  // espacios uno impar, y no hay dos patrones iguales.
  it('la tabla cumple las propiedades de la norma', () => {
    expect(PATRONES).toHaveLength(107);
    PATRONES.forEach((p, i) => {
      const w = p.split('').map(Number);
      const total = w.reduce((a, b) => a + b, 0);
      expect(total).toBe(i === 106 ? 13 : 11);
      const barrasSum = w
        .filter((_, j) => j % 2 === 0)
        .reduce((a, b) => a + b, 0);
      if (i !== 106) expect(barrasSum % 2).toBe(0);
      expect(w.every((x) => x >= 1 && x <= 4)).toBe(true);
    });
    expect(new Set(PATRONES).size).toBe(107);
  });

  // Valores de la norma: Start B = 211214, Stop = 2331112, "0" = 16 (123122),
  // "A" = 33 (111323), espacio = 0 (212222).
  it('patrones conocidos de la norma', () => {
    expect(PATRONES[104]).toBe('211214');
    expect(PATRONES[106]).toBe('2331112');
    expect(valoresB(' 0A')).toEqual([0, 16, 33]);
    expect(PATRONES[16]).toBe('123122');
    expect(PATRONES[33]).toBe('111323');
  });

  // Calculado a mano: "BEB-0001" → B=34 E=37 B=34 -=13 0=16 0=16 0=16 1=17;
  // 104 + 34·1 + 37·2 + 34·3 + 13·4 + 16·5 + 16·6 + 16·7 + 17·8 = 790;
  // 790 mod 103 = 69 → patrón 112214.
  it('dígito de control de BEB-0001 (a mano)', () => {
    expect(valoresB('BEB-0001')).toEqual([34, 37, 34, 13, 16, 16, 16, 17]);
    expect(control(valoresB('BEB-0001'))).toBe(69);
    expect(PATRONES[69]).toBe('112214');
    expect(simbolos('BEB-0001')).toEqual([
      104, 34, 37, 34, 13, 16, 16, 16, 17, 69, 106,
    ]);
  });

  it('anchos, barras y zona en blanco', () => {
    // 11 símbolos de 11 módulos + Stop de 13 = 123; + 10 a cada lado = 143.
    expect(anchos('BEB-0001').reduce((a, b) => a + b, 0)).toBe(123);
    expect(modulosTotales('BEB-0001')).toBe(143);
    const b = barras('BEB-0001');
    expect(b[0]).toEqual([10, 2]); // Start B empieza con barra de 2 tras la zona blanca
    const ultima = b[b.length - 1];
    expect(ultima[0] + ultima[1]).toBe(143 - 10); // termina antes de la zona blanca
    expect(ultima[1]).toBe(2); // barra final del Stop (2 módulos)
  });

  it('rechaza caracteres fuera del juego B', () => {
    expect(() => valoresB('AÑO')).toThrow();
    expect(() => simbolos('')).toThrow();
  });
});
