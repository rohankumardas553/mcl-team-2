process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
// Phase D: computeAll() against independent SQL (period boundaries, tables, order, formulas).
const cp=require('child_process');
const A=require((REPO+'/analytics.js'));
const psql=sql=>{const r=cp.spawnSync('psql',['-h',PGHOST,'-p',PGPORT,'-U','postgres','-q','-At','-d','ms','-c',sql],{encoding:'utf8',maxBuffer:1<<28}); if(r.status){throw new Error(r.stderr)} return r.stdout.trim();};
const J=sql=>JSON.parse(psql(`select coalesce(jsonb_agg(t),'[]'::jsonb)::text from (${sql}) t`));
let PASS=0,FAIL=0; const ok=(l,c,x)=>{ if(c)PASS++; else {FAIL++; console.log('FAIL  '+l+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,400):''));} };
const near=(a,b)=>a===null||b===null? a===b : Math.abs(a-b)<1e-3;
const TZ="Asia/Kolkata";
const r1=(x,dp)=>Math.round(x*Math.pow(10,dp));
// expected delta straight from the definition
function expDelta(c,p,dp){ if(c===null||p===null) return {abs:null,pct:null,dir:null};
  const cc=r1(c,dp),pp=r1(p,dp),f=Math.pow(10,dp); return {abs:(cc-pp)/f,pct:pp!==0?(cc-pp)/Math.abs(pp)*100:null,dir:cc===pp?'No change':cc>pp?'Increased':'Decreased'}; }
const dEq=(d,e)=> (d.abs===e.abs||(d.abs!==null&&e.abs!==null&&near(d.abs,e.abs))) && (d.pct===null?e.pct===null:(e.pct!==null&&near(d.pct,e.pct))) && d.dir===e.dir;

const now=new Date();
const scenarios=[
 ['7',null,null,{}],['30',null,null,{}],['90',null,null,{}],['all',null,null,{}],
 ['custom','2026-08-01','2026-08-31',{}],['custom','2026-09-15','2026-09-15',{}],['custom','2026-09-01','2026-09-15',{}],
 ['custom','2026-01-01','2026-06-30',{}],['custom','2026-01-01','2026-12-31',{}],['custom','2030-01-01','2030-02-01',{}],
 ['30',null,null,{shift:'Night'}],['90',null,null,{category:'Haul Road'}],['30',null,null,{location:'Siding 1'}],
 ['7',null,null,{category:'Dust Suppression',shift:'Second',location:'ABC Patch'}],['custom','2025-08-20','2025-09-10',{}]];

