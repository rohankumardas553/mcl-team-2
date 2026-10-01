const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const URL='http://localhost:8765/'; const T=(p,ms)=>p.waitForTimeout(ms); const IST=s=>new Date(s+'+05:30');
async function open(email,page,iso,vp,tz){ global.FAKE={t:IST(iso).getTime(),real:Date.now()}; const p=await newPage(email,vp||{width:1280,height:900},tz); await p.clock.install({time:IST(iso)}); await p.goto(URL+page); await T(p,3000); return p; }
const ins=(desc,created,shift,status,pri,mins)=>psql(`insert into shift_exceptions(created_at,shift,location,category,issue_type,description,impact_minutes,urgency,reported_priority,current_priority,status) values ('${created}','${shift}','Siding 1','Coal Despatch','Coal shortage','${desc}',${mins},'${pri}','${pri}','${pri}','${status}')`);
// Old / pre-migration style rows (inserted directly, as the demo data was)
ins('ANOM-TODAY-NIGHT-OPEN','2026-10-01 09:00:00+05:30','Night','Open','High',1400);          // today (Operational Day 01 Oct), label Night, created in the morning
ins('ANOM-TODAY-NIGHT-RESOLVED','2026-10-01 08:00:00+05:30','Night','Resolved','Low',10);
ins('ANOM-TODAY-SECOND-OPEN','2026-10-01 10:00:00+05:30','Second','Open','High',1300);       // label Second at 17:30 = already started: visible
ins('CARRY-YESTERDAY-NIGHT','2026-09-30 23:00:00+05:30','Night','Open','High',1200);         // yesterday's Night, unresolved: carry-forward
ins('PAST-NIGHT-RESOLVED','2026-09-29 23:00:00+05:30','Night','Resolved','Low',5);            // completed day: all shifts allowed
const snap=p=>p.evaluate(()=>({text:[...document.querySelectorAll('#list > .item')].map(e=>e.innerText).join('\n#####\n'),n:document.querySelectorAll('#list > .item').length,
  cards:[...document.querySelectorAll('.card .n')].map(e=>e.textContent),top3:[...document.querySelectorAll('#top3 .item')].map(e=>e.innerText.replace(/\s+/g,' ')),
  chart:window.__charts&&window.__charts.chart?window.__charts.chart.data.datasets[0].data:null,
  carryBtn:(()=>{const it=[...document.querySelectorAll('#list > .item')].find(e=>e.innerText.includes('CARRY-YESTERDAY-NIGHT'));return !!it&&it.querySelectorAll('.act').length>0&&/From Night shift · 30 Sep/.test(it.innerText);})()}));
