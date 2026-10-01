const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
// SAFETY: scratch database over a LOCAL unix socket only. NEVER run these tests against live production Supabase data.
if (PGHOST[0] !== '/' || process.env.PGHOST || process.env.DATABASE_URL || process.env.SUPABASE_URL || process.env.SUPABASE_DB_URL) {
  throw new Error('REFUSING TO RUN: tests only use a local scratch Postgres over a unix socket (see tests/README.md).');
}
// Playwright: use PLAYWRIGHT_MODULE if set, else a normal install ("npm i playwright" somewhere on the module path), else the CI image path.
const { chromium } = (()=>{ for (const m of [process.env.PLAYWRIGHT_MODULE,'playwright','/opt/node22/lib/node_modules/playwright']) { if(!m) continue; try { return require(m); } catch(e) {} } throw new Error('Playwright is not installed. See tests/README.md (set PLAYWRIGHT_MODULE to its path).'); })();
const http=require('http'),fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=process.env.SITE_ROOT||(REPO+''), SOCK=PGHOST;
function psql(sql, opts){ // returns {out, err}
  const r=cp.spawnSync('psql',['-h',SOCK,'-p',PGPORT,'-U','postgres','-q','-At','-d','ms','-c',sql],{encoding:'utf8'});
  return {out:(r.stdout||'').trim(), err:(r.stderr||'').trim()};
}
const OPLOG=[]; const UIDS={};
for (const e of ['overman1','overman2','sic1','sic2','manager1','manager2','po1','gm1','ghost','off']) UIDS[e]=psql(`select id from auth.users where email='${e}@example.com'`).out;
function lit(v){ if(v===null||v===undefined) return 'NULL'; if(typeof v==='number') return String(v); return '$q$'+String(v)+'$q$'; }
function asUser(email, sql){
  const uid=UIDS[email.split('@')[0]];
  return psql(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false); ${sql}`);
}
function cleanErr(err){ const m=err.match(/ERROR:\s+([^\n]*)/); return m?m[1].trim():err; }
async function dbCall(op){
  const email=op.user; if(!email) return {data:null,error:{message:'JWT: not signed in'}};
  if(op.kind==='select'){
    const st=op.st; if(!['shift_exceptions','exception_remarks','exception_audit','profiles','exception_photos'].includes(st.table)) return {data:null,error:{message:'bad table'}};
    if(!/^[a-z_,]+$/.test(st.cols)) return {data:null,error:{message:'bad cols'}};
    OPLOG.push({user:op.user,kind:'select',table:st.table,filters:st.filters.map(f=>f[0]+':'+f[1]),range:st.range||null});
    if(global.DELAY_MS) await new Promise(r=>setTimeout(r,global.DELAY_MS));
    if(global.FAIL_TABLE===st.table) return {data:null,error:{message:'simulated failure reading '+st.table}};
    let sql=`select coalesce(jsonb_agg(t),'[]'::jsonb)::text from (select ${st.cols} from public.${st.table}`;
    if(st.filters.length) sql+=' where '+st.filters.map(f=>{const [o,c,v]=f; if(o==='eq') return `${c}=${lit(v)}`; if(o==='gte') return `${c}>=${lit(v)}`; if(o==='lt') return `${c}<${lit(v)}`; if(o==='in') return `${c} in (${v.map(lit).join(',')})`; throw new Error('op '+o);}).join(' and ');
    if(st.orders.length) sql+=' order by '+st.orders.map(o=>`${o[0]} ${o[1]}`).join(', ');
    const CAP=1000; /* like Supabase max_rows: one request never returns more than 1000 rows, whatever .limit() says */
    if(st.range) sql+=` limit ${Math.min(CAP,st.range[1]-st.range[0]+1)} offset ${st.range[0]}`; else if(st.limit) sql+=` limit ${Math.min(CAP,parseInt(st.limit))}`; else sql+=` limit ${CAP}`;
    sql+=') t';
    const r=asUser(email,sql);
    if(r.err && /ERROR/.test(r.err)) return {data:null,error:{message:cleanErr(r.err)}};
    const lines=r.out.split('\n'); return {data:JSON.parse(lines[lines.length-1]),error:null};
  }
  if(op.kind==='upload'){ // stand-in for Supabase Storage upload (the real storage rules are the scratch database policies)
    const uid=UIDS[email.split('@')[0]];
    if(global.FAIL_UPLOAD) return {data:null,error:{message:'simulated upload failure'}};
    const r=asUser(email,`insert into storage.objects(bucket_id,name,owner_id,metadata) values (${lit(op.bucket)},${lit(op.path)},'${uid}',jsonb_build_object('mimetype',${lit(op.type)},'size',${op.size}))`);
    if(r.err && /ERROR/.test(r.err)) return {data:null,error:{message:cleanErr(r.err)}};
    OPLOG.push({user:op.user,kind:'upload',path:op.path,type:op.type,size:op.size});
    return {data:{path:op.path},error:null};
  }
  if(op.kind==='sign'){
    const r=asUser(email,`select count(*) from storage.objects where bucket_id=${lit(op.bucket)} and name=${lit(op.path)}`);
    const n=parseInt(r.out.split('\n').pop()||'0',10);
    if(!n) return {data:null,error:{message:'Object not found'}};
    OPLOG.push({user:op.user,kind:'sign',path:op.path});
    return {data:{signedUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='},error:null};
  }
  if(op.kind==='rpc'){
    OPLOG.push({user:op.user,kind:'rpc',name:op.name,args:op.args});
    if(global.FAIL_RPC && global.FAIL_RPC===op.name) return {data:null,error:{message:'TypeError: Failed to fetch (simulated weak network)'}};
    if(global.FAIL_CREATE && op.name==='create_exception') return {data:null,error:{message:'TypeError: Failed to fetch (simulated weak network)'}};
    if(global.FAKE){ // time-travel tests: the "server clock" is the fake time; create_exception is checked with the same fake time
      const fakeNow=new Date(global.FAKE.t+(Date.now()-global.FAKE.real)).toISOString();
      if(op.name==='shift_clock'&&global.FAIL_CLOCK) return {data:null,error:{message:'simulated clock failure'}};
      if(op.name==='shift_clock') return {data:JSON.parse(psql(`select jsonb_build_object('now','${fakeNow}'::timestamptz,'shift',public.ist_shift('${fakeNow}'),'operational_date',public.ist_operational_date('${fakeNow}'))::text`).out),error:null};
      if(op.name==='create_exception'){
        const r0=psql(`select public._check_live_shift(${lit(op.args.p_shift)}, '${fakeNow}'::timestamptz)`);
        if(r0.err&&/ERROR/.test(r0.err)) return {data:null,error:{message:cleanErr(r0.err)}};
        const real=psql(`select public.ist_shift(now())`).out; op={...op,args:{...op.args,p_shift:real}};   // the real DB clock is not the fake one
      }
    }
    const args=Object.entries(op.args).map(([k,v])=>`${k} => ${lit(v)}`).join(', ');
    const r=asUser(email,`select public.${op.name}(${args})`);
    if(r.err && /ERROR/.test(r.err)) return {data:null,error:{message:cleanErr(r.err)}};
    const lines=r.out.split('\n').filter(x=>x); const last=lines[lines.length-1]||'';
    let data=null; if(last.startsWith('{')) { try{data=JSON.parse(last)}catch(e){} }
    else if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(last)) data=last;
    else if(op.name==='my_admin') data=(last==='t');
    else if(op.name==='admin_log_recovery') data=last;
    else if(op.name==='admin_list_accounts'){ const r2=asUser(email,`select coalesce(jsonb_agg(t),'[]'::jsonb)::text from public.admin_list_accounts() t`); data=JSON.parse(r2.out.split('\n').filter(x=>x).pop()); }
    return {data,error:null};
  }
}
const FAKE_SB=`
window.supabase={createClient:function(){
 function q(table){var st={table:table,cols:'*',filters:[],orders:[],limit:null};
  var b={select:function(c){st.cols=c;return b},eq:function(k,v){st.filters.push(['eq',k,v]);return b},gte:function(k,v){st.filters.push(['gte',k,v]);return b},lt:function(k,v){st.filters.push(['lt',k,v]);return b},in:function(k,v){st.filters.push(['in',k,v]);return b},range:function(a,z){st.range=[a,z];return b},
   order:function(c,o){st.orders.push([c,(o&&o.ascending===false)?'desc':'asc']);return b},limit:function(n){st.limit=n;return b},
   then:function(res,rej){return window.__db({kind:'select',st:st,user:localStorage.getItem('SESS')}).then(res,rej)}};return b;}
 return {from:q,
  rpc:function(name,args){return window.__db({kind:'rpc',name:name,args:args||{},user:localStorage.getItem('SESS')})},
  auth:{
   getSession:function(){var c=localStorage.getItem('SESS');return Promise.resolve({data:{session:c?{user:{email:c,id:window.__uids[c.split('@')[0]]}}:null},error:null})},
   signInWithPassword:function(o){var l=o.email.split('@')[0];if(!window.__uids[l]||o.password!=='pw-'+l)return Promise.resolve({data:{},error:{message:'Invalid login credentials'}});localStorage.setItem('SESS',o.email);return Promise.resolve({data:{session:{user:{email:o.email,id:window.__uids[l]}}},error:null})},
   signOut:function(){localStorage.removeItem('SESS');return Promise.resolve({error:null})},
   resetPasswordForEmail:function(e,o){(window.__resets=window.__resets||[]).push({email:e,redirectTo:o&&o.redirectTo});return Promise.resolve({data:{},error:window.__resetErr?{message:window.__resetErr}:null})},
   updateUser:function(o){(window.__updates=window.__updates||[]).push({hasPassword:!!(o&&o.password)});return Promise.resolve({data:{},error:window.__updateErr?{message:window.__updateErr}:null})},
   onAuthStateChange:function(cb){(window.__authCbs=window.__authCbs||[]).push(cb);}},
  storage:{from:function(b){return {
    upload:function(path,blob,opts){return window.__db({kind:'upload',bucket:b,path:path,type:(opts&&opts.contentType)||blob.type,size:blob.size,user:localStorage.getItem('SESS')})},
    createSignedUrl:function(path){return window.__db({kind:'sign',bucket:b,path:path,user:localStorage.getItem('SESS')})}};}}};}};`;
const FAKE_CH=`window.Chart=function(c,cfg){window.__chart=cfg;(window.__charts=window.__charts||{})[c.id]=cfg;this.data=cfg.data;this.update=function(){};this.destroy=function(){};};`;
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
 fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();}else{r.writeHead(200,{'content-type':f.endsWith('.html')?'text/html':'text/javascript'});r.end(d);}});}).listen(8765);
let browser;
async function newPage(email, viewport, tz){
  if(!browser) browser=await chromium.launch(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}).catch(()=>chromium.launch({executablePath:'/opt/pw-browsers/chromium'}));
  const ctx=await browser.newContext({viewport:viewport||{width:1280,height:900},timezoneId:tz||'Asia/Kolkata'});
  await ctx.addInitScript(`window.__uids=${JSON.stringify(Object.fromEntries(Object.entries(UIDS).map(([k,v])=>[k+'',v])))};`);
  if(email) await ctx.addInitScript(`try{ if(!sessionStorage.__init){ localStorage.setItem('SESS','${email}'); sessionStorage.__init='1'; } }catch(e){}`);
  const p=await ctx.newPage();
  p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
  if(process.env.FORCE_NIGHT && !global.FAKE){ // old suites build rows with every shift label: look at the dashboard during the Night shift of the current operational day, so none of today's shifts is "in the future"
    const C=require((REPO+'/shiftclock.js')); const real=Date.now(); const i=C.info(real);
    if(i.shift!=='Night'){ const od=i.opDay.split('-').map(Number); const ms=Date.UTC(od[0],od[1]-1,od[2],23,0,0)-19800000+0; global.FAKE={t:Math.max(ms,real),real:real}; }
    if(global.FAKE) await p.clock.install({time:new Date(global.FAKE.t)});
  }
  await p.exposeFunction('__db',dbCall);
  await p.route('**/@supabase/supabase-js@2',r=>r.fulfill({contentType:'text/javascript',body:FAKE_SB}));
  await p.route('**/chart.js@4',r=>r.fulfill({contentType:'text/javascript',body:process.env.REAL_CHART?fs.readFileSync(process.env.REAL_CHART,'utf8'):FAKE_CH}));
  return p;
}
// time travel helper: the (mock) database clock moves together with the page clock
global.jump=async function(p,ms){ const cur=global.FAKE.t+(Date.now()-global.FAKE.real); global.FAKE={t:cur+ms,real:Date.now()}; await p.clock.fastForward(ms); };
let PASS=0,FAIL=0;
function check(label,cond,extra){ if(cond){PASS++;console.log('pass  '+label);}else{FAIL++;console.log('FAIL  '+label+(extra!==undefined?'  -> '+extra:''));} }
async function done(){ if(browser) await browser.close(); srv.close(); console.log(`PASS=${PASS} FAIL=${FAIL}`); }
module.exports={OPLOG,newPage,check,done,psql,asUser,UIDS,PORT:8765,get counts(){return {PASS,FAIL}}};
