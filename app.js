const { SUPABASE_URL, SUPABASE_ANON_KEY, SCENARIO_ID } = window.APP_CONFIG;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  scenario: null,
  tasks: [],
  people: [],
  budgets: [],
  timeAlloc: [],   // { person_id, task_id, pct }
  moneyAlloc: [],  // { budget_line_id, task_id, amount }
  showOnlyUncovered: false,
  playerName: ""
};

const el = (id) => document.getElementById(id);
const norm = (s) => String(s ?? "").trim().toLowerCase();

document.addEventListener("DOMContentLoaded", async () => {
  bindNav();
  bindPlayer();
  bindEditor();

  await loadScenario();
  await loadData();
  refreshAll();
});

function bindNav(){
  el("modeEditor").onclick = () => { show("editor"); };
  el("modePlayer").onclick = () => { show("player"); };
  el("modeDashboard").onclick = () => { window.location.href = "dashboard.html"; };
}

function show(which){
  if (which === "editor"){
    el("editorView").classList.remove("hidden");
    el("playerView").classList.add("hidden");
  } else {
    el("playerView").classList.remove("hidden");
    el("editorView").classList.add("hidden");
  }
}

function bindPlayer(){
  el("filterUncovered").onclick = () => {
    state.showOnlyUncovered = !state.showOnlyUncovered;
    el("filterUncovered").innerText = state.showOnlyUncovered
      ? "Vis alle oppgaver"
      : "Vis kun oppgaver uten dekning";
    renderTasks();
  };

  el("playerName").addEventListener("input", () => {
    state.playerName = el("playerName").value.trim();
    updateSubmitEnabled();
  });
  el("playerName").addEventListener("keydown", (e) => {
    if (e.key === "Enter"){
      state.playerName = el("playerName").value.trim();
      updateSubmitEnabled();
      window.scrollTo({ top: el("taskList").getBoundingClientRect().top + window.scrollY - 20, behavior:"smooth" });
    }
  });

  el("submitPlay").onclick = submitPlay;
}

function bindEditor(){
  el("btnImportCsv").onclick = importCsv;
  el("btnResetScenario").onclick = resetScenarioData;
}

async function loadScenario(){
  const { data, error } = await db.from("scenarios").select("*").eq("id", SCENARIO_ID).single();
  if (error) throw error;
  state.scenario = data;
  el("scenarioTitle").innerText = data?.title || "–";
  el("scenarioLock").innerText = data?.is_locked ? "Scenario er låst" : "Scenario er åpent";
}

async function loadData(){
  const [tasksRes, peopleRes, budgetsRes] = await Promise.all([
    db.from("tasks").select("*").eq("scenario_id", SCENARIO_ID).order("title", {ascending:true}),
    db.from("people").select("*").eq("scenario_id", SCENARIO_ID).order("name", {ascending:true}),
    db.from("budget_lines").select("*").eq("scenario_id", SCENARIO_ID).order("title", {ascending:true})
  ]);

  state.tasks = tasksRes.data || [];
  state.people = peopleRes.data || [];
  state.budgets = budgetsRes.data || [];
}

function refreshAll(){
  renderCapacityBars();
  renderCoverageMeter();
  renderTasks();
  updateSubmitEnabled();
}

function renderCapacityBars(){
  const totalCap = state.people.reduce((s,p)=>s+Number(p.capacity_pct||0),0);
  const usedCap = state.timeAlloc.reduce((s,a)=>s+Number(a.pct||0),0);
  const pct = totalCap ? Math.min(100, (usedCap/totalCap)*100) : 0;
  el("peopleCapacityBar").classList.toggle("over", usedCap > totalCap);
  el("peopleCapacityBar").querySelector("span").style.width = `${pct}%`;
  el("peopleCapacityText").innerText = `${usedCap}% brukt av ${totalCap}% tilgjengelig`;

  const flex = state.budgets.filter(b=>norm(b.type)==="handlingsrom");
  const totalBudget = flex.reduce((s,b)=>s+Number(b.amount_nok||0),0);
  const usedBudget = state.moneyAlloc.reduce((s,a)=>s+Number(a.amount||0),0);
  const bpct = totalBudget ? Math.min(100, (usedBudget/totalBudget)*100) : 0;
  el("budgetCapacityBar").classList.toggle("over", usedBudget > totalBudget);
  el("budgetCapacityBar").querySelector("span").style.width = `${bpct}%`;
  el("budgetCapacityText").innerText =
    `${usedBudget.toLocaleString("nb-NO")} kr brukt av ${totalBudget.toLocaleString("nb-NO")} kr handlingsrom`;
}

function taskStatus(taskId){
  const hasPeople = state.timeAlloc.some(a=>a.task_id===taskId && a.pct>0);
  const hasMoney = state.moneyAlloc.some(a=>a.task_id===taskId && a.amount>0);
  if (!hasPeople && !hasMoney) return "red";
  if (hasPeople && hasMoney) return "green";
  return "yellow";
}

