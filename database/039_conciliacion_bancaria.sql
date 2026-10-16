-- ANSCITO 039: conciliación bancaria.
-- Por cada cuenta de banco o billetera, a una fecha de corte: el saldo del
-- estado de cuenta y los movimientos que aparecen en él ("cotejados"). Lo no
-- cotejado queda "en tránsito". Se cierra solo cuando la diferencia es 0;
-- cerrada, no se cambia. Los movimientos cotejados en una conciliación
-- cerrada no vuelven a aparecer en la siguiente.
-- Permiso: bancos.confirmar (confirmar contra el estado de cuenta).
BEGIN;

CREATE TABLE conciliaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        bigint        NOT NULL UNIQUE,              -- CB-000001
  cuenta_id     uuid          NOT NULL REFERENCES cuentas(id),
  fecha_corte   date          NOT NULL,
  saldo_banco   numeric(14,2) NOT NULL,                     -- según el estado de cuenta
  estado        varchar(10)   NOT NULL DEFAULT 'abierta',   -- abierta | cerrada | descartada
  notas         varchar(500),
  -- Al cerrar: el saldo del sistema a la fecha de corte y lo que quedó en tránsito.
  saldo_sistema numeric(14,2),
  en_transito   numeric(14,2),
  cerrada_por   uuid REFERENCES usuarios(id),
  cerrada_en    timestamptz,
  motivo_descarte varchar(500),
  created_by    uuid          NOT NULL REFERENCES usuarios(id),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT conciliaciones_estado CHECK (estado IN ('abierta', 'cerrada', 'descartada')),
  CONSTRAINT conciliaciones_cerrada CHECK ((estado = 'cerrada') =
    (cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL AND saldo_sistema IS NOT NULL AND en_transito IS NOT NULL)),
  CONSTRAINT conciliaciones_descartada CHECK ((estado = 'descartada') = (motivo_descarte IS NOT NULL))
);
-- Una sola conciliación abierta por cuenta.
CREATE UNIQUE INDEX conciliaciones_una_abierta ON conciliaciones (cuenta_id) WHERE estado = 'abierta';
CREATE INDEX conciliaciones_cuenta_idx ON conciliaciones (cuenta_id, fecha_corte);

INSERT INTO contadores (clave, valor) VALUES ('conciliaciones', 0) ON CONFLICT (clave) DO NOTHING;

-- Marcas de "aparece en el estado de cuenta" (se cambian mientras está abierta).
CREATE TABLE conciliacion_partidas (
  conciliacion_id uuid        NOT NULL REFERENCES conciliaciones(id),
  movimiento_id   bigint      NOT NULL REFERENCES cuenta_movimientos(id),
  cotejado        boolean     NOT NULL,
  updated_by      uuid        NOT NULL REFERENCES usuarios(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conciliacion_id, movimiento_id)
);
CREATE INDEX conciliacion_partidas_mov_idx ON conciliacion_partidas (movimiento_id) WHERE cotejado;

-- Una conciliación cerrada o descartada no cambia; sus marcas tampoco.
CREATE FUNCTION conciliaciones_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las conciliaciones no se borran: se descartan';
  END IF;
  IF OLD.estado <> 'abierta' THEN
    RAISE EXCEPTION 'Una conciliación cerrada o descartada no se cambia';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER conciliaciones_proteger BEFORE UPDATE OR DELETE ON conciliaciones
  FOR EACH ROW EXECUTE FUNCTION conciliaciones_proteger();

CREATE FUNCTION conciliacion_partidas_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las marcas de una conciliación no se borran: se desmarcan';
  END IF;
  IF (SELECT estado FROM conciliaciones WHERE id = NEW.conciliacion_id) <> 'abierta' THEN
    RAISE EXCEPTION 'La conciliación ya no está abierta';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER conciliacion_partidas_proteger BEFORE INSERT OR UPDATE OR DELETE ON conciliacion_partidas
  FOR EACH ROW EXECUTE FUNCTION conciliacion_partidas_proteger();

COMMIT;
