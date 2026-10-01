process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const A=require((REPO+'/analytics.js'));
const URL='http://localhost:8765/';
const T=async(p,ms=500)=>p.waitForTimeout(ms);
const db=sql=>psql(sql).out;
const num=n=>Math.round(n).toLocaleString('en-US');
const one=n=>(Math.round(n*10)/10).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
const now=new Date();
function whereFor(preset,f,t,fl){const r=A.resolveRange(preset,f,t,new Date()); const w=[]; if(r.from)w.push(`created_at >= '${r.from.toISOString()}'`); if(r.to)w.push(`created_at < '${r.to.toISOString()}'`); if(fl.shift)w.push(`shift='${fl.shift}'`); if(fl.category)w.push(`category='${fl.category}'`); if(fl.location)w.push(`location='${fl.location}'`); return w.length?'where '+w.join(' and '):'';}
function expected(W){ const q=s=>db(`select ${s} from shift_exceptions ${W}`); const and=W?'and':'where';
  const total=+q('count(*)'), imp=+q('coalesce(sum(impact_minutes),0)');
  const st=db(`select count(*), avg(extract(epoch from started_at-created_at)/60), percentile_cont(0.5) within group (order by extract(epoch from started_at-created_at)/60) from shift_exceptions ${W} ${and} started_at is not null and started_at>=created_at`).split('|');
  const rs=db(`select count(*), avg(extract(epoch from resolved_at-created_at)/60), percentile_cont(0.5) within group (order by extract(epoch from resolved_at-created_at)/60) from shift_exceptions ${W} ${and} status='Resolved' and resolved_at is not null and resolved_at>=created_at`).split('|');
  const reo=+db(`with f as (select * from shift_exceptions ${W}) select count(*) from f where exists (select 1 from exception_audit a where a.exception_id=f.id and a.action='reopened')`);
  const res=+q(`count(*) filter (where status='Resolved')`);
  const chg=+db(`with f as (select * from shift_exceptions ${W}) select count(*) from f where exists (select 1 from exception_audit a where a.exception_id=f.id and a.action='priority_changed')`);
  const dim=(d)=>{const m={}; db(`select ${d}||'|'||count(*)||'|'||sum(impact_minutes) from shift_exceptions ${W} group by ${d}`).split('\n').filter(Boolean).forEach(l=>{const [n,c,i]=l.split('|'); m[n]={c:+c,i:+i};}); return m;};
  const groups=db(`select category||'|'||issue_type||'|'||location||'|'||count(*)||'|'||sum(impact_minutes)||'|'||count(*) filter (where status='Resolved') from shift_exceptions ${W} group by category,issue_type,location order by sum(impact_minutes) desc, count(*) desc, (category||' '||issue_type||' '||location) collate "C" asc`).split('\n').filter(Boolean);
  const hs=db(`select category||' · '||location||'|'||sum(impact_minutes)||'|'||count(*) from shift_exceptions ${W} group by category,location order by sum(impact_minutes) desc, count(*) desc, (category||' '||location) collate "C" asc limit 5`).split('\n').filter(Boolean);
  const iss=db(`select issue_type||' ('||category||')|'||count(*) from shift_exceptions ${W} group by issue_type,category order by count(*) desc, sum(impact_minutes) desc, (issue_type||' '||category) collate "C" asc limit 10`).split('\n').filter(Boolean);
  const pri={}; ['High','Medium','Low'].forEach(p=>{const x=db(`select count(*), coalesce(sum(impact_minutes),0) from shift_exceptions ${W} ${and} current_priority='${p}'`).split('|'); pri[p]=[+x[0],+x[1]];});
  return {total,imp,avg:total?imp/total:null,st:{n:+st[0],avg:st[1]===''?null:+st[1],med:st[2]===''?null:+st[2]},rs:{n:+rs[0],avg:rs[1]===''?null:+rs[1],med:rs[2]===''?null:+rs[2]},reo,res,chg,cat:dim('category'),loc:dim('location'),shift:dim('shift'),groups,hs,iss,pri}; }
