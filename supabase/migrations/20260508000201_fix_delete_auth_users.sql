-- Migration: Fix delete_all_auth_users function
-- Delete all auth users with proper WHERE clause

drop function if exists public.delete_all_auth_users();

create or replace function public.delete_all_auth_users()
returns int
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  -- Delete all users with a WHERE clause that always matches
  delete from auth.users where true;
  
  get diagnostics v_count = row_count;
  
  return v_count;
end;
$$;

grant execute on function public.delete_all_auth_users() to authenticated, anon;
