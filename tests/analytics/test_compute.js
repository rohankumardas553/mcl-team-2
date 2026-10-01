process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const cp=require('child_process');
const A=require((REPO+'/analytics.js'));
const psql=sql=>{const r=cp.spawnSync('psql',['-h',PGHOST,'-p',PGPORT,'-U','postgres','-q','-At','-d','ms','-c',sql],{encoding:'utf8',maxBuffer:1<<28}); if(r.status){throw new Error(r.stderr)} return r.stdout.trim();};
const J=sql=>JSON.parse(psql(`select coalesce(jsonb_agg(t),'[]'::jsonb)::text from (${sql}) t`));
let PASS=0,FAIL=0; const ok=(l,c,x)=>{ if(c)PASS++; else {FAIL++; console.log('FAIL  '+l+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,300):''));} };
const near=(a,b)=>a===null||b===null? a===b : Math.abs(a-b)<1e-3;
const now=new Date();
const scenarios=[
 ['7',null,null,{}],['30',null,null,{}],['90',null,null,{}],['all',null,null,{}],
 ['custom','2026-07-01','2026-08-15',{}],['custom','2026-01-01','2026-12-31',{}],['custom','2026-09-30','2026-09-30',{}],
 ['30',null,null,{shift:'Night'}],['all',null,null,{category:'Haul Road'}],['90',null,null,{location:'Siding 1'}],
 ['all',null,null,{shift:'First',category:'Coal Despatch',location:'ABC Patch'}],['all',null,null,{category:'Coal Quality',location:'Haul Road A'}],
 ['custom','2030-01-01','2030-02-01',{}],['7',null,null,{category:'Dust Suppression',shift:'Second'}]];
