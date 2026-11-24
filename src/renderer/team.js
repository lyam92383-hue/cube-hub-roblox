// Cube Hub V2 : l'équipe IA des jeux Roblox, côté fenêtre.
// Onglets d'un projet (Claude / Codex / Rojo / Équipe), panneau « orchestre » avec le journal
// en direct, assistant « Nouveau jeu Roblox » et page de réglages « Équipe IA ».
import { escapeHTML, LONG } from './common/format.js';

const $ = (id) => document.getElementById(id);

export const AGENTS = {
  claude: { icon: '👑', name: 'Claude Code', role: 'Chef d\'orchestre', color: '#D97757' },
  codex: { icon: '🤝', name: 'Codex', role: 'Le second', color: '#10A37F' },
  llm: { icon: '⚡', name: 'LLM local', role: 'Petites tâches', color: '#F5C542' },
  blender: { icon: '🎨', name: 'Blender', role: 'Modèles 3D', color: '#EA7600' },
  studio: { icon: '🎮', name: 'Roblox Studio', role: 'La place du jeu', color: '#00A2FF' },
  brain: { icon: '🧠', name: 'Cerveau', role: 'Obsidian', color: '#A78BFA' },
  mcp: { icon: '🔌', name: 'Outil MCP', role: '', color: '#8E8E93' },
};

export const TABS = [
  { id: 'claude', label: 'Claude', icon: '👑' },
  { id: 'codex', label: 'Codex', icon: '🤝' },
  { id: 'rojo', label: 'Rojo', icon: '🔄' },
  { id: 'equipe', label: 'Équipe', icon: '🧠' },
];

const GENRES = [
  ['obby', 'Obby (parcours)'], ['tycoon', 'Tycoon'], ['simulateur', 'Simulateur'],
  ['combat', 'Combat / PvP'], ['horreur', 'Horreur / histoire'], ['autre', 'Autre'],
];

const ACTION_LABELS = {
  code: 'écrit du code', analyse: 'relit / analyse', overview: 'carte du cerveau', search: 'cherche', read: 'lit une note',
  write: 'écrit une note', log: 'range une info', libre: 'tâche', resumer: 'résume', nommer: 'trouve des noms', luau: 'écrit du Luau',
  donnees: 'génère des données', texte_jeu: 'écrit des textes', traduire: 'traduit', note: 'met en forme une note',
};

let ctx = null;
const events = new Map(); // id du projet → événements (les plus anciens d'abord)
const stats = new Map(); // id du projet → compteurs
const loaded = new Set();
let detected = null;
let detectedAt = 0;
let detecting = null;

export function initTeam(c) {
  ctx = c;
  window.cube.on('team:events', ({ projectId, events: list }) => {
    const all = events.get(projectId) || [];
    const st = stats.get(projectId) || emptyStats();
    for (const e of list) {
      all.push(e);
      if (e.status === 'ok') {
        if (e.agent in st) st[e.agent]++;
        if (e.agent === 'llm' || e.agent === 'codex') st.savedTokens += Number(e.tokens) || 0;
        if (e.agent === 'codex') st.codexFiles += Number(e.files) || 0;
      }
      if (e.status === 'error') st.errors++;
    }
    events.set(projectId, all.slice(-400));
    stats.set(projectId, st);
    ctx.onChange(projectId);
  });
}

const emptyStats = () => ({ codex: 0, llm: 0, brain: 0, blender: 0, studio: 0, savedTokens: 0, codexFiles: 0, errors: 0 });

export async function loadHistory(projectId, force) {
  if (loaded.has(projectId) && !force) return;
  loaded.add(projectId);
  const h = await window.cube.invoke('team:history', projectId);
  events.set(projectId, h.events || []);
  stats.set(projectId, h.stats || emptyStats());
  ctx.onChange(projectId);
}

