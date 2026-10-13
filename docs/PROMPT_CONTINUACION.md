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
| 014 | Envíos a Haití (remesas): tarifas con historial, agentes, beneficiarios, motivos, envíos pendiente/confirmado/rechazado, entregas de agentes, pago de comisiones, roles de operadores |
| 015 | Permisos de reportes por área (ventas, envíos, caja y bancos, inventario) |
| 016 | SAN: sanes, turnos, participaciones (completo/medio), recibos de cuotas, entregas de mano, pagos; % comisión/mora y días de gracia configurables; movimientos `san_cuota`/`san_mano` en caja y cuentas |
| 017 | Facturación electrónica: tipos de e-CF (31, 32, 34 activos), tabla `ecf` (por emitir / emitido / cancelado, e-NCF único, nota de crédito), configuración `facturacion.*` (modo manual, fecha de inicio vacía, monto para identificar al comprador) |
| 018 | SAN/SOL CASH: ficha del participante (`san_fichas`), referencias y fiador con confirmación (`san_garantes`), fotos del documento y contratos firmados (`san_archivos`), plantillas de contrato es/fr/ht con versiones y contratos congelados (`san_contratos`); tipo de documento CIN/NIU de Haití; 4 permisos |
| 019 | Plantillas de contrato versión 2 con "SOL CASH" en lugar de "SAN" |
| 020 | Permiso `reportes.clientes` |

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
- Validaciones con profesionales: tasa de ITBIS 18% y qué productos/servicios
  la llevan, costo sin ITBIS y costo promedio (contador); plan de cuentas,
  ISR/TSS (contador); SANES e inversiones (abogado); Ley 172-13 (abogado).
- Previsto sin construir: cuentas por cobrar y por pagar, comprobante fiscal
  preferido (e-CF), datos bancarios de proveedores, importar desde Excel,
  enlazar entradas de inventario con la lista de proveedores, ventas que
  descuenten inventario (ver `docs/notas-ventas.md`).
- Caja: falta pantalla para administrar las categorías de gasto (hoy fijas
  desde la migración 012) y su cuenta contable (`cuenta_contable_id`).
- **SCITO TRANSFER: envíos a Haití** (`/remesas`, pantalla `Envios.tsx`,
  menú "SCITO TRANSFER"): agentes (punto propio sin comisión y autorizados
  con 50% de la comisión, pago semanal/quincenal/mensual), tasa y comisiones
  con historial (2.05 HTG por RD$, 10%), remitentes = Clientes con documento
  obligatorio (`remesas.documento_desde` = 0), beneficiarios con teléfono de
  Haití, parentesco y motivo. Envío E-000001 pendiente → confirmado con el
  código de NatCash/MonCash (salen las gourdes de la billetera HTG, tipo
  `remesa`) o rechazado con motivo. Cuentas de agentes: deben el total de sus
  envíos confirmados menos sus entregas (efectivo a caja o depósito por
  confirmar); reporte del día; pago de comisiones como gasto
  "Comisiones de agentes de envíos". Recibo provisional/definitivo en PDF.
  Roles "Operador de envíos (RD)" y "(Haití)". 13 agentes importados del
  Excel SCITOS SYSTEME 3.0; beneficiarios no. Queda preparado (origen
  `importado`) para importar el registro de operaciones del Excel cuando el
  dueño lo pida. Pruebas: `scripts/probar-envios.ps1`.
- **Calculadora** (menú, arriba de Ventas; permiso `remesas.ver`): RD$ ↔ HTG
  con la tarifa vigente, desde el monto a enviar, lo que trae el cliente o lo
  que debe llegar; botón "Copiar para WhatsApp". Misma fórmula que el
  servidor (verificada con 36,000 casos).
