import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=(...parts)=>readFileSync(path.join(root,...parts),'utf8');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const runs=readdirSync(root).filter(f=>/^v[12]-\d+$/.test(f)&&existsSync(path.join(root,f,'run.json'))).sort();
function section(version){
  const dir=runs.filter(r=>r.startsWith(version+'-')).filter(r=>JSON.parse(read(r,'run.json')).sourcesUnchanged).at(-1);
  if(!dir)return `<section><h2>build-${version}</h2><p>等待交付复测，尚无实测结论。</p></section>`;
  const m=JSON.parse(read(dir,'run.json')), v=m.visual, checks=m.checks;
  const link=(file,text)=>`<a href="${dir}/${file}">${esc(text)}</a>`;
  const env=n=>JSON.parse(read(dir,n+'-env.txt').match(/```json\s*([\s\S]*?)```/)[1]);
  const x=n=>env(n).buttons.find(b=>b.name==='收藏')?.box.x;
  const list=read(dir,'02-list.txt');
  const prose=n=>read(dir,n+'.txt').split('\n').filter(l=>/uid=[\w-]+ "[^"]{16,}"/.test(l)).map(l=>l.split('"')[1]).join('\n');
  const failures=checks.filter(c=>c.status!=='通过');
  return `<section><h2>build-${version}</h2><p><strong>功能 ${checks.length-failures.length}/${checks.length} 通过</strong> · 未收藏详情首屏有 <strong>${v.count.toLocaleString('en-US')}</strong> 个不同像素（${(100*v.count/v.total).toFixed(2)}%）。</p>
  ${list.includes('01 篇')&&!list.includes('给自己留十分钟')?'<p class="issue">收藏成功后，列表显示「01 篇」，但没有文章条目可读。</p>':''}
  <table><thead><tr><th>操作与预期</th><th>结果</th><th>实测与快照</th></tr></thead><tbody>${checks.map(c=>`<tr><td>${esc(c.step)}</td><td class="${c.status==='通过'?'ok':'bad'}">${esc(c.status)}</td><td>${link(c.file,c.actual)}</td></tr>`).join('')}</tbody></table>
  <h3>未收藏详情：同一视口对图</h3><p>收藏按钮左沿：设计 ${x('design')} px，实际 ${x('actual')} px。${prose('design')===prose('actual')?'两份快照中的正文一致。':'正文也有差异，可查两份首页快照。'} ${link('design.txt','设计快照')} · ${link('actual.txt','实际快照')}</p>
  <div class="imgs">${[['design','设计基准'],['actual','实际页面'],['diff','逐像素差异 · 红色']].map(([k,s])=>`<figure><figcaption>${s}</figcaption><a href="${dir}/${k}.png"><img src="${dir}/${k}.png" width="390" height="844" alt="${s}"></a></figure>`).join('')}</div>
  <p>比较 ${v.total.toLocaleString('en-US')} 个像素，不缩放、无遮罩，任一 RGBA 通道不同即计数。${v.box?'差异边界（含端点）：'+v.box.join(', ')+'。':'没有差异区域。'}连续复拍：${link('design-repeat.png','设计')} ${m.stability.design.count}、${link('actual-repeat.png','实际')} ${m.stability.actual.count} 个不同像素。</p>
  <small>${esc(m.chrome)} · Chrome DevTools MCP ${esc(m.server.version)} · ${link('design-env.txt','设计环境')} · ${link('actual-env.txt','实际环境')} · ${link('run.json','原始结果与输入 SHA-256')}</small></section>`;
}
writeFileSync(path.join(root,'report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>日间阅读 · 收藏验收</title><style>*{box-sizing:border-box}body{margin:auto;max-width:1080px;padding:28px 18px;color:#24352e;background:#f8f9f5;font:16px/1.6 system-ui,sans-serif}section{background:white;border:1px solid #ccd5ce;padding:clamp(12px,3vw,28px);margin:24px 0}a,.ok{color:#215c48}.issue,.bad{color:#9c2840;font-weight:600}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid #d8dfd9}th{background:#eff3ef}.imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}figcaption{font-weight:600;margin-bottom:6px}img{width:100%;height:auto;border:1px solid #ccd5ce}@media(max-width:620px){.imgs{grid-template-columns:1fr}section{padding:12px}td,th{padding:4px}}</style><main><header><small>日间阅读 / 本地 App 验收</small><h1>收藏能否留到下次读？</h1><p>以 <a href="../brief.html">业务预期</a> 检查收藏主流程，以 <a href="../design.html">design.html</a> 比对未收藏详情。每轮从独立浏览器首次打开开始；390 × 844、DPR 1、移动触控、浅色、页面顶部。</p></header>${section('v1')}${section('v2')}<footer>结论仅覆盖该浏览器中的本地收藏与指定首屏；不代表账号同步、服务端验证或设计师签收。</footer></main></html>`);
