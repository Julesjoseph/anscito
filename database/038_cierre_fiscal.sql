-- ANSCITO 038: fecha de cierre del año fiscal (para los estados financieros).
-- El balance general separa la utilidad del ejercicio (desde el inicio del
-- año fiscal) de las utilidades acumuladas de años anteriores. El dueño no
-- sabe todavía la fecha: queda 31 de diciembre (la más común) hasta que el
-- contador la confirme; se cambia en Contabilidad → Estados financieros.
BEGIN;

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('contabilidad.cierre_fiscal', '12-31',
   'Cierre del año fiscal (MM-DD): 12-31, 03-31, 06-30 o 09-30. Confirmar con el contador')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
