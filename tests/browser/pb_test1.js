const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const {newPage,check,done,psql}=require('../lib/harness.js');
const URL='http://localhost:8765/';
const OLD=['Coal Face A','Coal Face B','Junction A','Stockyard A','Siding A','Siding B'];
const NEW=['ABC Patch','XYZ Patch','Haul Road A','Haul Road B','MDP Junction','Stockyard 1','Siding 1','Siding 2'];
const T=async(p,ms=350)=>p.waitForTimeout(ms);
(async()=>{
 console.log('=== 1. sign-in guard on both pages');
 for (const page of ['index.html','dashboard.html']) {
   const p=await newPage(null); await p.goto(URL+page); await T(p);
   check(page+': signed out -> redirected to login.html', p.url().endsWith('login.html'), p.url());
 }
 for (const [who,label] of [['ghost','no profile'],['off','inactive profile']]) {
   const p=await newPage(who+'@example.com'); await p.goto(URL+'dashboard.html'); await T(p,600);
   check(label+': signed out and sent to login.html', p.url().endsWith('login.html'), p.url());
   check(label+': session cleared', (await p.evaluate(()=>localStorage.getItem('SESS')))===null);
 }

 console.log('=== 2. header, role-aware menu, sign out');
 const ROLES={overman1:['Test Overman One','Overman / Supervisor',['Add Shift Exception','Dashboard']],
  overman2:['Test Overman Two','Overman / Supervisor',['Add Shift Exception','Dashboard']],
  sic1:['Test Shift In-Charge One','Shift In-Charge',['Add Shift Exception','Dashboard','Analytics']],
  manager1:['Test Manager One','Manager',['Dashboard','Analytics']],
  manager2:['Test Manager Two (operate)','Manager',['Dashboard','Analytics']],
  po1:['Test Project Officer One','Project Officer',['Dashboard','Analytics']],
  gm1:['Test General Manager One','General Manager',['Dashboard','Analytics']]};
 for (const [u,[name,role,nav]] of Object.entries(ROLES)) {
   for (const page of ['dashboard.html','index.html']) {
     const p=await newPage(u+'@example.com',{width:390,height:800}); await p.goto(URL+page); await T(p);
     const got=await p.evaluate(()=>({who:document.getElementById('who').innerText.replace(/\n/g,' | '),nav:[...document.querySelectorAll('#nav a')].map(a=>a.textContent)}));
     check(`${u} ${page}: header shows name + role + Sign out`, got.who.includes(name)&&got.who.includes(role)&&got.who.includes('Sign out'), got.who);
     check(`${u} ${page}: menu = ${nav.join(' + ')}`, JSON.stringify(got.nav)===JSON.stringify(nav), JSON.stringify(got.nav));
     if(page==='dashboard.html'&&u==='overman1'){
       await p.click('.who-out'); await T(p,400);
       check('sign out returns to login.html', p.url().endsWith('login.html')&&(await p.evaluate(()=>localStorage.getItem('SESS')))===null, p.url());
     }
   }
 }

 console.log('=== 3. entry page');
 for (const u of ['manager1','manager2','po1','gm1']) {
   const p=await newPage(u+'@example.com'); await p.goto(URL+'index.html'); await T(p);
   const s=await p.evaluate(()=>({form:!document.getElementById('form').hidden,denied:!document.getElementById('denied').hidden,text:document.getElementById('denied').innerText,link:document.getElementById('denied-link').getAttribute('href')}));
   check(`${u}: manual index.html shows the role message, no form`, !s.form&&s.denied&&s.text.includes('Your role cannot create operational exceptions')&&s.link==='dashboard.html', JSON.stringify(s));
 }
 for (const u of ['overman1','sic1']) {
   const p=await newPage(u+'@example.com',{width:390,height:800}); await p.goto(URL+'index.html'); await T(p);
   const s=await p.evaluate(()=>({form:!document.getElementById('form').hidden,locs:[...document.querySelectorAll('#location option')].map(o=>o.textContent).slice(1),label:document.getElementById('urg-label').textContent,cats:[...document.querySelectorAll('input[name=category]')].map(x=>x.value),html:document.body.innerText}));
   check(`${u}: form visible`, s.form);
   check(`${u}: exactly the 8 final locations`, JSON.stringify(s.locs)===JSON.stringify(NEW), JSON.stringify(s.locs));
   check(`${u}: no old location name anywhere on the page`, !OLD.some(o=>s.html.includes(o)));
   check(`${u}: field is called Reported Priority`, s.label==='Reported Priority'&&!/Urgency/.test(s.html), s.label);
   check(`${u}: 4 categories`, JSON.stringify(s.cats)===JSON.stringify(['Coal Despatch','Dust Suppression','Haul Road','Coal Quality']));
   check(`${u}: no sideways scroll at 390px`, !(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
 }
 // create through the UI on each new location, check DB row
 const p=await newPage('overman1@example.com'); await p.goto(URL+'index.html'); await T(p);
 let n=0;
 for (const loc of NEW) {
   n++;
   
   await p.selectOption('#location',loc);
   const cat=['Coal Despatch','Dust Suppression','Haul Road','Coal Quality'][n%4];
   await p.click(`.choice:has(input[name=category][value="${cat}"])`);
   const issue=await p.$eval('#issue option:nth-child(2)',o=>o.textContent); await p.selectOption('#issue',issue);
   await p.fill('#description','UI test '+loc); await p.click('.chips button[data-min="30"]');
   await p.click('.choice.high'); await p.click('#save'); await T(p,450);
   const m=await p.textContent('#msg');
   check('create at "'+loc+'": success message', m==='Exception recorded successfully.', m);
 }
 const rows=psql(`select location||'|'||created_by_name||'|'||created_by_role||'|'||status||'|'||reported_priority||'|'||current_priority||'|'||impact_minutes from shift_exceptions where description like 'UI test %' order by created_at`).out.split('\n');
 check('8 records created through create_exception with creator, role, Open, priorities', rows.length===8&&rows.every(r=>/\|Test Overman One\|overman\|Open\|High\|High\|30$/.test(r)), rows[0]);
 check('DB locations saved are the final names', NEW.every(l=>rows.some(r=>r.startsWith(l+'|'))));
 const bad=await p.evaluate(()=>0);
 // a database refusal is shown with the exact text (account switched off mid-session)
 await p.selectOption('#location','ABC Patch');
 await p.click('.choice:has(input[name=category][value="Haul Road"])'); await p.selectOption('#issue','Potholes');
 await p.fill('#description','will be refused'); await p.fill('#minutes','10'); await p.click('.choice.low');
 psql(`update profiles set active=false where user_id=(select id from auth.users where email='overman1@example.com')`);
 await p.click('#save'); await T(p,450);
 const em=await p.textContent('#msg');
 psql(`update profiles set active=true where user_id=(select id from auth.users where email='overman1@example.com')`);
 check('database refusal shown exactly in a friendly message', /Sorry, the exception could not be saved\. Error: Your account has no active role\. Please contact the Data Keeper\./.test(em), em);
 check('  ...and nothing was saved', +psql(`select count(*) from shift_exceptions where description='will be refused'`).out===0);
 check('no page errors', p.errs.length===0, p.errs.join(';'));
 await done();
})();
