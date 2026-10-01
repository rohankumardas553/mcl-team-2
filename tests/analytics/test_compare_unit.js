process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const A=require((REPO+'/analytics.js'));
let PASS=0,FAIL=0; const ok=(l,c,x)=>{ if(c)PASS++; else {FAIL++; console.log('FAIL  '+l+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,600):''));} };
const L=(y,m,d,h=10,mi=0)=>new Date(y,m-1,d,h,mi);
let n=0;
function mk(date,cat,loc,issue,impact,o={}){ n++; return Object.assign({id:'r'+n,created_at:date.toISOString(),shift:'First',location:loc,category:cat,issue_type:issue,impact_minutes:impact,status:'Open',current_priority:'Medium',started_at:null,resolved_at:null},o); }
const NOW=L(2026,9,30,12);
const R7=A.resolveRange('7',null,null,NOW);
const forbidden=/\b(good|bad|healthy|poor|should|must|urgent|critical|failure|best|worst|recommend|will|likely|because)\b/i;

// ---- previousRange
let pr=A.previousRange(R7,NOW);
ok('7 days: 7-day previous, ends where current starts',pr.days===7&&pr.cur.from.getTime()===L(2026,9,24,0).getTime()&&pr.prev.from.getTime()===L(2026,9,17,0).getTime()&&pr.prev.to.getTime()===pr.cur.from.getTime());
pr=A.previousRange(A.resolveRange('30',null,null,NOW),NOW); ok('30 days',pr.days===30&&pr.prev.from.getTime()===L(2026,8,2,0).getTime()&&pr.cur.from.getTime()===L(2026,9,1,0).getTime());
pr=A.previousRange(A.resolveRange('90',null,null,NOW),NOW); ok('90 days',pr.days===90&&pr.prev.to.getTime()===pr.cur.from.getTime());
pr=A.previousRange(A.resolveRange('custom','2026-09-01','2026-09-15',NOW),NOW); ok('custom 15 days',pr.days===15&&pr.prev.from.getTime()===L(2026,8,17,0).getTime()&&pr.prev.to.getTime()===L(2026,9,1,0).getTime()&&pr.cur.to.getTime()===L(2026,9,16,0).getTime());
pr=A.previousRange(A.resolveRange('custom','2026-09-15','2026-09-15',NOW),NOW); ok('custom one day',pr.days===1&&pr.prev.from.getTime()===L(2026,9,14,0).getTime());
pr=A.previousRange(A.resolveRange('custom','2028-03-01','2028-03-31',NOW),NOW); ok('custom across leap February (31 days)',pr.days===31&&pr.prev.from.getTime()===L(2028,1,30,0).getTime());
ok('All time: no previous',A.previousRange(A.resolveRange('all',null,null,NOW),NOW)===null);
ok('invalid custom: no previous',A.previousRange(A.resolveRange('custom','','',NOW),NOW)===null);

// ---- delta rules
let d=A.delta(620,480,0); ok('delta +140, +29.2%',d.abs===140&&d.pct.toFixed(1)==='29.2'&&d.dir==='Increased');
d=A.delta(140,0,0); ok('previous 0: abs kept, pct null (no Infinity)',d.abs===140&&d.pct===null&&d.dir==='Increased');
d=A.delta(0,0,0); ok('0 vs 0: No change, pct null',d.abs===0&&d.pct===null&&d.dir==='No change');
d=A.delta(0,50,0); ok('current 0, previous 50: -50, -100%',d.abs===-50&&d.pct===-100&&d.dir==='Decreased');
d=A.delta(null,50,0); ok('missing value: not available',d.abs===null&&d.pct===null&&d.dir===null);
d=A.delta(10.04,10.0,1); ok('rounded equal at shown precision = No change',d.abs===0&&d.dir==='No change');
d=A.delta(26.1,18.4,1); ok('time change 7.7',Math.abs(d.abs-7.7)<1e-9&&d.dir==='Increased');
d=A.delta(72.4138,66.1,1); ok('percentage points 6.3',Math.abs(d.abs-6.3)<1e-9);

// ---- exact boundaries (custom 2026-09-10..2026-09-12 => previous 2026-09-07..2026-09-09)
const RC=A.resolveRange('custom','2026-09-10','2026-09-12',NOW);
const b=[ mk(new Date(L(2026,9,7,0).getTime()-1),'Haul Road','Siding 1','Potholes',1),     // just before previous: excluded
          mk(L(2026,9,7,0),'Haul Road','Siding 1','Potholes',2),                              // first instant of previous
          mk(new Date(L(2026,9,10,0).getTime()-1),'Haul Road','Siding 1','Potholes',4),       // last instant of previous
          mk(L(2026,9,10,0),'Haul Road','Siding 1','Potholes',8),                             // first instant of current
          mk(new Date(L(2026,9,13,0).getTime()-1),'Haul Road','Siding 1','Potholes',16),      // last instant of current
          mk(L(2026,9,13,0),'Haul Road','Siding 1','Potholes',32) ];                          // just after current: excluded
