-- SCRATCH ONLY. psql -v N=.. -v HR=.. -v NIGHT=..   Exactly N exceptions in total (demo rows removed first).
delete from public.shift_exceptions;
select setseed(0.42);
create temp table combos(cat text, issue text);
insert into combos values ('Coal Despatch','Coal shortage'),('Coal Despatch','Weather'),('Coal Despatch','Tipper shortage'),
 ('Dust Suppression','Heavy dust'),('Dust Suppression','Fog cannon required'),('Coal Quality','Mixed coal'),('Coal Quality','Grade concern'),('Haul Road','Potholes');
create temp table src as select g, random() r_ts, random() r_loc, random() r_imp, random() r_pri, random() r_st, random() r_t1, random() r_t2 from generate_series(1,:N) g;
insert into public.shift_exceptions (created_at, shift, location, category, issue_type, description, impact_minutes, urgency, status)
select now() - (r_ts * 60 * interval '1 day') - (r_t1 * interval '5 hours'),
       case when g <= :NIGHT then 'Night' when g % 2 = 0 then 'First' else 'Second' end,
       (array['ABC Patch','XYZ Patch','Haul Road A','Haul Road B','MDP Junction','Stockyard 1','Siding 1','Siding 2'])[1+floor(r_loc*8)::int],
       case when g <= :HR then 'Haul Road' else (array['Coal Despatch','Dust Suppression','Coal Quality'])[1+(g % 3)] end,
       case when g <= :HR then 'Potholes' else (select issue from combos c where c.cat = case when g <= :HR then 'Haul Road' else (array['Coal Despatch','Dust Suppression','Coal Quality'])[1+(g % 3)] end order by issue offset (g % 2) limit 1) end,
       'ds '||g, (5 + floor(r_imp*295))::int, (array['Low','Medium','High'])[1+floor(r_pri*3)::int], 'Open'
from src;
update public.shift_exceptions e set
  status = case when s.r_st < .40 then 'Open' when s.r_st < .60 then 'In progress' else 'Resolved' end,
  started_at = case when s.r_st >= .40 then e.created_at + (1 + s.r_t1*100) * interval '1 minute' end,
  resolved_at = case when s.r_st >= .60 then e.created_at + (200 + s.r_t2*300) * interval '1 minute' end
from src s where e.description = 'ds '||s.g;
-- current priority differs from reported priority for ~15% (so the current-priority logic is really tested)
update public.shift_exceptions e set current_priority = case current_priority when 'High' then 'Low' when 'Low' then 'High' else 'High' end,
       urgency = case current_priority when 'High' then 'Low' when 'Low' then 'High' else 'High' end,
       priority_changed_at = now(), priority_changed_by_role = 'manager', priority_changed_by_name = 'Scratch'
from src s where e.description = 'ds '||s.g and s.r_pri < .15;
-- remarks: 1205 (more than the 1000 a single read can return); the very last one has a marker
insert into public.exception_remarks (exception_id, kind, body, author_name, author_role, created_at)
select e.id, 'operational', 'scratch remark '||row_number() over (order by e.created_at), 'Scratch', 'shift_incharge', now() - interval '3 days' + (row_number() over (order by e.created_at)) * interval '1 second'
from (select id, created_at from public.shift_exceptions order by created_at limit least(1205, :N)) e;
insert into public.exception_remarks (exception_id, kind, body, author_name, author_role, created_at)
select id, 'operational', 'LAST-REMARK-MARKER', 'Scratch', 'shift_incharge', now() from public.shift_exceptions order by created_at limit 1;
