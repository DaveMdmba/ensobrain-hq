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
const VIEWS=[['check-in','Check-in'],['board','Board'],['numbers','Numbers'],['brain-dump','Brain dump']];
// Older links still work: the list, leads and routine screens now live inside these four.
const ALIAS={table:'board',leads:'numbers',routine:'check-in'};
const today=()=>new Date().toLocaleDateString('en-CA');
const monday=d=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()-((x.getDay()+6)%7));return x.toLocaleDateString('en-CA')};
const addDays=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return x.toLocaleDateString('en-CA')};
const fmt=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'';
const fmtLong=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}):'';
let me=null,ready=false,pending=false,tasks=[],weeks=[],routine=[],leads=[],meta=[],log=[];
let view='check-in',q='',own='all',area='all',sortK='due',sortD=1,editing=null,showOldDone=false;
let routineOpen=false,showLog=false;
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
  me=s.me;tasks=s.tasks;weeks=s.weeks;routine=s.routine;leads=s.leads||[];meta=s.meta||[];log=s.log||[];ready=true;$('#me').textContent=me.name;render();
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
const who=o=>o?`<span class="who ${o==='David'?'dv':'dk'}">${esc(o)}</span>`:'';
const card=t=>`<article class="card" draggable="true" data-id="${esc(t.id)}" tabindex="0" aria-label="${esc(t.title)}"><h3>${esc(t.title)}</h3><div class="meta">${t.blocked?'<span class="tag blk">Blocked</span>':''}${t.area?`<span class="tag">${esc(t.area)}</span>`:''}${t.priority==='High'?'<span class="tag hi">High</span>':''}${dueHtml(t)}${who(t.owner)}</div><select class="mv" data-mv-id="${esc(t.id)}" aria-label="Move to another column"><option value="" selected disabled>Move to…</option>${ST.filter(x=>x[0]!==t.status).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></article>`;

function kpis(){$('#kpis').hidden=view!=='board';if(view!=='board')return;const w=work(),wk=monday(today());
 const nd=w.filter(t=>t.status==='needs').length,od=w.filter(overdue).length,nb=w.filter(t=>t.blocked&&t.status!=='done').length;
 const k=[['Needs David',nd,nd?'alert':'','needs'],['Blocked',nb,nb?'alertr':'','blocked'],['Overdue',od,od?'alertr':'','late'],['Done this week',w.filter(t=>t.status==='done'&&t.doneAt>=wk).length,'','']];
 $('#kpis').innerHTML=k.map(([l,v,c,go])=>`<button class="kpi ${c}" data-go="${go}"><b>${esc(v)}</b><span>${l}</span></button>`).join('')}
