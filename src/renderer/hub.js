// La fenêtre Cube Hub : toutes les sessions, rangées par thèmes, avec un vrai terminal par projet.
// Port de Sources/CubeWidget/Hub.
import { Cube, CUBE_CSS, COLORS, loadFrames } from './common/cube.js';
import { play, configureSounds } from './common/sounds.js';
import { LONG, SHORT, duration, tokens, escapeHTML } from './common/format.js';
import { initSetup } from './setup.js';
import { pagePhone } from './phone.js';
import { initTeam, renderTabs, renderTeamPanel, openWizard, pageTeam, rowHint, openBrain, loadHistory } from './team.js';

const $ = (id) => document.getElementById(id);
const style = document.createElement('style');
style.textContent = CUBE_CSS;
document.head.appendChild(style);

const THEME_COLORS = ['#A78BFA', '#F472B6', '#F5C542', '#E879F9', '#E11D48', '#D6C7A1', '#8E8E93'];
const THEME_COLOR_NAMES = ['Violet', 'Rose', 'Jaune', 'Fuchsia', 'Framboise', 'Sable', 'Gris'];

let settings = null;
let sessions = [];
let running = new Set(); // projets dont le terminal tourne
let selected = null;
let hotkey = 'Ctrl+Alt+W';
const rowEls = new Map(); // clé → { wrap, row, cube }
let headerCube = null;
let placeholderCube = null;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const hubState = () => settings.hub;
function saveHub() {
  window.cube.invoke('state:update', { hub: settings.hub });
}

// ------------------------------------------------------------ Démarrage

window.cube.on('init', async (data) => {
  await loadFrames();
  settings = data.settings;
  sessions = data.sessions;
  hotkey = data.hotkey;
  configureSounds(settings.sounds, data.customSounds);
  running = new Set(await window.cube.invoke('term:running'));
  selected = hubState().selected;
  for (const p of hubState().projects) if (p.kind === 'roblox') loadHistory(p.id);
  render();
  setInterval(render, 30_000);
  ready = true;
  setTimeout(() => setup.check(), 1200);
  queued.splice(0).forEach(runCommand);
});
window.cube.on('sessions', (list) => {
  sessions = list;
  render();
});
window.cube.on('settings', (s) => {
  settings = s;
  configureSounds(s.sounds);
  renderToolbar();
  if (!$('modal').hidden) renderSettings();
});
// Une commande peut arriver avant la fin du démarrage (Hub ouvert depuis le menu) : elle attend.
let ready = false;
const queued = [];
window.cube.on('hub:command', (cmd) => (ready ? runCommand(cmd) : queued.push(cmd)));
function runCommand(cmd) {
  if (cmd.select) select(cmd.select);
  if (cmd.selectSession) {
    const r = rows().find((x) => x.session && x.session.id === cmd.selectSession);
    if (r) select(r.key);
  }
  if (cmd.settingsPage) page = cmd.settingsPage;
  if (cmd.settings) openSettings();
  if (cmd.closeSettings) closeSettings();
  if (cmd.debugProject) {
    // Vérification automatique (CUBE_SNAPSHOT) : un projet avec son terminal.
    const p = { id: uid(), folder: cmd.debugProject, name: cmd.debugProject.split(/[\\/]/).pop() };
    hubState().projects.push(p);
    hubState().assign['p:' + p.id] = hubState().themes[0]?.id;
    startTerminal(p);
  }
  if (cmd.debugRoblox) {
    // Vérification automatique : un jeu Roblox, sur l'onglet demandé.
    const p = { id: cmd.debugRoblox.id, folder: cmd.debugRoblox.folder, name: cmd.debugRoblox.name, kind: 'roblox', genre: 'tycoon' };
    hubState().projects.push(p);
    loadHistory(p.id, true);
    selected = 'p:' + p.id;
    tabs.set(p.id, cmd.debugRoblox.tab || 'equipe');
    render();
  }
  if (cmd.debugTab) { tabs.set(cmd.debugTab.id, cmd.debugTab.tab); render(); }
  if (cmd.debugWizard) openWizard();
  if (cmd.debugSetup) setup.preview({ claude: { found: true, loggedIn: false }, codex: { found: false, loggedIn: false } });
  if (cmd.debugCloseWizard) $('wizard').hidden = true;
  if (cmd.debugTheme) {
    hubState().themes.push({ id: uid(), name: cmd.debugTheme, color: THEME_COLORS[0], collapsed: false });
    render();
  }
}
window.cube.on('term:data', ({ projectId, data }) => terms.get(projectId)?.term.write(data));
window.cube.on('term:exit', ({ projectId }) => {
  running.delete(projectId);
  render();
});

// ------------------------------------------------------------ Modèle des lignes

/** Les lignes du Hub : les projets lancés ici, puis les sessions lancées dans un terminal. */
function rows() {
  const h = hubState();
  const list = [];
  const projectIds = new Set(h.projects.map((p) => p.id));
  for (const p of h.projects) {
    const linked = sessions.filter((s) => s.hubProject === p.id).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const session = running.has(p.id) ? linked[0] || null : null;
    list.push({ key: 'p:' + p.id, kind: 'project', project: p, session, name: p.name, folder: p.folder });
  }
  for (const s of sessions) {
    if (s.hubProject && projectIds.has(s.hubProject)) continue;
    list.push({ key: 's:' + s.id, kind: 'external', session: s, name: s.projectName, folder: s.cwd });
  }
  const order = h.order;
  const pos = (k) => {
    const i = order.indexOf(k);
    return i < 0 ? Infinity : i;
  };
  return list.sort((a, b) => pos(a.key) - pos(b.key));
}

function rowStatus(r) {
  if (r.session) return r.session.status;
  if (r.kind === 'project' && running.has(r.project.id)) return 'done';
  return 'closed';
}
function rowMood(r) {
  const st = rowStatus(r);
  return st === 'closed' ? 'sleeping' : st;
}
const stateColor = (st) => (st === 'closed' ? '#8E8E93' : COLORS[st]);

// ------------------------------------------------------------ Liste

function render() {
  if (!settings) return;
  const all = rows();
  // Les nouvelles lignes vont à la fin de l'ordre.
  const h = hubState();
  let changed = false;
  for (const r of all) if (!h.order.includes(r.key)) { h.order.push(r.key); changed = true; }
  const keys = new Set(all.map((r) => r.key));
  const pruned = h.order.filter((k) => keys.has(k) || k.startsWith('p:'));
  if (pruned.length !== h.order.length) { h.order = pruned; changed = true; }
  if (changed) saveHub();

  if (!selected || !keys.has(selected)) selected = all[0]?.key || null;
  renderList(all);
  renderMain(all.find((r) => r.key === selected) || null);
  renderToolbar();
}

function themeOf(key) {
  const id = hubState().assign[key];
  return hubState().themes.find((t) => t.id === id) || null;
}