export async function detectTeam(force) {
  if (!force && detected && Date.now() - detectedAt < 60_000) return detected;
  if (detecting) return detecting;
  detecting = window.cube.invoke('team:detect').then((d) => {
    detected = d;
    detectedAt = Date.now();
    detecting = null;
    return d;
  });
  return detecting;
}

/** Les tâches en cours (événement « start » sans fin), les plus récentes d'abord. */
function jobs(projectId) {
  const byId = new Map();
  for (const e of events.get(projectId) || []) {
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? { ...prev, ...e, startedAt: prev.startedAt || prev.t } : { ...e, startedAt: e.t });
  }
  return [...byId.values()].reverse();
}

export function activeJobs(projectId) {
  const limit = Date.now() - 30 * 60_000;
  return jobs(projectId).filter((j) => j.status === 'start' && Date.parse(j.startedAt) > limit);
}

/** Petite ligne pour la carte du projet : qui travaille en ce moment. */
export function rowHint(projectId) {
  const j = activeJobs(projectId).find((x) => x.agent !== 'brain');
  if (!j) return '';
  const a = AGENTS[j.agent] || AGENTS.mcp;
  return `${a.icon} ${a.name} ${ACTION_LABELS[j.action] || j.action}${j.detail ? ' : ' + j.detail : ''}`;
}

// ------------------------------------------------------------------ Onglets

export function renderTabs(el, row, active, running) {
  if (!row) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const pid = row.project.id;
  const busy = activeJobs(pid).length;
  const html = TABS.map((t) => {
    const termId = t.id === 'claude' ? pid : `${pid}:${t.id}`;
    const dot = t.id === 'equipe' ? (busy ? `<span class="tab-badge">${busy}</span>` : '')
      : `<span class="tab-dot ${running.has(termId) ? 'on' : ''}"></span>`;
    return `<button class="tab ${t.id === active ? 'active' : ''}" data-tab="${t.id}"><span>${t.icon}</span>${t.label}${dot}</button>`;
  }).join('');
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
  el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => ctx.setTab(pid, b.dataset.tab); });
}

// ------------------------------------------------------------------ Panneau « Équipe »

