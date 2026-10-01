-- =============================================================================
-- 11-demo-shift-label-cleanup.sql
--
--   PRESENTATION DATA CLEANUP ONLY.  Do NOT run this on real pilot data.
--
-- The fictional presentation data (09-presentation-demo-data.sql) has some rows whose shift label
-- does not match the India time of created_at (for example a row created at 10:14 IST labelled Night).
-- This file corrects ONLY those labels, ONLY on rows that carry the demo marker
-- [DEMO-2026-PRESENTATION] at the start of the description. The correct shift is worked out from
-- created_at in Asia/Kolkata (05:00-13:00 First, 13:00-21:00 Second, 21:00-05:00 Night).
--
-- Safe and deterministic:
--   * rows without the marker are never touched (manual entries and real pilot data are safe)
--   * only the shift column of a mismatched demo row changes; created_at, updated_at, status, impact,
--     priority, description and every other field stay exactly as they are
--   * the original label of every corrected row is kept in public.demo_shift_label_backup, so
--     11-demo-shift-label-cleanup-rollback.sql can restore it exactly
--   * safe to run twice (the second run finds nothing to correct)
-- Needs 04 (or 10) first: it uses the database's ist_shift() function. Run it in the Supabase SQL Editor.
-- NOT run automatically by anything.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.ist_shift(timestamptz)') is null then
    raise exception 'ist_shift() does not exist. Run 10-ist-shift-control.sql first.';
  end if;
end $$;

-- One small internal table for the original labels. Row level security ON, no access for browser users.
create table if not exists public.demo_shift_label_backup (
  exception_id uuid primary key,
  old_shift    text not null,
  new_shift    text not null,
  changed_at   timestamptz not null default now(),
  restored_at  timestamptz
);
alter table public.demo_shift_label_backup enable row level security;
revoke all on public.demo_shift_label_backup from public, anon, authenticated;

-- 1. Remember the original label of every mismatched DEMO row (a row restored earlier by the rollback is re-armed).
insert into public.demo_shift_label_backup (exception_id, old_shift, new_shift)
select e.id, e.shift, public.ist_shift(e.created_at)
from public.shift_exceptions e
where position('[DEMO-2026-PRESENTATION]' in e.description) = 1
  and e.shift is distinct from public.ist_shift(e.created_at)
on conflict (exception_id) do update
   set old_shift = excluded.old_shift, new_shift = excluded.new_shift, changed_at = now(), restored_at = null
 where public.demo_shift_label_backup.restored_at is not null;

-- 2. Correct the shift label (and nothing else). app.skip_touch keeps updated_at as it was.
select set_config('app.skip_touch', '1', true);
update public.shift_exceptions e
   set shift = public.ist_shift(e.created_at)
 where position('[DEMO-2026-PRESENTATION]' in e.description) = 1
   and e.shift is distinct from public.ist_shift(e.created_at);

commit;

-- Verification summary (read-only).
select
  (select count(*) from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) = 1)
    as demo_rows_inspected,
  (select count(*) from public.demo_shift_label_backup where restored_at is null)
    + (select count(*) from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) = 1
                                                      and shift is distinct from public.ist_shift(created_at))
    as mismatches_before_cleanup,
  (select count(*) from public.demo_shift_label_backup where restored_at is null)
    as rows_corrected,
  (select count(*) from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) = 1
                                                  and shift is distinct from public.ist_shift(created_at))
    as mismatches_remaining;
