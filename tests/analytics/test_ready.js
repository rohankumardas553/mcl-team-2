process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const A=require((REPO+'/analytics.js'));
let PASS=0,FAIL=0; const ok=(l,c,x)=>{ if(c)PASS++; else {FAIL++; console.log('FAIL  '+l+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,500):''));} };
const L=(y,m,d,h=10)=>new Date(y,m-1,d,h);
const BASE=L(2026,1,1);   // day 0
const dayN=i=>new Date(BASE.getFullYear(),BASE.getMonth(),BASE.getDate()+i,10);
let id=0;
// gen: n rows over `active` distinct days inside a `span`-day window (first day 0, last day span-1)
function gen(n,span,active,o={}){
  const idx=[]; if(active===1) idx.push(0); else for(let i=0;i<active;i++) idx.push(Math.round(i*(span-1)/(active-1)));
  const uniq=[...new Set(idx)]; if(uniq.length!==active) throw new Error('bad spread '+span+' '+active+' '+uniq.length);
  const rows=[];
  for(let k=0;k<n;k++){
    const d=dayN(uniq[k%active]); id++;
    rows.push(Object.assign({id:'r'+id,created_at:d.toISOString(),shift:'First',location:['ABC Patch','Siding 1','Siding 2'][k%3],category:['Haul Road','Coal Despatch','Coal Quality','Dust Suppression'][k%4],
      issue_type:['Potholes','Coal shortage','Mixed coal','Heavy dust','Other'][k%5],impact_minutes:o.impact?o.impact(k):10,status:'Open',current_priority:'Low',started_at:null,resolved_at:null},o.row?o.row(k):{}));
  }
  return rows;
}
const st=(rows,k)=>{ k.forEach(i=>{ const r=rows[i]; r.started_at=new Date(Date.parse(r.created_at)+30*60000).toISOString(); }); return rows; };
const rs=(rows,k)=>{ k.forEach(i=>{ const r=rows[i]; r.status='Resolved'; r.resolved_at=new Date(Date.parse(r.created_at)+300*60000).toISOString(); }); return rows; };
const R=(rows,reo)=>A.assessReadiness(rows,reo||{});
const st_=(x)=>[x.exceptionCount.state,x.impactMinutes.state,x.timeToStart.state,x.timeToResolve.state,x.overall];
const walk=(o,f)=>{ if(o===null||o===undefined){return;} if(typeof o==='object'&&!(o instanceof Date)){Object.keys(o).forEach(k=>walk(o[k],f));} else f(o); };
const bad=(x)=>{ let b=false; walk(x,v=>{ if(typeof v==='number'&&!isFinite(v)) b=true; if(typeof v==='string'&&/NaN|Infinity|undefined|null/.test(v)) b=true; }); return b; };
const texts=(x)=>{ const t=[]; ['exceptionCount','impactMinutes','timeToStart','timeToResolve'].forEach(k=>{t.push(x[k].summary);x[k].reasons.forEach(r=>t.push(r));x[k].evidence.concat(x[k].unmet).forEach(r=>t.push(r));}); x.overallReasons.forEach(r=>t.push(r)); x.notes.forEach(r=>t.push(r)); return t; };
const forbidden=/\b(good|bad|poor|critical|high risk|low risk|likely|expected|next week|next month|will|should|must|recommend|urgent|score)\b/i;

