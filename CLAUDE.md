# ANSCITO — instrucciones del proyecto

Sistema administrativo de SCITO ENTREPRISE. Toda la comunicación, el código
(nombres de variables, funciones, tablas), los mensajes al usuario final y los
commits se escriben **en español**. Marca visible en pantalla:
"SCITO ENTREPRISE - Área de administración".

## Especificación y contexto del negocio

- Especificación oficial: "ANSCITO - Documento Maestro de Desarrollo" (PDF del
  dueño, fuera del repositorio). No eliminar ni simplificar sus requisitos.
  Donde el documento esté desactualizado (rutas, estado del proyecto), manda
  el estado real del repositorio.
- Empresa multiservicios en **República Dominicana**; moneda principal
  **RD$ (DOP)**. Hay cuentas en US$, y las billeteras MonCash/NatCash del
  negocio están en gourdes (HTG): recargarlas es transferencia entre cuentas
  propias, no gasto. Cada movimiento en otra moneda guarda su tasa y su valor
  en RD$.
- Las 12 áreas del sistema: 01 Dashboard, 02 Administración (empresa,
  sucursales, configuración fiscal y bancaria, clientes, proveedores,
  usuarios y roles), 03 Ventas y servicios, 04 Inventario, 05 Caja y bancos,
  06 Finanzas (Préstamos, SANES, Inversiones), 07 MonCash/NatCash,
  08 Contabilidad, 09 Nómina y RRHH, 10 Facturación electrónica (e-CF vía
  proveedor certificado), 11 Reportes, 12 Seguridad y auditoría.
- Orden de desarrollo: sección 26 del Documento Maestro (después de usuarios
  y roles: administración básica, clientes/proveedores, plan de cuentas y
  motor contable, caja y bancos, inventario, ventas y servicios…).
- Requieren validación profesional antes de producción (no presentarlas
  como certeza): plan de cuentas definitivo y tasas ISR/TSS/INFOTEP
  (contador); SANES e inversiones (validación legal).
- Separar siempre dinero de terceros, capital, ingresos, comisiones y gastos:
  no registrar todo el dinero recibido como ingreso.
- Las pantallas deben ser responsive (la versión móvil será una PWA).

## Estructura

```
backend/    API NestJS (TypeScript) — pruebas en el puerto 3010
frontend/   SPA React + Vite + Tailwind — pruebas en el puerto 5180
database/   Migraciones SQL numeradas (NNN_descripcion.sql)
docs/       Documentación (vacío por ahora)
```

## Tecnologías

- **Backend**: NestJS 12, TypeScript 6 (strict), `pg` con SQL escrito a mano
  (sin ORM), `bcrypt` (costo 12), `jsonwebtoken` (HS256, 8 h), `dotenv`.
  Pruebas con Jest 30 + ts-jest + supertest. Lint con oxlint, formato con
  Prettier (comillas simples, punto y coma, coma final).
- **Frontend**: React 19, Vite 8, Tailwind CSS 4 (`@tailwindcss/vite`),
  iconos `lucide-react`. Sin router ni librería de estado: la página activa
  vive en el estado de `Layout.tsx`. Estilo de código: comillas simples,
  **sin** punto y coma.
- **Base de datos**: PostgreSQL. Claves `uuid` con `gen_random_uuid()`,
  `timestamptz`, columnas `created_at`/`updated_at`, banderas `is_active`.

## Backend: patrones obligatorios

- Un módulo Nest por área en `backend/src/<modulo>/` con
  `<modulo>.module.ts`, `<modulo>.controller.ts`, `<modulo>.service.ts`, y
  registrarlo en `app.module.ts`.
- Acceso a datos solo mediante `DatabaseService` (`database/database.service.ts`):
  - `db.query(sql, params)` para lecturas simples.
  - `db.transaccion(async (c) => { ... })` para toda escritura que toque más
    de una fila/tabla o que requiera auditoría. Bloquear con `FOR UPDATE`
    las filas que se leen para luego modificar.
  - **Siempre** consultas parametrizadas (`$1`, `$2`…). Nunca concatenar
    entradas del usuario en SQL.
