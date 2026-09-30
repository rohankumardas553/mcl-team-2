-- =============================================================================
-- MineShift Command - 09: PRESENTATION DEMO DATA (workshop / demo only)
-- =============================================================================
-- WHAT THIS IS
--   About 800 FICTIONAL shift exceptions spread over 180 fixed calendar days
--   (2026-04-04 to 2026-09-30), with matching audit history and remarks, so the
--   Analytics page and its Forecast Readiness section can be demonstrated.
--   Nothing here is real. There are no real people, contractors, places of work,
--   production, safety, despatch or quality figures.
--
-- THE MARKER
--   Every demo exception has the text  [DEMO-2026-PRESENTATION]  at the start of its
--   description. 09-presentation-demo-data-rollback.sql removes exactly those
--   exceptions (and their own audit lines and remarks) and nothing else.
--
-- SAFETY
--   * One transaction. If any check at the end fails, everything is rolled back.
--   * Adds rows only. It never updates, deletes or overwrites an existing row, and it
--     changes no table, column, policy, grant or function.
--   * Repeatable: every row has a fixed, calculated id and is inserted with
--     "on conflict (id) do nothing", so running this file again adds nothing.
--   * Deterministic: no random(), no now(). The same file always gives the same rows.
--     (To move the whole data set to other dates, change the two dates in section 1.)
--   * Needs 04-auth-foundation.sql (and normally 05, 06, 07, 08) to have been run.
--   * Run it in the Supabase SQL Editor as the project owner. Do NOT run it before the
--     workshop has been approved; the Data Keeper decides.
--
-- WHO DID WHAT
--   Staff names and ids are looked up from the 8 fictional test accounts
--   (overman1, overman2, sic1, sic2, manager1, manager2, po1, gm1 at example.com) that
--   04-auth-foundation.sql links. No id is typed in here. If an account does not exist,
--   the id is left empty and a "Demo ..." name is used instead. No auth user is created.
--
-- HOW THE DATA FOLLOWS THE APP'S OWN RULES
--   * Status Open / In progress / Resolved; shifts First / Second / Night; the 8 real
--     locations; only issue types that the entry page allows for each category.
--   * reported_priority is the priority at creation and is never changed. current_priority
--     (and urgency, its compatibility copy) follow the priority changes.
--   * The audit lines use only the actions the app already writes: created, started,
--     closure_requested, resolved, reopened, priority_changed, remark_operational,
--     remark_management. A reopened exception has its first cycle in the audit, then a
--     'reopened' line, then a second cycle. Its current fields show the current cycle only
--     (the analytics limitation that earlier cycles are not reconstructed still applies).
--   * Maker-checker: the person who requested a closure is never the one who confirms it.
--   * Priority changes respect the rank lock (a change is made by the same or a higher rank).
-- =============================================================================

begin;

-- The app's own functions set this flag so that a direct insert does not add a
-- "Direct entry" audit line or re-sync the priority columns. We write the audit lines
-- ourselves, below. (Transaction-local: it ends with this transaction.)
select set_config('app.in_rpc', '1', true);
select set_config('app.skip_touch', '1', true);

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.shift_exceptions') is null
     or to_regclass('public.exception_audit') is null
     or to_regclass('public.exception_remarks') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Tables are missing. Run 04-auth-foundation.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'shift_exceptions'
                   and column_name = 'reported_priority') then
    raise exception 'The 04 columns are missing. Run 04-auth-foundation.sql first.';
  end if;
end $$;

-- A small, deterministic "random" number between 0 and 1 from a text key (md5 based).
-- It lives only in this session (pg_temp) and is dropped at the end.
create function pg_temp.u(k text) returns double precision
language sql immutable as $$
  select (('x' || substr(md5(k), 1, 8))::bit(32)::bigint)::double precision / 4294967296.0
$$;

-- ---------------------------------------------------------------------------
-- 1. Parameters (fixed dates)
-- ---------------------------------------------------------------------------
create temp table demo_p on commit drop as
select date '2026-09-30'                                   as end_date,
       date '2026-09-30' - 179                              as start_date,        -- 180 days
       (timestamp '2026-10-01 00:00') at time zone 'Asia/Kolkata' as as_of,        -- the demo "now"
       '[DEMO-2026-PRESENTATION]'::text                     as marker;

-- ---------------------------------------------------------------------------
-- 2. The fictional staff (looked up, never invented)
-- ---------------------------------------------------------------------------
create temp table demo_actor on commit drop as
select s.slot, p.user_id, coalesce(p.full_name, s.fallback) as name, s.role
from (values
  ('ov1',  'overman1@example.com', 'overman',         'Demo Overman 1'),
  ('ov2',  'overman2@example.com', 'overman',         'Demo Overman 2'),
  ('sic1', 'sic1@example.com',     'shift_incharge',  'Demo Shift In-Charge 1'),
  ('sic2', 'sic2@example.com',     'shift_incharge',  'Demo Shift In-Charge 2'),
  ('mgr1', 'manager1@example.com', 'manager',         'Demo Manager 1'),
  ('mgr2', 'manager2@example.com', 'manager',         'Demo Manager 2'),
  ('po',   'po1@example.com',      'project_officer', 'Demo Project Officer'),
  ('gm',   'gm1@example.com',      'general_manager', 'Demo General Manager')
) as s(slot, email, role, fallback)
left join auth.users u on lower(u.email) = s.email
left join public.profiles p on p.user_id = u.id and p.role = s.role and p.active;

-- ---------------------------------------------------------------------------
-- 3. How many exceptions per category and day
--    (fixed target per category, weekday pattern, seasons: dust is higher in the dry
--     months, haul-road problems are higher in the monsoon months)
-- ---------------------------------------------------------------------------
create temp table demo_day on commit drop as
select g::date as day, (row_number() over (order by g))::int as dn,
       extract(isodow from g)::int as dow, extract(month from g)::int as mon
from demo_p p, generate_series(p.start_date::timestamp, p.end_date::timestamp, interval '1 day') g;

create temp table demo_target(cat text primary key, target numeric) on commit drop;
insert into demo_target values ('Coal Despatch', 265), ('Haul Road', 215), ('Dust Suppression', 175), ('Coal Quality', 145);

create temp table demo_rate on commit drop as
select c.cat, d.day, d.dn,
       c.target * f.raw / sum(f.raw) over (partition by c.cat) as lam
