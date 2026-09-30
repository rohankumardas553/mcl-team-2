-- MineShift Command - demo rows for the new categories Haul Road and Coal Quality.
-- No table change is needed: the same shift_exceptions table and columns are used.
-- Only adds fictional rows. Nothing is dropped, deleted or changed.
-- A row is added only if the same description does not exist yet,
-- so running this again will not create duplicates.

insert into public.shift_exceptions
  (created_at, shift, location, category, issue_type, description, impact_minutes, urgency, status, resolved_at)
select now() - v.ago, v.shift, v.location, v.category, v.issue_type,
       v.description, v.impact_minutes, v.urgency, v.status,
       case when v.status = 'Resolved' then now() - v.ago + interval '2 hours' end
from (values
  (interval '5 hours',  'First',  'Haul Road A', 'Haul Road',    'Potholes',                    'Demo: Deep potholes on Haul Road A, grader required.',        70, 'High',   'Open'),
  (interval '4 hours',  'Second', 'Haul Road B', 'Haul Road',    'Waterlogging',                'Demo: Water standing on Haul Road B, dozer required.',        90, 'High',   'In progress'),
  (interval '3 hours',  'Night',  'Junction A',  'Haul Road',    'Slippery road',               'Demo: Slippery surface at Junction A, water tanker needed.',  40, 'Medium', 'Open'),
  (interval '2 days',   'First',  'Haul Road A', 'Haul Road',    'Berm issue',                  'Demo: Broken berm on Haul Road A repaired.',                  25, 'Low',    'Resolved'),
  (interval '6 hours',  'First',  'Coal Face A', 'Coal Quality', 'Shale or band contamination', 'Demo: Shale band mixed into coal at Coal Face A.',            110, 'High',   'Open'),
  (interval '5 hours',  'Second', 'Coal Face B', 'Coal Quality', 'Mixed coal',                  'Demo: Different grades mixed at Coal Face B.',                 65, 'Medium', 'Open'),
  (interval '3 hours',  'Night',  'Siding A',    'Coal Quality', 'Grade concern',               'Demo: Grade concern on rake loading at Siding A.',             80, 'High',   'In progress'),
  (interval '2 hours',  'Night',  'Siding B',    'Coal Quality', 'Segregation required',        'Demo: Stones to be segregated at Siding B before loading.',    35, 'Low',    'Open')
) as v(ago, shift, location, category, issue_type, description, impact_minutes, urgency, status)
where not exists (
  select 1 from public.shift_exceptions e where e.description = v.description
);
