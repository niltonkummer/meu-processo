begin;

set role app_migrator;

create function app_private.list_monitored_subject_summaries(
  p_after_subject_id uuid,
  p_limit integer,
  p_include_inactive boolean
)
returns table (
  tenant_id uuid,
  subject_id uuid,
  subject_type text,
  display_label text,
  status text,
  version bigint,
  archived_at timestamptz,
  process_count integer,
  process_summary jsonb
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  current_user_id uuid := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id uuid := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
begin
  if current_user_id is null
     or current_tenant_id is null
     or p_limit not between 1 and 101
     or p_include_inactive is null then
    raise exception 'invalid monitored subject summary request'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from app_private.tenant_members membership
     where membership.tenant_id = current_tenant_id
       and membership.user_id = current_user_id
       and membership.active = true
  ) then
    raise exception 'monitored subject summary membership denied'
      using errcode = '42501';
  end if;

  return query
  with page_subjects as (
    select subject.tenant_id,
           subject.subject_id,
           subject.subject_type,
           subject.display_label,
           subject.status,
           subject.version,
           subject.archived_at
      from app_private.monitored_subjects subject
     where subject.tenant_id = current_tenant_id
       and (p_after_subject_id is null
            or subject.subject_id > p_after_subject_id)
       and (p_include_inactive or subject.status = 'active')
     order by subject.subject_id
     limit p_limit
  ), grouped_cases as (
    select alert.subject_id,
           alert.case_id,
           max(record.cnj_normalized) as cnj_number,
           max(record.tribunal_code) as tribunal,
           max(alert.source_occurred_at) as last_activity_at
      from app_private.alerts alert
      join page_subjects subject
        on subject.tenant_id = alert.tenant_id
       and subject.subject_id = alert.subject_id
      join app_private.case_records record
        on record.tenant_id = alert.tenant_id
       and record.case_id = alert.case_id
     where alert.tenant_id = current_tenant_id
     group by alert.subject_id, alert.case_id
  ), ranked_cases as (
    select grouped.*,
           row_number() over (
             partition by grouped.subject_id
             order by grouped.last_activity_at desc, grouped.case_id
           ) as summary_rank
      from grouped_cases grouped
  ), subject_summaries as (
    select ranked.subject_id,
           count(*)::integer as process_count,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'cnjNumber', ranked.cnj_number,
                 'tribunal', ranked.tribunal,
                 'lastActivityAt', ranked.last_activity_at
               )
               order by ranked.last_activity_at desc, ranked.case_id
             ) filter (where ranked.summary_rank <= 3),
             '[]'::jsonb
           ) as process_summary
      from ranked_cases ranked
     group by ranked.subject_id
  )
  select subject.tenant_id,
         subject.subject_id,
         subject.subject_type,
         subject.display_label,
         subject.status,
         subject.version,
         subject.archived_at,
         coalesce(summary.process_count, 0),
         coalesce(summary.process_summary, '[]'::jsonb)
    from page_subjects subject
    left join subject_summaries summary
      on summary.subject_id = subject.subject_id
   order by subject.subject_id;
end
$$;

revoke all on function app_private.list_monitored_subject_summaries(
  uuid, integer, boolean
) from public;
grant execute on function app_private.list_monitored_subject_summaries(
  uuid, integer, boolean
) to app_runtime;

reset role;

commit;
