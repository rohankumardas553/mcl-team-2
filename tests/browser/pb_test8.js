process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const URL='http://localhost:8765/';
const LABEL=process.env.LABEL||'dataset';
const T=async(p,ms=500)=>p.waitForTimeout(ms);
const db=sql=>psql(sql).out;
const CATS=['Coal Despatch','Dust Suppression','Haul Road','Coal Quality'];
const FILTERS=JSON.parse(process.env.FILTERS||'[{},{"category":"Haul Road"},{"shift":"Night"},{"category":"Coal Despatch","location":"Siding 1"}]');
const {psql:_p}=require('../lib/harness.js');
const HIDE=process.env.FORCE_NIGHT?'true':(()=>{const cur=_p("select public.ist_shift(now())").out; const un={First:"'Second','Night'",Second:"'Night'",Night:""}[cur]; return un?`not (public.ist_operational_date(created_at)=public.ist_operational_date(now()) and shift in (${un}))`:'true';})();  // rows of today whose shift has not started are hidden on the dashboard
const W=f=>{const w=[HIDE]; if(f.category)w.push(`category='${f.category}'`); if(f.shift)w.push(`shift='${f.shift}'`); if(f.location)w.push(`location='${f.location}'`); return w.join(' and ');};
const snap=async p=>p.evaluate(()=>({cards:document.getElementById('cards').hidden?null:[...document.querySelectorAll('.card .n')].map(e=>e.textContent),
  chart:window.__chart?window.__chart.data.datasets[0].data:null,
  top3:[...document.querySelectorAll('#top3 .item')].map(e=>e.querySelector('.top span').textContent.replace(/^\d/,'')+' | '+e.querySelector('.reason').textContent),
  items:document.querySelectorAll('#list > .item').length, overdue:document.querySelectorAll('#list .badge.overdue').length,
  listText:document.getElementById('list').textContent, err:document.getElementById('msg')?document.getElementById('msg').textContent:''}));
