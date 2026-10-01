const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {psql,asUser,done,check}=require('../lib/harness.js');
const call=(u,sh)=>asUser(u+'@example.com',`select public.create_exception(${sh===null?'NULL':`'${sh}'`},'Siding 1','Coal Despatch','Coal shortage','ist test',20,'High')`);
const cur=psql(`select public.ist_shift(now())`).out;
const others=['First','Second','Night'].filter(x=>x!==cur);
const before=+psql(`select count(*) from shift_exceptions`).out;
console.log('database clock says current shift =',cur,'| operational day',psql(`select public.ist_operational_date(now())`).out);
let r=call('sic1',cur); check('sic1 saves with the current shift ('+cur+')',!/ERROR/.test(r.err),r.err);
check('the new record has the current shift and is Open',psql(`select shift||'/'||status from shift_exceptions where description='ist test' order by created_at desc limit 1`).out===cur+'/Open');
for(const o of others){ r=call('sic1',o); check(`tampered payload: shift ${o} (not ${cur}) is rejected by the database`,/ERROR/.test(r.err)&&/current shift is/.test(r.err),r.err); }
r=call('overman1',others[0]); check('overman1 cannot save another shift either',/ERROR/.test(r.err)&&/current shift/.test(r.err),r.err);
r=call('overman1',cur); check('overman1 saves with the current shift',!/ERROR/.test(r.err),r.err);
r=call('sic1','Midday'); check('invalid shift value is rejected',/valid shift/.test(r.err),r.err);
r=call('sic1',null); check('missing shift is rejected',/ERROR/.test(r.err),r.err);
r=call('gm1',cur); check('GM still cannot create (no bypass, role rule unchanged)',/Only an Overman/.test(r.err),r.err);
r=call('manager2',cur); check('Manager (can_operate) still cannot create',/Only an Overman/.test(r.err),r.err);
check('only the 2 valid records were added',+psql(`select count(*) from shift_exceptions`).out===before+2);
// direct table writes remain impossible (lockdown unchanged)
r=asUser('sic1@example.com',`insert into shift_exceptions(shift,location,category,issue_type,description,impact_minutes,urgency,status) values ('Night','Siding 1','Coal Despatch','Coal shortage','x',1,'High','Open')`); check('direct insert still blocked',/ERROR|permission|denied|policy/i.test(r.err),r.err);
// helpers are not callable from the browser role; shift_clock is
r=asUser('sic1@example.com',`select public.ist_shift(now())`); check('helper ist_shift is not callable by signed-in users',/permission denied/i.test(r.err),r.err);
r=asUser('sic1@example.com',`select public._check_live_shift('First', now())`); check('helper _check_live_shift is not callable by signed-in users',/permission denied/i.test(r.err),r.err);
r=asUser('sic1@example.com',`select public.shift_clock()`); check('shift_clock is callable by signed-in users and returns the DB clock',!/ERROR/.test(r.err)&&r.out.includes(cur),r.out);
r=psql(`set role anon; select public.shift_clock()`); check('signed-out (anon) cannot call shift_clock',/permission denied/i.test(r.err),r.err);
r=psql(`set role anon; select public.create_exception('First','Siding 1','Coal Despatch','Coal shortage','x',1,'High')`); check('signed-out (anon) cannot call create_exception',/permission denied/i.test(r.err),r.err);
// lifecycle on an OLD exception from an earlier operational day: all actions still work (no time rule on them)
psql(`delete from shift_exceptions where false`); // no-op, keeps harness quiet
const old=psql(`select id from shift_exceptions where status='Open' and created_at < now()-interval '3 days' and created_by is null limit 1`).out;
r=asUser('sic1@example.com',`select public.start_exception('${old}')`); check('Start works on an exception from days ago',!/ERROR/.test(r.err),r.err);
r=asUser('sic1@example.com',`select public.change_priority('${old}','High','carry forward review')`); check('Change priority works on an old exception (existing rules)',!/ERROR/.test(r.err),r.err);
r=asUser('sic1@example.com',`select public.add_remark('${old}','operational','old issue still open')`); check('Operational remark works on an old exception',!/ERROR/.test(r.err),r.err);
r=asUser('overman1@example.com',`select public.request_closure('${old}','work is finished here')`); check('Closure request works on an old exception',!/ERROR/.test(r.err),r.err);
r=asUser('sic1@example.com',`select public.resolve_exception('${old}','confirmed')`); check('Resolve (another officer) works on an old exception',!/ERROR/.test(r.err),r.err);
r=asUser('manager1@example.com',`select public.reopen_exception('${old}','found wrong in review')`); check('Reopen (Manager) works on an old exception',!/ERROR/.test(r.err),r.err);
r=asUser('manager1@example.com',`select public.add_remark('${old}','management','management view')`); check('Management remark works on an old exception',!/ERROR/.test(r.err),r.err);
await_done=done();
