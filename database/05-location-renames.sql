-- MineShift Command - 05 Controlled location rename.
--
-- Replaces the old fictional location names with the new operational names on EXISTING
-- records. Only the location field changes. Nothing is deleted, and no other field is
-- touched (updated_at is deliberately left as it was). Safe to run more than once: the
-- second run finds nothing to rename.
--
--   Coal Face A  -> ABC Patch        Junction A   -> MDP Junction
--   Coal Face B  -> XYZ Patch        Stockyard A  -> Stockyard 1
--   Siding A     -> Siding 1         Siding B     -> Siding 2
--   Haul Road A and Haul Road B stay as they are.
--
-- ORDER: run 04-auth-foundation.sql first (this file writes one history line per renamed
-- record, so the change is visible in the audit trail).
--
-- NOTE: 01-setup.sql, 02-live-test-rows.sql and 03-new-category-demo-rows.sql still use the
-- old names. If you have NOT run one of them yet, run it BEFORE this file (this file then
-- renames its rows too). Do not run them again after this file.
--
-- Until the Phase B pages are live, the current public pages still list the old names in
-- their Location dropdowns.

begin;

do $$
begin
  if to_regclass('public.exception_audit') is null then
    raise exception 'Please run 04-auth-foundation.sql first.';
  end if;
end $$;

-- Keep updated_at exactly as it was on the renamed records.
select set_config('app.skip_touch', '1', true);

with renames(old_name, new_name) as (
  values ('Coal Face A', 'ABC Patch'),
         ('Coal Face B', 'XYZ Patch'),
         ('Junction A',  'MDP Junction'),
         ('Stockyard A', 'Stockyard 1'),
         ('Siding A',    'Siding 1'),
         ('Siding B',    'Siding 2')
),
changed as (
  update public.shift_exceptions e
     set location = r.new_name
    from renames r
   where e.location = r.old_name
  returning e.id, r.old_name, r.new_name
)
insert into public.exception_audit (exception_id, action, actor_name, actor_role, old_value, new_value, note)
select c.id, 'location_renamed', 'System', 'system', c.old_name, c.new_name,
       'Controlled location rename (05-location-renames.sql). The record itself is unchanged.'
from changed c;

commit;

-- Check (read-only): how many records use each location now.
select location, count(*) as records
from public.shift_exceptions
group by location
order by location;
