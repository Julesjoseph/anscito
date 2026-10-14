-- ANSCITO 026: código de cliente y ficha de SOL CASH más flexible.
-- 1) Cada cliente tiene un código SCITO-1801 + 4 cifras en orden
--    (SCITO-18010001, SCITO-18010002…). Lo pone la base de datos al crear
--    el cliente, venga de donde venga (Clientes, Facturación, SOL CASH).
--    Los clientes que ya existen lo reciben en el orden en que se registraron.
--    "Consumidor final" no lleva código. Alcanza para 9,999 clientes.
-- 2) SOL CASH: la fecha de nacimiento de la ficha es opcional.
BEGIN;

ALTER TABLE terceros ADD COLUMN codigo varchar(14);
ALTER TABLE terceros ADD CONSTRAINT terceros_codigo_formato
  CHECK (codigo IS NULL OR (rol = 'cliente' AND codigo ~ '^SCITO-1801[0-9]{4}$'));
CREATE UNIQUE INDEX terceros_codigo_uq ON terceros (codigo) WHERE codigo IS NOT NULL;

CREATE SEQUENCE terceros_codigo_cliente_seq MINVALUE 1 MAXVALUE 9999 NO CYCLE;

-- Clientes que ya existen, en el orden en que se registraron.
UPDATE terceros t SET codigo = 'SCITO-1801' || lpad(x.n::text, 4, '0')
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
      FROM terceros WHERE rol = 'cliente' AND NOT es_protegido) x
WHERE t.id = x.id;
SELECT setval('terceros_codigo_cliente_seq',
  GREATEST((SELECT count(*) FROM terceros WHERE codigo IS NOT NULL), 1),
  (SELECT count(*) FROM terceros WHERE codigo IS NOT NULL) > 0);

-- Cliente nuevo: recibe el siguiente código. El código no se cambia después.
CREATE FUNCTION terceros_codigo_cliente() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.rol = 'cliente' AND NOT NEW.es_protegido THEN
      NEW.codigo := 'SCITO-1801' || lpad(nextval('terceros_codigo_cliente_seq')::text, 4, '0');
    ELSE
      NEW.codigo := NULL;
    END IF;
  ELSIF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'El código del cliente no se cambia';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER terceros_codigo_cliente BEFORE INSERT OR UPDATE ON terceros
  FOR EACH ROW EXECUTE FUNCTION terceros_codigo_cliente();

-- SOL CASH: fecha de nacimiento opcional (si se pone, se sigue validando).
ALTER TABLE san_fichas ALTER COLUMN fecha_nacimiento DROP NOT NULL;

COMMIT;
