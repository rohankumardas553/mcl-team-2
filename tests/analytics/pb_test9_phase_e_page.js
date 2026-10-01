process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const A=require((REPO+'/analytics.js'));
const fs=require('fs');
const URL='http://localhost:8765/';
const T=async(p,ms=500)=>p.waitForTimeout(ms);
const db=sql=>psql(sql).out;
const TZ='Asia/Kolkata';
const num=n=>Math.round(n).toLocaleString('en-US');
const one=n=>(Math.round(n*10)/10).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
const forbidden=/\b(good|bad|poor|critical|high risk|low risk|likely|expected|next week|next month|will|should|must|recommend|urgent|score)\b/i;
function whereFor(preset,f,t,fl){const r=A.resolveRange(preset,f,t,new Date()); const w=[]; if(r.from)w.push(`created_at >= '${r.from.toISOString()}'`); if(r.to)w.push(`created_at < '${r.to.toISOString()}'`); if(fl.shift)w.push(`shift='${fl.shift}'`); if(fl.category)w.push(`category='${fl.category}'`); if(fl.location)w.push(`location='${fl.location}'`); return w.length?w.join(' and '):'true';}
const D=`(created_at at time zone '${TZ}')::date`;
const expState=(span,n,act)=>(span<14||n<20||act<7)?'Not Ready':(span>=56&&n>=50&&act>=21)?'Ready':'Limited';
const life=(k,n,sp,T)=>k<10?'Not Ready':(k>=30&&k*100>=T*n&&sp>=28)?'Ready':'Limited';
function exp(W){
  const b=db(`select count(*), coalesce((max(${D})-min(${D})+1),0), count(distinct ${D}), count(distinct to_char(${D},'IYYY-"W"IW')), count(distinct to_char(${D},'YYYY-MM')), coalesce(sum(impact_minutes),0), coalesce(max(impact_minutes),0), count(impact_minutes), coalesce(to_char(min(${D}),'DD Mon YYYY'),''), coalesce(to_char(max(${D}),'DD Mon YYYY'),'') from shift_exceptions where ${W}`).split('|');
  const [n,span,act,wk,mo,tot,big,obs]=b.slice(0,8).map(Number); const mn=b[8], mx=b[9];
  const lf=c=>db(`select count(*), coalesce((max(${D})-min(${D})+1),0) from shift_exceptions where ${W} and ${c}`).split('|').map(Number);
  const [sk,ssp]=lf(`started_at is not null and started_at >= created_at`), [rk,rsp]=lf(`status='Resolved' and resolved_at is not null and resolved_at >= created_at`);
  const cs=expState(span,n,act); let is=tot===0?'Not Ready':expState(span,obs,act); if(is==='Ready'&&big*2>tot) is='Limited';
  const ss=life(sk,n,ssp,50), rs=life(rk,n,rsp,40);
  const ov=(cs==='Ready'&&is==='Ready')?'Ready':(cs==='Not Ready'||is==='Not Ready')?'Not Ready':'Limited';
  return {n,span,act,wk,mo,tot,big,obs,mn,mx,sk,rk,cs,is,ss,rs,ov,zero:span-act,per:act?n/act:null};
}
const OPEN_JS="document.getElementById('detail').open=true;document.getElementById('method').open=true;"; // Management Overview: detail and methodology are collapsed by default
const read=async p=>p.evaluate(()=>{document.getElementById('detail').open=true;document.getElementById('method').open=true;const t=id=>document.getElementById(id)?document.getElementById(id).textContent:null;
  const cards=id=>[...document.querySelectorAll('#'+id+' .card')].map(c=>[c.querySelector('.n').textContent,c.querySelector('.t').textContent,c.querySelector('.s').textContent]);
  const sec=(()=>{const hs=[...document.querySelectorAll('h2')]; const i=hs.findIndex(h=>h.textContent==='Forecast Readiness'); if(i<0) return ''; let out=''; let e=hs[i]; while(e&&!(e.tagName==='P'&&e.style.marginTop==='18px')){ out+=e.innerText+'\n'; e=e.nextElementSibling; } return out;})();
  return {heads:[...document.querySelectorAll('h2')].map(h=>h.textContent),
   badge:{overall:t('r-overall-badge'),count:t('r-count-badge'),impact:t('r-impact-badge'),start:t('r-start-badge'),resolve:t('r-resolve-badge')},
   evidence:{count:[...document.querySelectorAll('#r-count-evidence li')].map(e=>e.textContent),impact:[...document.querySelectorAll('#r-impact-evidence li')].map(e=>e.textContent),start:[...document.querySelectorAll('#r-start-evidence li')].map(e=>e.textContent),resolve:[...document.querySelectorAll('#r-resolve-evidence li')].map(e=>e.textContent)}, overallSummary:document.getElementById('r-overall-summary').textContent, overallNote:document.getElementById('r-overall-note').textContent, reasons:{count:[...document.querySelectorAll('#r-count-reasons li')].map(e=>e.textContent),impact:[...document.querySelectorAll('#r-impact-reasons li')].map(e=>e.textContent),start:[...document.querySelectorAll('#r-start-reasons li')].map(e=>e.textContent),resolve:[...document.querySelectorAll('#r-resolve-reasons li')].map(e=>e.textContent),overall:[...document.querySelectorAll('#r-overall-reasons li')].map(e=>e.textContent)},
   sums:{count:t('r-count-sum'),impact:t('r-impact-sum'),start:t('r-start-sum'),resolve:t('r-resolve-sum')},
   notes:[...document.querySelectorAll('#r-notes li')].map(e=>e.textContent), cov:cards('cov-cards'),conc:cards('conc-cards'),rec:cards('rec-cards'),
   recRows:[...document.querySelectorAll('#rec-body tr')].map(tr=>[...tr.children].map(c=>c.textContent)),
   thr:[...document.querySelectorAll('#thr-body tr')].map(tr=>[...tr.children].map(c=>c.textContent)), sec:sec, full:document.body.innerText, msg:document.getElementById('msg').textContent};});
