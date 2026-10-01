// Composition donuts on analytics.html (unresolved exceptions / impact minutes by category). Real Chart.js: REAL_CHART=/path/chart.umd.js
// Needs the scratch database with some rows (any build) and gm1 / sic1 accounts.
process.env.TZ='Asia/Kolkata';
const {newPage,check,done,psql}=require('../lib/harness.js');
if(!process.env.REAL_CHART){ console.log('FAIL  set REAL_CHART=/path/to/chart.umd.js'); process.exit(1); }
const T=(p,ms=400)=>p.waitForTimeout(ms);
const URL='http://localhost:8765/analytics.html';
const IDS=['c-act-count','c-act-impact'];
const info=p=>p.evaluate(ids=>Object.fromEntries(ids.map(id=>{
  const cv=document.getElementById(id), ch=window.Chart.getChart(cv), r=cv.getBoundingClientRect();
  let ink=0; try{ const c=cv.getContext('2d'); const d=c.getImageData(0,0,cv.width,cv.height).data; for(let i=3;i<d.length;i+=4*7) if(d[i]>0) ink++; }catch(e){}
  const legend=ch?ch.legend.legendItems.map(x=>x.text):[];
  return [id,{type:ch&&ch.config.type,w:Math.round(r.width),h:Math.round(r.height),ink,labels:ch?ch.data.labels:[],data:ch?ch.data.datasets[0].data:[],legend,overflow:r.right>innerWidth+1}];}),ids),IDS);
(async()=>{
 const cnt=Object.fromEntries(psql(`select category||'|'||count(*) from shift_exceptions where status<>'Resolved' group by category`).out.split('\n').filter(Boolean).map(x=>x.split('|')));
 const imp=Object.fromEntries(psql(`select category||'|'||sum(impact_minutes) from shift_exceptions where status<>'Resolved' group by category having sum(impact_minutes)>0`).out.split('\n').filter(Boolean).map(x=>x.split('|')));
 for(const vw of [390,1280]){
  const p=await newPage('gm1@example.com',{width:vw,height:vw===390?800:900}); await p.goto(URL); await T(p,800);
  await p.selectOption('#f-range','all'); await T(p,2500);
  const i=await info(p);
  for(const id of IDS){
   const x=i[id];
   check(`${vw}px ${id}: doughnut, rendered, in the page`, x.type==='doughnut' && x.w>150 && x.h>200 && x.ink>50 && !x.overflow, JSON.stringify({t:x.type,w:x.w,h:x.h,ink:x.ink}));
  }
  const c=i['c-act-count'], m=i['c-act-impact'];
  check(`${vw}px counts match the database (unresolved by category)`, c.labels.length===Object.keys(cnt).length && c.labels.every((l,k)=>String(c.data[k])===cnt[l]), JSON.stringify([c.labels,c.data,cnt]));
  check(`${vw}px impact minutes match the database`, m.labels.length===Object.keys(imp).length && m.labels.every((l,k)=>String(m.data[k])===imp[l]), JSON.stringify([m.labels,m.data,imp]));
  const tot=c.data.reduce((a,b)=>a+b,0);
  check(`${vw}px legend shows value and correct percentage for every slice`, c.legend.every((t,k)=>t===`${c.labels[k]}: ${c.data[k].toLocaleString('en-US')} (${(c.data[k]/tot*100).toFixed(1)}%)`), JSON.stringify(c.legend));
  check(`${vw}px no sideways scroll`, await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // a filter narrows both donuts to the same category
  await p.selectOption('#f-cat','Haul Road'); await T(p,2000);
  const f=await info(p);
  check(`${vw}px category filter leaves only that category`, f['c-act-count'].labels.every(l=>l==='Haul Road') && f['c-act-impact'].labels.every(l=>l==='Haul Road'), JSON.stringify([f['c-act-count'].labels,f['c-act-impact'].labels]));
  await p.close();
 }
 // empty state: a period with nothing
 const p=await newPage('gm1@example.com',{width:390,height:800}); await p.goto(URL); await T(p,600);
 await p.selectOption('#f-range','custom').catch(()=>{}); await p.fill('#f-from','2001-01-01').catch(()=>{}); await p.fill('#f-to','2001-01-02').catch(()=>{}); await T(p,2000);
 check('empty period shows a plain message instead of an empty ring', /No unresolved exceptions in the selected period/.test(await p.textContent('#c-act-count').then(()=>p.evaluate(()=>document.getElementById('c-act-count').parentNode.innerText))));
 // overman cannot see analytics at all
 const o=await newPage('overman1@example.com'); await o.goto(URL); await T(o,800);
 check('overman still gets Not authorised and no donut', await o.isVisible('#denied') && !(await o.evaluate(()=>!!document.getElementById('c-act-count') && document.getElementById('c-act-count').offsetParent!==null)));
 await done();
})();
