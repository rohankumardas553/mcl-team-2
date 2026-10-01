// MCL logo in the header of every user-facing page: loads (no 404), correct proportions, no overlap, no sideways scroll, no JS errors.
process.env.TZ='Asia/Kolkata';
const {newPage,check,done}=require('../lib/harness.js');
const fs=require('fs'),path=require('path');
const REPO=path.resolve(__dirname,'..','..');
const T=(p,ms)=>p.waitForTimeout(ms);
(async()=>{
 check('logo asset is committed at assets/mcl-logo.jpg (a JPEG)',fs.existsSync(REPO+'/assets/mcl-logo.jpg')&&fs.readFileSync(REPO+'/assets/mcl-logo.jpg').slice(0,2).toString('hex')==='ffd8');
 const pages=[['login.html',null,'login'],['index.html','sic1@example.com','entry'],['dashboard.html','sic1@example.com','dashboard'],['analytics.html','gm1@example.com','analytics']];
 const widths=[[1280,900,'desktop'],[768,900,'tablet'],[390,800,'390px'],[320,700,'320px']];
 for(const [pg,user,label] of pages) for(const [w,h,wl] of widths){
   const p=await newPage(user,{width:w,height:h}); const reqs=[]; p.on('response',r=>{ if(/mcl-logo/.test(r.url())) reqs.push(r.status()+' '+(r.headers()['content-type']||'')); });
   await p.goto('http://localhost:8765/'+pg); await T(p,2500);
   const m=await p.evaluate(()=>{
     const img=document.querySelector('header .mcl-logo'); const r=x=>x.getBoundingClientRect(); const brand=document.querySelector('header .brand');
     const ir=img?r(img):null; const textEl=brand; 
     // the brand text: range over the text node after the image
     let tr=null; if(brand){ const tn=[...brand.childNodes].find(n=>n.nodeType===3&&n.textContent.trim()); if(tn){ const rg=document.createRange(); rg.selectNodeContents(tn); tr=rg.getBoundingClientRect(); } }
     const nav=[...document.querySelectorAll('header nav a')].map(a=>r(a)); const out=document.querySelector('header .who-out'); const orr=out?r(out):null;
     const hit=(a,b)=>a&&b&&a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
     const els=[ir,tr,...nav,orr].filter(Boolean);
     let overlap=false; for(let i=0;i<els.length;i++) for(let j=i+1;j<els.length;j++) if(hit(els[i],els[j])) overlap=true;
     return {has:!!img,loaded:!!img&&img.complete&&img.naturalWidth>0,nat:img?[img.naturalWidth,img.naturalHeight]:null,box:ir?[Math.round(ir.width*10)/10,Math.round(ir.height*10)/10]:null,left:ir?ir.left:null,right:ir?ir.right:null,alt:img?img.alt:null,
       text:brand?brand.textContent.trim():'',textVisible:!!tr&&tr.width>0&&tr.right<=innerWidth+0.5,navCount:nav.length,navInside:nav.every(x=>x.right<=innerWidth+0.5&&x.left>=-0.5),signoutInside:!orr||(orr.right<=innerWidth+0.5&&orr.left>=-0.5),overlap,sw:document.documentElement.scrollWidth,iw:innerWidth,
       hdrH:Math.round(r(document.querySelector('header')).height),objectFit:img?getComputedStyle(img).objectFit:null,imgFilter:img?getComputedStyle(img).filter+'|'+getComputedStyle(img).opacity:null};
   });
   const tag=`${label} @ ${wl}`;
   check(`${tag}: logo present, loaded, original image (no broken image)`,m.has&&m.loaded&&m.nat[0]===685&&m.nat[1]===291,JSON.stringify(m));
   check(`${tag}: logo request returned 200 as image/jpeg (no 404)`,reqs.length>=1&&reqs.every(x=>/^200 image\/jpeg/.test(x)),reqs);
   check(`${tag}: proportions kept (${m.box}), not stretched or squeezed`,m.box&&Math.abs(m.box[0]/m.box[1]-685/291)<0.03,JSON.stringify(m.box));
   check(`${tag}: alt text and the visible title "MineShift Command"`,m.alt==='Mahanadi Coalfields Limited (MCL)'&&/MineShift Command/.test(m.text)&&m.textVisible,JSON.stringify({a:m.alt,t:m.text,v:m.textVisible}));
   check(`${tag}: no filter / opacity / object-fit effects on the logo`,m.imgFilter==='none|1'&&(m.objectFit==='fill'||m.objectFit==='contain'),m.imgFilter+' '+m.objectFit);
   check(`${tag}: no overlap between logo, title, navigation and Sign out; all inside the screen`,!m.overlap&&m.navInside&&m.signoutInside&&m.left>=0&&m.right<=m.iw,JSON.stringify(m));
   check(`${tag}: no horizontal scroll (${m.sw} <= ${m.iw})`,m.sw<=m.iw,[m.sw,m.iw]);
   if(label!=='login') check(`${tag}: navigation links intact (${m.navCount})`,m.navCount>=(label==='analytics'?2:1));
   check(`${tag}: no JavaScript errors`,p.errs.length===0,p.errs.join(';'));
   if(wl==='390px'||wl==='320px'||wl==='desktop') await p.screenshot({path:require('os').tmpdir()+`/brand_${label}_${w}.png`,clip:{x:0,y:0,width:w,height:200}});
   await p.close();
 }
 await done();
})();
