-- MineShift Command - 12 ROLLBACK: turns photo evidence OFF.
-- It removes the upload / view rules and the attach function and takes read access away.
-- It DELETES NOTHING: the bucket, every photo file, every exception_photos row and every audit line stay.
-- To turn the feature on again, run 12-photo-evidence.sql.
begin;
drop policy if exists "exception photos upload" on storage.objects;
drop policy if exists "exception photos view" on storage.objects;
drop function if exists public.attach_exception_photo(uuid, text, text, text);
revoke all on public.exception_photos from public, anon, authenticated;
drop policy if exists "role read photos" on public.exception_photos;
commit;
select 'Photo evidence is switched off. Photos and records were kept.' as result;
