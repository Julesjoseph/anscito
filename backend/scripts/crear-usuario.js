require('dotenv').config();
const readline = require('readline/promises');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const username = (await rl.question('Nombre de usuario: ')).trim().toLowerCase();
  const nombre = (await rl.question('Nombre: ')).trim();
  const apellido = (await rl.question('Apellido: ')).trim();
  const rolCodigo = (
    await rl.question('Rol (administrador, cajero, ventas, contador, auditor, supervisor): ')
  ).trim().toLowerCase();
  const password = await rl.question('Contraseña (mínimo 10 caracteres): ');
  rl.close();

  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    console.error('Usuario inválido: use 3 a 50 letras minúsculas, números, punto, guion o guion bajo.');
    return;
  }
  if (!nombre || !apellido) {
    console.error('El nombre y el apellido son obligatorios.');
    return;
  }
  if (password.length < 10) {
    console.error('La contraseña debe tener al menos 10 caracteres.');
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    const rol = await client.query(
      'SELECT id FROM roles WHERE codigo = $1 AND is_active = true',
      [rolCodigo],
    );
    if (rol.rowCount === 0) {
      await client.query('ROLLBACK');
      console.error('Ese rol no existe.');
      return;
    }
    const u = await client.query(
      `INSERT INTO usuarios (username, nombre, apellido, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [username, nombre, apellido, hash],
    );
    await client.query(
      'INSERT INTO usuario_roles (usuario_id, rol_id) VALUES ($1, $2)',
      [u.rows[0].id, rol.rows[0].id],
    );
    await client.query('COMMIT');
    console.log(`Usuario "${username}" creado con el rol ${rolCodigo}.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(
      e.code === '23505' ? 'Ese nombre de usuario ya existe.' : `No se pudo crear el usuario: ${e.message}`,
    );
  } finally {
    await client.end();
  }
}

main();