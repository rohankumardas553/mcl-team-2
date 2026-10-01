// The five roles look at the same handover situation (Night -> First, 05:10 IST) and a dashboard action fails on a weak network.
// Needs a clean scratch database (LOCK=real bash tests/lib/rebuild.sh).
process.env.TZ='Asia/Kolkata';
const {OPLOG,newPage,check,done,psql,UIDS}=require('../lib/harness.js');
const T=(p,ms)=>p.waitForTimeout(ms); const IST=s=>new Date(s+'+05:30');
async function open(email,page,iso,vp){ global.FAKE={t:IST(iso).getTime(),real:Date.now()}; global.FAIL_CLOCK=false; global.FAIL_RPC=null; const p=await newPage(email,vp||{width:390,height:800}); await p.clock.install({time:IST(iso)}); await p.goto('http://localhost:8765/'+page); await T(p,2800); return p; }
const ov=UIDS.overman1;
psql(`delete from shift_exceptions`);
const ins=(d,created,shift,status,pri,mins,extra)=>psql(`insert into shift_exceptions(created_at,shift,location,category,issue_type,description,impact_minutes,urgency,reported_priority,current_priority,status,created_by,created_by_role,created_by_name${extra?','+extra[0]:''}) values ('${created}','${shift}','Siding 1','Coal Despatch','Coal shortage','${d}',${mins},'${pri}','${pri}','${pri}','${status}','${ov}','overman','Test Overman One'${extra?','+extra[1]:''}) returning id`).out.split('\n')[0];
const HIGH=ins('RW-HIGH','2026-09-19 22:30+05:30','Night','Open','High',100);
const WAIT=ins('RW-WAIT','2026-09-19 23:00+05:30','Night','In progress','Medium',50,[`started_at,started_by,started_by_name,closure_requested_at,closure_requested_by,closure_requested_by_name`,`'2026-09-19 23:10+05:30','${ov}','Test Overman One','2026-09-20 04:30+05:30','${ov}','Test Overman One'`]);
ins('RW-DONE','2026-09-20 01:00+05:30','Night','Resolved','Low',10,[`resolved_at,resolved_by,resolved_by_name`,`'2026-09-20 04:20+05:30','${UIDS.sic1}','Test Shift In-Charge One'`]);
const snap=p=>p.evaluate(()=>({box:!document.getElementById('handover').hidden,chips:[...document.querySelectorAll('#ho-chips .ho-chip')].map(c=>c.innerText.replace(/\s+/g,' ').trim()),detail:(()=>{document.getElementById('ho-details').open=true; return document.getElementById('ho-detail-body').textContent.replace(/\s+/g,' ');})(),cards:!document.getElementById('cards').hidden,top3:!document.getElementById('col-left').hidden,
  wait:(()=>{const it=[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes('RW-WAIT')); return it?{text:it.innerText.replace(/\s+/g,' '),buttons:[...it.querySelectorAll('.act')].map(b=>b.textContent),hasHistory:!!it.querySelector('details.sec summary') && /History/.test(it.innerText)}:null;})(),sw:document.documentElement.scrollWidth,iw:innerWidth}));
