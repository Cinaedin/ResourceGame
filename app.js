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
  expanded: new Set(),
  playerName: ""
};

// taskId -> { cardEl, statusEl }
const domIndex = new Map();

const el = (id) => document.getElementById(id);
const norm = (s) => String(s ?? "").trim().toLowerCase();

document.addEventListener("DOMContentLoaded", async () => {
  bindNav();
  bindPlayer();
  bindEditor();

  await loadScenario();
  await loadData();
  renderAll(); // full first render
});

function bindNav() {
  el("modeEditor").onclick = () => show("editor");
  el("modePlayer").onclick = () => show("player");
  el("modeDashboard").onclick = () => window.location.href = "dashboard.html";
}

function show(which) {
  if (which === "editor") {
    el("editorView").classList.remove("hidden");
    el("playerView").classList.add("hidden");
  } else {
    el("playerView").classList.remove("hidden");
    el("editorView").classList.add("hidden");
  }
}

function bindPlayer() {
  el("filterUncovered").onclick = () => {
    state.showOnlyUncovered = !state.showOnlyUncovered;
    el("filterUncovered").innerText = state.showOnlyUncovered
      ? "Vis alle oppgaver"
      : "Vis kun oppgaver uten dekning";
    renderTasks(); // filter needs full rerender
  };

  el("playerName").addEventListener("input", () => {
    state.playerName = el("playerName").value.trim();
    updateSubmitEnabled();
  });

  el("playerName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.playerName = el("playerName").value.trim();
      updateSubmitEnabled();
      window.scrollTo({
        top: el("taskList").getBoundingClientRect().top + window.scrollY - 20,
        behavior: "smooth"
      });
    }
  });

  el("submitPlay").onclick = submitPlay;
}

function bindEditor() {
  if (el("btnImportCsv")) el("btnImportCsv").onclick = importCsv;
  if (el("btnResetScenario")) el("btnResetScenario").onclick = resetScenarioData;
}

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
    db.from("tasks").select("*").eq("scenario_id", SCENARIO_ID).order("title", { ascending: true }),
    db.from("people").select("*").eq("scenario_id", SCENARIO_ID).order("name", { ascending: true }),
    db.from("budget_lines").select("*").eq("scenario_id", SCENARIO_ID).order("title", { ascending: true })
  ]);

  state.tasks = tasksRes.data || [];
  state.people = peopleRes.data || [];
  state.budgets = budgetsRes.data || [];
}

function renderAll() {
  renderCapacityBars();
  renderCoverageMeter();
  renderTasks();
  updateSubmitEnabled();
}

/* ---------- Lightweight updates during dragging ---------- */
function updateDuringDrag(taskId) {
  renderCapacityBars();
  renderCoverageMeter();
  updateTaskCard(taskId);

  // If filter is ON and task just became non-red, remove it live (no rerender needed)
  if (state.showOnlyUncovered) {
    const status = taskStatus(taskId);
    if (status !== "red") {
      const entry = domIndex.get(taskId);
      if (entry?.cardEl) entry.cardEl.remove();
      domIndex.delete(taskId);
    }
  }

  updateSubmitEnabled();
}

function finalizeAfterDrag() {
  // Only necessary if filter is ON (might need to re-include items when they become red again)
  if (state.showOnlyUncovered) renderTasks();
}

/* ---------- Bars ---------- */
function renderCapacityBars() {
  const totalCap = state.people.reduce((s, p) => s + Number(p.capacity_pct || 0), 0);
  const usedCap = state.timeAlloc.reduce((s, a) => s + Number(a.pct || 0), 0);
  const pct = totalCap ? Math.min(100, (usedCap / totalCap) * 100) : 0;

  el("peopleCapacityBar").classList.toggle("over", usedCap > totalCap);
  el("peopleCapacityBar").querySelector("span").style.width = `${pct}%`;
  el("peopleCapacityText").innerText = `${usedCap}% brukt av ${totalCap}% tilgjengelig`;

  const flex = state.budgets.filter(b => norm(b.type) === "handlingsrom");
  const totalBudget = flex.reduce((s, b) => s + Number(b.amount_nok || 0), 0);
  const usedBudget = state.moneyAlloc.reduce((s, a) => s + Number(a.amount || 0), 0);
  const bpct = totalBudget ? Math.min(100, (usedBudget / totalBudget) * 100) : 0;

  el("budgetCapacityBar").classList.toggle("over", usedBudget > totalBudget);
  el("budgetCapacityBar").querySelector("span").style.width = `${bpct}%`;
  el("budgetCapacityText").innerText =
    `${usedBudget.toLocaleString("nb-NO")} kr brukt av ${totalBudget.toLocaleString("nb-NO")} kr handlingsrom`;
}