function renderList(all) {
  const list = $('list');
  const scroll = list.scrollTop;
  list.innerHTML = '';
  const sections = hubState().themes.map((t) => ({ theme: t, rows: all.filter((r) => themeOf(r.key)?.id === t.id) }));
  const loose = all.filter((r) => !themeOf(r.key));
  if (loose.length) sections.push({ theme: null, rows: loose });

  let n = 0;
  const seen = new Set();
  for (const sec of sections) {
    const el = document.createElement('div');
    el.className = 'section' + (sec.theme ? '' : ' no-theme') + (sec.theme?.collapsed ? ' collapsed' : '') + (sec.rows.length ? '' : ' empty');
    if (sec.theme) el.style.setProperty('--theme', sec.theme.color);
    el.innerHTML = `<div class="section-head">${sec.theme ? '<span class="tdot"></span>' : ''}
        <span>${escapeHTML(sec.theme ? sec.theme.name : 'Sans thème')}</span>
        <span class="count">${sec.rows.length}</span>
        <svg class="chev" viewBox="0 0 20 20"><path d="M6 8l4 4 4-4"/></svg></div>
      <div class="panel"></div>`;
    const head = el.querySelector('.section-head');
    head.addEventListener('click', () => {
      if (!sec.theme) return;
      sec.theme.collapsed = !sec.theme.collapsed;
      saveHub();
      render();
    });
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (sec.theme) themeMenu(sec.theme);
    });
    setupDropOnHead(head, sec.theme);
    const panel = el.querySelector('.panel');
    for (const r of sec.rows) {
      n++;
      seen.add(r.key);
      panel.appendChild(rowElement(r, n));
    }
    setupDropOnPanel(panel, sec.theme);
    list.appendChild(el);
  }
  for (const [k, v] of rowEls) {
    if (!seen.has(k)) {
      v.cube.destroy();
      rowEls.delete(k);
    }
  }

  const add = document.createElement('button');
  add.className = 'new-card';
  add.innerHTML = `<span class="plus"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg></span>
    <span><div class="t1">Nouveau jeu Roblox</div><div class="t2">Claude, Codex, Blender, Studio et le cerveau</div></span>`;
  add.addEventListener('click', newGame);
  list.appendChild(add);
  const add2 = document.createElement('button');
  add2.className = 'new-link';
  add2.textContent = 'ou un dossier existant (Claude seul)';
  add2.addEventListener('click', newProject);
  list.appendChild(add2);
  list.scrollTop = scroll;
}

function rowElement(r, position) {
  let item = rowEls.get(r.key);
  if (!item) {
    const wrap = document.createElement('div');
    wrap.className = 'row-wrap';
    wrap.innerHTML = `<span class="row-pos"></span><div class="row" draggable="true"><div class="cube-host"></div>
      <div class="row-text"><div class="row-name"></div><div class="row-detail"></div><div class="row-detail row-task"></div></div></div>`;
    const row = wrap.querySelector('.row');
    const cube = new Cube(wrap.querySelector('.cube-host'), { height: 40 });
    item = { wrap, row, cube, key: r.key };
    rowEls.set(r.key, item);
    row.addEventListener('click', () => select(item.key));
    row.addEventListener('dblclick', () => {
      const cur = rows().find((x) => x.key === item.key);
      if (cur?.kind === 'project' && !running.has(cur.project.id)) startTerminal(cur.project, 'continue');
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      rowMenu(item.key);
    });
    setupDrag(item);
  }
  const st = rowStatus(r);
  item.wrap.querySelector('.row-pos').textContent = position;
  item.row.classList.toggle('selected', r.key === selected);
  item.row.classList.toggle('asleep', st === 'closed');
  item.row.style.setProperty('--state', stateColor(st));
  item.wrap.querySelector('.row-name').innerHTML =
    escapeHTML(r.name) + (r.kind === 'external' ? '<span class="tag">Terminal</span>' : '') + (isRoblox(r) ? '<span class="tag roblox">Roblox</span>' : '');
  const detail = st === 'closed'
    ? `<span class="st-closed">${r.kind === 'project' ? 'terminal fermé' : 'en veille'}</span>`
    : `<span class="st-${st}">${SHORT[st]}</span>` + (r.session ? `<span class="sep">·</span>${escapeHTML(duration(r.session.startedAt))}` : '');
  item.wrap.querySelector('.row-detail').innerHTML = detail;
  const hint = isRoblox(r) ? rowHint(r.project.id) : '';
  const task = hint || r.session?.currentTask || '';
  const taskEl = item.wrap.querySelector('.row-task');
  taskEl.classList.toggle('team-hint', !!hint);
  taskEl.textContent = task;
  taskEl.hidden = !task;
  item.cube.setMood(rowMood(r) === 'done' ? 'done' : rowMood(r));
  item.key = r.key;
  return item.wrap;
}

// ------------------------------------------------------------ Glisser-déposer

let dragKey = null;
function setupDrag(item) {
  item.row.addEventListener('dragstart', (e) => {
    dragKey = item.key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.key);
    requestAnimationFrame(() => item.row.classList.add('dragging'));
  });
  item.row.addEventListener('dragend', () => {
    dragKey = null;
    item.row.classList.remove('dragging');
    clearDropMarks();
  });
  item.wrap.addEventListener('dragover', (e) => {
    if (!dragKey || dragKey === item.key) return;
    e.preventDefault();
    e.stopPropagation();
    const r = item.wrap.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearDropMarks();
    item.wrap.classList.add(after ? 'drop-after' : 'drop-before');
  });
  item.wrap.addEventListener('drop', (e) => {
    if (!dragKey || dragKey === item.key) return;
    e.preventDefault();
    e.stopPropagation();
    const after = item.wrap.classList.contains('drop-after');
    moveRow(dragKey, item.key, after);
    clearDropMarks();
  });
}
function setupDropOnHead(head, theme) {
  head.addEventListener('dragover', (e) => {
    if (!dragKey) return;
    e.preventDefault();
    clearDropMarks();
    head.classList.add('drop');
  });
  head.addEventListener('dragleave', () => head.classList.remove('drop'));
  head.addEventListener('drop', (e) => {
    if (!dragKey) return;
    e.preventDefault();
    assignTheme(dragKey, theme?.id || null);
    clearDropMarks();
  });
}
function setupDropOnPanel(panel, theme) {
  panel.addEventListener('dragover', (e) => {
    if (dragKey) e.preventDefault();
  });
  panel.addEventListener('drop', (e) => {
    if (!dragKey) return;
    e.preventDefault();
    assignTheme(dragKey, theme?.id || null);
    clearDropMarks();
  });
}
function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after, .section-head.drop').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop'));
}
function moveRow(key, targetKey, after) {
  const h = hubState();
  h.order = h.order.filter((k) => k !== key);
  let i = h.order.indexOf(targetKey);
  if (i < 0) i = h.order.length;
  h.order.splice(after ? i + 1 : i, 0, key);
  const t = h.assign[targetKey];
  if (t) h.assign[key] = t;
  else delete h.assign[key];
  saveHub();
  render();
}
function assignTheme(key, themeId) {
  const h = hubState();
  if (themeId) h.assign[key] = themeId;
  else delete h.assign[key];
  // Mis à la fin de ce thème.
  h.order = h.order.filter((k) => k !== key);
  h.order.push(key);
  saveHub();
  render();
}

// ------------------------------------------------------------ Menus