(async()=>{
 const roles={overman1:'Overman',sic2:'Shift In-Charge',manager1:'Manager (no can_operate)',manager2:'Manager (can_operate)',po1:'Project Officer',gm1:'General Manager'};
 for(const [u,label] of Object.entries(roles)){
   const p=await open(u+'@example.com','dashboard.html','2026-09-20T05:10:00'); const s=await snap(p);
   check(`${label}: handover panel visible and from Night shift (19 Sep)`,s.box&&s.chips.length>=4,s.chips);
   check(`${label}: sees "awaiting confirmation" count 1 and ageing "Awaiting confirmation · 40 min" on the card`,/^1 awaiting confirmation/.test(s.chips[2])&&/Awaiting confirmation · 40 min/.test(s.wait.text),s.wait&&s.wait.text);
   const mgmt=u!=='overman1';
   check(`${label}: ${mgmt?'sees':'does NOT see'} the state-change details and the reopened chip`,mgmt?/Changes during Night shift/.test(s.detail)&&s.chips.length===5:!/Changes during/.test(s.detail)&&s.chips.length===4,[s.chips.length,s.detail.slice(0,80)]);
   check(`${label}: ${mgmt?'sees':'does not see'} cards, Top 3 and History`,mgmt?(s.cards&&s.top3&&s.wait.hasHistory):(!s.cards&&!s.top3&&!s.wait.hasHistory),[s.cards,s.top3,s.wait.hasHistory]);
   // confirmation buttons follow the unchanged authority rules (requester was the Overman)
   const canConfirm=['sic2','manager2'].includes(u);
   check(`${label}: ${canConfirm?'can':'cannot'} Confirm Resolved (unchanged maker-checker / can_operate rules)`,s.wait.buttons.includes('Confirm Resolved')===canConfirm,s.wait.buttons);
   check(`${label}: 390px no sideways scroll`,s.sw<=s.iw,[s.sw,s.iw]);
   if(u==='gm1'||u==='po1'||u==='manager1'){ check(`${label}: can reopen/priority but never Start / Confirm / Decline`,!s.wait.buttons.some(b=>/^Start$|Confirm Resolved|Decline closure/.test(b)),s.wait.buttons); }
   await p.close();
 }
 for(const u of ['manager1','po1','gm1']){ const p=await open(u+'@example.com','index.html','2026-09-20T05:10:00'); check(`${roles[u]}: entry form is not available (cannot create)`,await p.evaluate(()=>document.getElementById('form').hidden&&!document.getElementById('denied').hidden)); await p.close(); }
 { const p=await open('overman1@example.com','analytics.html','2026-09-20T05:10:00'); check('Overman: analytics shows Not authorised',await p.evaluate(()=>!document.getElementById('denied').hidden)); await p.close(); }
 console.log('=== weak network while a dashboard action form is open');
 { const p=await open('sic2@example.com','dashboard.html','2026-09-20T05:20:00');
   const h=await p.evaluateHandle(()=>[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes('RW-HIGH'))); const it=h.asElement();
   for(const b of await it.$$('.act')){ if(/^Start$/.test(await b.textContent())){ await b.click(); break; } } await T(p,1500);
   check('Start works (real database function)',psql(`select status from shift_exceptions where id='${HIGH}'`).out==='In progress');
   const h2=await p.evaluateHandle(()=>[...document.querySelectorAll('#list > .item')].find(i=>i.innerText.includes('RW-HIGH'))); for(const b of await h2.asElement().$$('.act')){ if(/Request closure/.test(await b.textContent())){ await b.click(); break; } } await T(p,300);
   await p.fill('#list .formbox textarea','finished, written while the signal was weak'); global.FAIL_RPC='request_closure'; await p.click('#list .formbox .go'); await T(p,1200);
   const st=await p.evaluate(()=>({err:(document.querySelector('#list .inline-err')||{}).textContent||'',form:!!document.querySelector('#list .formbox'),text:(document.querySelector('#list .formbox textarea')||{}).value||'',toast:document.getElementById('toast').textContent}));
   check('failed request: error text shown on the card, the form stays open and the typed note is kept',/Sorry, that did not work\. Error: TypeError: Failed to fetch/.test(st.err)&&st.form&&/weak/.test(st.text),JSON.stringify(st));
   check('nothing was changed in the database by the failed request',psql(`select closure_requested_at is null from shift_exceptions where id='${HIGH}'`).out==='t');
   global.FAIL_RPC=null; await p.click('#list .formbox .go'); await T(p,1500);
   check('network back: pressing the button again succeeds with the same note',psql(`select closure_requested_at is not null from shift_exceptions where id='${HIGH}'`).out==='t'&&+psql(`select count(*) from exception_audit where exception_id='${HIGH}' and action='closure_requested' and note like '%weak%'`).out===1);
   await p.close(); }
 await done();
})();
