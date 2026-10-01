// Unsent NEW-exception draft: survives a refresh and a failed (weak-network) save; cleared after success or "Clear form"; per person.
process.env.TZ='Asia/Kolkata';
const {OPLOG,newPage,check,done,psql}=require('../lib/harness.js');
const T=(p,ms)=>p.waitForTimeout(ms); const IST=s=>new Date(s+'+05:30');
async function open(email,iso,vp){ global.FAKE={t:IST(iso).getTime(),real:Date.now()}; global.FAIL_CLOCK=false; const p=await newPage(email,vp||{width:390,height:800}); await p.clock.install({time:IST(iso)}); await p.goto('http://localhost:8765/index.html'); await T(p,2500); return p; }
const vals=p=>p.evaluate(()=>({loc:document.getElementById('location').value,cat:(document.querySelector('input[name=category]:checked')||{}).value||'',issue:document.getElementById('issue').value,desc:document.getElementById('description').value,min:document.getElementById('minutes').value,pri:(document.querySelector('input[name=priority]:checked')||{}).value||'',note:document.getElementById('draft-note').hidden?'':document.getElementById('draft-note').textContent,clear:!document.getElementById('clear-draft').hidden,store:Object.keys(sessionStorage).filter(k=>k.startsWith('mineshift.draft')).length,sw:document.documentElement.scrollWidth,iw:innerWidth}));
const fill=async p=>{ await p.selectOption('#location','Haul Road B'); await p.click('input[name=category][value="Haul Road"]'); await p.selectOption('#issue','Potholes'); await p.fill('#description','half typed description'); await p.fill('#minutes','45'); await p.click('input[name=priority][value="Medium"]'); };
(async()=>{
 let p=await open('sic1@example.com','2026-10-01T10:00:00'); let v=await vals(p);
 check('empty form: no draft note, no Clear button',!v.note&&!v.clear&&v.store===0,v);
 await fill(p); v=await vals(p); check('typing saves a draft (one sessionStorage entry) and shows the Clear form button',v.store===1&&v.clear,v);
 const stored=await p.evaluate(()=>JSON.stringify(Object.entries(sessionStorage).filter(([k])=>k.startsWith('mineshift.draft'))));
 check('the draft holds only ordinary form values (no token, no shift)',!/token|session|access|shift/i.test(stored.replace('mineshift.draft.v1.','')),stored);
 await p.reload(); await T(p,2500); v=await vals(p);
 check('after an accidental refresh every field is restored',v.loc==='Haul Road B'&&v.cat==='Haul Road'&&v.issue==='Potholes'&&v.desc==='half typed description'&&v.min==='45'&&v.pri==='Medium',v);
 check('the page says the entry was restored',/unsent entry was restored/.test(v.note),v.note);
 check('390px: no sideways scroll',v.sw<=v.iw,[v.sw,v.iw]);
 // weak network: the save fails, the form keeps its values, a refresh still restores them
 global.FAIL_CREATE=true; await p.click('#save'); await T(p,1200);
 const msg=await p.textContent('#msg'); v=await vals(p);
 check('failed save shows the error text and keeps everything typed',/Sorry, the exception could not be saved\. Error: TypeError: Failed to fetch/.test(msg)&&v.desc==='half typed description'&&v.min==='45',msg);
 await p.reload(); await T(p,2500); v=await vals(p); check('draft still there after reload following the failed save',v.desc==='half typed description'&&v.loc==='Haul Road B',v);
 // the network is back: save works and the draft is cleared
 global.FAIL_CREATE=false; await p.click('#save'); await T(p,1500); v=await vals(p);
 check('successful save clears the draft and the form',/recorded successfully/.test(await p.textContent('#msg'))&&v.store===0&&!v.desc&&!v.loc&&!v.clear,v);
 await p.reload(); await T(p,2500); v=await vals(p); check('nothing is restored after a successful save',!v.desc&&!v.note,v);
 // explicit clear
 await fill(p); await p.click('#clear-draft'); await T(p,300); v=await vals(p); check('"Clear form" empties the form and removes the draft',!v.desc&&!v.loc&&v.store===0&&!v.clear,v);
 await p.reload(); await T(p,2500); v=await vals(p); check('after Clear form a refresh restores nothing',!v.desc,v);
 // a different person on the same browser tab does not get someone else's draft
 await fill(p); await p.evaluate(()=>{ localStorage.setItem('SESS','overman1@example.com'); }); await p.reload(); await T(p,2500); v=await vals(p);
 check('another signed-in person does not see the first person\'s draft',!v.desc&&!v.loc,v);
 // a draft is not a queue: nothing is sent while offline
 check('no background submission happened (create_exception calls only for the 1 failed + 1 successful save)',OPLOG.filter(o=>o.name==='create_exception').length===2,OPLOG.filter(o=>o.name==='create_exception').length);
 await p.close(); await done();
})();