async function rowMenu(key) {
  const r = rows().find((x) => x.key === key);
  if (!r) return;
  const themes = hubState().themes;
  const current = hubState().assign[key] || null;
  const items = [
    {
      label: 'Déplacer vers',
      submenu: [
        ...themes.map((t) => ({ id: 'theme:' + t.id, label: t.name, checked: current === t.id })),
        { type: 'separator' },
        { id: 'theme:', label: 'Sans thème', checked: !current },
      ],
    },
    { id: 'folder', label: 'Ouvrir le dossier' },
    { id: 'terminal', label: 'Ouvrir un terminal ici' },
    { type: 'separator' },
  ];
  if (isRoblox(r)) {
    items.push({ id: 'brain', label: '🧠 Ouvrir le cerveau du jeu' });
    items.push({ id: 'team', label: '👑 Voir l\'équipe' });
    items.push({ type: 'separator' });
  } else if (r.kind === 'project') {
    items.push({ id: 'roblox', label: '🎮 Transformer en jeu Roblox (équipe IA)…' });
    items.push({ type: 'separator' });
  }
  if (r.kind === 'project') {
    if (running.has(r.project.id)) items.push({ id: 'stop', label: 'Fermer le terminal' });
    else {
      items.push({ id: 'continue', label: 'Reprendre la dernière conversation' });
      items.push({ id: 'start', label: 'Nouvelle conversation' });
    }
    items.push({ id: 'remove', label: 'Retirer du Hub' });
  } else {
    items.push({ id: 'adopt', label: 'Reprendre dans le Hub' });
  }
  const choice = await window.cube.invoke('popup-menu', items);
  if (!choice) return;
  if (choice.startsWith('theme:')) return assignTheme(key, choice.slice(6) || null);
  if (choice === 'folder') window.cube.send('open-folder', r.folder);
  if (choice === 'terminal') window.cube.send('open-terminal', r.folder);
  if (choice === 'stop') stopTerminal(r.project);
  if (choice === 'continue') startTerminal(r.project, 'continue');
  if (choice === 'start') startTerminal(r.project);
  if (choice === 'remove') removeProject(r.project);
  if (choice === 'adopt') adopt(r.session);
  if (choice === 'brain') openBrain(r.name);
  if (choice === 'team') setTab(r.project.id, 'equipe');
  if (choice === 'roblox') openWizard({ project: r.project });
}

async function themeMenu(theme) {
  const items = [
    { id: 'rename', label: 'Renommer…' },
    { label: 'Couleur', submenu: THEME_COLORS.map((c, i) => ({ id: 'color:' + c, label: THEME_COLOR_NAMES[i], checked: theme.color === c })) },
    { type: 'separator' },
    { id: 'delete', label: 'Supprimer le thème' },
  ];
  const choice = await window.cube.invoke('popup-menu', items);
  if (!choice) return;
  if (choice === 'rename') {
    const name = await ask('Nom du thème', theme.name);
    if (name) theme.name = name;
  }
  if (choice.startsWith('color:')) theme.color = choice.slice(6);
  if (choice === 'delete') deleteTheme(theme);
  saveHub();
  render();
}

function deleteTheme(theme) {
  const h = hubState();
  h.themes = h.themes.filter((t) => t.id !== theme.id);
  for (const k of Object.keys(h.assign)) if (h.assign[k] === theme.id) delete h.assign[k];
}

async function addTheme() {
  const name = await ask('Nouveau thème', '');
  if (!name) return;
  const used = new Set(hubState().themes.map((t) => t.color));
  const color = THEME_COLORS.find((c) => !used.has(c)) || THEME_COLORS[hubState().themes.length % THEME_COLORS.length];
  hubState().themes.push({ id: uid(), name, color, collapsed: false });
  saveHub();
  render();
}

// Petite fenêtre pour taper un nom (prompt() n'existe pas dans Electron).
function ask(title, value) {
  return new Promise((resolve) => {
    $('askTitle').textContent = title;
    const input = $('askInput');
    input.value = value || '';
    $('ask').hidden = false;
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const done = (v) => {
      $('ask').hidden = true;
      $('askOk').onclick = $('askCancel').onclick = input.onkeydown = null;
      resolve(v ? v.trim() : null);
    };
    $('askOk').onclick = () => done(input.value);
    $('askCancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    };
  });
}

// ------------------------------------------------------------ Projets et terminaux

const newGame = () => openWizard();

async function newProject() {
  const folder = await window.cube.invoke('pick-folder');
  if (!folder) return;
  const name = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder;
  const p = { id: uid(), folder, name };
  hubState().projects.push(p);
  hubState().order.push('p:' + p.id);
  saveHub();
  selected = 'p:' + p.id;
  hubState().selected = selected;
  render();
  startTerminal(p);
}

/** opts.agent : 'claude' (défaut), 'codex' ou 'rojo' (onglets des jeux Roblox) ; opts.prompt : premier message à Claude. */
async function startTerminal(project, resume, opts = {}) {
  const agent = opts.agent || 'claude';
  const termId = agent === 'claude' ? project.id : `${project.id}:${agent}`;
  const t = ensureTerm(termId);
  selected = 'p:' + project.id;
  hubState().selected = selected;
  if (project.kind === 'roblox') tabs.set(project.id, agent);
  render();
  t.fit.fit();
  const res = await window.cube.invoke('term:start', {
    projectId: termId, folder: project.folder, cols: t.term.cols, rows: t.term.rows, resume, agent, prompt: opts.prompt,
  });
  if (!res.ok) {
    t.term.write(`\r\n\x1b[31m${res.error}\x1b[0m\r\n`);
    return;
  }
  running.add(termId);
  render();
  t.term.focus();
}

async function stopTerminal(project) {
  const ok = await window.cube.invoke('confirm', {
    message: `Fermer le terminal de « ${project.name} » ?`,
    detail: 'Claude Code sera arrêté. Tu pourras reprendre la conversation plus tard.',
    ok: 'Fermer',
  });
  if (ok) await window.cube.invoke('term:kill', project.id);
}

async function removeProject(project) {
  if (running.has(project.id)) {
    const ok = await window.cube.invoke('confirm', {
      message: `Retirer « ${project.name} » du Hub ?`,
      detail: 'Son terminal sera fermé (Claude Code arrêté). Le dossier n\'est pas touché.',
      ok: 'Retirer',
    });
    if (!ok) return;
  }
  await window.cube.invoke('term:forget', project.id);
  for (const id of [project.id, `${project.id}:codex`, `${project.id}:rojo`]) {
    const t = terms.get(id);
    if (t) { t.term.dispose(); t.el.remove(); terms.delete(id); }
  }
  const h = hubState();
  h.projects = h.projects.filter((p) => p.id !== project.id);
  h.order = h.order.filter((k) => k !== 'p:' + project.id);
  delete h.assign['p:' + project.id];
  saveHub();
  render();
}

// Une session lancée dans un terminal est reprise dans le Hub, sans perdre la conversation.
async function adopt(session) {
  if (!session) return;
  const ok = await window.cube.invoke('confirm', {
    message: `Reprendre « ${session.projectName} » dans le Cube Hub ?`,
    detail: session.pid
      ? 'Claude Code sera fermé dans son terminal actuel, puis la même conversation reprendra ici.'
      : 'La même conversation reprendra ici (claude --resume).',
    ok: 'Reprendre ici',
  });
  if (!ok) return;
  if (session.pid) await window.cube.invoke('kill-process', session.pid);
  const p = { id: uid(), folder: session.cwd, name: session.projectName };
  const h = hubState();
  const oldKey = 's:' + session.id;
  const i = h.order.indexOf(oldKey);
  h.projects.push(p);
  if (i >= 0) h.order[i] = 'p:' + p.id;
  else h.order.push('p:' + p.id);
  if (h.assign[oldKey]) { h.assign['p:' + p.id] = h.assign[oldKey]; delete h.assign[oldKey]; }
  saveHub();
  await new Promise((r) => setTimeout(r, 400));
  startTerminal(p, session.id);
}

const terms = new Map(); // id du projet → { term, fit, el }
function ensureTerm(projectId) {
  if (terms.has(projectId)) return terms.get(projectId);
  const el = document.createElement('div');
  el.className = 'term';
  $('terms').appendChild(el);
  const term = new window.Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 5000,
    theme: { background: '#000000', foreground: '#e5e5ea', cursor: '#e5e5ea', selectionBackground: '#3a3a3c' },
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  term.onData((data) => window.cube.send('term:input', { projectId, data }));
  term.onResize(({ cols, rows: r }) => window.cube.send('term:resize', { projectId, cols, rows: r }));
  // Ctrl+C copie quand du texte est sélectionné, Ctrl+V colle.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      navigator.clipboard.readText().then((t) => term.paste(t));
      e.preventDefault();
      return false;
    }
    return true;
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
    } else navigator.clipboard.readText().then((t) => term.paste(t));
  });
  const t = { term, fit, el };
  terms.set(projectId, t);
  // Ce qui s'est affiché avant (fenêtre du Hub rouverte).
  window.cube.invoke('term:buffer', projectId).then(({ buffer }) => { if (buffer) term.write(buffer); });
  new ResizeObserver(() => {
    if (el.classList.contains('visible')) try { fit.fit(); } catch {}
  }).observe(el);
  return t;
}