for (const [preset,f,t,fl] of scenarios) {
  const label=`${preset}${f?` ${f}..${t}`:''} ${JSON.stringify(fl)}`;
  const range=A.resolveRange(preset,f,t,now);
  const F=[]; if(fl.shift) F.push(`shift='${fl.shift}'`); if(fl.category) F.push(`category='${fl.category}'`); if(fl.location) F.push(`location='${fl.location}'`);
  const Fq=F.length?' and '+F.join(' and '):'';
  if(preset==='all'){
    const rows=J(`select id,created_at,shift,location,category,issue_type,impact_minutes,status,current_priority,started_at,resolved_at from shift_exceptions where true ${Fq}`);
    const R=A.computeAll(rows,{},{},range,now);
    ok(label+' | All time has no comparison',R.cmp===null&&R.prev===null&&R.pr===null&&R.overlay===null&&A.previousRange(range,now)===null);
    continue;
  }
  // ---- independent period boundaries in SQL
  let b;
  if(preset==='custom') b=J(`select ('${f}'::date::timestamp at time zone '${TZ}') cf, (('${t}'::date+1)::timestamp at time zone '${TZ}') ct, (('${f}'::date - ('${t}'::date-'${f}'::date+1)::int)::timestamp at time zone '${TZ}') pf, ('${t}'::date-'${f}'::date+1)::int n`)[0];
  else { const N=+preset; b=J(`select ((date_trunc('day', now() at time zone '${TZ}') - interval '${N-1} days') at time zone '${TZ}') cf, null::timestamptz ct, ((date_trunc('day', now() at time zone '${TZ}') - interval '${2*N-1} days') at time zone '${TZ}') pf, ${N} n`)[0]; }
  const curW=`created_at >= '${b.cf}'`+(b.ct?` and created_at < '${b.ct}'`:'')+Fq;
  const prvW=`created_at >= '${b.pf}' and created_at < '${b.cf}'`+Fq;
  const lowW=`created_at >= '${b.pf}'`+(b.ct?` and created_at < '${b.ct}'`:'')+Fq;
  const rows=J(`select id,created_at,shift,location,category,issue_type,impact_minutes,status,current_priority,started_at,resolved_at from shift_exceptions where ${lowW}`);
  const reo={},chg={};
  J(`select distinct exception_id, action from exception_audit where action in ('reopened','priority_changed')`).forEach(a=>{ if(a.action==='reopened')reo[a.exception_id]=true; else chg[a.exception_id]=true; });
  const R=A.computeAll(rows,reo,chg,range,now); const C=R.cmp;
  // ---- period boundaries
  ok(label+' | days',C.days===b.n&&R.pr.days===b.n,[C.days,b.n]);
  ok(label+' | current starts',R.pr.cur.from.getTime()===Date.parse(b.cf));
  ok(label+' | previous starts',R.pr.prev.from.getTime()===Date.parse(b.pf));
  ok(label+' | previous ends exactly where current starts (no overlap, no gap)',R.pr.prev.to.getTime()===R.pr.cur.from.getTime());
  const cN=+psql(`select count(*) from shift_exceptions where ${curW}`), pN=+psql(`select count(*) from shift_exceptions where ${prvW}`);
  ok(label+' | rows split: current count',R.cur.total===cN,[R.cur.total,cN]);
  ok(label+' | rows split: previous count',R.prev.total===pN,[R.prev.total,pN]);
  ok(label+' | no row in both periods',R.cur.total+R.prev.total===rows.filter(r=>Date.parse(r.created_at)>=Date.parse(b.pf)&&(!b.ct||Date.parse(r.created_at)<Date.parse(b.ct))).length);

  // ---- KPIs
  const agg=W=>J(`select count(*)::int n, coalesce(sum(impact_minutes),0)::int m, avg(impact_minutes)::float8 avg,
     count(*) filter (where status='Resolved')::int res,
     count(*) filter (where exists (select 1 from exception_audit a where a.exception_id=shift_exceptions.id and a.action='reopened'))::int reo,
     count(*) filter (where exists (select 1 from exception_audit a where a.exception_id=shift_exceptions.id and a.action='priority_changed'))::int pch
     from shift_exceptions where ${W}`)[0];
  const tm=(W,col,extra)=>J(`select avg(extract(epoch from ${col}-created_at)/60)::float8 a, percentile_cont(0.5) within group (order by extract(epoch from ${col}-created_at)/60)::float8 md from shift_exceptions where ${W} and ${extra}`)[0];
  const cs=agg(curW), ps=agg(prvW);
  const cst=tm(curW,'started_at','started_at is not null and started_at>=created_at'), pst=tm(prvW,'started_at','started_at is not null and started_at>=created_at');
  const crs=tm(curW,'resolved_at',"status='Resolved' and resolved_at is not null and resolved_at>=created_at"), prs=tm(prvW,'resolved_at',"status='Resolved' and resolved_at is not null and resolved_at>=created_at");
  ok(label+' | KPI total',dEq(C.kpis.total,expDelta(cs.n,ps.n,0)),[C.kpis.total,cs.n,ps.n]);
  ok(label+' | KPI impact',dEq(C.kpis.impact,expDelta(cs.m,ps.m,0)));
  ok(label+' | KPI avg impact',dEq(C.kpis.avg,expDelta(cs.avg,ps.avg,1)),[C.kpis.avg,cs.avg,ps.avg]);
  ok(label+' | KPI avg time to start',dEq(C.kpis.start,expDelta(cst.a,pst.a,1)),[C.kpis.start,cst,pst]);
  ok(label+' | KPI avg time to resolve',dEq(C.kpis.resolve,expDelta(crs.a,prs.a,1)),[C.kpis.resolve,crs,prs]);
  ok(label+' | KPI reopened',dEq(C.kpis.reopened,expDelta(cs.reo,ps.reo,0)),[C.kpis.reopened,cs.reo,ps.reo]);
  ok(label+' | perf median start',dEq(C.perf.medStart,expDelta(cst.md,pst.md,1)));
  ok(label+' | perf median resolve',dEq(C.perf.medResolve,expDelta(crs.md,prs.md,1)));
  const pp=(a,n)=>n?a/n*100:null;
  const e1=expDelta(pp(cs.res,cs.n),pp(ps.res,ps.n),1); e1.pct=null;
  const e2=expDelta(pp(cs.reo,cs.n),pp(ps.reo,ps.n),1); e2.pct=null;
  ok(label+' | perf % resolved (percentage points, no pct change)',dEq(C.perf.pctResolved,e1),[C.perf.pctResolved,e1]);
  ok(label+' | perf % reopened (percentage points)',dEq(C.perf.pctReopened,e2),[C.perf.pctReopened,e2]);
  ok(label+' | priority changes',dEq(C.priorityChanges,expDelta(cs.pch,ps.pch,0)));
  ok(label+' | no NaN or Infinity anywhere',!/NaN|Infinity/.test(JSON.stringify(C)));

  // ---- joined tables
  const join=(g,extraCols='',extraSel='')=>`with cur as (select * from shift_exceptions where ${curW}), prv as (select * from shift_exceptions where ${prvW}),
    cg as (select ${g}, count(*)::int c, coalesce(sum(impact_minutes),0)::int m ${extraCols.replace(/@/g,'cur')} from cur group by ${g}),
    pg as (select ${g}, count(*)::int c, coalesce(sum(impact_minutes),0)::int m ${extraCols.replace(/@/g,'prv')} from prv group by ${g}),
    j as (select ${g}, coalesce(cg.c,0) cc, coalesce(pg.c,0) pc, coalesce(cg.m,0) cm, coalesce(pg.m,0) pm ${extraSel} from cg full join pg using (${g}))`;
  const cat=J(`${join('category')} select category as name, cc, pc, cm, pm from j order by (cm-pm) desc, (cc-pc) desc, category collate "C"`);
  ok(label+' | Category Change (rows, values, order)',JSON.stringify(C.categories.map(x=>[x.name,x.curCount,x.prevCount,x.curMinutes,x.prevMinutes]))===JSON.stringify(cat.map(x=>[x.name,x.cc,x.pc,x.cm,x.pm])),[C.categories.slice(0,2),cat.slice(0,2)]);
  ok(label+' | Category deltas + % change',C.categories.every(x=>dEq(x.impact,expDelta(x.curMinutes,x.prevMinutes,0))&&dEq(x.count,expDelta(x.curCount,x.prevCount,0))));
  const loc=J(`${join('location')} select location as name, cc, pc, cm, pm from j order by abs(cm-pm) desc, abs(cc-pc) desc, location collate "C"`);
  ok(label+' | Location Change (rows, values, order by absolute change)',JSON.stringify(C.locations.map(x=>[x.name,x.curCount,x.prevCount,x.curMinutes,x.prevMinutes]))===JSON.stringify(loc.map(x=>[x.name,x.cc,x.pc,x.cm,x.pm])),[C.locations.slice(0,2),loc.slice(0,2)]);
  const iss=J(`${join('category, issue_type')} select category, issue_type, cc, pc, cm, pm from j where cm<>pm or cc<>pc order by abs(cm-pm) desc, abs(cc-pc) desc, (category||' '||issue_type) collate "C" limit 10`);
  ok(label+' | Recurring Issue Change (top 10 by |impact change|)',JSON.stringify(C.issues.map(x=>[x.category,x.issue,x.curCount,x.prevCount,x.curMinutes,x.prevMinutes]))===JSON.stringify(iss.map(x=>[x.category,x.issue_type,x.cc,x.pc,x.cm,x.pm])),[C.issues.slice(0,2),iss.slice(0,2)]);
  const hu=J(`${join('category, location')} select category, location, cc, pc, cm, pm from j where cm>pm order by (cm-pm) desc, (cc-pc) desc, (category||' '||location) collate "C" limit 5`);
  const hd=J(`${join('category, location')} select category, location, cc, pc, cm, pm from j where cm<pm order by (cm-pm) asc, (cc-pc) asc, (category||' '||location) collate "C" limit 5`);
  const H=x=>[x.category,x.location,x.curCount,x.prevCount,x.curMinutes,x.prevMinutes], Hs=x=>[x.category,x.location,x.cc,x.pc,x.cm,x.pm];
  ok(label+' | Hotspot Movement: Highest Increases',JSON.stringify(C.hotspotsUp.map(H))===JSON.stringify(hu.map(Hs)),[C.hotspotsUp.slice(0,2).map(H),hu.slice(0,2).map(Hs)]);
  ok(label+' | Hotspot Movement: Highest Decreases',JSON.stringify(C.hotspotsDown.map(H))===JSON.stringify(hd.map(Hs)));
  ok(label+' | Increases all > 0, Decreases all < 0',C.hotspotsUp.every(x=>x.impact.abs>0)&&C.hotspotsDown.every(x=>x.impact.abs<0));

  // ---- Management review candidates
  const roExpr=t=>`count(*) filter (where exists (select 1 from exception_audit a where a.exception_id=${t}.id and a.action='reopened'))::int`;
  const cand=J(`with cur as (select * from shift_exceptions where ${curW}), prv as (select * from shift_exceptions where ${prvW}),
    cg as (select category, issue_type, location, count(*)::int c, coalesce(sum(impact_minutes),0)::int m, ${roExpr('cur')} ro, max(created_at) l from cur group by 1,2,3),
    pg as (select category, issue_type, location, count(*)::int c, coalesce(sum(impact_minutes),0)::int m, ${roExpr('prv')} ro, max(created_at) l from prv group by 1,2,3),
    j as (select category, issue_type, location, coalesce(cg.c,0) cc, coalesce(pg.c,0) pc, coalesce(cg.m,0) cm, coalesce(pg.m,0) pm, coalesce(cg.ro,0) cro, coalesce(pg.ro,0) pro, greatest(cg.l,pg.l) l
          from cg full join pg using (category, issue_type, location))
    select category, issue_type, location, cc, pc, cm, pm, cro, pro, l from j where cm>pm or cc>pc or cro>pro
    order by (cm-pm) desc, (cc-pc) desc, (cro-pro) desc, l desc, (category||' '||issue_type||' '||location) collate "C" limit 15`);
  const K=x=>[x.category,x.issue,x.location,x.curCount,x.prevCount,x.curMinutes,x.prevMinutes,x.curReopened,x.prevReopened,Date.parse(x.last)];
  const Ks=x=>[x.category,x.issue_type,x.location,x.cc,x.pc,x.cm,x.pm,x.cro,x.pro,Date.parse(x.l)];
  ok(label+' | Review candidates (top 15: every column and order)',JSON.stringify(C.candidates.map(K))===JSON.stringify(cand.map(Ks)),[C.candidates[0]&&K(C.candidates[0]),cand[0]&&Ks(cand[0])]);
  ok(label+' | candidates satisfy the inclusion rule',C.candidates.every(x=>x.impactChange>0||x.countChange>0||x.reopenChange>0));

  // ---- priority
  const pr=J(`with cur as (select * from shift_exceptions where ${curW}), prv as (select * from shift_exceptions where ${prvW}) select p, (select count(*) from cur where current_priority=p)::int cc, (select count(*) from prv where current_priority=p)::int pc, (select coalesce(sum(impact_minutes),0) from cur where current_priority=p)::int cm, (select coalesce(sum(impact_minutes),0) from prv where current_priority=p)::int pm from unnest(array['High','Medium','Low']) p`);
  ok(label+' | Priority comparison',C.priority.slice(0,3).every((x,i)=>x.name===pr[i].p&&x.curCount===pr[i].cc&&x.prevCount===pr[i].pc&&x.curMinutes===pr[i].cm&&x.prevMinutes===pr[i].pm),[C.priority,pr]);

  // ---- overlay
  if(b.n<=90 && rows.length){ ok(label+' | overlay aligned by day number (length = days, totals preserved)',R.overlay&&R.overlay.counts.length===b.n&&R.overlay.counts.reduce((a,c)=>a+c,0)===R.prev.total&&R.overlay.impact.reduce((a,c)=>a+c,0)===R.prev.totalImpact); }
  else ok(label+' | no overlay above 90 days',b.n<=90||R.overlay===null);
  if(b.n<=90&&R.overlay){ // day index by SQL
    const ov=J(`select (created_at at time zone '${TZ}')::date - ('${new Date(Date.parse(b.pf)).toLocaleDateString('en-CA',{timeZone:TZ})}')::date d, count(*)::int c, sum(impact_minutes)::int m from shift_exceptions where ${prvW} group by 1`);
    ok(label+' | overlay day-by-day vs SQL',ov.every(x=>R.overlay.counts[x.d]===x.c&&R.overlay.impact[x.d]===x.m)&&R.overlay.counts.filter(x=>x>0).length===ov.length);
  }
  console.log(`  ${label}: cur ${R.cur.total} / prev ${R.prev.total}, ${C.status}, ${C.attention.length} statement(s), ${C.candidateCount} candidates`);
}
console.log(`PASS=${PASS} FAIL=${FAIL}`);
