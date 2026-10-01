// End-to-end operational sequence across the Night -> First handover (simulated IST clock, real database functions).
// Needs a scratch database with 04..07 applied and NO demo data (LOCK=real bash tests/lib/rebuild.sh).
process.env.TZ='Asia/Kolkata';
const {OPLOG,newPage,check,done,psql,asUser,UIDS}=require('../lib/harness.js');
const URL='http://localhost:8765/'; const T=(p,ms)=>p.waitForTimeout(ms); const IST=s=>new Date(s+'+05:30');
async function open(email,page,iso,vp){ global.FAKE={t:IST(iso).getTime(),real:Date.now()}; global.FAIL_CLOCK=false; const p=await newPage(email,vp||{width:1280,height:900}); await p.clock.install({time:IST(iso)}); await p.goto('http://localhost:8765/'+page); await T(p,2800); return p; }
const ov=UIDS.overman1, sic=UIDS.sic1, mgr=UIDS.manager1;
const ins=(desc,created,shift,status,pri,mins,extra)=>psql(`insert into shift_exceptions(created_at,shift,location,category,issue_type,description,impact_minutes,urgency,reported_priority,current_priority,status,created_by,created_by_role,created_by_name${extra?','+extra[0]:''}) values ('${created}','${shift}','Siding 1','Coal Despatch','Coal shortage','${desc}',${mins},'${pri}','${pri}','${pri}','${status}','${ov}','overman','Test Overman One'${extra?','+extra[1]:''}) returning id`);
// the scratch rebuild contains 12+ legacy demo rows; this scenario needs a clean table (scratch database only)
psql(`delete from shift_exceptions`);
// ---- seed: the Night shift (19 Sep 21:00 -> 20 Sep 05:00 IST) of Operational Day 19 Sep, plus an old item
const H1=ins('E2E-H1 high unresolved','2026-09-19 22:30+05:30','Night','Open','High',120).out.split('\n')[0];
const M1=ins('E2E-M1 awaiting confirmation','2026-09-19 23:00+05:30','Night','In progress','Medium',60,[`started_at,started_by,started_by_name,closure_requested_at,closure_requested_by,closure_requested_by_name`,`'2026-09-19 23:10+05:30','${ov}','Test Overman One','2026-09-20 04:30+05:30','${ov}','Test Overman One'`]).out.split('\n')[0];
const R1=ins('E2E-R1 resolved recently','2026-09-20 01:00+05:30','Night','Resolved','Low',15,[`resolved_at,resolved_by,resolved_by_name`,`'2026-09-20 04:20+05:30','${sic}','Test Shift In-Charge One'`]).out.split('\n')[0];
const RO=ins('E2E-RO reopened','2026-09-19 22:00+05:30','Night','Open','Low',30).out.split('\n')[0];
psql(`insert into exception_audit(exception_id,action,actor_id,actor_name,actor_role,old_value,new_value,note,created_at) values ('${RO}','reopened','${mgr}','Test Manager One','manager','Resolved','Open','found wrong in review','2026-09-20 03:00+05:30')`);
const OLD=ins('E2E-OLD old unresolved','2026-09-15 08:00+05:30','First','Open','Medium',45).out.split('\n')[0];
const ho=p=>p.evaluate(()=>({sub:document.getElementById('ho-sub').textContent,chips:[...document.querySelectorAll('#ho-chips .ho-chip')].map(c=>c.innerText.replace(/\s+/g,' ').trim()),list:[...document.querySelectorAll('#ho-list > li')].map(l=>l.innerText.replace(/\s+/g,' ').trim()),detail:document.getElementById('ho-detail-body').textContent.replace(/\s+/g,' '),sw:document.documentElement.scrollWidth,iw:innerWidth,box:!document.getElementById('handover').hidden}));
const card=(p,desc)=>p.evaluate(d=>{const it=[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes(d)); return it?{text:it.innerText.replace(/\s+/g,' '),buttons:[...it.querySelectorAll('.act')].map(b=>b.textContent)}:null;},desc);
async function openForm(p,desc,re){ const h=await p.evaluateHandle(d=>[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes(d)),desc); const it=h.asElement(); for(const b of await it.$$('.act')){ if(re.test(await b.textContent())){ await b.click(); break; } } await T(p,300); }
(async()=>{
 console.log('=== 04:50 IST, Night shift of Operational Day 19 Sep (handover = the Second shift just before)');
 let p=await open('sic1@example.com','dashboard.html','2026-09-20T04:50:00'); let h=await ho(p);
 check('handover panel is shown',h.box);
 check('04:50: sub-title names the Second shift of 19 Sep and the Night shift now',h.sub==='From Second shift (19 Sep) to Night shift now',h.sub);
 check('04:50: unresolved now = 4 (H1, M1, RO and the old item); awaiting confirmation = 1',/^4 unresolved now/.test(h.chips[0])&&/^1 awaiting confirmation/.test(h.chips[2]),h.chips);
 let c=await card(p,'E2E-M1'); check('closure ageing: "Awaiting confirmation · 20 min" (requested 04:30, now 04:50)',/Awaiting confirmation · 20 min/.test(c.text),c.text);
 check('M1 "In progress for 5 h 40 min" (started 23:10)',/In progress for 5 h 40 min/.test(c.text),c.text);
 c=await card(p,'E2E-H1'); check('H1 "Open for 6 h 20 min" and still has the OVERDUE rule (High, > 30 min)',/Open for 6 h 20 min/.test(c.text)&&/OVERDUE/.test(c.text),c.text);
 c=await card(p,'E2E-OLD'); check('old item: "From First shift · 15 Sep"',/From First shift · 15 Sep/.test(c.text),c.text);
 check('first handover item is the one awaiting confirmation, then the High item',/E2E-M1|Coal Despatch/.test(h.list[0])&&/Awaiting confirmation/.test(h.list[0])&&/High/.test(h.list[1]),h.list);
 await p.close();

 console.log('=== 05:10 IST: First shift begins (Operational Day 20 Sep); the Night shift belongs to Operational Day 19 Sep');
 p=await open('sic1@example.com','dashboard.html','2026-09-20T05:10:00'); h=await ho(p);
 check('05:10: sub-title = From Night shift (19 Sep) to First shift now',h.sub==='From Night shift (19 Sep) to First shift now',h.sub);
 check('05:10: chips: 4 unresolved, 1 High, 1 awaiting, 3 opened in Night shift and still open, 1 reopened',/^4 unresolved/.test(h.chips[0])&&/^1 High priority/.test(h.chips[1])&&/^1 awaiting confirmation/.test(h.chips[2])&&/^3 opened in Night shift/.test(h.chips[3])&&/^1 reopened in Night shift/.test(h.chips[4]),h.chips);
 await p.click('#ho-details > summary'); await T(p,200); h=await ho(p);
 check('details: changes during Night shift = Started 1, Closure requested 1, Resolved 1, Reopened 1, Priority changed 0',/Started 1 · Closure requested 1 · Resolved 1 · Reopened 1 · Priority changed 0/.test(h.detail),h.detail);
 check('details name the items, times (IST) and people (closure requested 04:30; reopened 03:00 by Test Manager One)',/Closure requested · Coal Despatch - Coal shortageSiding 1 · 20 Sep, 04:30/.test(h.detail)&&/Reopened · Coal Despatch - Coal shortageSiding 1 · 20 Sep, 03:00 · Test Manager One/.test(h.detail),h.detail);
 c=await card(p,'E2E-M1'); check('closure ageing at 05:10 = 40 min',/Awaiting confirmation · 40 min/.test(c.text),c.text);
 c=await card(p,'E2E-H1'); check('H1 carried forward from the previous Operational Day: "From Night shift · 19 Sep"',/From Night shift · 19 Sep/.test(c.text),c.text);
 check('R1 (resolved 04:20) is not listed as unresolved but appears under Resolved in the details',!/E2E-R1/.test(h.list.join(' '))&&/Resolved \(1\)/.test(h.detail));
 await p.screenshot({path:'/tmp/handover_1280.png'}); await p.close();

 console.log('=== sic1 starts work, adds a remark, requests closure (UI, real database functions)');
 p=await open('sic1@example.com','dashboard.html','2026-09-20T05:12:00');
 await openForm(p,'E2E-H1',/^Start$/); // Start is a direct button
 c=await card(p,'E2E-H1'); const startBtn=await p.evaluateHandle(d=>{const it=[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes(d)); return [...it.querySelectorAll('.act')].find(b=>b.textContent==='Start');},'E2E-H1');
 if(startBtn.asElement()) await startBtn.asElement().click(); await T(p,1500);
 check('Start: H1 is In progress in the database',psql(`select status from shift_exceptions where id='${H1}'`).out==='In progress');
 await openForm(p,'E2E-H1',/operational remark/i); await p.fill('#list .formbox textarea','checked on site at first shift start'); await p.click('#list .formbox .go'); await T(p,1500);
 check('operational remark saved',+psql(`select count(*) from exception_remarks where exception_id='${H1}' and kind='operational'`).out===1);
 await p.close();
 p=await open('manager1@example.com','dashboard.html','2026-09-20T05:20:00');
 await openForm(p,'E2E-H1',/Change priority/); await p.selectOption('#list .formbox select','Medium'); await p.fill('#list .formbox textarea','impact smaller than first reported'); await p.click('#list .formbox .go'); await T(p,1500);
 check('Manager changes priority High -> Medium with a reason',psql(`select current_priority from shift_exceptions where id='${H1}'`).out==='Medium');
 await p.close();
 p=await open('sic1@example.com','dashboard.html','2026-09-20T05:30:00');
 await openForm(p,'E2E-H1',/Request closure/); await p.fill('#list .formbox textarea','cleared and verified by sic1'); await p.click('#list .formbox .go'); await T(p,1500);
 c=await card(p,'E2E-H1'); check('requester sees "Awaiting confirmation by another authorised officer" and no Confirm button (maker-checker)',/Awaiting confirmation by another authorised officer/.test(c.text)&&!c.buttons.some(b=>/Confirm Resolved|Decline/.test(b)),c);
 check('closure card shows "Awaiting confirmation · less than 1 min" style ageing',/Awaiting confirmation · (less than 1 min|\d+ min)/.test(c.text),c.text);
 await p.close();
 p=await open('sic2@example.com','dashboard.html','2026-09-20T05:40:00');
 c=await card(p,'E2E-H1'); check('another officer (sic2) sees Confirm Resolved and Decline',c.buttons.includes('Confirm Resolved')&&c.buttons.includes('Decline closure'),c.buttons);
 h=await ho(p); check('handover counts now: 2 awaiting confirmation (M1 and H1)',/^2 awaiting confirmation/.test(h.chips[2]),h.chips);
 const hb=await p.evaluateHandle(d=>{const it=[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes(d)); return [...it.querySelectorAll('.act')].find(b=>b.textContent==='Confirm Resolved');},'E2E-H1'); await hb.asElement().click(); await T(p,1800);
 check('sic2 confirms: H1 is Resolved',psql(`select status from shift_exceptions where id='${H1}'`).out==='Resolved');
 h=await ho(p); check('handover now: 3 unresolved (M1, RO, OLD), 1 awaiting (M1), 0 High',/^3 unresolved/.test(h.chips[0])&&/^0 High priority/.test(h.chips[1])&&/^1 awaiting confirmation/.test(h.chips[2]),h.chips);
 const top3=await p.evaluate(()=>[...document.querySelectorAll('#top3 .item')].map(e=>e.innerText.replace(/\s+/g,' ')));
 const expTop=psql(`select description from shift_exceptions where status<>'Resolved' order by case current_priority when 'High' then 0 when 'Medium' then 1 else 2 end, impact_minutes desc, created_at asc limit 3`).out.split('\n');
 check('Top 3 follows the unchanged rule (priority, impact, oldest): '+expTop.join(' > '),top3.length===3&&top3[0].includes('Medium')&&top3[1].includes('Medium')&&top3[2].includes('Low'),top3);
 await p.close();
 console.log('=== audit trail');
 const acts=psql(`select string_agg(action||':'||coalesce(actor_name,''),' | ' order by created_at,id) from exception_audit where exception_id='${H1}'`).out;
 console.log('   H1 audit:',acts);
 for(const a of ['started:Test Shift In-Charge One','priority_changed:Test Manager One','closure_requested:Test Shift In-Charge One','resolved:Test Shift In-Charge Two']) check('audit has '+a,acts.includes(a),acts);
 check('audit order: started, priority_changed, closure_requested, resolved',(()=>{const i=['started:','priority_changed:','closure_requested:','resolved:'].map(x=>acts.indexOf(x)); return i.every((v,k)=>v>=0&&(k===0||i[k-1]<v));})(),acts);
 const aud=asUser('overman1@example.com',`select count(*) from exception_audit`).out; check('an Overman still cannot read the audit trail (0 rows)',aud.split('\n').pop()==='0',aud);
 console.log('=== Management Overview (analytics) as General Manager');
 p=await open('gm1@example.com','analytics.html','2026-09-20T06:00:00');
 const kp=await p.evaluate(()=>({n:document.getElementById('k-total').textContent,i:document.getElementById('k-impact').textContent}));
 const sqlN=psql(`select count(*)||'|'||sum(impact_minutes) from shift_exceptions where created_at >= '2026-08-22' and created_at < '2026-09-21'`).out.split('|');
 check(`Management Overview totals match SQL for the 30 days to 20 Sep (${sqlN[0]} exceptions, ${sqlN[1]} min)`,kp.n===sqlN[0]&&kp.i.replace(/,/g,'')===sqlN[1],JSON.stringify([kp,sqlN])); await p.close();
 console.log('=== other handover transitions');
 for(const [t,sub] of [['2026-09-20T13:00:00','From First shift (20 Sep) to Second shift now'],['2026-09-20T12:59:00','From Night shift (19 Sep) to First shift now'],['2026-09-20T21:00:00','From Second shift (20 Sep) to Night shift now'],['2026-09-20T20:59:00','From First shift (20 Sep) to Second shift now'],['2026-09-21T00:30:00','From Second shift (20 Sep) to Night shift now'],['2026-09-21T05:00:00','From Night shift (20 Sep) to First shift now']]){
   const q=await open('sic1@example.com','dashboard.html',t); const x=await ho(q); check(`${t} IST: "${sub}"`,x.sub===sub,x.sub); await q.close(); }
 console.log('=== mobile 390px');
 p=await open('sic1@example.com','dashboard.html','2026-09-20T05:10:00',{width:390,height:800}); h=await ho(p);
 check('390px: no sideways scroll with the handover panel',h.sw<=h.iw,[h.sw,h.iw]);
 const m=await p.evaluate(()=>{const b=document.getElementById('handover').getBoundingClientRect(); const s=document.querySelector('#ho-details > summary').getBoundingClientRect(); const chips=[...document.querySelectorAll('#ho-chips .ho-chip')].map(c=>Math.round(c.getBoundingClientRect().right)); return {panelH:Math.round(b.height),summaryH:Math.round(s.height),maxChipRight:Math.max(...chips),fonts:[...document.querySelectorAll('#handover *')].filter(e=>e.children.length===0&&e.textContent.trim()).map(e=>parseFloat(getComputedStyle(e).fontSize)).reduce((a,b)=>Math.min(a,b),99)};});
 check('390px: handover panel is compact (<= 620px tall), details button >= 44px, smallest text >= 13px',m.panelH<=620&&m.summaryH>=44&&m.fonts>=13,JSON.stringify(m));
 await p.screenshot({path:'/tmp/handover_390.png'}); await p.click('#ho-details > summary'); await T(p,300); const h2=await ho(p); check('390px: still no sideways scroll with details open',h2.sw<=h2.iw,[h2.sw,h2.iw]); await p.screenshot({path:'/tmp/handover_390_open.png'});
 const c390=await p.evaluate(()=>{const it=[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes('E2E-M1')); const sp=[...it.querySelectorAll('.age')].map(e=>parseFloat(getComputedStyle(e).fontSize)); return {ages:sp,pill:getComputedStyle(it.querySelector('.pill.wait')).fontSize};});
 check('390px: closure ageing text is readable (>= 14px)',c390.ages.every(x=>x>=14)&&parseFloat(c390.pill)>=14,c390);
 await p.close();
 await done();
})();