// ------------------------------------------------------------ Zone principale

function select(key) {
  selected = key;
  hubState().selected = key;
  saveHub();
  render();
  const r = rows().find((x) => x.key === key);
  if (r?.kind === 'project') terms.get(termIdFor(r.project))?.term.focus();
}

/** Ce que Claude demande : la question, ou l'outil et sa commande. */
function waitingDetail(s) {
  if (!s) return '';
  const q = s.pendingQuestion?.items?.[0];
  if (q) return `❓ ${q.question}`;
  const p = s.pendingPermission;
  if (p) return `🔐 ${p.tool} : ${p.detail}`;
  return '';
}

function renderMain(r) {
  const header = $('header');
  const ph = $('placeholder');
  for (const t of terms.values()) t.el.classList.remove('visible');

  if (!r) {
    header.innerHTML = '';
    header.hidden = true;
    renderTabs($('tabs'), null);
    $('teamPanel').hidden = true;
    ph.innerHTML = `<div class="ph-cube"></div><div class="p-title">Aucune session</div>
      <div class="p-text">Lance Claude Code dans un terminal (avec Cube Hub branché), ou crée un cube ici pour avoir un terminal par projet.</div>
      <div class="p-buttons"><button class="btn primary" id="phGame">🎮 Nouveau jeu Roblox</button><button class="btn" id="phNew">Dossier existant</button></div>`;
    placeholderCube = new Cube(ph.querySelector('.ph-cube'), { height: 130 });
    placeholderCube.setMood('sleeping');
    $('phNew').onclick = newProject;
    $('phGame').onclick = newGame;
    return;
  }
  header.hidden = false;
  const st = rowStatus(r);
  const s = r.session;
  const parts = [st === 'closed' ? `<span class="st-closed">${r.kind === 'project' ? 'terminal fermé' : 'en veille'}</span>` : `<span class="st-${st}">${LONG[st]}</span>`];
  if (s) parts.push(escapeHTML(duration(s.startedAt)));
  if (s?.contextTokens) parts.push(escapeHTML(tokens(s.contextTokens)));
  const roblox = isRoblox(r);
  const html = `<div class="h-cube"></div>
    <div class="h-text">
      <div class="h-name">${escapeHTML(r.name)}${r.kind === 'external' ? '<span class="tag">Terminal</span>' : ''}</div>
      <div class="h-status">${parts.join('<span class="sep">·</span>')}</div>
      ${s?.currentTask ? `<div class="h-task">${escapeHTML(s.currentTask)}</div>` : `<div class="h-folder">${escapeHTML(r.folder)}</div>`}
      ${st === 'waiting' && waitingDetail(s) ? `<div class="h-task st-waiting">${escapeHTML(waitingDetail(s))}</div>` : ''}
    </div>
    <div class="h-actions">
      ${roblox ? '<button class="icon-btn emoji" id="hBrain" title="Ouvrir le cerveau Obsidian du jeu">🧠</button>' : ''}
      <button class="icon-btn" id="hFolder" title="Ouvrir le dossier"><svg viewBox="0 0 20 20"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3l1.5 1.7h6.5A1.5 1.5 0 0 1 17 8.2v6.3a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/></svg></button>
      <button class="icon-btn" id="hTerm" title="Ouvrir un terminal Windows dans ce dossier"><svg viewBox="0 0 20 20"><path d="M4 6l4 4-4 4M10 14h6"/></svg></button>
    </div>`;
  const key = `${r.key}|${html}`;
  if (header.dataset.key !== key) {
    header.dataset.key = key;
    headerCube?.destroy();
    header.innerHTML = html;
    headerCube = new Cube(header.querySelector('.h-cube'), { height: 50 });
    $('hFolder').onclick = () => window.cube.send('open-folder', r.folder);
    $('hTerm').onclick = () => window.cube.send('open-terminal', r.folder);
    $('hBrain')?.addEventListener('click', () => openBrain(r.name));
  }
  headerCube.setMood(rowMood(r));
  renderTabs($('tabs'), roblox ? r : null, roblox ? currentTab(r.project.id) : null, running);
  $('teamPanel').hidden = true;

  placeholderCube?.destroy();
  placeholderCube = null;
  if (r.kind === 'project') {
    const tab = roblox ? currentTab(r.project.id) : 'claude';
    if (tab === 'equipe') {
      ph.innerHTML = '';
      $('teamPanel').hidden = false;
      renderTeamPanel($('teamPanel'), r);
      return;
    }
    if (tab !== 'claude') return renderAgentTab(r, tab);
    const t = terms.get(r.project.id) || (running.has(r.project.id) ? ensureTerm(r.project.id) : null);
    if (running.has(r.project.id) && t) {
      ph.innerHTML = '';
      t.el.classList.add('visible');
      requestAnimationFrame(() => { try { t.fit.fit(); } catch {} });
      return;
    }
    if (t) {
      // Terminal fermé : on garde ce qu'il affichait, avec les boutons par-dessus.
      t.el.classList.add('visible');
    }
    ph.innerHTML = `<div class="ph-cube"></div><div class="p-title">Terminal fermé</div>
      <div class="p-text">${escapeHTML(r.folder)}</div>
      <div class="p-buttons">
        <button class="btn primary" id="phContinue">Reprendre la dernière conversation</button>
        <button class="btn" id="phStart">Nouvelle conversation</button>
      </div>`;
    ph.style.background = t ? 'rgba(0,0,0,0.82)' : '#000';
    placeholderCube = new Cube(ph.querySelector('.ph-cube'), { height: 110 });
    placeholderCube.setMood('sleeping');
    $('phContinue').onclick = () => startTerminal(r.project, 'continue');
    $('phStart').onclick = () => startTerminal(r.project);
    return;
  }
  ph.style.background = '#000';
  ph.innerHTML = `<div class="ph-cube"></div><div class="p-title">Session lancée dans un terminal</div>
    <div class="p-text">Cette session de Claude Code tourne dans une autre fenêtre. Tu peux la reprendre ici, avec la même conversation.</div>
    <div class="p-buttons">
      <button class="btn primary" id="phAdopt">Reprendre dans le Hub</button>
      <button class="btn" id="phTerm">Ouvrir un terminal ici</button>
    </div>`;
  placeholderCube = new Cube(ph.querySelector('.ph-cube'), { height: 130 });
  placeholderCube.setMood(rowMood(r));
  $('phAdopt').onclick = () => adopt(r.session);
  $('phTerm').onclick = () => window.cube.send('open-terminal', r.folder);
}

