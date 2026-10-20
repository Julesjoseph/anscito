-- ANSCITO 040: cada cuenta de banco o billetera con su propia cuenta contable.
-- Decisión del dueño: se numera con el siguiente código libre bajo 1101
-- (Efectivo y equivalentes): 110109, 110110… Así el saldo de cada banco se
-- ve por separado en la contabilidad y la conciliación lo compara.
-- * Las cuentas que hoy usan una cuenta compartida (110104 a 110107) o
--   ninguna reciben la suya. Lo ya registrado se queda en la compartida.
-- * Desde ahora, Bancos crea la cuenta contable al crear la cuenta.
-- Cada cambio deja su registro en la auditoría (accion 'migracion.040').
-- Si se vuelve a ejecutar, no cambia nada.
BEGIN;

DO $$
DECLARE
  padre uuid;
  r record;
  siguiente bigint;
  nueva uuid;
  anterior text;
BEGIN
  SELECT id INTO padre FROM cuentas_contables WHERE codigo = '1101' FOR UPDATE;
  IF padre IS NULL THEN
    RAISE NOTICE 'No existe la cuenta 1101: no se hace nada';
    RETURN;
  END IF;
  FOR r IN
    SELECT ct.id, ct.nombre, ct.tipo, ct.moneda, cc.codigo AS codigo_actual
    FROM cuentas ct LEFT JOIN cuentas_contables cc ON cc.id = ct.cuenta_contable_id
    WHERE ct.cuenta_contable_id IS NULL OR cc.codigo IN ('110104', '110105', '110106', '110107')
    ORDER BY ct.created_at, ct.id
  LOOP
    SELECT GREATEST(COALESCE(max(codigo::bigint), 110108), 110108) + 1 INTO siguiente
    FROM cuentas_contables WHERE padre_id = padre AND codigo ~ '^1101[0-9]{2}$';
    IF siguiente > 110199 THEN
      RAISE EXCEPTION 'No quedan códigos libres bajo 1101';
    END IF;
    INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
    VALUES (siguiente::text,
            left(CASE WHEN r.tipo = 'billetera' THEN 'Billetera: ' ELSE 'Banco: ' END || r.nombre || ' (' || r.moneda || ')', 150),
            'activo', 'deudora', padre, 4, true,
            'Creada para la cuenta "' || r.nombre || '" de Bancos (migración 040)')
    RETURNING id INTO nueva;
    UPDATE cuentas SET cuenta_contable_id = nueva, updated_at = now() WHERE id = r.id;
    anterior := r.codigo_actual;
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
    VALUES (NULL, 'migracion.040', 'cuentas', r.id::text,
            jsonb_build_object('cuenta_contable', anterior),
            jsonb_build_object('cuenta', r.nombre, 'cuenta_contable', siguiente::text),
            'Migración 040: cuenta contable propia para cada cuenta de banco (decisión del dueño)');
  END LOOP;
END $$;

COMMIT;
