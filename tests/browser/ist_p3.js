const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql,asUser}=require('../lib/harness.js');
const URL='http://localhost:8765/'; const T=(p,ms)=>p.waitForTimeout(ms); const IST=s=>new Date(s+'+05:30');
const FAKESET=iso=>{global.FAKE={t:IST(iso).getTime(),real:Date.now()};};
async function open(email,page,iso,vp){ FAKESET(iso); global.FAIL_CLOCK=false; const p=await newPage(email,vp||{width:1280,height:900}); await p.clock.install({time:IST(iso)}); await p.goto(URL+page); await T(p,3000); return p; }
// the database clock moves together with the page clock (a real database does); then the page clock jumps
async function jump(p,ms){ const cur=global.FAKE.t+(Date.now()-global.FAKE.real); global.FAKE={t:cur+ms,real:Date.now()}; await p.clock.fastForward(ms); }
const selects=()=>OPLOG.filter(o=>o.table==='shift_exceptions').length;
async function openFormOn(p,re){ const handle=await p.evaluateHandle(r=>{const rx=new RegExp(r,'i'); return [...document.querySelectorAll('#list > .item')].find(i=>[...i.querySelectorAll('.act')].some(b=>rx.test(b.textContent)));},re.source);
  const it=handle.asElement(); if(!it) return null; const id=await it.getAttribute('data-id'); for(const b of await it.$$('.act')){ if(re.test(await b.textContent())){ await b.click(); break; } } await T(p,300); return id; }
