require('dotenv').config();
const readline = require('readline/promises');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const username = (await rl.question('Nombre de usuario (ej: admin): '))
    .trim()
    .toLowerCase();
  const nombre = (await rl.question('Nombre: ')).trim();
  const apellido = (await rl.question('Apellido: ')).trim();
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

    const u = await client.query(
      `INSERT INTO usuarios
         (username, nombre, apellido, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id`,
      [username, nombre, apellido, hash],
    );

    await client.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id)
       SELECT $1, id FROM roles WHERE codigo = 'administrador'`,
      [u.rows[0].id],
    );

    await client.query('COMMIT');
    console.log(`Usuario "${username}" creado con el rol Administrador.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') {
      console.error('Ese nombre de usuario ya existe.');
    } else {
      console.error('No se pudo crear el usuario:', e.message);
    }
  } finally {
    await client.end();
  }
}

main();