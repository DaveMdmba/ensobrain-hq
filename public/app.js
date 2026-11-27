// David x Dave HQ front end. Talks to the server's JSON API and listens on
// /api/events so every open page redraws as soon as anyone changes something.
{
const $=s=>document.querySelector(s);
// All data values are text, never markup.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ST=[['todo','To do'],['doing','In progress'],['needs','Needs David'],['done','Done']];
const AREAS=['Instagram','Funnel & NOVA','Sales calls','Help Bank','Admin','Strategy'];
const PRI=['High','Medium','Low'];
const STL=Object.fromEntries([...ST,['braindump','Brain dump']]);
const VIEWS=[['check-in','Check-in'],['board','Board'],['numbers','Numbers'],['docs','Docs'],['brain-dump','Brain dump']];
// Older links still work: the list, leads and routine screens now live inside these four.
const ALIAS={table:'board',leads:'numbers',routine:'check-in'};
const today=()=>new Date().toLocaleDateString('en-CA');
const monday=d=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()-((x.getDay()+6)%7));return x.toLocaleDateString('en-CA')};
const addDays=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return x.toLocaleDateString('en-CA')};
const fmt=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'';
const fmtLong=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}):'';
let me=null,ready=false,pending=false,tasks=[],weeks=[],routine=[],leads=[],meta=[],log=[],docs=[];
let view='check-in',q='',own='all',area='all',sortK='due',sortD=1,editing=null,showOldDone=false;
let routineOpen=false,showLog=false;
let docId='',docType='all',docEditing=false,editNext='';const seenMarked=new Set();
let mode='cards';try{if(localStorage.getItem('hq-mode')==='list')mode='list'}catch{}

// On phones the table turns into stacked cards; each cell needs its column label.
new MutationObserver(()=>{for(const c of document.querySelectorAll('.stack td:not([data-l])')){let i=0,p=c;while(p=p.previousElementSibling)i+=p.colSpan;c.dataset.l=c.closest('table').rows[0].cells[i]?.textContent||''}}).observe(document,{childList:true,subtree:true});

const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.h);toast.h=setTimeout(()=>t.classList.remove('show'),3200)};
const live=(ok,m)=>{const l=$('#live');l.classList.toggle('off',!ok);l.querySelector('span').textContent=m};