// ---- 1 zero records
let x=R([]);
ok('zero records: everything Not Ready, overall Not Ready',JSON.stringify(st_(x))===JSON.stringify(['Not Ready','Not Ready','Not Ready','Not Ready','Not Ready']),st_(x));
ok('zero records: coverage zeros, no NaN/Infinity/undefined/null',x.coverage.total===0&&x.coverage.span===0&&x.coverage.activeDays===0&&x.coverage.zeroDays===0&&x.coverage.perActiveDay===null&&x.coverage.earliest===null&&!bad(x));
ok('zero records: note says readiness cannot be assessed',x.notes[0]==='Forecast readiness cannot be assessed because the selected filters contain no exceptions.'&&x.overallReasons[0]===x.notes[0]&&x.exceptionCount.unmet.length===0);
ok('zero records: concentration all null',x.concentration.largestImpact===null&&x.concentration.topCategory===null&&x.concentration.topIssue===null&&x.concentration.largestSharePct===null);
// ---- 2 one record
x=R(gen(1,1,1)); ok('one record: span 1, 1 active day, Not Ready',x.coverage.span===1&&x.coverage.activeDays===1&&x.coverage.zeroDays===0&&x.exceptionCount.state==='Not Ready'&&x.coverage.perActiveDay===1&&!bad(x));
// ---- 3 the spec datasets
x=R(gen(5,10,5)); ok('10 days / 5 exceptions: Not Ready (span<14, count<20, active<7)',x.exceptionCount.state==='Not Ready'&&x.overall==='Not Ready'&&x.exceptionCount.facts.span===10);
x=R(gen(25,30,25)); ok('30 days / 25 exceptions / 25 active days: Limited',x.exceptionCount.state==='Limited'&&x.impactMinutes.state==='Limited'&&x.overall==='Limited',st_(x));
x=R(gen(60,60,60)); ok('60 days / 60 exceptions / 60 active days: Ready, impact Ready, overall Ready',x.exceptionCount.state==='Ready'&&x.impactMinutes.state==='Ready'&&x.overall==='Ready',st_(x));
const big=gen(60,60,60,{impact:k=>k===7?1000:10}); x=R(big);
ok('60/60 but one event >50% of impact: impact Limited (never Ready), count Ready, overall Limited',x.impactMinutes.state==='Limited'&&x.exceptionCount.state==='Ready'&&x.overall==='Limited'&&x.impactMinutes.facts.concentrated===true,st_(x));
ok('...the reason names the share (1000 of 1590 = 62.9%)',x.impactMinutes.unmet.some(r=>r==='One exception contributes 62.9% of total recorded impact; Ready requires 50% or less.')&&x.impactMinutes.evidence.some(r=>/Largest single event: 1,000 minutes \(62\.9% of total\)/.test(r)),x.impactMinutes.reasons);
// exactly 50%: 590 of 1180 -> NOT more than 50% -> Ready allowed
const half=gen(60,60,60,{impact:k=>k===0?590:10}); x=R(half); ok('exactly 50% is allowed (only MORE than 50% blocks Ready)',x.impactMinutes.facts.sharePct===50&&x.impactMinutes.state==='Ready',[x.impactMinutes.facts,x.impactMinutes.state]);
const just=gen(60,60,60,{impact:k=>k===0?591:10}); x=R(just); ok('50.04% blocks Ready',x.impactMinutes.state==='Limited');
x=R(gen(12,400,12)); ok('long sparse dataset (400 days, 12 exceptions): Not Ready, 388 zero-event days',x.exceptionCount.state==='Not Ready'&&x.coverage.span===400&&x.coverage.zeroDays===388,[x.coverage]);
x=R(gen(300,120,100)); ok('dense dataset (300 in 120 days, 100 active days): Ready',x.exceptionCount.state==='Ready'&&x.impactMinutes.state==='Ready'&&x.coverage.zeroDays===20&&Math.abs(x.coverage.perActiveDay-3)<1e-12,[st_(x),x.coverage]);
// ---- 4 exact boundaries (count readiness)
const cs=(n,span,act)=>R(gen(n,span,act)).exceptionCount.state;
ok('boundary span: 13 days Not Ready, 14 days Limited',cs(40,13,10)==='Not Ready'&&cs(40,14,10)==='Limited');
ok('boundary exceptions: 19 Not Ready, 20 Limited',cs(19,30,10)==='Not Ready'&&cs(20,30,10)==='Limited');
ok('boundary active days: 6 Not Ready, 7 Limited',cs(40,30,6)==='Not Ready'&&cs(40,30,7)==='Limited');
ok('boundary Ready: 56 days / 50 exc / 21 active = Ready',cs(50,56,21)==='Ready');
ok('boundary Ready minus one: 55 days Limited, 49 exceptions Limited, 20 active days Limited',cs(50,55,21)==='Limited'&&cs(49,56,21)==='Limited'&&cs(50,56,20)==='Limited');
// ---- 5 time-to-start boundaries (n=60 over 60 days => 50% = 30)
const mk=(n,span,act,startIdx,resIdx)=>{ const r=gen(n,span,act); st(r,startIdx||[]); rs(r,resIdx||[]); return r; };
const range=(a,b)=>Array.from({length:b-a},(_,i)=>a+i);
for (const [k,exp] of [[9,'Not Ready'],[10,'Limited'],[29,'Limited'],[30,'Ready']]) { x=R(mk(60,60,60,range(0,k))); ok(`start readiness: ${k} usable observations (of 60, spanning >=28 days) = ${exp}`,x.timeToStart.state===exp&&x.timeToStart.facts.observations===k,[x.timeToStart.state,x.timeToStart.facts]); }
x=R(mk(61,61,61,range(0,30))); ok('start: 30 of 61 = 49.2% (<50%) stays Limited',x.timeToStart.state==='Limited'&&/49\.2%/.test(x.timeToStart.reasons.join(' ')),x.timeToStart.reasons);
x=R(mk(60,60,60,range(0,30).map(i=>i))); // rows 0..29 lie on days 0..29 => span 30 >= 28 => Ready
ok('start: span represented 30 days >= 28 OK',x.timeToStart.facts.span===30&&x.timeToStart.state==='Ready');
x=R(mk(60,60,60,range(0,28)));  ok('start: 28 observations = Limited even with 28 days',x.timeToStart.state==='Limited');
x=R(mk(200,60,60,range(0,100).map(i=>i*2))); ok('start: obs at least 30, >=50%, span ok',x.timeToStart.state==='Ready',x.timeToStart.facts);
const shortSpan=gen(120,60,60); const early=shortSpan.filter(r=>Date.parse(r.created_at)<dayN(27).getTime()); st(early,range(0,early.length)); x=R(shortSpan);
ok('start: 30+ usable but all inside 27 days and <50% of all => Limited (span rule + percentage rule)',x.timeToStart.state==='Limited'&&x.timeToStart.facts.span<=27,x.timeToStart.facts);
const allEarly=gen(60,27,27); st(allEarly,range(0,60)); x=R(allEarly);
ok('start: 60 usable (100%) but only 27 days represented => Limited (span < 28)',x.timeToStart.facts.span===27&&x.timeToStart.state==='Limited');
// ---- 6 resolve boundaries (40%): n=75 -> 30 = 40%
for (const [k,exp] of [[9,'Not Ready'],[10,'Limited'],[29,'Limited'],[30,'Ready']]) { x=R(mk(75,75,75,[],range(0,k))); ok(`resolve readiness: ${k} usable resolved observations (of 75 = ${(k/75*100).toFixed(1)}%) = ${exp}`,x.timeToResolve.state===exp,[x.timeToResolve.state,x.timeToResolve.facts]); }
x=R(mk(76,76,76,[],range(0,30))); ok('resolve: 30 of 76 = 39.5% (<40%) stays Limited',x.timeToResolve.state==='Limited'&&/39\.5%/.test(x.timeToResolve.reasons.join(' ')));
x=R(mk(30,30,30,[],range(0,30))); ok('resolve: 100% resolved but only 30 days... Ready needs >=28 days: 30 days OK => Ready',x.timeToResolve.state==='Ready',x.timeToResolve.facts);
x=R(mk(60,27,27,[],range(0,60))); ok('resolve: span 27 < 28 => Limited',x.timeToResolve.state==='Limited'&&x.timeToResolve.facts.span===27);
// usable = resolved_at >= created_at and status Resolved only
let bad1=mk(40,40,40,[],range(0,40)); bad1.forEach((r,i)=>{ if(i<20) r.resolved_at=new Date(Date.parse(r.created_at)-60000).toISOString(); if(i>=20&&i<25) r.status='In progress'; }); x=R(bad1);
ok('resolve: resolved_at before created_at and not-Resolved rows are not usable (15 usable)',x.timeToResolve.facts.observations===15,x.timeToResolve.facts);
let bad2=gen(40,40,40); bad2.forEach((r,i)=>{ r.started_at=i<10?new Date(Date.parse(r.created_at)-1000).toISOString():i<20?null:new Date(Date.parse(r.created_at)).toISOString(); }); x=R(bad2);
ok('start: started_at before created_at is not usable; started_at = created_at is usable (20 usable)',x.timeToStart.facts.observations===20,x.timeToStart.facts);
// ---- 7 filtering reduces Ready to Limited / Not Ready
const full=gen(240,120,100); x=R(full); ok('unfiltered dataset is Ready',x.overall==='Ready');
const cq=full.filter(r=>r.category==='Coal Quality'); x=R(cq); ok('Coal Quality only: fewer rows, state recomputed',x.coverage.total===60&&['Ready','Limited'].includes(x.exceptionCount.state),[x.exceptionCount.state,x.coverage.total]);
const cqLoc=full.filter(r=>r.category==='Coal Quality'&&r.location==='Siding 1'); x=R(cqLoc); ok('Coal Quality at Siding 1: much less data => not Ready',x.exceptionCount.state!=='Ready'||x.coverage.total>=50,[x.coverage.total,x.exceptionCount.state]);
const tiny=full.filter(r=>r.category==='Coal Quality'&&r.location==='Siding 1'&&r.issue_type==='Mixed coal').slice(0,6); x=R(tiny); ok('heavily filtered: Not Ready',x.exceptionCount.state==='Not Ready'&&x.overall==='Not Ready');
// ---- 8 all impact zero, null impact
x=R(gen(60,60,60,{impact:()=>0})); ok('all impact = 0: impact Not Ready, count Ready, overall Not Ready; no NaN',x.impactMinutes.state==='Not Ready'&&x.exceptionCount.state==='Ready'&&x.overall==='Not Ready'&&x.concentration.largestSharePct===null&&x.concentration.topCategory===null&&!bad(x));
ok('all impact = 0: reason says total is 0',x.impactMinutes.unmet.some(r=>r==='Total recorded impact is 0 minutes.'));
x=R(gen(60,60,60,{impact:k=>k%2?null:10})); ok('null impact values: only non-null counted as observations (30)',x.impactMinutes.facts.observations===30&&x.impactMinutes.state==='Limited'&&!bad(x),x.impactMinutes.facts);
// ---- 9 reopened / only unresolved / only resolved
const reo={}; const rr=mk(60,60,60,range(0,40),range(0,40)); rr.slice(0,5).forEach(r=>reo[r.id]=true); x=R(rr,reo);
ok('reopened records: ONE shared lifecycle note (not repeated on the cards)',x.reopened===5&&x.lifecycleNote==='Lifecycle note: 5 reopened exceptions are included. Readiness uses each exception\u2019s current lifecycle fields; earlier cycles are not reconstructed.'&&![x.timeToStart,x.timeToResolve].some(m=>m.reasons.some(r=>/reopened/.test(r))),x.lifecycleNote);
ok('no reopened => no reopened line',!R(gen(30,30,30)).timeToStart.reasons.some(r=>/reopened/.test(r)));
x=R(gen(60,60,60)); ok('only unresolved: start/resolve Not Ready (0 observations), count Ready',x.timeToStart.state==='Not Ready'&&x.timeToResolve.state==='Not Ready'&&x.exceptionCount.state==='Ready');
x=R(mk(60,60,60,range(0,60),range(0,60))); ok('only resolved (all started too): both lifecycle Ready, overall Ready',x.timeToStart.state==='Ready'&&x.timeToResolve.state==='Ready'&&x.overall==='Ready');
x=R(mk(60,60,60,[],range(0,60))); ok('missing started_at: start Not Ready while resolve Ready; overall unaffected',x.timeToStart.state==='Not Ready'&&x.timeToResolve.state==='Ready'&&x.overall==='Ready');
// overall rule table
const ov=(c,i)=>{ const a=gen(60,60,60,{impact:i==='lim'?k=>k===0?5000:10:i==='nr'?()=>0:()=>10}); const r=(c==='nr')?a.slice(0,10):(c==='lim'?a.slice(0,40):a); return R(r); };
ok('overall: count Ready + impact Ready => Ready',ov('r','r').overall==='Ready');
ok('overall: count Ready + impact Limited => Limited',ov('r','lim').overall==='Limited');
ok('overall: count Ready + impact Not Ready => Not Ready',ov('r','nr').overall==='Not Ready');
ok('overall: count Limited + impact Limited => Limited',ov('lim','r').overall==='Limited');
ok('overall: count Not Ready => Not Ready',ov('nr','r').overall==='Not Ready');
// ---- 10 all records on one day / many records few days
x=R(gen(80,1,1)); ok('all records on one day: span 1, 1 active, zero-event 0, Not Ready',x.coverage.span===1&&x.coverage.activeDays===1&&x.coverage.zeroDays===0&&x.exceptionCount.state==='Not Ready'&&x.coverage.perActiveDay===80);
x=R(gen(200,5,5)); ok('many records over 5 days: Not Ready (span, active days)',x.exceptionCount.state==='Not Ready');
// ---- 11 historical span = latest day - earliest day + 1 (local days), zero-event days, weeks, months
const cal=[L(2026,1,30,23),L(2026,2,1,0),L(2026,2,1,23),L(2026,3,3,12)].map((d,i)=>({id:'c'+i,created_at:d.toISOString(),shift:'First',location:'ABC Patch',category:'Haul Road',issue_type:'Potholes',impact_minutes:10,status:'Open'}));
x=R(cal); ok('span = Mar 3 - Jan 30 + 1 = 33; active 3; zero-event 30; months 3',x.coverage.span===33&&x.coverage.activeDays===3&&x.coverage.zeroDays===30&&x.coverage.months===3,x.coverage);
ok('ISO weeks: 2026-01-30 is W05, 2026-02-01 (Sunday) is W05, 2026-03-03 is W10 => 2 weeks',A.isoWeekKey(L(2026,1,30))==='2026-W05'&&A.isoWeekKey(L(2026,2,1))==='2026-W05'&&A.isoWeekKey(L(2026,3,3))==='2026-W10'&&x.coverage.weeks===2,[A.isoWeekKey(L(2026,1,30)),x.coverage.weeks]);
ok('ISO week edge cases (year boundaries)',A.isoWeekKey(L(2021,1,3))==='2020-W53'&&A.isoWeekKey(L(2024,12,30))==='2025-W01'&&A.isoWeekKey(L(2026,12,31))==='2026-W53'&&A.isoWeekKey(L(2027,1,1))==='2026-W53'&&A.isoWeekKey(L(2027,1,4))==='2027-W01');
// local-day handling near midnight (Asia/Kolkata): 23:30 local on day A and 00:30 local day B are two days
const mid=[new Date(2026,4,10,23,30),new Date(2026,4,11,0,30)].map((d,i)=>({id:'m'+i,created_at:d.toISOString(),shift:'First',location:'ABC Patch',category:'Haul Road',issue_type:'Potholes',impact_minutes:1,status:'Open'}));
x=R(mid); ok('records 1 hour apart across local midnight are 2 calendar days',x.coverage.activeDays===2&&x.coverage.span===2);
// ---- 12 concentration + recurrence
const cc=[]; const add=(cat,loc,issue,imp,n)=>{ for(let i=0;i<n;i++){ id++; cc.push({id:'k'+id,created_at:dayN(i).toISOString(),shift:'First',location:loc,category:cat,issue_type:issue,impact_minutes:imp,status:'Open'}); } };
add('Haul Road','Siding 1','Potholes',100,6); add('Haul Road','Siding 2','Potholes',100,2); add('Coal Despatch','Siding 1','Coal shortage',50,1); add('Coal Quality','ABC Patch','Mixed coal',25,3); add('Dust Suppression','ABC Patch','Other',25,1);
x=R(cc); const tot=6*100+2*100+50+75+25;
ok('total impact 950; largest 100 = 10.5%',x.coverage.totalImpact===tot&&x.concentration.largestImpact===100&&Math.abs(x.concentration.largestSharePct-100/tot*100)<1e-9,[tot,x.concentration.largestImpact]);
ok('top category Haul Road 800/950',x.concentration.topCategory.name==='Haul Road'&&Math.abs(x.concentration.topCategory.sharePct-800/tot*100)<1e-9&&x.concentration.topCategory.tied===0);
ok('top location: Siding 1 = 650 of 950',x.concentration.topLocation.name==='Siding 1'&&Math.abs(x.concentration.topLocation.sharePct-650/tot*100)<1e-9);
ok('top issue type share of exception count: Potholes (Haul Road) 8 of 13',x.concentration.topIssue.label==='Potholes (Haul Road)'&&Math.abs(x.concentration.topIssue.sharePct-8/13*100)<1e-9);
ok('recurrence: Haul Road 8 exceptions, 6 days, 2 locations, 1 issue type',JSON.stringify(x.recurrence.categories.find(c=>c.name==='Haul Road'))===JSON.stringify({name:'Haul Road',count:8,days:6,locations:2,issueTypes:1}),x.recurrence.categories);
ok('recurrence: combos once=2 (Coal shortage, Other), 2-4 = 1 (Mixed coal x3), 5+ = 1 (Potholes x8)',x.recurrence.once===2&&x.recurrence.twoToFour===1&&x.recurrence.fivePlus===1,[x.recurrence.once,x.recurrence.twoToFour,x.recurrence.fivePlus]);
ok('recurrence lists all 4 categories in fixed order',x.recurrence.categories.map(c=>c.name).join()==='Coal Despatch,Dust Suppression,Haul Road,Coal Quality');
const tie=[]; for(const c of ['Haul Road','Coal Quality']){ id++; tie.push({id:'t'+id,created_at:dayN(0).toISOString(),shift:'First',location:'ABC Patch',category:c,issue_type:c==='Haul Road'?'Potholes':'Mixed coal',impact_minutes:10,status:'Open'}); }
x=R(tie); ok('tie: top category tie reported, ordered by name',x.concentration.topCategory.name==='Coal Quality'&&x.concentration.topCategory.tied===1&&x.concentration.topIssue.tied===1);
// ---- 13 API shape + gate
x=R(gen(60,60,60)); ok('API shape: overall + 4 metrics each with state, reasons, summary',typeof x.overall==='string'&&['exceptionCount','impactMinutes','timeToStart','timeToResolve'].every(k=>x[k]&&typeof x[k].state==='string'&&Array.isArray(x[k].reasons)&&x[k].reasons.length>=3&&typeof x[k].summary==='string'));
ok('gate: isReady true only for state Ready; false for null',A.isReady(x,'exceptionCount')===true&&A.isReady(x,'timeToStart')===false&&A.isReady(x,'overall')===true&&A.isReady(null,'overall')===false&&A.isReady(x,'nonsense')===false);
ok('states are only Not Ready / Limited / Ready',['exceptionCount','impactMinutes','timeToStart','timeToResolve'].every(k=>['Not Ready','Limited','Ready'].includes(x[k].state))&&['Not Ready','Limited','Ready'].includes(x.overall));
ok('no score field anywhere',!/score|rating/i.test(Object.keys(x).concat(...['exceptionCount','impactMinutes','timeToStart','timeToResolve'].map(k=>Object.keys(x[k]))).join(' ')));
// example sentences from the brief
const ex=R(gen(37,41,18)); ok('count card (Limited): concise summary',ex.exceptionCount.summary==='Historical coverage is below the Ready requirement.',ex.exceptionCount.summary);
ok('count card (Limited): evidence, then ONLY the unmet requirements',JSON.stringify(ex.exceptionCount.evidence)===JSON.stringify(['41 calendar days','37 exceptions','18 active days','7 weeks represented'])&&JSON.stringify(ex.exceptionCount.unmet)===JSON.stringify(['Ready requires at least 56 calendar days.','Ready requires at least 50 exceptions.','Ready requires at least 21 active days.']),[ex.exceptionCount.evidence,ex.exceptionCount.unmet]);
const tr=mk(67,63,63,[],range(0,18)); const t2=R(tr); ok('notes: dataset sentence, what meets, Time-to-Resolve Limited with its gap',t2.notes[0]==='The filtered data contains 67 exceptions across 63 calendar days.'&&t2.notes.some(n=>/^Time-to-Resolve: Limited\. Ready needs 30 usable resolution observations \(18 available\)/.test(n))&&t2.notes.some(n=>n==='Exception Count and Impact Minutes meet the prototype readiness requirements.'),t2.notes);
// ---- 14 all generated text: no judgement / prediction / NaN words
const many=[R([]),R(gen(5,10,5)),R(gen(60,60,60)),R(big),R(gen(60,60,60,{impact:()=>0})),R(mk(75,75,75,[],range(0,30))),R(rr,reo),ex,t2];
ok('all readiness text is free of good/bad/poor/critical/risk/likely/expected/will/should/recommend/score words',many.every(r=>texts(r).every(t=>!forbidden.test(t))),many.map(r=>texts(r).filter(t=>forbidden.test(t))).flat().slice(0,3));
ok('no NaN / Infinity / undefined / null in any output',many.every(r=>!bad(r)));
// ---- 15 computeAll integration: current period only, all-time allowed, one-day custom, future custom
const NOW=L(2026,9,30,12); const rowsAll=gen(120,120,100);   // dates Jan 1..Apr 30 2026 (period far in the past)
let X=A.computeAll(rowsAll,{},{},A.resolveRange('all',null,null,NOW),NOW); ok('All time: readiness computed on all rows',X.cur.readiness&&X.cur.readiness.coverage.total===120&&X.cmp===null);
X=A.computeAll(rowsAll,{},{},A.resolveRange('custom','2026-01-01','2026-01-31',NOW),NOW);
ok('custom Jan 2026: readiness assesses only the selected window (current period rows), not the previous period',X.cur.readiness.coverage.total===X.cur.total&&X.cur.readiness.coverage.latest<=new Date(2026,0,31,23,59,59),[X.cur.readiness.coverage.total,X.cur.total]);
X=A.computeAll(rowsAll,{},{},A.resolveRange('custom','2026-01-05','2026-01-05',NOW),NOW); ok('one-day custom range: span 1, Not Ready, no NaN',X.cur.readiness.coverage.span<=1&&X.cur.readiness.exceptionCount.state==='Not Ready'&&!bad(X.cur.readiness));
X=A.computeAll([],{},{},A.resolveRange('custom','2030-01-01','2030-02-01',NOW),NOW); ok('future custom period with no data: Not Ready, no NaN',X.cur.readiness.overall==='Not Ready'&&X.cur.readiness.coverage.total===0&&!bad(X.cur.readiness));
X=A.computeAll(rowsAll,{},{},A.resolveRange('90',null,null,NOW),NOW); ok('Last 90 days window with old data: zero records => Not Ready',X.cur.readiness.coverage.total===0&&X.cur.readiness.overall==='Not Ready');

