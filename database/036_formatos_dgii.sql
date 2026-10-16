-- ANSCITO 036: formatos de envío de la DGII (606 compras, 607 ventas, 608 anulados).
-- * Tipos de retención de ISR del 606 (códigos de la DGII). Una compra con ISR
--   retenido dice de qué tipo es (se pide en Compras desde ahora; las
--   anteriores salen con aviso en el 606).
-- * Facturas de consumo: desde este monto van una por una en el 607; las
--   menores se resumen en la Oficina Virtual (Norma General 10-18). Es
--   configuración: validar con el contador.
-- * Permiso para ver y descargar los formatos (administrador, contador y
--   auditor).
-- Los formatos deben revisarse con el contador y pre-validarse con la
-- herramienta de la DGII antes de enviarlos.
BEGIN;

CREATE TABLE tipos_retencion_isr (
  codigo     varchar(2)    PRIMARY KEY,
  nombre     varchar(120)  NOT NULL,
  orden      int           NOT NULL,
  is_active  boolean       NOT NULL DEFAULT true,
  CONSTRAINT tipos_retencion_isr_codigo CHECK (codigo ~ '^[0-9]{2}$')
);
INSERT INTO tipos_retencion_isr (codigo, nombre, orden) VALUES
  ('01', 'Alquileres', 1),
  ('02', 'Honorarios por servicios', 2),
  ('03', 'Otras rentas', 3),
  ('04', 'Otras rentas (rentas presuntas)', 4),
  ('05', 'Intereses pagados a personas jurídicas residentes', 5),
  ('06', 'Intereses pagados a personas físicas residentes', 6),
  ('07', 'Retención por proveedores del Estado', 7),
  ('08', 'Juegos telefónicos', 8),
  ('09', 'Retenciones subsector de ganadería de carne bovina', 9);

ALTER TABLE compras ADD COLUMN tipo_retencion_isr varchar(2) REFERENCES tipos_retencion_isr(codigo);
-- Solo una compra con ISR retenido lleva tipo de retención.
ALTER TABLE compras ADD CONSTRAINT compras_tipo_retencion
  CHECK (tipo_retencion_isr IS NULL OR isr_retenido > 0);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('fiscal.consumo_607_desde', '250000.00',
   'Facturas de consumo desde este total van una por una en el 607; las menores se resumen (validar con el contador)')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('fiscal.ver', 'fiscal', 'ver', 'Ver y descargar los formatos de la DGII (606, 607 y 608)')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo = 'fiscal.ver'
WHERE r.codigo IN ('administrador', 'contador', 'auditor')
ON CONFLICT DO NOTHING;

COMMIT;