let X=A.computeAll(b,{},{},RC,NOW);
ok('boundaries: current = 8+16',X.cur.total===2&&X.cur.totalImpact===24,[X.cur.total,X.cur.totalImpact]);
ok('boundaries: previous = 2+4',X.prev.total===2&&X.prev.totalImpact===6,[X.prev.total,X.prev.totalImpact]);
ok('boundaries: nothing counted twice',X.cur.total+X.prev.total===4);

// ---- designed dataset (7 days: current 24-30 Sep, previous 17-23 Sep)
n=0;
const started=(dt,min)=>new Date(dt.getTime()+min*60000).toISOString();
const rows=[];
function add(date,cat,loc,issue,imp,startMin,o={}){ const r=mk(date,cat,loc,issue,imp,o); if(startMin!==null) r.started_at=started(date,startMin); rows.push(r); return r; }
add(L(2026,9,18),'Haul Road','MDP Junction','Potholes',60,20); add(L(2026,9,19),'Haul Road','MDP Junction','Potholes',120,20);
add(L(2026,9,20),'Coal Despatch','Siding 1','Coal shortage',200,20); add(L(2026,9,21),'Coal Despatch','Siding 1','Coal shortage',100,20);
add(L(2026,9,22),'Dust Suppression','ABC Patch','Heavy dust',40,20);
add(L(2026,9,25),'Haul Road','MDP Junction','Potholes',100,30); add(L(2026,9,26),'Haul Road','MDP Junction','Potholes',100,30); add(L(2026,9,27),'Haul Road','MDP Junction','Potholes',110,30);
add(L(2026,9,28),'Coal Despatch','Siding 1','Coal shortage',80,30); add(L(2026,9,29),'Dust Suppression','ABC Patch','Heavy dust',40,30);
X=A.computeAll(rows,{},{},R7,NOW); let C=X.cmp;
ok('designed: status ok, 7 days',C.status==='ok'&&C.days===7);
ok('designed: KPI impact 520 -> 430, -90, -17.3%',C.kpis.impact.prev===520&&C.kpis.impact.cur===430&&C.kpis.impact.abs===-90&&C.kpis.impact.pct.toFixed(1)==='-17.3'&&C.kpis.impact.dir==='Decreased');
ok('designed: KPI total 5 -> 5 No change',C.kpis.total.dir==='No change');
ok('designed: avg impact 104 -> 86',C.kpis.avg.prev===104&&C.kpis.avg.cur===86);
ok('designed: avg start 20.0 -> 30.0, median same',C.kpis.start.prev===20&&C.kpis.start.cur===30&&C.perf.medStart.abs===10);
ok('designed: no resolved anywhere => resolve time not available (no NaN)',C.kpis.resolve.abs===null&&C.perf.medResolve.abs===null);
ok('designed: % resolved 0 vs 0 pp change 0',C.perf.pctResolved.cur===0&&C.perf.pctResolved.abs===0);
const exp=[
 'Total recorded impact minutes decreased from 520 to 430 (-90 minutes, -17.3%).',
 'Impact minutes for Haul Road issues at MDP Junction increased from 180 to 310.',
 'Impact minutes for Coal Despatch issues at Siding 1 decreased from 300 to 80.',
 'Exceptions logged as \u201cPotholes\u201d in the Haul Road category increased from 2 to 3.',
 'Average time from reporting to start of work increased from 20.0 to 30.0 minutes.'];
ok('designed: Strategic Management Attention exact statements',JSON.stringify(C.attention)===JSON.stringify(exp),C.attention);
ok('designed: period named once in the lead-in line',C.attentionLead==='Compared with the previous 7-day period:'&&C.attention.every(x=>!/compared with/i.test(x)));
ok('statements: no advice, cause, prediction or judgement words',C.attention.every(s=>!forbidden.test(s)),C.attention.filter(s=>forbidden.test(s)));
ok('statements: at most 5',C.attention.length<=5);
ok('designed: categories sorted by impact change (largest increase first)',C.categories.map(x=>x.name).join()==='Haul Road,Dust Suppression,Coal Despatch',C.categories.map(x=>x.name));
ok('designed: locations by absolute change',C.locations.map(x=>x.name).join()==='Siding 1,MDP Junction,ABC Patch',C.locations.map(x=>x.name));
ok('designed: improved locations are shown',C.locations.some(x=>x.impact.abs<0));
ok('designed: hotspot increases / decreases',C.hotspotsUp.length===1&&C.hotspotsUp[0].location==='MDP Junction'&&C.hotspotsDown.length===1&&C.hotspotsDown[0].location==='Siding 1');
ok('designed: candidates = Potholes at MDP Junction only (impact and count up)',C.candidates.length===1&&C.candidates[0].issue==='Potholes'&&C.candidates[0].impactChange===130&&C.candidates[0].countChange===1);
ok('designed: overlay length 7',X.overlay&&X.overlay.counts.length===7&&X.overlay.counts.reduce((a,c)=>a+c,0)===5);

