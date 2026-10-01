process.env.TZ='Asia/Kolkata';
const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {newPage,check,done,psql}=require('../lib/harness.js'); const T=(p,ms)=>p.waitForTimeout(ms);
const URL='http://localhost:8765/analytics.html';
const ALL=['c-created','c-impact','c-cat','c-loc','c-shift','c-issue'];
const info=(p)=>p.evaluate((ids)=>Object.fromEntries(ids.map(id=>{
  const cv=document.getElementById(id), ch=window.Chart.getChart(cv), r=cv.getBoundingClientRect(), box=cv.parentNode.getBoundingClientRect();
  let ink=0; try{ const c=cv.getContext('2d'); const d=c.getImageData(0,0,cv.width,cv.height).data; for(let i=3;i<d.length;i+=4*7) if(d[i]>0) ink++; }catch(e){}
  return [id,{w:Math.round(r.width),h:Math.round(r.height),bw:Math.round(box.width),cw:cv.width,ch:cv.height,dpr:window.devicePixelRatio,ink,labels:ch?ch.data.labels.length:-1,sum:ch?ch.data.datasets[0].data.reduce((a,b)=>a+(+b||0),0):-1,overflow:r.right>innerWidth+1}];})),ALL);
function sane(id,x,vw){ // rendered at a normal size, in proportion, not blank
  return x.w>150&&x.h>150&&x.h<=300&&x.w<=vw&&x.w<=x.bw+1&&x.ink>50&&Math.abs(x.cw-x.w*x.dpr)<=2*x.dpr&&Math.abs(x.ch-x.h*x.dpr)<=2*x.dpr&&!x.overflow; }
(async()=>{
 for(const vw of [390,1280]){
  const p=await newPage('gm1@example.com',{width:vw,height:vw===390?800:900}); await p.goto(URL); await T(p,3500);
  // A: closed
  let i=await info(p);
  console.log(vw,'closed',JSON.stringify(i['c-created']),JSON.stringify(i['c-cat']));
  for(const id of ['c-created','c-impact']) check(`${vw}px A closed: ${id} renders`,sane(id,i[id],vw),JSON.stringify(i[id]));
  // B: open
  await p.click('#detail > summary'); await T(p,800); i=await info(p);
  for(const id of ALL) check(`${vw}px B open: ${id} normal size, not blank`,sane(id,i[id],vw),JSON.stringify(i[id]));
  await p.screenshot({path:`real_${vw}_open.png`,fullPage:true});
  // C: close + reopen
  await p.click('#detail > summary'); await T(p,400); await p.click('#detail > summary'); await T(p,800); i=await info(p);
  for(const id of ALL) check(`${vw}px C reopen: ${id} still correct`,sane(id,i[id],vw),JSON.stringify(i[id]));
  // D: methodology
  await p.click('#method > summary'); await T(p,600);
  const sw=await p.evaluate(()=>document.documentElement.scrollWidth); check(`${vw}px D methodology: no sideways scroll`,sw<=vw,sw);
  i=await info(p); for(const id of ALL) check(`${vw}px D: ${id} unchanged after opening methodology`,sane(id,i[id],vw),JSON.stringify(i[id]));
  await p.screenshot({path:`real_${vw}_method.png`,fullPage:true});
  // E: change filters while closed, then reopen
  await p.click('#method > summary'); await p.click('#detail > summary'); await T(p,400);
  const cases=[['90','All','Coal Despatch','All'],['all','All','Coal Quality','Stockyard 1'],['30','Night','All','All']];
  for(const [r,sh,ca,lo] of cases){
    await p.selectOption('#f-range',r); await p.selectOption('#f-shift',sh); await p.selectOption('#f-cat',ca); await p.selectOption('#f-loc',lo); await T(p,2600);
    const w=(r==='all'?'true':`created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '${+r-1} days') at time zone 'Asia/Kolkata'`)+(sh!=='All'?` and shift='${sh}'`:'')+(ca!=='All'?` and category='${ca}'`:'')+(lo!=='All'?` and location='${lo}'`:'');
    const sqlShift=+psql(`select count(*) from shift_exceptions where ${w}`).out;
    await p.click('#detail > summary'); await T(p,900); i=await info(p);
    const ok=ALL.every(id=>i[id].labels<=0||sane(id,i[id],vw));
    check(`${vw}px E [${r}/${sh}/${ca}/${lo}] after reopen: 4 hidden charts sized; shift chart total ${i['c-shift'].sum} = SQL ${sqlShift}`,ok&&i['c-shift'].sum===sqlShift,JSON.stringify(ALL.map(id=>[id,i[id].w,i[id].h,i[id].ink])));
    await p.click('#detail > summary'); await T(p,300);
  }
  check(`${vw}px no page errors`,p.errs.length===0,p.errs.join(';'));
  await p.close();
 }
 await done();
})();
