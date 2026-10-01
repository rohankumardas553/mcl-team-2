const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {newPage,check,done,psql,asUser}=require('../lib/harness.js');
const URL='http://localhost:8765/';
const T=async(p,ms=450)=>p.waitForTimeout(ms);
const card=(p,d)=>p.locator('#list > .item',{has:p.locator('.desc',{hasText:d})});
const btn=(c,name)=>c.locator('.actions .act',{hasText:new RegExp('^'+name+'$')});
const open=async(u)=>{const p=await newPage(u+'@example.com',{width:1280,height:1000}); await p.goto(URL+'dashboard.html'); await T(p,700); return p;};
const db=sql=>psql(sql).out;
const mkResolved=(d)=>{ asUser('overman1@example.com',`select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','${d}',30,'Medium')`);
  const id=db(`select id from shift_exceptions where description='${d}'`);
  asUser('overman2@example.com',`select start_exception('${id}')`); asUser('overman1@example.com',`select request_closure('${id}','Verified by overman one')`);
  asUser('sic2@example.com',`select resolve_exception('${id}')`); return id; };
(async()=>{
 console.log('=== 14. management reopen in the pages');
 mkResolved('RU resolved one');
 // Reopen button visibility on a Resolved card
 for (const [u,want] of [['sic1',true],['sic2',true],['manager1',true],['manager2',true],['po1',true],['gm1',true]]) {
   const p=await open(u); const c=card(p,'RU resolved one');
   check(`${u}: Resolved card shows Reopen`, (await btn(c,'Reopen').count())===(want?1:0));
   check(`${u}: Resolved card has no Start/Resolve/Decline`, (await c.locator('.act',{hasText:/^(Start|Resolve|Confirm Resolved|Decline closure|Request closure)$/}).count())===0);
   await p.close();
 }
 // overman: My history card is read-only
 let o=await open('overman1'); await o.click('#tab-history'); await T(o,200);
 check('overman1: My history card has NO Reopen (nor any action)', (await card(o,'RU resolved one').count())===1&&(await card(o,'RU resolved one').locator('.act').count())===0);
 await o.close();
 // In progress card: management roles still have no operational buttons
 asUser('overman1@example.com',`select create_exception((select shift_clock()->>'shift'),'Siding 2','Coal Despatch','Weather','RU in progress',30,'High')`);
 asUser('overman2@example.com',`select start_exception((select id from shift_exceptions where description='RU in progress'))`);
 for (const u of ['manager1','po1','gm1']) {
   const p=await open(u); const c=card(p,'RU in progress');
   check(`${u}: In progress card has NO Start / Resolve / Decline / Reopen`, (await c.locator('.act',{hasText:/^(Start|Resolve|Confirm Resolved|Decline closure|Reopen)$/}).count())===0);
   check(`${u}: still has Change priority`, (await btn(c,'Change priority').count())===1);
   await p.close();
 }
 // a Manager WITHOUT can_operate reopens through the page
 let m1=await open('manager1'); let c=card(m1,'RU resolved one');
 await btn(c,'Reopen').click(); await c.locator('.formbox textarea').fill('no'); await c.locator('.formbox .go').click(); await T(m1,150);
 check('manager1: short reason refused in the form', /at least 5/.test(await c.locator('.formbox').innerText()));
 await c.locator('.formbox textarea').fill('Inspection found the joint still leaking'); await c.locator('.formbox .go').click(); await T(m1);
 check('manager1 (no can_operate) reopened it; DB: Open, cycle fields cleared', db(`select status||'|'||coalesce(resolved_by_name,'')||coalesce(started_by_name,'')||coalesce(closure_requested_by_name,'') from shift_exceptions where description='RU resolved one'`)==='Open|');
 check('audit line shows manager1, role Manager, Resolved -> Open, the reason', db(`select actor_name||'|'||actor_role||'|'||old_value||'|'||new_value||'|'||note from exception_audit a join shift_exceptions e on e.id=a.exception_id where e.description='RU resolved one' and a.action='reopened'`)==='Test Manager One|manager|Resolved|Open|Inspection found the joint still leaking');
 c=card(m1,'RU resolved one');
 check('after reopening manager1 sees no Start (not allowed to start)', (await btn(c,'Start').count())===0);
 const s1=await open('sic1'); c=card(s1,'RU resolved one');
 check('sic1 sees Start on the reopened record (fresh cycle)', (await btn(c,'Start').count())===1);
 await c.locator('summary',{hasText:'History'}).click(); await T(s1,500);
 const hist=(await c.locator('.hist-row').allInnerTexts()).map(h=>h.split('\n')[1]||'');
 check('History still lists the earlier Start, closure request and Resolve, then Reopened', ['Created','Started','Closure requested','Resolved','Reopened'].every((a,i)=>(hist[i]||'').startsWith(a)), JSON.stringify(hist));
 // PO and GM reopen through the page
 for (const [u,d] of [['po1','RU po'],['gm1','RU gm']]) {
   mkResolved(d); const p=await open(u); const cc=card(p,d);
   await btn(cc,'Reopen').click(); await cc.locator('.formbox textarea').fill('Management review found a gap'); await cc.locator('.formbox .go').click(); await T(p);
   check(`${u} reopened through the page`, db(`select status from shift_exceptions where description='${d}'`)==='Open');
   await p.close();
 }
 // stale page: overman cannot reopen even by calling the database
 check('no page errors', m1.errs.length===0&&s1.errs.length===0);
 await done();
})();