// ---- ties
n=0; const t=[];
const tadd=(date,cat,loc,issue,imp)=>t.push(mk(date,cat,loc,issue,imp));
tadd(L(2026,9,18),'Haul Road','Siding 1','Potholes',50); tadd(L(2026,9,18),'Coal Quality','Siding 2','Mixed coal',50);
tadd(L(2026,9,25),'Haul Road','Siding 1','Potholes',100); tadd(L(2026,9,25),'Coal Quality','Siding 2','Mixed coal',100);
C=A.computeAll(t,{},{},R7,NOW).cmp;
ok('ties: hotspot increase tie stated as a tie',C.attention.some(s=>s==='2 category and location combinations share the largest increase in impact minutes, +50 minutes each: Coal Quality issues at Siding 2 and Haul Road issues at Siding 1.'),C.attention);
ok('ties: no invented issue statement when exception counts did not change',!C.attention.some(x=>/recurring|exceptions compared/.test(x)),C.attention);
n=0; const t2=[mk(L(2026,9,18),'Haul Road','Siding 1','Potholes',10),mk(L(2026,9,18),'Coal Quality','Siding 2','Mixed coal',10),
  mk(L(2026,9,25),'Haul Road','Siding 1','Potholes',10),mk(L(2026,9,25),'Haul Road','Siding 1','Potholes',10),mk(L(2026,9,25),'Coal Quality','Siding 2','Mixed coal',10),mk(L(2026,9,26),'Coal Quality','Siding 2','Mixed coal',10)];
const C2=A.computeAll(t2,{},{},R7,NOW).cmp;
ok('ties: issue increase tie stated',C2.attention.some(x=>x==='2 issue types share the largest increase in exceptions, +1 each: \u201cMixed coal\u201d (Coal Quality) and \u201cPotholes\u201d (Haul Road).'),C2.attention);
ok('ties: order deterministic (alphabetical)',C.hotspotsUp.map(x=>x.label).join('|')==='Coal Quality Siding 2|Haul Road Siding 1',C.hotspotsUp.map(x=>x.label));

// ---- previous has no data
n=0; const q=[mk(L(2026,9,26),'Haul Road','Siding 1','Potholes',70,{status:'Resolved',resolved_at:L(2026,9,26,12).toISOString(),started_at:L(2026,9,26,11).toISOString()})];
X=A.computeAll(q,{},{},R7,NOW); C=X.cmp;
ok('previous empty: status no-previous',C.status==='no-previous'&&!C.hasBoth);
ok('previous empty: KPI abs shown, pct null, no Infinity/NaN',C.kpis.impact.abs===70&&C.kpis.impact.pct===null&&C.kpis.total.abs===1&&!/NaN|Infinity/.test(JSON.stringify(C)));
ok('previous empty: attention says no previous-period data',C.attention.length===1&&C.attention[0]==='No previous-period data is available for comparison.');
ok('previous empty: avg times not available',C.kpis.start.abs===null&&C.kpis.start.cur===60&&C.kpis.start.prev===null);
// ---- current empty, previous has data
n=0; const q2=[mk(L(2026,9,20),'Haul Road','Siding 1','Potholes',70)];
X=A.computeAll(q2,{},{},R7,NOW); C=X.cmp;
ok('current empty: status no-current, KPI decrease to 0 (-100%)',C.status==='no-current'&&C.kpis.impact.cur===0&&C.kpis.impact.abs===-70&&C.kpis.impact.pct===-100);
ok('current empty: category/location rows show the decrease',C.categories[0].impact.abs===-70&&C.locations[0].impact.abs===-70&&C.hotspotsDown.length===1&&C.hotspotsUp.length===0&&C.candidates.length===0);
ok('current empty: attention says no exceptions in the selected period',C.attention.length===1&&C.attention[0]==='No exceptions in the selected period.');
ok('both empty: attention says so',A.computeAll([],{},{},R7,NOW).cmp.attention[0]==='No exceptions in the selected period or the previous period.');
// ---- both empty
X=A.computeAll([],{},{},R7,NOW); C=X.cmp;
ok('both empty: status empty, nothing NaN',C.status==='empty'&&!/NaN|Infinity/.test(JSON.stringify(C))&&C.categories.length===0&&C.locations.length===0&&C.candidates.length===0&&C.priority.length===3);
ok('both empty: overlay zeros, length 7',X.overlay.counts.length===7&&X.overlay.counts.every(v=>v===0));
// ---- one-day custom
n=0; const o=[mk(L(2026,9,14,9),'Haul Road','Siding 1','Potholes',10),mk(L(2026,9,15,9),'Haul Road','Siding 1','Potholes',30),mk(L(2026,9,15,20),'Haul Road','Siding 1','Potholes',30)];
X=A.computeAll(o,{},{},A.resolveRange('custom','2026-09-15','2026-09-15',NOW),NOW); C=X.cmp;
ok('one-day custom: current 2 / previous 1 (day before)',X.cur.total===2&&X.prev.total===1&&C.days===1&&C.kpis.impact.abs===50&&C.attentionLead==='Compared with the previous day:');
// ---- reopened and priority changes (audit convention: counted once per exception, audit may be later)
n=0; const w=[mk(L(2026,9,18),'Haul Road','Siding 1','Potholes',10),mk(L(2026,9,19),'Haul Road','Siding 1','Potholes',10),
              mk(L(2026,9,25),'Haul Road','Siding 1','Potholes',10),mk(L(2026,9,26),'Haul Road','Siding 1','Potholes',10),mk(L(2026,9,27),'Haul Road','Siding 1','Potholes',10)];