function renderCoverageMeter() {
  const covered = state.tasks.filter(t => taskStatus(t.id) === "green").length;
  el("coverageMeter").innerText = `${covered} / ${state.tasks.length} oppgaver dekket`;
}

/* ---------- Status helpers ---------- */
function taskStatus(taskId) {
  const hasPeople = state.timeAlloc.some(a => a.task_id === taskId && a.pct > 0);
  const hasMoney = state.moneyAlloc.some(a => a.task_id === taskId && a.amount > 0);
  if (!hasPeople && !hasMoney) return "red";
  if (hasPeople && hasMoney) return "green";
  return "yellow";
}

function taskStatusText(taskId) {
  const hasPeople = state.timeAlloc.some(a => a.task_id === taskId && a.pct > 0);
  const hasMoney = state.moneyAlloc.some(a => a.task_id === taskId && a.amount > 0);
  if (!hasPeople && !hasMoney) return "Ingen personell og ingen midler";
  if (!hasPeople) return "Ingen personell";
  if (!hasMoney) return "Ingen midler";
  return "Dekket";
}

function updateTaskCard(taskId) {
  const entry = domIndex.get(taskId);
  if (!entry?.cardEl) return;

  const status = taskStatus(taskId);
  entry.cardEl.classList.remove("red", "yellow", "green");
  entry.cardEl.classList.add(status);

  if (entry.statusEl) entry.statusEl.textContent = taskStatusText(taskId);
}

/* ---------- Alloc helpers ---------- */
function assignedPeople(taskId) {
  return state.timeAlloc.filter(a => a.task_id === taskId).map(a => a.person_id);
}
function assignedBudgets(taskId) {
  return state.moneyAlloc.filter(a => a.task_id === taskId).map(a => a.budget_line_id);
}
function setTimeAlloc(personId, taskId, pct) {
  state.timeAlloc = state.timeAlloc.filter(a => !(a.person_id === personId && a.task_id === taskId));
  if (pct > 0) state.timeAlloc.push({ person_id: personId, task_id: taskId, pct });
}
function removeTimeAlloc(personId, taskId) {
  state.timeAlloc = state.timeAlloc.filter(a => !(a.person_id === personId && a.task_id === taskId));
}
function setMoneyAlloc(budgetId, taskId, amount) {
  state.moneyAlloc = state.moneyAlloc.filter(a => !(a.budget_line_id === budgetId && a.task_id === taskId));
  if (amount > 0) state.moneyAlloc.push({ budget_line_id: budgetId, task_id: taskId, amount });
}
function removeMoneyAlloc(budgetId, taskId) {
  state.moneyAlloc = state.moneyAlloc.filter(a => !(a.budget_line_id === budgetId && a.task_id === taskId));
}

