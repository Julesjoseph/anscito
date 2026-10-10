import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/database.service';

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;
const MENSAJE_ERROR = 'Usuario o contraseña incorrectos';
const HASH_FALSO = bcrypt.hashSync('relleno-no-valido', 12);

type UsuarioFila = {
  id: string;
  username: string;
  nombre: string;
  apellido: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  locked_until: Date | null;
};

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService) {}

  async login(username: string, password: string) {
    const usuario = String(username).trim().toLowerCase();
    const clave = String(password);
    if (!usuario || !clave) {
      throw new UnauthorizedException(MENSAJE_ERROR);
    }

    const r = await this.db.query<UsuarioFila>(
      `SELECT id, username, nombre, apellido, password_hash,
              is_active, must_change_password, locked_until
       FROM usuarios WHERE username = $1`,
      [usuario],
    );
    const u = r.rows[0];

    if (!u) {
      await bcrypt.compare(clave, HASH_FALSO);
      throw new UnauthorizedException(MENSAJE_ERROR);
    }
    if (!u.is_active) {
      throw new UnauthorizedException(MENSAJE_ERROR);
    }
    if (u.locked_until && u.locked_until > new Date()) {
      throw new HttpException(
        'Cuenta bloqueada temporalmente. Intente más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const correcta = await bcrypt.compare(clave, u.password_hash);
    if (!correcta) {
      await this.db.query(
        `UPDATE usuarios SET
           failed_attempts = CASE WHEN failed_attempts + 1 >= $2::int
                                  THEN 0 ELSE failed_attempts + 1 END,
           locked_until = CASE WHEN failed_attempts + 1 >= $2::int
                               THEN now() + make_interval(mins => $3::int)
                               ELSE locked_until END,
           updated_at = now()
         WHERE id = $1`,
        [u.id, MAX_INTENTOS, MINUTOS_BLOQUEO],
      );
      throw new UnauthorizedException(MENSAJE_ERROR);
    }

    await this.db.query(
      `UPDATE usuarios SET failed_attempts = 0, locked_until = NULL,
         last_login_at = now(), updated_at = now()
       WHERE id = $1`,
      [u.id],
    );

    const secreto = process.env.JWT_SECRET;
    if (!secreto || secreto.length < 32) {
      throw new Error('JWT_SECRET no está configurado correctamente');
    }
    const token = jwt.sign({ sub: u.id, username: u.username }, secreto, {
      expiresIn: '8h',
    });

    return {
      token,
      usuario: { id: u.id, username: u.username, nombre: u.nombre, apellido: u.apellido },
      debeCambiarPassword: u.must_change_password,
    };
  }
    async perfil(usuarioId: string) {
    const roles = await this.db.query<{ nombre: string }>(
      `SELECT ro.nombre
       FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active = true
       WHERE ur.usuario_id = $1
       ORDER BY ro.nombre`,
      [usuarioId],
    );
    const permisos = await this.db.query<{ codigo: string }>(
      `SELECT DISTINCT p.codigo
       FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active = true
       JOIN rol_permisos rp ON rp.rol_id = ro.id
       JOIN permisos p ON p.id = rp.permiso_id
       WHERE ur.usuario_id = $1
       ORDER BY p.codigo`,
      [usuarioId],
    );
    return {
      roles: roles.rows.map((r) => r.nombre),
      permisos: permisos.rows.map((p) => p.codigo),
    };
  }
}