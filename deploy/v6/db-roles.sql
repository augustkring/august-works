-- Run as the managed-database bootstrap owner in the application database.
-- Values are identifiers supplied with psql -v app_role=aw_app -v migrator_role=aw_migrator.
-- Passwords belong in the managed secret store and are not handled by this script.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT CONNECT ON DATABASE %I TO %I',current_database(),:'app_role') \gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I',current_database(),:'migrator_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I',:'app_role') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I',:'migrator_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',:'app_role') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',:'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',:'migrator_role',:'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',:'migrator_role',:'app_role') \gexec
-- Extension installation is a bootstrap-owner task; the application does not receive role/admin/DDL permissions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Supply backup_role=aw_backup. Its separate timer can dump content but cannot mutate it.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I',current_database(),:'backup_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I',:'backup_role') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I',:'backup_role') \gexec
SELECT format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',:'backup_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',:'migrator_role',:'backup_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO %I',:'migrator_role',:'backup_role') \gexec
-- Run these grants after first migration as well. The journal must be readable for startup inspection and pg_dump.
SELECT format('GRANT USAGE, CREATE ON SCHEMA drizzle TO %I',:'migrator_role') WHERE EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='drizzle') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA drizzle TO %I',:'migrator_role') WHERE EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='drizzle') \gexec
SELECT format('GRANT USAGE ON SCHEMA drizzle TO %I, %I',:'app_role',:'backup_role') WHERE EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='drizzle') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO %I, %I',:'app_role',:'backup_role') WHERE EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='drizzle') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA drizzle GRANT SELECT ON TABLES TO %I, %I',:'migrator_role',:'app_role',:'backup_role') WHERE EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='drizzle') \gexec