from demo_target c
cross join demo_day d
cross join lateral (
  select (case when d.dow <= 5 then 1.08 when d.dow = 6 then 0.85 else 0.68 end) *
         (case c.cat
            when 'Coal Despatch'    then 0.92 + 0.16 * d.dn / 180.0
            when 'Dust Suppression' then case d.mon when 4 then 1.5 when 5 then 1.6 when 6 then 1.15
                                                     when 7 then 0.6 when 8 then 0.55 else 0.7 end
            when 'Haul Road'        then case d.mon when 4 then 0.8 when 5 then 0.85 when 6 then 1.0
                                                     when 7 then 1.4 when 8 then 1.5 else 1.25 end
            else 1.0
          end) as raw
) f;

create temp table demo_r0 on commit drop as
select (row_number() over (order by n.day, n.cat, k.k))::int as sq, n.cat, n.day, n.dn
from (select cat, day, dn, floor(lam + pg_temp.u('n|' || cat || '|' || day))::int as n from demo_rate) n,
     lateral generate_series(1, n.n) k(k)
where n.n > 0;

-- ---------------------------------------------------------------------------
-- 4. Locations and issue types (only values the app already allows)
-- ---------------------------------------------------------------------------
create temp table demo_locw(cat text, loc text, w numeric, ord int) on commit drop;
insert into demo_locw values
  ('Coal Despatch','Stockyard 1',30,1), ('Coal Despatch','Siding 1',25,2), ('Coal Despatch','Siding 2',20,3),
  ('Coal Despatch','ABC Patch',10,4), ('Coal Despatch','XYZ Patch',9,5),
  ('Coal Despatch','Haul Road A',2,6), ('Coal Despatch','Haul Road B',2,7), ('Coal Despatch','MDP Junction',2,8),
  ('Dust Suppression','Haul Road A',26,1), ('Dust Suppression','Haul Road B',22,2), ('Dust Suppression','MDP Junction',22,3),
  ('Dust Suppression','ABC Patch',13,4), ('Dust Suppression','XYZ Patch',12,5),
  ('Dust Suppression','Stockyard 1',2,6), ('Dust Suppression','Siding 1',2,7), ('Dust Suppression','Siding 2',1,8),
  ('Haul Road','Haul Road A',28,1), ('Haul Road','Haul Road B',26,2), ('Haul Road','MDP Junction',20,3),
  ('Haul Road','ABC Patch',11,4), ('Haul Road','XYZ Patch',11,5),
  ('Haul Road','Stockyard 1',2,6), ('Haul Road','Siding 1',1,7), ('Haul Road','Siding 2',1,8),
  ('Coal Quality','ABC Patch',28,1), ('Coal Quality','XYZ Patch',24,2), ('Coal Quality','Stockyard 1',20,3),
  ('Coal Quality','Siding 1',16,4), ('Coal Quality','Siding 2',9,5),
  ('Coal Quality','Haul Road A',1,6), ('Coal Quality','Haul Road B',1,7), ('Coal Quality','MDP Junction',1,8);

create temp table demo_locr on commit drop as
select cat, loc,
       (sum(w) over (partition by cat order by ord) - w) / sum(w) over (partition by cat) as lo,
       sum(w) over (partition by cat order by ord) / sum(w) over (partition by cat)       as hi
from demo_locw;

-- issue type, weight in the dry and wet months, typical impact minutes, short description
create temp table demo_iss0(cat text, issue text, w_dry numeric, w_wet numeric, base int, phrase text, ord int) on commit drop;
insert into demo_iss0 values
  ('Coal Despatch','Coal shortage',22,22,70,'coal stock short for the scheduled loading.',1),
  ('Coal Despatch','Tipper shortage',18,18,45,'tipper availability below the despatch requirement.',2),
  ('Coal Despatch','Loader breakdown',16,16,85,'loader stopped and loading slowed down.',3),
  ('Coal Despatch','Siding congestion',18,18,60,'rake placement delayed by congestion at the siding.',4),
  ('Coal Despatch','Weighbridge delay',10,10,25,'queue at the weighbridge delaying despatch.',5),
  ('Coal Despatch','Haul-road delay',8,12,40,'slow tipper movement on the approach road.',6),
  ('Coal Despatch','Weather',4,10,50,'rain interrupting loading for a while.',7),
  ('Coal Despatch','Other',4,4,20,'minor despatch hold-up recorded by the shift.',8),
  ('Dust Suppression','Water tanker required',24,24,30,'dust rising, water tanker needed on the stretch.',1),
  ('Dust Suppression','Water tanker unavailable',16,16,55,'tanker not available, road dusty.',2),
  ('Dust Suppression','Fog cannon required',12,12,30,'fog cannon needed near the loading area.',3),
  ('Dust Suppression','Fog cannon unavailable',10,10,50,'fog cannon out of service, dust not controlled.',4),
  ('Dust Suppression','Heavy dust',20,20,40,'heavy dust affecting visibility for operators.',5),
  ('Dust Suppression','Sprinkling required',14,14,20,'dry surface, extra sprinkling requested.',6),
  ('Dust Suppression','Other',4,4,15,'minor dust-control matter noted by the shift.',7),
  ('Haul Road','Potholes',16,18,35,'potholes affecting loaded-tipper movement.',1),
  ('Haul Road','Slippery road',6,16,40,'slippery surface slowing tippers.',2),
  ('Haul Road','Waterlogging',5,18,75,'water standing on the road surface.',3),
  ('Haul Road','Poor road surface',10,10,30,'rough surface, vehicles moving slowly.',4),
  ('Haul Road','Berm issue',8,8,25,'berm damaged along one side of the road.',5),
  ('Haul Road','Drainage problem',6,12,50,'side drain blocked after use.',6),
  ('Haul Road','Grader required',12,12,30,'grader needed to level the road.',7),
  ('Haul Road','Dozer required',8,8,45,'dozer needed to clear spilled material.',8),
  ('Haul Road','Water tanker required',6,1,15,'road surface dry, water tanker needed.',9),
  ('Haul Road','Traffic congestion',9,9,35,'queue of tippers at the junction.',10),
  ('Haul Road','Poor visibility',6,8,30,'visibility low for vehicles on the stretch.',11),
  ('Haul Road','Other',4,4,15,'minor haul-road matter noted by the shift.',12),
  ('Coal Quality','Shale or band contamination',14,14,55,'shale band seen in the loaded material.',1),
  ('Coal Quality','Stone contamination',10,10,50,'stone found in the coal at the loading point.',2),
  ('Coal Quality','Oversize coal',9,9,35,'oversize pieces in the loading stock.',3),
  ('Coal Quality','Mixed coal',13,13,45,'different grades mixed in one stack.',4),
  ('Coal Quality','Excess moisture',10,20,40,'coal moisture higher than usual at loading.',5),
  ('Coal Quality','Grade concern',12,12,60,'grade of the material questioned by the shift.',6),
  ('Coal Quality','Face quality issue',8,8,50,'face material of uneven quality.',7),
  ('Coal Quality','Siding quality issue',7,7,45,'quality concern noted at the siding.',8),
  ('Coal Quality','Segregation required',9,9,30,'material needs to be segregated before loading.',9),
  ('Coal Quality','Rehandling required',8,8,50,'stack needs rehandling before despatch.',10),
  ('Coal Quality','Sampling concern',6,6,20,'sampling point needs to be rechecked.',11),
  ('Coal Quality','Other',3,3,15,'minor quality matter noted by the shift.',12);

