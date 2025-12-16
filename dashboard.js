const { SUPABASE_URL, SUPABASE_ANON_KEY, SCENARIO_ID } = window.APP_CONFIG;
const supabase = supabasejs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let chartTime = null;
let chartMoney = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadDashboard();
  document.getElementById('exportCsv').onclick = exportAggregatedCsv;
});

let aggregatedCache = null;

async function loadDashboard() {
  const [tasksRes, playsRes] = await Promise.all([
    supabase.from('tasks').select('*').eq('scenario_id', SCENARIO_ID),
    supabase.from('playthroughs').select('*').eq('scenario_id', SCENARIO_ID).order('submitted_at', { ascending:false })
  ]);

  const tasks = tasksRes.data || [];
  const playthroughs = playsRes.data || [];

  const playIds = playthroughs.map(p => p.id);
  const [timeRes, moneyRes, logsRes] = await Promise.all([
    playIds.length ? supabase.from('time_allocations').select('*').in('playthrough_id', playIds) : { data:[] },
    playIds.length ? supabase.from('budget_allocations').select('*').in('playthrough_id', playIds) : { data:[] },
    playIds.length ? supabase.from('logs').select('*').in('playthrough_id', playIds) : { data:[] }
  ]);

  const time = timeRes.data || [];
  const money = moneyRes.data || [];
  const logs = logsRes.data || [];

  // aggregate per task
  const timeByTask = new Map();
  const moneyByTask = new Map();

  time.forEach(a => timeByTask.set(a.task_id, (timeByTask.get(a.task_id)||0) + a.pct));
  money.forEach(a => moneyByTask.set(a.task_id, (moneyByTask.get(a.task_id)||0) + Number(a.amount_nok)));

  aggregatedCache = { tasks, playthroughs, logs, timeByTask, moneyByTask };

  renderCharts(tasks, timeByTask, moneyByTask);
  renderSubmissions(playthroughs, logs);
}

function renderCharts(tasks, timeByTask, moneyByTask) {
  const topTime = tasks
    .map(t => ({ title:t.title, val: timeByTask.get(t.id)||0 }))
    .sort((a,b)=>b.val-a.val)
    .slice(0, 12);

  const topMoney = tasks
    .map(t => ({ title:t.title, val: moneyByTask.get(t.id)||0 }))
    .sort((a,b)=>b.val-a.val)
    .slice(0, 12);

  // Time chart
  if (chartTime) chartTime.destroy();
  chartTime = new Chart(document.getElementById('chartTime').getContext('2d'), {
    type: 'bar',
    data: {
      labels: topTime.map(x=>x.title),
      datasets: [{ label:'Total tid (%)', data: topTime.map(x=>x.val) }]
    },
    options: { plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } }
  });

  // Money chart
  if (chartMoney) chartMoney.destroy();
  chartMoney = new Chart(document.getElementById('chartMoney').getContext('2d'), {
    type: 'bar',
    data: {
      labels: topMoney.map(x=>x.title),
      datasets: [{ label:'Total NOK', data: topMoney.map(x=>x.val) }]
    },
    options: { plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } }
  });
}

function renderSubmissions(playthroughs, logs) {
  const logsById = new Map(logs.map(l=>[l.playthrough_id, l]));
  const wrap = document.getElementById('submissions');

  let html = `<table>
    <thead><tr><th>Navn</th><th>Tid</th><th></th></tr></thead><tbody>`;

  playthroughs.forEach(p => {
    const when = p.submitted_at ? new Date(p.submitted_at).toLocaleString('nb-NO') : '';
    html += `<tr>
      <td><b>${escapeHtml(p.user_name)}</b></td>
      <td class="muted">${escapeHtml(when)}</td>
      <td><button data-id="${p.id}">Vis</button></td>
    </tr>`;
  });

  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const log = logsById.get(id);
      document.getElementById('logView').textContent = log?.summary || JSON.stringify(log?.raw || {}, null, 2) || '(ingen logg)';
    };
  });
}

function exportAggregatedCsv() {
  if (!aggregatedCache) return;

  const { tasks, timeByTask, moneyByTask } = aggregatedCache;

  const rows = [];
  rows.push(['task','time_total_pct','money_total_nok'].map(csv).join(','));

  tasks.forEach(t => {
    rows.push([
      t.title,
      timeByTask.get(t.id)||0,
      moneyByTask.get(t.id)||0
    ].map(csv).join(','));
  });

  const blob = new Blob([rows.join('\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashboard_aggregated_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csv(v) {
  return `"${String(v ?? '').replaceAll('"','""')}"`;
}
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;');
}
