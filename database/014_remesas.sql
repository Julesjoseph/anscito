-- ANSCITO 014: envíos de dinero a Haití por NatCash / MonCash (remesas):
-- agentes, beneficiarios, tasa y comisión con historial, envíos con estados,
-- entregas diarias de los agentes y pago de sus comisiones.
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Tasa y comisiones. Nunca se editan: cada cambio es una fila nueva con su
-- fecha, y cada envío copia los valores vigentes al registrarse.
CREATE TABLE remesas_tarifas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tasa                 numeric(12,6) NOT NULL,  -- HTG que recibe el beneficiario por 1 RD$
  comision_pct         numeric(5,2)  NOT NULL,  -- comisión que paga el cliente, % del monto
  comision_agente_pct  numeric(5,2)  NOT NULL,  -- parte de esa comisión para el agente autorizado
  vigente_desde        timestamptz   NOT NULL DEFAULT now(),
  motivo               text,
  created_by           uuid REFERENCES usuarios(id),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT remesas_tarifas_tasa CHECK (tasa > 0),
  CONSTRAINT remesas_tarifas_pct CHECK (
    comision_pct BETWEEN 0 AND 100 AND comision_agente_pct BETWEEN 0 AND 100)
);
CREATE INDEX remesas_tarifas_vigente_idx ON remesas_tarifas (vigente_desde DESC);
INSERT INTO remesas_tarifas (tasa, comision_pct, comision_agente_pct, motivo)
VALUES (2.05, 10, 50, 'Valores iniciales (Excel SCITOS SYSTEME 3.0 y decisión del dueño)');

-- Agentes: el punto propio (sin comisión) y los agentes autorizados.
CREATE TABLE remesa_agentes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           varchar(20)  NOT NULL UNIQUE,
  nombre           varchar(120) NOT NULL,
  telefono         varchar(30),
  tipo             varchar(10)  NOT NULL,
  frecuencia_pago  varchar(10),              -- pago de comisiones (solo autorizados)
  grupo_whatsapp   varchar(80),
  notas            text,
  is_active        boolean      NOT NULL DEFAULT true,
  created_by       uuid REFERENCES usuarios(id),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT remesa_agentes_codigo CHECK (codigo ~ '^[A-Z0-9_-]{2,20}$'),
  CONSTRAINT remesa_agentes_tipo CHECK (tipo IN ('propio', 'autorizado')),
  CONSTRAINT remesa_agentes_frecuencia CHECK (
    (tipo = 'propio' AND frecuencia_pago IS NULL) OR
    (tipo = 'autorizado' AND frecuencia_pago IS NOT NULL
      AND frecuencia_pago IN ('semanal', 'quincenal', 'mensual')))
);
CREATE UNIQUE INDEX remesa_agentes_nombre_uq ON remesa_agentes (lower(nombre));

-- Beneficiarios en Haití (el parentesco va en cada envío).
CREATE TABLE beneficiarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      varchar(120) NOT NULL,
  telefono    varchar(30),
  notas       text,
  is_active   boolean      NOT NULL DEFAULT true,
  created_by  uuid REFERENCES usuarios(id),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX beneficiarios_uq ON beneficiarios (lower(nombre), COALESCE(telefono, ''));
CREATE INDEX beneficiarios_telefono_idx ON beneficiarios (telefono);

-- Motivos del envío: lista configurable.
CREATE TABLE motivos_envio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     varchar(30)  NOT NULL UNIQUE,
  nombre     varchar(60)  NOT NULL,
  orden      integer      NOT NULL DEFAULT 0,
  is_active  boolean      NOT NULL DEFAULT true
);
INSERT INTO motivos_envio (codigo, nombre, orden) VALUES
  ('ayuda_familiar', 'Ayuda familiar', 1),
  ('pago',           'Pago',           2),
  ('estudios',       'Estudios',       3),
  ('salud',          'Salud',          4),
  ('negocio',        'Negocio',        5),
  ('otro',           'Otro',           6);

-- Pago de comisiones a un agente (cubre los envíos confirmados del período).
CREATE TABLE remesa_pagos_comision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id   uuid          NOT NULL REFERENCES remesa_agentes(id),
  desde       date          NOT NULL,
  hasta       date          NOT NULL,
  cantidad    integer       NOT NULL,      -- envíos que cubre
  monto       numeric(14,2) NOT NULL,
  forma       varchar(10)   NOT NULL,      -- efectivo (caja) o banco
  referencia  varchar(60),
  usuario_id  uuid          NOT NULL REFERENCES usuarios(id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT remesa_pagos_periodo CHECK (desde <= hasta),
  CONSTRAINT remesa_pagos_monto CHECK (monto > 0 AND cantidad > 0),
  CONSTRAINT remesa_pagos_forma CHECK (forma IN ('efectivo', 'banco'))
);