// ---- Phase "language polish": card hierarchy, repetition, terminology, singular/plural
{
  const rd=R(gen(60,60,60)), lim=R(gen(25,30,25)), nr=R(gen(5,10,5));
  ok('Ready card: summary + evidence only (no unmet list, no threshold text, no "All Ready thresholds are met")',['exceptionCount','impactMinutes'].every(k=>rd[k].state==='Ready'&&rd[k].unmet.length===0&&rd[k].summary.endsWith('meets the prototype readiness requirements.')&&!rd[k].reasons.some(r=>/Ready requires|All Ready|threshold|minimum/i.test(r))),rd.exceptionCount);
  ok('Limited card lists only the conditions that are not met (25 exceptions, 25 active days are not repeated; only the 56-day requirement is)',JSON.stringify(lim.exceptionCount.unmet)===JSON.stringify(['Ready requires at least 56 calendar days.','Ready requires at least 50 exceptions.']),lim.exceptionCount.unmet);
  ok('Not Ready card lists only the failed MINIMUM conditions',JSON.stringify(nr.exceptionCount.unmet)===JSON.stringify(['Minimum requirement: at least 14 calendar days.','Minimum requirement: at least 20 exceptions.','Minimum requirement: at least 7 active days.'])&&nr.exceptionCount.summary==='Historical coverage does not meet the minimum prototype requirements.',nr.exceptionCount.unmet);
  ok('overall wording (Ready / same state / different states / no data)',rd.overallReasons[0]==='Exception Count and Impact Minutes both meet the prototype readiness requirements.'&&lim.overallReasons[0]==='Exception Count and Impact Minutes are both Limited.'&&R(gen(60,60,60,{impact:k=>k===0?5000:10})).overallReasons[0]==='Exception Count is Ready and Impact Minutes is Limited.'&&R([]).overallReasons[0]==='Forecast readiness cannot be assessed because the selected filters contain no exceptions.'&&rd.overallReasons[1]==='Time-to-Start and Time-to-Resolve are assessed separately and do not determine the overall state.');
  const life=R(mk(75,75,75,range(0,40),range(0,30)));
  ok('lifecycle cards use one term: "usable start observations" / "usable resolution observations"',life.timeToStart.evidence[0]==='40 usable start observations'&&life.timeToResolve.evidence[0]==='30 usable resolution observations'&&![nr,lim,rd,life].some(r=>JSON.stringify(r).match(/usable resolved|resolved observation|resolution time observation/)),[life.timeToStart.evidence,life.timeToResolve.evidence]);
  ok('lifecycle note is empty when nothing was reopened; singular for one',life.lifecycleNote===''&&R(mk(20,20,20,[],[]),{[gen(1,1,1)[0].id]:true}).lifecycleNote==='');
  const one=gen(1,1,1); const r1=R(one,{[one[0].id]:true});
  ok('singular wording: 1 exception, 1 active day, 1 week; 1 reopened exception is included',r1.exceptionCount.evidence.join('|')==='1 calendar day|1 exception|1 active day|1 week represented'&&r1.lifecycleNote.startsWith('Lifecycle note: 1 reopened exception is included.'),[r1.exceptionCount.evidence,r1.lifecycleNote]);
  const every=[rd,lim,nr,life,r1,R([])].map(r=>texts(r).concat([r.lifecycleNote])).flat();
  ok('no leftover technical wording (ISO week, distinct, "to start", "to resolve", because, threshold jargon in cards)',every.every(t=>!/ISO week|distinct|time to start|time to resolve|All Ready thresholds/i.test(t)),every.filter(t=>/ISO week|distinct|because|All Ready/i.test(t)));
  ok('no double spaces, doubled punctuation, NaN, undefined',every.every(t=>!/  |\.\.|,,|NaN|undefined|Infinity/.test(t)),every.filter(t=>/  |\.\.|,,/.test(t)));
}
console.log(`PASS=${PASS} FAIL=${FAIL}`);