// ------------------------------------------------------------ V2 : jeux Roblox et équipe IA

const tabs = new Map(); // id du projet → onglet affiché ('claude' | 'codex' | 'rojo' | 'equipe')
const isRoblox = (r) => r?.kind === 'project' && r.project.kind === 'roblox';
const currentTab = (pid) => tabs.get(pid) || 'claude';
const termIdFor = (p) => (p.kind === 'roblox' && ['codex', 'rojo'].includes(currentTab(p.id)) ? `${p.id}:${currentTab(p.id)}` : p.id);

function setTab(pid, tab) {
  tabs.set(pid, tab);
  selected = 'p:' + pid;
  hubState().selected = selected;
  render();
  const p = hubState().projects.find((x) => x.id === pid);
  if (p) terms.get(termIdFor(p))?.term.focus();
}

// Onglet Codex ou Rojo : son propre terminal dans le dossier du jeu.
function renderAgentTab(r, tab) {
  const ph = $('placeholder');
  const termId = `${r.project.id}:${tab}`;
  const t = terms.get(termId) || (running.has(termId) ? ensureTerm(termId) : null);
  if (running.has(termId) && t) {
    ph.innerHTML = '';
    t.el.classList.add('visible');
    requestAnimationFrame(() => { try { t.fit.fit(); } catch {} });
    return;
  }
  if (t) t.el.classList.add('visible');
  ph.style.background = t ? 'rgba(0,0,0,0.82)' : '#000';
  const info = tab === 'codex'
    ? { icon: '🤝', title: 'Codex, le second', text: 'Claude délègue déjà à Codex tout seul (outil codex_delegate). Ici, tu peux aussi parler à Codex en direct dans le dossier du jeu.', btn: 'Lancer Codex' }
    : { icon: '🔄', title: 'Synchronisation Rojo', text: 'rojo serve envoie les fichiers .luau du projet dans Roblox Studio (plugin Rojo → Connect).', btn: 'Lancer rojo serve' };
  ph.innerHTML = `<div class="ph-emoji">${info.icon}</div><div class="p-title">${info.title}</div>
    <div class="p-text">${info.text}</div>
    <div class="p-buttons"><button class="btn primary" id="phAgent">${info.btn}</button></div>`;
  $('phAgent').onclick = () => startTerminal(r.project, undefined, { agent: tab });
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}
$('toast').onclick = () => { $('toast').hidden = true; };

let teamRenderPending = false;
const setup = initSetup({ settings: () => settings, toast });
initTeam({
  openSetup: () => setup.open(),
  settings: () => settings,
  uid,
  toast,
  setTab,
  isRunning: (id) => running.has(id),
  startTerminal,
  openSettings: (p) => { if (p) page = p; openSettings(); },
  addProject: (project, isNew) => {
    const h = hubState();
    if (isNew) {
      h.projects.push(project);
      h.order.push('p:' + project.id);
    }
    selected = 'p:' + project.id;
    h.selected = selected;
    saveHub();
    loadHistory(project.id, true);
    render();
  },
  onChange: () => {
    if (teamRenderPending || !settings) return;
    teamRenderPending = true;
    requestAnimationFrame(() => { teamRenderPending = false; render(); });
  },
});

// ------------------------------------------------------------ Barre d'outils

const volumeIcon = (v) => {
  const waves = v <= 0 ? '<path d="M13 8l4 4M17 8l-4 4"/>'
    : v < 0.34 ? '<path d="M12.5 8.5a2.5 2.5 0 0 1 0 3"/>'
      : v < 0.67 ? '<path d="M12.5 8.5a2.5 2.5 0 0 1 0 3"/><path d="M14.5 6.5a5.3 5.3 0 0 1 0 7"/>'
        : '<path d="M12.5 8.5a2.5 2.5 0 0 1 0 3"/><path d="M14.5 6.5a5.3 5.3 0 0 1 0 7"/><path d="M16.5 4.8a8 8 0 0 1 0 10.4"/>';
  return `<path d="M3.5 8h2.5l3.5-3v10L6 12H3.5z"/>${waves}`;
};
function renderToolbar() {
  if (!settings) return;
  $('widgetBtn').classList.toggle('on', !!settings.widget.visible);
  $('volumeIcon').innerHTML = volumeIcon(settings.sounds.master);
  $('masterVolume').value = settings.sounds.master;
}
$('widgetBtn').onclick = () => window.cube.send('widget:toggle');
$('volumeBtn').onclick = (e) => {
  e.stopPropagation();
  $('volumePopover').hidden = !$('volumePopover').hidden;
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('#volumePopover')) $('volumePopover').hidden = true;
});
$('masterVolume').oninput = (e) => {
  settings.sounds.master = Number(e.target.value);
  $('volumeIcon').innerHTML = volumeIcon(settings.sounds.master);
  window.cube.invoke('state:update', { sounds: { master: settings.sounds.master } });
};
$('masterVolume').onchange = () => {
  configureSounds(settings.sounds);
  play('fini');
};
$('settingsBtn').onclick = openSettings;
$('newBtn').onclick = async () => {
  const choice = await window.cube.invoke('popup-menu', [
    { id: 'game', label: '🎮 Nouveau jeu Roblox (équipe IA)…' },
    { id: 'folder', label: '📁 Dossier existant (Claude seul)…' },
  ]);
  if (choice === 'game') newGame();
  if (choice === 'folder') newProject();
};
$('addTheme').onclick = addTheme;
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'n' && !e.target.closest('.xterm')) { e.preventDefault(); newGame(); }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openSettings(); }
  if (e.key === 'Escape' && !$('modal').hidden) closeSettings();
});

// ------------------------------------------------------------ Réglages

const PAGES = [
  { id: 'general', label: 'Général', color: '#8E8E93', icon: '<circle cx="10" cy="10" r="2.6"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2"/>' },
  { id: 'widget', label: 'Widget', color: '#5E5CE6', icon: '<rect x="3.5" y="6" width="13" height="9" rx="2.5"/>' },
  { id: 'sounds', label: 'Sons', color: '#FF2D55', icon: '<path d="M4 8h2.5l3.5-3v10L6.5 12H4z"/><path d="M13 7.5a3.5 3.5 0 0 1 0 5"/>' },
  { id: 'notifications', label: 'Notifications', color: '#FF375F', icon: '<path d="M6 13V9a4 4 0 0 1 8 0v4l1.5 2h-11z"/><path d="M8.5 17h3"/>' },
  { id: 'telegram', label: 'Telegram', color: '#2AABEE', icon: '<path d="M3.5 9.5l12-5-2 11-4-3-2 3v-4l6-5"/>' },
  { id: 'team', label: 'Équipe IA', color: '#D97757', icon: '<circle cx="7" cy="8" r="2.2"/><circle cx="13" cy="8" r="2.2"/><path d="M3.5 15.5a3.5 3.5 0 0 1 7 0M9.5 15.5a3.5 3.5 0 0 1 7 0"/>' },
  { id: 'phone', label: 'Téléphone', color: '#34C759', icon: '<rect x="6" y="3" width="8" height="14" rx="2"/><path d="M9 14.5h2"/>' },
  { id: 'hub', label: 'Cube Hub', color: '#30B0C7', icon: '<rect x="3.5" y="4" width="13" height="12" rx="2"/><path d="M8 4v12"/>' },
  { id: 'about', label: 'À propos', color: '#0A84FF', icon: '<circle cx="10" cy="10" r="6.5"/><path d="M10 9v4.5M10 6.5v.2"/>' },
];
let page = 'general';