/* ---------- Render tasks (FULL render only) ---------- */
function renderTasks() {
  const wrap = el("taskList");
  wrap.innerHTML = "";
  domIndex.clear();

  const flexBudgets = state.budgets.filter(b => norm(b.type) === "handlingsrom");

  state.tasks.forEach(task => {
    const status = taskStatus(task.id);
    if (state.showOnlyUncovered && status !== "red") return;

    const card = document.createElement("div");
    card.className = `task ${status}`;

    const header = document.createElement("div");
    header.className = "task-header";

    const left = document.createElement("div");
    left.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-status" id="status-${task.id}">${escapeHtml(taskStatusText(task.id))}</div>
      <div class="task-meta">${task.program ? `<span class="pill">${escapeHtml(task.program)}</span>` : ""}</div>
    `;

    const expand = document.createElement("button");
    expand.className = "expand-btn";
    expand.textContent = state.expanded.has(task.id) ? "Skjul" : "Åpne";
    expand.onclick = (e) => {
      e.preventDefault();
      state.expanded.has(task.id) ? state.expanded.delete(task.id) : state.expanded.add(task.id);
      renderTasks(); // open/close is fine to rerender
    };

    header.appendChild(left);
    header.appendChild(expand);
    card.appendChild(header);

    const statusEl = left.querySelector(`#status-${CSS.escape(String(task.id))}`) || left.querySelector(".task-status");
    domIndex.set(task.id, { cardEl: card, statusEl });

    if (state.expanded.has(task.id)) {
      const panel = document.createElement("div");
      panel.className = "panel";

      panel.appendChild(h4("Personell"));
      panel.appendChild(personPicker(task.id));
      panel.appendChild(personAllocList(task.id));

      panel.appendChild(h4("Budsjett (handlingsrom)"));
      if (!flexBudgets.length) {
        const info = document.createElement("div");
        info.className = "muted";
        info.textContent = "Ingen budsjettlinjer av typen «handlingsrom» er registrert.";
        panel.appendChild(info);
      } else {
        panel.appendChild(budgetPicker(task.id, flexBudgets));
        panel.appendChild(budgetAllocList(task.id, flexBudgets));
      }

      const reset = document.createElement("button");
      reset.className = "btn danger";
      reset.style.marginTop = "10px";
      reset.textContent = "Nullstill denne oppgaven";
      reset.onclick = () => {
        state.timeAlloc = state.timeAlloc.filter(a => a.task_id !== task.id);
        state.moneyAlloc = state.moneyAlloc.filter(a => a.task_id !== task.id);
        renderAll(); // safe to rerender on reset
        state.expanded.add(task.id);
      };
      panel.appendChild(reset);

      card.appendChild(panel);
    }

    wrap.appendChild(card);
  });
}

function h4(t) {
  const h = document.createElement("h4");
  h.textContent = t;
  return h;
}

/* ---------- Person UI ---------- */
function personPicker(taskId) {
  const wrap = document.createElement("div");

  const row = document.createElement("div");
  row.className = "control-row";

  const sel = document.createElement("select");
  const assigned = new Set(assignedPeople(taskId));
  const available = state.people.filter(p => !assigned.has(p.id));

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = available.length ? "Velg person…" : "Alle personer er lagt til";
  sel.appendChild(opt0);

  available.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });

  const btn = document.createElement("button");
  btn.className = "btn ghost";
  btn.textContent = "Legg til";
  btn.onclick = () => {
    const pid = sel.value;
    if (!pid) return;
    setTimeAlloc(pid, taskId, 10);
    state.expanded.add(taskId);
    renderAll(); // after add we can rerender (not during drag)
  };

  row.appendChild(sel);
  row.appendChild(btn);

  const hint = document.createElement("div");
  hint.className = "muted";
  hint.textContent = "Legg til noen få personer per oppgave – juster deretter med drag på slider.";

  wrap.appendChild(row);
  wrap.appendChild(hint);
  return wrap;
}

