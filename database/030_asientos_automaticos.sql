-- ANSCITO 030: asientos automáticos (parte 2a de Contabilidad).
-- * Reglas: cada "papel" (caja en RD$, clientes, ventas de servicios, ITBIS
--   cobrado…) apunta a una cuenta del catálogo. El contador las cambia desde
--   la pantalla; el programa no tiene cuentas fijas.
-- * Cada categoría de gasto, cada tipo de gasto 606 y cada cuenta de banco o
--   billetera apunta a su cuenta contable (sugerida; editable).
-- * Servicios "por cuenta de un tercero": solo la comisión es ingreso; el
--   resto se le debe al tercero.
-- * Cada asiento automático sabe de qué operación viene (origen_tabla,
--   origen_id). Si una operación no se puede contabilizar (falta una cuenta,
--   mes cerrado…), la operación se guarda igual y queda en "pendientes".
-- Todo sugerido: pendiente de validar por el contador.
BEGIN;

-- Cuentas nuevas propuestas (servicios por cuenta de terceros).
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
SELECT '210204', 'Cobros por cuenta de terceros (servicios)', 'pasivo', 'acreedora', id, 4, true,
       'Propuesta para servicios cobrados por cuenta de un tercero: pendiente de validar por el contador'
FROM cuentas_contables WHERE codigo = '2102';
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
SELECT '410204', 'Comisiones por servicios de terceros', 'ingreso', 'acreedora', id, 4, true,
       'Propuesta para servicios cobrados por cuenta de un tercero: pendiente de validar por el contador'
FROM cuentas_contables WHERE codigo = '4102';

