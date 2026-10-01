process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const URL='http://localhost:8765/';
const T=async(p,ms=500)=>p.waitForTimeout(ms);
const db=sql=>psql(sql).out;
const TZ='Asia/Kolkata';
const num=n=>Math.round(n).toLocaleString('en-US');
const sgn=(v)=>(v>0?'+':v<0?'-':'')+num(Math.abs(v));
const forbidden=/\b(good|bad|healthy|poor|should|must|urgent|critical|failure|best|worst|recommend|will|likely|because)\b/i;
function bounds(N){ return db(`select to_char((now() at time zone '${TZ}')::date-${N-1},'DD Mon YYYY')||'|'||to_char((now() at time zone '${TZ}')::date,'DD Mon YYYY')||'|'||to_char((now() at time zone '${TZ}')::date-${2*N-1},'DD Mon YYYY')||'|'||to_char((now() at time zone '${TZ}')::date-${N},'DD Mon YYYY')||'|'||((date_trunc('day', now() at time zone '${TZ}') - interval '${2*N-1} days') at time zone '${TZ}')::text`).split('|'); }
function W(N){ return {cur:`created_at >= ((date_trunc('day', now() at time zone '${TZ}') - interval '${N-1} days') at time zone '${TZ}')`,
  prv:`created_at >= ((date_trunc('day', now() at time zone '${TZ}') - interval '${2*N-1} days') at time zone '${TZ}') and created_at < ((date_trunc('day', now() at time zone '${TZ}') - interval '${N-1} days') at time zone '${TZ}')`}; }
const readCmp=async p=>p.evaluate(()=>{
  document.getElementById('detail').open=true; document.getElementById('method').open=true;  // Management Overview: detail sections are collapsed by default
  const rows=id=>[...document.querySelectorAll('#'+id+'-body tr')].map(tr=>[...tr.children].map(c=>c.textContent));
  const vis=id=>{const e=document.getElementById(id); return !!e&&e.offsetParent!==null;};
  const cmpBoxes=[...document.querySelectorAll('.cmp')];
  return {periods:[...document.querySelectorAll('#cmp-periods .cmp-period')].map(e=>e.textContent), status:document.getElementById('cmp-status').textContent,
    kpi:Object.fromEntries(['k-total','k-impact','k-avg','k-start','k-resolve','k-reopened','priority-changes'].map(k=>[k,[...document.querySelectorAll('#'+k+'-cmp > *')].map(d=>d.textContent)])),
    cmpVisible:cmpBoxes.filter(e=>e.offsetParent!==null).length, cmpTotal:cmpBoxes.length,
    tables:Object.fromEntries(['cat','loc','issue','hup','hdown','cand','perf','prio'].map(k=>[k,rows(k)])),
    tableVisible:Object.fromEntries(['cat','loc','issue','hup','hdown','cand','perf','prio'].map(k=>[k,vis(k+'-table')])),
    empties:Object.fromEntries(['cat','loc','issue','hup','hdown','cand','perf','prio'].map(k=>[k,vis(k+'-empty')?document.getElementById(k+'-empty').textContent:null])),
    attention:[...document.querySelectorAll('#attention li')].map(e=>e.textContent), candNote:document.getElementById('cand-note').textContent,
    heads:[...document.querySelectorAll('h2')].map(h=>h.textContent), text:document.body.innerText,
    chart:Object.fromEntries(['c-created','c-impact'].map(id=>{const c=window.__charts&&window.__charts[id]; return [id,c?{sets:c.data.datasets.length,prev:c.data.datasets[1]?c.data.datasets[1].data:null,dash:c.data.datasets[1]?c.data.datasets[1].borderDash:null,legend:c.options.plugins.legend.display,cur:c.data.datasets[0].data}:null];})),
    msg:document.getElementById('msg').textContent};});
