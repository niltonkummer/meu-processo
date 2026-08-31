begin;

set role app_migrator;

grant select on app_private.sources to app_runtime;
grant select, insert, update, delete
  on app_private.target_source_states
  to app_runtime;

reset role;

commit;
