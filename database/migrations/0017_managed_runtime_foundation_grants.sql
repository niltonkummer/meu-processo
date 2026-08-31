begin;

set role app_migrator;

grant usage on schema app_private to app_runtime;
grant usage on schema app_public to app_runtime;

grant execute on function app_private.current_user_id() to app_runtime;
grant execute on function app_private.current_tenant_id() to app_runtime;

grant select, insert, update, delete on
  app_private.user_accounts,
  app_private.tenants,
  app_private.tenant_members,
  app_private.monitored_subjects,
  app_private.monitoring_targets,
  app_private.subject_targets
to app_runtime;

reset role;

commit;