function taskStatusText(taskId){
  const hasPeople = state.timeAlloc.some(a=>a.task_id===taskId && a.pct>0);
  const hasMoney = state.moneyAlloc.some(a=>a.task_id===taskId && a.amount>0);
  if (!hasPeople && !hasMoney) return "Ingen personell og ingen midler";
  if (!hasPeople) return "Ingen personell";
  if (!hasMoney) return "Ingen midler";
  return "Dekket";
}

function renderCoverageMeter(){
  const covered = state.tasks.filter(t=>taskStatus(t.id)==="green").length;
  el("coverageMeter").innerText = `${covered} / ${state.tasks.length} oppgaver dekket`;
}

function renderTasks(){
  const wrap = el("taskList");
  wrap.innerHTML = "";

  const flexBudgets = state.budgets.filter(b=>norm(b.type)==="handlingsrom");
  const statBudgets = state.budgets.filter(b=>norm(b.type)==="stat");

  state.tasks.forEach(task=>{
    const status = taskStatus(task.id);
    if (state.showOnlyUncovered && status !== "red") return;

    const card = document.createElement("div");
    card.className = `task ${status}`;

    // Header
    const header = document.createElement("div");
    header.className = "task-header";
    header.innerHTML = `
      <div>
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-status">${escapeHtml(taskStatusText(task.id))}</div>
        <div class="task-meta">
          ${task.program ? `<span class="pill">${escapeHtml(task.program)}</span>` : ""}
        </div>
      </div>
    `;
    card.appendChild(header);

    // People sliders (inline)
    const peopleDetails = document.createElement("details");
    const peopleSummary = document.createElement("summary");
    peopleSummary.textContent = "Personell (juster %)";
    peopleDetails.appendChild(peopleSummary);

    const peopleBox = document.createElement("div");
    peopleBox.className = "sliders";

    state.people.forEach(p=>{
      const current = getTimeAlloc(p.id, task.id);
      const row = document.createElement("div");
      row.className = "slider-row";

      const label = document.createElement("label");
      const left = document.createElement("span");
      const right = document.createElement("span");
      left.textContent = p.name;
      right.textContent = `${current}%`;
      label.appendChild(left); label.appendChild(right);

      const slider = document.createElement("input");
      slider.type="range"; slider.min="0"; slider.max="100"; slider.step="5"; slider.value=String(current);
      slider.addEventListener("input",(e)=>{
        const v = Number(e.target.value||0);
        right.textContent = `${v}%`;
        setTimeAlloc(p.id, task.id, v);
        refreshAll();
      });

      row.appendChild(label);
      row.appendChild(slider);
      peopleBox.appendChild(row);
    });

    peopleDetails.appendChild(peopleBox);
    card.appendChild(peopleDetails);

    // Budget sliders (inline, handlingsrom)
    const budgetDetails = document.createElement("details");
    const budgetSummary = document.createElement("summary");
    budgetSummary.textContent = "Budsjett (handlingsrom)";
    budgetDetails.appendChild(budgetSummary);

    const budgetBox = document.createElement("div");
    budgetBox.className = "sliders";

    if (!flexBudgets.length){
      const info = document.createElement("div");
      info.className = "muted";
      info.textContent = "Ingen budsjettlinjer av typen «handlingsrom» er registrert.";
      budgetBox.appendChild(info);
    } else {
      flexBudgets.forEach(b=>{
        const current = getMoneyAlloc(b.id, task.id);

        const row = document.createElement("div");
        row.className = "slider-row";

        const label = document.createElement("label");
        const left = document.createElement("span");
        const right = document.createElement("span");
        left.textContent = b.title;
        right.textContent = `${Number(current).toLocaleString("nb-NO")} kr`;
        label.appendChild(left); label.appendChild(right);

        const slider = document.createElement("input");
        slider.type="range"; slider.min="0";
        slider.max = String(Number(b.amount_nok||0));
        slider.step="100000";
        slider.value=String(current);

        slider.addEventListener("input",(e)=>{
          const v = Number(e.target.value||0);
          right.textContent = `${v.toLocaleString("nb-NO")} kr`;
          setMoneyAlloc(b.id, task.id, v);
          refreshAll();
        });

        row.appendChild(label);
        row.appendChild(slider);
        budgetBox.appendChild(row);
      });
    }

    // Locked stat (context only)
    if (statBudgets.length){
      const statInfo = document.createElement("div");
      statInfo.className = "muted";
      statInfo.style.marginTop = "8px";
      statInfo.textContent = "Statlige midler er låst (ikke spillbart).";
      budgetBox.appendChild(statInfo);
    }

    budgetDetails.appendChild(budgetBox);
    card.appendChild(budgetDetails);

    // Quick reset per task
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn danger";
    resetBtn.style.marginTop = "10px";
    resetBtn.textContent = "Nullstill denne oppgaven";
    resetBtn.onclick = () => {
      state.timeAlloc = state.timeAlloc.filter(a=>a.task_id!==task.id);
      state.moneyAlloc = state.moneyAlloc.filter(a=>a.task_id!==task.id);
      refreshAll();
    };
    card.appendChild(resetBtn);

    wrap.appendChild(card);
  });
}

