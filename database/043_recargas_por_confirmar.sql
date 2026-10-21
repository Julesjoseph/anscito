-- ANSCITO 043: recargas de billeteras que se confirman al llegar.
-- Decisiones del dueño:
-- * Al transferir pesos (o dólares) a una billetera MonCash / NatCash solo se
--   escribe lo que sale. Las gourdes que llegaron se escriben al CONFIRMAR,
--   cuando se ven en la billetera; ahí se calcula la tasa.
-- * Solo para billeteras: los cambios a dólares en los bancos siguen igual.
-- * Ya no se pregunta "quién hizo el cambio de moneda" (la columna queda
--   para lo ya registrado).
-- Nada se borra ni se pierde: la transferencia sigue inmutable; mientras no
-- llega, monto_entra queda vacío y la llegada se guarda aparte.
BEGIN;

-- Una recarga a billetera se registra sin saber cuántas gourdes entran.
ALTER TABLE transferencias ALTER COLUMN monto_entra DROP NOT NULL;
ALTER TABLE transferencias ADD CONSTRAINT transf_entra_a_cuenta
  CHECK (monto_entra IS NOT NULL OR destino_cuenta_id IS NOT NULL);

-- Lo que pasó con cada recarga pendiente: llegó (con cuánto) o no llegó.
CREATE TABLE transferencia_llegadas (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id  uuid          NOT NULL UNIQUE REFERENCES transferencias(id),
  resultado         varchar(10)   NOT NULL,
  monto_entra       numeric(14,2),                       -- en la moneda de la billetera
  fecha             date,                                -- cuando se vio en la billetera
  movimiento_id     bigint REFERENCES cuenta_movimientos(id), -- la entrada (si llegó)
  motivo            varchar(500),
  usuario_id        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT llegadas_resultado CHECK (resultado IN ('llego', 'no_llego')),
  CONSTRAINT llegadas_llego CHECK ((resultado = 'llego') =
    (monto_entra IS NOT NULL AND monto_entra > 0 AND fecha IS NOT NULL AND movimiento_id IS NOT NULL)),
  CONSTRAINT llegadas_no_llego CHECK (resultado = 'llego' OR motivo IS NOT NULL)
);

CREATE TRIGGER transferencia_llegadas_no_modificar
  BEFORE UPDATE OR DELETE ON transferencia_llegadas
  FOR EACH ROW EXECUTE FUNCTION bancos_inmutables();

COMMIT;
