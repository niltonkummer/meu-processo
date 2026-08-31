# Migrations

SQL migrations are executed in lexical order against a new local database.
They must be forward-only, transactional where PostgreSQL permits, and paired
with tested local reset/rollback instructions. No secret or production data is
allowed in this directory.

`database/bootstrap/00_apply_local_migrations.sql` is the explicit manifest for
the local image. Adding a migration requires adding it there in the same lexical
order and exercising both a fresh database and the restore drill.

Current order:

1. `0001_foundation.sql`
2. `0002_operational_persistence.sql`
3. `0003_protected_identifiers.sql`
4. `0004_monitoring_worker.sql`
5. `0005_case_evidence.sql`
6. `0006_outbox_dispatcher.sql`
7. `0007_internal_alerts.sql`
8. `0008_case_timeline.sql`
9. `0009_document_catalog.sql`
10. `0010_document_delivery.sql`
11. `0011_document_materialization.sql`
12. `0012_tenant_data_lifecycle.sql`
13. `0013_tenant_lifecycle_worker_projection.sql`
14. `0014_account_data_controls.sql`
15. `0015_document_download_window_monotonicity.sql`
16. `0016_managed_admin_migrator_membership.sql`
17. `0017_managed_runtime_foundation_grants.sql`
18. `0018_managed_runtime_operational_grants.sql`
19. `0019_managed_pgcrypto_schema.sql`
