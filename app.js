/* ===============================
   App.js — Prioriteringsspill
   =============================== */

const { SUPABASE_URL, SUPABASE_ANON_KEY, SCENARIO_ID } = window.APP_CONFIG;
const supabase = supabasejs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// -------------------------------
// App state
// -------------------------------
const state = {
  mode: 'player', // 'editor' | 'player' | 'dashboard'
  scenario: null,
  goals: [],
  tasks: [],
  people: [],
  budgets: [],
  rules: [],
  // player allocations (local until submit)
  timeAlloc: [],    // { person_id, task_id, pct }
  moneyAlloc: [],   // { budget_line_id, task_id, amount }
  warnings: []
};

// -------------------------------
// Utilities
// -------------------------------
const el = (id) => document.getElementById(id);
const fmtNOK = (n) => `${Number(n).toLocaleString('nb-NO')} kr`;

function setMode(m) {
  state.mode = m;
  el('editor').classList.toggle('hidden', m !== 'editor');
  el('player').classList.toggle('hidden', m !== 'player');
  el('dashboard').classList.toggle('hidden', m !== 'dashboard');
}

// -------------------------------
// Init
// -------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  el('modeEditor').onclick = () => setMode('editor');
  el('modePlayer').onclick = () => setMode('player');
  el('modeDashboard').onclick = () => setMode('dashboard');

  el('lockScenario').onclick = lockScenario;
  el('unlockScenario').onclick = unlockScenario;
  el('resetScenario').onclick = resetScenario;
  el('submitPlay').onclick = submitPlay;
  el('importCsv').onclick = importCsv;

  await loadScenario();
  await loadData();
  renderAll();
  setMode('player');
});

// -------------------------------
// Loaders
// -------------------------------
async function loadScenario() {
  const { data } = await supabase
    .from('scenarios')
    .select('*')
    .eq('id', SCENARIO_ID)
    .single();
  state.scenario = data;
  el('scenarioTitle').innerText = data?.title || '—';
  updateLockUI();
}

async function loadData() {
  const [goals, tasks, people, budgets, rules] = await Promise.all([
    supabase.from('goals').select('*').eq('scenario_id', SCENARIO_ID),
    supabase.from('tasks').select('*').eq('scenario_id', SCENARIO_ID),
    supabase.from('people').select('*').eq('scenario_id', SCENARIO_ID),
    supabase.from('budget_lines').select('*').eq('scenario_id', SCENARIO_ID),
    supabase.from('budget_rules').select('*, budget_lines(title)').in(
      'budget_line_id',
      (await supabase.from('budget_lines').select('id').eq('scenario_id', SCENARIO_ID)).data.map(b=>b.id)
    )
  ]);

  state.goals = goals.data || [];
  state.tasks = tasks.data || [];
  state.people = people.data || [];
  state.budgets = budgets.data || [];
  state.rules = rules.data || [];

  el('editorSummary').innerText =
    `${state.goals.length} mål, ${state.tasks.length} oppgaver, ` +
    `${state.people.length} personer, ${state.budgets.length} budsjettlinjer`;
}

// -------------------------------
// Renderers
// -------------------------------
function renderAll() {
  renderPeople();
  renderTasks();
  renderBudgets();
  renderWarnings();
}

function renderPeople() {
  const wrap = el('peopleList');
  wrap.innerHTML = '';
  state.people.forEach(p => {
    const used = state.timeAlloc
      .filter(a => a.person_id === p.id)
      .reduce((s,a)=>s+a.pct,0);

    const card = document.createElement('div');
    card.className = 'person';
    card.innerHTML = `
      <div class="name">${p.name} <span class="pill">${used}/${p.capacity_pct}%</span></div>
      <div class="bar ${used>p.capacity_pct?'over':''}"><span style="width:${Math.min(100,used)}%"></span></div>
      <div class="chips"></div>
    `;
    const chips = card.querySelector('.chips');

    // create 5% chips (clone on drag)
    for (let i=0;i<5;i++){
      const c = document.createElement('div');
      c.className = 'chip';
      c.innerText = '5%';
      c.dataset.person = p.id;
      c.dataset.pct = 5;
      chips.appendChild(c);
    }
    wrap.appendChild(card);
  });

  makeChipsDraggable('.chip', 'time');
}

