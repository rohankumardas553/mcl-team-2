process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const cp=require('child_process');
const A=require((REPO+'/analytics.js'));
const psql=sql=>{const r=cp.spawnSync('psql',['-h',PGHOST,'-p',PGPORT,'-U','postgres','-q','-At','-d','ms','-c',sql],{encoding:'utf8',maxBuffer:1<<28}); if(r.status){throw new Error(r.stderr)} return r.stdout.trim();};
const J=sql=>JSON.parse(psql(`select coalesce(jsonb_agg(t),'[]'::jsonb)::text from (${sql}) t`));
let PASS=0,FAIL=0; const ok=(l,c,x)=>{ if(c)PASS++; else {FAIL++; console.log('FAIL  '+l+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,400):''));} };
const TZ='Asia/Kolkata', now=new Date();
const near=(a,b)=>a===null||b===null?a===b:Math.abs(a-b)<1e-9;
const scen=[['7',null,null,{}],['30',null,null,{}],['90',null,null,{}],['all',null,null,{}],['custom','2026-08-01','2026-08-31',{}],['custom','2026-09-15','2026-09-15',{}],['custom','2025-09-01','2026-02-28',{}],['custom','2030-01-01','2030-02-01',{}],
 ['all',null,null,{category:'Coal Quality'}],['all',null,null,{category:'Coal Quality',location:'Siding 1'}],['all',null,null,{category:'Haul Road',shift:'Night',location:'Haul Road A'}],['30',null,null,{shift:'Night'}],['90',null,null,{category:'Dust Suppression'}],['all',null,null,{category:'Coal Despatch',location:'Stockyard 1',shift:'Second'}],['custom','2025-08-20','2025-09-10',{}],['7',null,null,{location:'Siding 2',category:'Coal Quality'}]];
