begin;

reset role;

grant usage on schema extensions to app_migrator;

set role app_migrator;

do $migration$
declare
  function_oid oid;
  definition text;
begin
  foreach function_oid in array array[
    'app_private.project_internal_alerts(uuid,uuid,text,uuid,jsonb,timestamptz)'::regprocedure::oid,
    'app_private.project_internal_alerts_without_timeline(uuid,uuid,text,uuid,jsonb,timestamptz)'::regprocedure::oid
  ] loop
    select pg_get_functiondef(function_oid) into strict definition;
    execute replace(definition, 'public.digest', 'extensions.digest');
  end loop;
end
$migration$;

reset role;

commit;