function tabs(){const bd=ideas().length;
 $('#tabs').innerHTML=VIEWS.map(([k,l])=>`<a class="tab${view===k?' on':''}" href="#${k}">${l}${k==='brain-dump'&&bd?`<em>${bd}</em>`:''}</a>`).join('')}
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
 return `<table class="stack"><thead><tr>${COLS.map(([k,l])=>`<th><button data-sort="${k}">${l}${sortK===k?(sortD>0?' ↑':' ↓'):''}</button></th>`).join('')}</tr></thead><tbody>${v.map(t=>`<tr data-id="${esc(t.id)}"><td><strong>${esc(t.title)}</strong>${t.blocked?' <span class="tag blk">Blocked</span>':''}</td><td><select class="s-${esc(t.status)}" data-st-id="${esc(t.id)}" aria-label="Status">${ST.map(([k,l])=>`<option value="${k}"${t.status===k?' selected':''}>${l}</option>`).join('')}</select></td><td>${who(t.owner)}</td><td>${esc(t.area)}</td><td>${esc(t.priority)}</td><td>${dueHtml(t)}</td></tr>`).join('')||`<tr><td colspan="6" class="empty">No tasks match.</td></tr>`}</tbody></table>${archived()}`}
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
 <div class="panel cihead"><p>${ci.last?'Last check-in: '+esc(fmtDT(ci.last))+'.':'No check-in saved yet, so Wins shows the last 7 days.'}${undo?' <button class="link" id="ciundo">Undo</button>':''}</p><button class="btn" id="cidone">Finish check-in</button></div>
 ${routineBox()}</div>`}
// Dave's own routine, folded away so it doesn't crowd the call.
function routineBox(){const t=today(),r=routine.slice().sort((a,b)=>(a.order||0)-(b.order||0));if(!r.length)return '';
 return `<details class="panel rtd" id="rtd"${routineOpen?' open':''}><summary><h2>Dave’s routine checks</h2><span class="n">${r.filter(x=>x.lastDone===t).length} of ${r.length} done today</span></summary><ul class="rm">${r.map(x=>{const d=x.lastDone===t;return `<li><button class="rc${d?' on':''}" data-rid="${esc(x.id)}" aria-pressed="${d}"><i></i><span><strong>${esc(x.name)}</strong><small>${esc(x.freq)}${x.lastDone?' · last done '+esc(fmt(x.lastDone)):''}</small></span></button></li>`}).join('')}</ul></details>`}

function render(){if(!ready)return;kpis();tabs();
 // Don't redraw under someone who is typing; redraw when they leave the field.
 const a=document.activeElement,inMain=a&&$('#main').contains(a);
 const quick=inMain&&a.matches('.qa input,#bdf input')&&!a.value?(a.closest('form').dataset.st||'bdf'):null;
 if(inMain&&!quick&&a.matches('input:not([type=search]),textarea')){pending=true;return}pending=false;
 const hadQ=a&&a.id==='q',pos=hadQ?a.selectionStart:0;
 let h='';
 if(view==='check-in')h=checkinV();else if(view==='board')h=toolbar()+(mode==='list'?table():board());else if(view==='numbers')h=`${numbers()}<div class="lsec">${leadsV()}</div>`;else h=brain();
 $('#main').innerHTML=h;if(hadQ){const i=$('#q');if(i){i.focus();i.setSelectionRange(pos,pos)}}
 if(quick){const i=quick==='bdf'?$('#bdf input'):$(`.qa[data-st="${quick}"] input`);if(i)i.focus()}}

function openDrawer(id,preset){const t=id?tasks.find(x=>x.id===id):{title:'',status:preset||'todo',owner:preset==='needs'?'David':myOwner(),area:'',priority:'',due:'',notes:''};if(!t)return;
 editing=id||null;const opt=(arr,v)=>arr.map(o=>`<option value="${esc(o[0])}"${v===o[0]?' selected':''}>${esc(o[1])}</option>`).join('');
 $('#dr').innerHTML=`<form id="df"><h2>${id?'Task details':'New task'}</h2>
 <label class="fld"><span>Task</span><textarea class="t" name="title" maxlength="300" required>${esc(t.title)}</textarea></label>
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
 if(f.id==='bdf'){const v=f.t.value.trim();if(!v)return;f.t.value='';await saveTask(null,{title:v,status:'braindump',owner:myOwner(),area:'',priority:'',due:'',notes:''})}});
let dragId=null;
document.addEventListener('dragstart',e=>{const c=e.target.closest&&e.target.closest('.card');if(!c)return;dragId=c.dataset.id;c.classList.add('dragging');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId)}catch{}});
document.addEventListener('dragend',e=>{const c=e.target.closest&&e.target.closest('.card');if(c)c.classList.remove('dragging');dragId=null;document.querySelectorAll('.col.over').forEach(x=>x.classList.remove('over'))});
document.addEventListener('dragover',e=>{const col=e.target.closest&&e.target.closest('.col');if(!col||!dragId)return;e.preventDefault();document.querySelectorAll('.col.over').forEach(x=>x!==col&&x.classList.remove('over'));col.classList.add('over')});
document.addEventListener('drop',async e=>{const col=e.target.closest&&e.target.closest('.col');if(!col||!dragId)return;e.preventDefault();col.classList.remove('over');
 const id=dragId,st=col.dataset.st;dragId=null;const t=tasks.find(x=>x.id===id);if(t&&t.status!==st)await saveTask(id,{status:st})});
document.addEventListener('toggle',e=>{if(e.target.id==='rtd')routineOpen=e.target.open},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me)refresh().catch(()=>{})});

const pick=()=>{let h=location.hash.slice(1);if(h==='table')mode='list';h=ALIAS[h]||h;return VIEWS.some(v=>v[0]===h)?h:'check-in'};
const route=()=>{const v=pick(),moved=v!==view;view=v;render();if(moved)scrollTo(0,0)};
window.addEventListener('hashchange',route);
view=pick();
boot();
}