-- ---------- Reglas ----------
CREATE TABLE contabilidad_reglas (
  clave        varchar(40)  PRIMARY KEY,
  nombre       varchar(120) NOT NULL,
  descripcion  varchar(300) NOT NULL,
  orden        int          NOT NULL,
  cuenta_id    uuid         NOT NULL REFERENCES cuentas_contables(id),
  updated_by   uuid REFERENCES usuarios(id),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO contabilidad_reglas (clave, nombre, descripcion, orden, cuenta_id)
SELECT r.clave, r.nombre, r.descripcion, r.orden, c.id
FROM (VALUES
  ('caja_rd',             'Caja en pesos',                  'Efectivo en RD$ de todas las cajas',                                 1,  '110101'),
  ('caja_usd',            'Caja en dólares',                'Efectivo en US$ de las cajas (por su valor en RD$)',                 2,  '110102'),
  ('banco_rd',            'Bancos en pesos (si la cuenta no tiene la suya)', 'Cuenta de banco en RD$ sin cuenta contable propia', 3, '110104'),
  ('banco_usd',           'Bancos en dólares (si la cuenta no tiene la suya)', 'Cuenta de banco en US$ sin cuenta contable propia', 4, '110106'),
  ('billetera',           'Billeteras (si la cuenta no tiene la suya)', 'MonCash / NatCash sin cuenta contable propia',         5,  '110107'),
  ('clientes',            'Clientes (ventas a crédito)',    'Lo que deben los clientes por ventas a crédito',                     10, '110201'),
  ('agentes_envios',      'Agentes de envíos por cobrar',   'Lo que cobran los agentes de SCITO TRANSFER y deben entregar',       11, '110202'),
  ('inventario',          'Inventario de mercancías',       'Productos comprados y vendidos (costo promedio)',                    12, '110301'),
  ('itbis_compras',       'ITBIS pagado en compras',        'ITBIS de las facturas de compra (adelantado)',                       13, '110401'),
  ('proveedores',         'Proveedores',                    'Lo que se les debe a los proveedores',                               20, '210101'),
  ('otras_cxp',           'Otras cuentas por pagar',        'Comisiones por pagar a agentes y otras deudas',                      21, '210102'),
  ('sol_cash_cuotas',     'SOL CASH: cuotas por entregar',  'Dinero de los participantes (no es ingreso)',                        22, '210201'),
  ('envios_por_pagar',    'Envíos por pagar',               'Dinero de envíos a Haití por entregar (no es ingreso)',              23, '210202'),
  ('terceros_servicios',  'Cobros por cuenta de terceros',  'Parte de un servicio que se le debe a un tercero (no es ingreso)',   24, '210204'),
  ('itbis_ventas',        'ITBIS cobrado en ventas',        'ITBIS de las ventas',                                                25, '210301'),
  ('itbis_retenido',      'ITBIS retenido a proveedores',   'ITBIS retenido en compras, por pagar a la DGII',                     26, '210302'),
  ('isr_retenido',        'ISR retenido a proveedores',     'ISR retenido en compras, por pagar a la DGII',                       27, '210303'),
  ('capital',             'Capital aportado',               'Ingresos a la caja marcados como aporte del dueño',                  30, '310101'),
  ('retiros_dueno',       'Retiros del dueño',              'Retiros de la caja marcados como retiro del dueño',                  31, '310102'),
  ('prestamos_recibidos', 'Préstamos recibidos',            'Ingresos a la caja marcados como préstamo recibido',                 32, '210501'),
  ('ventas_mercancias',   'Ventas de mercancías',           'Base de los productos vendidos',                                     40, '410101'),
  ('ventas_servicios',    'Ventas de servicios',            'Base de los servicios propios vendidos',                             41, '410102'),
  ('comision_envios',     'Comisiones por envíos',          'Comisión de SCITO TRANSFER',                                         42, '410201'),
  ('comision_sol_cash',   'Comisiones de SOL CASH',         'Comisión que se descuenta de la mano',                               43, '410202'),
  ('comision_terceros',   'Comisiones por servicios de terceros', 'Comisión de los servicios cobrados por cuenta de un tercero', 44, '410204'),
  ('recargos',            'Recargos por atraso',            'Recargos cobrados en Cuentas por cobrar',                            45, '420101'),
  ('moras_sol_cash',      'Moras de SOL CASH',              'Moras cobradas en SOL CASH',                                         46, '420102'),
  ('intereses_ganados',   'Intereses ganados',              'Intereses del banco',                                                47, '420103'),
  ('otros_ingresos',      'Otros ingresos',                 'Sobrantes de caja y redondeo a favor (cobros en US$)',               48, '420105'),
  ('costo_mercancias',    'Costo de mercancías vendidas',   'Costo de los productos vendidos',                                    50, '510101'),
  ('comision_agentes',    'Comisiones pagadas a agentes',   'Parte de la comisión de los agentes autorizados',                    51, '510103'),
  ('otros_gastos',        'Otros gastos',                   'Faltantes de caja, redondeo en contra y gastos sin cuenta',          60, '610214'),
  ('cargos_bancarios',    'Comisiones y cargos bancarios',  'Cargos del banco',                                                   61, '610301'),
  ('comision_cambio',     'Comisiones por cambio de moneda','Costo de cambiar moneda',                                            62, '610302')
) AS r(clave, nombre, descripcion, orden, codigo)
JOIN cuentas_contables c ON c.codigo = r.codigo;

-- Una regla apunta a una cuenta de detalle activa.
CREATE FUNCTION contabilidad_regla_cuenta() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuentas_contables WHERE id = NEW.cuenta_id AND acepta_movimientos AND is_active) THEN
    RAISE EXCEPTION 'La cuenta de la regla debe aceptar movimientos y estar activa';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER contabilidad_reglas_cuenta BEFORE INSERT OR UPDATE ON contabilidad_reglas
  FOR EACH ROW EXECUTE FUNCTION contabilidad_regla_cuenta();

-- ---------- Cuenta contable de cada categoría, tipo 606 y banco ----------
ALTER TABLE categorias_gasto ADD CONSTRAINT categorias_gasto_cuenta_contable
  FOREIGN KEY (cuenta_contable_id) REFERENCES cuentas_contables(id);
UPDATE categorias_gasto g SET cuenta_contable_id = c.id
FROM (VALUES
  ('compras_menores', '610209'), ('transporte', '610205'), ('alimentacion', '610206'),
  ('limpieza', '610207'), ('mantenimiento', '610208'), ('otros', '610214'),
  ('alquiler', '610201'), ('servicios_basicos', '610204'), ('compra_mercancia', '510101'),
  ('comision_cambio', '610302'), ('comisiones_agentes', '510103')
) AS m(codigo, cuenta) JOIN cuentas_contables c ON c.codigo = m.cuenta
WHERE g.codigo = m.codigo;

ALTER TABLE tipos_gasto ADD COLUMN cuenta_contable_id uuid REFERENCES cuentas_contables(id);
UPDATE tipos_gasto t SET cuenta_contable_id = c.id
FROM (VALUES
  ('01', '610101'), ('02', '610214'), ('03', '610201'), ('04', '610208'), ('05', '610214'),
  ('06', '610214'), ('07', '610301'), ('08', '610214'), ('09', '510101'), ('10', '120101'),
  ('11', '610212')
) AS m(codigo, cuenta) JOIN cuentas_contables c ON c.codigo = m.cuenta
WHERE t.codigo = m.codigo;

