-- ANSCITO 027: servicios con precio en dólares y cobro en pesos o en dólares.
-- * Tasa del dólar: la pone el administrador y queda su historial
--   (RD$ por 1 US$). Se usa en todas las ventas hasta que la cambie.
-- * Un servicio puede tener su precio en US$: al venderlo se convierte a RD$
--   con la tasa vigente. La venta, el ITBIS y la contabilidad siguen en RD$;
--   la línea guarda el precio en US$ y la tasa usada.
-- * El cliente escoge pagar en pesos o en dólares (efectivo). Los dólares
--   entran a la misma caja, pero se llevan aparte (caja_movimientos_usd),
--   y al cerrar se cuentan por separado. La devuelta puede darse en pesos o
--   en dólares (lo escoge el cajero).
BEGIN;

-- ---------- Tasa del dólar ----------
CREATE TABLE tasas_dolar (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tasa           numeric(12,4) NOT NULL,       -- RD$ por 1 US$
  vigente_desde  timestamptz   NOT NULL DEFAULT now(),
  motivo         varchar(300),
  created_by     uuid          NOT NULL REFERENCES usuarios(id),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT tasas_dolar_tasa CHECK (tasa > 0 AND tasa < 1000)
);
CREATE INDEX tasas_dolar_vigente_idx ON tasas_dolar (vigente_desde DESC);

-- Historial: una tasa no se cambia ni se borra; se pone una nueva.
CREATE FUNCTION tasas_dolar_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Una tasa del dólar no se cambia: registre una nueva';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tasas_dolar_no_modificar BEFORE UPDATE OR DELETE ON tasas_dolar
  FOR EACH ROW EXECUTE FUNCTION tasas_dolar_inmutables();

-- ---------- Servicios con precio en US$ ----------
ALTER TABLE servicios ADD COLUMN moneda varchar(3) NOT NULL DEFAULT 'DOP' REFERENCES monedas(codigo);
ALTER TABLE servicios ADD CONSTRAINT servicios_moneda CHECK (moneda IN ('DOP', 'USD'));

-- La línea vendida recuerda el precio en US$ y la tasa (precio_unitario sigue en RD$).
ALTER TABLE venta_lineas ADD COLUMN precio_usd numeric(14,2);
ALTER TABLE venta_lineas ADD COLUMN tasa_dolar numeric(12,4);
ALTER TABLE venta_lineas ADD CONSTRAINT venta_lineas_usd CHECK (
  (precio_usd IS NULL) = (tasa_dolar IS NULL) AND (precio_usd IS NULL OR precio_usd >= 0));

-- ---------- Pago en dólares ----------
-- monto sigue siendo RD$ (lo que se cobró de la venta). Si se pagó en US$:
-- tasa usada, monto_usd (lo cobrado en US$), recibido_usd (lo que entregó)
-- y la devuelta en la moneda que escogió el cajero.
ALTER TABLE venta_pagos ADD COLUMN moneda varchar(3) NOT NULL DEFAULT 'DOP';
ALTER TABLE venta_pagos ADD COLUMN tasa numeric(12,4);
ALTER TABLE venta_pagos ADD COLUMN monto_usd numeric(14,2);
ALTER TABLE venta_pagos ADD COLUMN recibido_usd numeric(14,2);
ALTER TABLE venta_pagos ADD COLUMN devuelta_moneda varchar(3);
ALTER TABLE venta_pagos ADD COLUMN devuelta_monto numeric(14,2);
ALTER TABLE venta_pagos ADD CONSTRAINT venta_pagos_moneda CHECK (
  (moneda = 'DOP' AND tasa IS NULL AND monto_usd IS NULL AND recibido_usd IS NULL
     AND devuelta_moneda IS NULL AND devuelta_monto IS NULL)
  OR (moneda = 'USD' AND tasa > 0 AND monto_usd > 0 AND recibido_usd >= monto_usd
     AND recibido IS NULL AND devuelta IS NULL
     AND devuelta_moneda IN ('DOP', 'USD') AND devuelta_monto >= 0));