const has=(s,d)=>s.text.includes(d);
const unresHid=(hide)=>`status<>'Resolved' ${hide?`and not (((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date='2026-10-01' and shift in (${hide}))`:''}`;
(async()=>{
 console.log('=== 17:30 IST (Second shift, Operational Day 01 Oct)');
 let p=await open('sic1@example.com','dashboard.html','2026-10-01T17:30:00'); let s=await snap(p);
 check('Scenario 1: today\'s Night-labelled OPEN row is hidden from Live',!has(s,'ANOM-TODAY-NIGHT-OPEN'));
 check('Scenario 1: today\'s Night-labelled RESOLVED row is hidden from Live',!has(s,'ANOM-TODAY-NIGHT-RESOLVED'));
 check('today\'s Second-labelled row (shift already started) is visible',has(s,'ANOM-TODAY-SECOND-OPEN'));
 check('Scenario 2: yesterday\'s Night unresolved row is visible, labelled "From Night shift · 30 Sep" and actionable',has(s,'CARRY-YESTERDAY-NIGHT')&&s.carryBtn);
 const k=[psql(`select count(*) from shift_exceptions where ${unresHid("'Night'")}`).out,psql(`select count(*) from shift_exceptions where ${unresHid("'Night'")} and current_priority='High'`).out,psql(`select coalesce(sum(impact_minutes),0) from shift_exceptions where ${unresHid("'Night'")}`).out];
 check(`Scenario 2: KPIs include the carry-forward row and exclude today's hidden Night row (${k})`,s.cards.join()===k.join(),[s.cards,k]);
 check('Top 3: the carry-forward High row (1200 min) is eligible; today\'s hidden Night High row (1400 min) is not',s.top3.some(t=>t.includes('Coal Despatch - Coal shortage'))&&!/1400 min/.test(s.top3.join(' '))&&/1300 min/.test(s.top3.join(' ')),s.top3);
 const cs=psql(`select coalesce(sum(impact_minutes),0) from shift_exceptions where category='Coal Despatch' and ${unresHid("'Night'")}`).out;
 check(`chart (Coal Despatch bar) = SQL ${cs} without the hidden row`,String(s.chart&&s.chart[0])===cs,s.chart);
 // One operational day = today + All available shifts
 await p.selectOption('#f-day','day'); await p.fill('#f-date','2026-10-01'); await p.dispatchEvent('#f-date','change'); await T(p,500); s=await snap(p);
 check('Scenario 1: One operational day (today) + All available shifts hides the Night row',!has(s,'ANOM-TODAY-NIGHT-OPEN')&&!has(s,'ANOM-TODAY-NIGHT-RESOLVED')&&has(s,'ANOM-TODAY-SECOND-OPEN'));
 const expDay=psql(`select count(*) from shift_exceptions where ((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date='2026-10-01' and shift<>'Night'`).out;
 check(`today only shows First + Second (${expDay} rows)`,String(s.n)===expDay,[s.n,expDay]);
 // All days
 await p.selectOption('#f-day','all'); await T(p,500); s=await snap(p);
 const expAll=psql(`select count(*) from shift_exceptions where not (((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date='2026-10-01' and shift='Night')`).out;
 check('Scenario 1: All days hides today\'s Night rows at 17:30',!has(s,'ANOM-TODAY-NIGHT-OPEN')&&!has(s,'ANOM-TODAY-NIGHT-RESOLVED'));
 check('All days still shows earlier days\' Night rows (yesterday carry-forward and a resolved past Night row)',has(s,'CARRY-YESTERDAY-NIGHT')&&has(s,'PAST-NIGHT-RESOLVED'));
 check(`All days count = everything except today's Night rows (${expAll})`,String(s.n)===expAll,[s.n,expAll]);
 await p.close();
 console.log('=== 13:30 IST (Second just started) and 07:00 IST (First)');
 { const q=await open('sic1@example.com','dashboard.html','2026-10-01T07:00:00'); await q.selectOption('#f-day','all'); await T(q,400); const t=await snap(q);
   check('07:00 (First): today\'s Second AND Night rows are hidden; yesterday\'s Night carry-forward is shown',!has(t,'ANOM-TODAY-NIGHT-OPEN')&&!has(t,'ANOM-TODAY-SECOND-OPEN')&&has(t,'CARRY-YESTERDAY-NIGHT')); await q.close(); }
 console.log('=== 21:00 IST (Night starts)');
 { const q=await open('sic1@example.com','dashboard.html','2026-10-01T21:00:00'); const t=await snap(q);
   check('Scenario 3: at 21:00 today\'s Night rows become eligible in Live',has(t,'ANOM-TODAY-NIGHT-OPEN')&&has(t,'ANOM-TODAY-NIGHT-RESOLVED'));
   await q.selectOption('#f-day','all'); await T(q,400); const u=await snap(q); check('Scenario 3: and in All days',has(u,'ANOM-TODAY-NIGHT-OPEN'));
   await q.close(); }
 console.log('=== left open across 21:00');
 { const q=await open('sic1@example.com','dashboard.html','2026-10-01T20:58:00'); let t=await snap(q); check('20:58: Night row hidden',!has(t,'ANOM-TODAY-NIGHT-OPEN'));
   await jump(q,3*60*1000); await T(q,2000); t=await snap(q); check('21:01 without reload: Night row appears',has(t,'ANOM-TODAY-NIGHT-OPEN')); await q.close(); }
 console.log('=== Overman at 17:30');
 { const q=await open('overman1@example.com','dashboard.html','2026-10-01T17:30:00'); const t=await snap(q);
   check('Overman: hidden Night row stays hidden, carry-forward stays visible',!has(t,'ANOM-TODAY-NIGHT-OPEN')&&has(t,'CARRY-YESTERDAY-NIGHT')); await q.close(); }
 console.log('=== analytics note in a non-IST browser');
 for(const tz of ['America/New_York','Pacific/Auckland']){
   const q=await open('gm1@example.com','analytics.html','2026-10-01T17:30:00',null,tz); const a=await q.evaluate(()=>({h:document.getElementById('partial-note').hidden,t:document.getElementById('partial-note').textContent}));
   check(`${tz}: note says the present operational day is in progress, as of 01 Oct 2026, 17:30 IST (Second shift), and claims nothing about excluded shifts`,!a.h&&a.t==='Current-period data may be incomplete because the present operational day is still in progress. As of 01 Oct 2026, 17:30 IST (Second shift).',a.t);
   await q.selectOption('#f-range','custom'); await q.fill('#f-from','2026-08-01'); await q.fill('#f-to','2026-08-31'); await q.dispatchEvent('#f-to','change'); await T(q,2000);
   check(`${tz}: no note for a finished past range`,await q.evaluate(()=>document.getElementById('partial-note').hidden));
   const n0=OPLOG.length; await q.selectOption('#f-range','all'); await T(q,2000); check(`${tz}: All time shows the note`,!(await q.evaluate(()=>document.getElementById('partial-note').hidden)));
   await q.close(); }
 { const q=await open('gm1@example.com','analytics.html','2026-10-02T02:10:00',null,'America/New_York'); const a=await q.evaluate(()=>document.getElementById('partial-note').textContent);
   check('02:10 IST on 02 Oct (New York browser): note says 02 Oct 2026, 02:10 IST (Night shift)',/As of 02 Oct 2026, 02:10 IST \(Night shift\)\./.test(a),a); await q.close(); }
 await done();
})();
