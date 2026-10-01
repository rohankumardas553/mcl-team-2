const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {newPage,check,done,psql,asUser}=require('../lib/harness.js');
const URL='http://localhost:8765/';
const OLD=['Coal Face A','Coal Face B','Junction A','Stockyard A','Siding A','Siding B'];
const NEW=['ABC Patch','XYZ Patch','Haul Road A','Haul Road B','MDP Junction','Stockyard 1','Siding 1','Siding 2'];
const T=async(p,ms=400)=>p.waitForTimeout(ms);
const snap=async p=>p.evaluate(()=>{ document.querySelectorAll('#list details.sec').forEach(d=>{ if(/Remarks/.test(d.firstChild.textContent)) d.open=true; }); const chrome=(()=>{const c=document.body.cloneNode(true); c.querySelectorAll('.desc').forEach(e=>e.remove()); return c.innerText;})(); return ({chrome:chrome,
  cards:document.getElementById('cards').hidden?null:[...document.querySelectorAll('.card .n')].map(e=>e.textContent),
  top3vis:!document.getElementById('col-left').hidden,
  top3:[...document.querySelectorAll('#top3 .item')].map(e=>e.querySelector('.rank').textContent+' '+e.querySelector('.top span').textContent.replace(/^\d/,'')+' | '+e.querySelector('.reason').textContent),
  chart:window.__chart?window.__chart.data.datasets[0].data:null,
  labels:window.__chart?window.__chart.data.labels:null,
  items:document.querySelectorAll('#list > .item').length,
  tabs:!document.getElementById('tabs').hidden,
  text:document.getElementById('list').innerText,
  full:document.body.innerText,
  hist:document.querySelectorAll('#list summary').length?[...document.querySelectorAll('#list summary')].filter(s=>/History/.test(s.textContent)).length:0,
  btns:[...document.querySelectorAll('#list .item:first-child .act')].map(b=>b.textContent),
  locs:[...document.querySelectorAll('#f-loc option')].map(o=>o.textContent)});});