function openSettings() {
  $('modal').hidden = false;
  renderSettings();
}
function closeSettings() {
  $('modal').hidden = true;
}
$('closeSettings').onclick = closeSettings;
$('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) closeSettings(); });

function renderSettings() {
  $('settingsNav').innerHTML = PAGES.map((p) => `<button class="nav-item ${p.id === page ? 'active' : ''}" data-page="${p.id}">
      <span class="nav-icon" style="background:${p.color}"><svg viewBox="0 0 20 20">${p.icon}</svg></span>${p.label}</button>`).join('');
  $('settingsNav').querySelectorAll('.nav-item').forEach((b) => {
    b.onclick = () => { page = b.dataset.page; renderSettings(); };
  });
  const el = $('settingsPage');
  ({
    general: pageGeneral, widget: pageWidget, sounds: pageSounds, notifications: pageNotifications,
    telegram: pageTelegram, hub: pageHub, about: pageAbout, team: (x) => pageTeam(x, renderSettings), phone: (x) => pagePhone(x, renderSettings, toast),
  })[page](el);
}

const EVENT_LABELS = [
  ['waiting', 'Claude attend ta réponse', 'Une permission, une question, un plan à valider'],
  ['done', 'Réponse terminée', 'Avec le début de la réponse'],
  ['task', 'Tâche terminée', 'Une tâche de la liste de Claude est cochée'],
];
const toggle = (id, on, attrs = '') => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${attrs}><span></span></label>`;

function pageNotifications(el) {
  const n = settings.notifications;
  el.innerHTML = `<h2>Notifications</h2>
    <div class="group">
      <div class="line"><div class="l-label">Bulles de notification Windows
          <div class="l-sub">En bas à droite de l'écran. Un clic ouvre la session dans le Cube Hub.</div></div>
        ${toggle('nWin', n.windows)}</div>
    </div>
    <div class="group" id="nEvents">
      ${EVENT_LABELS.map(([k, label, sub]) => `<div class="line"><div class="l-label">${label}<div class="l-sub">${sub}</div></div>
        ${toggle('nEv-' + k, n.windowsEvents[k], n.windows ? '' : 'disabled')}</div>`).join('')}
    </div>
    <div class="note">Pour être prévenu sur ton téléphone quand tu n'es pas devant le PC, va dans Telegram.</div>`;
  const save = () => window.cube.invoke('state:update', { notifications: settings.notifications });
  $('nWin').onchange = (e) => { n.windows = e.target.checked; save(); renderSettings(); };
  for (const [k] of EVENT_LABELS) {
    $('nEv-' + k).onchange = (e) => { n.windowsEvents[k] = e.target.checked; save(); };
  }
}

let tgDetected = null;
window.cube.on('telegram:detected', (chat) => {
  tgDetected = chat ? 'ok' : 'timeout';
  if (!$('modal').hidden && page === 'telegram') renderSettings();
});

async function pageTelegram(el) {
  const tg = settings.telegram;
  el.innerHTML = '<h2>Telegram</h2><div class="note">Chargement…</div>';
  const st = await window.cube.invoke('telegram:status');
  if (page !== 'telegram') return;
  const save = () => window.cube.invoke('state:update', { telegram: settings.telegram });

  if (!st.connected) {
    el.innerHTML = `<h2>Telegram</h2>
      <p class="note">Reçois sur ton téléphone les nouvelles de tes sessions quand tu n'es pas devant le PC.</p>
      <div class="group">
        <div class="line"><div class="l-label">1. Crée un bot
          <div class="l-sub">Dans Telegram, écris à <a id="tgFather">@BotFather</a>, envoie <b>/newbot</b> et choisis un nom. Il te donne un <b>token</b>.</div></div></div>
        <div class="line"><div class="l-label">2. Colle le token ici
          <div class="l-sub">Il est chiffré par Windows et ne quitte jamais ton PC (sauf vers Telegram).</div>
          <div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="tgToken" placeholder="123456789:AA…" spellcheck="false" style="flex:1">
          <button class="btn primary" id="tgConnect">Connecter</button></div>
          <div class="l-sub" id="tgMsg"></div></div></div>
      </div>`;
    $('tgFather').onclick = () => window.cube.send('open-url', 'https://t.me/BotFather');
    $('tgConnect').onclick = async () => {
      $('tgMsg').textContent = 'Vérification…';
      const r = await window.cube.invoke('telegram:connect', $('tgToken').value);
      if (!r.ok) { $('tgMsg').textContent = r.error; return; }
      tgDetected = null;
      renderSettings();
    };
    return;
  }

  const linked = !!tg.chatId;
  el.innerHTML = `<h2>Telegram</h2>
    <div class="group">
      <div class="line"><div class="l-label">Bot <b>@${escapeHTML(st.botName || '?')}</b>
          <div class="l-sub">${st.error ? escapeHTML(st.error) : linked ? `Relié à ta conversation${tg.chatName ? ` (${escapeHTML(tg.chatName)})` : ''}.` : ''}</div></div>
        <button class="btn danger" id="tgOff">Déconnecter</button></div>
      ${linked ? '' : `<div class="line"><div class="l-label">3. Envoie un message à ton bot
          <div class="l-sub">${tgDetected === 'timeout'
            ? 'Aucun message reçu. Ouvre <b>@' + escapeHTML(st.botName || '') + '</b> dans Telegram, envoie « bonjour », puis réessaie.'
            : st.detecting ? 'J\'attends ton message… (ouvre ton bot dans Telegram et envoie « bonjour »)' : 'Ouvre ton bot dans Telegram et envoie-lui « bonjour ».'}</div></div>
          <button class="btn" id="tgDetect">${st.detecting ? 'En attente…' : 'Chercher'}</button></div>`}
    </div>
    ${linked ? `<div class="group">
      <div class="line"><div class="l-label">Envoyer les notifications sur Telegram</div>${toggle('tgOn', tg.enabled)}</div>
      ${EVENT_LABELS.map(([k, label]) => `<div class="line"><div class="l-label">${label}</div>${toggle('tgEv-' + k, tg.events[k])}</div>`).join('')}
    </div>
    <div class="group">
      <div class="line"><div class="l-label">Seulement quand je suis absent
          <div class="l-sub">Rien n'est envoyé tant que tu utilises le PC. Un événement est envoyé quand tu n'as pas touché la souris ni le clavier depuis :</div></div>
        <select id="tgDelay">${[60, 180, 300, 600].map((s) => `<option value="${s}" ${s === tg.awayDelay ? 'selected' : ''}>${s / 60} min</option>`).join('')}</select></div>
      <div class="line"><div class="l-label">Toujours envoyer<div class="l-sub">Même quand tu es devant le PC.</div></div>${toggle('tgAlways', tg.always)}</div>
    </div>
    <button class="btn" id="tgTest">Envoyer un message test</button> <span class="note" id="tgMsg"></span>
    <h2 style="margin-top:26px">Répondre depuis Telegram</h2>
    <div id="remoteBox"><div class="note">Chargement…</div></div>` : ''}`;

  $('tgOff').onclick = async () => {
    const ok = await window.cube.invoke('confirm', { message: 'Déconnecter Telegram ?', detail: 'Le token est effacé de ce PC. Le bot continue d\'exister dans Telegram.', ok: 'Déconnecter' });
    if (!ok) return;
    await window.cube.invoke('telegram:disconnect');
    renderSettings();
  };
  $('tgDetect')?.addEventListener('click', async () => {
    tgDetected = null;
    await window.cube.invoke('telegram:detect');
    renderSettings();
  });
  if (!linked) return;
  $('tgOn').onchange = (e) => { tg.enabled = e.target.checked; save(); };
  for (const [k] of EVENT_LABELS) $('tgEv-' + k).onchange = (e) => { tg.events[k] = e.target.checked; save(); };
  $('tgDelay').onchange = (e) => { tg.awayDelay = Number(e.target.value); save(); };
  $('tgAlways').onchange = (e) => { tg.always = e.target.checked; save(); };
  $('tgTest').onclick = async () => {
    $('tgMsg').textContent = 'Envoi…';
    const r = await window.cube.invoke('telegram:test');
    $('tgMsg').textContent = r.ok ? 'Envoyé ! Regarde ton téléphone.' : r.error;
  };
  renderRemote($('remoteBox'));
}