- Controladores protegidos con `@UseGuards(JwtAuthGuard, PermisosGuard)` y
  cada ruta con `@RequierePermiso('modulo.accion')`. `PermisosGuard` rechaza
  rutas sin permiso definido: no quitar ese comportamiento.
- Usuario actual: `@Req() req: { usuario: UsuarioActual; ip?: string }`.
- Validación manual en el servicio (no hay class-validator): convertir con
  `String(x ?? '').trim()`, validar UUID con la regex `UUID`, lanzar
  `BadRequestException` / `NotFoundException` / `ForbiddenException` /
  `ConflictException` con mensajes en español. Código `23505` → conflicto.
- Toda acción que cambie datos registra auditoría dentro de la misma
  transacción con `registrarAuditoria(c, { usuarioId, accion: 'entidad.accion',
  entidad, entidadId, anterior, nuevo, motivo, ip })`
  (`auditoria/auditoria.ts`). La tabla `auditoria` es inmutable (trigger).
- Desactivar en lugar de borrar (`is_active = false` + motivo auditado).

## Permisos y roles

- Tablas: `usuarios`, `roles`, `permisos` (codigo `modulo.accion`),
  `rol_permisos`, `usuario_roles`, `sucursales`.
- Roles iniciales: administrador, cajero, ventas, contador, auditor, supervisor.
- Un módulo nuevo agrega sus permisos en su migración **y** los asigna
  explícitamente al rol `administrador` (ver patrón en
  `database/003_reset_password.sql`); la asignación de 001 no se actualiza sola.
- El frontend oculta menús según `perfil.permisos`, pero la seguridad real
  está siempre en el backend.

## Migraciones de base de datos

- Archivo nuevo `database/NNN_descripcion.sql` con el siguiente número libre,
  envuelto en `BEGIN; ... COMMIT;`. Nunca editar una migración ya aplicada.
- No hay herramienta ni tabla de control de migraciones, y `psql` no está
  en el PATH. Desde la 005, por decisión del dueño, **Claude las aplica**:
  1. probarlas antes en una transacción que termina en `ROLLBACK`;
  2. mostrarle al dueño qué hacen y esperar su visto bueno;
  3. comprobar que no estén aplicadas, ejecutarlas una sola vez con `node`
     usando la conexión de `backend/.env` (sin mostrar credenciales) y
     enseñarle la consulta de comprobación.
  Si el dueño las ejecuta en pgAdmin y una transacción queda rota, se
  arregla con `ROLLBACK;`.
- Aplicadas hasta ahora: 001 a 025 en las tres bases (`anscito_dev`, `anscito`, `anscito_demo`).
- Bases de datos: `anscito_dev` (pruebas de Claude), `anscito_demo`
  (entrenamiento) y, cuando se cree, `anscito` (real). Cada migración nueva
  se prueba en `anscito_dev` y, con el visto bueno del dueño, se aplica a
  TODAS. La demo también se puede recrear con
  `backend/scripts/demo/reiniciar-demo.ps1` (borra solo `anscito_demo`).
- Flujo de cada cambio: programar y probar en `anscito_dev` (puertos
  3010/5180) → el dueño prueba → "publícalo": aplicar migraciones a
  `anscito` y `anscito_demo`, ejecutar `backend/scripts/publicar.ps1`,
  commit y push. El sistema real nunca usa esta carpeta directamente.
- Al probar, no compilar en `backend/dist` mientras el servidor del dueño
  está encendido (lo usa `npm run start:dev` y el demo).
- Prohibido sin autorización explícita: `DROP`, `TRUNCATE`, `DELETE` masivo,
  `ALTER ... DROP COLUMN`, cambios de tipo con pérdida, desactivar triggers.

## Dinero y finanzas

- Montos en PostgreSQL con `numeric(p, s)`, nunca `real`/`double precision`.
  `pg` devuelve `numeric` como **string**: no convertir a `Number` para
  calcular; hacer los cálculos en SQL o con aritmética entera en centavos.
