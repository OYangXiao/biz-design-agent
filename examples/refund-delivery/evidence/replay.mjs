import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync as read, writeFileSync as write, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url), png=require('pngjs');
const root=fileURLToPath(new URL('../',import.meta.url)), round=process.argv[2];
if(!['v1','v2','probe'].includes(round))throw Error('Usage: node replay.mjs v1|v2|probe');
const out=path.join(root,'evidence',`replay-${round}-${Date.now()}`), size='1280x800';
const chrome=process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const bin=process.env.MCP_BIN||'chrome-devtools-mcp';
const child=spawn(bin,['--headless','--isolated','--no-page-id-routing','--no-performance-crux','--no-usage-statistics',`--executablePath=${chrome}`,`--workspace=${root}/evidence`,`--viewport=${size}`],{stdio:['pipe','pipe','inherit']});
const calls=new Map(); let id=0;
createInterface({input:child.stdout}).on('line',l=>{let m=JSON.parse(l);if(calls.has(m.id)){const [ok,no]=calls.get(m.id);calls.delete(m.id);m.error?no(Error(JSON.stringify(m.error))):ok(m.result)}});
function send(m){child.stdin.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n')}
function req(method,params){return new Promise((ok,no)=>{calls.set(++id,[ok,no]);send({id,method,params})})}
async function tool(name,args={}){const r=await req('tools/call',{name,arguments:args});let t=r.content.map(c=>c.text||'').join('\n');if(r.isError)throw Error(name+': '+t);return t}
const hash=f=>createHash('sha256').update(read(path.join(root,f))).digest('hex');
const save=(n,s)=>write(path.join(out,n),typeof s==='string'?s:JSON.stringify(s,null,2)+'\n');
const info=await req('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'refund-independent-qa',version:'1'}});
send({method:'notifications/initialized'});
try{
if(round==='probe'){console.log(info.serverInfo,await tool('list_pages'));}else{
mkdirSync(out,{recursive:true});
const build=`build-${round}.html`, src=Object.fromEntries(['brief.html','design.html',build].map(f=>[f,hash(f)]));
const manifest={started:new Date().toISOString(),server:info.serverInfo,chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),sources:src,pages:{}};
async function open(file,query=''){await tool('navigate_page',{type:'url',url:pathToFileURL(path.join(root,file)).href+query});await tool('evaluate_script',{function:'async () => {await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return document.readyState}'});}
async function snap(key){
const text=await tool('take_snapshot');save(key+'.txt',text);
const t=await tool('evaluate_script',{function:`() => ({url:location.href,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,language:navigator.language,theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',scroll:[scrollX,scrollY],text:document.body.innerText,buttons:Array.from(document.querySelectorAll('button,[role=button]')).map(b=>({text:b.innerText,disabled:b.matches(':disabled,[aria-disabled=true]'),visible:!!b.getClientRects().length})),regions:Array.from(document.querySelectorAll('.badge,.action,button')).map(b=>({text:b.innerText,box:b.getBoundingClientRect().toJSON(),background:getComputedStyle(b).backgroundColor}))})`});save(key+'.json',t.match(/```json\s*([\s\S]*?)\s*```/)?.[1]||JSON.stringify({raw:t}));return text}
async function shot(name){await tool('take_screenshot',{format:'png',filePath:path.join(out,name+'.png')})}
function diff(a,b,name){const load=n=>png.PNG.sync.read(read(path.join(out,n+'.png')));const p=load(a),q=load(b);if(p.width!==q.width||p.height!==q.height)throw Error('尺寸不同');const d=new png.PNG({width:p.width,height:p.height});let count=0,x0=p.width,x1=-1,y0=p.height,y1=-1;for(let i=0;i<p.data.length;i+=4){const changed=!p.data.subarray(i,i+4).equals(q.data.subarray(i,i+4));if(changed){++count;const x=(i/4)%p.width,y=Math.floor(i/4/p.width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}const g=Math.round(210+(p.data[i]+p.data[i+1]+p.data[i+2])/765*45);d.data.set(changed?[220,0,80,255]:[g,g,g,255],i)}if(name)write(path.join(out,name+'.png'),png.PNG.sync.write(d));return {count,total:p.width*p.height,box:count?[x0,y0,x1,y1]:null}}
for(const [k,f] of [['design','design.html'],['default',build]]){await open(f);await snap(k);await shot(k);await shot(k+'-repeat');manifest.pages[k]={stability:diff(k,k+'-repeat')}}
manifest.visual=diff('design','default','diff');
for(const role of ['service','manager'])for(const state of ['done','pending']){
 const k=role+'-'+state;await open(build,`?role=${role}&state=${state}`);const t=await snap(k);
 if(k==='manager-pending'){const m=t.split('\n').find(l=>l.includes('button')&&/批准|同意|通过|确认退款/.test(l)&&!l.includes('disabled'));if(m){const uid=m.match(/uid=([\w-]+)/)[1];await tool('click',{uid});await snap('after-click');await shot('after-click');manifest.pages[k]={clicked:m.trim()};for(const who of ['manager','service']){await open(build,`?role=${who}`);await snap('reopen-'+who)}}}
}
const checks={};
for(const [k,role,state,approve] of [
 ['manager-pending','主管','待审',true],['manager-done','主管','已处理',false],
 ['service-pending','客服','待审',false],['service-done','客服','已处理',false],
 ['after-click','主管','已处理',false],['reopen-manager','主管','已处理',false],['reopen-service','客服','已处理',false]
]){
 if(!manifest.pages['manager-pending']&&/^(after|reopen)/.test(k)){checks[k]='未测';continue}
 const p=JSON.parse(read(path.join(out,k+'.json'))), buttons=p.buttons.filter(b=>b.visible&&b.text==='批准退款');
 checks[k]=['当前身份 · '+role,'R-17','青禾路店','¥28.00','配送少了一盒餐'].every(v=>p.text.includes(v))
   && p.text.split('\n').includes(state)&&(approve?buttons.length===1&&!buttons[0].disabled:buttons.length===0);
}
manifest.checks=checks;manifest.finished=new Date().toISOString();manifest.sourcesUnchanged=Object.entries(src).every(([f,h])=>hash(f)===h);save('run.json',manifest);console.log(out,JSON.stringify(manifest,null,2));
if(!manifest.sourcesUnchanged||Object.values(checks).some(v=>v!==true)||manifest.visual.count||['design','default'].some(k=>manifest.pages[k].stability.count))process.exitCode=1;
}
}finally{child.stdin.end()}
