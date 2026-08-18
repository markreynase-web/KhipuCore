-- Permite borrar una empresa DE VERDAD desde Super Admin (antes solo se
-- podía desactivar -- empresas.activo). Todas las tablas de datos de negocio
-- se crearon referenciando empresas(id) SIN ON DELETE CASCADE a propósito:
-- así, mientras el borrado de una empresa no era una función real del
-- sistema, ningún bug de código podía arrastrar el borrado accidental de
-- todos sus datos. Ahora que el borrado es una acción explícita y deliberada
-- (ver DELETE /superadmin/empresas/:id en routes/superadmin.js, protegida
-- por requireSuperAdmin + confirmación del nombre exacto de la empresa), se
-- necesita CASCADE real: sin esto, `DELETE FROM empresas` falla con un error
-- de foreign key apenas la empresa tiene una sola fila en cualquier módulo.
--
-- Se usa un DO block con un loop en vez de 33 ALTER TABLE repetidos a mano
-- -- mismo resultado, menos superficie para un typo en un nombre de tabla o
-- de constraint. Todos los nombres de constraint siguen el patrón por
-- defecto de Postgres (<tabla>_empresa_id_fkey), porque ninguna de las
-- migraciones anteriores les puso un nombre explícito.
--
-- Es seguro correr esta migración más de una vez: DROP + ADD CONSTRAINT con
-- el mismo nombre deja el mismo estado final, mismo criterio que el resto de
-- /migrations (ver src/migrate.js: no hay tabla de control, se re-aplican
-- todas en cada corrida).
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'agenda','atenciones_veterinarias','clientes','comandas','combo_ventas','combos',
    'compras','conductores','control_documentario','empleados','finanzas','flota',
    'inventario','mascotas','membresias','mesas','ordenes_laboratorio','ordenes_produccion',
    'pagos_membresia','planes_membresia','planes_tratamiento','planes_veterinarios',
    'postventa','recetas_opticas','repuestos','rutas','seguros_dentales','seguros_mascotas',
    'seguros_vision','tratamientos','turnos','vehiculos','ventas'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, t || '_empresa_id_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE',
      t, t || '_empresa_id_fkey'
    );
  END LOOP;
END $$;

-- audit_log es la única excepción a propósito: es un registro histórico, no
-- un dato operativo de la empresa -- interesa que sobreviva (con empresa_id
-- en NULL) a que desaparezca junto con la empresa que borró. Por eso
-- necesita SET NULL en vez de CASCADE, lo que a su vez exige que la columna
-- deje de ser NOT NULL (era NOT NULL desde 012_empresas.sql).
ALTER TABLE audit_log ALTER COLUMN empresa_id DROP NOT NULL;
ALTER TABLE audit_log DROP CONSTRAINT audit_log_empresa_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_empresa_id_fkey
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE SET NULL;