- Movimientos de caja, bancos y cuentas: solo inserción + reversos/ajustes
  auditados; nunca editar ni borrar un movimiento confirmado.
- Tasas fiscales (ISR, TSS, INFOTEP, ITBIS), comisiones y cuentas contables
  nunca se escriben en el código: van en tablas de configuración con fecha
  de vigencia, y el plan de cuentas es parametrizable.
- Comisiones de MonCash/NatCash, reglas contables o de nómina y cualquier
  dato de negocio que falte deben confirmarse con el dueño antes de
  implementarse.

## Frontend: patrones

- Llamadas HTTP solo vía `frontend/src/api.ts` (`llamar<T>()` con token
  Bearer; 401 → `SesionVencida` → cerrar sesión). Token en `sessionStorage`.
- Una pantalla por módulo en `frontend/src/<Modulo>.tsx`, conectada en el
  arreglo `MODULOS` de `Layout.tsx` (`listo: true`, `permiso: 'modulo.ver'`).
- Diseño visual: fondo `bg-gray-100`, tarjetas `bg-white border
  border-gray-200 rounded-xl`, color de marca `#C8102E`, inputs según la
  constante `CAMPO` de `Usuarios.tsx`, modales como `Ventana`, iconos de
  lucide-react. Textos de interfaz en español.

## Comandos

```bash
# Backend (desde backend/)
npm run start:dev       # API en modo desarrollo
npx tsc --noEmit        # verificación de tipos
npm test                # pruebas unitarias (*.spec.ts en src/)
npm run test:e2e        # pruebas e2e (requieren base de datos)
npm run lint            # oxlint
node test-db.js         # probar conexión a PostgreSQL

# Frontend (desde frontend/)
npm run dev             # Vite en http://localhost:5180 (pruebas)
npm run build           # tsc -b + build
npm run lint            # oxlint
```

## Configuración y secretos

- `backend/.env` contiene credenciales (DB_*, JWT_SECRET ≥ 32 caracteres).
  **No leerlo, mostrarlo ni modificarlo.** La referencia es
  `backend/.env.example`. Nunca subir `.env` a git.
- `JWT_SECRET`, CORS (`main.ts`), `API_URL` (`api.ts`) y credenciales son
  configuración sensible: no cambiarlos sin autorización.

## Git y GitHub

- Remoto: `origin` → `https://github.com/Julesjoseph/anscito.git`, rama `main`.
- Sin CI ni plantillas de PR; la CLI `gh` no está instalada.
- Commits pequeños, uno por funcionalidad, mensaje corto en español sin
  tildes (p. ej. `Restablecer contrasena y desbloquear usuarios`).
- Al cerrar cada parte, ya probada por el dueño: `git status` (confirmar que
  no aparecen `.env` ni `node_modules`), `git add .`, commit, `git push` y
  `git log --oneline`. No hacer commit, push ni crear ramas sin que el dueño
  lo pida.
- Si un secreto llega a Git, hay que cambiar esa clave; no basta con borrarla.
- No ejecutar `npm audit fix --force`.

## Forma de trabajar con el dueño

- El dueño está aprendiendo a programar: explicar en español sencillo, con
  la ruta exacta de cada archivo y el archivo completo (o la línea exacta a
  buscar y reemplazar), cómo ejecutarlo, cómo probarlo y el resultado esperado.
- Entregar por partes: primero el backend probado con PowerShell, después la
  pantalla. Esperar el resultado de las pruebas antes de avanzar.
- Entorno: Windows 10, VS Code con PowerShell, Node 24, PostgreSQL 17 y
  pgAdmin 4. Backend (`npm run start:dev`) y frontend (`npm run dev`) en
  terminales separados; confirmar que el prompt termina en `\backend>`,
  `\frontend>` o `\SCITO>`.
- En pruebas con contraseña usar `Read-Host -AsSecureString`. Nunca pedir ni
  mostrar la contraseña de la base ni `JWT_SECRET`; recordar no compartir
  tokens ni claves en capturas.
