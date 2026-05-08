-- Migration: Add delete_all_auth_users function
-- This function allows deleting all auth users for testing purposes

create or replace function public.delete_all_auth_users()
returns table(deleted_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from auth.users where id is not null;
  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

grant execute on function public.delete_all_auth_users() to authenticated, anon;
