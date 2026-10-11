# ANSCITO — Estado actual para continuar el desarrollo

Última actualización: 2026-10-11. Este documento resume dónde está el
proyecto para retomar el trabajo (con cualquier persona o IA). Las reglas
técnicas permanentes están en `CLAUDE.md`; la especificación oficial es el
"ANSCITO - Documento Maestro de Desarrollo" (PDF del dueño, fuera del repo).

## Cómo trabajar con el dueño

- Español sencillo; el dueño está aprendiendo. Rutas exactas, explicar qué
  hace cada pieza, cómo probarla y el resultado esperado.
- Por partes: (1) migración, (2) backend probado con PowerShell (scripts en
  `backend/scripts/probar-*.ps1`), (3) pantalla. Esperar sus pruebas entre
  partes. Preguntar una cosa a la vez cuando falte información de negocio.
- **Las migraciones las aplica Claude** (decisión del dueño desde la 005):
  probarlas en una transacción con ROLLBACK, explicarlas, esperar su visto
  bueno ("aplícala"), comprobar que no estén aplicadas, aplicarlas una vez con
  `node` usando `backend/.env` sin mostrar credenciales.
- Al cerrar cada parte: commit y push a `origin/main`
  (`https://github.com/Julesjoseph/anscito`).

## Migraciones aplicadas en `anscito_dev`

| N.º | Contenido |
|---|---|
| 001 | Usuarios, roles, permisos, sucursales |
| 002 | Auditoría inmutable |
| 003 | Restablecer contraseña / cierre de sesiones |
| 004 | Servicios, impuestos con tasas por vigencia, unidades de negocio y de medida |
| 005 | Categorías universales (unidad de negocio → categoría) |
| 006 | Productos, prefijos de categoría, movimientos de inventario, sucursal Principal |
| 007 | Entradas, salidas y ajustes de inventario |
| 008 | Tipos de documento y terceros (clientes y proveedores) |

## Módulos terminados

- **Usuarios**: crear, editar, desactivar, restablecer contraseña,
  desbloquear, cambio obligatorio en el primer ingreso. Usuario
  administrador: `anscito`.
- **Roles y permisos**: casillas por módulo; nadie da permisos que no tiene;
  el rol Administrador está protegido.
- **Servicios**: catálogo con precio, costo opcional, ITBIS (interruptor
  "incluye ITBIS"), categoría; pestaña Impuestos con tasas por vigencia.
- **Categorías** (menú propio y pestaña en Inventario): unidades de negocio y
  categorías compartidas por servicios y productos; prefijo para códigos.
- **Inventario**: productos con código automático `PREFIJO-0001`; tabla como
  la hoja del dueño (existencia inicial, entradas, salidas, existencia
  actual, costo, ITBIS); entradas (costo por unidad o total de factura),
  salidas con causa, ajuste por conteo, kárdex, costo promedio ponderado,
  alertas de stock (mínimo propio o 5 por defecto), ganancia (margen y sobre
  costo, sin ITBIS), corrección de costo con motivo.
- **Clientes y proveedores** (menús Clientes y Proveedores): listas
  separadas en la tabla `terceros` (campo `rol`). Clientes con "Puede comprar
  a crédito"; proveedores con persona de contacto y días de plazo. Documento
  opcional, obligatorio si "es contribuyente" (RNC 9, cédula 11, pasaporte,
  otro; solo formato y largo, sin dígito verificador ni consulta a la DGII).
  WhatsApp con enlace directo. "Consumidor final" protegido. Privacidad: sin
  `terceros.ver_documento` el documento sale enmascarado y no se puede
  cambiar; la auditoría guarda el documento enmascarado y solo qué datos de
  contacto cambiaron. La Ley 172-13 debe revisarla el abogado del dueño.

## Pendientes y decisiones abiertas

- Impuesto duplicado "ITBIS" al 16% (código `itbi`) creado en pruebas:
  preguntar al dueño si se desactiva o se renombra.
- Parte D de usuarios: varios roles por usuario (unión de permisos).
- Validaciones con profesionales: tasa de ITBIS 18% y qué productos/servicios
  la llevan, costo sin ITBIS y costo promedio (contador); plan de cuentas,
  ISR/TSS (contador); SANES e inversiones (abogado); Ley 172-13 (abogado).
- Previsto sin construir: cuentas por cobrar y por pagar, comprobante fiscal
  preferido (e-CF), datos bancarios de proveedores, importar desde Excel,
  enlazar entradas de inventario con la lista de proveedores, ventas que
  descuenten inventario (ver `docs/notas-ventas.md`).
- Siguiente según el Documento Maestro (sección 26): datos de la empresa y
  sucursales, plan de cuentas y motor contable, caja y bancos, ventas.