function personAllocList(taskId) {
  const list = document.createElement("div");
  list.className = "alloc-list";

  const allocs = state.timeAlloc
    .filter(a => a.task_id === taskId)
    .map(a => ({
      ...a,
      name: state.people.find(p => p.id === a.person_id)?.name || a.person_id
    }))
    .sort((a, b) => b.pct - a.pct);

  if (!allocs.length) {
    const info = document.createElement("div");
    info.className = "muted";
    info.textContent = "Ingen personell lagt til på denne oppgaven ennå.";
    list.appendChild(info);
    return list;
  }

  allocs.forEach(a => {
    const box = document.createElement("div");
    box.className = "alloc";

    const label = document.createElement("label");
    const left = document.createElement("span");
    const right = document.createElement("span");
    left.textContent = a.name;
    right.textContent = `${a.pct}%`;
    label.appendChild(left);
    label.appendChild(right);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "5";
    slider.value = String(a.pct);

    // KEY: do NOT rerender the list while dragging
    slider.addEventListener("input", (e) => {
      const v = Number(e.target.value || 0);
      right.textContent = `${v}%`;
      setTimeAlloc(a.person_id, taskId, v);
      updateDuringDrag(taskId);
    });

    slider.addEventListener("change", () => {
      finalizeAfterDrag();
    });

    const actions = document.createElement("div");
    actions.className = "alloc-actions";

    const remove = document.createElement("button");
    remove.className = "btn danger";
    remove.textContent = "Fjern";
    remove.onclick = () => {
      removeTimeAlloc(a.person_id, taskId);
      state.expanded.add(taskId);
      renderAll();
    };

    actions.appendChild(document.createElement("div"));
    actions.appendChild(remove);

    box.appendChild(label);
    box.appendChild(slider);
    box.appendChild(actions);
    list.appendChild(box);
  });

  return list;
}

/* ---------- Budget UI ---------- */
function budgetPicker(taskId, flexBudgets) {
  const wrap = document.createElement("div");

  const row = document.createElement("div");
  row.className = "control-row";

  const sel = document.createElement("select");
  const assigned = new Set(assignedBudgets(taskId));
  const available = flexBudgets.filter(b => !assigned.has(b.id));

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = available.length ? "Velg budsjettlinje…" : "Alle budsjettlinjer er lagt til";
  sel.appendChild(opt0);

  available.forEach(b => {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = `${b.title} (${Number(b.amount_nok || 0).toLocaleString("nb-NO")} kr)`;
    sel.appendChild(o);
  });

  const btn = document.createElement("button");
  btn.className = "btn ghost";
  btn.textContent = "Legg til";
  btn.onclick = () => {
    const bid = sel.value;
    if (!bid) return;
    setMoneyAlloc(bid, taskId, 100000);
    state.expanded.add(taskId);
    renderAll();
  };

  row.appendChild(sel);
  row.appendChild(btn);

  const hint = document.createElement("div");
  hint.className = "muted";
  hint.textContent = "Drag på slideren for å justere (ingen rerender mens du drar).";

  wrap.appendChild(row);
  wrap.appendChild(hint);
  return wrap;
}

function budgetAllocList(taskId, flexBudgets) {
  const list = document.createElement("div");
  list.className = "alloc-list";

  const allocs = state.moneyAlloc
    .filter(a => a.task_id === taskId)
    .map(a => {
      const b = flexBudgets.find(x => x.id === a.budget_line_id);
      return {
        ...a,
        title: b?.title || a.budget_line_id,
        max: Number(b?.amount_nok || 0)
      };
    })
    .sort((a, b) => b.amount - a.amount);

  if (!allocs.length) {
    const info = document.createElement("div");
    info.className = "muted";
    info.textContent = "Ingen budsjettmidler lagt til på denne oppgaven ennå.";
    list.appendChild(info);
    return list;
  }

  allocs.forEach(a => {
    const box = document.createElement("div");
    box.className = "alloc";

    const label = document.createElement("label");
    const left = document.createElement("span");
    const right = document.createElement("span");
    left.textContent = a.title;
    right.textContent = `${Number(a.amount).toLocaleString("nb-NO")} kr`;
    label.appendChild(left);
    label.appendChild(right);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(a.max || 0);
    slider.step = "100000";
    slider.value = String(a.amount);

    slider.addEventListener("input", (e) => {
      const v = Number(e.target.value || 0);
      right.textContent = `${v.toLocaleString("nb-NO")} kr`;
      setMoneyAlloc(a.budget_line_id, taskId, v);
      updateDuringDrag(taskId);
    });

    slider.addEventListener("change", () => {
      finalizeAfterDrag();
    });

    const actions = document.createElement("div");
    actions.className = "alloc-actions";

    const remove = document.createElement("button");
    remove.className = "btn danger";
    remove.textContent = "Fjern";
    remove.onclick = () => {
      removeMoneyAlloc(a.budget_line_id, taskId);
      state.expanded.add(taskId);
      renderAll();
    };

    actions.appendChild(document.createElement("div"));
    actions.appendChild(remove);

    box.appendChild(label);
    box.appendChild(slider);
    box.appendChild(actions);
    list.appendChild(box);
  });

  return list;
}