const st=p=>p.evaluate(()=>({shift:document.getElementById('cb-shift').textContent,asof:document.getElementById('cb-asof').textContent,pending:!document.getElementById('cb-pending').hidden,form:!!document.querySelector('#list .formbox'),text:(document.querySelector('#list .formbox textarea')||{}).value||null,nightDisabled:[...document.getElementById('f-shift').options].find(o=>o.value==='Night').disabled,secondDisabled:[...document.getElementById('f-shift').options].find(o=>o.value==='Second').disabled}));
(async()=>{
 console.log('=== A. Request closure form open across 21:00');
 let p=await open('sic1@example.com','dashboard.html','2026-10-01T20:58:00'); let s=await st(p); check('20:58 Second, Night disabled',s.shift==='Second'&&s.nightDisabled);
 const idA=await openFormOn(p,/Request closure/); check('Request closure form opened',!!idA);
 await p.fill('#list .formbox textarea','closing note typed at the shift boundary'); const r0=selects();
 await jump(p,4*60*1000); await T(p,1500); s=await st(p);
 check('21:02: header says Night and Night is now selectable',s.shift==='Night'&&!s.nightDisabled,s);
 check('A: the open form and the typed text are still there',s.form&&s.text==='closing note typed at the shift boundary',s);
 check('A: a notice says the list will refresh after the form is closed',s.pending);
 check('A: no data reload happened while the form was open',selects()===r0,[selects(),r0]);
 await p.click('#list .formbox .cancel'); await T(p,1500); s=await st(p);
 check('A: after Cancel the pending refresh runs (data reloaded, notice gone)',selects()>r0&&!s.pending&&!s.form,[selects(),r0,s.pending]);
 await p.close();

 console.log('=== B. Resolve form across 13:00, and a record that changed while the form was open');
 p=await open('sic1@example.com','dashboard.html','2026-10-01T12:58:00');
 const idB=await openFormOn(p,/^Resolve/); check('Resolve form opened',!!idB);
 await p.fill('#list .formbox textarea','resolved by me, details typed before 13:00');
 // someone else resolves the same record while this form is open
 const other=asUser('sic2@example.com',`select public.resolve_exception('${idB}','resolved by the other officer')`);
 await jump(p,4*60*1000); await T(p,1500); s=await st(p);
 check('13:02: Second shift shown, form and text kept',s.shift==='Second'&&s.form&&/typed before 13:00/.test(s.text),s);
 await p.click('#list .formbox .go'); await T(p,1500);
 const err=await p.evaluate(()=>(document.querySelector('#list .inline-err')||{}).textContent||'');
 check('submitting on a record that changed shows the database message and keeps the form',/Sorry, that did not work\. Error:/.test(err)&&await p.evaluate(()=>!!document.querySelector('#list .formbox textarea')),err);
 await p.click('#list .formbox .cancel'); await T(p,1500);
 const nowStatus=await p.evaluate(id=>{const it=document.querySelector(`[data-id="${id}"]`); return it?it.innerText.match(/Resolved|In progress|Open/)[0]:'(not listed)';},idB);
 check('after Cancel the refresh shows the current state: the record is no longer an active (In progress) item (Resolved by the other officer; Live lists resolved items of earlier days only under All days)',nowStatus!=='In progress',nowStatus);
 await p.close();

 console.log('=== B2. Reopen/priority/remark forms are protected the same way');
 p=await open('manager1@example.com','dashboard.html','2026-10-01T20:59:00');
 const idP=await openFormOn(p,/Change priority/); check('Change priority form opened (Manager)',!!idP);
 if(idP){ await p.fill('#list .formbox textarea','reason typed while the shift changes'); await jump(p,3*60*1000); await T(p,1200); s=await st(p); check('priority form text kept across 21:00',s.form&&/reason typed/.test(s.text)&&s.shift==='Night',s); }
 await p.close();

 console.log('=== C. wrong device clock, trusted clock unavailable, database says a different shift');
 global.FAIL_CLOCK=true; FAKESET('2026-10-01T13:05:00');
 p=await newPage('sic1@example.com'); await p.clock.install({time:IST('2026-10-01T12:55:00')}); await p.goto(URL+'index.html'); await T(p,2500);
 check('device (10 min behind, sync failed) shows First',(await p.textContent('#sb-shift'))==='First');
 await p.selectOption('#location','Siding 1'); await p.click('input[name=category][value="Coal Despatch"]'); await p.selectOption('#issue','Coal shortage'); await p.fill('#description','keep me typed'); await p.fill('#minutes','5'); await p.click('input[name=priority][value="Low"]');
 await p.click('#save'); await T(p,1200);
 let msg=await p.textContent('#msg');
 check('first submit: rejected by the database, indicator corrected to Second, user told what happened',(await p.textContent('#sb-shift'))==='Second'&&/The current shift is Second \(since 13:00 IST\)\. This device's clock may be wrong\. Nothing you typed was lost/.test(msg),[await p.textContent('#sb-shift'),msg]);
 check('typed details preserved',(await p.inputValue('#description'))==='keep me typed'&&(await p.inputValue('#minutes'))==='5');
 const nC=OPLOG.filter(o=>o.name==='create_exception').length;
 await p.click('#save'); await T(p,1500); const lastC=[...OPLOG].reverse().find(o=>o.name==='create_exception');
 check('second submit goes through with the corrected shift (Second)',lastC.args.p_shift==='Second'&&/recorded successfully/.test(await p.textContent('#msg')),[lastC.args.p_shift,await p.textContent('#msg')]);
 await p.close();
 // C2: sync works at the moment of the error
 global.FAIL_CLOCK=true; FAKESET('2026-10-01T13:05:00'); p=await newPage('sic1@example.com'); await p.clock.install({time:IST('2026-10-01T12:55:00')}); await p.goto(URL+'index.html'); await T(p,2500);
 await p.selectOption('#location','Siding 1'); await p.click('input[name=category][value="Coal Despatch"]'); await p.selectOption('#issue','Coal shortage'); await p.fill('#description','resync path'); await p.fill('#minutes','5'); await p.click('input[name=priority][value="Low"]');
 global.FAIL_CLOCK=false; await p.click('#save'); await T(p,1200); msg=await p.textContent('#msg');
 check('C2: when the re-sync succeeds the shift is corrected from the trusted clock (no "device clock" warning)',(await p.textContent('#sb-shift'))==='Second'&&!/device/.test(msg)&&/Nothing you typed was lost/.test(msg),msg);
 await p.close();

 console.log('=== D. device clock changed by hand after a successful sync');
 FAKESET('2026-10-01T10:00:00'); global.FAIL_CLOCK=false;
 p=await newPage('sic1@example.com'); await p.clock.install({time:IST('2026-10-01T10:00:00')}); await p.goto(URL+'dashboard.html'); await T(p,3000);
 const drift=()=>p.evaluate(()=>MineShiftClock.now()-Date.now());
 const d0=await drift(); await p.clock.setSystemTime(IST('2026-10-01T22:00:00')); await T(p,200);   // someone sets the device clock 12 hours ahead
 const dBad=await p.evaluate(()=>({t:MineShiftClock.info(MineShiftClock.now()).shift}));
 await p.clock.runFor(16000); await T(p,1500);
 const nowIso=await p.evaluate(()=>new Date(MineShiftClock.now()).toISOString()); const expectMs=global.FAKE.t+(Date.now()-global.FAKE.real);
 check(`D: before the next check the device clock says ${dBad.t} (wrong); after one 15 s check the trusted clock is restored (within 3 s of the database time)`,dBad.t==='Night'&&Math.abs(Date.parse(nowIso)-expectMs)<3000,[dBad,nowIso,new Date(expectMs).toISOString()]);
 s=await st(p); check('D: the page shows First again',s.shift==='First',s);
 await p.close();

 console.log('=== E. tab sleeps across 13:00 (laptop sleep / phone suspend)');
 FAKESET('2026-10-01T12:50:00'); p=await newPage('sic1@example.com'); await p.clock.install({time:IST('2026-10-01T12:50:00')}); await p.goto(URL+'dashboard.html'); await T(p,3000);
 s=await st(p); check('12:50 First, Second disabled',s.shift==='First'&&s.secondDisabled);
 const rE=selects();
 FAKESET('2026-10-01T13:20:00'); await p.clock.setSystemTime(IST('2026-10-01T13:20:00')); await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange'))); await T(p,2500); s=await st(p);
 check('E: on wake the page re-syncs: Second shown, Second selectable, 13:2x IST',s.shift==='Second'&&!s.secondDisabled&&/13:2\d IST/.test(s.asof),s);
 check('E: data was reloaded',selects()>rE);
 await p.close();
 console.log('=== E2. network comes back (online event) re-syncs');
 FAKESET('2026-10-01T20:50:00'); p=await newPage('sic1@example.com'); await p.clock.install({time:IST('2026-10-01T20:50:00')}); await p.goto(URL+'dashboard.html'); await T(p,3000);
 const rpc0=OPLOG.filter(o=>o.name==='shift_clock').length; await p.evaluate(()=>window.dispatchEvent(new Event('online'))); await T(p,1000);
 check('E2: an "online" event triggers a trusted-clock re-sync',OPLOG.filter(o=>o.name==='shift_clock').length>rpc0);
 await p.close();
 console.log('=== E3. periodic re-sync every ~30 minutes');
 FAKESET('2026-10-01T10:00:00'); p=await newPage('sic1@example.com'); await p.clock.install({time:IST('2026-10-01T10:00:00')}); await p.goto(URL+'dashboard.html'); await T(p,3000);
 const rpc1=OPLOG.filter(o=>o.name==='shift_clock').length; await p.clock.runFor(31*60*1000); await T(p,1500);
 check('E3: after 31 minutes of activity the page asked the database for its clock again',OPLOG.filter(o=>o.name==='shift_clock').length>rpc1,[OPLOG.filter(o=>o.name==='shift_clock').length,rpc1]);
 await p.close();
 await done();
})();