-- ---------- Dólares en la caja (aparte de los pesos) ----------
CREATE TABLE caja_movimientos_usd (
  id           bigserial PRIMARY KEY,
  sesion_id    uuid          NOT NULL REFERENCES caja_sesiones(id),
  tipo         varchar(12)   NOT NULL,
  monto        numeric(14,2) NOT NULL,       -- en US$
  tasa         numeric(12,4),                -- tasa del momento (referencia)
  venta_id     uuid REFERENCES ventas(id),
  motivo       text,
  usuario_id   uuid          NOT NULL REFERENCES usuarios(id),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT caja_usd_tipo CHECK (tipo IN (
    'venta',       -- dólares cobrados en una venta (suma)
    'devolucion',  -- dólares devueltos al anular una venta (resta)
    'ingreso',     -- se metieron dólares a la caja (suma)
    'retiro'       -- se sacaron dólares de la caja (resta)
  )),
  CONSTRAINT caja_usd_monto CHECK (monto > 0),
  CONSTRAINT caja_usd_venta CHECK ((tipo IN ('venta', 'devolucion')) = (venta_id IS NOT NULL)),
  CONSTRAINT caja_usd_motivo CHECK (tipo IN ('venta', 'devolucion') OR motivo IS NOT NULL)
);
CREATE INDEX caja_usd_sesion_idx ON caja_movimientos_usd (sesion_id, created_at);
CREATE INDEX caja_usd_venta_idx ON caja_movimientos_usd (venta_id);
CREATE TRIGGER caja_movimientos_usd_no_modificar
  BEFORE UPDATE OR DELETE ON caja_movimientos_usd
  FOR EACH ROW EXECUTE FUNCTION caja_movimientos_inmutables();

-- Devuelta en pesos de un pago en dólares: sale RD$ de la caja ("cambio");
-- si la venta se anula, el cliente devuelve esos pesos ("cambio_reverso").
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_tipo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_tipo CHECK (tipo IN (
  'venta', 'devolucion', 'gasto', 'retiro', 'ingreso', 'deposito', 'desde_cuenta',
  'san_cuota', 'san_mano', 'compra', 'compra_reverso', 'abono_credito', 'abono_anulado',
  'cambio',          -- devuelta en RD$ de un pago en US$ (resta)
  'cambio_reverso'   -- se anuló esa venta y los RD$ de la devuelta vuelven (suma)
));
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_venta;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_venta CHECK (
  (tipo IN ('venta', 'devolucion', 'cambio', 'cambio_reverso')) = (venta_id IS NOT NULL));
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_motivo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'deposito', 'desde_cuenta', 'san_cuota', 'san_mano', 'compra',
           'abono_credito', 'cambio')
  OR motivo IS NOT NULL);

-- Apertura y cierre: fondo, esperado y contado en US$ (aparte de los RD$).
ALTER TABLE caja_sesiones ADD COLUMN fondo_inicial_usd numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE caja_sesiones ADD COLUMN esperado_usd numeric(14,2);
ALTER TABLE caja_sesiones ADD COLUMN contado_usd numeric(14,2);
ALTER TABLE caja_sesiones ADD COLUMN diferencia_usd numeric(14,2);
ALTER TABLE caja_sesiones ADD CONSTRAINT caja_sesiones_usd CHECK (
  fondo_inicial_usd >= 0
  AND (contado_usd IS NULL OR contado_usd >= 0)
  AND (diferencia_usd IS NULL OR diferencia_usd = contado_usd - esperado_usd)
  AND (diferencia_usd IS NULL OR diferencia_usd = 0 OR motivo_diferencia IS NOT NULL));

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('caja.denominaciones_usd', '100,50,20,10,5,2,1',
   'Billetes (US$) para contar los dólares de la caja al cerrarla');

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('ventas.tasa_dolar', 'ventas', 'tasa_dolar', 'Cambiar la tasa del dólar (RD$ por 1 US$)');
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo = 'ventas.tasa_dolar'
WHERE r.codigo = 'administrador';

COMMIT;
