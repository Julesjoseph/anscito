-- ANSCITO 007: inventario, parte 2 (entradas, salidas y ajustes por conteo)
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Nuevos tipos de movimiento. Solo se amplía la lista permitida; ningún
-- movimiento existente cambia. ('venta' llegará con el módulo de Ventas.)
ALTER TABLE movimientos_inventario DROP CONSTRAINT movimientos_tipo;
ALTER TABLE movimientos_inventario
  ADD CONSTRAINT movimientos_tipo CHECK (tipo IN (
    'inicial',        -- existencia al registrar el producto
    'entrada',        -- mercancía recibida (compra)
    'salida',         -- daño, vencido, consumo interno, devolución…
    'ajuste_entrada', -- conteo físico: había más de lo registrado
    'ajuste_salida'   -- conteo físico: había menos de lo registrado
  ));

ALTER TABLE movimientos_inventario
  -- Por qué salió la mercancía (solo en salidas).
  ADD COLUMN causa varchar(30),
  -- Proveedor de una entrada (texto, hasta que exista el módulo Proveedores).
  ADD COLUMN proveedor varchar(150),
  -- Costo promedio del producto después del movimiento (para el kárdex).
  ADD COLUMN costo_promedio numeric(14,2),
  ADD CONSTRAINT movimientos_causa_valida CHECK (causa IS NULL OR causa IN (
    'dano', 'vencido', 'consumo_interno', 'devolucion_proveedor', 'otro')),
  ADD CONSTRAINT movimientos_salida_con_causa
    CHECK (tipo <> 'salida' OR causa IS NOT NULL),
  ADD CONSTRAINT movimientos_costo_promedio_no_negativo
    CHECK (costo_promedio IS NULL OR costo_promedio >= 0);

CREATE INDEX movimientos_tipo_idx ON movimientos_inventario (tipo, created_at);

-- Permisos nuevos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('inventario.entradas', 'inventario', 'entradas', 'Registrar entradas de mercancía'),
  ('inventario.salidas',  'inventario', 'salidas',  'Registrar salidas (daños, vencidos, consumo…)'),
  ('inventario.ajustar',  'inventario', 'ajustar',  'Ajustar existencias por conteo físico');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo IN
  ('inventario.entradas', 'inventario.salidas', 'inventario.ajustar')
WHERE r.codigo = 'administrador';

COMMIT;
