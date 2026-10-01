process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {newPage,check,done,psql}=require('../lib/harness.js'); const T=(p,ms)=>p.waitForTimeout(ms);
const URL='http://localhost:8765/analytics.html';
const VIS=`const V=e=>e.getClientRects().length>0 && !e.closest('details:not([open])') && !e.closest('[hidden]');`;
(async()=>{
 const res=[];
 // ---- responsive, 3 states x 4 widths
 for(const [w,h] of [[320,700],[390,800],[768,900],[1280,900]]){
   const p=await newPage('gm1@example.com',{width:w,height:h}); await p.goto(URL); await T(p,3000);
   const m=async()=>p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,H:document.documentElement.scrollHeight,
     over:[...document.querySelectorAll('body *')].filter(e=>e.tagName!=='CANVAS'&&e.offsetParent!==null&&!e.closest('details:not([open])')&&e.getBoundingClientRect().right>innerWidth+1).map(e=>e.tagName+'#'+e.id+'.'+e.className).slice(0,4)}));
   const a=await m(); await p.screenshot({path:require('os').tmpdir()+'/'+`mg_${w}_collapsed.png`,fullPage:true});
   await p.click('#detail > summary'); await T(p,600); const b=await m(); await p.screenshot({path:require('os').tmpdir()+'/'+`mg_${w}_detail.png`,fullPage:true});
   await p.click('#method > summary'); await T(p,600); const c=await m(); await p.screenshot({path:require('os').tmpdir()+'/'+`mg_${w}_method.png`,fullPage:true});
   for(const [n,x] of [['collapsed',a],['detailed',b],['methodology',c]]) check(`${w}px ${n}: no sideways scroll (scrollWidth ${x.sw} <= ${x.iw}), height ${x.H}`,x.sw<=x.iw&&x.over.length===0,JSON.stringify(x.over));
   check(`${w}px no page errors`,p.errs.length===0,p.errs.join(';'));
   await p.close();
 }
 // ---- visible by default @1280
 const p=await newPage('gm1@example.com',{width:1280,height:900}); await p.goto(URL); await T(p,3000);
 const s=await p.evaluate(`(()=>{${VIS} return {canv:[...document.querySelectorAll('canvas')].filter(V).map(e=>e.id),tables:[...document.querySelectorAll('table')].filter(V).length,H:document.documentElement.scrollHeight};})()`);
 check('default: only the 2 trend charts and 2 unresolved donuts are visible',s.canv.join()==='c-created,c-impact,c-act-count,c-act-impact',s.canv);
 check('default: no tables visible',s.tables===0,s.tables);
 check('default page height @1280x900 is 2-4 screens',s.H/900>=2&&s.H/900<=4,s.H);
 // ---- filters update visible and hidden
 const snap=async()=>p.evaluate(()=>({
   total:document.getElementById('k-total').textContent, impact:document.getElementById('k-impact').textContent,
   cat:document.getElementById('cat-body').textContent.replace(/\s+/g,' ').slice(0,120),
   cov:document.getElementById('cov-cards').textContent.replace(/\s+/g,' ').slice(0,60),
   fd:['fd-count','fd-impact','fd-start','fd-resolve'].map(i=>document.getElementById(i).textContent),
   rb:['r-count-badge','r-impact-badge','r-start-badge','r-resolve-badge'].map(i=>document.getElementById(i).textContent),
   cons:document.getElementById('constraints-body').rows.length, toploc:document.getElementById('top-loc').innerText.replace(/\s+/g,' ').slice(0,50),
   charts:[...Object.keys(window.__charts||{})].length, catchart:JSON.stringify(window.__charts['c-cat'].data.datasets[0].data),
   prio:document.getElementById('priority-body').innerText.replace(/\s+/g,' ')}));
 const sql=(f)=>psql(`select count(*)||'|'||coalesce(sum(impact_minutes),0) from shift_exceptions where created_at >= ${f}`).out;
 const cases=[
  ['Last 30 days','30','All','All','All'],['Last 90 days','90','All','All','All'],['All time','all','All','All','All'],
  ['Coal Despatch (30d)','30','All','Coal Despatch','All'],['Coal Quality + Stockyard 1 (All time)','all','All','Coal Quality','Stockyard 1'],['Coal Quality + Siding 2 (All time)','all','All','Coal Quality','Siding 2']];
 let prev=null;
 for(const [n,r,sh,ca,lo] of cases){
   await p.selectOption('#f-range',r); await p.selectOption('#f-shift',sh); await p.selectOption('#f-cat',ca); await p.selectOption('#f-loc',lo); await T(p,2600);
   const x=await snap();
   let where=`true`; if(r!=='all') where=`created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '${+r-1} days') at time zone 'Asia/Kolkata' and created_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'`;
   if(ca!=='All') where+=` and category='${ca}'`; if(lo!=='All') where+=` and location='${lo}'`;
   const q=psql(`select count(*)||'|'||coalesce(sum(impact_minutes),0) from shift_exceptions where ${where}`).out.split('|');
   check(`${n}: KPI Exceptions ${x.total} = SQL ${q[0]}; Impact ${x.impact} = SQL ${(+q[1]).toLocaleString('en-US')}`,x.total.replace(/,/g,'')===q[0]&&x.impact.replace(/,/g,'')===q[1],[x.total,x.impact,q]);
   console.log('   ',n,'| forecast block:',x.fd.join(' / '),'| exact (hidden):',x.rb.join(' / '),'| hidden cat table:',x.cat.slice(0,60),'| constraints rows',x.cons);
   const map={'Ready':'Enough data','Limited':'More history needed','Not Ready':'Not enough data'};
   check(`${n}: plain forecast states match exact hidden states`,x.fd.every((v,i)=>v===map[x.rb[i]]),[x.fd,x.rb]);
   if(prev) check(`${n}: hidden sections changed with the filter`,prev.cat!==x.cat||prev.cov!==x.cov||prev.catchart!==x.catchart,[prev.cat,x.cat]);
   prev=x;
 }
 check('no page errors after filter changes',p.errs.length===0,p.errs.join(';'));
 await done();
})();
