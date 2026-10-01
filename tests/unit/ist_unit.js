const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
// Deterministic boundary tests for shiftclock.js (run under several device timezones) and for the SQL functions.
const C=require((REPO+'/shiftclock.js')); const cp=require('child_process');
let P=0,F=0; const ck=(l,c,x)=>{ if(c){P++;} else {F++; console.log('FAIL',l,x===undefined?'':JSON.stringify(x));} };
const T=s=>Date.parse(s+'+05:30');
const av=i=>Object.entries(C.availability(i,i.opDay)).filter(([,v])=>v.available).map(([k])=>k).join('+');
const cases=[ // [IST time, shift, operational day, available shifts for the current operational day]
 ['2026-10-01T04:59:00','Night','2026-09-30','First+Second+Night'],
 ['2026-10-01T05:00:00','First','2026-10-01','First'],
 ['2026-10-01T07:00:00','First','2026-10-01','First'],
 ['2026-10-01T12:59:00','First','2026-10-01','First'],
 ['2026-10-01T13:00:00','Second','2026-10-01','First+Second'],
 ['2026-10-01T17:30:00','Second','2026-10-01','First+Second'],
 ['2026-10-01T19:00:00','Second','2026-10-01','First+Second'],
 ['2026-10-01T20:59:00','Second','2026-10-01','First+Second'],
 ['2026-10-01T21:00:00','Night','2026-10-01','First+Second+Night'],
 ['2026-10-01T22:00:00','Night','2026-10-01','First+Second+Night'],
 ['2026-10-01T23:59:59','Night','2026-10-01','First+Second+Night'],
 ['2026-10-02T00:00:00','Night','2026-10-01','First+Second+Night'],
 ['2026-10-02T02:30:00','Night','2026-10-01','First+Second+Night'],
 ['2026-10-02T04:59:59','Night','2026-10-01','First+Second+Night'],
 ['2026-10-02T05:00:00','First','2026-10-02','First'],
 ['2026-12-31T23:30:00','Night','2026-12-31','First+Second+Night'],   // year end
 ['2027-01-01T01:00:00','Night','2026-12-31','First+Second+Night'],
 ['2028-02-29T03:00:00','Night','2028-02-28','First+Second+Night']];  // leap day
cases.forEach(([t,sh,od,a])=>{ const i=C.info(T(t)); ck(`${t} shift`,i.shift===sh,i.shift); ck(`${t} op day`,i.opDay===od,i.opDay); ck(`${t} available`,av(i)===a,av(i)); });
// previous operational day is fully available, a future one is not
const i1730=C.info(T('2026-10-01T17:30:00'));
ck('17:30 previous day: all three',['First','Second','Night'].every(s=>C.availability(i1730,'2026-09-30')[s].available));
ck('17:30 today: Night unavailable from 21:00 IST',!C.availability(i1730,'2026-10-01').Night.available&&C.availability(i1730,'2026-10-01').Night.from==='21:00 IST');
ck('17:30 future day: nothing',!['First','Second','Night'].some(s=>C.availability(i1730,'2026-10-02')[s].available));
ck('asOf label',i1730.asOf==='01 Oct 2026, 17:30 IST',i1730.asOf);
const n=C.info(T('2026-10-02T02:10:00')); ck('02:10 label: op day 01 Oct, as of 02 Oct',n.opDayLabel==='01 Oct 2026'&&n.asOf==='02 Oct 2026, 02:10 IST',n);
// next boundary
[['2026-10-01T04:59:00','2026-10-01T05:00:00'],['2026-10-01T05:00:00','2026-10-01T13:00:00'],['2026-10-01T20:59:59','2026-10-01T21:00:00'],['2026-10-01T21:00:00','2026-10-02T05:00:00'],['2026-10-02T02:30:00','2026-10-02T05:00:00']]
 .forEach(([a,b])=>ck(`next boundary after ${a}`,C.nextBoundary(T(a))===T(b),new Date(C.nextBoundary(T(a))).toISOString()));
// stored timestamps: operational day and IST display of created_at
ck('row created 2026-10-01T22:30Z (= 02 Oct 04:00 IST) belongs to 01 Oct',C.opDayOfRow('2026-10-01T22:30:00Z')==='2026-10-01'&&C.fmt('2026-10-01T22:30:00Z')==='02 Oct, 04:00');
ck('row created 2026-10-01T23:30:00Z (= 02 Oct 05:00 IST) belongs to 02 Oct',C.opDayOfRow('2026-10-01T23:30:00Z')==='2026-10-02');
// SQL functions agree with the JS for every case
const sql=cases.map(([t])=>`select '${t}', public.ist_shift('${t}+05:30'), public.ist_operational_date('${t}+05:30')::text`).join(' union all ');
const out=cp.spawnSync('psql',['-h',PGHOST,'-p',PGPORT,'-U','postgres','-At','-d','ms','-c',sql],{encoding:'utf8'}).stdout.trim().split('\n').reduce((m,l)=>{const a=l.split('|');m[a[0]]=[a[1],a[2]];return m;},{});
cases.forEach(([t,sh,od])=>ck(`SQL ${t}: ${sh}, ${od}`,out[t]&&out[t][0]===sh&&out[t][1]===od,out[t]));
// SQL guard at every boundary: the same shift passes, any other is rejected
const g=(sh,t)=>cp.spawnSync('psql',['-h',PGHOST,'-p',PGPORT,'-U','postgres','-At','-d','ms','-c',`select public._check_live_shift('${sh}','${t}+05:30'::timestamptz)`],{encoding:'utf8'});
cases.forEach(([t,sh])=>['First','Second','Night'].forEach(x=>{ const r=g(x,t); const ok=r.status===0; ck(`guard ${t} with ${x} -> ${x===sh?'accept':'reject'}`,ok===(x===sh),r.stderr.trim()); }));
console.log(`TZ=${process.env.TZ||'(default)'} PASS=${P} FAIL=${F}`);