/* ---------- Submit enable/disable ---------- */
function updateSubmitEnabled() {
  const btn = el("submitPlay");
  const hint = el("submitHint");

  const name = (state.playerName || "").trim();
  const hasName = name.length > 0;
  const hasAny = state.timeAlloc.length > 0 || state.moneyAlloc.length > 0;

  btn.disabled = !(hasName && hasAny);

  if (!hasName) hint.textContent = "Skriv navnet ditt for å kunne sende inn.";
  else if (!hasAny) hint.textContent = "Gjør minst én prioritering (personell eller budsjett) før innsending.";
  else hint.textContent = "Klar til innsending.";
}

/* ---------- Submit ---------- */
async function submitPlay() {
  const name = (state.playerName || el("playerName").value || "").trim();
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

/* ---------- Editor (same as before) ---------- */
async function importCsv() {
  const file = el("csvFile")?.files?.[0];
  if (!file) return editorMsg("Velg en CSV-fil først.");

  const type = el("csvType").value;
  const text = await file.text();
  const rows = parseCsv(text);

  try {
    if (type === "people") {
      const payload = rows.map(r => ({
        scenario_id: SCENARIO_ID,
        name: r.name,
        capacity_pct: Number(r.capacity_pct || 0)
      })).filter(x => x.name);

      const { error } = await db.from("people").insert(payload);
      if (error) throw error;
      editorMsg(`Importerte ${payload.length} personer.`);
    }

    if (type === "tasks") {
      const payload = rows.map(r => ({
        scenario_id: SCENARIO_ID,
        title: r.title,
        program: r.program || null
      })).filter(x => x.title);

      const { error } = await db.from("tasks").insert(payload);
      if (error) throw error;
      editorMsg(`Importerte ${payload.length} oppgaver.`);
    }

    if (type === "budget_lines") {
      const payload = rows.map(r => ({
        scenario_id: SCENARIO_ID,
        title: r.title,
        type: norm(r.type) === "stat" ? "stat" : "handlingsrom",
        amount_nok: Number(r.amount_nok || 0)
      })).filter(x => x.title);

      const { error } = await db.from("budget_lines").insert(payload);
      if (error) throw error;
      editorMsg(`Importerte ${payload.length} budsjettlinjer.`);
    }

    await loadData();
    renderAll();
  } catch (e) {
    editorMsg(`Feil ved import: ${e.message || e}`);
  }
}

async function resetScenarioData() {
  if (!confirm("Er du sikker? Dette sletter innsendinger og logger (ikke oppgaver/personer/budsjett).")) return;

  try {
    const plays = await db.from("playthroughs").select("id").eq("scenario_id", SCENARIO_ID);
    const ids = (plays.data || []).map(x => x.id);

    if (ids.length) {
      await db.from("time_allocations").delete().in("playthrough_id", ids);
      await db.from("budget_allocations").delete().in("playthrough_id", ids);
      await db.from("logs").delete().in("playthrough_id", ids);
      await db.from("playthroughs").delete().in("id", ids);
    }

    editorMsg("Reset fullført.");
  } catch (e) {
    editorMsg(`Feil ved reset: ${e.message || e}`);
  }
}

function editorMsg(t) {
  const n = el("editorMsg");
  if (n) n.textContent = t;
}

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (cols[idx] ?? "").trim());
    out.push(obj);
  }
  return out;
}
function splitCsvLine(line) {
  const res = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { res.push(cur); cur = ""; continue; }
    cur += ch;
  }
  res.push(cur);
  return res;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
