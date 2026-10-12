-- ANSCITO 017: facturación electrónica (e-CF).
-- Modo "manual": el e-CF se emite fuera de ANSCITO (Facturador Gratuito de la
-- DGII) y aquí se anota el e-NCF. Más adelante, modo "proveedor" (envío
-- automático) sin cambiar estas tablas.
-- Las reglas fiscales (tipos, monto desde el que se identifica al comprador)
-- deben validarse con el contador.
BEGIN;

-- Tipos de e-CF de la DGII. Solo los activos se usan.
CREATE TABLE tipos_ecf (
  codigo     varchar(2)   PRIMARY KEY,
  nombre     varchar(80)  NOT NULL,
  is_active  boolean      NOT NULL DEFAULT false,
  orden      int          NOT NULL,
  CONSTRAINT tipos_ecf_codigo CHECK (codigo ~ '^[0-9]{2}$')
);
INSERT INTO tipos_ecf (codigo, nombre, is_active, orden) VALUES
  ('31', 'Factura de Crédito Fiscal Electrónica', true,  1),
  ('32', 'Factura de Consumo Electrónica',        true,  2),
  ('33', 'Nota de Débito Electrónica',            false, 3),
  ('34', 'Nota de Crédito Electrónica',           true,  4),
  ('41', 'Compras Electrónico',                   false, 5),
  ('43', 'Gastos Menores Electrónico',            false, 6),
  ('44', 'Regímenes Especiales Electrónico',      false, 7),
  ('45', 'Gubernamental Electrónico',             false, 8),
  ('46', 'Exportaciones Electrónico',             false, 9),
  ('47', 'Pagos al Exterior Electrónico',         false, 10);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('facturacion.modo', 'manual',
   'manual: se emite en el Facturador Gratuito y se anota el e-NCF; proveedor: envío automático'),
  ('facturacion.inicio', '',
   'Fecha (AAAA-MM-DD) desde la que las ventas llevan e-CF; vacío = todavía no'),
  ('facturacion.consumo_identificar_desde', '250000.00',
   'Factura de consumo desde este total exige documento del comprador (validar con el contador)');

-- Un e-CF por venta (31 o 32) y, si se anula después de emitido, su nota de crédito (34).
CREATE TABLE ecf (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id             uuid          NOT NULL REFERENCES ventas(id),
  tipo                 varchar(2)    NOT NULL REFERENCES tipos_ecf(codigo),
  modifica_id          uuid REFERENCES ecf(id),      -- nota de crédito: el e-CF que corrige
  estado               varchar(12)   NOT NULL DEFAULT 'por_emitir',
  -- Copia al momento de la venta.
  comprador_documento  varchar(30),
  comprador_nombre     varchar(150)  NOT NULL,
  base_imponible       numeric(14,2) NOT NULL,
  itbis                numeric(14,2) NOT NULL,
  total                numeric(14,2) NOT NULL,
  -- Lo que devuelve la DGII al emitir.
  encf                 varchar(13)   UNIQUE,
  fecha_emision        date,
  codigo_seguridad     varchar(6),
  emitido_por          uuid REFERENCES usuarios(id),
  emitido_en           timestamptz,
  -- No hace falta emitirlo (la venta se anuló antes de emitir).
  motivo_cancelacion   text,
  cancelado_por        uuid REFERENCES usuarios(id),
  cancelado_en         timestamptz,
  created_by           uuid          NOT NULL REFERENCES usuarios(id),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ecf_estado CHECK (estado IN ('por_emitir', 'emitido', 'cancelado')),
  CONSTRAINT ecf_montos CHECK (base_imponible >= 0 AND itbis >= 0 AND total = base_imponible + itbis),
  -- e-NCF: E + tipo (2 dígitos) + secuencia (10 dígitos), del mismo tipo.
  CONSTRAINT ecf_encf CHECK (encf IS NULL OR (encf ~ '^E[0-9]{12}$' AND substr(encf, 2, 2) = tipo)),
  CONSTRAINT ecf_codigo_seguridad CHECK (codigo_seguridad IS NULL OR codigo_seguridad ~ '^[A-Za-z0-9]{6}$'),
  CONSTRAINT ecf_emitido CHECK ((estado = 'emitido') = (encf IS NOT NULL AND fecha_emision IS NOT NULL
    AND codigo_seguridad IS NOT NULL AND emitido_por IS NOT NULL AND emitido_en IS NOT NULL)),
  CONSTRAINT ecf_cancelado CHECK ((estado = 'cancelado') = (motivo_cancelacion IS NOT NULL
    AND cancelado_por IS NOT NULL AND cancelado_en IS NOT NULL)),
  CONSTRAINT ecf_nota_credito CHECK ((tipo = '34') = (modifica_id IS NOT NULL)),
  CONSTRAINT ecf_credito_fiscal CHECK (tipo <> '31' OR comprador_documento IS NOT NULL)
);
-- Una sola factura viva por venta y una sola nota de crédito por factura.
CREATE UNIQUE INDEX ecf_venta_factura ON ecf (venta_id)
  WHERE tipo IN ('31', '32') AND estado <> 'cancelado';
CREATE UNIQUE INDEX ecf_una_nota ON ecf (modifica_id)
  WHERE modifica_id IS NOT NULL AND estado <> 'cancelado';
CREATE INDEX ecf_estado_idx ON ecf (estado, created_at);

-- Nunca se borra un e-CF; la venta, el tipo y los montos no cambian.
-- Lo emitido solo se corrige (e-NCF mal escrito) con auditoría desde el sistema.
CREATE FUNCTION ecf_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los comprobantes electrónicos no se borran';
  END IF;
  IF NEW.venta_id <> OLD.venta_id OR NEW.tipo <> OLD.tipo
     OR NEW.modifica_id IS DISTINCT FROM OLD.modifica_id
     OR NEW.total <> OLD.total OR NEW.itbis <> OLD.itbis OR NEW.base_imponible <> OLD.base_imponible
     OR NEW.comprador_documento IS DISTINCT FROM OLD.comprador_documento
     OR NEW.comprador_nombre <> OLD.comprador_nombre THEN
    RAISE EXCEPTION 'La venta, el tipo, el comprador y los montos de un e-CF no se cambian';
  END IF;
  IF OLD.estado <> 'por_emitir' AND NEW.estado <> OLD.estado THEN
    RAISE EXCEPTION 'Un e-CF emitido o cancelado no cambia de estado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ecf_proteger BEFORE UPDATE OR DELETE ON ecf
  FOR EACH ROW EXECUTE FUNCTION ecf_proteger();

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('facturacion.ver',        'facturacion', 'ver',        'Ver los comprobantes electrónicos (e-CF)'),
  ('facturacion.emitir',     'facturacion', 'emitir',     'Anotar y corregir el e-NCF emitido'),
  ('facturacion.configurar', 'facturacion', 'configurar', 'Configurar la facturación electrónica');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'facturacion'
WHERE r.codigo = 'administrador';

COMMIT;
