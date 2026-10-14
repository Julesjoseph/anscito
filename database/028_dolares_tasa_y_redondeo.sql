-- ANSCITO 028: correcciones a la 027 (dólares en la caja y pagos en US$).
-- * Cada movimiento de dólares de la caja guarda su tasa y su valor en RD$
--   (monto_dop = monto × tasa, redondeado al centavo).
-- * Pago en US$ (regla del dueño: redondeo hacia arriba, a favor del negocio):
--     monto_usd = lo cobrado en RD$ ÷ tasa, subido al centavo de dólar;
--     devuelta en US$ = recibido_usd − monto_usd;
--     devuelta en RD$ = (recibido_usd − monto_usd) × tasa, al centavo.
BEGIN;

-- La 027 creó caja_movimientos_usd vacía. Si ya tiene filas, no se sigue
-- (no se borra ni se cambia nada): hay que revisarlas antes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM caja_movimientos_usd) THEN
    RAISE EXCEPTION 'caja_movimientos_usd ya tiene movimientos: revíselos antes de aplicar la 028 (no se cambió nada)';
  END IF;
  IF EXISTS (SELECT 1 FROM venta_pagos WHERE moneda = 'USD') THEN
    RAISE EXCEPTION 'venta_pagos ya tiene pagos en US$: revíselos antes de aplicar la 028 (no se cambió nada)';
  END IF;
END $$;

ALTER TABLE caja_movimientos_usd ALTER COLUMN tasa SET NOT NULL;
ALTER TABLE caja_movimientos_usd ADD COLUMN monto_dop numeric(14,2) NOT NULL;
ALTER TABLE caja_movimientos_usd ADD CONSTRAINT caja_usd_tasa CHECK (tasa > 0);
ALTER TABLE caja_movimientos_usd ADD CONSTRAINT caja_usd_monto_dop CHECK (monto_dop = round(monto * tasa, 2));

ALTER TABLE venta_pagos ADD CONSTRAINT venta_pagos_usd_redondeo CHECK (
  moneda <> 'USD' OR (
    monto_usd = ceil(monto / tasa * 100) / 100
    AND devuelta_monto = CASE devuelta_moneda
      WHEN 'USD' THEN recibido_usd - monto_usd
      ELSE round((recibido_usd - monto_usd) * tasa, 2)
    END));

COMMIT;