create temp table demo_issr on commit drop as
select s.season, i.cat, i.issue, i.base, i.phrase,
       (sum(case s.season when 'wet' then i.w_wet else i.w_dry end) over (partition by s.season, i.cat order by i.ord)
         - case s.season when 'wet' then i.w_wet else i.w_dry end)
         / sum(case s.season when 'wet' then i.w_wet else i.w_dry end) over (partition by s.season, i.cat) as lo,
       sum(case s.season when 'wet' then i.w_wet else i.w_dry end) over (partition by s.season, i.cat order by i.ord)
         / sum(case s.season when 'wet' then i.w_wet else i.w_dry end) over (partition by s.season, i.cat) as hi
from demo_iss0 i cross join (values ('dry'), ('wet')) s(season);

-- ---------------------------------------------------------------------------
-- 5. The exceptions themselves: shift, time, location, issue, impact, priority
-- ---------------------------------------------------------------------------
create temp table demo_a on commit drop as
select r.sq, r.cat, r.day, r.dn,
       -- shift and a time inside that shift (First 06-14, Second 14-22, Night 22-06)
       sh.shift,
       ((r.day::timestamp + make_interval(mins => case sh.shift
            when 'First'  then 360 + floor(pg_temp.u('tm|' || r.sq) * 480)::int
            when 'Second' then 840 + floor(pg_temp.u('tm|' || r.sq) * 480)::int
            else case when floor(pg_temp.u('tm|' || r.sq) * 480)::int < 120
                      then 1320 + floor(pg_temp.u('tm|' || r.sq) * 480)::int
                      else floor(pg_temp.u('tm|' || r.sq) * 480)::int - 120 end
          end)) at time zone 'Asia/Kolkata') as t_created,
       l.loc as location, i.issue, i.phrase,
       case when pg_temp.u('big|' || r.sq) < 0.04
            then 120 + floor(pg_temp.u('big2|' || r.sq) * 121)::int
            else greatest(5, least(120, round(i.base * exp(0.5 *
                 ((pg_temp.u('z1|' || r.sq) + pg_temp.u('z2|' || r.sq) + pg_temp.u('z3|' || r.sq) + pg_temp.u('z4|' || r.sq) - 2) * 1.732))
                 )::numeric)::int) end as impact
from demo_r0 r
cross join lateral (select case
    when pg_temp.u('sh|' || r.sq) < case r.cat when 'Coal Despatch' then 0.36 when 'Dust Suppression' then 0.42 when 'Haul Road' then 0.34 else 0.45 end then 'First'
    when pg_temp.u('sh|' || r.sq) < case r.cat when 'Coal Despatch' then 0.70 when 'Dust Suppression' then 0.82 when 'Haul Road' then 0.67 else 0.80 end then 'Second'
    else 'Night' end as shift) sh
join demo_locr l on l.cat = r.cat and pg_temp.u('loc|' || r.sq) >= l.lo and pg_temp.u('loc|' || r.sq) < l.hi
join demo_issr i on i.cat = r.cat
                and i.season = case when r.day >= date '2026-06-15' then 'wet' else 'dry' end
                and pg_temp.u('is|' || r.sq) >= i.lo and pg_temp.u('is|' || r.sq) < i.hi;

-- Priority at creation: about 22% High, 50% Medium, 28% Low (larger impact leans higher).
create temp table demo_b on commit drop as
select a.*,
       case when pr.p >= 0.78 then 'High' when pr.p >= 0.28 then 'Medium' else 'Low' end as reported_priority
from demo_a a
join (select sq, percent_rank() over (order by 0.65 * pg_temp.u('pr|' || sq) + 0.35 * least(1.0, impact / 120.0), sq) as p
      from demo_a) pr on pr.sq = a.sq;

-- ---------------------------------------------------------------------------
-- 6. First operational cycle: who, when, how it ended
-- ---------------------------------------------------------------------------
create temp table demo_c on commit drop as
select b.*,
       (select p.end_date from demo_p p) - b.day as age,
       (select p.as_of from demo_p p) as as_of,
       -- who created it (65% Overman, 35% Shift In-Charge)
       case when pg_temp.u('cb|' || b.sq) < 0.35 then 'ov1' when pg_temp.u('cb|' || b.sq) < 0.65 then 'ov2'
            when pg_temp.u('cb|' || b.sq) < 0.83 then 'sic1' else 'sic2' end as creator,
       case when pg_temp.u('sa|' || b.sq) < 0.35 then 'ov1' when pg_temp.u('sa|' || b.sq) < 0.60 then 'ov2'
            when pg_temp.u('sa|' || b.sq) < 0.80 then 'sic1' when pg_temp.u('sa|' || b.sq) < 0.92 then 'sic2' else 'mgr2' end as start_slot,
       case when pg_temp.u('qa|' || b.sq) < 0.35 then 'ov1' when pg_temp.u('qa|' || b.sq) < 0.65 then 'ov2'
            when pg_temp.u('qa|' || b.sq) < 0.83 then 'sic1' else 'sic2' end as req_slot,
       b.t_created + make_interval(mins => 5 + floor(85 * power(pg_temp.u('ds|' || b.sq), 1.5))::int) as t_start,
       20 + floor(greatest(b.impact, 10) * (0.5 + 2.0 * pg_temp.u('wk|' || b.sq)))::int as work_mins
from demo_b b;

create temp table demo_d on commit drop as
select c.*,
       c.t_start + make_interval(mins => c.work_mins) as t_res,
       -- planned outcome from the age of the record: newest records are mostly still active
       case when pg_temp.u('st|' || c.sq) >= case when c.age <= 3 then 0.95 when c.age <= 7 then 0.85 when c.age <= 14 then 0.72
                                                   when c.age <= 30 then 0.40 when c.age <= 60 then 0.10 else 0.04 end
            then 'resolved'
            when pg_temp.u('ip|' || c.sq) < case when c.age <= 2 then 0.45 else 0.58 end then 'inprog'
            else 'open' end as stage0
from demo_c c;