-- Envíos.
INSERT INTO contadores (clave, valor) VALUES ('remesas', 0);
CREATE TABLE remesas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                 bigint        NOT NULL UNIQUE,
  fecha                  timestamptz   NOT NULL DEFAULT now(),
  origen                 varchar(10)   NOT NULL DEFAULT 'sistema',  -- o 'importado' (historial del Excel)
  agente_id              uuid          NOT NULL REFERENCES remesa_agentes(id),
  remitente_id           uuid REFERENCES terceros(id),
  remitente_nombre       varchar(150)  NOT NULL,   -- copia al momento del envío
  beneficiario_id        uuid REFERENCES beneficiarios(id),
  beneficiario_nombre    varchar(120)  NOT NULL,
  beneficiario_telefono  varchar(30),
  parentesco             varchar(40),
  motivo_envio_id        uuid REFERENCES motivos_envio(id),
  cuenta_id              uuid REFERENCES cuentas(id),  -- billetera HTG de donde salen las gourdes
  monto_enviado          numeric(14,2) NOT NULL,   -- RD$
  tasa                   numeric(12,6) NOT NULL,   -- HTG por 1 RD$
  monto_recibir          numeric(14,2) NOT NULL,   -- HTG
  comision_pct           numeric(5,2)  NOT NULL,
  comision               numeric(14,2) NOT NULL,   -- RD$ que paga el cliente encima
  total_pagar            numeric(14,2) NOT NULL,   -- enviado + comisión
  comision_agente_pct    numeric(5,2)  NOT NULL,   -- 0 en el punto propio
  comision_agente        numeric(14,2) NOT NULL,
  estado                 varchar(12)   NOT NULL DEFAULT 'pendiente',
  codigo_externo         varchar(30) UNIQUE,       -- número de NatCash / MonCash (la prueba)
  resuelto_por           uuid REFERENCES usuarios(id),
  resuelto_en            timestamptz,
  motivo_rechazo         text,
  pago_comision_id       uuid REFERENCES remesa_pagos_comision(id),
  notas                  text,
  registrado_por         uuid          NOT NULL REFERENCES usuarios(id),
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT remesas_origen CHECK (origen IN ('sistema', 'importado')),
  CONSTRAINT remesas_sistema_completo CHECK (origen = 'importado' OR (
    remitente_id IS NOT NULL AND beneficiario_id IS NOT NULL AND cuenta_id IS NOT NULL)),
  CONSTRAINT remesas_estado CHECK (estado IN ('pendiente', 'confirmado', 'rechazado')),
  CONSTRAINT remesas_montos CHECK (monto_enviado > 0 AND tasa > 0 AND monto_recibir > 0
    AND comision >= 0 AND comision_agente >= 0 AND comision_agente <= comision),
  CONSTRAINT remesas_total CHECK (total_pagar = monto_enviado + comision),
  CONSTRAINT remesas_pendiente CHECK (estado <> 'pendiente' OR
    (codigo_externo IS NULL AND resuelto_en IS NULL)),
  CONSTRAINT remesas_confirmado CHECK (estado <> 'confirmado' OR
    (codigo_externo IS NOT NULL AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)),
  CONSTRAINT remesas_rechazado CHECK (estado <> 'rechazado' OR
    (motivo_rechazo IS NOT NULL AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)),
  CONSTRAINT remesas_pago_comision CHECK (pago_comision_id IS NULL OR estado = 'confirmado')
);
CREATE INDEX remesas_agente_idx ON remesas (agente_id, fecha);
CREATE INDEX remesas_estado_idx ON remesas (estado, fecha);
CREATE INDEX remesas_fecha_idx ON remesas (fecha);

-- Entregas diarias de dinero de cada agente (efectivo a la caja o depósito).
CREATE TABLE remesa_entregas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id   uuid          NOT NULL REFERENCES remesa_agentes(id),
  dia         date          NOT NULL,       -- el día de envíos que se entrega
  monto       numeric(14,2) NOT NULL,
  forma       varchar(10)   NOT NULL,       -- efectivo (caja) o deposito (cuenta)
  referencia  varchar(60),
  notas       text,
  usuario_id  uuid          NOT NULL REFERENCES usuarios(id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT remesa_entregas_monto CHECK (monto > 0),
  CONSTRAINT remesa_entregas_forma CHECK (forma IN ('efectivo', 'deposito'))
);
CREATE INDEX remesa_entregas_agente_idx ON remesa_entregas (agente_id, dia);

CREATE FUNCTION remesas_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Este registro de remesas no se puede modificar ni borrar';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER remesas_tarifas_no_modificar BEFORE UPDATE OR DELETE ON remesas_tarifas
  FOR EACH ROW EXECUTE FUNCTION remesas_inmutables();
CREATE TRIGGER remesa_entregas_no_modificar BEFORE UPDATE OR DELETE ON remesa_entregas
  FOR EACH ROW EXECUTE FUNCTION remesas_inmutables();