window.cube.on('remote:status', () => {
  if (!$('modal').hidden && page === 'telegram' && $('remoteBox') && !$('setupCode')) renderRemote($('remoteBox'));
});

async function renderRemote(box) {
  const st = await window.cube.invoke('remote:status');
  if (!box.isConnected) return;
  const c = settings.telegram.commands;
  if (!st.configured) {
    box.innerHTML = `<p class="note">Écris à tes sessions, réponds ✅ Oui / ❌ Non aux permissions et choisis les réponses aux questions,
        depuis ton téléphone. Pour que personne d'autre ne puisse le faire, il faut d'abord déverrouiller avec un code à 6 chiffres
        de ton app d'authentification (Google Authenticator, Microsoft Authenticator, 2FAS…).</p>
      <button class="btn primary" id="setupBegin">Configurer le code de déverrouillage</button>`;
    $('setupBegin').onclick = async () => {
      const s = await window.cube.invoke('remote:setup-begin');
      box.innerHTML = `<div class="group"><div class="line" style="align-items:flex-start;gap:16px">
          <img src="${s.qr}" width="160" height="160" style="border-radius:8px;flex:none" alt="QR code">
          <div class="l-label">1. Scanne ce QR code avec ton app d'authentification
            <div class="l-sub">Ou saisis la clé à la main : <code style="user-select:all">${escapeHTML(s.secret)}</code></div>
            <div style="margin-top:12px">2. Tape le code à 6 chiffres qu'elle affiche</div>
            <div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="setupCode" maxlength="7" placeholder="123 456" style="width:110px">
              <button class="btn primary" id="setupOk">Valider</button></div>
            <div class="l-sub" id="setupMsg"></div></div></div></div>`;
      $('setupCode').focus();
      const ok = async () => {
        const r = await window.cube.invoke('remote:setup-confirm', $('setupCode').value);
        if (!r.ok) { $('setupMsg').textContent = r.error; return; }
        renderRemote(box);
      };
      $('setupOk').onclick = ok;
      $('setupCode').onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    };
    return;
  }
  const projects = hubState().projects;
  const until = st.unlockedUntil ? new Date(st.unlockedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
  box.innerHTML = `<div class="group">
      <div class="line"><div class="l-label">Commandes depuis Telegram
          <div class="l-sub">Écrire à une session (réponds à son message), boutons Oui / Non et choix aux questions.</div></div>
        ${toggle('rOn', c.enabled)}</div>
      <div class="line"><div class="l-label">${until ? `🔓 Déverrouillé jusqu'à ${until}` : '🔒 Verrouillé'}
          <div class="l-sub">Envoie <b>/unlock</b> et ton code à ton bot pour déverrouiller 30 minutes. <b>/aide</b> donne la liste des commandes.</div></div>
        ${until ? '<button class="btn" id="rLock">Verrouiller</button>' : ''}</div>
    </div>
    <div class="group">
      <div class="line"><div class="l-label">Projets autorisés
        <div class="l-sub">Seules les sessions lancées dans un terminal du Cube Hub peuvent recevoir des messages. Autorise-les une par une.</div></div></div>
      ${projects.length ? projects.map((p) => `<div class="line"><div class="l-label">${escapeHTML(p.name)}<div class="l-sub">${escapeHTML(p.folder)}</div></div>
        ${toggle('rP-' + p.id, !!c.allowed[p.id], 'data-project="' + p.id + '"')}</div>`).join('')
        : '<div class="line"><div class="l-label l-sub">Aucun projet dans le Hub pour l\'instant (bouton « Nouveau cube »).</div></div>'}
    </div>
    <button class="btn" id="rLog">Ouvrir le journal</button>
    <button class="btn danger" id="rRemove">Supprimer le code</button>`;
  $('rOn').onchange = (e) => window.cube.invoke('remote:set', { enabled: e.target.checked });
  $('rLock')?.addEventListener('click', async () => { await window.cube.invoke('remote:lock'); renderRemote(box); });
  box.querySelectorAll('[data-project]').forEach((input) => {
    input.onchange = () => window.cube.invoke('remote:set', { allowed: { [input.dataset.project]: input.checked } });
  });
  $('rLog').onclick = () => window.cube.send('remote:open-log');
  $('rRemove').onclick = async () => {
    const ok = await window.cube.invoke('confirm', { message: 'Supprimer le code de déverrouillage ?', detail: 'Les commandes depuis Telegram seront coupées. Tu pourras en configurer un nouveau.', ok: 'Supprimer' });
    if (!ok) return;
    await window.cube.invoke('remote:remove-code');
    renderRemote(box);
  };
}

async function pageGeneral(el) {
  el.innerHTML = '<h2>Général</h2><div class="note">Chargement…</div>';
  const [hk, login] = await Promise.all([window.cube.invoke('hooks:status'), window.cube.invoke('login-item:get')]);
  const installed = hk.status === 'installed';
  const label = { installed: 'Branché', partial: 'Branché en partie', missing: 'Pas branché', unreadable: 'Fichier illisible' }[hk.status];
  el.innerHTML = `<h2>Général</h2>
    <div class="group">
      <div class="line"><div class="l-label">Claude Code
          <div class="l-sub">Cube Hub sait ce que font tes sessions grâce aux hooks de Claude Code, dans ${escapeHTML(hk.path)}.</div></div>
        <span class="badge ${installed ? 'ok' : 'no'}">${label}</span></div>
      <div class="line"><div class="l-label"><div class="l-sub" id="hookMsg">Une copie de ton fichier est faite avant chaque changement. Tes autres réglages et hooks ne sont pas touchés.</div></div>
        ${installed ? '<button class="btn danger" id="unplug">Débrancher</button>' : '<button class="btn primary" id="plug">Brancher Claude Code</button>'}</div>
    </div>
    <div class="group">
      <div class="line"><div class="l-label">Ouvrir Cube Hub au démarrage de Windows</div>
        <label class="switch"><input type="checkbox" id="login" ${login ? 'checked' : ''}><span></span></label></div>
      <div class="line"><div class="l-label">Afficher / masquer le widget<div class="l-sub">Depuis n'importe quelle app</div></div>
        <span class="badge ok" style="background:#2c2c2e;color:#fff">${escapeHTML(hotkey)}</span></div>
    </div>
    <div class="note">Les sessions déjà ouvertes apparaissent à leur prochain événement (ton prochain message à Claude).</div>`;
  const msg = (t) => { $('hookMsg').textContent = t; };
  $('plug')?.addEventListener('click', async () => {
    const r = await window.cube.invoke('hooks:install');
    if (!r.ok) return msg(r.error);
    pageGeneral(el);
  });
  $('unplug')?.addEventListener('click', async () => {
    const ok = await window.cube.invoke('confirm', { message: 'Débrancher Cube Hub de Claude Code ?', detail: 'Le widget ne verra plus tes sessions.', ok: 'Débrancher' });
    if (!ok) return;
    const r = await window.cube.invoke('hooks:uninstall');
    if (!r.ok) return msg(r.error);
    pageGeneral(el);
  });
  $('login').onchange = (e) => window.cube.invoke('login-item:set', e.target.checked);
}

function pageWidget(el) {
  const w = settings.widget;
  el.innerHTML = `<h2>Widget</h2>
    <div class="group">
      <div class="line"><div class="l-label">Afficher le widget<div class="l-sub">${escapeHTML(hotkey)} le montre ou le cache depuis n'importe quelle app.</div></div>
        <label class="switch"><input type="checkbox" id="wVisible" ${w.visible ? 'checked' : ''}><span></span></label></div>
      <div class="line"><div class="l-label">Taille</div>
        <select id="wScale">${[1, 0.9, 0.8, 0.7, 0.6].map((v) => `<option value="${v}" ${Math.abs(v - w.scale) < 0.01 ? 'selected' : ''}>${Math.round(v * 100)} %</option>`).join('')}</select></div>
    </div>
    <div class="note">Clic sur la carte : la replier ou la déplier. Double-clic : ouvrir le Cube Hub sur ce projet.
      Clic sur une petite carte : la faire passer devant. Glisser : déplacer le widget. Clic droit : menu.</div>`;
  $('wVisible').onchange = () => window.cube.send('widget:toggle');
  $('wScale').onchange = (e) => window.cube.send('widget:set-scale', Number(e.target.value));
}

function pageSounds(el) {
  const s = settings.sounds;
  const line = (id, label, sub) => `<div class="line"><div class="l-label">${label}<div class="l-sub">${sub}</div></div>
      <input type="range" min="0" max="1" step="0.01" value="${s[id]}" data-sound="${id}">
      <button class="icon-btn" data-test="${id}" title="Écouter"><svg viewBox="0 0 20 20"><path d="M7 5l8 5-8 5z"/></svg></button></div>`;
  el.innerHTML = `<h2>Sons</h2>
    <div class="group">
      <div class="line"><div class="l-label">Volume général</div>
        <input type="range" min="0" max="1" step="0.01" value="${s.master}" data-sound="master"></div>
    </div>
    <div class="group">
      ${line('bosse', 'Claude se met au travail', 'Le projet actif commence à bosser')}
      ${line('attente', 'Claude attend ta réponse', 'Une permission, une question, un plan')}
      ${line('fini', 'Terminé', 'Une tâche ou une réponse est finie')}
      ${line('dodo', 'Le cube s\'endort', 'Plus aucune session')}
    </div>
    <div class="note">Pour tes propres sons, mets des fichiers nommés bosse, fini, attente ou dodo (.wav, .mp3, .m4a, .ogg)
      dans <a id="soundsFolder">%USERPROFILE%\\.cube-widget\\Sons</a> et relance l'app.</div>`;
  el.querySelectorAll('input[data-sound]').forEach((input) => {
    input.oninput = () => {
      settings.sounds[input.dataset.sound] = Number(input.value);
      configureSounds(settings.sounds);
      window.cube.invoke('state:update', { sounds: { [input.dataset.sound]: Number(input.value) } });
      renderToolbar();
    };
  });
  el.querySelectorAll('[data-test]').forEach((b) => { b.onclick = () => play(b.dataset.test, { force: true }); });
  $('soundsFolder').onclick = () => window.cube.send('sounds:open-folder');
}

function pageHub(el) {
  const themes = hubState().themes;
  el.innerHTML = `<h2>Cube Hub</h2>
    <div class="group">
      ${themes.length ? themes.map((t) => `<div class="line" data-theme="${t.id}">
          <span class="color-dot" style="background:${t.color}"></span>
          <input type="text" value="${escapeHTML(t.name)}" data-name style="flex:1">
          <select data-color style="width:110px">${THEME_COLORS.map((c, i) => `<option value="${c}" ${c === t.color ? 'selected' : ''}>${THEME_COLOR_NAMES[i]}</option>`).join('')}</select>
          <button class="icon-btn" data-delete title="Supprimer"><svg viewBox="0 0 20 20"><path d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5"/></svg></button>
        </div>`).join('') : '<div class="line"><div class="l-label l-sub">Aucun thème pour l\'instant.</div></div>'}
    </div>
    <button class="btn" id="hubAddTheme">Ajouter un thème</button>
    <p class="note">Les thèmes rangent tes sessions comme des intercalaires ("Freelance", "Projet perso"…).
      Glisse une carte sur le titre d'un thème pour l'y ranger, ou utilise le clic droit → Déplacer vers.</p>`;
  el.querySelectorAll('[data-theme]').forEach((line) => {
    const t = themes.find((x) => x.id === line.dataset.theme);
    line.querySelector('[data-name]').onchange = (e) => { t.name = e.target.value.trim() || t.name; saveHub(); render(); };
    line.querySelector('[data-color]').onchange = (e) => { t.color = e.target.value; saveHub(); render(); renderSettings(); };
    line.querySelector('[data-delete]').onclick = () => { deleteTheme(t); saveHub(); render(); renderSettings(); };
  });
  $('hubAddTheme').onclick = async () => { await addTheme(); renderSettings(); };
}

function pageAbout(el) {
  el.innerHTML = `<h2>À propos</h2>
    <div class="group"><div class="line"><div class="l-label">Cube Hub V2 — édition Roblox Studio
      <div class="l-sub">Un orchestre d'IA pour créer des jeux Roblox : Claude Code dirige, Codex l'aide, un LLM local fait les petites tâches,
        Blender et Roblox Studio sont pilotés par MCP, et un cerveau Obsidian garde tout bien rangé.</div></div></div>
      <div class="line"><div class="l-label">Cube Hub pour Windows
      <div class="l-sub">Portage Windows de Cube Hub, l'app macOS de Harlo9 (licence MIT). Le cube et ses animations viennent du projet original.</div></div></div></div>
    <p class="note"><a id="repo">github.com/Harlo9/cube-hub</a></p>
`;
  $('repo').onclick = () => window.cube.send('open-url', 'https://github.com/Harlo9/cube-hub');
}