C=A.computeAll(w,{[w[0].id]:true,[w[2].id]:true,[w[3].id]:true,[w[4].id]:true},{[w[1].id]:true,[w[2].id]:true},R7,NOW).cmp;
ok('reopened: previous 1, current 3, +2 (+200%)',C.kpis.reopened.prev===1&&C.kpis.reopened.cur===3&&C.kpis.reopened.abs===2&&C.kpis.reopened.pct===200);
ok('priority changes: previous 1, current 1, No change',C.priorityChanges.dir==='No change');
ok('reopened pp: 25%.. 100% : previous 50.0 -> current 100.0',C.perf.pctReopened.prev===50&&C.perf.pctReopened.cur===100&&C.perf.pctReopened.abs===50&&C.perf.pctReopened.pct===null);
ok('candidate reopened increase counted',C.candidates.length===1&&C.candidates[0].reopenChange===2);
// ---- candidate ordering
n=0; const cs=[
 mk(L(2026,9,18),'Haul Road','Siding 1','A',100),                                      // prev
 mk(L(2026,9,25),'Haul Road','Siding 1','A',200),                                      // +100 impact
 mk(L(2026,9,25),'Coal Quality','Siding 2','B',100), mk(L(2026,9,26),'Coal Quality','Siding 2','B',0),   // +100 impact, +2 count
 mk(L(2026,9,27,8),'Dust Suppression','ABC Patch','C',5),                              // +5
 mk(L(2026,9,28,8),'Dust Suppression','XYZ Patch','D',5)];                             // +5 same count, later
C=A.computeAll(cs,{},{},R7,NOW).cmp;
ok('candidates sort: impact desc, count desc, then latest occurrence desc',C.candidates.map(x=>x.issue).join()==='B,A,D,C',C.candidates.map(x=>x.issue));
ok('candidate rows have latest occurrence',C.candidates.every(x=>!isNaN(Date.parse(x.last))));
// 20 groups => top 15 with the count kept
n=0; const many2=[mk(L(2026,9,18),'Haul Road','Siding 1','Z',1)]; for(let i=0;i<20;i++) many2.push(mk(L(2026,9,25),'Haul Road','Siding 1','Issue '+String.fromCharCode(65+i),10+i));
C=A.computeAll(many2,{},{},R7,NOW).cmp; ok('candidates: 20 in, 15 shown, candidateCount 20',C.candidates.length===15&&C.candidateCount===20&&C.candidates[0].issue==='Issue T');
// ---- All time
X=A.computeAll(rows,{},{},A.resolveRange('all',null,null,NOW),NOW); ok('All time: cmp null',X.cmp===null&&X.prev===null);
// ---- over 90 days: no overlay
n=0; X=A.computeAll([mk(L(2026,3,1),'Haul Road','Siding 1','A',10),mk(L(2026,9,1),'Haul Road','Siding 1','A',10)],{},{},A.resolveRange('custom','2026-06-01','2026-09-30',NOW),NOW);
ok('>90 days: comparison available, overlay off',X.cmp&&X.overlay===null&&X.pr.days===122);
console.log(`PASS=${PASS} FAIL=${FAIL}`);
