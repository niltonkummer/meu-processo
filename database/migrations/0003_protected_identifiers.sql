begin;

set role app_migrator;

alter table app_private.monitored_subjects
  add column encrypted_value text not null default 'legacy:v0:unavailable',
  add column key_version text not null default 'legacy';

alter table app_private.monitored_subjects
  alter column encrypted_value drop default,
  alter column key_version drop default,
  add constraint monitored_subjects_protection_check check (
    (
      key_version = 'legacy'
      and encrypted_value = 'legacy:v0:unavailable'
    )
    or (
      key_version ~ '^v[1-9][0-9]*$'
      and protected_reference ~ '^hmac-sha256:v[1-9][0-9]*:[A-Za-z0-9_-]{43}$'
      and encrypted_value ~ (
        '^aes-256-gcm:' || key_version ||
        ':[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$'
      )
    )
  );

reset role;

commit;
