import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const dir=fileURLToPath(new URL('.',import.meta.url)), root=path.dirname(path.resolve(dir));
const version=process.argv[2];
if(!['v1','v2','probe'].includes(version)) throw Error('用法：node replay.mjs v1|v2|probe');
const chrome=process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const build=`build-${version}.html`, files=['design.html',build];
const hash=f=>createHash('sha256').update(readFileSync(path.join(root,f))).digest('hex');
const sources=version==='probe'?{}:Object.fromEntries(files.map(f=>[f,hash(f)]));
const run=`${version}-${Date.now()}`, out=path.join(dir,run);
const {PNG}=createRequire(import.meta.url)('pngjs');
const child=spawn(process.env.MCP_BIN||'chrome-devtools-mcp',['--headless','--isolated','--no-page-id-routing','--no-performance-crux','--no-usage-statistics',`--executablePath=${chrome}`,`--workspace=${dir}`],{stdio:['pipe','pipe','inherit']});
const pending=new Map();let id=0;
child.on('exit',()=>{for(const {reject} of pending.values())reject(Error('MCP 已退出'))});
createInterface({input:child.stdout}).on('line',line=>{
  const m=JSON.parse(line), p=pending.get(m.id);
  if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);
});
const send=m=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
const req=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});send({id,method,params})});
async function tool(name,args={}){
  const r=await req('tools/call',{name,arguments:args}), text=r.content.map(c=>c.text??'').join('\n');
  if(r.isError)throw Error(name+': '+text);return text;
}
const save=(name,data)=>writeFileSync(path.join(out,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
const shot=name=>tool('take_screenshot',{format:'png',filePath:path.join(out,name+'.png')});
function diff(a,b,output){
  const load=n=>PNG.sync.read(readFileSync(path.join(out,n+'.png'))), p=load(a), q=load(b);
  if([p,q].some(x=>x.width!==390||x.height!==844))throw Error('截图非 390×844，停止比较');
  const d=new PNG({width:p.width,height:p.height});let count=0,box=[390,844,-1,-1];
  for(let i=0;i<p.data.length;i+=4){
    const changed=!p.data.subarray(i,i+4).equals(q.data.subarray(i,i+4));
    if(changed){count++;const x=i/4%390,y=Math.floor(i/4/390);box=[Math.min(x,box[0]),Math.min(y,box[1]),Math.max(x,box[2]),Math.max(y,box[3])]}
    const g=200+Math.round((p.data[i]+p.data[i+1]+p.data[i+2])/765*55);
    d.data.set(changed?[196,0,65,255]:[g,g,g,255],i);
  }
  if(output)saveImage(output,d);
  return {count,total:390*844,box:count?box:null};
}
function saveImage(name,image){writeFileSync(path.join(out,name+'.png'),PNG.sync.write(image))}
let tree;
async function snapshot(name){tree=await tool('take_snapshot');save(name+'.txt',tree)}
const nav=file=>tool('navigate_page',{type:'url',url:pathToFileURL(path.join(root,file)).href});
async function settle(){await tool('evaluate_script',{function:'async () => {await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return document.readyState}'})}
async function capture(name,file){
  await nav(file);await settle();await snapshot(name);
  const env=await tool('evaluate_script',{function:`() => ({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,touch:navigator.maxTouchPoints,scroll:[scrollX,scrollY],lang:navigator.language,theme:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light',buttons:[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>({name:b.innerText,box:b.getBoundingClientRect().toJSON(),background:getComputedStyle(b).backgroundColor}))})`});
  save(name+'-env.txt',env);await shot(name);await shot(name+'-repeat');return diff(name,name+'-repeat');
}
function button(re){return tree.split('\n').find(l=>l.includes('button "')&&re.test(l.split('button "')[1].split('"')[0])&&!l.includes('disabled'))}
async function click(re){const line=button(re);if(!line)return false;await tool('click',{uid:line.match(/uid=(\S+)/)[1]});await settle();return true}
try{
  const info=await req('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'app-delivery-qa',version:'1'}});
  send({method:'notifications/initialized'});
  await tool('emulate',{viewport:'390x844x1,mobile,touch',colorScheme:'light'});
  if(version==='probe'){console.log(info.serverInfo,await tool('list_pages'))}
  else{
    mkdirSync(out);
    const m={version,started:new Date().toISOString(),server:info.serverInfo,chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),sources,checks:[]};
    m.stability={design:await capture('design',files[0]),actual:await capture('actual',build)};
    m.visual=diff('design','actual','diff');console.log('首页像素',m.visual);
    await journey(m);
    m.sourcesUnchanged=files.every(f=>sources[f]===hash(f));save('run.json',m);
    if(!m.sourcesUnchanged)throw Error('输入文件测试中有变更，请重跑');
    console.log(out,JSON.stringify(m.checks));
    execFileSync(process.execPath,[path.join(dir,'report.mjs'),run],{stdio:'inherit'});
  }
}finally{child.stdin.end()}

async function journey(m){
  const mark=(step,status,actual,file)=>m.checks.push({step,status,actual,file:file+'.txt'});
  async function act(key,step,re,test){
    if(!await click(re)){await snapshot(key);mark(step,'未测','缺少操作前提：未找到 '+re.source,key);return}
    await snapshot(key);const [ok,note]=test();mark(step,ok?'通过':'失败',note,key);
  }
  const saved=/已收藏|取消收藏/, unsaved=/^收藏$|^收藏文章$/;
  const savedCheck=()=>[!!button(saved),button(saved)?'文章操作显示已收藏':'未见已收藏操作'];
  const list=/我的收藏/, empty=/还没有收藏|暂无收藏|尚无收藏|收藏夹为空/;
  const rows=()=>tree.split('\n').filter(l=>l.includes('button "')&&!l.includes('button "返回"'));
  const itemCount=()=>rows().filter(l=>l.includes('给自己留十分钟')).length;
  await act('01-save','点收藏 → 已收藏',unsaved,savedCheck);
  await act('02-list','我的收藏 → 仅一篇目标文章',list,()=>{
    const n=itemCount();return [tree.includes('heading "我的收藏"')&&rows().length===1&&n===1&&!empty.test(tree),`列表有 ${rows().length} 个文章入口，目标文章 ${n} 条${empty.test(tree)?'，显示空态':''}`];
  });
  await act('03-return','返回 → 保持已收藏',/返回/,savedCheck);
  await tool('navigate_page',{type:'reload',ignoreCache:true});await settle();await snapshot('04-refresh');
  const [ok,note]=savedCheck();mark('刷新 → 保持已收藏',ok?'通过':'失败',note,'04-refresh');
  await act('05-remove','取消收藏 → 恢复收藏入口',saved,()=>[!!button(unsaved),button(unsaved)?'按钮恢复为收藏':'未见收藏入口']);
  await act('06-empty','再进我的收藏 → 空态且无文章',list,()=>[empty.test(tree)&&itemCount()===0,`空态${empty.test(tree)?'可见':'不可见'}；目标文章出现 ${itemCount()} 次`]);
}
