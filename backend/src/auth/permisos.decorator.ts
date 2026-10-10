import { SetMetadata } from '@nestjs/common';

export const PERMISO_KEY = 'permiso_requerido';

export const RequierePermiso = (codigo: string) =>
  SetMetadata(PERMISO_KEY, codigo);