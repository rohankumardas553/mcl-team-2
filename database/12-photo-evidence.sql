-- MineShift Command - 12 PHOTO EVIDENCE (optional photos on exceptions).
--
-- WHAT IT ADDS (all new; nothing existing is changed):
--   * a PRIVATE Supabase Storage bucket "exception-photos" (not public, 5 MB per file, JPEG / PNG / WebP only)
--   * a table exception_photos (one row per photo: which exception, which event, who, when, caption, file path)
--   * one function attach_exception_photo(...) that links an uploaded file to an exception
--   * Storage rules: only signed-in people with an active role may upload, only into the folder of an
--     exception they can see; people who may see an exception may look at its attached photos (the uploader also
--     sees their own file)
--
-- NO CHANGE to the 8 action functions, roles, maker-checker, priority rules, audit or any existing table.
-- No photo is stored in the database itself - only the file path. Photos cannot be edited or deleted
-- from the browser (append-only, like remarks and audit).
-- Overmen never see photos attached to management remarks or reopen events (same rule as remarks / audit).
--
-- WHEN: after 04 and 07 (and 10). Safe to run twice. Runs in one transaction.
-- UNDO: 12-photo-evidence-rollback.sql (turns the feature off; keeps every photo and row).
--
-- AFTER IT RUNS: run the ONE verification table at the bottom of this file (it is the last query);
-- every line must say OK.

begin;

do $$
begin
  if to_regprocedure('public.app_actor()') is null or to_regclass('public.exception_audit') is null then
    raise exception 'Please run 04-auth-foundation.sql first. Nothing was changed.';
  end if;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Supabase Storage is not available in this database. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The private bucket (public = false means every view needs a signed-in person and a short-lived link)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exception-photos', 'exception-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ---------------------------------------------------------------------------
-- 2. The table that says which photo belongs to which exception and event
-- ---------------------------------------------------------------------------
create table if not exists public.exception_photos (
  id            uuid primary key default gen_random_uuid(),
  exception_id  uuid not null,
  event         text not null check (event in ('report', 'remark', 'closure', 'reopen')),
  visibility    text not null default 'operational' check (visibility in ('operational', 'management')),
  path          text not null unique,
  caption       text check (caption is null or char_length(caption) <= 200),
  content_type  text,
  size_bytes    integer,
  added_by      uuid,
  added_by_name text not null,
  added_by_role text not null,
  created_at    timestamptz not null default now()
);
create index if not exists exception_photos_exception_idx on public.exception_photos (exception_id);
alter table public.exception_photos enable row level security;

-- Append-only: nobody edits or deletes a photo record from the browser.
drop trigger if exists exception_photos_no_change on public.exception_photos;
create trigger exception_photos_no_change before update or delete on public.exception_photos
  for each row execute function public.block_history_change();
drop trigger if exists exception_photos_no_truncate on public.exception_photos;
create trigger exception_photos_no_truncate before truncate on public.exception_photos
  for each statement execute function public.block_history_change();

drop policy if exists "role read photos" on public.exception_photos;
create policy "role read photos" on public.exception_photos
  for select to authenticated
  using (
    public.app_rank() >= 1
    and (visibility = 'operational' or public.app_rank() >= 2)
    and exists (select 1 from public.shift_exceptions e where e.id = exception_id)
  );