function getTimeAlloc(personId, taskId){
  const f = state.timeAlloc.find(a=>a.person_id===personId && a.task_id===taskId);
  return f ? Number(f.pct||0) : 0;
}
function setTimeAlloc(personId, taskId, pct){
  state.timeAlloc = state.timeAlloc.filter(a=>!(a.person_id===personId && a.task_id===taskId));
  if (pct>0) state.timeAlloc.push({person_id:personId, task_id:taskId, pct});
}
function getMoneyAlloc(budgetId, taskId){
  const f = state.moneyAlloc.find(a=>a.budget_line_id===budgetId && a.task_id===taskId);
  return f ? Number(f.amount||0) : 0;
}
function setMoneyAlloc(budgetId, taskId, amount){
  state.moneyAlloc = state.moneyAlloc.filter(a=>!(a.budget_line_id===budgetId && a.task_id===taskId));
  if (amount>0) state.moneyAlloc.push({budget_line_id:budgetId, task_id:taskId, amount});
}

function updateSubmitEnabled(){
  const btn = el("submitPlay");
  const hint = el("submitHint");
  const hasName = !!state.playerName;
  const hasAny = state.timeAlloc.length>0 || state.moneyAlloc.length>0;

  btn.disabled = !(hasName && hasAny);
  btn.style.opacity = btn.disabled ? "0.55" : "1";
  btn.style.cursor = btn.disabled ? "not-allowed" : "pointer";

  if (!hasName) hint.textContent = "Skriv navnet ditt for å kunne sende inn.";
  else if (!hasAny) hint.textContent = "Gjør minst én prioritering (personell eller budsjett) før innsending.";
  else hint.textContent = "Klar til innsending.";
}

/* ---------------- Editor: CSV import + reset ---------------- */

async function importCsv(){
  const file = el("csvFile").files?.[0];
  if (!file) return msg("Velg en CSV-fil først.");

  const type = el("csvType").value;
  const text = await file.text();
  const rows = parseCsv(text);

  try{
    if (type==="people"){
      // name, capacity_pct
      const payload = rows.map(r=>({
        scenario_id: SCENARIO_ID,
        name: r.name,
        capacity_pct: Number(r.capacity_pct||0)
      })).filter(x=>x.name);

      const { error } = await db.from("people").insert(payload);
      if (error) throw error;
      msg(`Importerte ${payload.length} personer.`);
    }

    if (type==="tasks"){
      // title, program
      const payload = rows.map(r=>({
        scenario_id: SCENARIO_ID,
        title: r.title,
        program: r.program || null
      })).filter(x=>x.title);

      const { error } = await db.from("tasks").insert(payload);
      if (error) throw error;
      msg(`Importerte ${payload.length} oppgaver.`);
    }

    if (type==="budget_lines"){
      // title, type, amount_nok
      const payload = rows.map(r=>({
        scenario_id: SCENARIO_ID,
        title: r.title,
        type: norm(r.type) === "stat" ? "stat" : "handlingsrom",
        amount_nok: Number(r.amount_nok||0)
      })).filter(x=>x.title);

      const { error } = await db.from("budget_lines").insert(payload);
      if (error) throw error;
      msg(`Importerte ${payload.length} budsjettlinjer.`);
    }

    await loadData();
    refreshAll();
  } catch(e){
    msg(`Feil ved import: ${e.message || e}`);
  }
}

async function resetScenarioData(){
  if (!confirm("Er du sikker? Dette sletter innsendinger og logger (ikke oppgaver/personer/budsjett).")) return;
  try{
    const plays = await db.from("playthroughs").select("id").eq("scenario_id", SCENARIO_ID);
    const ids = (plays.data||[]).map(x=>x.id);
    if (ids.length){
      await db.from("time_allocations").delete().in("playthrough_id", ids);
      await db.from("budget_allocations").delete().in("playthrough_id", ids);
      await db.from("logs").delete().in("playthrough_id", ids);
      await db.from("playthroughs").delete().in("id", ids);
    }
    msg("Reset fullført.");
  } catch(e){
    msg(`Feil ved reset: ${e.message || e}`);
  }
}

function msg(t){ el("editorMsg").textContent = t; }

/* ---------------- CSV utils ---------------- */
function parseCsv(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(h=>h.trim());
  const out = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h,idx)=> obj[h]= (cols[idx] ?? "").trim());
    out.push(obj);
  }
  return out;
}
function splitCsvLine(line){
  const res=[]; let cur=""; let inQ=false;
  for (let i=0;i<line.length;i++){
    const ch=line[i];
    if (ch === '"' ){ inQ = !inQ; continue; }
    if (ch === "," && !inQ){ res.push(cur); cur=""; continue; }
    cur += ch;
  }
  res.push(cur);
  return res;
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}
