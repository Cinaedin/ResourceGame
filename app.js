/* ===============================
   Prioriteringsøvelse – app.js
   (FULL ERSTATNING – FIX: sliders live)
   =============================== */

const { SUPABASE_URL, SUPABASE_ANON_KEY, SCENARIO_ID } = window.APP_CONFIG;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  scenario: null,
  tasks: [],
  people: [],
  budgets: [],
  timeAlloc: [],     // { person_id, task_id, pct }
  moneyAlloc: [],    // { budget_line_id, task_id, amount }
  currentTask: null,
  showOnlyUncovered: false
};

document.addEventListener("DOMContentLoaded", async () => {
  bindGlobalButtons();
  await loadScenario();
  await loadData();
  refreshMainUI();
});

function el(id) { return document.getElementById(id); }

/* -------------------------------
   Bindings
--------------------------------*/
function bindGlobalButtons() {
  el("filterUncovered").onclick = () => {
    state.showOnlyUncovered = !state.showOnlyUncovered;
    el("filterUncovered").innerText =
      state.showOnlyUncovered ? "Vis alle oppgaver" : "Vis kun oppgaver uten dekning";
    renderTasks();
  };

  el("closeTaskPanel").onclick = () => closeTaskPanel();
  el("resetTask").onclick = () => resetCurrentTask();
  el("submitPlay").onclick = () => submitPlay();
}

function closeTaskPanel() {
  el("taskPanel").classList.add("hidden");
  state.currentTask = null;
  el("taskPanelContent").innerHTML = "";
}

/* -------------------------------
   Load
--------------------------------*/
async function loadScenario() {
  const { data, error } = await db
    .from("scenarios")
    .select("*")
    .eq("id", SCENARIO_ID)
    .single();

  if (error) throw error;

  state.scenario = data;
  el("scenarioTitle").innerText = data?.title || "–";
  el("scenarioLock").innerText = data?.is_locked ? "Scenario er låst" : "Scenario er åpent";
}

async function loadData() {
  const [tasksRes, peopleRes, budgetsRes] = await Promise.all([
    db.from("tasks").select("*").eq("scenario_id", SCENARIO_ID),
    db.from("people").select("*").eq("scenario_id", SCENARIO_ID),
    db.from("budget_lines").select("*").eq("scenario_id", SCENARIO_ID)
  ]);

  state.tasks = tasksRes.data || [];
  state.people = peopleRes.data || [];
  state.budgets = budgetsRes.data || [];
}

/* -------------------------------
   Main UI refresh (everything except panel)
--------------------------------*/
function refreshMainUI() {
  renderCapacityBars();
  renderCoverageMeter();
  renderTasks();
}

/* -------------------------------
   Capacity bars
--------------------------------*/
function renderCapacityBars() {
  // People: total available capacity
  const totalCap = state.people.reduce((s, p) => s + Number(p.capacity_pct || 0), 0);
  const usedCap = state.timeAlloc.reduce((s, a) => s + Number(a.pct || 0), 0);

  const pBar = el("peopleCapacityBar");
  const pSpan = pBar.querySelector("span");
  const pPct = totalCap ? Math.min(100, (usedCap / totalCap) * 100) : 0;
  pSpan.style.width = `${pPct}%`;
  pBar.classList.toggle("over", usedCap > totalCap);

  el("peopleCapacityText").innerText = `${usedCap}% brukt av ${totalCap}% tilgjengelig`;

  // Budget: handlingsrom only
  const flexBudgets = state.budgets.filter(b => (b.type || "").toLowerCase() === "handlingsrom");
  const totalBudget = flexBudgets.reduce((s, b) => s + Number(b.amount_nok || 0), 0);
  const usedBudget = state.moneyAlloc.reduce((s, a) => s + Number(a.amount || 0), 0);

  const bBar = el("budgetCapacityBar");
  const bSpan = bBar.querySelector("span");
  const bPct = totalBudget ? Math.min(100, (usedBudget / totalBudget) * 100) : 0;
  bSpan.style.width = `${bPct}%`;
  bBar.classList.toggle("over", usedBudget > totalBudget);

  el("budgetCapacityText").innerText =
    `${usedBudget.toLocaleString("nb-NO")} kr brukt av ${totalBudget.toLocaleString("nb-NO")} kr handlingsrom`;
}