const read=async p=>p.evaluate(()=>{const t=id=>document.getElementById(id).textContent; const ch=id=>window.__charts&&window.__charts[id]?window.__charts[id]:null;
  return {kpi:['k-total','k-impact','k-avg','k-start','k-resolve','k-reopened'].map(t), kpiSub:['k-avg-sub','k-start-sub','k-resolve-sub'].map(t),
   perf:['p-median-start','p-median-resolve','p-resolved','p-reopened'].map(t), perfSub:['p-median-start-sub','p-median-resolve-sub','p-resolved-sub','p-reopened-sub'].map(t),
   attention:[...document.querySelectorAll('#attention li')].map(e=>e.textContent),
   hot:[...document.querySelectorAll('#hotspots .hot')].map(e=>[e.querySelector('.hot-title').textContent,e.querySelector('.hot-meta').textContent]),
   rows:[...document.querySelectorAll('#constraints-body tr')].map(tr=>[...tr.children].map(c=>c.textContent)),
   more:{hidden:document.getElementById('constraints-more').hidden,text:document.getElementById('constraints-more').textContent},
   constraintsEmpty:!document.getElementById('constraints-empty').hidden,
   prio:[...document.querySelectorAll('#priority-body tr')].map(tr=>[...tr.children].map(c=>c.textContent)), prioChanges:t('priority-changes'),
   charts:Object.fromEntries(['c-created','c-impact','c-cat','c-loc','c-shift','c-issue'].map(id=>[id,ch(id)?{labels:ch(id).data.labels,data:ch(id).data.datasets[0].data,type:ch(id).type,axis:ch(id).options.indexAxis||'x'}:null])),
   titles:[t('t-created'),t('t-impact')], nodata:document.querySelectorAll('.nodata').length,
   loadingHidden:document.getElementById('loading').hidden, contentHidden:document.getElementById('content').hidden, msg:document.getElementById('msg').textContent};});
