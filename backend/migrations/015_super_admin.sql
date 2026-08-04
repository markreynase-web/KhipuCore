-- Panel de super administrador. Un super admin gestiona la plataforma
-- entera (empresas, sus módulos habilitados, su primer administrador) --
-- lo opuesto de todo el sistema roles/permisos/usuario_empresa, que está
-- armado alrededor de "una empresa a la vez". Por eso es una bandera
-- global en usuarios, no un rol más dentro de ese sistema.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_super_admin BOOLEAN NOT NULL DEFAULT false;
