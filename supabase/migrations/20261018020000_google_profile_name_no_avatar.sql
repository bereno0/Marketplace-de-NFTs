create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_display_name text;
begin
  profile_display_name := left(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Colecionador'
    ),
    40
  );
  if char_length(profile_display_name) < 2 then
    profile_display_name := 'Colecionador';
  end if;

  insert into public.profiles (user_id, display_name)
  values (new.id, profile_display_name);
  return new;
end;
$$;
