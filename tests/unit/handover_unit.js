// Handover windows and ages (pure functions, no database, no browser).
const REPO=require('path').resolve(__dirname,'..','..');
const C=require(REPO+'/shiftclock.js');
let P=0,F=0; const ck=(l,c,x)=>{ if(c){P++;} else {F++; console.log('FAIL',l,x===undefined?'':JSON.stringify(x));} };
const T=s=>Date.parse(s+'+05:30'); const iso=ms=>new Date(ms+C.IST_OFFSET).toISOString().slice(0,16);
// [IST time, current shift, previous shift, previous shift's Operational Day, window start, window end]
const cases=[
 ['2026-10-02T05:10:00','First','Night','2026-10-01','2026-10-01T21:00','2026-10-02T05:00'],   // the 05:00 case: Night belongs to the PREVIOUS Operational Day
 ['2026-10-02T05:00:00','First','Night','2026-10-01','2026-10-01T21:00','2026-10-02T05:00'],
 ['2026-10-01T13:00:00','Second','First','2026-10-01','2026-10-01T05:00','2026-10-01T13:00'],
 ['2026-10-01T20:59:00','Second','First','2026-10-01','2026-10-01T05:00','2026-10-01T13:00'],
 ['2026-10-01T21:00:00','Night','Second','2026-10-01','2026-10-01T13:00','2026-10-01T21:00'],
 ['2026-10-02T00:30:00','Night','Second','2026-10-01','2026-10-01T13:00','2026-10-01T21:00'],   // after midnight: still the same Operational Day
 ['2026-10-02T04:59:00','Night','Second','2026-10-01','2026-10-01T13:00','2026-10-01T21:00'],
 ['2026-12-31T05:05:00','First','Night','2026-12-30','2026-12-30T21:00','2026-12-31T05:00'],     // year end
 ['2028-03-01T05:05:00','First','Night','2028-02-29','2028-02-29T21:00','2028-03-01T05:00']];    // leap day
cases.forEach(([t,cur,prev,day,s,e])=>{ const i=C.info(T(t)); const p=C.previousShift(i);
  ck(`${t}: current ${cur}`,i.shift===cur,i.shift); ck(`${t}: previous shift ${prev}`,p.shift===prev,p.shift); ck(`${t}: previous shift Operational Day ${day}`,p.opDay===day,p.opDay);
  ck(`${t}: window ${s} -> ${e} IST`,iso(p.startMs)===s&&iso(p.endMs)===e,[iso(p.startMs),iso(p.endMs)]); ck(`${t}: window is exactly 8 hours`,p.endMs-p.startMs===8*3600000); });
// a record created at 03:00 IST belongs to the Night window that ends at 05:00; one at 05:00 does not
const p05=C.previousShift(C.info(T('2026-10-02T05:10:00'))); const inWin=ms=>ms>=p05.startMs&&ms<p05.endMs;
ck('03:00 IST is inside the Night window',inWin(T('2026-10-02T03:00:00'))); ck('04:59:59 IST is inside',inWin(T('2026-10-02T04:59:59'))); ck('05:00:00 IST is outside (First shift)',!inWin(T('2026-10-02T05:00:00'))); ck('20:59 the evening before is outside',!inWin(T('2026-10-01T20:59:00'))); ck('21:00 the evening before is inside',inWin(T('2026-10-01T21:00:00')));
// the device timezone never matters (this file is also run under other TZ values by the runner)
ck('previous shift is the same whatever the device timezone',C.previousShift(C.info(T('2026-10-02T05:10:00'))).shift==='Night');
// ages
[[0,'less than 1 min'],[59999,'less than 1 min'],[60000,'1 min'],[18*60000,'18 min'],[59*60000,'59 min'],[60*60000,'1 h'],[95*60000,'1 h 35 min'],[24*3600000-60000,'23 h 59 min'],[24*3600000,'1 d'],[27*3600000,'1 d 3 h'],[-5000,'less than 1 min'],[NaN,'less than 1 min']]
 .forEach(([ms,t])=>ck(`age ${ms} ms = "${t}"`,C.ageText(ms)===t,C.ageText(ms)));
ck('short label',C.shortLabelOfKey('2026-09-30')==='30 Sep');
ck('error message names the shift',C.shiftFromError('The current shift is Second (since 13:00 IST), not Night.')==='Second'&&C.shiftFromError('nothing')===null);
console.log(`TZ=${process.env.TZ||'(default)'} handover_unit PASS=${P} FAIL=${F}`); process.exit(F?1:0);