/* -------------------------------
   Coverage meter
--------------------------------*/
function renderCoverageMeter() {
  const covered = state.tasks.filter(t => taskStatus(t.id) === "green").length;
  el("coverageMeter").innerText = `${covered} / ${state.tasks.length} oppgaver dekket`;
}

/* -------------------------------
   Task list
--------------------------------*/
function renderTasks() {
  const wrap = el("taskList");
  wrap.innerHTML = "";

  state.tasks.forEach(task => {
    const status = taskStatus(task.id);
    if (state.showOnlyUncovered && status === "green") return;

    const card = document.createElement("div");
    card.className = `task ${status}`;
    card.onclick = () => openTaskPanel(task);

    card.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-status">${escapeHtml(taskStatusText(task.id))}</div>
    `;
    wrap.appendChild(card);
  });
}

/* -------------------------------
   Task status helpers
--------------------------------*/
function taskStatus(taskId) {
  const hasPeople = state.timeAlloc.some(a => a.task_id === taskId);
  const hasMoney = state.moneyAlloc.some(a => a.task_id === taskId);
  if (!hasPeople && !hasMoney) return "red";
  if (hasPeople && hasMoney) return "green";
  return "yellow";
}

function taskStatusText(taskId) {
  const hasPeople = state.timeAlloc.some(a => a.task_id === taskId);
  const hasMoney = state.moneyAlloc.some(a => a.task_id === taskId);

  if (!hasPeople && !hasMoney) return "Ingen personell og ingen midler";
  if (!hasPeople) return "Ingen personell";
  if (!hasMoney) return "Ingen midler";
  return "Dekket";
}

/* -------------------------------
   Task panel (sliders)
--------------------------------*/
function openTaskPanel(task) {
  state.currentTask = task;
  el("taskPanel").classList.remove("hidden");
  el("taskPanelTitle").innerText = task.title;

  const wrap = el("taskPanelContent");
  wrap.innerHTML = "";

  // --- PEOPLE ---
  wrap.appendChild(sectionTitle("Personell"));

  state.people.forEach(p => {
    const current = getTimeAlloc(p.id, task.id);

    const row = document.createElement("div");
    row.className = "slider-row";

    const label = document.createElement("label");
    const left = document.createElement("span");
    const right = document.createElement("span");
    left.textContent = p.name;
    right.textContent = `${current}%`;
    label.appendChild(left);
    label.appendChild(right);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "5";
    slider.value = String(current);

    slider.addEventListener("input", (e) => {
      const v = Number(e.target.value || 0);
      right.textContent = `${v}%`;
      setTimeAlloc(p.id, task.id, v);
      refreshMainUI(); // update bars + task colors + meter
    });

    row.appendChild(label);
    row.appendChild(slider);
    wrap.appendChild(row);
  });

  // --- BUDGET (HANDLINGSROM) ---
  wrap.appendChild(sectionTitle("Budsjett (handlingsrom)"));

  state.budgets
    .filter(b => (b.type || "").toLowerCase() === "handlingsrom")
    .forEach(b => {
      const current = getMoneyAlloc(b.id, task.id);

      const row = document.createElement("div");
      row.className = "slider-row";

      const label = document.createElement("label");
      const left = document.createElement("span");
      const right = document.createElement("span");
      left.textContent = b.title;
      right.textContent = `${Number(current).toLocaleString("nb-NO")} kr`;
      label.appendChild(left);
      label.appendChild(right);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = String(Number(b.amount_nok || 0));
      slider.step = "100000";
      slider.value = String(current);

      slider.addEventListener("input", (e) => {
        const v = Number(e.target.value || 0);
        right.textContent = `${v.toLocaleString("nb-NO")} kr`;
        setMoneyAlloc(b.id, task.id, v);
        refreshMainUI();
      });

      row.appendChild(label);
      row.appendChild(slider);
      wrap.appendChild(row);
    });

  // --- LOCKED (STAT) CONTEXT (read-only) ---
  const statBudgets = state.budgets.filter(b => (b.type || "").toLowerCase() === "stat");
  if (statBudgets.length) {
    wrap.appendChild(sectionTitle("Statlige midler (låst)"));
    const info = document.createElement("div");
    info.className = "muted";
    info.textContent = "Statlige midler er ikke spillbare i øvelsen (fastlagt ramme).";
    wrap.appendChild(info);

    const ul = document.createElement("ul");
    ul.style.marginTop = "8px";
    statBudgets.forEach(b => {
      const li = document.createElement("li");
      li.textContent = `${b.title} – ${Number(b.amount_nok || 0).toLocaleString("nb-NO")} kr`;
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
  }
}

function sectionTitle(text) {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

/* -------------------------------
   Allocation getters/setters
--------------------------------*/
function getTimeAlloc(personId, taskId) {
  const found = state.timeAlloc.find(a => a.person_id === personId && a.task_id === taskId);
  return found ? Number(found.pct || 0) : 0;
}

function setTimeAlloc(personId, taskId, pct) {
  state.timeAlloc = state.timeAlloc.filter(a => !(a.person_id === personId && a.task_id === taskId));
  if (pct > 0) state.timeAlloc.push({ person_id: personId, task_id: taskId, pct });
}

function getMoneyAlloc(budgetId, taskId) {
  const found = state.moneyAlloc.find(a => a.budget_line_id === budgetId && a.task_id === taskId);
  return found ? Number(found.amount || 0) : 0;
}

function setMoneyAlloc(budgetId, taskId, amount) {
  state.moneyAlloc = state.moneyAlloc.filter(a => !(a.budget_line_id === budgetId && a.task_id === taskId));
  if (amount > 0) state.moneyAlloc.push({ budget_line_id: budgetId, task_id: taskId, amount });
}

/* -------------------------------
   Reset current task
--------------------------------*/
function resetCurrentTask() {
  if (!state.currentTask) return;
  const taskId = state.currentTask.id;
  state.timeAlloc = state.timeAlloc.filter(a => a.task_id !== taskId);
  state.moneyAlloc = state.moneyAlloc.filter(a => a.task_id !== taskId);
  openTaskPanel(state.currentTask); // rebuild panel with zeros
  refreshMainUI();
}

/* -------------------------------
   Submit
--------------------------------*/
async function submitPlay() {
  const name = el("playerName").value.trim();
  if (!name) return alert("Vennligst skriv navnet ditt før innsending.");
  if (state.timeAlloc.length === 0 && state.moneyAlloc.length === 0) {
    return alert("Du må gjøre minst én prioritering før innsending.");
  }

  const { data: play, error: playErr } = await db
    .from("playthroughs")
    .insert({ scenario_id: SCENARIO_ID, user_name: name })
    .select()
    .single();

  if (playErr) return alert(`Kunne ikke lagre innsending: ${playErr.message}`);

  for (const a of state.timeAlloc) {
    const { error } = await db.from("time_allocations").insert({
      playthrough_id: play.id,
      person_id: a.person_id,
      task_id: a.task_id,
      pct: a.pct
    });
    if (error) return alert(`Feil ved lagring (tid): ${error.message}`);
  }

  for (const a of state.moneyAlloc) {
    const { error } = await db.from("budget_allocations").insert({
      playthrough_id: play.id,
      budget_line_id: a.budget_line_id,
      task_id: a.task_id,
      amount_nok: a.amount
    });
    if (error) return alert(`Feil ved lagring (midler): ${error.message}`);
  }

  const { error: logErr } = await db.from("logs").insert({
    playthrough_id: play.id,
    summary: `Innspill fra ${name}`,
    raw: { time: state.timeAlloc, money: state.moneyAlloc }
  });

  if (logErr) return alert(`Feil ved lagring (logg): ${logErr.message}`);

  alert("Takk! Ditt innspill er lagret.");
}

/* -------------------------------
   Utils
--------------------------------*/
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