function renderTasks() {
  const wrap = el('tasksList');
  wrap.innerHTML = '';
  state.tasks.forEach(t => {
    const card = document.createElement('div');
    card.className = 'task';
    card.innerHTML = `
      <div class="title">${t.title}</div>
      <div class="muted">${(t.tags||[]).join(', ')}</div>
      <div class="drop" data-task="${t.id}"></div>
    `;
    wrap.appendChild(card);
  });

  makeDrops();
}

function renderBudgets() {
  const wrap = el('budgetsList');
  wrap.innerHTML = '';
  state.budgets.forEach(b => {
    const used = state.moneyAlloc
      .filter(a => a.budget_line_id === b.id)
      .reduce((s,a)=>s+Number(a.amount),0);

    const card = document.createElement('div');
    card.className = 'budget';
    card.innerHTML = `
      <div class="title">${b.title} <span class="pill">${b.type}</span></div>
      <div class="amount">${fmtNOK(used)} / ${fmtNOK(b.amount_nok)}</div>
      <div class="bar"><span style="width:${Math.min(100,(used/b.amount_nok)*100)}%"></span></div>
      <div class="chips"></div>
    `;
    const chips = card.querySelector('.chips');

    // 100k NOK tokens
    for (let i=0;i<5;i++){
      const c = document.createElement('div');
      c.className = 'chip money';
      c.innerText = '100k';
      c.dataset.budget = b.id;
      c.dataset.amount = 100000;
      chips.appendChild(c);
    }
    wrap.appendChild(card);
  });

  makeChipsDraggable('.chip.money', 'money');
}

function renderWarnings() {
  const box = el('warningsBox');
  const ul = el('warningsList');
  ul.innerHTML = '';
  state.warnings.forEach(w => {
    const li = document.createElement('li');
    li.innerText = w;
    ul.appendChild(li);
  });
  box.classList.toggle('hidden', state.warnings.length === 0);
}

// -------------------------------
// Drag & Drop
// -------------------------------
function makeChipsDraggable(selector, kind) {
  interact(selector).draggable({
    listeners: {
      start (ev) {
        // clone so tray stays full
        const clone = ev.target.cloneNode(true);
        clone.classList.add('drag-clone');
        ev.target.parentNode.appendChild(clone);
        ev.interactable.draggable({}).start({ interaction: ev.interaction, target: clone });
      },
      move (ev) {
        ev.target.style.transform =
          `translate(${ev.dx}px, ${ev.dy}px)`;
      },
      end (ev) {
        ev.target.style.transform = '';
      }
    }
  });
}

function makeDrops() {
  interact('.drop').dropzone({
    ondrop (ev) {
      const chip = ev.relatedTarget;
      const taskId = ev.target.dataset.task;

      if (chip.dataset.person) {
        state.timeAlloc.push({
          person_id: chip.dataset.person,
          task_id: taskId,
          pct: Number(chip.dataset.pct)
        });
      }
      if (chip.dataset.budget) {
        state.moneyAlloc.push({
          budget_line_id: chip.dataset.budget,
          task_id: taskId,
          amount: Number(chip.dataset.amount)
        });
      }
      ev.target.appendChild(chip);
      recalc();
    }
  });
}

