-- ANSCITO 031: el origen de un asiento automático puede ser una operación con
-- número (los movimientos de caja se numeran 1, 2, 3…) y no solo con uuid.
-- Se cambia origen_id de uuid a texto: un uuid se guarda igual como texto,
-- no se pierde nada. PostgreSQL reconstruye solo los índices de la columna.
BEGIN;

ALTER TABLE asientos ALTER COLUMN origen_id TYPE varchar(40) USING origen_id::text;
ALTER TABLE contabilidad_pendientes ALTER COLUMN origen_id TYPE varchar(40) USING origen_id::text;

COMMIT;