create temp table demo_e on commit drop as
select d.*,
       -- nothing can have happened after the demo "now"
       case when d.stage0 = 'resolved' and d.t_res > d.as_of then (case when d.t_start <= d.as_of then 'inprog' else 'open' end)
            when d.stage0 = 'inprog' and d.t_start > d.as_of then 'open'
            else d.stage0 end as stage
from demo_d d;

create temp table demo_f on commit drop as
select e.*,
       (e.stage = 'resolved' and pg_temp.u('ms|' || e.sq) < 0.09) as miss_start,             -- start time not recorded
       (e.stage = 'resolved' and pg_temp.u('cl|' || e.sq) < 0.50) as via_closure,            -- closure requested, then confirmed
       case when pg_temp.u('rv|' || e.sq) < 0.42 then 'sic1' when pg_temp.u('rv|' || e.sq) < 0.84 then 'sic2' else 'mgr2' end as res_direct,
       -- pending closure request on a recent In progress record
       (e.stage = 'inprog' and e.age <= 7 and pg_temp.u('pc|' || e.sq) < 0.25
          and e.t_start + interval '15 minutes' < e.as_of) as pending_closure
from demo_e e;

create temp table demo_g on commit drop as
select f.*,
       -- the person who confirms is never the person who requested (maker-checker)
       case when f.via_closure then
              case f.req_slot
                when 'sic1' then case when pg_temp.u('r2|' || f.sq) < 0.6 then 'sic2' else 'mgr2' end
                when 'sic2' then case when pg_temp.u('r2|' || f.sq) < 0.6 then 'sic1' else 'mgr2' end
                else case when pg_temp.u('r2|' || f.sq) < 0.4 then 'sic1' when pg_temp.u('r2|' || f.sq) < 0.8 then 'sic2' else 'mgr2' end
              end
            else f.res_direct end as resolver,
       case when f.via_closure
            then greatest(case when f.miss_start then f.t_created + interval '5 minutes' else f.t_start + interval '5 minutes' end,
                          f.t_res - make_interval(mins => 8 + floor(pg_temp.u('rq|' || f.sq) * 70)::int))
            when f.pending_closure
            then least(f.as_of - interval '1 minute',
                       f.t_start + make_interval(mins => 15 + floor(pg_temp.u('rp|' || f.sq) * 105)::int)) end as t_req
from demo_f f;

-- ---------------------------------------------------------------------------
-- 7. Reopened exceptions (20): 16 reopened and worked again, 4 recent ones still open again
-- ---------------------------------------------------------------------------
create temp table demo_ro on commit drop as
select sq, grp from (
  select sq, 'gen' as grp,
         row_number() over (order by pg_temp.u('ro|' || sq)) as rn
  from demo_g where stage = 'resolved' and not miss_start and age >= 8
) x where rn <= 16
union all
select sq, case when rn <= 2 then 'open' else 'inprog' end
from (
  select g.sq, row_number() over (order by pg_temp.u('rr|' || g.sq)) as rn
  from demo_g g
  where g.stage = 'resolved' and not g.miss_start and g.age between 6 and 14
    and g.sq not in (select sq from (select sq, row_number() over (order by pg_temp.u('ro|' || sq)) as rn2
                                       from demo_g where stage = 'resolved' and not miss_start and age >= 8) y where rn2 <= 16)
) z where rn <= 4;

create temp table demo_h on commit drop as
select g.*, ro.grp as ro_grp,
       case when ro.grp is not null then
         case when pg_temp.u('oa|' || g.sq) < 0.40 then 'sic1' when pg_temp.u('oa|' || g.sq) < 0.52 then 'sic2'
              when pg_temp.u('oa|' || g.sq) < 0.64 then 'mgr1' when pg_temp.u('oa|' || g.sq) < 0.76 then 'mgr2'
              when pg_temp.u('oa|' || g.sq) < 0.90 then 'po' else 'gm' end end as reopener,
       g.t_res + make_interval(mins => 360 + floor(pg_temp.u('ot|' || g.sq) * 3960)::int) as t_reopen
from demo_g g left join demo_ro ro on ro.sq = g.sq;

create temp table demo_i on commit drop as
select h.*,
       h.t_reopen + make_interval(mins => 10 + floor(pg_temp.u('s2|' || h.sq) * 110)::int) as t_start2,
       case when pg_temp.u('s2a|' || h.sq) < 0.35 then 'ov1' when pg_temp.u('s2a|' || h.sq) < 0.60 then 'ov2'
            when pg_temp.u('s2a|' || h.sq) < 0.80 then 'sic1' when pg_temp.u('s2a|' || h.sq) < 0.92 then 'sic2' else 'mgr2' end as start2_slot,
       (pg_temp.u('c2|' || h.sq) < 0.5) as via_closure2
from demo_h h;

create temp table demo_j on commit drop as
select i.*,
       i.t_start2 + make_interval(mins => 30 + floor(pg_temp.u('w2|' || i.sq) * 330)::int) as t_res2
from demo_i i;

create temp table demo_k on commit drop as
select j.*,
       case when j.via_closure2
            then greatest(j.t_start2 + interval '5 minutes', j.t_res2 - make_interval(mins => 8 + floor(pg_temp.u('q2|' || j.sq) * 50)::int)) end as t_req2,
       case when j.via_closure2 then
              case j.req_slot2 when 'sic1' then 'sic2' when 'sic2' then 'sic1' else case when pg_temp.u('r3|' || j.sq) < 0.5 then 'sic1' else 'sic2' end end
            else case when pg_temp.u('r4|' || j.sq) < 0.45 then 'sic1' when pg_temp.u('r4|' || j.sq) < 0.90 then 'sic2' else 'mgr2' end end as resolver2
from (select j0.*, case when pg_temp.u('qa2|' || j0.sq) < 0.35 then 'ov1' when pg_temp.u('qa2|' || j0.sq) < 0.65 then 'ov2'
                        when pg_temp.u('qa2|' || j0.sq) < 0.83 then 'sic1' else 'sic2' end as req_slot2
      from demo_j j0) j;

-- ---------------------------------------------------------------------------
-- 8. Priority changes (about 9% of exceptions; a few changed twice)
-- ---------------------------------------------------------------------------
create temp table demo_pc0 on commit drop as
select k.sq, k.reported_priority as p0,
       case when k.stage = 'resolved' then k.t_res else k.as_of end as lim,
       k.t_created
from demo_k k
where pg_temp.u('pc|x|' || k.sq) < 0.09
  and extract(epoch from (case when k.stage = 'resolved' then k.t_res else k.as_of end - k.t_created)) / 60.0 >= 45;

