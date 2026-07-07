-- Runs once on first container start: create the runtime role.
-- wola_app: no SUPERUSER, no BYPASSRLS, no CREATEDB. Grants come from migrations.
CREATE ROLE wola_app LOGIN PASSWORD 'app_dev';
