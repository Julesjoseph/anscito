-- ANSCITO 002: auditoría
BEGIN;

CREATE TABLE auditoria (
  id              bigserial PRIMARY KEY,
  usuario_id      uuid REFERENCES usuarios(id),
  accion          varchar(60) NOT NULL,
  entidad         varchar(60) NOT NULL,
  entidad_id      varchar(60),
  valor_anterior  jsonb,
  valor_nuevo     jsonb,
  motivo          text,
  ip              varchar(64),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auditoria_entidad_idx ON auditoria (entidad, entidad_id);
CREATE INDEX auditoria_usuario_idx ON auditoria (usuario_id, created_at DESC);
CREATE INDEX auditoria_fecha_idx   ON auditoria (created_at DESC);

-- Los registros de auditoría no se pueden modificar ni borrar.
CREATE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no se puede modificar ni borrar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_no_modificar
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

COMMIT;