- **Envíos en pesos y gourdes enteros** (decisión del dueño): el monto
  enviado no lleva centavos; recibe, comisión y parte del agente se
  redondean al entero (mitad hacia arriba; comisión impar: el agente recibe
  la mitad redondeada hacia arriba). La comisión es % del monto enviado, no
  del total pagado. Los envíos anteriores no cambian.
- **Modo DEMO (entrenamiento)**: el mismo programa arranca como real
  (servidor 3000, pantallas 5173) o como demo (servidor 3001 con
  `DB_NAME=anscito_demo`, pantallas 5174 con `VITE_MODO=demo` y franja
  amarilla). `frontend/src/entorno.ts` (VITE_API_URL) y `CORS_ORIGENES` en
  `main.ts`, con los valores de siempre por defecto. Scripts en
  `backend/scripts/demo/`: `iniciar-demo.ps1` y `reiniciar-demo.ps1`
  (→ `reiniciar-demo.js`: borra solo `anscito_demo`, migraciones, copia
  catálogos activos del real o de `anscito_dev`, crea 4 usuarios demo.* con
  contraseña nueva en el escritorio y datos inventados).
- **Tres entornos** (decisión del dueño):

  | Entorno | Programa | Base | Puertos |
  |---|---|---|---|
  | ANSCITO (real, icono) | `C:\Users\Dell\SCITO-publicado` | `anscito` | 3000 / 5173 |
  | ANSCITO DEMO (icono) | `SCITO-publicado` | `anscito_demo` | 3001 / 5174 |
  | Pruebas (`npm run start:dev` / `npm run dev`) | esta carpeta | `anscito_dev` | 3010 / 5180 |

  La base real se creó vacía con `backend/scripts/crear-base-real.js`
  (solo migraciones + los 13 agentes); el administrador real lo creó el
  dueño con `crear-admin.js`. Publicar una versión aprobada:
  `backend/scripts/publicar.ps1` (compila en una carpeta temporal, guarda la
  anterior en `SCITO-publicado-anterior`, copia solo lo cambiado, rehace los
  accesos del escritorio; el `.env` no se copia: se lee vía
  `publicado.json`). Las migraciones se aplican a mano a `anscito` y
  `anscito_demo` antes de publicar. Las pantallas publicadas las sirve
  `backend/scripts/servir-pantallas.js` (solo Node). Los accesos verifican
  que el puerto lo use la versión publicada antes de reutilizarlo.
- **Reportes** (`/reportes`, pantalla `Reportes.tsx`): 10 reportes por
  período con totales, en pantalla, Excel (`exceljs` 4.4.0, con `uuid`
  forzado a 11.1.1 por seguridad) y PDF: ventas por día, por artículo y por
  vendedor; envíos por agente, estado de cuenta del agente y detalle de
  envíos; cierres de caja, movimientos de una cuenta (saldo corrido) y
  gastos por categoría; existencia y valor del inventario a una fecha.
  Permisos por área (`reportes.*`); costos/ganancia con `inventario.ver_costos`
  y comisiones con `remesas.entregas`.
- **SAN** (`/sanes`, pantalla `Sanes.tsx`, menú "SAN"): SCITO organiza y
  cobra comisión por mano (5 % por defecto) y mora (10 % de la cuota tras 3
  días de gracia), todo modificable en Configuración y copiado en cada SAN.
  Frecuencia semanal (cada 7 días), quincenal (días 15 y 30; febrero el
  último día) o mensual. Un dueño por número o dos medios números; los
  participantes son clientes con documento. Pestañas: Cobrar cuotas (en
  orden, con adelantos; recibo R-000001), Los SAN (crear, asignar números,
  fechas en preparación, activar/cancelar/terminar, entregar la mano con
  recibo M-000001), Atrasados y Configuración. La mano se entrega completa
  aunque otros deban (SCITO adelanta) y a quien cobra se le descuentan sus
  cuotas vencidas. Las cuotas son dinero de terceros; solo comisión y mora
  son ganancia. Requiere validación legal antes de usarlo con clientes.