create temp table demo_pc on commit drop as
select q.sq, q.p0, q.p1, q.slot1, q.at1, q.lim,
       (pg_temp.u('p2|' || q.sq) < 0.14 and q.lim - q.at1 >= interval '15 minutes') as twice
from (
  select c.sq, c.p0, c.lim,
         case c.p0
           when 'Low'    then case when pg_temp.u('pn|' || c.sq) < 0.6 then 'Medium' else 'High' end
           when 'Medium' then case when pg_temp.u('pn|' || c.sq) < 0.5 then 'High' else 'Low' end
           else               case when pg_temp.u('pn|' || c.sq) < 0.7 then 'Medium' else 'Low' end end as p1,
         case when pg_temp.u('pa|' || c.sq) < 0.70 then 'sic1' when pg_temp.u('pa|' || c.sq) < 0.80 then 'sic2'
              when pg_temp.u('pa|' || c.sq) < 0.92 then 'mgr1' else 'po' end as slot1,
         c.t_created + make_interval(mins => 10 + floor(pg_temp.u('pt|' || c.sq) *
              least(110, greatest(1, (extract(epoch from (c.lim - c.t_created)) / 60.0) - 15)))::int) as at1
  from demo_pc0 c
) q;

create temp table demo_pc2 on commit drop as
select p.*,
       case when p.twice then
         case p.p1 when 'High' then case when pg_temp.u('pn2|' || p.sq) < 0.5 then 'Medium' else 'Low' end
                   when 'Medium' then case when pg_temp.u('pn2|' || p.sq) < 0.5 then 'High' else 'Low' end
                   else case when pg_temp.u('pn2|' || p.sq) < 0.5 then 'Medium' else 'High' end end end as p2,
       case when p.twice then case when pg_temp.u('pa2|' || p.sq) < 0.5 then 'mgr2' when pg_temp.u('pa2|' || p.sq) < 0.8 then 'po' else 'gm' end end as slot2,
       case when p.twice then p.at1 + make_interval(mins => 5 + floor(pg_temp.u('pt2|' || p.sq) * 10)::int) end as at2
from demo_pc p;

-- ---------------------------------------------------------------------------
-- 9. Short, fictional remark texts
-- ---------------------------------------------------------------------------
create temp table demo_txt(kind text, cat text, n int, body text) on commit drop;
insert into demo_txt values
  ('done','Coal Despatch',0,'Loader restored and coal loading resumed.'),
  ('done','Coal Despatch',1,'Rake loading back on schedule after stock was rearranged.'),
  ('done','Coal Despatch',2,'Additional tippers arranged; despatch normal.'),
  ('done','Coal Despatch',3,'Siding cleared and rake placement completed.'),
  ('done','Coal Despatch',4,'Weighbridge queue cleared; despatch resumed.'),
  ('done','Dust Suppression',0,'Water tanker deployed; monitoring dust level.'),
  ('done','Dust Suppression',1,'Sprinkling completed on the affected stretch.'),
  ('done','Dust Suppression',2,'Fog cannon restarted and checked.'),
  ('done','Dust Suppression',3,'Spare tanker arranged; dust suppressed.'),
  ('done','Dust Suppression',4,'Extra sprinkling round done; area checked.'),
  ('done','Haul Road',0,'Grader deployed on affected haul-road stretch.'),
  ('done','Haul Road',1,'Potholes filled and surface levelled.'),
  ('done','Haul Road',2,'Drain cleared; water removed from the road.'),
  ('done','Haul Road',3,'Dozer used to reshape the berm; road open to traffic.'),
  ('done','Haul Road',4,'Loose material removed; road inspected.'),
  ('done','Coal Quality',0,'Contaminated material segregated before loading.'),
  ('done','Coal Quality',1,'Mixed coal rehandled and sampled again.'),
  ('done','Coal Quality',2,'Oversize coal removed; loading resumed.'),
  ('done','Coal Quality',3,'Moist coal set aside; despatch continued with dry stock.'),
  ('done','Coal Quality',4,'Quality check repeated and sample recorded.'),
  ('update','any',0,'Crew informed; work started at site.'),
  ('update','any',1,'Materials requested from stores.'),
  ('update','any',2,'Waiting for equipment to reach the site.'),
  ('update','any',3,'Partial work done; monitoring continues.'),
  ('update','any',4,'Supervisor visited the site and checked progress.'),
  ('mgmt','any',0,'Recurring pattern noted for discussion at the weekly review.'),
  ('mgmt','any',1,'Reviewed; supervisors to continue as planned.'),
  ('mgmt','any',2,'Please keep this location under observation.'),
  ('mgmt','any',3,'Priority reviewed and left as it is.'),
  ('reopen','any',0,'Inspection found the work incomplete; reopened for rework.'),
  ('reopen','any',1,'The problem appeared again after closure; reopened.'),
  ('reopen','any',2,'Closure note did not match the site condition; reopened.'),
  ('reopen','any',3,'Review meeting asked for the area to be checked again.'),
  ('up','any',0,'Production impact was higher than first reported.'),
  ('up','any',1,'Situation became worse after the first check.'),
  ('up','any',2,'More vehicles affected than first noted.'),
  ('down','any',0,'Situation eased after the first response.'),
  ('down','any',1,'Impact was lower than first reported.'),
  ('down','any',2,'Work already under way, so priority lowered.'),
  ('again','any',0,'Reviewed again after the supervisor update.'),
  ('again','any',1,'Re-assessed after new information from the site.');

-- Extra operational remarks (about 12% of exceptions) and management remarks (14)
create temp table demo_xr on commit drop as
select k.sq,
       k.t_created + make_interval(mins => 10 + floor(pg_temp.u('xt|' || k.sq) *
            least(240, greatest(1, (extract(epoch from (case when k.stage = 'resolved' then k.t_res else k.as_of end - k.t_created)) / 60.0) - 15)))::int) as at,
       case when pg_temp.u('xa|' || k.sq) < 0.3 then 'ov1' when pg_temp.u('xa|' || k.sq) < 0.55 then 'ov2'
            when pg_temp.u('xa|' || k.sq) < 0.80 then 'sic1' else 'sic2' end as slot,
       floor(pg_temp.u('xb|' || k.sq) * 5)::int as n
from demo_k k
where pg_temp.u('xr|' || k.sq) < 0.12
  and extract(epoch from (case when k.stage = 'resolved' then k.t_res else k.as_of end - k.t_created)) / 60.0 >= 45;

