begin;

create extension if not exists pgtap;
select no_plan();

select has_function(
  'app_private',
  'register_monitoring_profile',
  array[
    'uuid', 'text', 'text', 'text', 'text', 'text', 'uuid', 'uuid',
    'text', 'uuid', 'timestamp with time zone'
  ],
  'atomic monitoring profile registration function exists'
);
select ok(
  has_function_privilege(
    'app_runtime',
    'app_private.register_monitoring_profile(uuid,text,text,text,text,text,uuid,uuid,text,uuid,timestamptz)',
    'EXECUTE'
  ),
  'API runtime can register a monitoring profile atomically'
);
select ok(
  not has_function_privilege(
    'app_worker',
    'app_private.register_monitoring_profile(uuid,text,text,text,text,text,uuid,uuid,text,uuid,timestamptz)',
    'EXECUTE'
  ),
  'worker cannot register profiles'
);
select ok(
  (
    select prosecdef and proconfig is not null
      from pg_proc
     where oid = 'app_private.register_monitoring_profile(uuid,text,text,text,text,text,uuid,uuid,text,uuid,timestamptz)'::regprocedure
  ),
  'registration is security definer with fixed configuration'
);

insert into app_private.user_accounts (user_id, provider_subject)
values (
  '00000000-0000-7000-8000-000000000031',
  'provider-profile-synthetic'
);
insert into app_private.tenants (
  tenant_id,
  tenant_kind,
  personal_owner_user_id
) values (
  '10000000-0000-7000-8000-000000000031',
  'personal',
  '00000000-0000-7000-8000-000000000031'
);
insert into app_private.tenant_members (
  tenant_id,
  user_id,
  membership_role
) values (
  '10000000-0000-7000-8000-000000000031',
  '00000000-0000-7000-8000-000000000031',
  'owner'
);

set role app_runtime_local;
select set_config(
  'app.current_user_id',
  '00000000-0000-7000-8000-000000000031',
  true
);
select set_config(
  'app.current_tenant_id',
  '10000000-0000-7000-8000-000000000031',
  true
);

select results_eq(
  $$
    select subject_id
      from app_private.register_monitoring_profile(
        '20000000-0000-7000-8000-000000000031',
        'name',
        'P. S.',
        'hmac-sha256:v1:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        'aes-256-gcm:v1:CCCCCCCCCCCCCCCC:AQ:DDDDDDDDDDDDDDDDDDDDDD',
        'v1',
        '30000000-0000-7000-8000-000000000031',
        '50000000-0000-7000-8000-000000000031',
        'djen',
        '70000000-0000-7000-8000-000000000031',
        '2026-08-31T12:00:00Z'
      )
  $$,
  array['20000000-0000-7000-8000-000000000031'::uuid],
  'registration returns the new subject'
);

select lives_ok(
  $$
    select *
      from app_private.register_monitoring_profile(
        '20000000-0000-7000-8000-000000000031',
        'name',
        'P. S.',
        'hmac-sha256:v1:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        'aes-256-gcm:v1:CCCCCCCCCCCCCCCC:AQ:DDDDDDDDDDDDDDDDDDDDDD',
        'v1',
        '30000000-0000-7000-8000-000000000031',
        '50000000-0000-7000-8000-000000000031',
        'djen',
        '70000000-0000-7000-8000-000000000031',
        '2026-08-31T12:00:00Z'
      )
  $$,
  'exact replay is idempotent'
);

reset role;

select is(
  (
    select count(*)
      from app_private.monitored_subjects
     where subject_id = '20000000-0000-7000-8000-000000000031'
  ),
  1::bigint,
  'one subject is persisted'
);
select is(
  (
    select count(*)
      from app_private.monitoring_targets
     where target_id = '30000000-0000-7000-8000-000000000031'
  ),
  1::bigint,
  'one target is persisted'
);
select is(
  (
    select count(*)
      from app_private.subject_targets
     where subject_id = '20000000-0000-7000-8000-000000000031'
       and target_id = '30000000-0000-7000-8000-000000000031'
  ),
  1::bigint,
  'subject and target are linked once'
);
select is(
  (
    select status
      from app_private.target_source_states
     where state_id = '50000000-0000-7000-8000-000000000031'
  ),
  'disabled',
  'unreviewed DJEN source remains disabled'
);
select is(
  (
    select next_attempt_at
      from app_private.target_source_states
     where state_id = '50000000-0000-7000-8000-000000000031'
  ),
  null::timestamptz,
  'disabled source is not scheduled'
);
select is(
  (
    select count(*)
      from app_private.outbox_events
     where event_id = '70000000-0000-7000-8000-000000000031'
  ),
  1::bigint,
  'one outbox event is persisted despite replay'
);
select ok(
  not exists (
    select 1
      from app_private.outbox_events
     where event_id = '70000000-0000-7000-8000-000000000031'
       and (
         payload::text like '%P. S.%'
         or payload::text like '%aes-256-gcm%'
         or payload::text like '%hmac-sha256%'
       )
  ),
  'registration event contains no label, ciphertext or blind index'
);

set role app_runtime_local;
select set_config(
  'app.current_user_id',
  '00000000-0000-7000-8000-000000000099',
  true
);
select set_config(
  'app.current_tenant_id',
  '10000000-0000-7000-8000-000000000031',
  true
);
select throws_ok(
  $$
    select *
      from app_private.register_monitoring_profile(
        '20000000-0000-7000-8000-000000000032',
        'name',
        'O. S.',
        'hmac-sha256:v1:EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
        'aes-256-gcm:v1:EEEEEEEEEEEEEEEE:AQ:FFFFFFFFFFFFFFFFFFFFFF',
        'v1',
        '30000000-0000-7000-8000-000000000032',
        '50000000-0000-7000-8000-000000000032',
        'djen',
        '70000000-0000-7000-8000-000000000032',
        '2026-08-31T12:00:00Z'
      )
  $$,
  '42501',
  'monitoring profile membership denied',
  'membership is revalidated inside the privileged function'
);

reset role;

select is(
  (
    select count(*)
      from app_private.monitored_subjects
     where subject_id = '20000000-0000-7000-8000-000000000032'
  ),
  0::bigint,
  'denied registration leaves no partial subject'
);

select * from finish();
rollback;