// ---- server calls ----
async function api(method,url,body){
 const r=await fetch(url,{method,credentials:'same-origin',headers:{'X-Requested-With':'hq',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 let j={};try{j=await r.json()}catch{}
 if(!r.ok){const e=new Error(j.error||'Request failed');e.status=r.status;throw e}
 return j}
let seq=0;
async function refresh(){const n=++seq;
 try{const s=await api('GET','/api/state');if(n!==seq)return true;
  me=s.me;tasks=s.tasks;weeks=s.weeks;routine=s.routine;leads=s.leads||[];meta=s.meta||[];log=s.log||[];docs=s.docs||[];ready=true;$('#me').textContent=me.name;render();
  if(editing&&!tasks.some(t=>t.id===editing))closeDrawer();return true}
 catch(e){if(e.status===401){showAuth();return false}throw e}}
// Runs one change, then reloads the board. Returns true when it saved.
async function write(fn){
 try{await fn();await refresh();return true}
 catch(e){if(e.status===401)showAuth();else if(e.status===404||e.status===400){toast(e.message);refresh().catch(()=>{})}else toast('Couldn’t save. Check your connection and try again.');return false}}
const saveTask=(id,data)=>write(()=>{const now=new Date().toISOString();data.updated=now;
 if('status'in data){if(data.status==='done'){const old=tasks.find(t=>t.id===id);if(!old||old.status!=='done'){data.doneAt=today();data.doneTs=now}}else{data.doneAt='';data.doneTs=''}}
 if(id)return api('PATCH','/api/items/tasks/'+encodeURIComponent(id),data);
 data.created=now;return api('POST','/api/items/tasks',data)});
const myOwner=()=>/^david/i.test(me?.name||'')?'David':'Dave';

// ---- views ----
const overdue=t=>t.due&&t.status!=='done'&&t.status!=='braindump'&&t.due<today();
const work=()=>tasks.filter(t=>t.status!=='braindump'&&!t.archived);
const ideas=()=>tasks.filter(t=>t.status==='braindump'&&!t.archived);
// A new week starts with the previous week's targets, so they only need setting once.
const newWeek=wk=>{const prev=weeks.filter(w=>w.week<wk).sort((a,b)=>a.week.localeCompare(b.week)).pop()||{};return {week:wk,dms:'',dmTarget:prev.dmTarget??'',calls:'',callsTarget:prev.callsTarget??'',notes:''}};
// A week with no target of its own uses the most recent earlier week's target (rows can be created by the automatic sync, which leaves targets blank).
const target=(wk,f)=>{const set=v=>!(v===''||v==null);const row=weeks.find(w=>w.week===wk);if(row&&set(row[f]))return +row[f]||0;const p=weeks.filter(w=>w.week<wk&&set(w[f])).sort((a,b)=>a.week.localeCompare(b.week)).pop();return p?+p[f]||0:0};
const fmtDT=iso=>new Date(iso).toLocaleString('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const ago=iso=>{const m=Math.max(0,Math.round((Date.now()-new Date(iso))/60000));return m<1?'just now':m<60?m+'m ago':m<1440?Math.round(m/60)+'h ago':Math.round(m/1440)+'d ago'};
const visible=()=>work().filter(t=>(own==='all'||t.owner===own)&&(area==='all'||t.area===area)&&(!q||((t.title||'')+' '+(t.notes||'')).toLowerCase().includes(q)));
const byDue=a=>a.slice().sort((x,y)=>(x.due||'9999').localeCompare(y.due||'9999')||(x.created||'').localeCompare(y.created||''));
const dueHtml=t=>t.due?`<span class="due${overdue(t)?' late':''}">${overdue(t)?'Overdue · ':'Due '}${esc(fmt(t.due))}</span>`:'';
const who=o=>o?`<span class="who ${o==='David'?'dv':'dk'}"><i aria-hidden="true">${o==='David'?'DA':'DM'}</i>${esc(o)}</span>`:'';
const areaTag=a=>a?`<span class="tag a${AREAS.indexOf(a)}">${esc(a)}</span>`:'';
const card=t=>`<article class="card" draggable="true" data-id="${esc(t.id)}" tabindex="0" aria-label="${esc(t.title)}"><h3>${esc(t.title)}</h3><div class="meta">${t.blocked?'<span class="tag blk">Blocked</span>':''}${areaTag(t.area)}${t.priority==='High'?'<span class="tag hi">High</span>':''}${dueHtml(t)}${who(t.owner)}</div><select class="mv" data-mv-id="${esc(t.id)}" aria-label="Move to another column"><option value="" selected disabled>Move to…</option>${ST.filter(x=>x[0]!==t.status).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></article>`;

function kpis(){$('#kpis').hidden=view!=='board';if(view!=='board')return;const w=work(),wk=monday(today());
 const nd=w.filter(t=>t.status==='needs').length,od=w.filter(overdue).length,nb=w.filter(t=>t.blocked&&t.status!=='done').length;
 const k=[['Needs David',nd,nd?'alert':'','needs'],['Blocked',nb,nb?'alertr':'','blocked'],['Overdue',od,od?'alertr':'','late'],['Done this week',w.filter(t=>t.status==='done'&&t.doneAt>=wk).length,'','']];
 $('#kpis').innerHTML=k.map(([l,v,c,go])=>`<button class="kpi ${c}" data-go="${go}"><b>${esc(v)}</b><span>${l}</span></button>`).join('')}
function tabs(){const bd=ideas().length,dn=isD()?shared().filter(d=>!d.seenAt).length:drafts().length;
 $('#tabs').innerHTML=VIEWS.map(([k,l])=>`<a class="tab${view===k?' on':''}" href="#${k}">${l}${k==='brain-dump'&&bd?`<em>${bd}</em>`:''}${k==='docs'&&dn?`<em class="dn">${dn}</em>`:''}</a>`).join('')}
function toolbar(){return `<div class="tool"><input type="search" id="q" placeholder="Search tasks and notes" value="${esc(q)}" aria-label="Search">
<div class="seg" role="group" aria-label="Owner">${['all','Dave','David'].map(o=>`<button data-own="${o}" class="${own===o?'on':''}">${o==='all'?'Everyone':o}</button>`).join('')}</div>
<select id="area" aria-label="Area"><option value="all">All areas</option>${AREAS.map(a=>`<option${area===a?' selected':''}>${esc(a)}</option>`).join('')}</select>
<div class="seg" role="group" aria-label="Layout">${[['cards','Cards'],['list','List']].map(([k,l])=>`<button data-mode="${k}" class="${mode===k?'on':''}">${l}</button>`).join('')}</div>
<button class="btn" data-new="todo">+ New task</button></div>`}
function board(){const v=visible();return `<div class="board">${ST.map(([k,l])=>{let items=byDue(v.filter(t=>t.status===k));const n=items.length;let more='';
 if(k==='done'){items=items.sort((a,b)=>(b.doneAt||'').localeCompare(a.doneAt||''));const cut=addDays(today(),-7),old=items.filter(t=>(t.doneAt||'')<cut).length;
  if(old&&!showOldDone)items=items.filter(t=>(t.doneAt||'')>=cut);if(old)more=`<button class="link" data-olddone>${showOldDone?'Hide older':'Show '+old+' older'}</button>`}
 return `<section class="col" data-st="${k}"><header class="ch"><i class="dot ${k}"></i><h2>${l}</h2><span class="n">${n}</span></header><div class="list">${items.map(card).join('')||`<p class="empty">${k==='done'&&n?'Nothing finished in the last 7 days':'Nothing here'}</p>`}${more}</div><form class="qa" data-st="${k}"><input name="t" placeholder="+ Add to ${l}" aria-label="Add a task to ${l}" autocomplete="off" maxlength="300"></form></section>`}).join('')}</div>`}
const COLS=[['title','Task'],['status','Status'],['owner','Owner'],['area','Area'],['priority','Priority'],['due','Due']];
const key=(t,k)=>k==='status'?ST.findIndex(s=>s[0]===t.status):k==='priority'?(t.priority?PRI.indexOf(t.priority):9):(t[k]||'~').toString().toLowerCase();
function table(){const v=visible().sort((a,b)=>{const x=key(a,sortK),y=key(b,sortK);return (x<y?-1:x>y?1:0)*sortD});
 return `<table class="stack"><thead><tr>${COLS.map(([k,l])=>`<th><button data-sort="${k}">${l}${sortK===k?(sortD>0?' ↑':' ↓'):''}</button></th>`).join('')}</tr></thead><tbody>${v.map(t=>`<tr data-id="${esc(t.id)}"><td><strong>${esc(t.title)}</strong>${t.blocked?' <span class="tag blk">Blocked</span>':''}</td><td><select class="s-${esc(t.status)}" data-st-id="${esc(t.id)}" aria-label="Status">${ST.map(([k,l])=>`<option value="${k}"${t.status===k?' selected':''}>${l}</option>`).join('')}</select></td><td>${who(t.owner)}</td><td>${areaTag(t.area)}</td><td>${t.priority==='High'?'<span class="tag hi">High</span>':esc(t.priority)}</td><td>${dueHtml(t)}</td></tr>`).join('')||`<tr><td colspan="6" class="empty">No tasks match.</td></tr>`}</tbody></table>${archived()}`}
// Archived tasks are kept, out of the way, and can be brought back.
function archived(){const a=tasks.filter(t=>t.archived);if(!a.length)return '';
 return `<details class="arch"><summary>Archived (${a.length})</summary><ul class="bdl">${a.map(t=>`<li><div><strong>${esc(t.title)}</strong><span class="sub">${esc(STL[t.status]||'')}${t.archivedAt?' · archived '+esc(fmt(t.archivedAt)):''}</span></div><div class="act"><button class="btn ghost" data-restore="${esc(t.id)}">Restore</button></div></li>`).join('')}</ul></details>`}
function brain(){const v=ideas().sort((a,b)=>(b.created||'').localeCompare(a.created||''));
 return `<div class="bd"><form class="bdf" id="bdf"><input name="t" placeholder="Dump an idea. It stays here until we decide it’s a priority." aria-label="New idea" autocomplete="off" maxlength="300"><button class="btn">Add</button></form>
 <ul class="bdl">${v.map(t=>`<li data-id="${esc(t.id)}"><div><strong>${esc(t.title)}</strong><span class="sub">${esc(t.owner||'')}${t.created?' · added '+esc(fmt(t.created.slice(0,10))):''}</span>${t.notes?`<p>${esc(t.notes)}</p>`:''}</div><div class="act"><button class="btn" data-promote="${esc(t.id)}">Make it a task</button><button class="btn ghost" data-open="${esc(t.id)}">Open</button></div></li>`).join('')||'<li class="empty">No ideas parked. Add one above.</li>'}</ul></div>`}
function bars(label,f,tf){const w=weeks.filter(x=>!(x[f]===''||x[f]==null)).sort((a,b)=>a.week.localeCompare(b.week)).slice(-8);if(w.length<2)return '';
 const max=Math.max(1,...w.map(x=>Math.max(+x[f]||0,target(x.week,tf))));
 return `<div class="panel"><h2>${label}</h2>${w.map(x=>{const v=+x[f]||0,t=target(x.week,tf);return `<div class="row"><span>${esc(fmt(x.week))}</span><div class="bar"><div class="fill" style="width:${(v/max*100).toFixed(1)}%"></div>${t?`<i class="tgt" style="left:calc(${(t/max*100).toFixed(1)}% - 1.5px)" title="Target ${t}"></i>`:''}</div><span class="v">${x[f]===''||x[f]==null?'–':esc(v)}${t?' / '+esc(t):''}</span></div>`}).join('')}${w.some(x=>target(x.week,tf))?'<p class="sub">The marker on each bar is the target.</p>':''}</div>`}
function numbers(){const w=weeks.slice().sort((a,b)=>a.week.localeCompare(b.week));const F=[['dms','DM conversations'],['dmTarget','DM target'],['calls','Calls booked'],['callsTarget','Calls target']];
 const ch=bars('DM conversations per week','dms','dmTarget')+bars('Sales calls booked per week','calls','callsTarget');
 return `${ch?`<div class="grid2">${ch}</div>`:''}
 <div class="wk"><table class="stack"><thead><tr><th><button tabindex="-1">Week of</button></th>${F.map(f=>`<th><button tabindex="-1">${f[1]}</button></th>`).join('')}<th><button tabindex="-1">Notes</button></th></tr></thead><tbody>${w.map(x=>`<tr><td><strong>${esc(fmt(x.week))}</strong></td>${F.map(([k,l])=>`<td><input type="number" min="0" inputmode="numeric" data-wid="${esc(x.id)}" data-f="${k}" value="${x[k]===''||x[k]==null?'':esc(x[k])}" aria-label="${l}"></td>`).join('')}<td><input data-wid="${esc(x.id)}" data-f="notes" value="${esc(x.notes||'')}" aria-label="Notes" maxlength="300"></td></tr>`).join('')}</tbody></table>
 <p><button class="btn ghost" id="addwk">+ Add next week</button></p></div>`}
// Lead counts per pipeline stage, copied from NOVA by a scheduled check. Counts only: names stay in NOVA.
function leadsV(){const meta=leads.find(x=>x.id==='_meta')||{};const st=leads.filter(x=>x.id!=='_meta').sort((a,b)=>(a.order||0)-(b.order||0));
 if(!st.length)return '<p class="empty">No lead numbers yet. They are copied from NOVA before each check-in.</p>';
 const val=x=>(+x.open||0)+(+x.won||0),max=Math.max(1,...st.map(val));
 const url=typeof meta.url==='string'&&meta.url.startsWith('https://')?meta.url:'';
 const when=meta.checked?new Date(meta.checked).toLocaleString('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
 return `<div class="panel lp"><h2>${esc(meta.pipeline||'Sales pipeline')}</h2>
 ${st.map(x=>`<div class="lrow"><span class="ln"><strong>${esc(x.name)}</strong>${x.hint?`<small>${esc(x.hint)}</small>`:''}</span><div class="bar"><div class="fill" style="width:${(val(x)/max*100).toFixed(1)}%"></div></div><span class="v">${esc(val(x))}</span></div>`).join('')}
 <p class="sub">${esc(meta.total??st.reduce((a,x)=>a+val(x)+(+x.lost||0),0))} leads in total · ${esc(meta.won??0)} won · ${esc(meta.lost??0)} lost${when?' · checked '+esc(when):''}</p>
 ${url?`<p><a class="btn linkbtn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open in NOVA</a></p>`:''}
 <p class="sub">Counts only. Names and details stay in NOVA.</p></div>`}
// One screen for the call. What is waiting on David comes first; finishing the check-in comes last.
function checkinV(){const w=work(),wk=monday(today()),cur=weeks.find(x=>x.week===wk),prev=weeks.filter(x=>x.week<wk).sort((a,b)=>a.week.localeCompare(b.week)).pop();
 const ci=meta.find(x=>x.id==='checkin')||{},since=ci.last||new Date(Date.now()-7*864e5).toISOString();
 const wins=w.filter(t=>t.status==='done'&&(t.doneTs?t.doneTs>=since:(t.doneAt||'')>=since.slice(0,10)));
 const needs=byDue(w.filter(t=>t.status==='needs')),stuck=w.filter(t=>t.blocked&&t.status!=='done'),late=byDue(w.filter(overdue));
 const blank=v=>v===''||v==null;
 const li=t=>`<li><button class="rowbtn" data-open="${esc(t.id)}"><span>${esc(t.title)}</span>${who(t.owner)}</button>${t.blocked&&t.blocker?`<small>${esc(t.blocker)}</small>`:''}</li>`;
 const body=(title,items,empty)=>`<h2>${title} <span class="n">${items.length}</span></h2>${items.length?`<ul class="cl">${items.map(li).join('')}</ul>`:`<p class="empty">${empty}</p>`}`;
 const list=(key,title,items,empty,cls)=>`<section class="panel ${cls}${items.length?'':' mt'}" data-p="${key}">${body(title,items,empty)}</section>`;
 // Overdue and Blocked share one panel: they are the same kind of thing (a problem) and are usually short.
 const part=(key,title,items,empty)=>`<div class="sec${items.length?' rd':' mt'}" data-p="${key}">${body(title,items,empty)}</div>`;
 // The bar only appears once there is a target to measure against.
 const goal=(label,f,tf)=>{const v=cur?cur[f]:'',t=target(wk,tf),pct=t?Math.min(100,(+v||0)/t*100):0;
  return `<div class="goal"><strong>${label}</strong><span class="gv"><b>${blank(v)?'–':esc(v)}</b>${t?'of '+esc(t):''}</span>${t?`<div class="bar"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div>`:''}<div class="gm">${prev&&!blank(prev[f])?`<span>Last week: ${esc(prev[f])}</span>`:''}${cur?`<label>Target <input type="number" min="0" inputmode="numeric" class="tg" data-wid="${esc(cur.id)}" data-f="${tf}" value="${blank(cur[tf])?'':esc(cur[tf])}" placeholder="${t&&blank(cur[tf])?esc(t):'–'}" aria-label="${label} target"></label>`:''}</div></div>`};
 // Lead counts are saved each time a check-in is finished, so the next one can show what moved.
 let snap=null;try{snap=ci.snap?JSON.parse(ci.snap):null}catch{}
 const st=leads.filter(x=>x.id!=='_meta').sort((a,b)=>(a.order||0)-(b.order||0)).map(x=>{const n=(+x.open||0)+(+x.won||0);return {n,name:x.name,d:snap&&typeof snap[x.id]==='number'?n-snap[x.id]:0}}).filter(x=>x.n>0||x.d);
 const undo=ci.undo&&ci.last&&Date.now()-new Date(ci.last)<6e5;
 const act=log.length?`<section class="panel"><h2>Recent activity</h2><ul class="act2">${log.slice(0,showLog?25:4).map(x=>`<li><span><strong>${esc(x.who)}</strong> ${esc(x.text)}</span><small>${esc(ago(x.at))}</small></li>`).join('')}</ul>${log.length>4?`<button class="link" data-morelog>${showLog?'Show less':'Show more'}</button>`:''}</section>`:'';
 return `<div class="ci">
 <div class="grid2">${list('needs','Needs David',needs,'Nothing is waiting on David.','pk')}<section class="panel secs">${part('late','Overdue',late,'Nothing is overdue.')}${part('blocked','Blocked',stuck,'Nothing is blocked.')}</section></div>
 <div class="grid2"><section class="panel"><h2>This week’s numbers</h2><div class="goals">${goal('DM conversations','dms','dmTarget')}${goal('Sales calls booked','calls','callsTarget')}</div>${cur?'':`<p><button class="btn ghost" data-addweek="${esc(wk)}">Start this week’s numbers</button></p>`}</section>
 ${st.length?`<section class="panel"><h2>Leads</h2><ul class="mini">${st.map(x=>`<li><span>${esc(x.name)}</span><span class="lv">${x.d?`<em>${x.d>0?'+':'−'}${Math.abs(x.d)}</em>`:''}<b>${esc(x.n)}</b></span></li>`).join('')}</ul><p class="sub">${snap?'+ / − is the change since the last check-in. ':''}<a href="#numbers">See the full pipeline</a></p></section>`:''}</div>
 <div class="grid2">${list('wins','Wins',wins,'Nothing finished since the last check-in.','')}${act}</div>
 ${docsPanel()}
 <div class="panel cihead"><p>${ci.last?'Last check-in: '+esc(fmtDT(ci.last))+'.':'No check-in saved yet, so Wins shows the last 7 days.'}${undo?' <button class="link" id="ciundo">Undo</button>':''}</p><button class="btn" id="cidone">Finish check-in</button></div>
 ${routineBox()}</div>`}
// Dave's own routine, folded away so it doesn't crowd the call.
function routineBox(){const t=today(),r=routine.slice().sort((a,b)=>(a.order||0)-(b.order||0));if(!r.length)return '';
 return `<details class="panel rtd" id="rtd"${routineOpen?' open':''}><summary><h2>Dave’s routine checks</h2><span class="n">${r.filter(x=>x.lastDone===t).length} of ${r.length} done today</span></summary><ul class="rm">${r.map(x=>{const d=x.lastDone===t;return `<li><button class="rc${d?' on':''}" data-rid="${esc(x.id)}" aria-pressed="${d}"><i></i><span><strong>${esc(x.name)}</strong><small>${esc(x.freq)}${x.lastDone?' · last done '+esc(fmt(x.lastDone)):''}</small></span></button></li>`}).join('')}</ul></details>`}

// ---- docs: reports, check-in notes, how-tos and decisions in one place ----
// Dave (or Claude on his behalf) writes a draft; only Dave sees drafts. Approving shares it with David,
// who can open it, give it a thumbs-up and reply. Every doc shows in the Ensobrain page style and prints to PDF.
const LOGO='https://images.squarespace-cdn.com/content/v1/65145e8e30a0aa674ddf151b/392c6acf-1991-4997-bf42-f0ec719e6684/Ensobrain.jpg?format=500w';
const DT=[['report','Report'],['checkin','Check-in notes'],['sop','How-to'],['decision','Decision'],['note','Note']];
const DTL=Object.fromEntries(DT);
const isD=()=>/^david$/i.test(me?.name||'');
const liveDocs=()=>docs.filter(d=>!d.archived);
const drafts=()=>liveDocs().filter(d=>d.status!=='approved');
const shared=()=>liveDocs().filter(d=>d.status==='approved');
const nums=d=>{try{const n=JSON.parse(d.nums||'{}');return n&&typeof n==='object'&&!Array.isArray(n)?n:{}}catch{return {}}};
const docDay=d=>d.period||(d.approvedAt||d.created||'').slice(0,10);
const newestFirst=(a,b)=>docDay(b).localeCompare(docDay(a))||(b.approvedAt||b.updated||'').localeCompare(a.approvedAt||a.updated||'');
const fmtYear=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'';
const dayOf=iso=>iso?new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'';
const NUMS=[['dms','DM conversations'],['calls','Calls booked'],['held','Sales calls held'],['won','New clients']];
const docLink=d=>location.origin+'/#docs/'+encodeURIComponent(d.id);
const waText=d=>`${(d.whatsapp||'').trim()||`*${d.title||'New doc'}*`}\n\nFull ${d.type==='report'?'report':'doc'} on the board: ${docLink(d)}`;
// A small, safe Markdown reader: everything is escaped first, then a few marks become formatting.
function md(src){const L=String(src||'').replace(/\r/g,'').split('\n');let out='',para=[],list=null,tbl=[];
 const inl=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g,'$1<em>$2</em>').replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
 const cells=r=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim());
 const flush=()=>{if(para.length){out+=`<p>${para.map(inl).join('<br>')}</p>`;para=[]}
  if(list){out+=`<${list.t}>${list.i.map(x=>`<li>${inl(x)}</li>`).join('')}</${list.t}>`;list=null}
  if(tbl.length){const rows=tbl.filter(r=>!/^\s*\|?\s*:?-{2,}/.test(r)).map(cells);const [h,...b]=rows;
   out+=`<div class="tw"><table><thead><tr>${h.map(c=>`<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>${b.map(r=>`<tr>${r.map(c=>`<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;tbl=[]}};
 for(const raw of L){const l=raw.trimEnd();let m;
  if(!l.trim()){flush();continue}
  if(/^\s*\|.*\|\s*$/.test(l)){if(!tbl.length)flush();tbl.push(l);continue}else if(tbl.length)flush();
  if(m=l.match(/^(#{1,4})\s+(.*)$/)){flush();const n=Math.min(4,m[1].length+1);out+=`<h${n}>${inl(m[2])}</h${n}>`;continue}
  if(/^\s*(-{3,}|\*{3,})\s*$/.test(l)){flush();out+='<hr>';continue}
  if(m=l.match(/^>\s?(.*)$/)){flush();out+=`<blockquote>${inl(m[1])}</blockquote>`;continue}
  if(m=l.match(/^\s*[-*•]\s+(.*)$/)){if(para.length||(list&&list.t!=='ul'))flush();list=list||{t:'ul',i:[]};list.i.push(m[1]);continue}
  if(m=l.match(/^\s*\d+[.)]\s+(.*)$/)){if(para.length||(list&&list.t!=='ol'))flush();list=list||{t:'ol',i:[]};list.i.push(m[1]);continue}
  if(list)flush();para.push(l.trim())}
 flush();return out}
const typeTag=t=>`<span class="tag dt-${esc(t||'note')}">${esc(DTL[t]||'Note')}</span>`;
function numStrip(d,cls){const n=nums(d),got=NUMS.filter(([k])=>!(n[k]===''||n[k]==null));if(!got.length)return '';
 return `<div class="${cls}">${got.map(([k,l])=>`<div><b>${esc(n[k])}</b><span>${l}</span></div>`).join('')}</div>`}
function docItem(d){const D=isD(),draft=d.status!=='approved';
 const when=draft?'Draft · saved '+ago(d.updated||d.created||new Date().toISOString()):'Shared '+dayOf(d.approvedAt);
 const state=draft?'':D?(d.seenAt?'':' <b class="new">New</b>'):(d.feedback?' · <strong>David replied</strong>':d.reaction==='up'?' · David 👍':d.seenAt?' · Seen by David':' · Not opened yet');
 return `<li><a class="drow" href="#docs/${encodeURIComponent(d.id)}"><span class="dtl"><strong>${esc(d.title||'Untitled')}</strong><small>${typeTag(d.type)}${d.period?`<span>Week of ${esc(fmt(d.period))}</span>`:''}<span>${esc(when)}${state}</span></small></span>${numStrip(d,'chips')}</a></li>`}
// Approved reports with numbers become a simple week-by-week trend.
function docTrend(){const r=shared().filter(d=>d.type==='report'&&d.period).sort((a,b)=>a.period.localeCompare(b.period)).slice(-8);
 const rows=f=>r.filter(d=>!(nums(d)[f]===''||nums(d)[f]==null));
 const one=(label,f)=>{const w=rows(f);if(w.length<2)return '';const max=Math.max(1,...w.map(d=>+nums(d)[f]||0));
  return `<div class="panel"><h2>${label}</h2>${w.map(d=>{const v=+nums(d)[f]||0;return `<div class="row"><span>${esc(fmt(d.period))}</span><div class="bar"><div class="fill" style="width:${(v/max*100).toFixed(1)}%"></div></div><span class="v">${esc(v)}</span></div>`}).join('')}</div>`};
 const h=one('DM conversations, from shared reports','dms')+one('Calls booked, from shared reports','calls');return h?`<div class="grid2">${h}</div>`:''}
function docsV(){const D=isD(),v=liveDocs().filter(d=>docType==='all'||d.type===docType);
 const dr=D?[]:v.filter(d=>d.status!=='approved').sort(newestFirst),sh=v.filter(d=>d.status==='approved').sort(newestFirst);
 const count=t=>liveDocs().filter(d=>(t==='all'||d.type===t)&&(!D||d.status==='approved')).length;
 return `<div class="docs"><div class="tool"><div class="seg" role="group" aria-label="Doc type">${[['all','All'],...DT].filter(([k])=>k==='all'||count(k)).map(([k,l])=>`<button data-dtype="${k}" class="${docType===k?'on':''}">${l}</button>`).join('')}</div><span class="sp"></span>${D?'':'<button class="btn" id="newdoc">+ New doc</button>'}</div>
 ${dr.length?`<section class="panel drp"><h2>Drafts waiting for your OK <span class="n">${dr.length}</span></h2><p class="sub">Only you can see drafts. Open one, change anything you like, then approve it to share it with David.</p><ul class="dl">${dr.map(docItem).join('')}</ul></section>`:''}
 ${docType==='all'||docType==='report'?docTrend():''}
 <section class="panel"><h2>${D?'From Dave':'Shared with David'} <span class="n">${sh.length}</span></h2>${sh.length?`<ul class="dl">${sh.map(docItem).join('')}</ul>`:`<p class="empty">${D?'Nothing here yet. Reports and notes from Dave will appear here.':'Nothing shared yet. Approved docs appear here, newest first.'}</p>`}</section></div>`}
function docForm(d){const n=nums(d);
 return `<div class="dbar"><a class="link" href="#docs">← All docs</a></div><form id="docf" class="paper edit" data-id="${esc(d.id)}"><h2 class="eh">Edit ${esc((DTL[d.type]||'doc').toLowerCase())}</h2>
 <label class="fld"><span>Title</span><input name="title" maxlength="200" value="${esc(d.title||'')}" required></label>
 <div class="f2"><label class="fld"><span>Type</span><select name="type">${DT.map(([k,l])=>`<option value="${k}"${(d.type||'note')===k?' selected':''}>${l}</option>`).join('')}</select></label>
 <label class="fld"><span>Week of (Monday, for reports)</span><input type="date" name="period" value="${esc(d.period||'')}"></label></div>
 <label class="fld"><span>Content <em class="hintmd">Headings: # · Bullets: - · Bold: **text** · Tables: | a | b |</em></span><textarea name="body" class="mdin" rows="22" maxlength="60000">${esc(d.body||'')}</textarea></label>
 <fieldset class="nf"><legend>Numbers for the week (leave blank if not sure)</legend><div class="f4">${NUMS.map(([k,l])=>`<label class="fld"><span>${l}</span><input type="number" min="0" inputmode="numeric" name="n_${k}" value="${n[k]===''||n[k]==null?'':esc(n[k])}"></label>`).join('')}</div></fieldset>
 <label class="fld"><span>WhatsApp version <em class="hintmd">Short message for David. A link to this doc is added at the end.</em></span><textarea name="whatsapp" rows="8" maxlength="6000">${esc(d.whatsapp||'')}</textarea></label>
 <label class="fld"><span>Checks before approving <em class="hintmd">Only you see these. They disappear once the doc is shared.</em></span><textarea name="checks" rows="4" maxlength="6000">${esc(d.checks||'')}</textarea></label>
 <div class="drb"><button class="btn">Save</button><button type="button" class="btn ghost" id="doccancel">Cancel</button><span class="sp"></span><button type="button" class="btn ghost" id="docarch">Archive</button></div></form>`}
function docV(){const d=docs.find(x=>x.id===docId),D=isD();
 if(!d||d.archived)return `<div class="dbar"><a class="link" href="#docs">← All docs</a></div><p class="empty">That doc isn’t here. It may have been archived${D?' or not shared yet':''}.</p>`;
 if(docEditing&&!D)return docForm(d);
 const draft=d.status!=='approved';
 const acts=D?`<button class="btn ghost" id="docprint">Download PDF</button>`:draft?`<button class="btn ghost" id="docedit">Edit</button><button class="btn" id="docok">Approve and share with David</button>`:`<button class="btn ghost" data-copywa>Copy for WhatsApp</button><button class="btn ghost" id="docprint">Download PDF</button><button class="btn ghost" id="docedit">Edit</button><button class="link" id="docback">Move back to draft</button>`;
 const banner=!D&&draft?`<section class="panel drp nb"><h2>Draft: only you can see this</h2><p class="sub">Read it through, edit anything, then approve. Approving shares it with David on the board and copies a WhatsApp message to send him.</p>${(d.checks||'').trim()?`<div class="chk2"><strong>Checks before you approve</strong><div class="mdx">${md(d.checks)}</div></div>`:''}</section>`:'';
 const fb=draft?'':D?`<section class="panel fb"><h2>Your reply to Dave</h2><p><button class="btn ghost${d.reaction==='up'?' on':''}" id="thumb" aria-pressed="${d.reaction==='up'}">👍 ${d.reaction==='up'?'You liked this':'Looks good'}</button></p><form id="fbf"><label class="fld"><span>Anything to add, change or ask?</span><textarea name="fb" rows="3" maxlength="3000" placeholder="Dave sees this on the board.">${esc(d.feedback||'')}</textarea></label><button class="btn">${d.feedback?'Update reply':'Send reply'}</button>${d.feedbackAt?` <span class="sub">Sent ${esc(fmtDT(d.feedbackAt))}</span>`:''}</form></section>`
  :`<section class="panel fb"><h2>David</h2><ul class="mini"><li><span>Opened</span><b class="sm">${d.seenAt?esc(fmtDT(d.seenAt)):'Not yet'}</b></li>${d.reaction==='up'?'<li><span>Reaction</span><b class="sm">👍</b></li>':''}</ul>${d.feedback?`<blockquote class="reply">${esc(d.feedback)}<small>${d.feedbackAt?esc(fmtDT(d.feedbackAt)):''}</small></blockquote>`:''}</section>`;
 const wa=!D?`<details class="panel wa"${draft?'':' open'}><summary><h2>WhatsApp version</h2></summary><pre class="wap">${esc(waText(d))}</pre>${draft?'<p class="sub">You can copy this once the doc is shared, so the link works for David.</p>':'<button class="btn ghost" data-copywa>Copy</button>'}</details>`:'';
 return `<div class="dbar"><a class="link" href="#docs">← All docs</a><span class="sp"></span>${acts}</div>${banner}
 <article class="paper"><header class="ph"><img src="${LOGO}" alt="Ensobrain" referrerpolicy="no-referrer"><span class="kick">${esc(DTL[d.type]||'Note')}${d.period?' · Week of '+esc(fmtYear(d.period)):''}</span></header>
 <h1>${esc(d.title||'Untitled')}</h1><p class="by">Prepared by Dave for David Amor${d.approvedAt?' · '+esc(dayOf(d.approvedAt)):draft?' · Draft':''}</p>
 ${numStrip(d,'nstrip')}<div class="mdx">${md(d.body)||'<p class="sub">Nothing written yet.</p>'}</div>
 <footer class="pf"><span>Ensobrain HQ</span><span>${draft?'Draft, not shared':'Shared with David'}</span></footer></article>
 <div class="grid2 after">${fb}${wa}</div>`}
// On the check-in screen: the latest shared report, and any drafts waiting for Dave.
function docsPanel(){const D=isD(),dr=D?[]:drafts().sort(newestFirst),last=shared().sort(newestFirst)[0];if(!dr.length&&!last)return '';
 return `<section class="panel docp"><h2>Docs</h2><ul class="cl">${dr.map(d=>`<li><a class="rowbtn" href="#docs/${encodeURIComponent(d.id)}"><span>${esc(d.title||'Untitled')}</span><span class="tag dft">Draft · needs your OK</span></a></li>`).join('')}${last?`<li><a class="rowbtn" href="#docs/${encodeURIComponent(last.id)}"><span>${esc(last.title||'Untitled')}</span><small class="sub">Shared ${esc(dayOf(last.approvedAt))}${D&&!last.seenAt?' · new':''}</small></a></li>`:''}</ul><p class="sub"><a href="#docs">All docs</a></p></section>`}
// David opening a shared doc marks it as seen, so Dave knows it was read.
function markSeen(){if(view!=='docs'||!docId||!isD())return;const d=docs.find(x=>x.id===docId);if(!d||d.status!=='approved'||d.seenAt||seenMarked.has(d.id))return;
 seenMarked.add(d.id);api('PATCH','/api/items/docs/'+encodeURIComponent(d.id),{seenAt:new Date().toISOString()}).then(()=>refresh()).catch(()=>{})}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch{try{const a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.append(a);a.select();const ok=document.execCommand('copy');a.remove();return ok}catch{return false}}}
const saveDoc=(id,data)=>write(()=>api('PATCH','/api/items/docs/'+encodeURIComponent(id),{...data,updated:new Date().toISOString()}));

function render(){if(!ready)return;kpis();tabs();
 // Never redraw an open doc editor: live updates would wipe what is being written.
 if(view==='docs'&&docEditing&&$('#docf')?.dataset.id===docId)return;
 // Don't redraw under someone who is typing; redraw when they leave the field.
 const a=document.activeElement,inMain=a&&$('#main').contains(a);
 const quick=inMain&&a.matches('.qa input,#bdf input')&&!a.value?(a.closest('form').dataset.st||'bdf'):null;
 if(inMain&&!quick&&a.matches('input:not([type=search]),textarea')){pending=true;return}pending=false;
 const hadQ=a&&a.id==='q',pos=hadQ?a.selectionStart:0;
 let h='';
 if(view==='check-in')h=checkinV();else if(view==='docs')h=docId?docV():docsV();else if(view==='board')h=toolbar()+(mode==='list'?table():board());else if(view==='numbers')h=`${numbers()}<div class="lsec">${leadsV()}</div>`;else h=brain();
 $('#main').innerHTML=h;if(hadQ){const i=$('#q');if(i){i.focus();i.setSelectionRange(pos,pos)}}
 if(quick){const i=quick==='bdf'?$('#bdf input'):$(`.qa[data-st="${quick}"] input`);if(i)i.focus()}
 markSeen()}

function openDrawer(id,preset){const t=id?tasks.find(x=>x.id===id):{title:'',status:preset||'todo',owner:preset==='needs'?'David':myOwner(),area:'',priority:'',due:'',notes:''};if(!t)return;
 editing=id||null;const opt=(arr,v)=>arr.map(o=>`<option value="${esc(o[0])}"${v===o[0]?' selected':''}>${esc(o[1])}</option>`).join('');
 $('#dr').innerHTML=`<form id="df"><h2>${id?'Task details':'New task'}</h2>
 <label class="fld"><span>Task</span><textarea class="t" name="title" maxlength="300" placeholder="Task name" required>${esc(t.title)}</textarea></label>
 <div class="f2"><label class="fld"><span>Status</span><select name="status">${opt([...ST,['braindump','Brain dump']],t.status)}</select></label>
 <label class="fld"><span>Owner</span><select name="owner">${opt([['Dave','Dave'],['David','David']],t.owner)}</select></label>
 <label class="fld"><span>Area</span><select name="area">${opt([['',''],...AREAS.map(a=>[a,a])],t.area||'')}</select></label>
 <label class="fld"><span>Priority</span><select name="priority">${opt([['',''],...PRI.map(p=>[p,p])],t.priority||'')}</select></label>
 <label class="fld"><span>Due <em id="duehint">${t.due?'· '+esc(fmtLong(t.due)):''}</em></span><input type="date" name="due" value="${esc(t.due||'')}"></label></div>
 <label class="fld"><span>Notes</span><textarea name="notes" rows="5" maxlength="3000">${esc(t.notes||'')}</textarea></label>
 <label class="chk"><input type="checkbox" name="blocked"${t.blocked?' checked':''}><span>Blocked: can’t move forward right now</span></label>
 <label class="fld" id="blkf"${t.blocked?'':' hidden'}><span>What’s blocking it?</span><input name="blocker" maxlength="200" value="${esc(t.blocker||'')}" placeholder="For example: waiting for the new form questions"></label>
 ${t.updated?`<p class="sub">Last updated ${esc(new Date(t.updated).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</p>`:''}
 <div class="drb"><button class="btn">Save</button><button type="button" class="btn ghost" data-close>Close</button><span class="sp"></span>${id?'<button type="button" class="btn ghost" id="del">Archive</button>':''}</div></form>`;
 $('#shell').classList.add('open');setTimeout(()=>{const f=$('#df [name=title]');if(f&&!id)f.focus()},60)}
function closeDrawer(){$('#shell').classList.remove('open');editing=null;if(pending)render()}

// ---- getting in: a private link carries the team passcode, so nobody types an email or password ----
// Link shape: https://<site>/#k=<passcode>&me=David . The part after # never leaves the browser
// except when this page sends it to /api/enter, and it is removed from the address bar straight away.
let linkCode='',linkName='';
{const h=new URLSearchParams(location.hash.slice(1));if(h.has('k')){linkCode=h.get('k')||'';const n=h.get('me')||'';linkName=/^(dave|david)$/i.test(n)?n[0].toUpperCase()+n.slice(1).toLowerCase():'';history.replaceState(null,'',location.pathname)}}
function showAuth(){me=null;ready=false;if(es){es.close();es=null}$('#app').hidden=true;$('#auth').hidden=false;$('#shell').classList.remove('open');$('#toast').classList.remove('show');
 $('#codefld').hidden=!!linkCode;$('#enterlead').textContent=linkCode?'One last thing: who are you?':'Enter the team passcode to open the board.'}
function showApp(){$('#auth').hidden=true;$('#app').hidden=false;$('#autherr').textContent=''}
async function enter(code,name){const b=$('#enterf .btn');b.disabled=true;$('#autherr').textContent='';
 try{await api('POST','/api/enter',{code,name});linkCode='';$('#enterf').reset();await start()}
 catch(e){if(e.status===401)linkCode='';showAuth();$('#autherr').textContent=e.status?e.message:'Can’t reach the server. Try again in a moment.'}
 finally{b.disabled=false}}

// ---- live updates ----
let es=null;
function connect(){if(es)es.close();es=new EventSource('/api/events');
 es.addEventListener('hello',()=>{live(true,'Live');refresh().catch(()=>{})});
 es.addEventListener('change',()=>{refresh().catch(()=>{})});
 es.onerror=()=>{live(false,'Reconnecting…');
  // readyState 2 means the browser gave up (for example the session ended): check, then retry.
  if(es&&es.readyState===2){es=null;setTimeout(()=>{if(me)refresh().then(ok=>{if(ok)connect()}).catch(()=>{if(me)connect()})},3000)}}}
async function start(){try{if(await refresh()){showApp();connect()}}catch{showApp();live(false,'Can’t reach the board yet');setTimeout(start,5000)}}
// Opened from a private link: use it (even if this device was already remembered), otherwise carry on as usual.
async function boot(){if(linkCode&&linkName)await enter(linkCode,linkName);else if(linkCode)showAuth();else await start()}

// ---- events ----
document.addEventListener('click',async e=>{const el=e.target;
 if(el.id==='signout'){const reset=()=>{delete el.dataset.sure;el.textContent='Sign out of this device'};
  if(!el.dataset.sure){el.dataset.sure='1';el.textContent='Tap again to sign out. You’ll need your private link to get back in.';clearTimeout(el.h);el.h=setTimeout(reset,6000);return}
  clearTimeout(el.h);reset();try{await api('POST','/api/logout')}catch{}showAuth();return}
 const kp=el.closest('.kpi');if(kp){const g=kp.dataset.go;if(g==='needs'){own='all';area='all';q='';mode='cards';render();document.querySelector('.col[data-st=needs]')?.scrollIntoView({behavior:'smooth',inline:'start',block:'nearest'})}else if(g==='blocked'){location.hash='check-in'}else if(g==='late'){mode='list';sortK='due';sortD=1;render()}return}
 if(el.closest('[data-close]')||el.id==='ov'){closeDrawer();return}
 if(el.id==='del'){const id=editing;if(await saveTask(id,{archived:true,archivedAt:today()})){closeDrawer();toast('Archived. You can restore it from the Board’s List layout.')}return}
 const rs=el.closest('[data-restore]');if(rs){if(await saveTask(rs.dataset.restore,{archived:false,archivedAt:''}))toast('Restored');return}
 if(el.id==='cidone'){const ci=meta.find(x=>x.id==='checkin')||{};
  const snap=JSON.stringify(Object.fromEntries(leads.filter(x=>x.id!=='_meta').map(x=>[x.id,(+x.open||0)+(+x.won||0)])));
  if(await write(()=>api('PUT','/api/items/meta/checkin',{last:new Date().toISOString(),prev:ci.last||'',snap,prevSnap:ci.snap||'',undo:true})))toast('Check-in saved. Wins start fresh from now.');return}
 if(el.id==='ciundo'){const ci=meta.find(x=>x.id==='checkin')||{};
  if(await write(()=>api('PUT','/api/items/meta/checkin',{last:ci.prev||'',prev:'',snap:ci.prevSnap||'',prevSnap:'',undo:false,undone:true})))toast('Check-in undone.');return}
 const aw=el.closest('[data-addweek]');if(aw){const wk=aw.dataset.addweek;await write(()=>api('PUT','/api/items/weeks/w'+wk,newWeek(wk)));return}
 // docs
 const dty=el.closest('[data-dtype]');if(dty){docType=dty.dataset.dtype;render();return}
 if(el.id==='newdoc'){try{const now=new Date().toISOString();const r=await api('POST','/api/items/docs',{type:'note',title:'Untitled doc',status:'draft',body:'',created:now,createdBy:me.name,updated:now});editNext=r.id;await refresh();location.hash='docs/'+encodeURIComponent(r.id)}catch{toast('Couldn’t create the doc. Try again.')}return}
 if(el.id==='docedit'){docEditing=true;render();scrollTo(0,0);return}
 if(el.id==='doccancel'){docEditing=false;render();return}
 if(el.id==='docprint'){window.print();return}
 if(el.id==='docarch'){const id=$('#docf')?.dataset.id;if(!id)return;if(!el.dataset.sure){el.dataset.sure='1';el.textContent='Tap again to archive';setTimeout(()=>{if(el.isConnected){delete el.dataset.sure;el.textContent='Archive'}},5000);return}
  if(await saveDoc(id,{archived:true,archivedAt:today()})){docEditing=false;toast('Archived');location.hash='docs'}return}
 if(el.closest('[data-copywa]')){const d=docs.find(x=>x.id===docId);if(d)toast(await copyText(waText(d))?'Copied. Paste it into WhatsApp for David.':'Couldn’t copy. Select the text and copy it yourself.');return}
 if(el.id==='docok'){const d=docs.find(x=>x.id===docId);if(!d)return;
  // Copy first, while the click still counts as a user action for the clipboard.
  const copied=copyText(waText(d));const n=nums(d);
  if(d.type==='report'&&d.period&&!Object.keys(n).length){const w=weeks.find(x=>x.week===d.period);if(w){if(!(w.dms===''||w.dms==null))n.dms=w.dms;if(!(w.calls===''||w.calls==null))n.calls=w.calls}}
  if(await saveDoc(d.id,{status:'approved',approvedAt:new Date().toISOString(),approvedBy:me.name,nums:JSON.stringify(n),checks:''}))toast(await copied?'Shared with David. WhatsApp message copied: paste it to him.':'Shared with David. Use “Copy for WhatsApp” to message him.');return}
 if(el.id==='docback'){const d=docs.find(x=>x.id===docId);if(d&&await saveDoc(d.id,{status:'draft',approvedAt:'',approvedBy:''}))toast('Back to draft. David can’t see it now.');return}
 if(el.id==='thumb'){const d=docs.find(x=>x.id===docId);if(d)await write(()=>api('PATCH','/api/items/docs/'+encodeURIComponent(d.id),{reaction:d.reaction==='up'?'':'up'}));return}
 const o=el.closest('[data-own]');if(o){own=o.dataset.own;render();return}
 const md=el.closest('[data-mode]');if(md){mode=md.dataset.mode;try{localStorage.setItem('hq-mode',mode)}catch{}render();return}
 if(el.closest('[data-olddone]')){showOldDone=!showOldDone;render();return}
 if(el.closest('[data-morelog]')){showLog=!showLog;render();return}
 const nw=el.closest('[data-new]');if(nw){openDrawer(null,nw.dataset.new);return}
 const s=el.closest('[data-sort]');if(s){const k=s.dataset.sort;if(sortK===k)sortD*=-1;else{sortK=k;sortD=1}render();return}
 const pr=el.closest('[data-promote]');if(pr){if(await saveTask(pr.dataset.promote,{status:'todo'}))toast('Moved to To do on the board');return}
 const op=el.closest('[data-open]');if(op){openDrawer(op.dataset.open);return}
 const rb=el.closest('[data-rid]');if(rb){const r=routine.find(x=>x.id===rb.dataset.rid);if(!r)return;const t=today();
  const data=r.lastDone===t?{lastDone:r.prevDone||''}:{lastDone:t,prevDone:r.lastDone||''};await write(()=>api('PATCH','/api/items/routine/'+encodeURIComponent(r.id),data));return}
 if(el.id==='addwk'){const last=weeks.map(w=>w.week).sort().pop()||monday(today());const nx=weeks.length?addDays(last,7):last;
  await write(()=>api('PUT','/api/items/weeks/w'+nx,newWeek(nx)));return}
 if(el.closest('select')||el.closest('input'))return;
 const c=el.closest('.card,tbody tr[data-id]');if(c){openDrawer(c.dataset.id)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#shell').classList.contains('open'))closeDrawer();
 if(e.key==='Enter'&&e.target.matches('.card'))openDrawer(e.target.dataset.id)});
document.addEventListener('input',e=>{if(e.target.id==='q'){q=e.target.value.trim().toLowerCase();render()}});
document.addEventListener('change',async e=>{const el=e.target;
 if(el.form&&el.form.id==='df'){if(el.name==='blocked'){const b=$('#blkf');b.hidden=!el.checked;if(el.checked)b.querySelector('input').focus()}
  if(el.name==='due')$('#duehint').textContent=el.value?'· '+fmtLong(el.value):'';return}
 if(el.id==='area'){area=el.value;render();return}
 if(el.dataset.stId){el.className='s-'+el.value;await saveTask(el.dataset.stId,{status:el.value});return}
 if(el.dataset.mvId){if(el.value)await saveTask(el.dataset.mvId,{status:el.value});return}
 if(el.dataset.wid){const f=el.dataset.f,v=f==='notes'?el.value:(el.value===''?'':Math.max(0,Number(el.value)||0));await write(()=>api('PATCH','/api/items/weeks/'+encodeURIComponent(el.dataset.wid),{[f]:v}))}});
document.addEventListener('focusout',()=>setTimeout(()=>{if(pending&&!$('#main').contains(document.activeElement))render()},0));
document.addEventListener('submit',async e=>{e.preventDefault();const f=e.target;
 if(f.id==='enterf'){const d=Object.fromEntries(new FormData(f));enter(linkCode||d.code||'',d.name||'');return}
 if(f.id==='df'){const d=Object.fromEntries(new FormData(f));d.title=(d.title||'').trim();if(!d.title){toast('Give the task a name');return}
  d.blocked=!!d.blocked;d.blocker=d.blocked?(d.blocker||'').trim():'';
  if(await saveTask(editing,d)){closeDrawer();toast('Saved')}return}
 if(f.classList.contains('qa')){const v=f.t.value.trim();if(!v)return;const st=f.dataset.st;f.t.value='';
  await saveTask(null,{title:v,status:st,owner:st==='needs'?'David':myOwner(),area:area==='all'?'':area,priority:'',due:'',notes:''});return}
 if(f.id==='docf'){const d=Object.fromEntries(new FormData(f));const title=(d.title||'').trim();if(!title){toast('Give the doc a title');return}
  const n={};for(const [k] of NUMS){const v=d['n_'+k];if(v!==''&&v!=null)n[k]=Math.max(0,Number(v)||0)}
  if(await saveDoc(f.dataset.id,{title,type:d.type||'note',period:d.period||'',body:d.body||'',whatsapp:d.whatsapp||'',checks:d.checks||'',nums:JSON.stringify(n)})){docEditing=false;render();scrollTo(0,0);toast('Saved')}return}
 if(f.id==='fbf'){const d=docs.find(x=>x.id===docId);const v=(f.fb.value||'').trim();if(!d||!v){toast('Write a reply first');return}
  if(await write(()=>api('PATCH','/api/items/docs/'+encodeURIComponent(d.id),{feedback:v,feedbackAt:new Date().toISOString()})))toast('Sent. Dave will see it on the board.');return}
 if(f.id==='bdf'){const v=f.t.value.trim();if(!v)return;f.t.value='';await saveTask(null,{title:v,status:'braindump',owner:myOwner(),area:'',priority:'',due:'',notes:''})}});
let dragId=null;
document.addEventListener('dragstart',e=>{const c=e.target.closest&&e.target.closest('.card');if(!c)return;dragId=c.dataset.id;c.classList.add('dragging');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId)}catch{}});
document.addEventListener('dragend',e=>{const c=e.target.closest&&e.target.closest('.card');if(c)c.classList.remove('dragging');dragId=null;document.querySelectorAll('.col.over').forEach(x=>x.classList.remove('over'))});
document.addEventListener('dragover',e=>{const col=e.target.closest&&e.target.closest('.col');if(!col||!dragId)return;e.preventDefault();document.querySelectorAll('.col.over').forEach(x=>x!==col&&x.classList.remove('over'));col.classList.add('over')});
document.addEventListener('drop',async e=>{const col=e.target.closest&&e.target.closest('.col');if(!col||!dragId)return;e.preventDefault();col.classList.remove('over');
 const id=dragId,st=col.dataset.st;dragId=null;const t=tasks.find(x=>x.id===id);if(t&&t.status!==st)await saveTask(id,{status:st})});
document.addEventListener('toggle',e=>{if(e.target.id==='rtd')routineOpen=e.target.open},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me)refresh().catch(()=>{})});
// Scheduled tasks write straight to the database, so look for new drafts every couple of minutes.
setInterval(()=>{if(me&&!document.hidden)refresh().catch(()=>{})},120000);

const pick=()=>{let h=location.hash.slice(1);if(h==='table')mode='list';docId='';if(h.startsWith('docs/')){try{docId=decodeURIComponent(h.slice(5))}catch{docId=''}h='docs'}h=ALIAS[h]||h;return VIEWS.some(v=>v[0]===h)?h:'check-in'};
const route=()=>{const before=view+'/'+docId,v=pick(),moved=v+'/'+docId!==before;view=v;if(moved){docEditing=!!docId&&editNext===docId;editNext=''}render();if(moved)scrollTo(0,0)};
window.addEventListener('hashchange',route);
view=pick();
boot();
}