// -------------------------------
// Recalculate warnings
// -------------------------------
function recalc() {
  state.warnings = [];

  // capacity warnings
  state.people.forEach(p => {
    const used = state.timeAlloc.filter(a=>a.person_id===p.id).reduce((s,a)=>s+a.pct,0);
    if (used > p.capacity_pct) {
      state.warnings.push(`${p.name} er overbelastet (${used}% > ${p.capacity_pct}%)`);
    }
  });

  // budget rules (simple soft checks)
  state.budgets.forEach(b => {
    const rules = state.rules.filter(r=>r.budget_line_id===b.id);
    const allocs = state.moneyAlloc.filter(a=>a.budget_line_id===b.id);
    const spent = allocs.reduce((s,a)=>s+Number(a.amount),0);

    rules.forEach(r => {
      const j = r.rule_json;
      if (r.rule_type==='min_spend' && spent < j.nok) {
        state.warnings.push(`${b.title}: minimum ${fmtNOK(j.nok)} ikke nådd`);
      }
      if (r.rule_type==='max_spend' && spent > j.nok) {
        state.warnings.push(`${b.title}: maksimum ${fmtNOK(j.nok)} overskredet`);
      }
      if (r.rule_type==='allowed_tags') {
        allocs.forEach(a=>{
          const t = state.tasks.find(x=>x.id===a.task_id);
          if (!t || !t.tags?.some(tag=>j.tags.includes(tag))) {
            state.warnings.push(`${b.title}: midler brukt på oppgave uten tillatte tags`);
          }
        });
      }
    });
  });

  renderAll();
}

// -------------------------------
// CSV Import (Editor)
// -------------------------------
async function importCsv() {
  if (state.scenario?.is_locked) return alert('Scenario er låst');

  const file = el('csvFile').files[0];
  const type = el('csvType').value;
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (res) => {
      for (const row of res.data) {
        if (type==='people') {
          await supabase.from('people').insert({
            scenario_id: SCENARIO_ID,
            name: row.name,
            capacity_pct: Number(row.capacity_pct||100)
          });
        }
        if (type==='budgets') {
          await supabase.from('budget_lines').insert({
            scenario_id: SCENARIO_ID,
            title: row.title,
            type: row.type,
            amount_nok: Number(row.amount_nok)
          });
        }
        if (type==='tasks') {
          await supabase.from('tasks').insert({
            scenario_id: SCENARIO_ID,
            title: row.task_title,
            tags: (row.tags||'').split(',').map(s=>s.trim())
          });
        }
        if (type==='rules') {
          const b = state.budgets.find(x=>x.title===row.budget_title);
          if (b) {
            await supabase.from('budget_rules').insert({
              budget_line_id: b.id,
              rule_type: row.rule_type,
              rule_json: JSON.parse(row.rule_json)
            });
          }
        }
      }
      await loadData();
      renderAll();
      alert('Import fullført');
    }
  });
}

// -------------------------------
// Submit / Lock / Reset
// -------------------------------
async function submitPlay() {
  const name = el('playerName').value?.trim();
  if (!name) return alert('Skriv navn');

  const { data: play } = await supabase.from('playthroughs')
    .insert({ scenario_id: SCENARIO_ID, user_name: name })
    .select().single();

  for (const a of state.timeAlloc) {
    await supabase.from('time_allocations').insert({ playthrough_id: play.id, ...a });
  }
  for (const a of state.moneyAlloc) {
    await supabase.from('budget_allocations').insert({ playthrough_id: play.id, ...a });
  }

  await supabase.from('logs').insert({
    playthrough_id: play.id,
    summary: `Innspill fra ${name}`,
    raw: { time: state.timeAlloc, money: state.moneyAlloc, warnings: state.warnings }
  });

  alert('Takk! Innsending lagret.');
}

async function lockScenario() {
  await supabase.from('scenarios').update({ is_locked:true }).eq('id', SCENARIO_ID);
  state.scenario.is_locked = true;
  updateLockUI();
}
async function unlockScenario() {
  await supabase.from('scenarios').update({ is_locked:false }).eq('id', SCENARIO_ID);
  state.scenario.is_locked = false;
  updateLockUI();
}
function updateLockUI() {
  el('scenarioLock').innerText = state.scenario?.is_locked ? 'låst' : 'ulåst';
  el('lockScenario').classList.toggle('hidden', state.scenario?.is_locked);
  el('unlockScenario').classList.toggle('hidden', !state.scenario?.is_locked);
}

async function resetScenario() {
  if (!confirm('Slette alle innsendinger?')) return;
  await supabase.from('logs').delete().neq('playthrough_id','');
  await supabase.from('time_allocations').delete().neq('id','');
  await supabase.from('budget_allocations').delete().neq('id','');
  await supabase.from('playthroughs').delete().neq('id','');
  alert('Scenario reset.');
}