create temp table demo_mr on commit drop as
select sq, at, slot, n from (
  select k.sq,
         k.t_created + make_interval(mins => 30 + floor(pg_temp.u('mt|' || k.sq) * 570)::int) as at,
         case when pg_temp.u('ma|' || k.sq) < 0.35 then 'mgr1' when pg_temp.u('ma|' || k.sq) < 0.60 then 'mgr2'
              when pg_temp.u('ma|' || k.sq) < 0.82 then 'po' else 'gm' end as slot,
         floor(pg_temp.u('mb|' || k.sq) * 4)::int as n,
         row_number() over (order by pg_temp.u('mr|' || k.sq)) as rn
  from demo_k k
  where k.age <= 75 and (k.reported_priority = 'High' or k.sq in (select sq from demo_pc2))
) x where rn <= 14 and at < (select as_of from demo_p);

-- ---------------------------------------------------------------------------
-- 10. The finished exception rows (what the tables will hold)
-- ---------------------------------------------------------------------------
create temp table demo_exc on commit drop as
select k.sq,
       md5('demo-exc-' || k.sq)::uuid as id,
       k.t_created as created_at,
       k.shift, k.location, k.cat as category, k.issue as issue_type,
       (select p.marker from demo_p p) || ' ' || k.location || ': ' || k.phrase ||
         case when pg_temp.u('dx|' || k.sq) < 0.25 then ' Reported at shift change.'
              when pg_temp.u('dx|' || k.sq) < 0.40 then ' Follow-up requested.' else '' end as description,
       k.impact as impact_minutes,
       k.reported_priority,
       coalesce(pc.p2, pc.p1, k.reported_priority) as current_priority,
       case when k.ro_grp = 'gen' then 'Resolved' when k.ro_grp = 'open' then 'Open' when k.ro_grp = 'inprog' then 'In progress'
            when k.stage = 'resolved' then 'Resolved' when k.stage = 'inprog' then 'In progress' else 'Open' end as status,
       -- the CURRENT operational cycle (a reopened exception shows its second cycle)
       case when k.ro_grp in ('gen', 'inprog') then k.t_start2
            when k.ro_grp = 'open' then null
            when k.stage in ('resolved', 'inprog') and not k.miss_start then k.t_start end as started_at,
       case when k.ro_grp in ('gen', 'inprog') then k.start2_slot
            when k.ro_grp = 'open' then null
            when k.stage in ('resolved', 'inprog') and not k.miss_start then k.start_slot end as started_slot,
       case when k.ro_grp = 'gen' then k.t_res2 when k.ro_grp is null and k.stage = 'resolved' then k.t_res end as resolved_at,
       case when k.ro_grp = 'gen' then k.resolver2 when k.ro_grp is null and k.stage = 'resolved' then k.resolver end as resolved_slot,
       case when k.ro_grp is null and k.pending_closure then k.t_req end as closure_requested_at,
       case when k.ro_grp is null and k.pending_closure then k.req_slot end as closure_slot,
       k.creator as creator_slot,
       coalesce(pc.slot2, pc.slot1) as pc_slot,
       coalesce(pc.at2, pc.at1) as pc_at,
       case when pc.sq is not null then
         (select t.body from demo_txt t
           where t.cat = 'any' and t.kind = case when pc.twice then 'again'
                   when (case pc.p1 when 'High' then 3 when 'Medium' then 2 else 1 end)
                      > (case pc.p0 when 'High' then 3 when 'Medium' then 2 else 1 end) then 'up' else 'down' end
             and t.n = floor(pg_temp.u('pr2|' || k.sq) * case when pc.twice then 2 else 3 end)::int) end as pc_reason,
       k.ro_grp, k.t_reopen, k.t_start2, k.t_res2, k.t_req2, k.via_closure2, k.reopener, k.req_slot2, k.start2_slot, k.resolver2,
       k.stage, k.miss_start, k.via_closure, k.pending_closure, k.req_slot, k.start_slot, k.resolver, k.t_start, k.t_res, k.t_req,
       k.reported_priority as p_reported
from demo_k k
left join demo_pc2 pc on pc.sq = k.sq;

-- ---------------------------------------------------------------------------
-- 11. The history (audit lines and remarks), written the way the app's own functions write them
-- ---------------------------------------------------------------------------
create temp table demo_ev(sq int, at timestamptz, ord int, action text, slot text,
                          old_value text, new_value text, note text, rk text, rbody text) on commit drop;

-- created
insert into demo_ev
select e.sq, e.created_at, 1, 'created', e.creator_slot, null, 'Open',
       format('%s / %s / %s, priority %s', e.category, e.issue_type, e.location, e.p_reported), null, null
from demo_exc e;

-- priority changes (first, and the second one for the few changed twice)
insert into demo_ev
select pc.sq, pc.at1, 2, 'priority_changed', pc.slot1, pc.p0, pc.p1,
       (select t.body from demo_txt t where t.cat = 'any'
          and t.kind = case when (case pc.p1 when 'High' then 3 when 'Medium' then 2 else 1 end)
                              > (case pc.p0 when 'High' then 3 when 'Medium' then 2 else 1 end) then 'up' else 'down' end
          and t.n = floor(pg_temp.u('pr1|' || pc.sq) * 3)::int), null, null
from demo_pc2 pc;
insert into demo_ev
select pc.sq, pc.at2, 3, 'priority_changed', pc.slot2, pc.p1, pc.p2,
       (select t.body from demo_txt t where t.cat = 'any' and t.kind = 'again' and t.n = floor(pg_temp.u('pr2|' || pc.sq) * 2)::int), null, null
from demo_pc2 pc where pc.twice;

-- first cycle: started
insert into demo_ev
select e.sq, e.t_start, 4, 'started', e.start_slot, 'Open', 'In progress', null, null, null
from demo_exc e
where e.stage in ('resolved', 'inprog') and not e.miss_start;

-- first cycle: closure requested (closure note is also an operational remark, as in the app)
insert into demo_ev
select e.sq, e.t_req, 5, 'closure_requested', e.req_slot, 'In progress', 'In progress', x.body, 'operational', x.body
from demo_exc e
join lateral (select t.body from demo_txt t where t.kind = 'done' and t.cat = e.category
              and t.n = floor(pg_temp.u('cn|' || e.sq) * 5)::int) x on true
where e.stage = 'resolved' and e.via_closure
   or e.pending_closure;

