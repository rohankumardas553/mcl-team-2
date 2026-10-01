const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done}=require('../lib/harness.js'); const T=(p,ms)=>p.waitForTimeout(ms); const IST=s=>new Date(s+'+05:30');
(async()=>{
 global.FAKE={t:IST('2026-10-01T12:58:00').getTime(),real:Date.now()};
 const p=await newPage('sic1@example.com'); await p.clock.install({time:IST('2026-10-01T12:58:00')}); await p.goto('http://localhost:8765/index.html'); await T(p,2500);
 await p.selectOption('#location','Siding 1'); await p.click('input[name=category][value="Coal Despatch"]'); await p.selectOption('#issue','Coal shortage'); await p.fill('#description','late submit'); await p.fill('#minutes','5'); await p.click('input[name=priority][value="Low"]');
 await p.clock.setFixedTime(IST('2026-10-01T13:02:00')); global.FAKE={t:IST('2026-10-01T13:02:00').getTime(),real:Date.now()};   // time moves, the 15 s check has not run
 const n=OPLOG.filter(o=>o.name==='create_exception').length; await p.click('#save'); await T(p,600);
 check('13:02 submit before the watcher runs: stopped, nothing sent',OPLOG.filter(o=>o.name==='create_exception').length===n&&/shift changed to Second at 13:00 IST/.test(await p.textContent('#msg')));
 check('indicator now says Second',(await p.textContent('#sb-shift'))==='Second');
 await p.click('#save'); await T(p,1000); const r=[...OPLOG].reverse().find(o=>o.name==='create_exception');
 check('second press saves as Second',r&&r.args.p_shift==='Second'&&/recorded successfully/.test(await p.textContent('#msg')),r&&r.args.p_shift);
 await done();})();
