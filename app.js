/* ===============================
   Prioriteringsøvelse – app.js
   (FULL ERSTATNING, FIX: db client)
   =============================== */

const { SUPABASE_URL, SUPABASE_ANON_KEY, SCENARIO_ID } = window.APP_CONFIG;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  scenario: null,
  goals: [],
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
  renderAll();
});

function bindGlobalButtons() {
  document.getElementById("filterUncovered").onclick = () => {
    state.showOnlyUncovered = !state.showOnlyUncovered;
    document.getElementById("filterUncovered").innerText =
      state.showOnlyUncovered ? "Vis alle oppgaver" : "Vis kun oppgaver uten dekning";
    renderTasks();
  };

  document.getElementById("closeTaskPanel").onclick = () => {
    document.getElementById("taskPanel").classList.add("hidden");
    state.currentTask = null;
  };

  document.getElementById("resetTask").onclick = resetCurrentTask;
  document.getElementById("submitPlay").onclick = submitPlay;
}

async function loadScenario() {
  const { data, error } = await db
    .from("scenarios")
    .select("*")
    .eq("id", SCENARIO_ID)
    .single();

  if (error) throw error;

  state.scenario = data;
  document.getElementById("scenarioTitle").innerText = data?.title || "–";
  document.getElementById("scenarioLock").innerText =
    data?.is_locked ? "Scenario er låst" : "Scenario er åpent";
}

async function loadData() {
  const [goals, tasks, people, budgets] = await Promise.all([
    db.from("goals").select("*").eq("scenario_id", SCENARIO_ID),
    db.from("tasks").select("*").eq("scenario_id", SCENARIO_ID),
    db.from("people").select("*").eq("scenario_id", SCENARIO_ID),
    db.from("budget_lines").select("*").eq("scenario_id", SCENARIO_ID)
  ]);

  state.goals = goals.data || [];
  state.tasks = tasks.data || [];
  state.people = people.data || [];
  state.budgets = budgets.data || [];
}

function renderAll() {
  renderCapacityBars();
  renderCoverageMeter();
  renderTasks();
}

function renderCapacityBars() {
  // People capacity
  const totalCap = state.people.reduce((s, p) => s + Number(p.capacity_pct || 0), 0);
  const usedCap = state.timeAlloc.reduce((s, a) => s + Number(a.pct || 0), 0);

  const pBar = document.getElementById("peopleCapacityBar");
  const pSpan = pBar.querySelector("span");
  const pPct = totalCap ? Math.min(100, (usedCap / totalCap) * 100) : 0;
  pSpan.style.width = `${pPct}%`;
  pBar.classList.toggle("over", usedCap > totalCap);

  document.getElementById("peopleCapacityText").innerText =
    `${usedCap}% brukt av ${totalCap}% tilgjengelig`;

  // Budget (handlingsrom only)
  const flexBudgets = state.budgets.filter(b => (b.type || "").toLowerCase() === "handlingsrom");
  const totalBudget = flexBudgets.reduce((s, b) => s + Number(b.amount_nok || 0), 0);
  const usedBudget = state.moneyAlloc.reduce((s, a) => s + Number(a.amount || 0), 0);

  const bBar = document.getElementById("budgetCapacityBar");
  const bSpan = bBar.querySelector("span");
  const bPct = totalBudget ? Math.min(100, (usedBudget / totalBudget) * 100) : 0;
  bSpan.style.width = `${bPct}%`;
  bBar.classList.toggle("over", usedBudget > totalBudget);

  document.getElementById("budgetCapacityText").innerText =
    `${usedBudget.toLocaleString("nb-NO")} kr brukt av ` +
    `${totalBudget.toLocaleString("nb-NO")} kr handlingsrom`;
}

function renderCoverageMeter() {
  const covered = state.tasks.filter(t => taskStatus(t.id) === "green").length;
  document.getElementById("coverageMeter").innerText =
    `${covered} / ${state.tasks.length} oppgaver dekket`;
}

function renderTasks() {
  const wrap = document.getElementById("taskList");
  wrap.innerHTML = "";

  state.tasks.forEach(task => {
    const status = taskStatus(task.id);
    if (state.showOnlyUncovered && status === "green") return;

    const card = document.createElement("div");
    card.className = `task ${status}`;
    card.onclick = () => openTaskPanel(task);

    const statusText = taskStatusText(task.id);

    card.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-status">${escapeHtml(statusText)}</div>
    `;
    wrap.appendChild(card);
  });
}

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

function openTaskPanel(task) {
  state.currentTask = task;
  document.getElementById("taskPanel").classList.remove("hidden");
  document.getElementById("taskPanelTitle").innerText = task.title;

  const wrap = document.getElementById("taskPanelContent");
  wrap.innerHTML = "";

  wrap.innerHTML += "<h3>Personell</h3>";
  state.people.forEach(p => {
    const current = state.timeAlloc
      .find(a => a.person_id === p.id && a.task_id === task.id)?.pct || 0;

    const row = document.createElement("div");
    row.className = "slider-row";
    row.innerHTML = `
      <label>
        <span>${escapeHtml(p.name)}</span>
        <span>${current}%</span>
      </label>
      <input type="range" min="0" max="100" step="5" value="${current}">
    `;
    row.querySelector("input").oninput = e => {
      updateTimeAllocation(p.id, task.id, Number(e.target.value));
      openTaskPanel(task); // refresh panel labels
    };
    wrap.appendChild(row);
  });

  wrap.innerHTML += "<h3>Budsjett (handlingsrom)</h3>";
  state.budgets
    .filter(b => (b.type || "").toLowerCase() === "handlingsrom")
    .forEach(b => {
      const current = state.moneyAlloc
        .find(a => a.budget_line_id === b.id && a.task_id === task.id)?.amount || 0;

      const row = document.createElement("div");
      row.className = "slider-row";
      row.innerHTML = `
        <label>
          <span>${escapeHtml(b.title)}</span>
          <span>${Number(current).toLocaleString("nb-NO")} kr</span>
        </label>
        <input type="range" min="0" max="${Number(b.amount_nok || 0)}" step="100000" value="${current}">
      `;
      row.querySelector("input").oninput = e => {
        updateMoneyAllocation(b.id, task.id, Number(e.target.value));
        openTaskPanel(task);
      };
      wrap.appendChild(row);
    });
}

function updateTimeAllocation(personId, taskId, pct) {
  state.timeAlloc = state.timeAlloc.filter(
    a => !(a.person_id === personId && a.task_id === taskId)
  );
  if (pct > 0) state.timeAlloc.push({ person_id: personId, task_id: taskId, pct });
  renderAll();
}

function updateMoneyAllocation(budgetId, taskId, amount) {
  state.moneyAlloc = state.moneyAlloc.filter(
    a => !(a.budget_line_id === budgetId && a.task_id === taskId)
  );
  if (amount > 0) state.moneyAlloc.push({ budget_line_id: budgetId, task_id: taskId, amount });
  renderAll();
}

function resetCurrentTask() {
  if (!state.currentTask) return;
  const taskId = state.currentTask.id;
  state.timeAlloc = state.timeAlloc.filter(a => a.task_id !== taskId);
  state.moneyAlloc = state.moneyAlloc.filter(a => a.task_id !== taskId);
  openTaskPanel(state.currentTask);
  renderAll();
}

async function submitPlay() {
  const name = document.getElementById("playerName").value.trim();
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
      ...a
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

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