(async()=>{
 const N=+db(`select count(*) from shift_exceptions where ${HIDE}`);
 console.log(`=== ${LABEL}: ${N} exceptions in the scratch database`);
 const before=OPLOG.length;
 const p=await newPage('gm1@example.com',{width:1280,height:1000}); await p.goto(URL+'dashboard.html'); await T(p,4000); await p.selectOption('#f-day','all'); await T(p,300);  // the default view is now Live; these checks are about reading every row, so use All days
 const reads=OPLOG.slice(before).filter(o=>o.table==='shift_exceptions');
 const rreads=OPLOG.slice(before).filter(o=>o.table==='exception_remarks');
 const R=+db('select count(*) from exception_remarks');
 const expRanges=n=>{const a=[];for(let i=0;i<=Math.floor(n/1000);i++)a.push([i*1000,i*1000+999]);return a;};
 check(`${LABEL}: exceptions read in pages of 1000 (${expRanges(N).length} request(s), ranges exact)`,JSON.stringify(reads.map(o=>o.range))===JSON.stringify(expRanges(N)),reads.map(o=>o.range));
 check(`${LABEL}: remarks read in pages of 1000 (${expRanges(R).length} request(s))`,JSON.stringify(rreads.map(o=>o.range))===JSON.stringify(expRanges(R)),rreads.map(o=>o.range));
 // the Shift Handover panel reads the 'reopened' audit lines of the previous shift ONCE (Shift In-Charge and above); still no read per record
 { const au=OPLOG.slice(before).filter(o=>o.kind==='select'&&o.table==='exception_audit'); check(`${LABEL}: each bulk read happens once (exactly 1 small audit read for the handover: action=reopened since the previous shift started; no read per record)`,au.length===1&&au[0].filters.some(f=>f==='eq:action')&&au[0].filters.some(f=>f==='gte:created_at'),JSON.stringify(au.map(a=>a.filters))); }
 for (const f of FILTERS) {
   const lab=`${LABEL} ${JSON.stringify(f)}`;
   await p.click('#f-reset'); await p.selectOption('#f-day','all'); await T(p,150);
   if(f.category) await p.selectOption('#f-cat',f.category); if(f.shift) await p.selectOption('#f-shift',f.shift); if(f.location) await p.selectOption('#f-loc',f.location);
   await T(p,400); const s=await snap(p); const w=W(f);
   const q=x=>+db(`select ${x} from shift_exceptions where ${w}`);
   const total=q('count(*)');
   check(`${lab}: matching rows = ${total} (${total<1000?'fewer than':total===1000?'exactly':'more than'} 1000)`,true);
   check(`${lab}: list count = SQL`,s.items===total,`${s.items} vs ${total}`);
   const kOpen=q(`count(*) filter (where status in ('Open','In progress'))`), kHigh=q(`count(*) filter (where current_priority='High' and status<>'Resolved')`), kMin=q(`coalesce(sum(impact_minutes) filter (where status<>'Resolved'),0)`);
   check(`${lab}: KPI Open / High (current priority) / Active minutes = SQL`,JSON.stringify(s.cards)===JSON.stringify([String(kOpen),String(kHigh),String(kMin)]),[s.cards,kOpen,kHigh,kMin]);
   const cats=CATS.map(c=>+db(`select coalesce(sum(impact_minutes),0) from shift_exceptions where ${w} and status<>'Resolved' and category='${c}'`));
   check(`${lab}: chart category totals (unresolved only) = SQL`,JSON.stringify(s.chart)===JSON.stringify(cats),[s.chart,cats]);
   const top=db(`select category||' - '||issue_type||' | '||current_priority||' priority · '||impact_minutes||' min impact' from shift_exceptions where ${w} and status<>'Resolved' order by case current_priority when 'High' then 0 when 'Medium' then 1 else 2 end, impact_minutes desc, created_at asc limit 3`).split('\n').filter(Boolean);
   check(`${lab}: Top 3 exact = SQL`,JSON.stringify(s.top3)===JSON.stringify(top),[s.top3,top]);
   const od=q(`count(*) filter (where current_priority='High' and status<>'Resolved' and created_at < now() - interval '30 minutes')`);
   check(`${lab}: OVERDUE count = SQL (${od})`,s.overdue===od,`${s.overdue} vs ${od}`);
   if(!f.category&&!f.shift&&!f.location){
     const rep=q(`count(*) filter (where reported_priority='High' and status<>'Resolved')`);
     check(`${lab}: High-priority KPI uses CURRENT priority (reported priority would give ${rep}, not ${kHigh})`,rep!==kHigh&&s.cards[1]===String(kHigh));
     const shown=(s.listText.match(/scratch remark \d+/g)||[]).length, marker=(s.listText.match(/LAST-REMARK-MARKER/g)||[]).length;
     check(`${lab}: every remark shown (${shown} of ${R-1}), including the newest beyond the first 1000`,shown===R-1&&marker===1,[shown,marker,R]);
   }
   check(`${lab}: no error banner`,!/Sorry/.test(s.err),s.err);
 }
 // Overman: active list and own history, derived from the same full read
 const po=await newPage('overman1@example.com',{width:1280,height:1000}); await po.goto(URL+'dashboard.html'); await T(po,4000);
 const so=await snap(po);
 const uid=db(`select id from auth.users where email='overman1@example.com'`);
 const act=+db(`select count(*) from shift_exceptions where status<>'Resolved' and ${HIDE}`);
 check(`${LABEL}: Overman active list = all ${act} active exceptions`,so.items===act,`${so.items} vs ${act}`);
 check(`${LABEL}: Overman sees no KPI cards / Top 3 / chart`,so.cards===null&&so.chart===null);
 await po.click('#tab-history'); await T(po,300); const hn=await po.evaluate(()=>document.querySelectorAll('#list > .item').length);
 check(`${LABEL}: Overman My history = Resolved he created (${db(`select count(*) from shift_exceptions where status='Resolved' and created_by='${uid}'`)})`,hn===+db(`select count(*) from shift_exceptions where status='Resolved' and created_by='${uid}'`),hn);
 check(`${LABEL}: no page errors`,p.errs.length===0&&po.errs.length===0,p.errs.concat(po.errs).join(';'));
 await done();
})();
