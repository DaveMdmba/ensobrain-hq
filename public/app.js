// David x Dave HQ front end. Talks to the server's JSON API and listens on
// /api/events so every open page redraws as soon as anyone changes something.
{
const $=s=>document.querySelector(s);
// All data values are text, never markup.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ST=[['todo','To do'],['doing','In progress'],['needs','Needs David'],['done','Done']];
const AREAS=['Instagram','Funnel & NOVA','Sales calls','Help Bank','Admin','Strategy'];
const PRI=['High','Medium','Low'];
const VIEWS=[['board','Board'],['table','Table'],['brain-dump','Brain dump'],['leads','Leads'],['numbers','Weekly numbers'],['routine','Routine']];
const today=()=>new Date().toLocaleDateString('en-CA');
const monday=d=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()-((x.getDay()+6)%7));return x.toLocaleDateString('en-CA')};
const addDays=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return x.toLocaleDateString('en-CA')};
const fmt=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'';
let me=null,ready=false,pending=false,tasks=[],weeks=[],routine=[],leads=[];
let view='board',q='',own='all',area='all',sortK='due',sortD=1,editing=null,confirmDel=false;

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
  me=s.me;tasks=s.tasks;weeks=s.weeks;routine=s.routine;leads=s.leads||[];ready=true;$('#me').textContent=me.name;render();
  if(editing&&!tasks.some(t=>t.id===editing))closeDrawer();return true}
 catch(e){if(e.status===401){showAuth();return false}throw e}}
// Runs one change, then reloads the board. Returns true when it saved.
async function write(fn){
 try{await fn();await refresh();return true}
 catch(e){if(e.status===401)showAuth();else if(e.status===404||e.status===400){toast(e.message);refresh().catch(()=>{})}else toast('Couldn’t save. Check your connection and try again.');return false}}
const saveTask=(id,data)=>write(()=>{const now=new Date().toISOString();data.updated=now;
 if('status'in data){if(data.status==='done'){const old=tasks.find(t=>t.id===id);if(!old||old.status!=='done')data.doneAt=today()}else data.doneAt=''}
 if(id)return api('PATCH','/api/items/tasks/'+encodeURIComponent(id),data);
 data.created=now;return api('POST','/api/items/tasks',data)});
const myOwner=()=>/^david/i.test(me?.name||'')?'David':'Dave';

// ---- views ----
const overdue=t=>t.due&&t.status!=='done'&&t.status!=='braindump'&&t.due<today();
const work=()=>tasks.filter(t=>t.status!=='braindump');
const visible=()=>work().filter(t=>(own==='all'||t.owner===own)&&(area==='all'||t.area===area)&&(!q||((t.title||'')+' '+(t.notes||'')).toLowerCase().includes(q)));
const byDue=a=>a.slice().sort((x,y)=>(x.due||'9999').localeCompare(y.due||'9999')||(x.created||'').localeCompare(y.created||''));
const dueHtml=t=>t.due?`<span class="due${overdue(t)?' late':''}">${overdue(t)?'Overdue · ':'Due '}${esc(fmt(t.due))}</span>`:'';
const who=o=>o?`<span class="who ${o==='David'?'dv':'dk'}">${esc(o)}</span>`:'';
const card=t=>`<article class="card" draggable="true" data-id="${esc(t.id)}" tabindex="0" aria-label="${esc(t.title)}"><h3>${esc(t.title)}</h3><div class="meta">${t.area?`<span class="tag">${esc(t.area)}</span>`:''}${t.priority==='High'?'<span class="tag hi">High</span>':''}${dueHtml(t)}${who(t.owner)}</div></article>`;

function kpis(){const w=work(),wk=monday(today()),cur=weeks.find(x=>x.week===wk)||{};
 const nd=w.filter(t=>t.status==='needs').length,od=w.filter(overdue).length;
 const pair=(a,b)=>(a===''||a==null?'–':a)+(b?` / ${b}`:'');
 const k=[['Needs David',nd,nd?'alert':'','needs'],['In progress',w.filter(t=>t.status==='doing').length,'','doing'],['Overdue',od,od?'alert':'','late'],['Done this week',w.filter(t=>t.status==='done'&&t.doneAt>=wk).length,'',''],['DMs this week',pair(cur.dms,cur.dmTarget),'','dms'],['Calls booked',pair(cur.calls,cur.callsTarget),'','dms']];
 $('#kpis').innerHTML=k.map(([l,v,c,go])=>`<button class="kpi ${c}" data-go="${go}"><b>${esc(v)}</b><span>${l}</span></button>`).join('')}
