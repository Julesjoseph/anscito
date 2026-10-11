-- ANSCITO 011: ganancia de servicios por comisión
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
-- Cada servicio indica cómo se calcula su ganancia:
--   'costo'    -> precio − costo (como hasta ahora)
--   'comision' -> precio × porcentaje de comisión
-- Cada venta copia el porcentaje del día (el catálogo puede cambiar después).
BEGIN;

ALTER TABLE servicios
  ADD COLUMN ganancia_tipo varchar(10) NOT NULL DEFAULT 'costo',
  ADD COLUMN comision_pct  numeric(5,2),
  ADD CONSTRAINT servicios_ganancia_tipo CHECK (ganancia_tipo IN ('costo', 'comision')),
  ADD CONSTRAINT servicios_comision_rango
    CHECK (comision_pct IS NULL OR (comision_pct > 0 AND comision_pct <= 100)),
  ADD CONSTRAINT servicios_comision_completa
    CHECK ((ganancia_tipo = 'comision') = (comision_pct IS NOT NULL));

ALTER TABLE venta_lineas
  ADD COLUMN comision_pct numeric(5,2),
  ADD CONSTRAINT venta_lineas_comision_rango
    CHECK (comision_pct IS NULL OR (comision_pct > 0 AND comision_pct <= 100)),
  ADD CONSTRAINT venta_lineas_comision_solo_servicios
    CHECK (comision_pct IS NULL OR tipo = 'servicio');

COMMIT;