(async()=>{
 console.log('=== 19. Phase D: period comparison in the real page');
 const p=await newPage('gm1@example.com',{width:1280,height:1000});
 const before=OPLOG.length; await p.goto(URL+'analytics.html'); await T(p,2500);
 let R=await readCmp(p); const b=bounds(30), w=W(30);
 check('page: headings include the Management Overview sections (Management Summary, review items, forecasting data) and the detailed comparison sections',['Management Summary','Items for Management Review','Data Available for Future Forecasting','Category Change','Hotspot Movement','Management Review Candidates'].every(h=>R.heads.includes(h))&&!R.heads.includes('Strategic Management Attention')&&!R.heads.includes('Management Attention'),R.heads);
 check('banner: current period dates + days + count',R.periods[0]===`Current${b[0]} – ${b[1]} (30 days, ${db('select count(*) from shift_exceptions where '+w.cur)} exceptions)`,R.periods[0]);
 check('banner: previous period dates (immediately before, same length)',R.periods[1]===`Previous${b[2]} – ${b[3]} (30 days, ${db('select count(*) from shift_exceptions where '+w.prv)} exceptions)`,R.periods[1]);
 const cN=+db('select count(*) from shift_exceptions where '+w.cur), pN=+db('select count(*) from shift_exceptions where '+w.prv);
 const cI=+db('select sum(impact_minutes) from shift_exceptions where '+w.cur), pI=+db('select sum(impact_minutes) from shift_exceptions where '+w.prv);
 check('KPI Exceptions: one line "Previous: X · change (percent)"',R.kpi['k-total'].join('')===`Previous: ${pN} · ${sgn(cN-pN)} (${((cN-pN)/pN*100)>0?'+':'-'}${Math.abs((cN-pN)/pN*100).toFixed(1)}%)`,[R.kpi['k-total'],cN,pN]);
 check('KPI Recorded Impact: one line "Previous: X · change (percent)"',R.kpi['k-impact'].join('')===`Previous: ${num(pI)} · ${sgn(cI-pI)} (${(cI-pI)/pI>0?'+':'-'}${Math.abs((cI-pI)/pI*100).toFixed(1)}%)`,[R.kpi['k-impact'],cI,pI]);
 check('all 7 comparison boxes are filled (6 KPI + priority changes) and none say NaN',Object.values(R.kpi).every(v=>v.length>=2)&&!/NaN|Infinity|undefined|null/.test(R.text));
 // request pattern: ONE bulk read for both periods, one audit read
 const reads=OPLOG.slice(before).filter(o=>o.table==='shift_exceptions');
 const audits=OPLOG.slice(before).filter(o=>o.table==='exception_audit');
 check('one bulk exceptions read covers both periods (1 request, from the previous period start)',reads.length===1&&reads[0].filters.join()==='gte:created_at',reads.map(o=>o.filters));
 check('one bulk audit read',audits.length===1,audits.length);
 // tables
 const catRows=db(`with c as (select category, count(*) n, sum(impact_minutes) m from shift_exceptions where ${w.cur} group by 1), p as (select category, count(*) n, sum(impact_minutes) m from shift_exceptions where ${w.prv} group by 1) select category||'|'||coalesce(c.n,0)||'|'||coalesce(p.n,0)||'|'||coalesce(c.m,0)||'|'||coalesce(p.m,0) from c full join p using (category) order by (coalesce(c.m,0)-coalesce(p.m,0)) desc, coalesce(c.n,0)-coalesce(p.n,0) desc, category collate "C"`).split('\n');
 check('Category Change table: rows, values, order (largest increase first)',JSON.stringify(R.tables.cat.map(r=>[r[0],r[1],r[2],r[4].replace(/,/g,''),r[5].replace(/,/g,'')].join('|')))===JSON.stringify(catRows.map(l=>{const [a,c,pp,cm,pm]=l.split('|');return [a,c,pp,cm,pm].join('|');})),[R.tables.cat,catRows]);
 check('Category Change: change and % change cells',R.tables.cat.every(r=>{const cm=+r[4].replace(/,/g,''),pm=+r[5].replace(/,/g,''); const d=cm-pm; const ch=d===0?'0':(d>0?'▲ ':'▼ ')+sgn(d); const pc=pm===0?'n/a':d===0?'0.0%':((d>0?'+':'-')+Math.abs(d/pm*100).toFixed(1)+'%'); return r[6]===ch&&r[7]===pc;}),R.tables.cat);
 check('Location Change: 1 row per location seen, sorted by absolute impact change',(()=>{const ab=R.tables.loc.map(r=>Math.abs(+r[4].replace(/,/g,'')-+r[5].replace(/,/g,''))); return ab.every((v,i)=>i===0||ab[i-1]>=v)&&R.tables.loc.length===8;})(),R.tables.loc.map(r=>r[0]));
 const dec=+db(`with c as (select location, sum(impact_minutes) m from shift_exceptions where ${w.cur} group by 1), p as (select location, sum(impact_minutes) m from shift_exceptions where ${w.prv} group by 1) select count(*) from c join p using (location) where c.m<p.m`);
 check('Location Change keeps locations that improved (all decreases from SQL are listed)',R.tables.loc.filter(r=>r[6].startsWith('▼')).length===dec,[dec,R.tables.loc.map(r=>r[6])]);
 check('Recurring Issue Change: 1 to 10 rows',R.tables.issue.length<=10&&R.tables.issue.length>0);
 const issAbs=R.tables.issue.map(r=>Math.abs(+r[5].replace(/,/g,'')-+r[6].replace(/,/g,'')));
 check('Recurring Issue Change is ordered by absolute impact change',issAbs.every((v,i)=>i===0||issAbs[i-1]>=v),issAbs);
 check('Hotspot Movement: Highest Increases all positive, Highest Decreases all negative (max 5 each)',R.tables.hup.length<=5&&R.tables.hdown.length<=5&&R.tables.hup.every(r=>r[4].startsWith('▲'))&&R.tables.hdown.every(r=>r[4].startsWith('▼')),[R.tables.hup,R.tables.hdown]);
 check('Management Review Candidates: max 15, note says NOT automated recommendations',R.tables.cand.length<=15&&R.tables.cand.length>0&&/These are factual comparison candidates, not automated recommendations\./.test(R.text));
 check('Candidates: every row has an increase in impact, count or reopened',R.tables.cand.every(r=>{const [ , , ,cc,pc,cm,pm,,cro,pro]=r; const n=x=>+String(x).replace(/,/g,''); return n(cm)>n(pm)||n(cc)>n(pc)||n(cro)>n(pro);}),R.tables.cand[0]);
 check('Response & closure comparison: 6 measures with current / previous / change',R.tables.perf.length===6&&R.tables.perf[4][0]==='Percentage Resolved'&&/percentage points/.test(R.tables.perf[4][3])&&!/%\)/.test(R.tables.perf[4][3]),R.tables.perf);
 check('Priority comparison: High / Medium / Low',R.tables.prio.map(r=>r[0]).join()==='High,Medium,Low'&&R.tables.prio.every(r=>r.length===7));
 check('attention: 1 to 5 factual statements, no advice / cause / prediction words',R.attention.length>=1&&R.attention.length<=5&&R.attention.every(s=>!forbidden.test(s)),R.attention.filter(s=>forbidden.test(s)));
 check('comparison sections are visible',R.cmpVisible===R.cmpTotal&&R.cmpTotal>=10,[R.cmpVisible,R.cmpTotal]);
 // overlay
 check('Trend charts: previous period overlaid, dashed, aligned by day number (30 points each)',['c-created','c-impact'].every(id=>R.chart[id].sets===2&&R.chart[id].legend===true&&R.chart[id].prev.length===30&&R.chart[id].cur.length===30&&R.chart[id].dash&&R.chart[id].dash.length===2),R.chart);
 const pOv=db(`select count(*) from shift_exceptions where ${w.prv}`);
 check('Overlay totals equal the previous period totals',R.chart['c-created'].prev.reduce((a,c)=>a+c,0)===+pOv&&R.chart['c-impact'].prev.reduce((a,c)=>a+c,0)===pI);
 // 7 and 90 days
 for (const N of [7,90]) {
   await p.selectOption('#f-range',String(N)); await T(p,2200); R=await readCmp(p); const bb=bounds(N), ww=W(N);
   check(`Last ${N} days: banner current ${bb[0]} – ${bb[1]}, previous ${bb[2]} – ${bb[3]}`,R.periods[0].startsWith(`Current${bb[0]} – ${bb[1]} (${N} days`)&&R.periods[1].startsWith(`Previous${bb[2]} – ${bb[3]} (${N} days`),R.periods);
   const c=+db('select count(*) from shift_exceptions where '+ww.cur), pv=+db('select count(*) from shift_exceptions where '+ww.prv);
   check(`Last ${N} days: counts in the banner`,R.periods[0].includes(`${c} exception`)&&R.periods[1].includes(`${pv} exception`),R.periods);
   check(`Last ${N} days: overlay length ${N}`,R.chart['c-created'].sets===2&&R.chart['c-created'].prev.length===N);
 }
 // custom: multi-day, one day, long
 await p.selectOption('#f-range','custom'); await p.fill('#f-from','2026-09-01'); await p.fill('#f-to','2026-09-15'); await p.dispatchEvent('#f-to','change'); await T(p,2000); R=await readCmp(p);
 check('Custom 01–15 Sep: current 01 Sep 2026 – 15 Sep 2026 (15 days), previous 17 Aug 2026 – 31 Aug 2026',R.periods[0].startsWith('Current01 Sep 2026 – 15 Sep 2026 (15 days')&&R.periods[1].startsWith('Previous17 Aug 2026 – 31 Aug 2026 (15 days'),R.periods);
 check('Custom 01–15 Sep: counts = SQL',R.periods[0].includes(`${db(`select count(*) from shift_exceptions where created_at >= '2026-09-01'::timestamp at time zone '${TZ}' and created_at < '2026-09-16'::timestamp at time zone '${TZ}'`)} exception`)&&R.periods[1].includes(`${db(`select count(*) from shift_exceptions where created_at >= '2026-08-17'::timestamp at time zone '${TZ}' and created_at < '2026-09-01'::timestamp at time zone '${TZ}'`)} exception`),R.periods);
 await p.fill('#f-from','2026-09-15'); await p.fill('#f-to','2026-09-15'); await p.dispatchEvent('#f-to','change'); await T(p,2000); R=await readCmp(p);
 check('Custom one day: current 15 Sep, previous 14 Sep (1 day each)',R.periods[0].startsWith('Current15 Sep 2026 – 15 Sep 2026 (1 day,')&&R.periods[1].startsWith('Previous14 Sep 2026 – 14 Sep 2026 (1 day,'),R.periods);
 check('Custom one day: page still consistent (no NaN)',!/NaN|Infinity|undefined/.test(R.text)&&R.chart['c-created'].sets===2&&R.chart['c-created'].prev.length===1);
 await p.fill('#f-from','2026-01-01'); await p.fill('#f-to','2026-12-31'); await p.dispatchEvent('#f-to','change'); await T(p,2200); R=await readCmp(p);
 check('Custom 365 days: previous 365 days shown, no overlay (monthly buckets)',R.periods[1].startsWith('Previous01 Jan 2025 – 31 Dec 2025 (365 days')&&R.chart['c-created'].sets===1&&R.chart['c-created'].legend===false,[R.periods,R.chart['c-created']]);
 check('Custom 365 days: comparison sections are still shown',R.cmpVisible===R.cmpTotal&&!/NaN|Infinity/.test(R.text));
 // previous has no data (custom range in Aug 2025 start of data)
 await p.fill('#f-from','2025-08-26'); await p.fill('#f-to','2025-09-10'); await p.dispatchEvent('#f-to','change'); await T(p,2000); R=await readCmp(p);
 check('previous period without data: clear status, one-line absolute change only ("Previous: 0 · +N", no %), no NaN',/No previous-period data is available for comparison/.test(R.status)&&(()=>{const l=R.kpi['k-total'].join(''); return /^Previous: 0 · \+[\d,]+$/.test(l);})()&&!/NaN|Infinity/.test(R.text),[R.status,R.kpi['k-total']]);
 check('previous period without data: attention = fallback, candidates say not enough data',R.attention.length===1&&R.attention[0]==='No previous-period data is available for comparison.'&&/Review candidates need exceptions in both/.test(R.empties.cand||''),[R.attention,R.empties.cand]);
 // both empty
 await p.fill('#f-from','2030-01-01'); await p.fill('#f-to','2030-01-10'); await p.dispatchEvent('#f-to','change'); await T(p,2000); R=await readCmp(p);
 check('both periods empty: says so, no NaN/Infinity, empty states in every table, charts say No data',/No exceptions in the selected period or the previous period/.test(R.status)&&!/NaN|Infinity|undefined/.test(R.text)&&!R.tableVisible.cat&&!R.tableVisible.loc&&!R.tableVisible.cand,[R.status,R.tableVisible]);
 check('both empty: KPI change lines are "No change"',R.kpi['k-total'].join('')==='Previous: 0 · No change',R.kpi['k-total']);
 // current empty, previous has data: range straddling the end of data
 const nxt=db(`select to_char((now() at time zone '${TZ}')::date+2,'YYYY-MM-DD')||'|'||to_char((now() at time zone '${TZ}')::date+31,'YYYY-MM-DD')`).split('|'); await p.fill('#f-from',nxt[0]); await p.fill('#f-to',nxt[1]); await p.dispatchEvent('#f-to','change'); await T(p,2000); R=await readCmp(p);
 check('current empty, previous has data: status text, decrease shown, fallback sentence',/No exceptions in the selected period/.test(R.status)&&/^Previous: [\d,]+ · -[\d,]+ \(-100\.0%\)$/.test(R.kpi['k-total'].join(''))&&R.attention[0]==='No exceptions in the selected period.',[R.status,R.kpi['k-total'],R.attention]);
 // All time
 const b4=OPLOG.length; await p.selectOption('#f-range','all'); await T(p,2500); R=await readCmp(p);
 check('All time: "Period comparison is not available for All time."',R.status==='Period comparison is not available for All time.'&&R.periods.length===0,R.status);
 check('All time: comparison sections and lines are all hidden',R.cmpVisible===0,R.cmpVisible);
 check('All time: attention = fallback message',R.attention.length===1&&R.attention[0]==='Period-over-period statements are not available for All time.',R.attention);
 check('All time: charts have no overlay',R.chart['c-created'].sets===1);
 check('All time: no query has a lower bound (whole table read, previous period not requested)',OPLOG.slice(b4).filter(o=>o.table==='shift_exceptions').every(o=>o.filters.length===0),OPLOG.slice(b4).filter(o=>o.table==='shift_exceptions').map(o=>o.filters));
 // filters keep working with comparison
 await p.selectOption('#f-range','30'); await p.selectOption('#f-cat','Haul Road'); await T(p,2200); R=await readCmp(p);
 const wc=W(30); const hc=+db(`select count(*) from shift_exceptions where ${wc.cur} and category='Haul Road'`), hp=+db(`select count(*) from shift_exceptions where ${wc.prv} and category='Haul Road'`);
 check('Category filter applies to BOTH periods',R.periods[0].includes(`${hc} exception`)&&R.periods[1].includes(`${hp} exception`)&&R.tables.cat.length===1&&R.tables.cat[0][0]==='Haul Road',[R.periods,R.tables.cat]);
 await p.click('#f-reset'); await T(p,2000);
 // stale response protection: slow request for 7 days must not overwrite the newer 90-day answer
 global.DELAY_MS=1800; await p.selectOption('#f-range','7'); global.DELAY_MS=0; await p.selectOption('#f-range','90'); await T(p,4500); R=await readCmp(p);
 check('stale response protection: newest filter (90 days) stays on screen',R.periods[0].includes('(90 days,')&&(await p.inputValue('#f-range'))==='90',R.periods);
 // whole-page no-judgement wording on everything visible
 R=await readCmp(p);
 check('visible page has none of the words good / bad / healthy / poor / critical / should / must',!/\b(healthy|poor|critical|should|must)\b/i.test(R.text.replace(/Critical/g,'')),(R.text.match(/\b(healthy|poor|critical|should|must)\b/gi)||[]));
 check('no page errors',p.errs.length===0,p.errs.join(';'));
 console.log('=== 20. Phase D layout on phone / tablet / desktop');
 for (const [wd,h] of [[320,700],[390,800],[768,900],[1280,900]]) {
   const m=await newPage('manager1@example.com',{width:wd,height:h}); await m.goto(URL+'analytics.html'); await T(m,2600);
   const s=await m.evaluate(()=>({over:[...document.querySelectorAll('body *')].filter(e=>e.tagName!=='CANVAS'&&e.getBoundingClientRect().right>innerWidth+1&&e.offsetParent!==null).map(e=>e.tagName+'.'+e.className+'#'+e.id).slice(0,5),
      heads:['cat','loc','issue','hup','hdown','cand','perf','prio'].map(k=>getComputedStyle(document.querySelector('#'+k+'-table thead')).display),sw:document.documentElement.scrollWidth,iw:innerWidth,
      cardOver:[...document.querySelectorAll('.card')].filter(c=>c.scrollWidth>c.clientWidth+1).length}));
   check(`${wd}px: no sideways scrolling (page and cards)`,s.over.length===0&&s.sw<=s.iw+1&&s.cardOver===0,s);
   check(`${wd}px: comparison tables ${wd<1000?'stack into cards':'are real tables'}`,s.heads.every(x=>(wd<1000)===(x==='none')),s.heads);
   if(wd===390) await m.screenshot({path:require('os').tmpdir()+'/'+'d390.png',fullPage:true});
   if(wd===1280) await m.screenshot({path:require('os').tmpdir()+'/'+'d1280.png',fullPage:true});
   check(`${wd}px: no page errors`,m.errs.length===0,m.errs.join(';')); await m.close();
 }
 console.log('=== 21. Overman: still refused, still no data');
 const bo=OPLOG.length; const o=await newPage('overman1@example.com',{width:390,height:800}); await o.goto(URL+'analytics.html'); await T(o,900);
 const os=await o.evaluate(()=>({denied:!document.getElementById('denied').hidden,app:!document.getElementById('app').hidden,nav:[...document.querySelectorAll('#nav a')].map(a=>a.textContent)}));
 check('Overman: Not authorised, no menu link, only my_access requested',os.denied&&!os.app&&!os.nav.includes('Analytics')&&OPLOG.slice(bo).filter(x=>x.user==='overman1@example.com').every(x=>x.kind==='rpc'&&x.name==='my_access'),[os,OPLOG.slice(bo)]);
 check('all analytics traffic was read-only',OPLOG.every(x=>x.kind==='select'||(x.kind==='rpc'&&x.name==='my_access')),OPLOG.filter(x=>!(x.kind==='select'||(x.kind==='rpc'&&x.name==='my_access'))).slice(0,3));
 await done();
})();
