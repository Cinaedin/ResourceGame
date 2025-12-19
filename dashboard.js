const { SUPABASE_URL, SUPABASE_ANON_KEY, SCENARIO_ID } = window.APP_CONFIG;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const el = (id) => document.getElementById(id);
const norm = (s) => String(s ?? "").trim().toLowerCase();

let chartFundsPie=null, chartPeoplePie=null, chartTime=null, chartMoney=null;
let cache=null;

document.addEventListener("DOMContentLoaded", async () => {
  el("exportCsv").onclick = exportAggregatedCsv;
  await loadDashboard();
});

async function loadDashboard(){
  try{
    const [budgetsRes, peopleRes, tasksRes, playsRes] = await Promise.all([
      db.from("budget_lines").select("*").eq("scenario_id", SCENARIO_ID),
      db.from("people").select("*").eq("scenario_id", SCENARIO_ID),
      db.from("tasks").select("*").eq("scenario_id", SCENARIO_ID),
      db.from("playthroughs").select("*").eq("scenario_id", SCENARIO_ID).order("submitted_at", {ascending:false})
    ]);

    const budgets = budgetsRes.data || [];
    const people  = peopleRes.data || [];
    const tasks   = tasksRes.data || [];
    const plays   = playsRes.data || [];

    renderFundsPie(budgets);
    renderPeoplePie(people);

    if (!plays.length){
      el("dashMsg").textContent = "Ingen innsendinger ennå. Grafer viser scenario-kontekst, men ikke prioriteringer.";
      renderCharts(tasks, new Map(), new Map());
      renderIgnoredTasks(tasks, new Map(), new Map());
      renderSubmissions([], []);
      cache = { tasks, timeByTask:new Map(), moneyByTask:new Map() };
      return;
    }

    const ids = plays.map(p=>p.id);
    const [timeRes, moneyRes, logsRes] = await Promise.all([
      db.from("time_allocations").select("*").in("playthrough_id", ids),
      db.from("budget_allocations").select("*").in("playthrough_id", ids),
      db.from("logs").select("*").in("playthrough_id", ids)
    ]);

    const time = timeRes.data || [];
    const money = moneyRes.data || [];
    const logs = logsRes.data || [];

    const timeByTask = new Map();
    time.forEach(a=>{
      timeByTask.set(a.task_id, (timeByTask.get(a.task_id)||0) + Number(a.pct||0));
    });

    const moneyByTask = new Map();
    money.forEach(a=>{
      const amt = Number(a.amount_nok ?? a.amount ?? 0);
      moneyByTask.set(a.task_id, (moneyByTask.get(a.task_id)||0) + amt);
    });

    el("dashMsg").textContent = `Innsendinger: ${plays.length}`;
    renderCharts(tasks, timeByTask, moneyByTask);
    renderIgnoredTasks(tasks, timeByTask, moneyByTask);
    renderSubmissions(plays, logs);

    cache = { tasks, timeByTask, moneyByTask };
  } catch(e){
    el("dashMsg").textContent = `Feil i dashboard: ${e.message || e}`;
  }
}

function renderFundsPie(budgets){
  const stat = budgets.filter(b=>norm(b.type)==="stat").reduce((s,b)=>s+Number(b.amount_nok||0),0);
  const flex = budgets.filter(b=>norm(b.type)==="handlingsrom").reduce((s,b)=>s+Number(b.amount_nok||0),0);
  el("fundsText").textContent =
    `Stat (låst): ${stat.toLocaleString("nb-NO")} kr • Handlingsrom: ${flex.toLocaleString("nb-NO")} kr • Totalt: ${(stat+flex).toLocaleString("nb-NO")} kr`;

  if (chartFundsPie) chartFundsPie.destroy();
  chartFundsPie = new Chart(el("chartFundsPie").getContext("2d"), {
    type:"doughnut",
    data:{ labels:["Låst (stat)","Fleksibelt (handlingsrom)"], datasets:[{data:[stat,flex]}] },
    options:{ plugins:{ legend:{position:"bottom"} } }
  });
}