- **Facturación electrónica** (`/facturacion`, pantalla `Facturacion.tsx`):
  modo manual con el Facturador Gratuito de la DGII. Desde la fecha de
  inicio (Configuración; vacía = apagada) cada venta de Ventas / SCITO
  SERVICE deja su e-CF "por emitir": 31 si el cliente es contribuyente, 32 si
  no (o el que se elija al cobrar). Al final del día se emite en la DGII y se
  anota e-NCF, fecha y código de seguridad (validados). Venta anulada: si el
  e-CF no se emitió se cancela; si ya se emitió queda una Nota de Crédito 34
  por emitir. Las comisiones (envíos, SAN) no llevan e-CF por ahora: lo decide
  el contador. En Ventas se puede crear un cliente nuevo ("+ Nuevo", con
  RNC/cédula y "pide Crédito Fiscal") sin salir de la venta.
  Plazo DGII para pequeños: 15/11/2026 (confirmar). Siguiente
  paso posible: modo "proveedor" (envío automático por la API del proveedor
  que el dueño contrate; claves solo en `.env`).
- **SOL CASH** (antes "SAN"; tablas y permisos siguen como `sanes`):
  códigos SOL-0001. Para entrar a un número hace falta la ficha completa:
  documento (cédula, pasaporte, CIN/NIU de Haití u otro), teléfono, ficha
  (nacimiento, ocupación, dirección con sector/municipio/provincia), foto del
  documento (frente), fiador confirmado y al menos una referencia confirmada.
  Persona nueva desde la ventana de asignar. Contrato por número en español,
  francés o criollo (plantillas editables con versiones, BORRADOR: abogado);
  se sube el firmado (fotos o PDF). Las fotos se achican en el navegador
  (límite del servidor 1 MB por petición; 750 KB por archivo).
- **Menú**: Panel, Calculadora, SCITO TRANSFER, SCITO SERVICE, Facturación
  (antes Ventas), SOL CASH, y el resto.
- **Reportes de clientes** (permiso `reportes.clientes`): "Clientes por
  servicio" (TRANSFER, SOL CASH, Facturación, Crédito Fiscal) y "Clientes y
  sus servicios"; documento enmascarado sin `terceros.ver_documento`.
- **Impresión del comprobante de venta**: botón "Imprimir" directo (HTML en
  un marco invisible, `frontend/src/ticket.ts`) que se ajusta al papel: rollo
  58 mm (imprime 48 mm), 80 mm (imprime 72 mm), ancho automático u hoja
  carta/A4; margen interno de 2 mm. "PDF" queda para guardar o compartir.
  Probado en POS-58C y POS-80C. Los demás recibos (envíos, SOL CASH, cuadre
  de caja) siguen en PDF.
- **Usuarios con varios roles**: casillas en Usuarios; los permisos son la
  suma; nadie cambia sus propios roles ni da permisos que no tiene.
- **Nombres en pantalla**: "Servicios" se muestra como "SCITO SERVICE" y los
  envíos como "SCITO TRANSFER" (los permisos y tablas no cambian). Panel con
  tarjetas SCITO SERVICE y SCITO TRANSFER. Las tarjetas del Panel dependen
  de los permisos de cada módulo (decisión del dueño: no hay permisos
  propios del Panel).
- Pendiente: importar el registro de operaciones (envíos) del Excel cuando
  el dueño lo pida; la hoja USUARIOS del Excel tenía contraseñas en texto
  visible (se recomendó cambiarlas).
- Bancos: la diferencia cambiaria (valor en RD$ de US$/HTG a tasas
  distintas) y la "Compra de mercancía" pagada por banco deben validarse con
  el contador al llegar Contabilidad. Cheques: no se usan por ahora.
- Siguiente según la sección 26: plan de cuentas y motor contable (requiere
  validación del contador), o el módulo MonCash/NatCash (07), que usará las
  billeteras en HTG ya creadas.