-- first cycle: resolved (after a closure request, or directly with a note)
insert into demo_ev
select e.sq, e.t_res, 6, 'resolved', e.resolver,
       case when e.via_closure
            then format('In progress (closure requested by %s at %s)',
                        (select a.name from demo_actor a where a.slot = e.req_slot),
                        to_char(e.t_req at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'))
            else 'In progress' end,
       'Resolved',
       case when e.via_closure then 'Resolved after a closure request' else x.body end,
       case when e.via_closure then null else 'operational' end,
       case when e.via_closure then null else x.body end
from demo_exc e
join lateral (select t.body from demo_txt t where t.kind = 'done' and t.cat = e.category
              and t.n = floor(pg_temp.u('rn|' || e.sq) * 5)::int) x on true
where e.stage = 'resolved';

-- reopened (Resolved -> Open), then the second cycle
insert into demo_ev
select e.sq, e.t_reopen, 7, 'reopened', e.reopener, 'Resolved', 'Open',
       (select t.body from demo_txt t where t.kind = 'reopen' and t.n = floor(pg_temp.u('rr2|' || e.sq) * 4)::int), null, null
from demo_exc e where e.ro_grp is not null;

insert into demo_ev
select e.sq, e.t_start2, 8, 'started', e.start2_slot, 'Open', 'In progress', null, null, null
from demo_exc e where e.ro_grp in ('gen', 'inprog');

insert into demo_ev
select e.sq, e.t_req2, 9, 'closure_requested', e.req_slot2, 'In progress', 'In progress', x.body, 'operational', x.body
from demo_exc e
join lateral (select t.body from demo_txt t where t.kind = 'done' and t.cat = e.category
              and t.n = floor(pg_temp.u('cn2|' || e.sq) * 5)::int) x on true
where e.ro_grp = 'gen' and e.via_closure2;

insert into demo_ev
select e.sq, e.t_res2, 10, 'resolved', e.resolver2,
       case when e.via_closure2
            then format('In progress (closure requested by %s at %s)',
                        (select a.name from demo_actor a where a.slot = e.req_slot2),
                        to_char(e.t_req2 at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'))
            else 'In progress' end,
       'Resolved',
       case when e.via_closure2 then 'Resolved after a closure request' else x.body end,
       case when e.via_closure2 then null else 'operational' end,
       case when e.via_closure2 then null else x.body end
from demo_exc e
join lateral (select t.body from demo_txt t where t.kind = 'done' and t.cat = e.category
              and t.n = floor(pg_temp.u('rn2|' || e.sq) * 5)::int) x on true
where e.ro_grp = 'gen';

-- extra operational remarks while work is going on
insert into demo_ev
select x.sq, x.at, 11, 'remark_operational', x.slot, null, null, t.body, 'operational', t.body
from demo_xr x join demo_txt t on t.kind = 'update' and t.n = x.n;

-- a few management remarks
insert into demo_ev
select m.sq, m.at, 12, 'remark_management', m.slot, null, null, t.body, 'management', t.body
from demo_mr m join demo_txt t on t.kind = 'mgmt' and t.n = m.n;

-- time ordering inside one exception (a 1-minute step is enough to keep the order)
create temp table demo_ev2 on commit drop as
select ev.*, (row_number() over (partition by ev.sq order by ev.at, ev.ord))::int as ev_no
from demo_ev ev;

-- ---------------------------------------------------------------------------
-- 12. Write the rows (only rows that are not there yet; safe to run twice)
-- ---------------------------------------------------------------------------
insert into public.shift_exceptions
  (id, created_at, shift, location, category, issue_type, description, impact_minutes,
   urgency, status, resolved_at,
   created_by, created_by_role, created_by_name,
   reported_priority, current_priority,
   priority_changed_by, priority_changed_by_role, priority_changed_by_name, priority_changed_at, priority_change_reason,
   started_by, started_by_name, started_at,
   closure_requested_by, closure_requested_by_name, closure_requested_at,
   resolved_by, resolved_by_name, updated_at)
select e.id, e.created_at, e.shift, e.location, e.category, e.issue_type, e.description, e.impact_minutes,
       e.current_priority, e.status, e.resolved_at,
       (select a.user_id from demo_actor a where a.slot = e.creator_slot),
       (select a.role    from demo_actor a where a.slot = e.creator_slot),
       (select a.name    from demo_actor a where a.slot = e.creator_slot),
       e.reported_priority, e.current_priority,
       (select a.user_id from demo_actor a where a.slot = e.pc_slot),
       (select a.role    from demo_actor a where a.slot = e.pc_slot),
       (select a.name    from demo_actor a where a.slot = e.pc_slot),
       e.pc_at, e.pc_reason,
       (select a.user_id from demo_actor a where a.slot = e.started_slot),
       (select a.name    from demo_actor a where a.slot = e.started_slot),
       e.started_at,
       (select a.user_id from demo_actor a where a.slot = e.closure_slot),
       (select a.name    from demo_actor a where a.slot = e.closure_slot),
       e.closure_requested_at,
       (select a.user_id from demo_actor a where a.slot = e.resolved_slot),
       (select a.name    from demo_actor a where a.slot = e.resolved_slot),
       (select max(v.at) from demo_ev2 v where v.sq = e.sq)
from demo_exc e
on conflict (id) do nothing;

insert into public.exception_audit
  (id, exception_id, action, actor_id, actor_name, actor_role, old_value, new_value, note, created_at)
select md5('demo-aud-' || v.sq || '-' || v.ev_no)::uuid, md5('demo-exc-' || v.sq)::uuid, v.action,
       a.user_id, a.name, a.role, v.old_value, v.new_value, v.note, v.at
from demo_ev2 v join demo_actor a on a.slot = v.slot
on conflict (id) do nothing;

insert into public.exception_remarks
  (id, exception_id, kind, body, author_id, author_name, author_role, created_at)
select md5('demo-rmk-' || v.sq || '-' || v.ev_no)::uuid, md5('demo-exc-' || v.sq)::uuid, v.rk, v.rbody,
       a.user_id, a.name, a.role, v.at
from demo_ev2 v join demo_actor a on a.slot = v.slot
where v.rk is not null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 13. Checks. Any failure stops the script and rolls everything back.
-- ---------------------------------------------------------------------------
do $$
declare
  mk constant text := '[DEMO-2026-PRESENTATION]';
  n int; bad int; v numeric; tot numeric; big numeric;
begin
  select count(*) into n from public.shift_exceptions where position(mk in description) > 0;
  if n not between 700 and 900 then raise exception 'CHECK FAILED: % demo exceptions (expected 700 to 900)', n; end if;

  select count(*) into bad from public.shift_exceptions
   where position(mk in description) > 0 and left(description, length(mk)) <> mk;
  if bad > 0 then raise exception 'CHECK FAILED: % demo rows do not start with the marker', bad; end if;

  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and
     category not in ('Coal Despatch','Dust Suppression','Haul Road','Coal Quality');
  if bad > 0 then raise exception 'CHECK FAILED: % rows with an invalid category', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and shift not in ('First','Second','Night');
  if bad > 0 then raise exception 'CHECK FAILED: % rows with an invalid shift', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and
     location not in ('ABC Patch','XYZ Patch','Haul Road A','Haul Road B','MDP Junction','Stockyard 1','Siding 1','Siding 2');
  if bad > 0 then raise exception 'CHECK FAILED: % rows with an invalid location', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and
     (reported_priority not in ('Low','Medium','High') or current_priority not in ('Low','Medium','High') or urgency not in ('Low','Medium','High')
      or urgency is distinct from current_priority);
  if bad > 0 then raise exception 'CHECK FAILED: % rows with an invalid or unsynchronised priority', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and status not in ('Open','In progress','Resolved');
  if bad > 0 then raise exception 'CHECK FAILED: % rows with an invalid status', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and
     not public._issue_type_ok(category, issue_type);
  if bad > 0 then raise exception 'CHECK FAILED: % rows with an issue type that does not belong to the category', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and
     (impact_minutes is null or impact_minutes not between 0 and 1440);
  if bad > 0 then raise exception 'CHECK FAILED: % rows with invalid impact minutes', bad; end if;

  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and started_at < created_at;
  if bad > 0 then raise exception 'CHECK FAILED: % rows with started_at earlier than created_at', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and resolved_at < created_at;
  if bad > 0 then raise exception 'CHECK FAILED: % rows with resolved_at earlier than created_at', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and resolved_at < started_at;
  if bad > 0 then raise exception 'CHECK FAILED: % rows with resolved_at earlier than started_at', bad; end if;
  select count(*) into bad from public.shift_exceptions where position(mk in description) > 0 and
     ((status = 'Resolved') <> (resolved_at is not null) or (status = 'Open' and started_at is not null)
      or (status = 'In progress' and started_at is null) or resolved_at > (select as_of from demo_p));
  if bad > 0 then raise exception 'CHECK FAILED: % rows whose status does not match their dates', bad; end if;

  select (max(created_at at time zone 'Asia/Kolkata')::date - min(created_at at time zone 'Asia/Kolkata')::date + 1) into v
    from public.shift_exceptions where position(mk in description) > 0;
  if v < 170 then raise exception 'CHECK FAILED: demo span is % days (need at least 170)', v; end if;
  select count(distinct (created_at at time zone 'Asia/Kolkata')::date) into n
    from public.shift_exceptions where position(mk in description) > 0;
  if n < 21 then raise exception 'CHECK FAILED: only % active days (need at least 21)', n; end if;

  select count(distinct category) into n from public.shift_exceptions where position(mk in description) > 0;
  if n <> 4 then raise exception 'CHECK FAILED: % categories present (need 4)', n; end if;
  select count(distinct shift) into n from public.shift_exceptions where position(mk in description) > 0;
  if n <> 3 then raise exception 'CHECK FAILED: % shifts present (need 3)', n; end if;
  select count(distinct location) into n from public.shift_exceptions where position(mk in description) > 0;
  if n <> 8 then raise exception 'CHECK FAILED: % locations present (need 8)', n; end if;

  select count(*) into n from public.shift_exceptions where position(mk in description) > 0 and started_at is not null and started_at >= created_at;
  if n < 30 then raise exception 'CHECK FAILED: only % usable start observations (need 30)', n; end if;
  select count(*) into n from public.shift_exceptions where position(mk in description) > 0 and status = 'Resolved' and resolved_at is not null and resolved_at >= created_at;
  if n < 30 then raise exception 'CHECK FAILED: only % usable resolved observations (need 30)', n; end if;

  select coalesce(sum(impact_minutes), 0), coalesce(max(impact_minutes), 0) into tot, big
    from public.shift_exceptions where position(mk in description) > 0;
  if tot <= 0 then raise exception 'CHECK FAILED: total impact is 0'; end if;
  if big * 2 > tot then raise exception 'CHECK FAILED: one exception is more than 50%% of total impact'; end if;

  -- distribution targets (with a small tolerance)
  select count(*) filter (where status = 'Resolved') * 100.0 / count(*) into v
    from public.shift_exceptions where position(mk in description) > 0;
  if v not between 80 and 86 then raise exception 'CHECK FAILED: % %% Resolved (expected about 80 to 85)', round(v, 1); end if;
  select count(*) filter (where status = 'In progress') * 100.0 / count(*) into v
    from public.shift_exceptions where position(mk in description) > 0;
  if v not between 7 and 13 then raise exception 'CHECK FAILED: % %% In progress (expected about 8 to 12)', round(v, 1); end if;
  select count(*) filter (where status = 'Open') * 100.0 / count(*) into v
    from public.shift_exceptions where position(mk in description) > 0;
  if v not between 4 and 11 then raise exception 'CHECK FAILED: % %% Open (expected about 5 to 10)', round(v, 1); end if;
  select count(distinct exception_id) into n from public.exception_audit a
    where a.action = 'reopened' and exists (select 1 from public.shift_exceptions e where e.id = a.exception_id and position(mk in e.description) > 0);
  if n not between 15 and 25 then raise exception 'CHECK FAILED: % reopened exceptions (expected 15 to 25)', n; end if;

  -- every audit line and remark of the demo belongs to a demo exception
  select count(*) into bad from public.exception_audit a
   where a.id in (select md5('demo-aud-' || sq || '-' || ev_no)::uuid from demo_ev2)
     and not exists (select 1 from public.shift_exceptions e where e.id = a.exception_id and position(mk in e.description) > 0);
  if bad > 0 then raise exception 'CHECK FAILED: % demo audit lines point to a non-demo exception', bad; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 14. Summary (read-only). Look at it before you trust the data.
-- ---------------------------------------------------------------------------
drop function pg_temp.u(text);

commit;

select 'demo exceptions' as item, count(*)::text as value
  from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) > 0
union all
select 'first / last day',
       min((created_at at time zone 'Asia/Kolkata')::date)::text || ' to ' || max((created_at at time zone 'Asia/Kolkata')::date)::text
  from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) > 0
union all
select 'status ' || status, count(*)::text
  from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) > 0 group by status
union all
select 'category ' || category, count(*)::text
  from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) > 0 group by category
union all
select 'audit lines', count(*)::text from public.exception_audit a
  where exists (select 1 from public.shift_exceptions e where e.id = a.exception_id and position('[DEMO-2026-PRESENTATION]' in e.description) > 0)
union all
select 'remarks', count(*)::text from public.exception_remarks r
  where exists (select 1 from public.shift_exceptions e where e.id = r.exception_id and position('[DEMO-2026-PRESENTATION]' in e.description) > 0)
order by 1;
