const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const URL='http://localhost:8765/'; const T=(p,ms)=>p.waitForTimeout(ms);
const IST=s=>new Date(s+'+05:30');
async function open(email,page,iso,vp,tz){
  global.FAKE={t:IST(iso).getTime(),real:Date.now()};
  const p=await newPage(email,vp||{width:1280,height:900},tz);
  await p.clock.install({time:IST(iso)});
  await p.goto(URL+page); await T(p,2500); return p;
}
const box=p=>p.evaluate(()=>({shift:document.getElementById('sb-shift').textContent,day:document.getElementById('sb-day').textContent,time:document.getElementById('sb-time').textContent,note:document.getElementById('sb-note').textContent,radios:document.querySelectorAll('input[name=shift]').length,hidden:document.getElementById('form').hidden}));
const fillForm=async p=>{ await p.selectOption('#location','Siding 1'); await p.click('input[name=category][value="Coal Despatch"]'); await p.selectOption('#issue','Coal shortage'); await p.fill('#description','ist ui test'); await p.fill('#minutes','15'); await p.click('input[name=priority][value="High"]'); };
const lastRpc=()=>[...OPLOG].reverse().find(o=>o.name==='create_exception');
(async()=>{
 console.log('=== NEW EXCEPTION FORM');
 for(const [t,sh,day,tz] of [['2026-10-01T07:00:00','First','01 Oct 2026'],['2026-10-01T17:30:00','Second','01 Oct 2026'],['2026-10-01T19:00:00','Second','01 Oct 2026'],['2026-10-01T22:00:00','Night','01 Oct 2026'],['2026-10-02T02:00:00','Night','01 Oct 2026'],['2026-10-01T04:59:00','Night','30 Sep 2026'],['2026-10-01T05:00:00','First','01 Oct 2026']]){
   const p=await open('sic1@example.com','index.html',t); const b=await box(p);
   check(`${t} IST: form shows ${sh}, Operational Day ${day}, no shift choice`,b.shift===sh&&b.day===day&&b.radios===0&&/IST$/.test(b.time),b);
   await fillForm(p); const n0=OPLOG.length; await p.click('#save'); await T(p,1200);
   const r=lastRpc(); check(`${t}: submit sends p_shift=${sh}`,r&&r.args.p_shift===sh&&OPLOG.length>n0,r&&r.args.p_shift);
   check(`${t}: saved message`,/recorded successfully/.test(await p.textContent('#msg')),await p.textContent('#msg'));
   await p.close();
 }
 // device in another timezone
 for(const tz of ['America/New_York','Pacific/Auckland','UTC']){
   const p=await open('sic1@example.com','index.html','2026-10-01T22:00:00',null,tz); const b=await box(p);
   check(`browser timezone ${tz}: 22:00 IST is still Night, Operational Day 01 Oct 2026, time shown in IST`,b.shift==='Night'&&b.day==='01 Oct 2026'&&b.time==='01 Oct 2026, 22:00 IST',b); await p.close();
   const q=await open('sic1@example.com','index.html','2026-10-02T04:30:00',null,tz); const c=await box(q);
   check(`browser timezone ${tz}: 04:30 IST on 02 Oct is Night of Operational Day 01 Oct`,c.shift==='Night'&&c.day==='01 Oct 2026',c); await q.close();
 }
 // form open across the 13:00 boundary
 {
  const p=await open('sic1@example.com','index.html','2026-10-01T12:58:00'); let b=await box(p); check('12:58 form shows First',b.shift==='First',b);
  await fillForm(p);
  await jump(p,4*60*1000);   // the page's own 15-second check notices 13:00 and asks for a review
  global.FAKE={t:IST('2026-10-01T13:02:00').getTime(),real:Date.now()}; await T(p,300);   // 13:02
  await p.click('#save'); await T(p,500);
  b=await box(p); const m=await p.textContent('#msg'); const n=OPLOG.filter(o=>o.name==='create_exception').length;
  check('13:02 submit: stopped once, nothing sent as First',/shift changed to Second at 13:00 IST/.test(m)&&b.shift==='Second',[m,b.shift]);
  check('the stopped submit did not call the database',OPLOG.filter(o=>o.name==='create_exception').length===n && !(lastRpc()&&lastRpc().args.p_description==='ist ui test'&&lastRpc().args.p_shift==='First' && false));
  check('form keeps the user entries',(await p.inputValue('#description'))==='ist ui test');
  await p.click('#save'); await T(p,1200);
  check('second submit saves as Second',lastRpc().args.p_shift==='Second'&&/recorded successfully/.test(await p.textContent('#msg')),[lastRpc().args.p_shift,await p.textContent('#msg')]);
  await p.close();
 }
 // database refuses a tampered request even if the page is bypassed
 {
  const p=await open('sic1@example.com','index.html','2026-10-01T19:00:00');
  const r=await p.evaluate(async()=>{ const x=await MineShift.db.rpc('create_exception',{p_shift:'Night',p_location:'Siding 1',p_category:'Coal Despatch',p_issue_type:'Coal shortage',p_description:'tamper',p_impact_minutes:5,p_priority:'High'}); return x.error?x.error.message:'saved'; });
  check('19:00: a hand-made request for Night is refused by the database',/current shift is Second/.test(r),r);
  await p.close();
 }
 // Overman form works the same
 { const p=await open('overman1@example.com','index.html','2026-10-01T17:30:00'); const b=await box(p); check('Overman: form shows Second at 17:30',b.shift==='Second'&&!b.hidden,b); await p.close(); }
 // mobile
 { const p=await open('sic1@example.com','index.html','2026-10-01T17:30:00',{width:390,height:800}); const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth})); check('390px form: no sideways scroll',o.sw<=o.iw,o); await p.screenshot({path:'ist_form_390.png'}); await p.close(); }
 await done();
})();
