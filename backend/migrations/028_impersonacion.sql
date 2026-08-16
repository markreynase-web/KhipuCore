-- Impersonación con auditoría: el super admin puede "entrar" a una empresa
-- como soporte técnico para diagnosticar un problema, sin necesitar la
-- contraseña de nadie de esa empresa. Decisión de identidad (ver charla
-- aparte): el super admin conserva SU PROPIA identidad en el JWT (id/nombre
-- reales), no toma prestada la de un admin real de la empresa -- así
-- audit_log nunca queda diciendo que una acción de soporte la hizo el
-- cliente. La columna de abajo es lo único que hace falta para eso: cada
-- fila de audit_log ya guarda usuario_id/usuario_nombre (que durante una
-- sesión de impersonación SON los del super admin, no de nadie de la
-- empresa); via_impersonacion solo marca que esa acción pasó durante una
-- sesión así, para poder filtrarla/distinguirla en la UI (ver
-- routes/registroAuditoria.js y pages/auditoria.html).
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS via_impersonacion BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_audit_log_via_impersonacion ON audit_log (via_impersonacion) WHERE via_impersonacion = true;