function tabs(){const bd=tasks.filter(t=>t.status==='braindump').length;
 $('#tabs').innerHTML=VIEWS.map(([k,l])=>`<a class="tab${view===k?' on':''}" href="#${k}">${l}${k==='brain-dump'&&bd?`<em>${bd}</em>`:''}</a>`).join('')}
function toolbar(){return `<div class="tool"><input type="search" id="q" placeholder="Search tasks and notes" value="${esc(q)}" aria-label="Search">
<div class="seg" role="group" aria-label="Owner">${['all','Dave','David'].map(o=>`<button data-own="${o}" class="${own===o?'on':''}">${o==='all'?'Everyone':o}</button>`).join('')}</div>
<select id="area" aria-label="Area"><option value="all">All areas</option>${AREAS.map(a=>`<option${area===a?' selected':''}>${esc(a)}</option>`).join('')}</select>
<button class="btn" data-new="todo">+ New task</button></div>`}
function board(){const v=visible();return `<div class="board">${ST.map(([k,l])=>{let items=byDue(v.filter(t=>t.status===k));if(k==='done')items=items.sort((a,b)=>(b.doneAt||'').localeCompare(a.doneAt||''));
 return `<section class="col" data-st="${k}"><header class="ch"><i class="dot ${k}"></i><h2>${l}</h2><span class="n">${items.length}</span></header><div class="list">${items.map(card).join('')||'<p class="empty">Nothing here</p>'}</div><form class="qa" data-st="${k}"><input name="t" placeholder="+ Add to ${l}" aria-label="Add a task to ${l}" autocomplete="off" maxlength="300"></form></section>`}).join('')}</div>`}
const COLS=[['title','Task'],['status','Status'],['owner','Owner'],['area','Area'],['priority','Priority'],['due','Due']];
const key=(t,k)=>k==='status'?ST.findIndex(s=>s[0]===t.status):k==='priority'?(t.priority?PRI.indexOf(t.priority):9):(t[k]||'~').toString().toLowerCase();
function table(){const v=visible().sort((a,b)=>{const x=key(a,sortK),y=key(b,sortK);return (x<y?-1:x>y?1:0)*sortD});
 return `<table class="stack"><thead><tr>${COLS.map(([k,l])=>`<th><button data-sort="${k}">${l}${sortK===k?(sortD>0?' ↑':' ↓'):''}</button></th>`).join('')}</tr></thead><tbody>${v.map(t=>`<tr data-id="${esc(t.id)}"><td><strong>${esc(t.title)}</strong></td><td><select class="s-${esc(t.status)}" data-st-id="${esc(t.id)}" aria-label="Status">${ST.map(([k,l])=>`<option value="${k}"${t.status===k?' selected':''}>${l}</option>`).join('')}</select></td><td>${who(t.owner)}</td><td>${esc(t.area)}</td><td>${esc(t.priority)}</td><td>${dueHtml(t)}</td></tr>`).join('')||`<tr><td colspan="6" class="empty">No tasks match.</td></tr>`}</tbody></table>`}
function brain(){const v=tasks.filter(t=>t.status==='braindump').sort((a,b)=>(b.created||'').localeCompare(a.created||''));
 return `<div class="bd"><form class="bdf" id="bdf"><input name="t" placeholder="Dump an idea. It stays here until we decide it’s a priority." aria-label="New idea" autocomplete="off" maxlength="300"><button class="btn">Add</button></form>
 <ul class="bdl">${v.map(t=>`<li data-id="${esc(t.id)}"><div><strong>${esc(t.title)}</strong><span class="sub">${esc(t.owner||'')}${t.created?' · added '+esc(fmt(t.created.slice(0,10))):''}</span>${t.notes?`<p>${esc(t.notes)}</p>`:''}</div><div class="act"><button class="btn" data-promote="${esc(t.id)}">Make it a task</button><button class="btn ghost" data-open="${esc(t.id)}">Open</button></div></li>`).join('')||'<li class="empty">No ideas parked. Add one above.</li>'}</ul></div>`}