ALTER TABLE cuentas ADD CONSTRAINT cuentas_cuenta_contable
  FOREIGN KEY (cuenta_contable_id) REFERENCES cuentas_contables(id);
UPDATE cuentas ct SET cuenta_contable_id = c.id
FROM cuentas_contables c
WHERE ct.cuenta_contable_id IS NULL AND c.codigo = CASE
  WHEN ct.tipo = 'billetera' THEN '110107'
  WHEN ct.moneda = 'USD' THEN '110106'
  WHEN ct.tipo_cuenta = 'ahorro' THEN '110105'
  ELSE '110104' END;

-- ---------- Clase de los ingresos y retiros de caja ----------
-- El cajero dice qué fue: aporte del dueño, préstamo recibido o retiro del
-- dueño; "otro" queda en pendientes para que el contador escoja la cuenta.
-- Los movimientos anteriores quedan sin clase (son de antes de la contabilidad).
ALTER TABLE caja_movimientos ADD COLUMN clase varchar(12);
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_clase CHECK (clase IS NULL
  OR (tipo = 'ingreso' AND clase IN ('aporte', 'prestamo', 'otro'))
  OR (tipo = 'retiro' AND clase IN ('retiro_dueno', 'otro')));
ALTER TABLE caja_movimientos_usd ADD COLUMN clase varchar(12);
ALTER TABLE caja_movimientos_usd ADD CONSTRAINT caja_usd_clase CHECK (clase IS NULL
  OR (tipo = 'ingreso' AND clase IN ('aporte', 'prestamo', 'otro'))
  OR (tipo = 'retiro' AND clase IN ('retiro_dueno', 'otro')));

-- ---------- Servicios por cuenta de un tercero ----------
ALTER TABLE servicios ADD COLUMN por_cuenta_tercero boolean NOT NULL DEFAULT false;
ALTER TABLE servicios ADD CONSTRAINT servicios_tercero_con_comision
  CHECK (NOT por_cuenta_tercero OR ganancia_tipo = 'comision');
-- La venta recuerda si la línea era por cuenta de un tercero.
ALTER TABLE venta_lineas ADD COLUMN por_cuenta_tercero boolean NOT NULL DEFAULT false;

-- ---------- Origen de los asientos automáticos y pendientes ----------
ALTER TABLE asientos ADD COLUMN origen_tabla varchar(30);
ALTER TABLE asientos ADD COLUMN origen_id uuid;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_completo
  CHECK ((origen_tabla IS NULL) = (origen_id IS NULL));
CREATE INDEX asientos_origen_idx ON asientos (origen_tabla, origen_id);
-- Una operación tiene a lo sumo un asiento automático vigente (no se
-- contabiliza dos veces); después de anularlo se puede volver a contabilizar.
CREATE UNIQUE INDEX asientos_origen_unico ON asientos (origen_tabla, origen_id)
  WHERE origen_tabla IS NOT NULL AND reverso_de IS NULL AND estado = 'activo';

CREATE TABLE contabilidad_pendientes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origen_tabla  varchar(30)  NOT NULL,
  origen_id     uuid         NOT NULL,
  documento     varchar(40),
  fecha         date         NOT NULL,
  error         varchar(500) NOT NULL,
  estado        varchar(10)  NOT NULL DEFAULT 'pendiente',   -- pendiente | resuelto | descartado
  resuelto_por  uuid REFERENCES usuarios(id),
  resuelto_en   timestamptz,
  nota          varchar(300),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT contabilidad_pendientes_estado CHECK (estado IN ('pendiente', 'resuelto', 'descartado')),
  -- Descartar a mano lleva quién y por qué (resolver al contabilizar, quién lo reintentó).
  CONSTRAINT contabilidad_pendientes_cierre CHECK (estado = 'pendiente' OR resuelto_en IS NOT NULL),
  CONSTRAINT contabilidad_pendientes_descarte CHECK (estado <> 'descartado' OR (resuelto_por IS NOT NULL AND nota IS NOT NULL))
);
CREATE UNIQUE INDEX contabilidad_pendientes_uno ON contabilidad_pendientes (origen_tabla, origen_id)
  WHERE estado = 'pendiente';

COMMIT;
