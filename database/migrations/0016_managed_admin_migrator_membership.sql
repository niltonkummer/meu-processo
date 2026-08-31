begin;

do $$
begin
  execute format(
    'grant app_migrator to %I with inherit true, set true',
    current_user
  );
end
$$;

commit;