function bars(label,f,tf){const w=weeks.slice().sort((a,b)=>a.week.localeCompare(b.week)).slice(-8);
 const max=Math.max(1,...w.map(x=>Math.max(+x[f]||0,+x[tf]||0)));
 return `<div class="panel"><h2>${label}</h2>${w.map(x=>{const v=+x[f]||0,t=+x[tf]||0;return `<div class="row"><span>${esc(fmt(x.week))}</span><div class="bar"><div class="fill" style="width:${(v/max*100).toFixed(1)}%"></div>${t?`<i class="tgt" style="left:calc(${(t/max*100).toFixed(1)}% - 1.5px)" title="Target ${t}"></i>`:''}</div><span class="v">${x[f]===''||x[f]==null?'–':esc(v)}${t?' / '+esc(t):''}</span></div>`}).join('')||'<p class="empty">No weeks yet.</p>'}<p class="sub">Pink mark = target.</p></div>`}
function numbers(){const w=weeks.slice().sort((a,b)=>a.week.localeCompare(b.week));const F=[['dms','DM conversations'],['dmTarget','DM target'],['calls','Calls booked'],['callsTarget','Calls target']];
 return `<div class="grid2">${bars('DM conversations per week','dms','dmTarget')}${bars('Sales calls booked per week','calls','callsTarget')}</div>
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
function routineV(){const t=today();return `<ul class="rt">${routine.slice().sort((a,b)=>(a.order||0)-(b.order||0)).map(r=>{const d=r.lastDone===t;return `<li class="${d?'ok':''}"><div><strong>${esc(r.name)}</strong> <span class="sub">· ${esc(r.freq)}</span></div><p>${esc(r.covers)}</p><span class="sub">${r.lastDone?'Last done '+esc(fmt(r.lastDone)):'Not logged yet'}</span><button class="btn${d?' ghost':''}" data-rid="${esc(r.id)}">${d?'Done today ✓ (undo)':'Mark done today'}</button></li>`}).join('')||'<li class="empty">No routine items yet.</li>'}</ul>`}

function render(){if(!ready)return;kpis();tabs();
 // Don't redraw under someone who is typing; redraw when they leave the field.
 const a=document.activeElement,inMain=a&&$('#main').contains(a);
 const quick=inMain&&a.matches('.qa input,#bdf input')&&!a.value?(a.closest('form').dataset.st||'bdf'):null;
 if(inMain&&!quick&&a.matches('input:not([type=search]),textarea')){pending=true;return}pending=false;
 const hadQ=a&&a.id==='q',pos=hadQ?a.selectionStart:0;
 let h='';
 if(view==='board')h=toolbar()+board();else if(view==='table')h=toolbar()+table();else if(view==='brain-dump')h=brain();else if(view==='leads')h=leadsV();else if(view==='numbers')h=numbers();else h=routineV();
 $('#main').innerHTML=h;if(hadQ){const i=$('#q');if(i){i.focus();i.setSelectionRange(pos,pos)}}
 if(quick){const i=quick==='bdf'?$('#bdf input'):$(`.qa[data-st="${quick}"] input`);if(i)i.focus()}}

function openDrawer(id,preset){const t=id?tasks.find(x=>x.id===id):{title:'',status:preset||'todo',owner:preset==='needs'?'David':myOwner(),area:'',priority:'',due:'',notes:''};if(!t)return;
 editing=id||null;confirmDel=false;const opt=(arr,v)=>arr.map(o=>`<option value="${esc(o[0])}"${v===o[0]?' selected':''}>${esc(o[1])}</option>`).join('');
 $('#dr').innerHTML=`<form id="df"><h2>${id?'Task details':'New task'}</h2>
 <label class="fld"><span>Task</span><textarea class="t" name="title" maxlength="300" required>${esc(t.title)}</textarea></label>
 <div class="f2"><label class="fld"><span>Status</span><select name="status">${opt([...ST,['braindump','Brain dump']],t.status)}</select></label>
 <label class="fld"><span>Owner</span><select name="owner">${opt([['Dave','Dave'],['David','David']],t.owner)}</select></label>
 <label class="fld"><span>Area</span><select name="area">${opt([['',''],...AREAS.map(a=>[a,a])],t.area||'')}</select></label>
 <label class="fld"><span>Priority</span><select name="priority">${opt([['',''],...PRI.map(p=>[p,p])],t.priority||'')}</select></label>
 <label class="fld"><span>Due</span><input type="date" name="due" value="${esc(t.due||'')}"></label></div>
 <label class="fld"><span>Notes</span><textarea name="notes" rows="5" maxlength="3000">${esc(t.notes||'')}</textarea></label>
 ${t.updated?`<p class="sub">Last updated ${esc(new Date(t.updated).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</p>`:''}
 <div class="drb"><button class="btn">Save</button><button type="button" class="btn ghost" data-close>Close</button><span class="sp"></span>${id?'<button type="button" class="btn ghost" id="del">Delete</button>':''}</div></form>`;
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
 if(el.id==='signout'){try{await api('POST','/api/logout')}catch{}showAuth();return}
 const kp=el.closest('.kpi');if(kp){const g=kp.dataset.go;if(g==='dms')location.hash='numbers';else if(g==='needs'||g==='doing'){own='all';area='all';q='';if(location.hash==='#board'||!location.hash)render();location.hash='board'}else if(g==='late'){sortK='due';sortD=1;if(location.hash==='#table')render();location.hash='table'}return}
 if(el.closest('[data-close]')||el.id==='ov'){closeDrawer();return}
 if(el.id==='del'){if(!confirmDel){confirmDel=true;el.textContent='Confirm delete';el.className='btn warn';return}
  const id=editing;if(await write(()=>api('DELETE','/api/items/tasks/'+encodeURIComponent(id)))){closeDrawer();toast('Task deleted')}return}
 const o=el.closest('[data-own]');if(o){own=o.dataset.own;render();return}
 const nw=el.closest('[data-new]');if(nw){openDrawer(null,nw.dataset.new);return}
 const s=el.closest('[data-sort]');if(s){const k=s.dataset.sort;if(sortK===k)sortD*=-1;else{sortK=k;sortD=1}render();return}
 const pr=el.closest('[data-promote]');if(pr){if(await saveTask(pr.dataset.promote,{status:'todo'}))toast('Moved to To do on the board');return}
 const op=el.closest('[data-open]');if(op){openDrawer(op.dataset.open);return}
 const rb=el.closest('[data-rid]');if(rb){const r=routine.find(x=>x.id===rb.dataset.rid);if(!r)return;const t=today();
  const data=r.lastDone===t?{lastDone:r.prevDone||''}:{lastDone:t,prevDone:r.lastDone||''};await write(()=>api('PATCH','/api/items/routine/'+encodeURIComponent(r.id),data));return}
 if(el.id==='addwk'){const last=weeks.map(w=>w.week).sort().pop()||monday(today());const nx=weeks.length?addDays(last,7):last;
  await write(()=>api('PUT','/api/items/weeks/w'+nx,{week:nx,dms:'',dmTarget:'',calls:'',callsTarget:'',notes:''}));return}
 if(el.closest('select')||el.closest('input'))return;
 const c=el.closest('.card,tbody tr[data-id]');if(c){openDrawer(c.dataset.id)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#shell').classList.contains('open'))closeDrawer();
 if(e.key==='Enter'&&e.target.matches('.card'))openDrawer(e.target.dataset.id)});
document.addEventListener('input',e=>{if(e.target.id==='q'){q=e.target.value.trim().toLowerCase();render()}});
document.addEventListener('change',async e=>{const el=e.target;
 if(el.id==='area'){area=el.value;render();return}
 if(el.dataset.stId){el.className='s-'+el.value;await saveTask(el.dataset.stId,{status:el.value});return}
 if(el.dataset.wid){const f=el.dataset.f,v=f==='notes'?el.value:(el.value===''?'':Math.max(0,Number(el.value)||0));await write(()=>api('PATCH','/api/items/weeks/'+encodeURIComponent(el.dataset.wid),{[f]:v}))}});
document.addEventListener('focusout',()=>setTimeout(()=>{if(pending&&!$('#main').contains(document.activeElement))render()},0));
document.addEventListener('submit',async e=>{e.preventDefault();const f=e.target;
 if(f.id==='enterf'){const d=Object.fromEntries(new FormData(f));enter(linkCode||d.code||'',d.name||'');return}
 if(f.id==='df'){const d=Object.fromEntries(new FormData(f));d.title=(d.title||'').trim();if(!d.title){toast('Give the task a name');return}
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
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me)refresh().catch(()=>{})});

const route=()=>{const h=location.hash.slice(1);view=VIEWS.some(v=>v[0]===h)?h:'board';render()};
window.addEventListener('hashchange',route);
{const h=location.hash.slice(1);if(VIEWS.some(v=>v[0]===h))view=h}
boot();
}
