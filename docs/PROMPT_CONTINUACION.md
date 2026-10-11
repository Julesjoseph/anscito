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
| 009 | Datos de la empresa, más datos de sucursales, usuarios en Principal |
| 010 | Ventas, líneas, pagos, formas de pago, configuración y contadores |
| 011 | Ganancia de servicios por costo o por comisión %; % copiado en cada venta |
| 012 | Caja: cajas fijas, sesiones con arqueo, movimientos inmutables, categorías de gasto |
| 013 | Bancos: monedas (DOP, USD, HTG), cuentas y billeteras, movimientos con tasa, confirmaciones, transferencias entre cuentas y caja |

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

- **Empresa** (menú Empresa): datos de la empresa (razón social, nombre
  comercial, RNC, dirección, teléfono, WhatsApp, correo, sitio web) y logo
  (PNG/JPG/WebP, hasta 512 KB; la pantalla lo reduce a 512 px y el servidor
  verifica que sea una imagen real). El nombre comercial y el logo salen de la
  base en la entrada, el menú y la pestaña del navegador (rutas públicas
  `/marca` y `/marca/logo`; nada más sale sin sesión). El servidor acepta
  envíos de hasta 1 MB por el logo.
- **Sucursales** (pestaña en Empresa): código, nombre, dirección, teléfono,
  encargado; "Principal" no se desactiva (ahí está todo el inventario); no se
  desactiva una sucursal con usuarios activos. Cada usuario tiene su sucursal
  (obligatoria en el formulario de Usuarios). El inventario por sucursal y los
  traslados se construirán cuando el dueño abra la segunda sucursal.

- **Ventas** (menú Ventas): pestañas "Nueva venta" (buscar artículo, cantidad,
  descuento %, cliente, efectivo con devuelta o transferencia con referencia)
  e "Historial" (filtros por fecha, total vendido e ITBIS, detalle, comprobante
  fiscal y anulación). Número interno V-000001 sin huecos; NO es comprobante
  fiscal (el NCF/e-CF lo emite el sistema actual del dueño y se anota como
  referencia). Cada venta copia precio, costo, impuesto y tasa del día;
  descuenta inventario (movimiento `venta`) sin permitir stock negativo;
  descuento máximo configurable (`configuracion.ventas.descuento_maximo_pct`,
  10%) con permiso y motivo; anular el mismo día con `ventas.anular`, días
  anteriores con `ventas.anular_anteriores` (la mercancía vuelve con
  `anulacion_venta`). El efectivo pasa por la caja (ver Caja). Sin asientos,
  cuentas por cobrar ni e-CF todavía.
- **Comprobante en PDF** (`GET /ventas/:id/recibo?formato=80|58|carta`, con
  PDFKit 0.20.2): rollo de 80 o 58 mm con largo ajustado al contenido, u hoja
  carta. El logo debe ser PNG o JPG. Dice "comprobante interno… no sustituye
  el comprobante fiscal".

- **Comisión de servicios**: cada servicio calcula su ganancia por "precio −
  costo" o por "comisión %" (decisión del dueño, editable en Servicios); cada
  venta copia el % del día y el Panel lo usa.
- **Panel** (`GET /panel?periodo=hoy|semana|mes|trimestre|anio`): ventas con
  comparación contra el período anterior, cobrado por forma de pago, ganancia
  bruta estimada (productos y servicios; servicios sin costo cuentan con
  costo 0, decisión del dueño), ITBIS cobrado, alertas y valor del
  inventario, más vendidos, últimas ventas y "Reponer pronto". Cada sección
  solo llega si el usuario tiene el permiso del módulo. "Efectivo en caja"
  muestra lo que debería haber en las cajas abiertas (`caja.ver`); "Cuentas
  por cobrar" queda como "Disponible con el módulo…".
- **Caja (Parte 1 de Caja y bancos)** (`/caja`, pantalla `Caja.tsx`): cajas
  fijas configurables ("Caja 1"…); cada computadora recuerda su caja en
  `localStorage` (`anscito.cajaId`, `cajaLocal.ts`). Abrir con fondo inicial
  (sesión S-000001 sin huecos, una abierta por caja); gastos con categoría y
  comprobante opcional, retiros e ingresos, siempre con motivo y sin sacar
  más de lo que hay; cierre contando billetes y monedas
  (`configuracion.caja.denominaciones`), diferencia = contado − esperado, con
  motivo obligatorio si no cuadra; una sesión cerrada no se reabre. Cuadre en
  PDF (80, 58 mm o carta). Ventas: cobrar en efectivo (`formas_pago.usa_caja`)
  exige la caja de la computadora abierta y crea el movimiento `venta`; anular
  una venta en efectivo devuelve el dinero desde esa caja (`devolucion`), si
  alcanza. Movimientos inmutables y auditados. Pruebas:
  `scripts/probar-caja.ps1` (caja de prueba que se desactiva al final).
- **Bancos (Parte 2 de Caja y bancos)** (`/bancos`, pantalla `Bancos.tsx`):
  cuentas de banco (corriente/ahorro) y billeteras MonCash/NatCash en RD$,
  US$ o HTG; solo se guardan los últimos 4 dígitos. Saldo inicial (uno por
  cuenta); pagos con categoría, cargos, intereses y otros ingresos con motivo;
  errores con reverso (no se reversan cobros de ventas ni transferencias).
  Cada movimiento guarda tasa (RD$ por unidad) y valor en RD$. Estados:
  confirmado, por confirmar y "no llegó" (no cuenta en el saldo); se confirma
  contra el estado de cuenta. Transferencias T-000001 entre cuentas y caja
  (depósitos, traer efectivo, recargas MonCash con quién hizo el cambio);
  lo que entra desde caja o con cambio de moneda queda por confirmar. Ventas
  por transferencia: el cajero elige la cuenta (solo RD$ que `recibe_ventas`),
  entra por confirmar; al anular se devuelve desde esa cuenta (salvo "no
  llegó"). Caja: botones "Depositar en banco" y "Traer de una cuenta". Panel:
  "Dinero en bancos" confirmado por moneda. Pruebas:
  `scripts/probar-bancos.ps1` (cuentas de prueba que terminan en cero).

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
- Caja: falta pantalla para administrar las categorías de gasto (hoy fijas
  desde la migración 012) y su cuenta contable (`cuenta_contable_id`).
- Bancos: la diferencia cambiaria (valor en RD$ de US$/HTG a tasas
  distintas) y la "Compra de mercancía" pagada por banco deben validarse con
  el contador al llegar Contabilidad. Cheques: no se usan por ahora.
- Siguiente según la sección 26: plan de cuentas y motor contable (requiere
  validación del contador), o el módulo MonCash/NatCash (07), que usará las
  billeteras en HTG ya creadas.
