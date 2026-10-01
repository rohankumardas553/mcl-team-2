const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const URL='http://localhost:8765/'; const T=(p,ms)=>p.waitForTimeout(ms);
const IST=s=>new Date(s+'+05:30');
async function open(email,page,iso,vp,tz){ global.FAKE={t:IST(iso).getTime(),real:Date.now()}; const p=await newPage(email,vp||{width:1280,height:900},tz); await p.clock.install({time:IST(iso)}); await p.goto(URL+page); await T(p,3000); return p; }
const dash=p=>p.evaluate(()=>{ const sel=document.getElementById('f-shift'); return {
  day:document.getElementById('cb-day').textContent,shift:document.getElementById('cb-shift').textContent,asof:document.getElementById('cb-asof').textContent,
  opts:[...sel.options].map(o=>[o.value,o.textContent,o.disabled]), cards:[...document.querySelectorAll('.card .n')].map(e=>e.textContent),
  items:document.querySelectorAll('#list > .item').length, summary:document.getElementById('summary').textContent,
  top3:[...document.querySelectorAll('#top3 .item')].map(e=>e.innerText.replace(/\s+/g,' ')), carry:[...document.querySelectorAll('#list .badge.carry')].filter(b=>b.textContent.includes('\u00b7')).length,
  dateMax:document.getElementById('f-date').max, sw:document.documentElement.scrollWidth, iw:innerWidth, err:document.getElementById('msg').textContent}; });
