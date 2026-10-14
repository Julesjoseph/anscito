-- ANSCITO 022: el tipo de movimiento de caja admite hasta 20 letras (antes 12),
-- para "compra_reverso" (se anuló una compra pagada en efectivo y el dinero
-- vuelve a la caja). Solo se amplía: ningún dato cambia.
BEGIN;

ALTER TABLE caja_movimientos ALTER COLUMN tipo TYPE varchar(20);

COMMIT;
