-- SCRATCH ONLY: rich historical demo data for analytics tests. Never run on the live project.
select setseed(0.31);
create temp table combos(cat text, issue text);
insert into combos values
 ('Coal Despatch','Coal shortage'),('Coal Despatch','Tipper shortage'),('Coal Despatch','Loader breakdown'),('Coal Despatch','Siding congestion'),('Coal Despatch','Weighbridge delay'),('Coal Despatch','Haul-road delay'),('Coal Despatch','Weather'),('Coal Despatch','Other'),
 ('Dust Suppression','Water tanker required'),('Dust Suppression','Water tanker unavailable'),('Dust Suppression','Fog cannon required'),('Dust Suppression','Heavy dust'),('Dust Suppression','Sprinkling required'),('Dust Suppression','Other'),
 ('Haul Road','Potholes'),('Haul Road','Slippery road'),('Haul Road','Waterlogging'),('Haul Road','Grader required'),('Haul Road','Dozer required'),('Haul Road','Water tanker required'),('Haul Road','Other'),
 ('Coal Quality','Shale or band contamination'),('Coal Quality','Mixed coal'),('Coal Quality','Grade concern'),('Coal Quality','Segregation required'),('Coal Quality','Other');
create temp table src as
 select g, random() r_ts, random() r_sh, random() r_loc, random() r_combo, random() r_imp, random() r_pri, random() r_st, random() r_t1, random() r_t2
 from generate_series(1,2300) g;
insert into public.shift_exceptions (created_at, shift, location, category, issue_type, description, impact_minutes, urgency, status)
select now() - ((power(r_ts,1.4) * 400)::numeric * interval '1 day') - (r_t1 * interval '20 hours'),
       (array['First','Second','Night'])[1+floor(r_sh*3)::int],
       (array['ABC Patch','XYZ Patch','Haul Road A','Haul Road B','MDP Junction','Stockyard 1','Siding 1','Siding 2'])[1+floor(power(r_loc,1.6)*8)::int],
       c.cat, c.issue, 'hist '||g, (5 + floor(r_imp*295))::int,
       (array['Low','Medium','High'])[1+floor(r_pri*3)::int], 'Open'
from src s, lateral (select cat, issue from (select cat, issue, row_number() over (order by cat, issue) rn from combos) x
                     where rn = 1 + floor(power(s.r_combo,1.5)*26)::int) c;
-- lifecycle: ~30% still Open, ~15% In progress, ~55% Resolved
update public.shift_exceptions e set
  status = case when s.r_st < .30 then 'Open' when s.r_st < .45 then 'In progress' else 'Resolved' end,
  started_at = case when s.r_st >= .30 then e.created_at + (1 + s.r_t1*300) * interval '1 minute' end,
  resolved_at = case when s.r_st >= .45 then e.created_at + (1 + s.r_t1*300) * interval '1 minute' + (5 + s.r_t2*2000) * interval '1 minute' end
from src s where e.description = 'hist '||s.g;
-- priority changes: ~10% of rows get a different current priority + an audit line
update public.shift_exceptions e set current_priority = case current_priority when 'High' then 'Medium' else 'High' end,
       urgency = case current_priority when 'High' then 'Medium' else 'High' end,
       priority_changed_at = now(), priority_changed_by_role = 'manager', priority_changed_by_name = 'Scratch'
from src s where e.description = 'hist '||s.g and s.r_pri < .10;
insert into public.exception_audit (exception_id, action, actor_name, actor_role, old_value, new_value, note, created_at)
select e.id, 'priority_changed', 'Scratch', 'manager', 'x', e.current_priority, 'scratch data', e.created_at + interval '30 minutes'
from public.shift_exceptions e join src s on e.description = 'hist '||s.g where s.r_pri < .10;
-- reopened: ~8% of Resolved rows once, ~2% twice (only Resolved-at-some-point records)
insert into public.exception_audit (exception_id, action, actor_name, actor_role, old_value, new_value, note, created_at)
select e.id, 'reopened', 'Scratch', 'shift_incharge', 'Resolved', 'Open', 'scratch data', e.created_at + interval '1 day'
from public.shift_exceptions e join src s on e.description = 'hist '||s.g where s.r_st >= .45 and s.r_t2 < .08;
insert into public.exception_audit (exception_id, action, actor_name, actor_role, old_value, new_value, note, created_at)
select e.id, 'reopened', 'Scratch', 'manager', 'Resolved', 'Open', 'scratch data second', e.created_at + interval '3 days'
from public.shift_exceptions e join src s on e.description = 'hist '||s.g where s.r_st >= .45 and s.r_t2 < .02;