async function verify(p,label,preset,f,t,fl){ const E=exp(whereFor(preset,f,t,fl)); const R=await read(p);
  check(label+': badges = independent states (count '+E.cs+', impact '+E.is+', start '+E.ss+', resolve '+E.rs+', overall '+E.ov+')',R.badge.count===E.cs&&R.badge.impact===E.is&&R.badge.start===E.ss&&R.badge.resolve===E.rs&&R.badge.overall===E.ov,[R.badge,E]);
  const cv=Object.fromEntries(R.cov.map(c=>[c[1],c[0]]));
  check(label+': Historical Coverage numbers',cv['Total exceptions']===String(E.n)&&cv['Calendar span']===String(E.span)&&cv['Active days']===String(E.act)&&cv['Weeks represented']===String(E.wk)&&cv['Months represented']===String(E.mo)&&cv['Zero-event days']===String(E.zero)&&cv['Total recorded impact minutes']===num(E.tot)&&cv['Exceptions per active day']===(E.per===null?'—':one(E.per))&&cv['Earliest exception']===(E.n?E.mn:'—')&&cv['Latest exception']===(E.n?E.mx:'—'),[cv,E]);
  const cc=Object.fromEntries(R.conc.map(c=>[c[1],c]));
  check(label+': Data Concentration (largest impact, share)',cc['Largest single-event impact'][0]===(E.n?num(E.big)+' min':'—')&&cc['Share of total impact from largest event'][0]===(E.tot>0?(E.big/E.tot*100).toFixed(1)+'%':'—'),[cc['Largest single-event impact'],cc['Share of total impact from largest event'],E.big,E.tot]);
  check(label+': readiness text has only the three states, no score',!/score|\/ ?100|traffic/i.test(R.sec)&&[R.badge.overall,R.badge.count,R.badge.impact,R.badge.start,R.badge.resolve].every(s=>['Not Ready','Limited','Ready'].includes(s)));
  check(label+': every state has written reasons (>=3 lines each), summary line and a note',['count','impact','start','resolve'].every(k=>R.sums[k].length>8&&(R.evidence[k].length>=2||R.sums[k].startsWith('No exceptions')))&&R.notes.length>=1&&R.overallSummary.length>10&&R.overallNote.length>10,[R.evidence,R.notes,R.overallSummary]);
  check(label+': no NaN / Infinity / undefined / null on the page',!/NaN|Infinity|undefined|\bnull\b/.test(R.sec),R.sec.match(/.{20}(NaN|Infinity|undefined|null).{20}/));
  check(label+': readiness text free of judgement / prediction words',!forbidden.test(R.sec),R.sec.match(forbidden));
  return {R,E};
}
(async()=>{
 console.log('=== 22. Phase E: Forecast Readiness on the real page');
 const p=await newPage('gm1@example.com',{width:1280,height:1000});
 const b0=OPLOG.length; await p.goto(URL+'analytics.html'); await T(p,3000);
 let x=await verify(p,'default (Last 30 days)','30',null,null,{});
 const ex0=OPLOG.slice(b0).filter(o=>o.table==='shift_exceptions').length, au0=OPLOG.slice(b0).filter(o=>o.table==='exception_audit').length;
 check('no extra database requests for readiness (1 exceptions read + 1 audit read, same as Phase D)',ex0===1&&au0===1,[ex0,au0]);
 check('headings: Forecast Readiness, Historical Coverage, Data Concentration, Recurrence Coverage',['Forecast Readiness','Historical Coverage','Data Concentration','Recurrence Coverage'].every(h=>x.R.heads.includes(h)),x.R.heads);
 const hi=x.R.heads; check('Forecast Readiness comes after the period-comparison and strategic sections',hi.indexOf('Forecast Readiness')>hi.indexOf('Strategic Management Attention')&&hi.indexOf('Forecast Readiness')>hi.indexOf('Hotspot Movement')&&hi.indexOf('Forecast Readiness')>hi.indexOf('Priority Changes'),hi);
 check('intro says no forecast is made, Ready is not validation, filters change readiness',/It does not generate a forecast/.test(x.R.sec)&&/does not imply statistical validation or guaranteed forecast accuracy/.test(x.R.sec)&&/Readiness changes with the selected filters/.test(x.R.sec)&&/Readiness describes data sufficiency only\. It is not a forecast\./.test(x.R.sec));
 check('thresholds are visible and match the brief (14/20/7, 56/50/21, 50%, 10/30/50%/28, 10/30/40%/28)',(()=>{const t=JSON.stringify(x.R.thr); return ['Fewer than 14 calendar days, fewer than 20 exceptions, or fewer than 7 active days','At least 56 calendar days, at least 50 exceptions, and at least 21 active days','more than 50% of total recorded impact','Fewer than 10 usable start observations','At least 30 usable start observations, usable start times for at least 50%','Fewer than 10 usable resolution observations','usable resolution times for at least 40%','at least 28 calendar days'].every(s=>t.includes(s));})(),x.R.thr);
 // other date ranges
 const setSel=async(id,v)=>{await p.selectOption('#'+id,v); await T(p,2200);};
 await setSel('f-range','7'); await verify(p,'Last 7 days','7',null,null,{});
 await setSel('f-range','90'); x=await verify(p,'Last 90 days','90',null,null,{});
 await setSel('f-range','all'); x=await verify(p,'All time','all',null,null,{});
 check('All time: readiness is shown (allowed) although period comparison is not',x.R.badge.overall==='Ready'&&/not available for All time/.test(x.R.full));
 const allRec=x.R.recRows;
 check('Recurrence table lists the 4 categories in fixed order',allRec.map(r=>r[0]).join()==='Coal Despatch,Dust Suppression,Haul Road,Coal Quality',allRec);
 const rc=db(`select category||'|'||count(*)||'|'||count(distinct ${D})||'|'||count(distinct location)||'|'||count(distinct issue_type) from shift_exceptions group by category`).split('\n'); const rmap={}; rc.forEach(l=>{const a=l.split('|'); rmap[a[0]]=a.slice(1).join('|');});
 check('Recurrence table values = SQL',allRec.every(r=>r.slice(1).join('|')===rmap[r[0]]),[allRec,rmap]);
 const cb=db(`select count(*) filter (where c=1)||'|'||count(*) filter (where c between 2 and 4)||'|'||count(*) filter (where c>=5) from (select count(*) c from shift_exceptions group by category, issue_type) g`).split('|');
 check('Combinations once / 2-4 / 5+ = SQL',JSON.stringify(x.R.rec.map(c=>c[0]))===JSON.stringify(cb),[x.R.rec,cb]);
 // language polish: Ready cards carry no threshold text; the reopened caveat appears once; Limited cards explain only what is missing
 {
   const cards=await p.evaluate(()=>{document.getElementById('detail').open=true;document.getElementById('method').open=true;return [...document.querySelectorAll('.ready-grid .panel')].map(c=>({t:c.innerText,h:c.getBoundingClientRect().height}));});
   check('All time, all Ready: no card repeats threshold text ("Ready requires", "threshold", "minimum")',cards.every(c=>!/Ready requires|threshold|minimum|All Ready/i.test(c.t)),cards.map(c=>c.t.slice(0,80)));
   check('Ready cards show a REASON section only when needed (none here)',cards.every(c=>!/REASON/i.test(c.t)));
   const sec=(await read(p)).sec; check('reopened caveat appears ONCE in the readiness section',(sec.match(/Lifecycle note:/g)||[]).length===1,(sec.match(/Lifecycle note:/g)||[]).length);
   check('ready cards are compact (each under 260 px tall at 1280 px)',cards.every(c=>c.h<260),cards.map(c=>Math.round(c.h)));
 }
 // filters recompute readiness: All categories Ready, Coal Quality at Siding 1 Limited
 await setSel('f-cat','Coal Quality'); await p.selectOption('#f-loc','Siding 1'); await T(p,2200);
 x=await verify(p,'All time + Coal Quality + Siding 1','all',null,null,{category:'Coal Quality',location:'Siding 1'});
 check('filter interaction: the same all-time data is Ready overall but Limited once narrowed to Coal Quality at Siding 1',x.R.badge.overall==='Limited'&&allRec.length===4);
 await p.selectOption('#f-loc','All'); await p.selectOption('#f-shift','Night'); await p.selectOption('#f-cat','Haul Road'); await T(p,2200);
 await verify(p,'All time + Night + Haul Road','all',null,null,{shift:'Night',category:'Haul Road'});
 await p.click('#f-reset'); await T(p,2000);
 await p.selectOption('#f-range','custom'); await p.fill('#f-from','2026-08-01'); await p.fill('#f-to','2026-08-31'); await p.dispatchEvent('#f-to','change'); await T(p,2200);
 x=await verify(p,'Custom 01-31 Aug 2026','custom','2026-08-01','2026-08-31',{});
 check('custom window assessed on its own (span at most 31)',x.E.span<=31&&x.R.badge.count!=='Ready');
 await p.fill('#f-from','2026-09-15'); await p.fill('#f-to','2026-09-15'); await p.dispatchEvent('#f-to','change'); await T(p,2200);
 x=await verify(p,'Custom one day','custom','2026-09-15','2026-09-15',{}); check('one-day custom: span 1, Not Ready',x.E.span===1&&x.R.badge.overall==='Not Ready');
 await p.fill('#f-from','2030-01-01'); await p.fill('#f-to','2030-01-31'); await p.dispatchEvent('#f-to','change'); await T(p,2200);
 x=await verify(p,'Future custom range (no data)','custom','2030-01-01','2030-01-31',{});
 check('no data: all Not Ready, dashes instead of numbers, note says no exceptions',x.R.badge.overall==='Not Ready'&&x.R.notes[0]==='Forecast readiness cannot be assessed because the selected filters contain no exceptions.'&&x.R.cov[0][0]==='—'&&x.R.conc[0][0]==='—');
 check('stale answer guard still works (slow 7-day answer never overwrites the newer 90-day one)',await (async()=>{global.DELAY_MS=1800; await p.selectOption('#f-range','7'); global.DELAY_MS=0; await p.selectOption('#f-range','90'); await T(p,4500); const R=await read(p); const E=exp(whereFor('90',null,null,{})); return R.badge.overall===E.ov&&R.cov.find(c=>c[1]==='Total exceptions')[0]===String(E.n);})());
 check('Phase D parts still present: review items on the overview, full candidates table in the detailed analysis',(await read(p)).heads.includes('Items for Management Review')&&(await read(p)).heads.includes('Management Review Candidates'));
 check('only reads: select + my_access, never a write',OPLOG.every(o=>o.kind==='select'||(o.kind==='rpc'&&o.name==='my_access')));
 check('no page errors',p.errs.length===0,p.errs.join(';'));
 console.log('=== 23. Readiness roles: Overman refused with no data; the four management roles see it');
 for(const u of ['overman1','overman2']){ const b=OPLOG.length; const o=await newPage(u+'@example.com',{width:390,height:800}); await o.goto(URL+'analytics.html'); await T(o,900);
   const s=await o.evaluate(()=>({denied:!document.getElementById('denied').hidden,app:!document.getElementById('app').hidden,ready:!!document.getElementById('r-overall-badge')&&document.getElementById('r-overall-badge').textContent!==''}));
   check(`${u}: Not authorised, no readiness data shown, only my_access requested`,s.denied&&!s.app&&!s.ready&&OPLOG.slice(b).filter(x=>x.user===u+'@example.com').every(x=>x.kind==='rpc'&&x.name==='my_access'),[s,OPLOG.slice(b)]); await o.close(); }
 for(const u of ['sic1','manager1','po1','gm1']){ const o=await newPage(u+'@example.com',{width:1280,height:900}); await o.goto(URL+'analytics.html'); await T(o,2500); const r=await read(o);
   check(`${u}: sees Forecast Readiness with a state`,['Not Ready','Limited','Ready'].includes(r.badge.overall)&&r.heads.includes('Forecast Readiness')); await o.close(); }
 console.log('=== 24. Phase E layout');
 for(const [w,h] of [[320,700],[390,800],[768,900],[1280,900]]){ const m=await newPage('manager1@example.com',{width:w,height:h}); await m.goto(URL+'analytics.html'); await T(m,2600);
   await m.evaluate(()=>{const d=document.querySelector('details.thr'); if(d) d.open=true;}); await T(m,200);
   const s=await m.evaluate(()=>({over:[...document.querySelectorAll('body *')].filter(e=>e.tagName!=='CANVAS'&&e.getBoundingClientRect().right>innerWidth+1&&e.offsetParent!==null).map(e=>e.tagName+'.'+e.className+'#'+e.id).slice(0,5),sw:document.documentElement.scrollWidth,iw:innerWidth,
     heads:['rec-table','thr-table'].map(id=>getComputedStyle(document.querySelector('#'+id+' thead')).display),cardOver:[...document.querySelectorAll('.card')].filter(c=>c.scrollWidth>c.clientWidth+1).length}));
   check(`${w}px: readiness section has no sideways scrolling`,s.over.length===0&&s.sw<=s.iw+1&&s.cardOver===0,s);
   check(`${w}px: readiness tables ${w<1000?'stack into cards':'are real tables'}`,s.heads.every(x=>(w<1000)===(x==='none')),s.heads);
   if(w===390||w===1280){ const el=await m.$('h2:has-text("Forecast Readiness")'); await el.scrollIntoViewIfNeeded(); await m.screenshot({path:`e${w}.png`,fullPage:false}); }
   check(`${w}px: no page errors`,m.errs.length===0,m.errs.join(';')); await m.close(); }
 const css=fs.readFileSync((REPO+'/analytics.html'),'utf8').split('\n').filter(l=>/rbadge/.test(l)).join('\n');
 check('readiness badge colours avoid red/green traffic-light colours',!/#dc2626|#16a34a|#22c55e|#ef4444|red|green/i.test(css),css);
 await done();
})();