for (const [preset,f,t,fl] of scenarios) {
  const label=`${preset}${f?` ${f}..${t}`:''} ${JSON.stringify(fl)}`;
  const range=A.resolveRange(preset,f,t,now);
  if(range.error){ok(label+' range',false,range.error);continue;}
  const where=[]; if(range.from) where.push(`created_at >= '${range.from.toISOString()}'`); if(range.to) where.push(`created_at < '${range.to.toISOString()}'`);
  if(fl.shift) where.push(`shift='${fl.shift}'`); if(fl.category) where.push(`category='${fl.category}'`); if(fl.location) where.push(`location='${fl.location}'`);
  const W=where.length?'where '+where.join(' and '):'';
  const rows=J(`select id,created_at,shift,location,category,issue_type,impact_minutes,status,current_priority,started_at,resolved_at from shift_exceptions ${W}`);
  const reo={},chg={};
  J(`select distinct exception_id, action from exception_audit where action in ('reopened','priority_changed')`).forEach(a=>{ if(a.action==='reopened')reo[a.exception_id]=true; else chg[a.exception_id]=true; });
  const R=A.compute(rows,reo,chg,range,now);
  const Q=(sel,extra='')=>psql(`select ${sel} from shift_exceptions ${W} ${extra}`);
  ok(label+' | total',R.total===+Q('count(*)'));
  ok(label+' | total impact',R.totalImpact===+Q('coalesce(sum(impact_minutes),0)'));
  ok(label+' | avg impact',near(R.avgImpact, R.total? +Q('avg(impact_minutes)'):null));
  const st=psql(`select count(*), avg(extract(epoch from started_at-created_at)/60), percentile_cont(0.5) within group (order by extract(epoch from started_at-created_at)/60) from shift_exceptions ${W} ${where.length?'and':'where'} started_at is not null and started_at>=created_at`).split('|');
  ok(label+' | start n/avg/median',R.timeToStart.n===+st[0]&&near(R.timeToStart.avg,st[1]===''?null:+st[1])&&near(R.timeToStart.median,st[2]===''?null:+st[2]),[R.timeToStart,st]);
  const rs=psql(`select count(*), avg(extract(epoch from resolved_at-created_at)/60), percentile_cont(0.5) within group (order by extract(epoch from resolved_at-created_at)/60) from shift_exceptions ${W} ${where.length?'and':'where'} status='Resolved' and resolved_at is not null and resolved_at>=created_at`).split('|');
  ok(label+' | resolve n/avg/median',R.timeToResolve.n===+rs[0]&&near(R.timeToResolve.avg,rs[1]===''?null:+rs[1])&&near(R.timeToResolve.median,rs[2]===''?null:+rs[2]),[R.timeToResolve,rs]);
  const reoN=+psql(`with f as (select * from shift_exceptions ${W}) select count(*) from f where exists (select 1 from exception_audit a where a.exception_id=f.id and a.action='reopened')`);
  ok(label+' | reopened count',R.reopened===reoN,[R.reopened,reoN]);
  const resN=+Q(`count(*) filter (where status='Resolved')`);
  ok(label+' | % resolved',R.pctResolved===(R.total?(resN/R.total*100).toFixed(1)+'%':null),[R.pctResolved,resN,R.total]);
  ok(label+' | % reopened',R.pctReopened===(R.total?(reoN/R.total*100).toFixed(1)+'%':null));
  const pc=+psql(`with f as (select * from shift_exceptions ${W}) select count(*) from f where exists (select 1 from exception_audit a where a.exception_id=f.id and a.action='priority_changed')`);
  ok(label+' | priority changes',R.priorityChanges===pc);
  for (const p of ['High','Medium','Low']) { const x=psql(`select count(*), coalesce(sum(impact_minutes),0) from shift_exceptions ${W} ${where.length?'and':'where'} current_priority='${p}'`).split('|'); ok(label+` | priority ${p}`,R.priority[p].count===+x[0]&&R.priority[p].minutes===+x[1]); }
  for (const [dim,arr] of [['category',R.byCategory],['location',R.byLocation],['shift',R.byShift]]) {
    const db=J(`select ${dim} as name, count(*)::int as count, sum(impact_minutes)::int as minutes from shift_exceptions ${W} group by 1`); const m={}; db.forEach(x=>m[x.name]=x);
    ok(label+` | by ${dim}`, arr.every(x=>(m[x.name]?m[x.name].count:0)===x.count&&(m[x.name]?m[x.name].minutes:0)===x.minutes), [arr.slice(0,3),db.slice(0,3)]);
  }
  const ti=J(`select issue_type as issue, category, count(*)::int as count, sum(impact_minutes)::int as minutes from shift_exceptions ${W} group by 1,2 order by count(*) desc, sum(impact_minutes) desc, (issue_type||' '||category) collate "C" asc limit 10`);
  ok(label+' | top 10 issue types (order + values)', JSON.stringify(R.topIssues.map(x=>[x.issue,x.category,x.count,x.minutes]))===JSON.stringify(ti.map(x=>[x.issue,x.category,x.count,x.minutes])),[R.topIssues.slice(0,2),ti.slice(0,2)]);
  const hs=J(`select category, location, count(*)::int as count, sum(impact_minutes)::int as minutes from shift_exceptions ${W} group by 1,2 order by sum(impact_minutes) desc, count(*) desc, (category||' '||location) collate "C" asc limit 5`);
  ok(label+' | top 5 hotspots (order + values)', JSON.stringify(R.hotspots.map(x=>[x.category,x.location,x.count,x.minutes]))===JSON.stringify(hs.map(x=>[x.category,x.location,x.count,x.minutes])));
  const cs=J(`select category, issue_type as issue, location, count(*)::int as count, sum(impact_minutes)::int as minutes, count(*) filter (where status='Resolved')::int as resolved,
      count(*) filter (where exists (select 1 from exception_audit a where a.exception_id=shift_exceptions.id and a.action='reopened'))::int as reopened, max(created_at) as last
      from shift_exceptions ${W} group by 1,2,3 order by sum(impact_minutes) desc, count(*) desc, (category||' '||issue_type||' '||location) collate "C" asc limit 15`);
  ok(label+' | constraints top 15 (order + every column)', JSON.stringify(R.constraints.slice(0,15).map(x=>[x.category,x.issue,x.location,x.count,x.minutes,x.resolved,x.reopened,Date.parse(x.last)]))===JSON.stringify(cs.map(x=>[x.category,x.issue,x.location,x.count,x.minutes,x.resolved,x.reopened,Date.parse(x.last)])),[R.constraints[0],cs[0]]);
  ok(label+' | constraint avg impact', R.constraints.every(g=>near(g.avg,g.minutes/g.count)));
  // time series against SQL buckets in local time
  const s=R.series;
  if(R.total){
    const trunc=s.mode==='day'?'day':'month';
    const sq=J(`select to_char(date_trunc('${trunc}', created_at at time zone 'Asia/Kolkata'), '${s.mode==='day'?'YYYY-MM-DD':'YYYY-MM'}') k, count(*)::int c, sum(impact_minutes)::int i from shift_exceptions ${W} group by 1`); const m={}; sq.forEach(x=>m[x.k]=x);
    ok(label+` | series (${s.mode}, ${s.keys.length} buckets) counts+impact`, s.keys.every((k,i)=>(m[k]?m[k].c:0)===s.counts[i]&&(m[k]?m[k].i:0)===s.impact[i])&&Object.keys(m).every(k=>s.keys.indexOf(k)>=0),[s.keys.length,Object.keys(m).length]);
    ok(label+' | series sums equal totals', s.counts.reduce((a,b)=>a+b,0)===R.total&&s.impact.reduce((a,b)=>a+b,0)===R.totalImpact);
    ok(label+' | bucket mode rule (<=90 days daily, longer monthly)', s.mode===(s.keys.length<=90&&s.mode==='day'?'day':s.mode));
  }
}
// bucket-mode boundary checks
const mkRows=(days)=>{const r=[];for(let d=0;d<days;d+=1){r.push({id:'x'+d,created_at:new Date(now.getFullYear(),now.getMonth(),now.getDate()-d,10).toISOString(),shift:'First',location:'Siding 1',category:'Haul Road',issue_type:'Potholes',impact_minutes:10,status:'Open',current_priority:'Low',started_at:null,resolved_at:null});}return r;};
ok('custom 90 days = daily', A.compute(mkRows(90),{},{},A.resolveRange('custom',new Date(now.getTime()-89*864e5).toISOString().slice(0,10),new Date(now.getTime()).toISOString().slice(0,10),now),now).series.mode==='day');
ok('custom 91 days = monthly', A.compute(mkRows(91),{},{},A.resolveRange('custom',new Date(now.getTime()-90*864e5).toISOString().slice(0,10),new Date(now.getTime()).toISOString().slice(0,10),now),now).series.mode==='month');
ok('range errors', A.resolveRange('custom','2026-09-02','2026-09-01',now).error&&A.resolveRange('custom','','',now).error);
console.log(`PASS=${PASS} FAIL=${FAIL}`);
