-- =============================================================================
-- 11-demo-shift-label-cleanup-rollback.sql
--
--   PRESENTATION DATA ONLY. Puts back the ORIGINAL shift labels that 11-demo-shift-label-cleanup.sql changed.
--
-- Only rows listed in public.demo_shift_label_backup (demo rows that 11 corrected) are restored, and only if
-- they still carry the label 11 gave them. Nothing else changes. The backup table is kept (tables are never
-- dropped); its rows are marked as restored. Safe to run twice.
-- =============================================================================
begin;

-- If 11 was never run the table does not exist yet; create it empty so this file simply finds nothing to restore.
create table if not exists public.demo_shift_label_backup (
  exception_id uuid primary key, old_shift text not null, new_shift text not null,
  changed_at timestamptz not null default now(), restored_at timestamptz);
alter table public.demo_shift_label_backup enable row level security;
revoke all on public.demo_shift_label_backup from public, anon, authenticated;

select set_config('app.skip_touch', '1', true);
update public.shift_exceptions e
   set shift = b.old_shift
  from public.demo_shift_label_backup b
 where b.exception_id = e.id
   and b.restored_at is null
   and e.shift = b.new_shift
   and position('[DEMO-2026-PRESENTATION]' in e.description) = 1;

update public.demo_shift_label_backup set restored_at = now() where restored_at is null;

commit;

-- Read-only: how many demo rows have a label that does not match their India time again (the original state).
select count(*) as demo_rows_with_original_label_mismatch
from public.shift_exceptions
where position('[DEMO-2026-PRESENTATION]' in description) = 1 and shift is distinct from public.ist_shift(created_at);
