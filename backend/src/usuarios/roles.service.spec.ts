import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';
import { RolesService } from './roles.service';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

describe('RolesService.validar', () => {
  // validar no usa la base de datos.
  const servicio = new RolesService({} as DatabaseService);

  it('normaliza un rol válido y quita permisos repetidos', () => {
    const d = servicio.validar({
      nombre: '  Cajero noche ',
      descripcion: '',
      permisos: [P1, P2, P1.toUpperCase()],
    });
    expect(d.nombre).toBe('Cajero noche');
    expect(d.descripcion).toBeNull();
    expect(d.permisos).toEqual([P1, P2]);
  });

  it('acepta un rol sin permisos', () => {
    expect(
      servicio.validar({ nombre: 'Consulta', permisos: [] }).permisos,
    ).toEqual([]);
  });

  it.each([
    ['nombre vacío', { nombre: ' ', permisos: [] }],
    ['nombre muy largo', { nombre: 'x'.repeat(101), permisos: [] }],
    ['permisos que no son lista', { nombre: 'A', permisos: P1 }],
    ['permisos ausentes', { nombre: 'A' }],
    ['permiso inválido', { nombre: 'A', permisos: ['usuarios.ver'] }],
    [
      'descripción muy larga',
      { nombre: 'A', descripcion: 'x'.repeat(501), permisos: [] },
    ],
  ])('rechaza %s', (_caso, datos) => {
    expect(() => servicio.validar(datos)).toThrow(BadRequestException);
  });
});
