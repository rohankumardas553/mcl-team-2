const REPO=require('path').resolve(__dirname,'..','..');
const PGHOST=process.env.MS_PGHOST||'/var/tmp/mspg', PGPORT=process.env.MS_PGPORT||'5544';
const A=require((REPO+'/analytics.js'));
let PASS=0,FAIL=0; const ok=(l,c,x)=>{ if(c)PASS++; else {FAIL++; console.log('FAIL  '+l+(x!==undefined?'  -> '+JSON.stringify(x):''));} };
const now=new Date(); let n=0;
const row=(cat,issue,loc,min,extra={})=>Object.assign({id:'r'+(++n),created_at:new Date(now.getFullYear(),now.getMonth(),now.getDate(),9).toISOString(),shift:'First',location:loc,category:cat,issue_type:issue,impact_minutes:min,status:'Open',current_priority:'Low',started_at:null,resolved_at:null},extra);
const att=(rows)=>A.compute(rows,{},{},{from:null,to:null},now).attention;
const NONE='Not enough historical data for a meaningful comparison.';
const BANNED=/\b(should|recommend|predict|forecast|will|expected|likely|probably|suggest|need to|must|improv|worsen|trend(ing)? (up|down))\b/i;
ok('no rows -> not enough data', JSON.stringify(att([]))===JSON.stringify([NONE]));
ok('one exception -> not enough data (nothing to compare)', JSON.stringify(att([row('Haul Road','Potholes','ABC Patch',40)]))===JSON.stringify([NONE]), att([row('Haul Road','Potholes','ABC Patch',40)]));
ok('one group repeated -> not enough data', JSON.stringify(att([row('Haul Road','Potholes','ABC Patch',40),row('Haul Road','Potholes','ABC Patch',60)]))===JSON.stringify([NONE]));
// the spec's example wording
const rows=[];
for(let i=0;i<6;i++) rows.push(row('Haul Road','Potholes','MDP Junction',70)); // 420 min, 6 exceptions
for(let i=0;i<3;i++) rows.push(row('Coal Despatch','Weather','Siding 1',50)); // 150
for(let i=0;i<2;i++) rows.push(row('Dust Suppression','Heavy dust','Siding 2',30)); // 60
const a=att(rows);
ok('statement 1 wording (highest category+location)', a[0]==='Haul Road at MDP Junction has the highest total impact in this period: 420 minutes across 6 exceptions.', a[0]);
ok('statement 2 wording (category share)', a[1]==='Haul Road accounts for '+(420/630*100).toFixed(1)+'% of total impact minutes in the selected period.', a[1]);
ok('statement 3 wording (most recurring issue)', a[2]==='Potholes (Haul Road) is the most recurring issue type with 6 exceptions.', a[2]);
ok('at most 3 statements', a.length===3);
ok('no advice / prediction wording', a.every(t=>!BANNED.test(t)), a);
// ties
const tie=[row('Haul Road','Potholes','ABC Patch',100),row('Coal Despatch','Weather','Siding 1',100),row('Dust Suppression','Heavy dust','Siding 2',50)];
const at=att(tie);
ok('tie on highest impact is stated as a tie, not as one winner', /share the highest total impact in this period \(100 minutes each\)/.test(at[0])&&!/has the highest/.test(at[0]), at);
ok('tie on category share stated as "each account for"', at.some(t=>/each account for 40\.0% of total impact minutes/.test(t)), at);
ok('tie on issue count says "are the most recurring issue types ... each"', at.some(t=>/are the most recurring issue types with 1 exception each/.test(t)), at);
// a single category selected -> no category-share statement (nothing to compare)
const oneCat=[row('Haul Road','Potholes','ABC Patch',50),row('Haul Road','Slippery road','XYZ Patch',20),row('Haul Road','Potholes','ABC Patch',10)];
const ac=att(oneCat);
ok('single category: no category share statement', !ac.some(t=>/accounts for/.test(t)), ac);
ok('single category: still states highest combo + recurring issue', /^Haul Road at ABC Patch has the highest total impact/.test(ac[0])&&ac.some(t=>/Potholes \(Haul Road\) is the most recurring issue type with 2 exceptions\./.test(t)), ac);
// same issue name in two categories is kept apart ("Other")
const other=[row('Haul Road','Other','ABC Patch',10),row('Coal Despatch','Other','ABC Patch',10),row('Coal Despatch','Other','Siding 1',10)];
const ao=att(other);
ok('issue types are grouped inside their category', ao.some(t=>/^Other \(Coal Despatch\) is the most recurring issue type with 2 exceptions\./.test(t)), ao);
// zero impact everywhere: no "highest impact" claims
const zero=[row('Haul Road','Potholes','ABC Patch',0),row('Coal Despatch','Weather','Siding 1',0)];
ok('zero impact everywhere: no impact claims', !att(zero).some(t=>/total impact|accounts for/.test(t)), att(zero));
// determinism
ok('same input -> identical output', JSON.stringify(att(rows))===JSON.stringify(att(rows.slice())));
// 1 / plural grammar
const g=att([row('Haul Road','Potholes','ABC Patch',5),row('Coal Despatch','Weather','Siding 1',1)]);
ok('singular "exception"', /across 1 exception\./.test(g[0]), g);
console.log(`PASS=${PASS} FAIL=${FAIL}`);