(async()=>{
 console.log('=== 4. dashboard visibility per role');
 const totalActive=+psql(`select count(*) from shift_exceptions where status<>'Resolved'`).out;
 const totalAll=+psql(`select count(*) from shift_exceptions`).out;
 // Add a management remark and an operational remark directly, to test who sees what.
 asUser('manager1@example.com',`select add_remark((select id from shift_exceptions where description='UI test ABC Patch'),'management','MGMT-ONLY-SECRET remark')`);
 asUser('sic1@example.com',`select add_remark((select id from shift_exceptions where description='UI test ABC Patch'),'operational','OPERATIONAL-VISIBLE remark')`);

 // Overman
 let p=await newPage('overman1@example.com'); await p.goto(URL+'dashboard.html'); await T(p,600);
 let s=await snap(p);
 check('overman1: NO KPI cards', s.cards===null);
 check('overman1: NO Top 3 / chart column', !s.top3vis && s.chart===null);
 check('overman1: no "Top 3" or "Active Impact Minutes" text on page', !/Top 3|Active Impact Minutes|Open Exceptions|High Priority/.test(s.full));
 check('overman1: active/history tabs shown', s.tabs);
 check('overman1: list = all active exceptions', s.items===totalActive, `${s.items} vs ${totalActive}`);
 check('overman1: no Resolved card in the active list', !/\bResolved\b\s*$/m.test(s.text.split('\n').filter(l=>l==='Resolved').join('')) && !(await p.$('#list .badge.st-Resolved')));
 check('overman1: sees the operational remark', s.text.includes('OPERATIONAL-VISIBLE remark'));
 check('overman1: NEVER sees management remark', !s.full.includes('MGMT-ONLY-SECRET'));
 check('overman1: NO History section', s.hist===0);
 check('overman1: no old location names, final names in filter', !OLD.some(o=>s.chrome.includes(o)) && JSON.stringify(s.locs.slice(1))===JSON.stringify(NEW), JSON.stringify(s.locs));
 const c1=await p.evaluate(()=>[...document.querySelectorAll('#list > .item')].map(i=>({t:i.innerText,b:[...i.querySelectorAll('.act')].map(b=>b.textContent)})));
 check('overman1: cards show Reported/Current priority text', c1.every(c=>/Reported priority: \w+/.test(c.t)&&/Current priority: \w+/.test(c.t)));
 check('overman1: cards show creator', c1.every(c=>/Reported by /.test(c.t)));
 check('overman1: NO Change priority / Resolve / Reopen / Decline anywhere', c1.every(c=>!c.b.some(x=>/Change priority|Resolve|Reopen|Decline|Confirm Resolved/.test(x))));
 check('overman1: Start on Open cards, Request closure on In progress cards', c1.some(c=>c.b.includes('Start'))&&c1.some(c=>c.b.includes('Request closure')));
 check('overman1: OVERDUE label appears', c1.some(c=>/OVERDUE/.test(c.t)));
 // My history
 await p.click('#tab-history'); await T(p,200);
 const h=await p.evaluate(()=>({n:document.querySelectorAll('#list > .item').length,txt:document.getElementById('list').innerText,sum:document.getElementById('summary').textContent}));
 const mine=+psql(`select count(*) from shift_exceptions where status='Resolved' and created_by=(select id from auth.users where email='overman1@example.com')`).out;
 check('overman1 My history = Resolved records he created', h.n===mine, `${h.n} vs ${mine}`);
 await p.close();
 // overman2 history must not include overman1's
 p=await newPage('overman2@example.com'); await p.goto(URL+'dashboard.html'); await T(p,500); await p.click('#tab-history'); await T(p,200);
 const h2=await p.evaluate(()=>document.querySelectorAll('#list > .item').length);
 check('overman2 My history has none of overman1\'s records', h2===+psql(`select count(*) from shift_exceptions where status='Resolved' and created_by=(select id from auth.users where email='overman2@example.com')`).out, h2);
 await p.close();

 // Shift In-Charge + management roles
 const exp={
  kOpen:+psql(`select count(*) from shift_exceptions where status in ('Open','In progress')`).out,
  kHigh:+psql(`select count(*) from shift_exceptions where current_priority='High' and status<>'Resolved'`).out,
  kMin:+psql(`select coalesce(sum(impact_minutes),0) from shift_exceptions where status<>'Resolved'`).out,
  cats:['Coal Despatch','Dust Suppression','Haul Road','Coal Quality'].map(c=>+psql(`select coalesce(sum(impact_minutes),0) from shift_exceptions where status<>'Resolved' and category='${c}'`).out),
  top:psql(`select rank() over (order by 1) from shift_exceptions limit 0`).out
 };
 const top3sql=psql(`select category||' - '||issue_type||' | '||current_priority||' priority · '||impact_minutes||' min impact' from shift_exceptions where status<>'Resolved' order by case current_priority when 'High' then 0 when 'Medium' then 1 else 2 end, impact_minutes desc, created_at asc limit 3`).out.split('\n');
 for (const u of ['sic1','manager1','manager2','po1','gm1']) {
   p=await newPage(u+'@example.com'); await p.goto(URL+'dashboard.html'); await T(p,700); await p.selectOption('#f-day','all'); await T(p,300); s=await snap(p);  // default view is Live; this check is about every record
   check(`${u}: 3 KPI cards, current_priority based`, JSON.stringify(s.cards)===JSON.stringify([String(exp.kOpen),String(exp.kHigh),String(exp.kMin)]), JSON.stringify(s.cards)+' vs '+JSON.stringify(exp));
   check(`${u}: chart has the 4 categories, active minutes`, JSON.stringify(s.labels)===JSON.stringify(['Coal Despatch','Dust Suppression','Haul Road','Coal Quality'])&&JSON.stringify(s.chart)===JSON.stringify(exp.cats), JSON.stringify(s.chart)+' vs '+JSON.stringify(exp.cats));
   check(`${u}: Top 3 order exact (priority, minutes, older first)`, JSON.stringify(s.top3.map(x=>x.replace(/^\d /,'')))===JSON.stringify(top3sql), JSON.stringify(s.top3)+' vs '+JSON.stringify(top3sql));
   check(`${u}: list shows ALL records (active + resolved)`, s.items===totalAll, `${s.items} vs ${totalAll}`);
   check(`${u}: has History section on each record`, s.hist===s.items, s.hist);
   check(`${u}: sees management remark`, s.full.includes('MGMT-ONLY-SECRET'));
   check(`${u}: sees operational remark`, s.full.includes('OPERATIONAL-VISIBLE'));
   check(`${u}: no tabs, no old location names`, !s.tabs && !OLD.some(o=>s.chrome.includes(o)));
   const b=await p.evaluate(()=>{const all=[...document.querySelectorAll('#list .act')].map(b=>b.textContent);return [...new Set(all)];});
   const has=x=>b.some(t=>t===x);
   const op=u==='sic1'||u==='manager2';
   check(`${u}: Start/Resolve/Reopen/Decline buttons ${op?'PRESENT':'ABSENT'}`, op===(has('Start')&&(has('Resolve')||has('Confirm Resolved'))&&has('Reopen')) , JSON.stringify(b));
   check(`${u}: Change priority button present`, has('Change priority'));
   check(`${u}: remark button = ${u==='sic1'?'operational':'management'}`, u==='sic1'?(has('Add operational remark')&&!has('Add management remark')):(has('Add management remark')&&!has('Add operational remark')), JSON.stringify(b));
   check(`${u}: Request closure only for sic1`, has('Request closure')===(u==='sic1'), JSON.stringify(b));
   check(`${u}: no sideways scroll at 320px`, await (async()=>{await p.setViewportSize({width:320,height:800});await T(p,200);return !(await p.evaluate(()=>[...document.querySelectorAll('body *')].some(e=>e.tagName!=='CANVAS'&&e.getBoundingClientRect().right>innerWidth+1)));})());
   check(`${u}: no page errors`, p.errs.length===0, p.errs.join(';'));
   await p.close();
 }
 console.log('=== 5. filters affect list, KPIs, Top 3 and chart together');
 p=await newPage('gm1@example.com'); await p.goto(URL+'dashboard.html'); await T(p,700); await p.selectOption('#f-day','all'); await T(p,300);
 await p.selectOption('#f-cat','Haul Road'); await p.selectOption('#f-loc','Haul Road A'); await T(p,200); s=await snap(p);
 const fe={o:+psql(`select count(*) from shift_exceptions where status in ('Open','In progress') and category='Haul Road' and location='Haul Road A'`).out,
   h:+psql(`select count(*) from shift_exceptions where current_priority='High' and status<>'Resolved' and category='Haul Road' and location='Haul Road A'`).out,
   m:+psql(`select coalesce(sum(impact_minutes),0) from shift_exceptions where status<>'Resolved' and category='Haul Road' and location='Haul Road A'`).out,
   l:+psql(`select count(*) from shift_exceptions where category='Haul Road' and location='Haul Road A'`).out};
 check('filters: KPI cards follow', JSON.stringify(s.cards)===JSON.stringify([String(fe.o),String(fe.h),String(fe.m)]), JSON.stringify(s.cards)+JSON.stringify(fe));
 check('filters: chart follows (only Haul Road bar has value)', s.chart[0]===0&&s.chart[1]===0&&s.chart[3]===0&&s.chart[2]===fe.m, JSON.stringify(s.chart));
 check('filters: list follows', s.items===fe.l, `${s.items} vs ${fe.l}`);
 check('filters: Top 3 only from that filter', s.top3.every(t=>/Haul Road/.test(t)), JSON.stringify(s.top3));
 await p.selectOption('#f-shift','Night'); await T(p,200); s=await snap(p);
 check('filters combine with Shift (list shrinks or stays)', s.items<=fe.l);
 await p.click('#f-reset'); await T(p,200); s=await snap(p);
 const liveAll=+psql(`select count(*) from shift_exceptions where status<>'Resolved' or (((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date = public.ist_operational_date(now()))`).out;
 check('Show all resets the filters and returns to the default Live view (unresolved + current operational day)', s.items===liveAll && await p.inputValue('#f-day')==='live', `${s.items} vs ${liveAll}`);
 await p.close();
 await done();
})();
