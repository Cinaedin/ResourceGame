/* ===============================
   Prioriteringsøvelse – app.js
   =============================== */

const { SUPABASE_URL, SUPABASE_ANON_KEY, SCENARIO_ID } = window.APP_CONFIG;
const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

/* -------------------------------
   Global state
--------------------------------*/
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

/* -------------------------------
   Init
--------------------------------*/
document.addEventListener("DOMContentLoaded", async () => {
  bindGlobalButtons();
  await loadScenario();
  await loadData();
  renderAll();
});

/* -------------------------------
   Bindings
--------------------------------*/
function bindGlobalButtons() {
  document.getElementById("filterUncovered").onclick = () => {
    state.showOnlyUncovered = !state.showOnlyUncovered;
    renderTasks();
  };

  document.getElementById("closeTaskPanel").onclick = () => {
    document.getElementById("taskPanel").classList.add("hidden");
    state.currentTask = null;
  };

  document.getElementById("resetTask").onclick = resetCurrentTask;
  document.getElementById("submitPlay").onclick = submitPlay;
}

/* -------------------------------
   Load data
--------------------------------*/
async function loadScenario() {
  const { data } = await supabase
    .from("scenarios")
    .select("*")
    .eq("id", SCENARIO_ID)
    .single();

  state.scenario = data;
  document.getElementById("scenarioTitle").innerText = data?.title || "–";
  document.getElementById("scenarioLock").innerText =
    data?.is_locked ? "Scenario er låst" : "Scenario er åpent";
}

async function loadData() {
  const [goals, tasks, people, budgets] = await Promise.all([
    supabase.from("goals").select("*").eq("scenario_id", SCENARIO_ID),
    supabase.from("tasks").select("*").eq("scenario_id", SCENARIO_ID),
    supabase.from("people").select("*").eq("scenario_id", SCENARIO_ID),
    supabase.from("budget_lines").select("*").eq("scenario_id", SCENARIO_ID)
  ]);

  state.goals = goals.data || [];
  state.tasks = tasks.data || [];
  state.people = people.data || [];
  state.budgets = budgets.data || [];
}

/* -------------------------------
   Rendering
--------------------------------*/
function renderAll() {
  renderCapacityBars();
  renderCoverageMeter();
  renderTasks();
}

function renderCapacityBars() {
  // People capacity
  const totalCap = state.people.reduce((s, p) => s + p.capacity_pct, 0);
  const usedCap = state.timeAlloc.reduce((s, a) => s + a.pct, 0);

  const pBar = document.getElementById("peopleCapacityBar");
  const pSpan = pBar.querySelector("span");
  const pPct = totalCap ? Math.min(100, (usedCap / totalCap) * 100) : 0;
  pSpan.style.width = `${pPct}%`;
  pBar.classList.toggle("over", usedCap > totalCap);

  document.getElementById("peopleCapacityText").innerText =
    `${usedCap}% brukt av ${totalCap}% tilgjengelig`;

  // Budget (handlingsrom only)
  const flexBudgets = state.budgets.filter(b => b.type === "handlingsrom");
  const totalBudget = flexBudgets.reduce((s, b) => s + Number(b.amount_nok), 0);
  const usedBudget = state.moneyAlloc.reduce((s, a) => s + Number(a.amount), 0);

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
      <div class="task-title">${task.title}</div>
      <div class="task-status">${statusText}</div>
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
   Task panel
--------------------------------*/
function openTaskPanel(task) {
  state.currentTask = task;
  document.getElementById("taskPanel").classList.remove("hidden");
  document.getElementById("taskPanelTitle").innerText = task.title;

  const wrap = document.getElementById("taskPanelContent");
  wrap.innerHTML = "";

  // People sliders
  wrap.innerHTML += "<h3>Personell</h3>";
  state.people.forEach(p => {
    const current = state.timeAlloc
      .find(a => a.person_id === p.id && a.task_id === task.id)?.pct || 0;

    const row = document.createElement("div");
    row.className = "slider-row";
    row.innerHTML = `
      <label>
        <span>${p.name}</span>
        <span>${current}%</span>
      </label>
      <input type="range" min="0" max="100" step="5" value="${current}">
    `;
    row.querySelector("input").oninput = e => {
      updateTimeAllocation(p.id, task.id, Number(e.target.value));
    };
    wrap.appendChild(row);
  });

  // Budget sliders (handlingsrom)
  wrap.innerHTML += "<h3>Budsjett (handlingsrom)</h3>";
  state.budgets
    .filter(b => b.type === "handlingsrom")
    .forEach(b => {
      const current = state.moneyAlloc
        .find(a => a.budget_line_id === b.id && a.task_id === task.id)?.amount || 0;

      const row = document.createElement("div");
      row.className = "slider-row";
      row.innerHTML = `
        <label>
          <span>${b.title}</span>
          <span>${current.toLocaleString("nb-NO")} kr</span>
        </label>
        <input type="range" min="0" max="${b.amount_nok}" step="100000" value="${current}">
      `;
      row.querySelector("input").oninput = e => {
        updateMoneyAllocation(b.id, task.id, Number(e.target.value));
      };
      wrap.appendChild(row);
    });
}

/* -------------------------------
   Update allocations
--------------------------------*/
function updateTimeAllocation(personId, taskId, pct) {
  state.timeAlloc = state.timeAlloc.filter(
    a => !(a.person_id === personId && a.task_id === taskId)
  );
  if (pct > 0) {
    state.timeAlloc.push({ person_id: personId, task_id: taskId, pct });
  }
  renderAll();
}

function updateMoneyAllocation(budgetId, taskId, amount) {
  state.moneyAlloc = state.moneyAlloc.filter(
    a => !(a.budget_line_id === budgetId && a.task_id === taskId)
  );
  if (amount > 0) {
    state.moneyAlloc.push({ budget_line_id: budgetId, task_id: taskId, amount });
  }
  renderAll();
}

/* -------------------------------
   Reset task
--------------------------------*/
function resetCurrentTask() {
  if (!state.currentTask) return;
  const taskId = state.currentTask.id;
  state.timeAlloc = state.timeAlloc.filter(a => a.task_id !== taskId);
  state.moneyAlloc = state.moneyAlloc.filter(a => a.task_id !== taskId);
  openTaskPanel(state.currentTask);
  renderAll();
}

/* -------------------------------
   Submit
--------------------------------*/
async function submitPlay() {
  const name = document.getElementById("playerName").value.trim();
  if (!name) {
    alert("Vennligst skriv navnet ditt før innsending.");
    return;
  }

  if (state.timeAlloc.length === 0 && state.moneyAlloc.length === 0) {
    alert("Du må gjøre minst én prioritering før innsending.");
    return;
  }

  const { data: play } = await supabase
    .from("playthroughs")
    .insert({ scenario_id: SCENARIO_ID, user_name: name })
    .select()
    .single();

  for (const a of state.timeAlloc) {
    await supabase.from("time_allocations").insert({
      playthrough_id: play.id,
      ...a
    });
  }

  for (const a of state.moneyAlloc) {
    await supabase.from("budget_allocations").insert({
      playthrough_id: play.id,
      ...a
    });
  }

  await supabase.from("logs").insert({
    playthrough_id: play.id,
    summary: `Innspill fra ${name}`,
    raw: {
      time: state.timeAlloc,
      money: state.moneyAlloc
    }
  });

  alert("Takk! Ditt innspill er lagret.");
}
