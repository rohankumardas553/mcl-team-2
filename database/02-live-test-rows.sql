-- MineShift Command - live test rows. Safe to run more than once.
-- Adds 6 fictional exceptions dated "now" so you can Start and Resolve them
-- in front of the team. Nothing is dropped or deleted. Rows already added
-- by this script are skipped (matched by description).

insert into public.shift_exceptions
  (created_at, shift, location, category, issue_type, description, impact_minutes, urgency, status)
select now() - v.ago, v.shift, v.location, v.category, v.issue_type,
       v.description, v.impact_minutes, v.urgency, 'Open'
from (values
  (interval '2 minutes',  'First',  'Siding A',    'Coal Despatch',    'Siding congestion',        'Live test: Two rakes waiting at Siding A.',           80, 'High'),
  (interval '4 minutes',  'First',  'Haul Road A', 'Dust Suppression', 'Heavy dust',               'Live test: Thick dust on Haul Road A near the turn.', 60, 'High'),
  (interval '6 minutes',  'Second', 'Stockyard A', 'Coal Despatch',    'Loader breakdown',         'Live test: Loader stopped at Stockyard A.',          120, 'Medium'),
  (interval '8 minutes',  'Second', 'Coal Face B', 'Dust Suppression', 'Water tanker unavailable', 'Live test: No tanker available at Coal Face B.',     45, 'Medium'),
  (interval '10 minutes', 'Night',  'Siding B',    'Coal Despatch',    'Weighbridge delay',        'Live test: Weighbridge slow, trucks in a line.',      30, 'Low'),
  (interval '12 minutes', 'Night',  'Junction A',  'Dust Suppression', 'Sprinkling required',      'Live test: Junction A dry, sprinkling needed.',       20, 'Low')
) as v(ago, shift, location, category, issue_type, description, impact_minutes, urgency)
where not exists (
  select 1 from public.shift_exceptions e where e.description = v.description
);