const unres=`status<>'Resolved'`;
(async()=>{
 console.log('=== DASHBOARD, Shift In-Charge, 17:30 IST (Second shift)');
 let p=await open('sic1@example.com','dashboard.html','2026-10-01T17:30:00'); let d=await dash(p);
 check('clock bar: Operational Day 01 Oct 2026, Current Shift Second, As of 01 Oct 2026, 17:30 IST',d.day==='01 Oct 2026'&&d.shift==='Second'&&d.asof==='01 Oct 2026, 17:30 IST',d);
 const o=Object.fromEntries(d.opts.map(x=>[x[0],x]));
 check('Night is disabled and says "available from 21:00 IST"; First and Second enabled; All reads "All available shifts"',o.Night[2]&&/available from 21:00 IST/.test(o.Night[1])&&!o.First[2]&&!o.Second[2]&&o.All[1]==='All available shifts',d.opts);
 check('Night is not shown as a zero count (no digits in the option text)',!/\d\s*(exception|record)/i.test(o.Night[1]));
 const HID0="not (((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date = '2026-10-01' and shift='Night')";
 const kOpen=psql(`select count(*) from shift_exceptions where ${unres} and ${HID0}`).out,kHigh=psql(`select count(*) from shift_exceptions where ${unres} and ${HID0} and current_priority='High'`).out,kMin=psql(`select coalesce(sum(impact_minutes),0) from shift_exceptions where ${unres} and ${HID0}`).out;
 check(`KPIs unchanged: Open ${kOpen}, High ${kHigh}, Active minutes ${kMin} (all unresolved, carry-forward included)`,d.cards.join()===[kOpen,kHigh,kMin].join(),d.cards);
 const t3=psql(`select category||' - '||issue_type||'|'||current_priority from shift_exceptions where ${unres} and ${HID0} order by case current_priority when 'High' then 0 when 'Medium' then 1 else 2 end, impact_minutes desc, created_at asc limit 3`).out.split('\n');
 check('Top 3 equals the existing rule over all unresolved exceptions',d.top3.length===3&&t3.every((x,i)=>d.top3[i].includes(x.split('|')[0])&&d.top3[i].includes(x.split('|')[1])),[d.top3,t3]);
 const HID="not (((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date = '2026-10-01' and shift='Night')"; // today's Night rows (old/inconsistent data) are hidden at 17:30
 const liveN=+psql(`select count(*) from shift_exceptions where (${unres} or (((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date = '2026-10-01')) and ${HID}`).out;
 check(`Live list = unresolved from any day + resolved of the current operational day (${liveN})`,d.items===liveN,[d.items,liveN]);
 const carried=+psql(`select count(*) from shift_exceptions where ${unres} and ((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date < '2026-10-01'`).out;
 check(`Old unresolved exceptions are still listed and labelled "From <shift> shift · <day>" (${carried})`,d.carry===carried&&carried>0,[d.carry,carried]);
 const oldHigh=psql(`select id from shift_exceptions where ${unres} and current_priority='High' and ((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date < '2026-10-01' order by impact_minutes desc limit 1`).out;
 check('an old High unresolved item is present with its action buttons',await p.evaluate(id=>{const it=document.querySelector(`[data-id="${id}"]`);return !!it&&it.querySelectorAll('.act').length>0;},oldHigh));
 await p.screenshot({path:require('os').tmpdir()+'/'+'ist_dash_1280_1730.png'});
 // previous operational day: Night available
 await p.selectOption('#f-day','day'); await p.fill('#f-date','2026-09-30'); await p.dispatchEvent('#f-date','change'); await T(p,500); d=await dash(p);
 let o2=Object.fromEntries(d.opts.map(x=>[x[0],x]));
 check('previous operational day (30 Sep): First, Second, Night and All are all available',!o2.Night[2]&&!o2.Second[2]&&!o2.First[2]&&o2.All[1]==='All available shifts',d.opts);
 const n930=+psql(`select count(*) from shift_exceptions where ((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date = '2026-09-30'`).out;
 check(`30 Sep lists that day's records (${n930})`,d.items===n930,[d.items,n930]);
 await p.selectOption('#f-shift','Night'); await T(p,300); d=await dash(p); const nn=+psql(`select count(*) from shift_exceptions where shift='Night' and ((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date = '2026-09-30'`).out;
 check(`30 Sep + Night works (${nn})`,d.items===nn,[d.items,nn]);
 // current day chosen explicitly
 await p.fill('#f-date','2026-10-01'); await p.dispatchEvent('#f-date','change'); await T(p,500); d=await dash(p);
 check('choosing the current operational day disables Night again and resets the choice to All',d.opts.find(x=>x[0]==='Night')[2]&&d.opts.find(x=>x[0]==='All')&&await p.inputValue('#f-shift')==='All',d.opts);
 // future day cannot be chosen
 await p.fill('#f-date','2026-10-05'); await p.dispatchEvent('#f-date','change'); await T(p,500); d=await dash(p);
 check('a future operational day cannot be used: date picker max = current operational day and the view clamps to it',d.dateMax==='2026-10-01'&&/Operational Day 01 Oct 2026/.test(d.summary),[d.dateMax,d.summary]);
 await p.selectOption('#f-day','all'); await T(p,400); d=await dash(p); const nAll=+psql(`select count(*) from shift_exceptions where ${HID}`).out;
 check(`All days shows everything (${nAll}) and every shift stays selectable (history stays queryable)`,d.items===nAll&&d.opts.every(x=>!x[2]),[d.items,nAll]);
 await p.close();

 console.log('=== other clock times');
 for(const [t,dis,en] of [['2026-10-01T07:00:00',['Second','Night'],['First']],['2026-10-01T12:59:00',['Second','Night'],['First']],['2026-10-01T13:00:00',['Night'],['First','Second']],['2026-10-01T20:59:00',['Night'],['First','Second']],['2026-10-01T21:00:00',[],['First','Second','Night']],['2026-10-02T02:30:00',[],['First','Second','Night']]]){
   const q=await open('sic1@example.com','dashboard.html',t); const e=await dash(q); const oo=Object.fromEntries(e.opts.map(x=>[x[0],x]));
   check(`${t} IST: disabled=[${dis}] enabled=[${en}]`,dis.every(s=>oo[s][2])&&en.every(s=>!oo[s][2]),e.opts);
   if(t.includes('02:30')) check('02:30 on 02 Oct: Operational Day 01 Oct 2026, As of 02 Oct 2026, 02:30 IST',e.day==='01 Oct 2026'&&e.asof==='02 Oct 2026, 02:30 IST',[e.day,e.asof]);
   await q.close(); }

 console.log('=== left open across a shift change');
 {
  const q=await open('sic1@example.com','dashboard.html','2026-10-01T12:50:00'); let e=await dash(q);
  check('12:50: Current Shift First, Second disabled',e.shift==='First'&&e.opts.find(x=>x[0]==='Second')[2],e);
  const reads0=OPLOG.filter(x=>x.table==='shift_exceptions').length;
  await jump(q,11*60*1000); await T(q,1500); e=await dash(q);
  check('13:01: header now says Second, Second is selectable, Night still disabled, no reload needed',e.shift==='Second'&&!e.opts.find(x=>x[0]==='Second')[2]&&e.opts.find(x=>x[0]==='Night')[2]&&/13:0\d IST/.test(e.asof),e);
  check('the dashboard re-read its data at the rollover',OPLOG.filter(x=>x.table==='shift_exceptions').length>reads0);
  await jump(q,8*60*60*1000); await T(q,1500); e=await dash(q);
  check('21:01: Night becomes available',e.shift==='Night'&&!e.opts.find(x=>x[0]==='Night')[2],e);
  await jump(q,8*60*60*1000); await T(q,1500); e=await dash(q);
  check('05:01 next morning: a new Operational Day begins (02 Oct) and the shift is First',e.day==='02 Oct 2026'&&e.shift==='First'&&e.opts.find(x=>x[0]==='Night')[2],[e.day,e.shift]);
  await q.close();
 }
 console.log('=== timezone: browser in New York');
 { const q=await open('sic1@example.com','dashboard.html','2026-10-01T17:30:00',null,'America/New_York'); const e=await dash(q);
   check('New York device: still Second shift, Operational Day 01 Oct 2026, 17:30 IST; row times are IST',e.shift==='Second'&&e.day==='01 Oct 2026'&&e.asof==='01 Oct 2026, 17:30 IST',e);
   const first=await q.evaluate(()=>document.querySelector('#list .item .meta').textContent); const row=psql(`select to_char(created_at at time zone 'Asia/Kolkata','DD Mon, HH24:MI') from (select created_at from shift_exceptions where ${unres} or ((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date='2026-10-01' order by created_at desc, id desc limit 1) x`).out;
   check('newest row time is shown in IST ('+row+')',first.startsWith(row),[first,row]); await q.close(); }

 console.log('=== Overman');
 { const q=await open('overman1@example.com','dashboard.html','2026-10-01T17:30:00'); let e=await dash(q);
   check('Overman: clock bar present, Night disabled for the live list, All = all available shifts',e.shift==='Second'&&e.opts.find(x=>x[0]==='Night')[2],e.opts);
   check('Overman sees no Day selector (his active list is unresolved work)',await q.evaluate(()=>document.getElementById('f-day-wrap').hidden));
   await q.click('#tab-history'); await T(q,400); e=await dash(q);
   check('Overman My history: all shifts selectable',e.opts.every(x=>!x[2]),e.opts);
   const act=psql(`select count(*) from shift_exceptions where status<>'Resolved' and ${HID0}`).out; await q.click('#tab-active'); await T(q,300); e=await dash(q);
   check('Overman active list shows every unresolved exception except today\'s not-yet-started shift ('+act+')',String(e.items)===act,e.items); await q.close(); }

 console.log('=== mobile 390px');
 { const q=await open('sic1@example.com','dashboard.html','2026-10-01T17:30:00',{width:390,height:800}); const e=await dash(q);
   check('390px: no sideways scroll',e.sw<=e.iw,[e.sw,e.iw]); await q.screenshot({path:require('os').tmpdir()+'/'+'ist_dash_390_1730.png'});
   const h=await q.evaluate(()=>Math.round(document.getElementById('clockbar').getBoundingClientRect().height)); check('390px: clock bar is compact (<=110px)',h<=110,h);
   await q.evaluate(()=>document.getElementById('f-shift').scrollIntoView()); await q.screenshot({path:require('os').tmpdir()+'/'+'ist_dash_390_filters.png'});
   await q.close(); }
 console.log('=== analytics');
 { const q=await open('gm1@example.com','analytics.html','2026-10-01T17:30:00'); const a=await q.evaluate(()=>({note:document.getElementById('partial-note').hidden?'':document.getElementById('partial-note').textContent,shiftOpts:[...document.getElementById('f-shift').options].map(o=>o.disabled)}));
   check('analytics Last 30 days: factual in-progress note with the as-of time (no claim that shifts are excluded)',/may be incomplete because the present operational day is still in progress\. As of 01 Oct 2026, 17:30 IST \(Second shift\)\./.test(a.note)&&!/not counted|excluded/i.test(a.note),a.note);
   check('analytics Night filter stays enabled (history is not restricted)',a.shiftOpts.every(x=>!x),a.shiftOpts);
   await q.selectOption('#f-range','custom'); await q.fill('#f-from','2026-08-01'); await q.fill('#f-to','2026-08-31'); await q.dispatchEvent('#f-to','change'); await T(q,2000);
   check('analytics custom past range: no partial-day note',await q.evaluate(()=>document.getElementById('partial-note').hidden)); await q.close(); }
 await done();
})();