function renderPeoplePie(people){
  const sorted=[...people].sort((a,b)=>Number(b.capacity_pct||0)-Number(a.capacity_pct||0));
  const total = sorted.reduce((s,p)=>s+Number(p.capacity_pct||0),0);
  el("peopleText").textContent = `Sum registrert kapasitet: ${total}%`;

  if (chartPeoplePie) chartPeoplePie.destroy();
  chartPeoplePie = new Chart(el("chartPeoplePie").getContext("2d"),{
    type:"doughnut",
    data:{ labels:sorted.map(p=>p.name), datasets:[{data:sorted.map(p=>Number(p.capacity_pct||0))}] },
    options:{ plugins:{ legend:{position:"bottom"} } }
  });
}

function renderCharts(tasks, timeByTask, moneyByTask){
  const topTime = tasks.map(t=>({title:t.title, val:timeByTask.get(t.id)||0}))
    .sort((a,b)=>b.val-a.val).slice(0,12);
  const topMoney = tasks.map(t=>({title:t.title, val:moneyByTask.get(t.id)||0}))
    .sort((a,b)=>b.val-a.val).slice(0,12);

  if (chartTime) chartTime.destroy();
  chartTime = new Chart(el("chartTime").getContext("2d"),{
    type:"bar",
    data:{ labels:topTime.map(x=>x.title), datasets:[{label:"Total tid (%)", data:topTime.map(x=>x.val)}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
  });

  if (chartMoney) chartMoney.destroy();
  chartMoney = new Chart(el("chartMoney").getContext("2d"),{
    type:"bar",
    data:{ labels:topMoney.map(x=>x.title), datasets:[{label:"Total handlingsrom (NOK)", data:topMoney.map(x=>x.val)}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
  });
}

function renderIgnoredTasks(tasks, timeByTask, moneyByTask){
  const ignored = tasks.filter(t => (timeByTask.get(t.id)||0)===0 && (moneyByTask.get(t.id)||0)===0);
  const wrap = el("ignoredTasks");
  if (!ignored.length){
    wrap.innerHTML = `<div class="muted">Ingen oppgaver er helt uten dekning (ennå).</div>`;
    return;
  }
  wrap.innerHTML = `<b>${ignored.length}</b> oppgaver uten dekning:<ul>${ignored.map(t=>`<li>${escapeHtml(t.title)}</li>`).join("")}</ul>`;
}

function renderSubmissions(plays, logs){
  const wrap = el("submissions");
  if (!plays.length){
    wrap.innerHTML = `<div class="muted">Ingen innsendinger ennå.</div>`;
    return;
  }
  const logsBy = new Map((logs||[]).map(l=>[l.playthrough_id, l]));

  let html = `<table><thead><tr><th>Navn</th><th>Tidspunkt</th><th></th></tr></thead><tbody>`;
  plays.forEach(p=>{
    const when = p.submitted_at ? new Date(p.submitted_at).toLocaleString("nb-NO") : "";
    html += `<tr>
      <td><b>${escapeHtml(p.user_name)}</b></td>
      <td class="muted">${escapeHtml(when)}</td>
      <td><button data-id="${p.id}">Vis</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll("button[data-id]").forEach(btn=>{
    btn.onclick = () => {
      const id = btn.getAttribute("data-id");
      const log = logsBy.get(id);
      const raw = log?.raw || null;

      // Nice view
      el("logNice").innerHTML = raw ? renderNice(raw) : "<div class='muted'>(ingen logg)</div>";
      // Raw JSON
      el("logRaw").textContent = raw ? JSON.stringify(raw, null, 2) : "(ingen logg)";
    };
  });
}

function renderNice(raw){
  // raw: { time:[{person_id,task_id,pct}], money:[{budget_line_id,task_id,amount}] }
  const time = raw.time || [];
  const money = raw.money || [];

  return `
    <div><b>Oppsummering</b></div>
    <ul>
      <li>Tidsallokeringer: <b>${time.length}</b></li>
      <li>Budsjettallokeringer: <b>${money.length}</b></li>
    </ul>
    <div class="muted">Detaljer finnes under “Vis rådata (JSON)”.</div>
  `;
}

function exportAggregatedCsv(){
  if (!cache) return;
  const { tasks, timeByTask, moneyByTask } = cache;

  const rows = [];
  rows.push(["oppgave","tid_total_pct","handlingsrom_total_nok"].map(csv).join(","));
  tasks.forEach(t=>{
    rows.push([t.title, timeByTask.get(t.id)||0, moneyByTask.get(t.id)||0].map(csv).join(","));
  });

  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url;
  a.download=`dashboard_aggregert_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csv(v){ return `"${String(v ?? "").replaceAll('"','""')}"`; }
function escapeHtml(s){
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