function expState(span,n,act){ const nr=span<14||n<20||act<7; const rd=span>=56&&n>=50&&act>=21; return nr?'Not Ready':rd?'Ready':'Limited'; }
function lifeState(k,n,sp,T){ return k<10?'Not Ready':(k>=30&&k*100>=T*n&&sp>=28)?'Ready':'Limited'; }
for(const [preset,f,t,fl] of scen){
  const label=`${preset}${f?` ${f}..${t}`:''} ${JSON.stringify(fl)}`;
  const range=A.resolveRange(preset,f,t,now);
  const w=[]; if(range.from) w.push(`created_at >= '${range.from.toISOString()}'`); if(range.to) w.push(`created_at < '${range.to.toISOString()}'`);
  if(fl.shift) w.push(`shift='${fl.shift}'`); if(fl.category) w.push(`category='${fl.category}'`); if(fl.location) w.push(`location='${fl.location}'`);
  const W=w.length?w.join(' and '):'true';
  const rows=J(`select id,created_at,shift,location,category,issue_type,impact_minutes,status,current_priority,started_at,resolved_at from shift_exceptions where ${W}`);
  const reo={}; J(`select distinct exception_id from exception_audit where action='reopened'`).forEach(a=>reo[a.exception_id]=true);
  const X=A.computeAll(rows,reo,{},range,now); const R=X.cur.readiness;
  const D=`(created_at at time zone '${TZ}')::date`;
  const base=J(`select count(*)::int n, coalesce((max(${D})-min(${D})+1),0)::int span, count(distinct ${D})::int act, count(distinct to_char(${D},'IYYY-"W"IW'))::int wk, count(distinct to_char(${D},'YYYY-MM'))::int mo,
     coalesce(sum(impact_minutes),0)::int tot, coalesce(max(impact_minutes),0)::int big, count(impact_minutes)::int obs, min(created_at) mn, max(created_at) mx from shift_exceptions where ${W}`)[0];
  const C=R.coverage;
  ok(label+' | count / span / active days / weeks / months / zero-event days',C.total===base.n&&C.span===base.span&&C.activeDays===base.act&&C.weeks===base.wk&&C.months===base.mo&&C.zeroDays===base.span-base.act,[C,base]);
  ok(label+' | earliest / latest / total impact / per active day',(base.n?C.earliest.getTime()===Date.parse(base.mn)&&C.latest.getTime()===Date.parse(base.mx):C.earliest===null)&&C.totalImpact===base.tot&&near(C.perActiveDay,base.act?base.n/base.act:null));
  // concentration
  const K=R.concentration;
  ok(label+' | largest impact and share',K.largestImpact===(base.n?base.big:null)&&near(K.largestSharePct,base.tot>0?base.big/base.tot*100:null),[K.largestImpact,base.big]);
  const tc=J(`select category name, sum(impact_minutes)::int m from shift_exceptions where ${W} group by 1 order by sum(impact_minutes) desc, category collate "C" limit 2`);
  ok(label+' | top category share',base.tot>0?(K.topCategory.name===tc[0].name&&near(K.topCategory.sharePct,tc[0].m/base.tot*100)&&K.topCategory.tied===(tc[1]&&tc[1].m===tc[0].m?1:0)||K.topCategory.tied>=1):K.topCategory===null,[K.topCategory,tc]);
  const tl=J(`select location name, sum(impact_minutes)::int m from shift_exceptions where ${W} group by 1 order by sum(impact_minutes) desc, location collate "C" limit 1`);
  ok(label+' | top location share',base.tot>0?(K.topLocation.name===tl[0].name&&near(K.topLocation.sharePct,tl[0].m/base.tot*100)):K.topLocation===null);
  const ti=J(`select issue_type||' ('||category||')' label, count(*)::int c from shift_exceptions where ${W} group by category, issue_type order by count(*) desc, (issue_type||' ('||category||')') collate "C" limit 1`);
  ok(label+' | top issue type share of exception count',base.n?(K.topIssue.label===ti[0].label&&near(K.topIssue.sharePct,ti[0].c/base.n*100)):K.topIssue===null,[K.topIssue,ti]);
  // recurrence
  const rc=J(`select category, count(*)::int c, count(distinct ${D})::int d, count(distinct location)::int l, count(distinct issue_type)::int i from shift_exceptions where ${W} group by 1`); const rm={}; rc.forEach(x=>rm[x.category]=x);
  ok(label+' | recurrence per category (exceptions, days, locations, issue types)',R.recurrence.categories.every(c=>{const e=rm[c.name]||{c:0,d:0,l:0,i:0}; return c.count===e.c&&c.days===e.d&&c.locations===e.l&&c.issueTypes===e.i;}),[R.recurrence.categories,rc]);
  const cb=J(`select count(*) filter (where c=1)::int once_, count(*) filter (where c between 2 and 4)::int mid_, count(*) filter (where c>=5)::int many_ from (select count(*) c from shift_exceptions where ${W} group by category, issue_type) g`)[0];
  ok(label+' | combinations once / 2-4 / 5+',R.recurrence.once===cb.once_&&R.recurrence.twoToFour===cb.mid_&&R.recurrence.fivePlus===cb.many_,[R.recurrence,cb]);
  // lifecycle
  const life=(cond)=>J(`select count(*)::int k, coalesce((max(${D})-min(${D})+1),0)::int sp from shift_exceptions where ${W} and ${cond}`)[0];
  const sv=life(`started_at is not null and started_at >= created_at`), rv=life(`status='Resolved' and resolved_at is not null and resolved_at >= created_at`);
  ok(label+' | start observations, span',R.timeToStart.facts.observations===sv.k&&R.timeToStart.facts.span===sv.sp&&near(R.timeToStart.facts.pctOfExceptions,base.n?sv.k/base.n*100:null),[R.timeToStart.facts,sv]);
  ok(label+' | resolve observations, span',R.timeToResolve.facts.observations===rv.k&&R.timeToResolve.facts.span===rv.sp&&near(R.timeToResolve.facts.pctOfExceptions,base.n?rv.k/base.n*100:null),[R.timeToResolve.facts,rv]);
  // states, from the independently derived numbers
  const cs=expState(base.span,base.n,base.act);
  const is=base.tot===0?'Not Ready':(()=>{const s=expState(base.span,base.obs,base.act); return s==='Ready'&&base.big*2>base.tot?'Limited':s;})();
  const ss=lifeState(sv.k,base.n,sv.sp,50), rs=lifeState(rv.k,base.n,rv.sp,40);
  ok(label+` | states count=${cs} impact=${is} start=${ss} resolve=${rs}`,R.exceptionCount.state===cs&&R.impactMinutes.state===is&&R.timeToStart.state===ss&&R.timeToResolve.state===rs,[R.exceptionCount.state,R.impactMinutes.state,R.timeToStart.state,R.timeToResolve.state]);
  const ov=(cs==='Ready'&&is==='Ready')?'Ready':(cs==='Not Ready'||is==='Not Ready')?'Not Ready':'Limited';
  ok(label+' | overall = '+ov,R.overall===ov);
  ok(label+' | no NaN / Infinity / undefined',!/NaN|Infinity|undefined/.test(JSON.stringify(R,(k,v)=>typeof v==='number'&&!isFinite(v)?'NaN':v)));
  // readiness uses the CURRENT period rows only (computeAll splits off the previous period)
  ok(label+' | readiness counts only the current period rows',R.coverage.total===X.cur.total);
  console.log(`  ${label}: n=${base.n} span=${base.span} active=${base.act} -> ${cs}/${is}/${ss}/${rs}, overall ${ov}`);
}
console.log(`PASS=${PASS} FAIL=${FAIL}`);
