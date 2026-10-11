# Notas para el módulo de Ventas

Decisiones tomadas al crear el catálogo de servicios (migración 004) que el
módulo de ventas debe respetar cuando se construya.

## El catálogo no es el historial

- La tabla `servicios` guarda el **precio de lista actual**. Puede cambiar
  en cualquier momento.
- Cada línea de una venta debe **copiar** en sus propias columnas, en el
  momento de vender: código y nombre del servicio, precio, costo, impuesto,
  tasa de ITBIS vigente ese día, si el precio incluía ITBIS, base imponible,
  ITBIS y total.
- Nunca recalcular una venta pasada leyendo el catálogo ni la tabla de
  tasas: los reportes históricos salen de lo copiado en la venta.

## Impuestos

- La tasa vigente se busca en `impuesto_tasas` por fecha
  (`vigente_desde <= fecha` y `vigente_hasta` vacío o `>= fecha`).
- La tasa nunca se escribe en el código.
- El servidor calcula base, ITBIS y total; la pantalla solo muestra una
  vista previa.
- Que un servicio esté "Exento" no significa que la operación quede libre de
  obligaciones fiscales. Qué servicios llevan ITBIS y su clasificación
  fiscal deben confirmarse con el contador.

## Pagos de servicios de terceros (CAASD, electricidad, internet, teléfono)

- Decisión del dueño: **no** van en el catálogo de servicios por ahora;
  tendrán su propio módulo.
- El monto recibido del cliente es dinero manejado para él, no ingreso de
  la empresa; el ingreso es solo la comisión (Documento Maestro, sec. 8 y
  19). El tratamiento fiscal de la comisión debe validarlo el contador.
- La columna `servicios.tipo` solo admite `'propio'`; ampliarla con una
  migración si en el futuro se decide otra cosa.

## Contabilidad

- `servicios.cuenta_ingreso_id` está prevista pero vacía y sin clave
  foránea hasta que exista el plan de cuentas. No escribir números de
  cuenta en el código.