revoke all on public.exception_photos from public, anon, authenticated;
grant select on public.exception_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The only way to attach a photo. The file must already be uploaded by the same person, into
--    <exception id>/<random id>.jpg|png|webp. The matching action (report, remark, closure request or
--    resolve, reopen) must have been done by the same person in the last 30 minutes.
-- ---------------------------------------------------------------------------
create or replace function public.attach_exception_photo(
  p_exception uuid, p_event text, p_path text, p_caption text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_a public.profiles := public.app_actor();
  v_e public.shift_exceptions;
  v_obj record;
  v_act text;
  v_vis text := 'operational';
  v_cap text := nullif(btrim(coalesce(p_caption, '')), '');
  v_id uuid;
begin
  if p_event not in ('report', 'remark', 'closure', 'reopen') then
    raise exception 'Unknown photo event.'; end if;
  if v_cap is not null and char_length(v_cap) > 200 then
    raise exception 'The photo note can be up to 200 characters.'; end if;
  select * into v_e from public.shift_exceptions where id = p_exception;
  if not found then raise exception 'Exception not found.'; end if;
  if v_a.role = 'overman' and v_e.status = 'Resolved' and v_e.created_by is distinct from v_a.user_id then
    raise exception 'Exception not found.'; end if;
  if p_path !~ ('^' || p_exception::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
    raise exception 'The photo path is not valid.'; end if;
  select o.name, o.metadata into v_obj from storage.objects o
   where o.bucket_id = 'exception-photos' and o.name = p_path and o.owner_id = v_a.user_id::text;
  if not found then
    raise exception 'The photo file was not found. Please upload it again.'; end if;
  if (select count(*) from public.exception_photos where exception_id = p_exception) >= 20 then
    raise exception 'This exception already has 20 photos.'; end if;

  if p_event = 'report' then
    if v_a.role not in ('overman', 'shift_incharge') or v_e.created_by is distinct from v_a.user_id then
      raise exception 'Only the person who reported the exception can add a report photo.'; end if;
    if now() - v_e.created_at > interval '30 minutes' then
      raise exception 'A report photo must be added within 30 minutes of reporting.'; end if;
  else
    select a.action into v_act from public.exception_audit a
     where a.exception_id = p_exception and a.actor_id = v_a.user_id
       and a.created_at > now() - interval '30 minutes'
       and a.action = any (case p_event
             when 'remark'  then array['remark_operational', 'remark_management']
             when 'closure' then array['closure_requested', 'resolved']
             else array['reopened'] end)
     order by a.created_at desc limit 1;
    if v_act is null then
      raise exception 'A % photo can only be added right after you did that action (within 30 minutes).', p_event; end if;
    if v_act = 'remark_management' or p_event = 'reopen' then v_vis := 'management'; end if;
  end if;

  insert into public.exception_photos
    (exception_id, event, visibility, path, caption, content_type, size_bytes, added_by, added_by_name, added_by_role)
  values (p_exception, p_event, v_vis, p_path, v_cap, v_obj.metadata ->> 'mimetype',
          nullif(v_obj.metadata ->> 'size', '')::integer, v_a.user_id, v_a.full_name, v_a.role)
  returning id into v_id;

  perform public._audit(p_exception, 'photo_added', v_a, null, null,
    p_event || ' photo' || coalesce(': ' || left(v_cap, 200), ''));
  return v_id;
end
$$;

revoke all on function public.attach_exception_photo(uuid, text, text, text) from public, anon;
grant execute on function public.attach_exception_photo(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage rules (the files themselves). No update and no delete rule exists, so a file can
--    never be replaced or removed from the browser.
-- ---------------------------------------------------------------------------
drop policy if exists "exception photos upload" on storage.objects;
create policy "exception photos upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'exception-photos'
    and public.app_rank() >= 1
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and exists (select 1 from public.shift_exceptions e where e.id::text = (storage.foldername(name))[1])
  );

drop policy if exists "exception photos view" on storage.objects;
create policy "exception photos view" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exception-photos'
    and (
      owner_id = auth.uid()::text                      -- the uploader sees their own file (Storage needs this right after an upload)
      or exists (select 1 from public.exception_photos p where p.path = name)   -- everybody else: only attached photos they may see
    )
  );

commit;

-- ---------------------------------------------------------------------------
-- 5. ONE verification table (every line must say OK)
-- ---------------------------------------------------------------------------
select check_name, case when ok then 'OK' else 'PROBLEM' end as result
from (
  select 'bucket exists and is PRIVATE' as check_name,
         exists (select 1 from storage.buckets where id = 'exception-photos' and public = false) as ok
  union all select 'bucket size limit is 5 MB',
         exists (select 1 from storage.buckets where id = 'exception-photos' and file_size_limit = 5242880)
  union all select 'bucket allows only JPEG / PNG / WebP',
         exists (select 1 from storage.buckets where id = 'exception-photos'
                 and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
                 and cardinality(allowed_mime_types) = 3)
  union all select 'exception_photos has row level security',
         (select relrowsecurity from pg_class where oid = 'public.exception_photos'::regclass)
  union all select 'signed-out visitors have NO access to exception_photos',
         not has_table_privilege('anon', 'public.exception_photos', 'select')
  union all select 'signed-in users can only SELECT exception_photos',
         has_table_privilege('authenticated', 'public.exception_photos', 'select')
         and not has_table_privilege('authenticated', 'public.exception_photos', 'insert')
         and not has_table_privilege('authenticated', 'public.exception_photos', 'update')
         and not has_table_privilege('authenticated', 'public.exception_photos', 'delete')
  union all select 'signed-out visitors cannot run attach_exception_photo',
         not has_function_privilege('anon', 'public.attach_exception_photo(uuid,text,text,text)', 'execute')
  union all select 'signed-in users can run attach_exception_photo',
         has_function_privilege('authenticated', 'public.attach_exception_photo(uuid,text,text,text)', 'execute')
  union all select 'storage upload rule exists (insert only)',
         exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'exception photos upload' and cmd = 'INSERT')
  union all select 'storage view rule exists (select only)',
         exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'exception photos view' and cmd = 'SELECT')
) t
order by 1;