async function verify(p,label,preset,f,t,fl){ const W=whereFor(preset,f,t,fl); const E=expected(W); const R=await read(p);
  check(label+': Total Exceptions',R.kpi[0]===String(E.total),[R.kpi[0],E.total]);
  check(label+': Total Impact Minutes',R.kpi[1]===num(E.imp));
  check(label+': Average Impact per Exception',R.kpi[2]===(E.avg===null?'—':one(E.avg)),[R.kpi[2],E.avg]);
  check(label+': Average Time to Start',R.kpi[3]===(E.st.n?one(E.st.avg):'—'),[R.kpi[3],E.st]);
  check(label+': Average Time to Resolve',R.kpi[4]===(E.rs.n?one(E.rs.avg):'—'),[R.kpi[4],E.rs]);
  check(label+': Reopened Exceptions',R.kpi[5]===String(E.reo));
  check(label+': Median start / median resolve',R.perf[0]===(E.st.n?one(E.st.med)+' min':'—')&&R.perf[1]===(E.rs.n?one(E.rs.med)+' min':'—'),[R.perf,E.st.med,E.rs.med]);
  check(label+': % Resolved / % Reopened (one decimal)',R.perf[2]===(E.total?(E.res/E.total*100).toFixed(1)+'%':'—')&&R.perf[3]===(E.total?(E.reo/E.total*100).toFixed(1)+'%':'—'),R.perf);
  check(label+': Priority Distribution counts + minutes',['High','Medium','Low'].every((p,i)=>R.prio[i]&&R.prio[i][1]===String(E.pri[p][0])&&R.prio[i][2]===num(E.pri[p][1])),[R.prio,E.pri]);
  check(label+': Priority Changes',R.prioChanges===String(E.chg));
  const top=E.groups.slice(0,15);
  check(label+': Recurring table shows top 15 rows in the right order with every column',R.rows.length===top.length&&top.every((g,i)=>{const [c,is,l,n,m,rsv]=g.split('|'); const r=R.rows[i]; return r[0]===c&&r[1]===is&&r[2]===l&&r[3]===n&&r[4]===num(+m)&&r[5]===one(+m/+n)&&r[6]===rsv;}),[R.rows[0],top[0]]);
  check(label+': Hotspots = top 5 category+location',R.hot.length===E.hs.length&&E.hs.every((h,i)=>{const [name,m,c]=h.split('|'); return R.hot[i][0]===name&&R.hot[i][1]===`${num(+m)} impact minutes · ${c} exception${c==='1'?'':'s'}`;}),[R.hot,E.hs]);
  if(E.total){
    const cats=['Coal Despatch','Dust Suppression','Haul Road','Coal Quality'], locs=['ABC Patch','XYZ Patch','Haul Road A','Haul Road B','MDP Junction','Stockyard 1','Siding 1','Siding 2'], shifts=['First','Second','Night'];
    check(label+': chart Impact by Category (bar)',R.charts['c-cat'].type==='bar'&&JSON.stringify(R.charts['c-cat'].labels)===JSON.stringify(cats)&&JSON.stringify(R.charts['c-cat'].data)===JSON.stringify(cats.map(c=>E.cat[c]?E.cat[c].i:0)));
    check(label+': chart Impact by Location (bar)',JSON.stringify(R.charts['c-loc'].data)===JSON.stringify(locs.map(c=>E.loc[c]?E.loc[c].i:0)));
    check(label+': chart Exceptions by Shift (bar)',JSON.stringify(R.charts['c-shift'].data)===JSON.stringify(shifts.map(c=>E.shift[c]?E.shift[c].c:0)));
    check(label+': chart Top Issue Types = horizontal bar, top 10',R.charts['c-issue'].axis==='y'&&JSON.stringify(R.charts['c-issue'].labels)===JSON.stringify(E.iss.map(x=>x.split('|')[0]))&&JSON.stringify(R.charts['c-issue'].data)===JSON.stringify(E.iss.map(x=>+x.split('|')[1])));
    check(label+': line charts sum to the totals',R.charts['c-created'].type==='line'&&R.charts['c-created'].data.reduce((a,b)=>a+b,0)===E.total&&R.charts['c-impact'].data.reduce((a,b)=>a+b,0)===E.imp);
    check(label+': Strategic Management Attention: 1 to 5 statements (period comparison)',R.attention.length>=1&&R.attention.length<=5&&R.attention.every(x=>x.length>10),R.attention);
  } else {
    check(label+': empty state: 6 charts + 2 donuts say "No data", attention says not enough data',R.nodata===8&&R.attention.length===1&&/^No exceptions in the selected period or the previous period\./.test(R.attention[0])&&R.constraintsEmpty&&R.kpi[2]==='—'&&R.kpiSub[0]==='No exceptions in the selected period',R);
  }
  return {R,E};
}
(async()=>{
 console.log('=== 15. access: Overman is refused, everyone else in');
 for (const u of ['overman1','overman2']) {
   const before=OPLOG.length; const p=await newPage(u+'@example.com',{width:390,height:800}); await p.goto(URL+'analytics.html'); await T(p,700);
   const s=await p.evaluate(()=>({denied:!document.getElementById('denied').hidden,app:!document.getElementById('app').hidden,nav:[...document.querySelectorAll('#nav a')].map(a=>a.textContent),text:document.getElementById('denied').innerText}));
   const ops=OPLOG.slice(before).filter(o=>o.user===u+'@example.com');
   check(`${u}: analytics.html shows "Not authorised", no analytics content`, s.denied&&!s.app&&/Not authorised/.test(s.text));
   check(`${u}: menu has no Analytics link`, !s.nav.includes('Analytics'), s.nav);
   check(`${u}: NO data requested at all (only the sign-in check)`, ops.every(o=>o.kind==='rpc'&&o.name==='my_access'), ops);
   await p.close();
 }
 const p0=await newPage(null); await p0.goto(URL+'analytics.html'); await T(p0,500); check('signed out: analytics.html goes to login.html', p0.url().endsWith('login.html')); await p0.close();
 const NAV={sic1:['Add Shift Exception','Dashboard','Analytics'],sic2:['Add Shift Exception','Dashboard','Analytics'],manager1:['Dashboard','Analytics'],manager2:['Dashboard','Analytics'],po1:['Dashboard','Analytics'],gm1:['Dashboard','Analytics']};
 for (const [u,nav] of Object.entries(NAV)) {
   const before=OPLOG.length; const p=await newPage(u+'@example.com',{width:1280,height:900}); await p.goto(URL+'analytics.html'); await T(p,1800);
   const s=await p.evaluate(()=>({denied:!document.getElementById('denied').hidden,app:!document.getElementById('app').hidden,content:!document.getElementById('content').hidden,nav:[...document.querySelectorAll('#nav a')].map(a=>a.textContent),active:(document.querySelector('#nav a.active')||{}).textContent}));
   check(`${u}: can open Analytics; menu = ${nav.join(' + ')}; Analytics tab highlighted`, s.app&&s.content&&!s.denied&&JSON.stringify(s.nav)===JSON.stringify(nav)&&s.active==='Analytics', s);
   const ops=OPLOG.slice(before).filter(o=>o.user===u+'@example.com');
   check(`${u}: analytics only READS (select on shift_exceptions / exception_audit, my_access)`, ops.every(o=>(o.kind==='select'&&['shift_exceptions','exception_audit'].includes(o.table))||(o.kind==='rpc'&&o.name==='my_access')), ops.map(o=>o.kind+':'+(o.table||o.name)));
   await p.close();
 }
 console.log('=== 16. numbers, charts and tables against the database, for every filter');
 const p=await newPage('gm1@example.com',{width:1280,height:1000});
 const before=OPLOG.length; await p.goto(URL+'analytics.html'); await T(p,2500);
 let x=await verify(p,'default (Last 30 days)','30',null,null,{});
 check('default chart titles say "per day" (30-day range)', x.R.titles[0].includes('per day')&&x.R.titles[1].includes('per day'), x.R.titles);
 check('default line chart has one point per day (30)', x.R.charts['c-created'].data.length===30, x.R.charts['c-created'].data.length);
 const setSel=async(id,v)=>{await p.selectOption('#'+id,v); await T(p,1800);};
 await setSel('f-range','7'); await verify(p,'Last 7 days','7',null,null,{});
 await setSel('f-range','90'); x=await verify(p,'Last 90 days','90',null,null,{}); check('90 days: daily buckets (90 points)', x.R.charts['c-created'].data.length===90&&x.R.titles[0].includes('per day'), x.R.charts['c-created'].data.length);
 await setSel('f-range','all'); x=await verify(p,'All time','all',null,null,{}); check('All time (>90 days): monthly buckets', x.R.titles[0].includes('per month')&&x.R.charts['c-created'].data.length>=12, [x.R.titles[0],x.R.charts['c-created'].data.length]);
 // pagination: 2326 rows need 3 pages of 1000
 const allReads=OPLOG.slice(before).filter(o=>o.table==='shift_exceptions'&&o.filters.length===0);
 check('All time reads every row: 3 requests of 1000 (0-999, 1000-1999, 2000-2999)', JSON.stringify(allReads.map(o=>o.range))===JSON.stringify([[0,999],[1000,1999],[2000,2999]]), allReads.map(o=>o.range));
 check('All time total equals the whole table (no silent 1000-row cut)', x.R.kpi[0]===db('select count(*) from shift_exceptions'), x.R.kpi[0]);
 const auditReads=OPLOG.slice(before).filter(o=>o.table==='exception_audit');
 check('audit history is read in bulk (a few requests, never one per record)', auditReads.length>0&&auditReads.length<=12, auditReads.length);
 await p.selectOption('#f-range','custom'); await T(p,200);
 check('Custom range shows From / To boxes', await p.isVisible('#f-from')&&await p.isVisible('#f-to'));
 await p.fill('#f-from','2026-07-01'); await p.fill('#f-to','2026-08-15'); await p.dispatchEvent('#f-to','change'); await T(p,1800);
 x=await verify(p,'Custom 2026-07-01..2026-08-15','custom','2026-07-01','2026-08-15',{});
 check('custom 46 days: daily', x.R.charts['c-created'].data.length===46, x.R.charts['c-created'].data.length);
 await p.fill('#f-from','2026-08-15'); await p.fill('#f-to','2026-07-01'); await p.dispatchEvent('#f-to','change'); await T(p,500);
 check('Custom From after To shows a clear message', /From date must not be after the To date/.test(await p.textContent('#msg')));
 await p.fill('#f-from','2026-01-01'); await p.fill('#f-to','2026-12-31'); await p.dispatchEvent('#f-to','change'); await T(p,1800);
 x=await verify(p,'Custom whole year 2026','custom','2026-01-01','2026-12-31',{}); check('long custom range: monthly buckets', x.R.titles[0].includes('per month'));
 await p.selectOption('#f-range','all'); await T(p,1500);
 await setSel('f-shift','Night'); await verify(p,'All time + Night','all',null,null,{shift:'Night'});
 await setSel('f-cat','Haul Road'); await verify(p,'All time + Night + Haul Road','all',null,null,{shift:'Night',category:'Haul Road'});
 await setSel('f-loc','Siding 1'); await verify(p,'All time + Night + Haul Road + Siding 1','all',null,null,{shift:'Night',category:'Haul Road',location:'Siding 1'});
 await p.selectOption('#f-shift','All'); await p.selectOption('#f-cat','All'); await T(p,1800); await verify(p,'All time + Siding 1 only','all',null,null,{location:'Siding 1'});
 await p.click('#f-reset'); await T(p,2000); await verify(p,'Reset returns to Last 30 days','30',null,null,{});
 check('Reset restored the filter boxes', (await p.inputValue('#f-range'))==='30'&&(await p.inputValue('#f-shift'))==='All'&&(await p.inputValue('#f-cat'))==='All'&&(await p.inputValue('#f-loc'))==='All');
 // empty result
 await p.selectOption('#f-range','custom'); await p.fill('#f-from','2030-01-01'); await p.fill('#f-to','2030-02-01'); await p.dispatchEvent('#f-to','change'); await T(p,1800);
 await verify(p,'Empty result (future dates)','custom','2030-01-01','2030-02-01',{});
 // recurring table: show all toggle
 await p.selectOption('#f-range','all'); await T(p,2000);
 let R=await read(p); const groups=+db('select count(*) from (select 1 from shift_exceptions group by category,issue_type,location) g');
 check('Recurring table: 15 rows + "Show all N groups" button', R.rows.length===15&&!R.more.hidden&&R.more.text===`Show all ${groups} groups`, [R.rows.length,R.more]);
 await p.evaluate(()=>{document.getElementById('detail').open=true;}); await p.click('#constraints-more'); R=await read(p);
 check('"Show all" lists every group; button flips back', R.rows.length===groups&&/Show top 15 only/.test(R.more.text), [R.rows.length,groups]);
 await p.click('#constraints-more'); R=await read(p); check('"Show top 15 only" returns to 15', R.rows.length===15);
 check('rows in the table never repeat a group', new Set(R.rows.map(r=>r.slice(0,3).join('|'))).size===R.rows.length);
 console.log('=== 17. loading and error states');
 const q=await newPage('sic1@example.com'); global.DELAY_MS=700; await q.goto(URL+'analytics.html'); await T(q,300);
 const ld=await q.evaluate(()=>({loading:!document.getElementById('loading').hidden,text:document.getElementById('loading').textContent}));
 check('clean loading state is shown while data is read', ld.loading&&/Loading analytics/.test(ld.text), ld);
 await T(q,3500); check('loading state goes away when the data arrives', await q.evaluate(()=>document.getElementById('loading').hidden&&!document.getElementById('content').hidden)); global.DELAY_MS=0;
 for (const tbl of ['shift_exceptions','exception_audit']) {
   global.FAIL_TABLE=tbl; const e=await newPage('sic1@example.com'); await e.goto(URL+'analytics.html'); await T(e,1800);
   const m=await e.textContent('#msg'); check(`error reading ${tbl}: friendly message with the actual error text`, new RegExp(`Sorry, the analytics could not load\\. Error: simulated failure reading ${tbl}`).test(m), m);
   check(`error reading ${tbl}: no half-drawn numbers left on the page`, await e.evaluate(()=>document.getElementById('content').hidden), null);
   await e.close(); global.FAIL_TABLE=null;
 }
 console.log('=== 18. phone / tablet / desktop layout');
 for (const [w,h] of [[320,700],[390,800],[768,900],[1280,900]]) {
   const m=await newPage('manager1@example.com',{width:w,height:h}); await m.goto(URL+'analytics.html'); await T(m,2200);
   const s=await m.evaluate(()=>({over:[...document.querySelectorAll('body *')].filter(e=>e.tagName!=='CANVAS'&&e.getBoundingClientRect().right>innerWidth+1).map(e=>e.tagName+'.'+e.className).slice(0,4),thead:getComputedStyle(document.querySelector('#constraints-table thead')).display,sw:document.documentElement.scrollWidth,iw:innerWidth}));
   check(`${w}px: nothing sticks out sideways`, s.over.length===0&&s.sw<=s.iw+1, s);
   check(`${w}px: table ${w<1000?'stacks into cards (no header row)':'shows as a real table'}`, (w<1000)===(s.thead==='none'), s.thead);
   if(w===390) await m.screenshot({path:require('os').tmpdir()+'/'+'an390.png',fullPage:false});
   if(w===1280) await m.screenshot({path:require('os').tmpdir()+'/'+'an1280.png',fullPage:true});
   check(`${w}px: no page errors`, m.errs.length===0, m.errs.join(';')); await m.close();
 }
 check('no page errors (gm1 session)', p.errs.length===0, p.errs.join(';'));
 await done();
})();