CREATE TRIGGER remesa_pagos_no_modificar BEFORE UPDATE OR DELETE ON remesa_pagos_comision
  FOR EACH ROW EXECUTE FUNCTION remesas_inmutables();

-- Los envíos no se borran.
CREATE FUNCTION remesas_no_borrar() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los envíos no se pueden borrar';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER remesas_no_borrar BEFORE DELETE ON remesas
  FOR EACH ROW EXECUTE FUNCTION remesas_no_borrar();

-- Caja y cuentas: de qué entrega o pago de comisión viene cada movimiento.
-- (Entregas = "ingreso"; pago de comisión = "gasto"/"pago" con su categoría.)
ALTER TABLE caja_movimientos ADD COLUMN remesa_entrega_id uuid REFERENCES remesa_entregas(id);
ALTER TABLE caja_movimientos ADD COLUMN remesa_pago_id uuid REFERENCES remesa_pagos_comision(id);
ALTER TABLE cuenta_movimientos ADD COLUMN remesa_entrega_id uuid REFERENCES remesa_entregas(id);
ALTER TABLE cuenta_movimientos ADD COLUMN remesa_pago_id uuid REFERENCES remesa_pagos_comision(id);

-- Billetera: las gourdes que salen al confirmar un envío (tipo nuevo "remesa").
-- Se reemplazan tres reglas de 013 para aceptarlo (no se modifica ningún
-- movimiento existente).
ALTER TABLE cuenta_movimientos ADD COLUMN remesa_id uuid UNIQUE REFERENCES remesas(id);
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_tipo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_tipo CHECK (tipo IN (
  'saldo_inicial', 'venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida',
  'pago', 'cargo', 'interes', 'ingreso', 'reverso',
  'remesa'                  -- gourdes enviadas a un beneficiario (resta)
));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_signo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_signo CHECK (
  (tipo IN ('saldo_inicial', 'venta', 'transferencia_entrada', 'interes', 'ingreso') AND signo = 1) OR
  (tipo IN ('devolucion', 'transferencia_salida', 'pago', 'cargo', 'remesa') AND signo = -1) OR
  (tipo = 'reverso' AND signo IN (1, -1)));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_motivo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida', 'remesa')
  OR motivo IS NOT NULL);
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_remesa CHECK (
  (tipo = 'remesa') = (remesa_id IS NOT NULL));

-- Corrección de 013: una cuenta de banco sin tipo (NULL) pasaba la regla.
-- Las cuentas existentes ya la cumplen (el servidor siempre lo exigió).
ALTER TABLE cuentas DROP CONSTRAINT cuentas_tipo_cuenta;
ALTER TABLE cuentas ADD CONSTRAINT cuentas_tipo_cuenta CHECK (
  (tipo = 'banco' AND tipo_cuenta IS NOT NULL AND tipo_cuenta IN ('corriente', 'ahorro')) OR
  (tipo = 'billetera' AND tipo_cuenta IS NULL));

-- Configuración y categoría para el pago de comisiones.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('remesas.documento_desde', '0.00',
   'Monto enviado (RD$) a partir del cual se exige el documento del remitente (0 = siempre)');
INSERT INTO categorias_gasto (codigo, nombre, orden) VALUES
  ('comisiones_agentes', 'Comisiones de agentes de envíos', 11);

-- Permisos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('remesas.ver',        'remesas', 'ver',        'Ver envíos, agentes y beneficiarios'),
  ('remesas.registrar',  'remesas', 'registrar',  'Registrar envíos (quedan pendientes)'),
  ('remesas.confirmar',  'remesas', 'confirmar',  'Confirmar o rechazar envíos (operador en Haití)'),
  ('remesas.entregas',   'remesas', 'entregas',   'Ver lo que debe cada agente y registrar sus entregas'),
  ('remesas.comisiones', 'remesas', 'comisiones', 'Pagar comisiones a los agentes'),
  ('remesas.gestionar',  'remesas', 'gestionar',  'Crear y editar agentes, beneficiarios y motivos'),
  ('remesas.tarifas',    'remesas', 'tarifas',    'Cambiar la tasa y las comisiones');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'remesas'
WHERE r.codigo = 'administrador';

-- Roles de los operadores (se pueden ajustar en Roles y permisos).
INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('operador_envios_rd', 'Operador de envíos (RD)',
   'Registra envíos, recibe las entregas de los agentes'),
  ('operador_envios_haiti', 'Operador de envíos (Haití)',
   'Ve los envíos pendientes y los confirma o rechaza');
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo IN
  ('remesas.ver', 'remesas.registrar', 'remesas.entregas', 'clientes.ver', 'clientes.crear')
WHERE r.codigo = 'operador_envios_rd';
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo IN
  ('remesas.ver', 'remesas.confirmar')
WHERE r.codigo = 'operador_envios_haiti';

COMMIT;