const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')}k` : String(n || 0));
const hhmm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const secs = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace('.', ',')} s`);

function cardStatus(agent, row, d, team) {
  const s = row.session;
  if (agent === 'claude') {
    if (s) return { text: LONG[s.status], cls: `st-${s.status}` };
    return { text: ctx.isRunning(row.project.id) ? 'terminé' : 'terminal fermé', cls: 'st-closed' };
  }
  if (!d) return { text: '…', cls: 'st-closed' };
  if (agent === 'codex') {
    if (!team.codex.enabled) return { text: 'désactivé', cls: 'st-closed' };
    return d.codex.found ? { text: 'prêt', cls: 'st-done' } : { text: 'pas installé', cls: 'st-waiting' };
  }
  if (agent === 'llm') {
    if (!team.llm.enabled) return { text: 'désactivé (optionnel)', cls: 'st-closed' };
    return d.llm.ok ? { text: `prêt · ${team.llm.model || 'choisis un modèle'}`, cls: team.llm.model ? 'st-done' : 'st-waiting' } : { text: d.llm.error || 'injoignable', cls: 'st-waiting' };
  }
  if (agent === 'blender') {
    if (!team.blender.enabled) return { text: 'désactivé', cls: 'st-closed' };
    return d.blender.found ? { text: 'branché (MCP)', cls: 'st-done' } : { text: 'Blender introuvable', cls: 'st-waiting' };
  }
  if (agent === 'studio') {
    if (!team.studio.enabled) return { text: 'désactivé', cls: 'st-closed' };
    return d.studio.mcp ? { text: 'branché (MCP)', cls: 'st-done' } : { text: 'MCP Studio introuvable', cls: 'st-waiting' };
  }
  if (agent === 'brain') {
    if (!d.obsidian.vaultExists) return { text: 'pas encore créé', cls: 'st-waiting' };
    return d.obsidian.found ? { text: d.obsidian.registered ? 'coffre Obsidian' : 'à ouvrir dans Obsidian', cls: d.obsidian.registered ? 'st-done' : 'st-waiting' } : { text: 'dossier (Obsidian pas installé)', cls: 'st-waiting' };
  }
  return { text: '', cls: '' };
}

export function renderTeamPanel(el, row) {
  const pid = row.project.id;
  loadHistory(pid);
  const team = ctx.settings().team;
  if (!detected || Date.now() - detectedAt > 60_000) detectTeam().then(() => { if (!el.hidden) renderTeamPanel(el, row); });
  const d = detected;
  const st = stats.get(pid) || emptyStats();
  const act = activeJobs(pid);
  const count = { codex: st.codex, llm: st.llm, blender: st.blender, studio: st.studio, brain: st.brain };

  const card = (agent, big) => {
    const a = AGENTS[agent];
    const s = cardStatus(agent, row, d, team);
    const job = agent === 'claude' ? (row.session?.status === 'working' ? { detail: row.session.currentTask || 'réfléchit…' } : null) : act.find((j) => j.agent === agent);
    return `<div class="t-card ${big ? 'big' : ''} ${job ? 'busy' : ''}" style="--agent:${a.color}" data-agent="${agent}">
      <div class="t-top"><span class="t-icon">${a.icon}</span>
        <div class="t-id"><div class="t-name">${a.name}</div><div class="t-role">${a.role}</div></div>
        ${agent !== 'claude' ? `<div class="t-count" title="Tâches réussies">${count[agent] || 0}</div>` : ''}</div>
      <div class="t-status ${s.cls}">${escapeHTML(s.text)}</div>
      <div class="t-job">${job ? `<span class="pulse"></span>${escapeHTML(job.detail || ACTION_LABELS[job.action] || '')}` : '&nbsp;'}</div>
    </div>`;
  };

  const feed = jobs(pid).slice(0, 80).map((j) => {
    const a = AGENTS[j.agent] || AGENTS.mcp;
    const state = j.status === 'start' ? '<span class="f-run">en cours…</span>'
      : j.status === 'error' ? '<span class="f-err">✗ erreur</span>'
        : `<span class="f-ok">✓ ${j.ms != null ? secs(j.ms) : ''}</span>`;
    const extra = j.status === 'ok' && j.agent === 'llm' && j.tokens ? `<span class="f-save">~${fmtK(j.tokens)} tokens économisés</span>`
      : j.status === 'ok' && j.agent === 'codex' && j.files ? `<span class="f-save">${j.files} fichier(s)</span>` : '';
    return `<div class="f-line" style="--agent:${a.color}">
      <span class="f-time">${hhmm(j.startedAt)}</span><span class="f-icon">${a.icon}</span>
      <span class="f-who">${a.name}</span><span class="f-what">${escapeHTML(ACTION_LABELS[j.action] || j.action || '')}</span>
      <span class="f-detail">${escapeHTML(j.detail || '')}</span>${extra}${state}</div>`;
  }).join('');

  el.innerHTML = `<div class="team">
    <div class="t-head">
      <div><div class="t-title">L'orchestre de « ${escapeHTML(row.name)} »</div>
        <div class="t-sub">Claude dirige · Codex code les gros morceaux · le LLM local fait les petites tâches · le cerveau retient tout.</div></div>
      <div class="t-actions">
        <button class="btn" data-act="brain">🧠 Ouvrir le cerveau</button>
        <button class="btn" data-act="studio">🎮 Studio</button>
        <button class="btn" data-act="blender">🎨 Blender</button>
      </div>
    </div>
    <div class="t-grid">
      ${card('claude', true)}
      ${['codex', 'llm', 'blender', 'studio', 'brain'].map((a) => card(a)).join('')}
    </div>
    <div class="t-stats">
      <div><b>${st.codex + st.llm}</b> délégation(s)</div>
      <div><b>~${fmtK(st.savedTokens)}</b> tokens que Claude n'a pas dépensés</div>
      <div><b>${st.codexFiles}</b> fichier(s) écrits par Codex</div>
      <div><b>${st.brain}</b> passage(s) au cerveau</div>
      ${st.errors ? `<div class="f-err"><b>${st.errors}</b> erreur(s)</div>` : ''}
    </div>
    <div class="t-feed-head"><span>En direct</span><button class="text-btn" data-act="clear">Vider</button></div>
    <div class="t-feed">${feed || `<div class="t-empty">Rien pour l'instant. Quand Claude délègue à Codex, au LLM local, ou écrit dans le cerveau, ça s'affiche ici.<br><br>
      Astuce : demande à Claude « fais le point avec brain_overview » au début d'une session.</div>`}</div>
  </div>`;
  el.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const act2 = b.dataset.act;
      if (act2 === 'brain') openBrain(row.name);
      if (act2 === 'studio' || act2 === 'blender') {
        const ok = await window.cube.invoke('team:open-app', act2);
        if (!ok) ctx.toast(act2 === 'studio' ? 'Roblox Studio est introuvable sur ce PC.' : 'Blender est introuvable sur ce PC.');
      }
      if (act2 === 'clear') {
        await window.cube.invoke('team:clear', pid);
        events.set(pid, []);
        stats.set(pid, emptyStats());
        renderTeamPanel(el, row);
      }
    };
  });
  el.querySelectorAll('.t-card').forEach((c) => {
    c.onclick = () => {
      const a = c.dataset.agent;
      if (a === 'claude' || a === 'codex') ctx.setTab(pid, a);
      else if (a === 'brain') openBrain(row.name);
      else ctx.openSettings('team');
    };
  });
}

export async function openBrain(name) {
  const r = await window.cube.invoke('team:open-brain', { name });
  if (r.how === 'explorer') {
    ctx.toast(r.obsidian
      ? 'Dans Obsidian : « Ouvrir un dossier comme coffre » et choisis le dossier du cerveau. Ensuite ce bouton l\'ouvrira directement.'
      : 'Obsidian n\'est pas installé : le cerveau s\'ouvre dans l\'Explorateur. Installe Obsidian (obsidian.md) pour le lire joliment.');
  }
}

// ------------------------------------------------------------------ Assistant « Nouveau jeu Roblox »

/** opts.project : transformer un projet existant (même dossier). */
export async function openWizard(opts = {}) {
  const team = ctx.settings().team;
  const existing = opts.project || null;
  const box = $('wizard');
  const body = $('wizardBody');
  let parent = team.gamesDir;
  box.hidden = false;
  body.innerHTML = `<div class="w-title">${existing ? `Transformer « ${escapeHTML(existing.name)} » en jeu Roblox` : '🎮 Nouveau jeu Roblox'}</div>
    <div class="w-sub">Cube Hub prépare le projet (Rojo, Luau), les consignes de l'équipe (CLAUDE.md, AGENTS.md), les branchements MCP et le cerveau Obsidian.${existing ? ' Aucun fichier existant n\'est remplacé.' : ''}</div>
    <label class="w-label">Nom du jeu</label>
    <input type="text" id="wName" value="${escapeHTML(existing ? existing.name : '')}" placeholder="Ex. Pizza Tycoon" spellcheck="false">
    <div class="w-row">
      <div style="flex:1"><label class="w-label">Genre</label>
        <select id="wGenre">${GENRES.map(([id, l]) => `<option value="${id}">${l}</option>`).join('')}</select></div>
    </div>
    <label class="w-label">Le pitch, en une phrase</label>
    <textarea id="wPitch" rows="2" placeholder="Ex. Tu tiens une pizzeria qui grandit jusqu'à devenir une chaîne mondiale."></textarea>
    ${existing ? `<div class="w-where">📁 ${escapeHTML(existing.folder)}</div>` : `<label class="w-label">Emplacement</label>
    <div class="w-where"><span id="wParent">📁 ${escapeHTML(parent)}</span><button class="text-btn" id="wPick">Changer…</button></div>`}
    <label class="w-label">L'équipe</label>
    <div class="w-team" id="wTeam"><span class="note">Recherche des outils…</span></div>
    <label class="w-check"><input type="checkbox" id="wBrief" checked> Lancer Claude avec un brief de démarrage (il te pose ses questions et remplit le cerveau)</label>
    <div class="w-msg" id="wMsg"></div>
    <div class="ask-buttons">
      <button class="btn" id="wCancel">Annuler</button>
      <button class="btn primary" id="wOk">${existing ? 'Transformer' : 'Créer le jeu'}</button>
    </div>`;
  setTimeout(() => $('wName').focus(), 0);
  const close = () => { box.hidden = true; body.innerHTML = ''; };
  $('wCancel').onclick = close;
  box.onmousedown = (e) => { if (e.target === box) close(); };
  $('wPick')?.addEventListener('click', async () => {
    const p = await window.cube.invoke('team:pick-parent');
    if (p) { parent = p; $('wParent').textContent = '📁 ' + p; }
  });
  detectTeam(true).then((d) => {
    if (!$('wTeam')) return;
    const chip = (ok, label, hint) => `<span class="chip ${ok ? 'ok' : 'no'}" title="${escapeHTML(hint || '')}">${ok ? '✓' : '!'} ${label}</span>`;
    $('wTeam').innerHTML = [
      chip(d.claude.found, '👑 Claude Code', d.claude.found ? '' : 'Installe Claude Code : irm https://claude.ai/install.ps1 | iex'),
      chip(d.codex.found && team.codex.enabled, '🤝 Codex', d.codex.found ? (team.codex.enabled ? '' : 'Désactivé dans les réglages') : 'npm i -g @openai/codex puis codex login'),
      chip(team.llm.enabled && d.llm.ok, '⚡ LLM local', team.llm.enabled ? (d.llm.ok ? team.llm.model : d.llm.error) : 'Optionnel : à activer dans Réglages → Équipe IA'),
      chip(d.blender.found && team.blender.enabled, '🎨 Blender', d.blender.found ? 'Active l\'addon MCP dans Blender' : 'Blender introuvable'),
      chip(!!d.studio.mcp && team.studio.enabled, '🎮 Studio', d.studio.mcp ? '' : 'Roblox Studio / MCP introuvable'),
      chip(true, '🧠 Cerveau', team.vault),
    ].join('') + '<a class="w-link" id="wSettings">Régler l\'équipe…</a>';
    $('wSettings').onclick = () => { close(); ctx.openSettings('team'); };
  });
  const submit = async () => {
    const name = $('wName').value.trim();
    if (!name) { $('wMsg').textContent = 'Donne un nom à ton jeu.'; return; }
    $('wOk').disabled = true;
    $('wMsg').textContent = 'Préparation du projet…';
    const genre = $('wGenre').value;
    const pitch = $('wPitch').value.trim();
    const projectId = existing ? existing.id : ctx.uid();
    const r = await window.cube.invoke('team:create-game', {
      projectId, name, genre, pitch, folder: existing ? existing.folder : null, parent,
    });
    if (!r.ok) { $('wMsg').textContent = r.error; $('wOk').disabled = false; return; }
    const brief = $('wBrief').checked;
    close();
    const project = existing || { id: projectId, folder: r.folder, name };
    Object.assign(project, { kind: 'roblox', genre, name });
    ctx.addProject(project, !existing);
    if (brief) {
      const prompt = `Nouveau jeu Roblox « ${name} » (${GENRES.find((g) => g[0] === genre)?.[1]}).${pitch ? ` Pitch : ${pitch}` : ''} ` +
        'Lis CLAUDE.md, appelle team_status puis brain_overview. Ensuite aide-moi à préciser le concept et la boucle de jeu en me posant tes questions une par une, ' +
        'note chaque décision dans le cerveau (brain_log), puis propose un plan de développement par étapes.';
      ctx.startTerminal(project, undefined, { prompt });
    } else {
      ctx.startTerminal(project);
    }
  };
  $('wOk').onclick = submit;
  $('wName').onkeydown = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); };
}

// ------------------------------------------------------------------ Réglages « Équipe IA »

const LLM_PRESETS = [
  ['ollama', 'Ollama', 'http://localhost:11434/v1'],
  ['lmstudio', 'LM Studio', 'http://localhost:1234/v1'],
  ['openwebui', 'Open WebUI', 'http://localhost:3000/api'],
  ['autre', 'Autre (compatible OpenAI)', ''],
];

export async function pageTeam(el, rerender) {
  const settings = ctx.settings();
  const t = settings.team;
  el.innerHTML = '<h2>Équipe IA</h2><div class="note">Recherche des outils…</div>';
  const d = await detectTeam(true);
  if (!el.isConnected) return;
  const tog = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
  const badge = (ok, yes, no) => `<span class="badge ${ok ? 'ok' : 'no'}">${ok ? yes : no}</span>`;
  const preset = LLM_PRESETS.find((p) => p[2] && t.llm.url.replace(/\/+$/, '') === p[2])?.[0] || 'autre';
  el.innerHTML = `<h2>Équipe IA</h2>
    <p class="note">Pour les jeux Roblox : 👑 Claude Code dirige, 🤝 Codex l'aide sur le gros code, ⚡ un LLM local (optionnel) fait les petites tâches
      pour économiser des tokens, 🎨 Blender et 🎮 Roblox Studio sont pilotés par MCP, 🧠 le cerveau Obsidian garde tout bien rangé.</p>

    <div class="group">
      <div class="line"><div class="l-label">👑 Claude Code<div class="l-sub">${d.claude.found ? escapeHTML(d.claude.path) : 'Installe-le : irm https://claude.ai/install.ps1 | iex'}</div></div>${badge(d.claude.found, 'Installé', 'Absent')}</div>
      <div class="line"><div class="l-label">Node.js<div class="l-sub">${d.node.found ? 'Lance le serveur de l\'équipe et le témoin Blender/Studio.' : 'Absent : le serveur de l\'équipe utilisera Electron (le témoin Blender/Studio sera coupé). nodejs.org'}</div></div>${badge(d.node.found, 'Installé', 'Absent')}</div>
      <div class="line"><div class="l-label">🔄 Rojo<div class="l-sub">${d.rojo.found ? 'Synchronise les fichiers .luau avec Studio (onglet Rojo).' : 'Pour synchroniser le code avec Studio : rojo.space (+ plugin Rojo dans Studio).'}</div></div>${badge(d.rojo.found, 'Installé', 'Absent')}</div>
    </div>

    <h3>🧠 Cerveau Obsidian</h3>
    <div class="group">
      <div class="line"><div class="l-label">Coffre<div class="l-sub">${escapeHTML(t.vault)}</div>
          <div class="l-sub">${d.obsidian.found ? (d.obsidian.registered ? 'Obsidian connaît ce coffre.' : 'Dans Obsidian : « Ouvrir un dossier comme coffre » → ce dossier.') : 'Obsidian n\'est pas installé (obsidian.md) — le cerveau marche quand même : ce sont des fichiers .md.'}</div></div>
        <button class="btn" id="tVault">Changer…</button><button class="btn" id="tVaultOpen">Ouvrir</button></div>
      <div class="line"><div class="l-label">Dossier des nouveaux jeux<div class="l-sub">${escapeHTML(t.gamesDir)}</div></div><button class="btn" id="tGames">Changer…</button></div>
    </div>

    <h3>🤝 Codex — le second</h3>
    <div class="group">
      <div class="line"><div class="l-label">Claude peut déléguer à Codex<div class="l-sub">${d.codex.found ? escapeHTML(d.codex.path) : 'Codex n\'est pas installé : npm i -g @openai/codex, puis « codex login ».'}</div></div>${tog('tCodex', t.codex.enabled)}</div>
      <div class="line"><div class="l-label">Droits de Codex</div>
        <select id="tSandbox"><option value="workspace-write" ${t.codex.sandbox === 'workspace-write' ? 'selected' : ''}>Peut modifier le projet</option>
          <option value="read-only" ${t.codex.sandbox === 'read-only' ? 'selected' : ''}>Lecture seule (conseils)</option></select></div>
      <div class="line"><div class="l-label">Modèle<div class="l-sub">Vide = celui de ta config Codex.</div></div><input type="text" id="tCodexModel" value="${escapeHTML(t.codex.model)}" placeholder="par défaut" style="width:170px"></div>
      <div class="line"><div class="l-label">Temps max par tâche</div>
        <select id="tCodexTime">${[5, 15, 30, 60].map((m) => `<option value="${m}" ${Number(t.codex.timeoutMin) === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></div>
    </div>

    <h3>⚡ LLM local — optionnel</h3>
    <div class="group">
      <div class="line"><div class="l-label">Petites tâches au LLM local<div class="l-sub">Résumés, noms, données, textes de jeu, Luau simple. Gratuit, et Claude garde ses tokens pour le reste.</div></div>${tog('tLlm', t.llm.enabled)}</div>
      <div class="line"><div class="l-label">Serveur</div>
        <select id="tPreset">${LLM_PRESETS.map(([id, l]) => `<option value="${id}" ${id === preset ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="line"><div class="l-label">Adresse (compatible OpenAI)</div><input type="text" id="tUrl" value="${escapeHTML(t.llm.url)}" style="width:250px" spellcheck="false"></div>
      <div class="line"><div class="l-label">Clé API<div class="l-sub">Seulement si ton serveur en demande une (Open WebUI : Réglages → Compte → Clés API). Gardée sur ce PC.</div></div><input type="password" id="tKey" value="${escapeHTML(t.llm.key)}" style="width:200px" placeholder="aucune"></div>
      <div class="line"><div class="l-label">Modèle<div class="l-sub" id="tLlmMsg">${t.llm.enabled ? (d.llm.ok ? `🟢 Serveur joignable, ${d.llm.models.length} modèle(s).` : `🔴 ${escapeHTML(d.llm.error)}`) : 'Conseil : un modèle de code de 7-14 milliards de paramètres (ex. qwen2.5-coder).'}</div></div>
        <input type="text" id="tModel" list="tModels" value="${escapeHTML(t.llm.model)}" style="width:200px" placeholder="ex. qwen2.5-coder:7b" spellcheck="false">
        <datalist id="tModels">${(d.llm.models || []).map((m) => `<option value="${escapeHTML(m)}">`).join('')}</datalist>
        <button class="btn" id="tTest">Tester</button></div>
    </div>

    <h3>🎨 Blender et 🎮 Roblox Studio (MCP)</h3>
    <div class="group">
      <div class="line"><div class="l-label">Blender<div class="l-sub">${d.blender.found ? escapeHTML(d.blender.path) : 'Blender introuvable.'} Le serveur MCP Blender doit être actif dans Blender (addon).</div></div>${tog('tBlender', t.blender.enabled)}</div>
      <div class="line"><div class="l-label">Commande du MCP Blender</div><input type="text" id="tBlenderCmd" value="${escapeHTML(t.blender.command)}" style="width:120px" spellcheck="false"><input type="text" id="tBlenderArgs" value="${escapeHTML(t.blender.args)}" style="width:150px" spellcheck="false"></div>
      <div class="line"><div class="l-label">Roblox Studio<div class="l-sub">${d.studio.mcp ? 'MCP de Studio trouvé.' : 'MCP introuvable : installe/ouvre Roblox Studio et active son serveur MCP.'}</div></div>${tog('tStudio', t.studio.enabled)}</div>
      <div class="line"><div class="l-label">Commande du MCP Studio</div><input type="text" id="tStudioCmd" value="${escapeHTML(t.studio.command)}" style="width:290px" spellcheck="false"></div>
    </div>
    <button class="btn" id="tRewire">Rebrancher tous les jeux</button> <span class="note" id="tRewireMsg"></span>
    <p class="note">Les réglages de Codex et du LLM s'appliquent tout de suite. Pour Blender / Studio, les fichiers .mcp.json des jeux sont réécrits :
      relance Claude dans le jeu pour qu'il les voie.</p>`;

  const save = (patch) => window.cube.invoke('state:update', { team: patch });
  const rewire = async () => {
    const done = await window.cube.invoke('team:rewire');
    const m = $('tRewireMsg');
    if (m) m.textContent = done.length ? `✓ ${done.length} jeu(x) rebranché(s).` : 'Aucun jeu Roblox pour l\'instant.';
  };
  $('tVault').onclick = async () => { const p = await window.cube.invoke('team:pick-vault'); if (p) { t.vault = p; await save({ vault: p }); rerender(); } };
  $('tVaultOpen').onclick = () => openBrain(null);
  $('tGames').onclick = async () => { const p = await window.cube.invoke('team:pick-parent'); if (p) { t.gamesDir = p; await save({ gamesDir: p }); rerender(); } };
  $('tCodex').onchange = (e) => { t.codex.enabled = e.target.checked; save({ codex: t.codex }); };
  $('tSandbox').onchange = (e) => { t.codex.sandbox = e.target.value; save({ codex: t.codex }); };
  $('tCodexModel').onchange = (e) => { t.codex.model = e.target.value.trim(); save({ codex: t.codex }); };
  $('tCodexTime').onchange = (e) => { t.codex.timeoutMin = Number(e.target.value); save({ codex: t.codex }); };
  $('tLlm').onchange = async (e) => { t.llm.enabled = e.target.checked; await save({ llm: t.llm }); detected = null; rerender(); };
  $('tPreset').onchange = (e) => {
    const p = LLM_PRESETS.find((x) => x[0] === e.target.value);
    if (p && p[2]) { $('tUrl').value = p[2]; t.llm.url = p[2]; save({ llm: t.llm }); }
  };
  $('tUrl').onchange = (e) => { t.llm.url = e.target.value.trim(); save({ llm: t.llm }); };
  $('tKey').onchange = (e) => { t.llm.key = e.target.value.trim(); save({ llm: t.llm }); };
  $('tModel').onchange = (e) => { t.llm.model = e.target.value.trim(); save({ llm: t.llm }); };
  $('tTest').onclick = async () => {
    $('tLlmMsg').textContent = 'Test…';
    const r = await window.cube.invoke('team:llm-test', { url: $('tUrl').value.trim(), key: $('tKey').value.trim() });
    if (!$('tLlmMsg')) return;
    $('tLlmMsg').textContent = r.ok ? `🟢 Ça marche : ${r.models.length} modèle(s)${r.models.length ? ' — ' + r.models.slice(0, 4).join(', ') + (r.models.length > 4 ? '…' : '') : ''}.` : `🔴 ${r.error}`;
    if (r.ok) $('tModels').innerHTML = r.models.map((m) => `<option value="${escapeHTML(m)}">`).join('');
  };
  $('tBlender').onchange = async (e) => { t.blender.enabled = e.target.checked; await save({ blender: t.blender }); rewire(); };
  $('tBlenderCmd').onchange = async (e) => { t.blender.command = e.target.value.trim(); await save({ blender: t.blender }); rewire(); };
  $('tBlenderArgs').onchange = async (e) => { t.blender.args = e.target.value.trim(); await save({ blender: t.blender }); rewire(); };
  $('tStudio').onchange = async (e) => { t.studio.enabled = e.target.checked; await save({ studio: t.studio }); rewire(); };
  $('tStudioCmd').onchange = async (e) => { t.studio.command = e.target.value.trim(); await save({ studio: t.studio }); rewire(); };
  $('tRewire').onclick = rewire;
}
