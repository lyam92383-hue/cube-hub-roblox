#!/usr/bin/env node
// Cube Hub V2 : serveur MCP « cube-equipe ».
// Claude Code (le chef d'orchestre) l'utilise pour :
//   - déléguer du code à Codex (le second)          → codex_delegate
//   - confier les petites tâches au LLM local        → llm_quick
//   - lire / écrire dans le cerveau Obsidian         → brain_*
//   - savoir qui est disponible dans l'équipe        → team_status
// Fichier autonome (seulement les modules de Node) : Cube Hub le copie dans
// ~/.cube-widget/bin et le lance avec Node, ou avec Electron en mode Node.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '2.0.0';
const BASE = process.env.CUBE_WIDGET_DIR || path.join(os.homedir(), '.cube-widget');
const CONFIG_FILE = path.join(BASE, 'equipe.json');
const LOG_DIR = path.join(BASE, 'equipe');

const PROJECT_ID = process.env.CUBE_HUB_PROJECT || 'sans-projet';
const PROJECT_DIR = path.resolve(process.env.CUBE_PROJECT_DIR || process.cwd());
const GAME = process.env.CUBE_GAME_NAME || path.basename(PROJECT_DIR);

// ------------------------------------------------------------------ Réglages

function config() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')); } catch {}
  return {
    vault: c.vault || path.join(os.homedir(), 'Documents', 'Cerveau Roblox'),
    llm: { enabled: false, url: 'http://localhost:11434/v1', key: '', model: '', maxTokens: 2048, ...(c.llm || {}) },
    codex: { enabled: true, command: 'codex', sandbox: 'workspace-write', model: '', timeoutMin: 15, ...(c.codex || {}) },
  };
}

const vaultRoot = () => path.resolve(config().vault);
const gameDir = () => path.join(vaultRoot(), 'Jeux', safeName(GAME));
const safeName = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Sans titre';
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toTimeString().slice(0, 5);

// ------------------------------------------------------------------ Journal d'activité (lu par le Hub)

function log(event) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, `${PROJECT_ID}.jsonl`),
      JSON.stringify({ t: new Date().toISOString(), project: PROJECT_ID, game: GAME, ...event }) + '\n');
  } catch {}
}

async function tracked(agent, action, detail, fn) {
  const id = crypto.randomBytes(4).toString('hex');
  const started = Date.now();
  log({ id, agent, action, detail: short(detail, 160), status: 'start' });
  try {
    const r = await fn();
    log({ id, agent, action, detail: short(detail, 160), status: 'ok', ms: Date.now() - started, ...(r && r.meta) });
    return r;
  } catch (e) {
    log({ id, agent, action, detail: short(e.message, 200), status: 'error', ms: Date.now() - started });
    throw e;
  }
}

const short = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const estTokens = (s) => Math.ceil(String(s || '').length / 3.6);

// ------------------------------------------------------------------ Chemins sûrs

function inside(base, p) {
  const r = path.resolve(base, p);
  const b = path.resolve(base);
  if (r !== b && !r.startsWith(b + path.sep)) throw new Error(`Chemin hors de la zone autorisée : ${p}`);
  return r;
}

/** Fichier du projet ou du cerveau ("cerveau:Jeux/…" ou "cerveau:…"). */
function resolveAnyFile(p) {
  if (/^cerveau:/i.test(p)) return inside(vaultRoot(), p.replace(/^cerveau:\/?/i, ''));
  return inside(PROJECT_DIR, p);
}

function notePath(note, scope) {
  let rel = String(note || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel) throw new Error('Nom de note vide.');
  if (!/\.md$/i.test(rel)) rel += '.md';
  rel = rel.split('/').map((seg, i, a) => (i === a.length - 1 ? safeName(seg.replace(/\.md$/i, '')) + '.md' : safeName(seg))).join('/');
  const base = scope === 'vault' ? vaultRoot() : gameDir();
  return inside(base, rel);
}

const relVault = (abs) => path.relative(vaultRoot(), abs).replace(/\\/g, '/');

// ------------------------------------------------------------------ Outils : Codex

function quote(a) { return /[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a; }

function snapshotFiles(dir) {
  const out = new Map();
  const skip = new Set(['node_modules', '.git', 'Packages', 'DevPackages', '.cube']);
  const walk = (d, depth) => {
    if (depth > 8 || out.size > 6000) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else try { const st = fs.statSync(f); out.set(f, `${st.size}:${st.mtimeMs}`); } catch {}
    }
  };
  walk(dir, 0);
  return out;
}

async function codexDelegate({ task, files = [], mode = 'write', context = '' }) {
  const c = config().codex;
  if (!c.enabled) throw new Error('Codex est désactivé dans Cube Hub (Réglages → Équipe IA). Fais la tâche toi-même.');
  if (!task) throw new Error('Il faut décrire la tâche.');
  const sandbox = mode === 'read' ? 'read-only' : (c.sandbox || 'workspace-write');
  const prompt = [
    `Tu es Codex, le second de Claude Code (chef d'orchestre) sur le jeu Roblox « ${GAME} ».`,
    'Respecte AGENTS.md à la racine du projet. Code en Luau strict, propre, commenté en français.',
    mode === 'read' ? 'Mode lecture seule : analyse et réponds, ne modifie aucun fichier.' : 'Tu peux modifier les fichiers du projet, rien en dehors.',
    files.length ? `Fichiers concernés : ${files.join(', ')}` : '',
    context ? `Contexte donné par Claude :\n${context}` : '',
    `\nTÂCHE :\n${task}`,
    '\nTermine par un résumé court (5 lignes max) : ce que tu as fait, fichiers touchés, points à vérifier.',
  ].filter(Boolean).join('\n');

  return tracked('codex', mode === 'read' ? 'analyse' : 'code', task, () => new Promise((resolve, reject) => {
    const before = mode === 'read' ? null : snapshotFiles(PROJECT_DIR);
    const outFile = path.join(os.tmpdir(), `cube-codex-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--color', 'never', '--sandbox', sandbox, '-C', PROJECT_DIR, '--output-last-message', outFile];
    if (c.model) args.push('-m', c.model);
    args.push('-');
    const cmdLine = [quote(c.command || 'codex'), ...args.map(quote)].join(' ');
    let out = '';
    let child;
    try {
      child = spawn(cmdLine, { cwd: PROJECT_DIR, shell: true, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
    } catch (e) {
      return reject(new Error(`Impossible de lancer Codex : ${e.message}`));
    }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, (Number(c.timeoutMin) || 15) * 60000);
    child.stdout.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000); });
    child.stderr.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Codex introuvable (${e.message}). Installe-le : npm i -g @openai/codex`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let last = '';
      try { last = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch {}
      if (/n'est pas reconnu|not recognized|command not found/i.test(out) && !last) {
        return reject(new Error('Codex n\'est pas installé sur ce PC. Installe-le : npm i -g @openai/codex, puis « codex login ».'));
      }
      const changed = [];
      if (before) {
        const after = snapshotFiles(PROJECT_DIR);
        for (const [f, sig] of after) if (before.get(f) !== sig) changed.push(path.relative(PROJECT_DIR, f));
        for (const f of before.keys()) if (!after.has(f)) changed.push(path.relative(PROJECT_DIR, f) + ' (supprimé)');
      }
      const answer = last || short(out.split('\n').slice(-40).join('\n'), 4000);
      if (code !== 0 && !last) return reject(new Error(`Codex s'est arrêté (code ${code}).\n${short(out.split('\n').slice(-25).join('\n'), 2500)}`));
      resolve({
        text: `## Réponse de Codex\n${answer}\n\n## Fichiers modifiés\n${changed.length ? changed.map((f) => '- ' + f).join('\n') : '(aucun)'}` +
          '\n\nVérifie le travail de Codex (relis les fichiers modifiés) avant de dire que c\'est fini.',
        meta: { files: changed.length, tokens: estTokens(out) },
      });
    });
    child.stdin.end(prompt);
  }));
}

// ------------------------------------------------------------------ Outils : LLM local

const LLM_STYLES = {
  libre: 'Tu es un assistant rapide et précis. Réponds directement, sans préambule.',
  resumer: 'Résume de façon factuelle et compacte, en français, avec des puces. Garde les noms exacts (fichiers, fonctions, variables).',
  nommer: 'Propose des noms courts et clairs. Réponds seulement par la liste.',
  luau: 'Tu écris du Luau pour Roblox (typage strict --!strict, services via game:GetService). Réponds seulement par le code, sans explication ni balises markdown.',
  donnees: 'Tu génères des données structurées (tables Luau ou JSON) exactement au format demandé. Réponds seulement par les données.',
  texte_jeu: 'Tu écris des textes de jeu Roblox (dialogues, descriptions d\'objets, quêtes, UI) courts, vivants, adaptés aux 9-16 ans, sans contenu inapproprié.',
  traduire: 'Traduis fidèlement en gardant le format. Réponds seulement par la traduction.',
  note: 'Tu écris des notes Obsidian en markdown bien structurées (titres, puces, liens [[...]] vers les notes citées). Pas de frontmatter.',
};

async function llmQuick({ task, input = '', files = [], style = 'libre', write_to = '' }) {
  const c = config().llm;
  if (!c.enabled) throw new Error('Le LLM local est désactivé (Cube Hub → Réglages → Équipe IA). Fais cette tâche toi-même.');
  if (!c.model) throw new Error('Aucun modèle choisi pour le LLM local (Cube Hub → Réglages → Équipe IA).');
  if (!task) throw new Error('Il faut décrire la tâche.');
  let content = input ? `${input}\n\n` : '';
  for (const f of files.slice(0, 12)) {
    const abs = resolveAnyFile(f);
    let txt;
    try { txt = fs.readFileSync(abs, 'utf8'); } catch { throw new Error(`Fichier illisible : ${f}`); }
    content += `--- ${f} ---\n${txt.slice(0, 60000)}\n\n`;
  }
  const messages = [
    { role: 'system', content: `${LLM_STYLES[style] || LLM_STYLES.libre}\nProjet : jeu Roblox « ${GAME} ».` },
    { role: 'user', content: `${task}${content ? `\n\n${content}` : ''}` },
  ];
  return tracked('llm', style, task, async () => {
    const url = String(c.url || '').replace(/\/+$/, '') + '/chat/completions';
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
        body: JSON.stringify({ model: c.model, messages, temperature: 0.2, max_tokens: Number(c.maxTokens) || 2048, stream: false }),
        signal: AbortSignal.timeout(180000),
      });
    } catch (e) {
      throw new Error(`LLM local injoignable (${c.url}) : ${e.message}. Fais la tâche toi-même.`);
    }
    if (!res.ok) throw new Error(`LLM local : erreur ${res.status} ${short(await res.text().catch(() => ''), 300)}`);
    const j = await res.json();
    let text = (j.choices?.[0]?.message?.content || '').trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (style === 'luau' || style === 'donnees') text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '');
    const used = j.usage || {};
    const saved = (used.completion_tokens || estTokens(text)) + (files.length ? estTokens(content) : 0);
    if (write_to) {
      const abs = resolveAnyFile(write_to);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text + '\n');
      return {
        text: `Le LLM local (${c.model}) a écrit ${text.length} caractères dans ${write_to}. Relis-le si c'est du code important.`,
        meta: { tokens: saved, model: c.model },
      };
    }
    return { text: `Réponse du LLM local (${c.model}) — à vérifier si c'est critique :\n\n${text}`, meta: { tokens: saved, model: c.model } };
  });
}

// ------------------------------------------------------------------ Outils : cerveau Obsidian

function frontmatter(fields) {
  const lines = Object.entries(fields).filter(([, v]) => v != null && v !== '').map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.map((x) => JSON.stringify(String(x))).join(', ')}]` : `${k}: ${JSON.stringify(String(v))}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function touchUpdated(text) {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return text;
  let head = text.slice(0, end);
  head = /\nmaj: /.test(head) ? head.replace(/\nmaj: .*/, `\nmaj: "${today()}"`) : head + `\nmaj: "${today()}"`;
  return head + text.slice(end);
}

function listNotes(dir, max = 4000) {
  const out = [];
  const walk = (d) => {
    if (out.length >= max) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.md')) out.push(f);
    }
  };
  walk(dir);
  return out;
}

function brainSearch({ query, scope = 'jeu', max = 8 }) {
  const root = scope === 'savoir' ? path.join(vaultRoot(), 'Savoir') : scope === 'tout' ? vaultRoot() : gameDir();
  const terms = String(query || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9_]+/).filter((t) => t.length > 1);
  if (!terms.length) throw new Error('Recherche vide.');
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const results = [];
  for (const f of listNotes(root)) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const n = norm(txt);
    const name = norm(path.basename(f));
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 6;
      let i = -1; let k = 0;
      while ((i = n.indexOf(t, i + 1)) >= 0 && k < 20) k++;
      score += k;
    }
    if (!score) continue;
    const lines = txt.split('\n');
    const hit = lines.filter((l) => terms.some((t) => norm(l).includes(t)) && !/^---|^\w+: /.test(l)).slice(0, 3).map((l) => '    ' + short(l, 160));
    results.push({ score, rel: relVault(f), hit });
  }
  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, Math.min(Number(max) || 8, 20));
  return {
    text: top.length ? top.map((r) => `- ${r.rel}\n${r.hit.join('\n')}`).join('\n') + `\n\n(${results.length} note(s) trouvée(s). Lis-en une avec brain_read.)`
      : `Rien trouvé pour « ${query} » (${scope}).`,
    meta: { hits: results.length },
  };
}

function resolveNote(note) {
  const cands = [];
  try { cands.push(notePath(note, 'jeu')); } catch {}
  try { cands.push(notePath(note, 'vault')); } catch {}
  for (const c of cands) if (fs.existsSync(c)) return c;
  // Par titre seul : cherche le fichier du même nom partout dans le cerveau.
  const want = safeName(path.basename(String(note).replace(/\.md$/i, ''))).toLowerCase() + '.md';
  const found = listNotes(vaultRoot()).find((f) => path.basename(f).toLowerCase() === want);
  if (found) return found;
  throw new Error(`Note introuvable : ${note}. Utilise brain_search ou brain_overview.`);
}

function brainRead({ note }) {
  const f = resolveNote(note);
  const txt = fs.readFileSync(f, 'utf8');
  return { text: `# ${relVault(f)}\n\n${txt.length > 30000 ? txt.slice(0, 30000) + '\n…(tronqué)' : txt}` };
}

function brainWrite({ note, content, mode = 'replace', scope = 'jeu', tags = [] }) {
  if (content == null) throw new Error('Contenu vide.');
  const f = notePath(note, scope);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const exists = fs.existsSync(f);
  if (mode === 'create' && exists) throw new Error(`La note existe déjà : ${relVault(f)} (utilise mode "append" ou "replace").`);
  if (mode === 'append' && exists) {
    fs.appendFileSync(f, `\n${content.trim()}\n`);
    fs.writeFileSync(f, touchUpdated(fs.readFileSync(f, 'utf8')));
  } else {
    const body = content.startsWith('---\n') ? content
      : frontmatter({ jeu: scope === 'jeu' ? GAME : '', créé: today(), maj: today(), tags: ['roblox', ...tags] }) + '\n' + content.trim() + '\n';
    fs.writeFileSync(f, exists ? touchUpdated(body) : body);
  }
  return { text: `Note ${exists ? (mode === 'append' ? 'complétée' : 'remplacée') : 'créée'} : ${relVault(f)}` };
}

const LOG_KINDS = {
  decision: { dir: 'Décisions', label: 'Décision', sections: ['Contexte', 'Décision', 'Pourquoi', 'Conséquences'] },
  bug: { dir: 'Bugs', label: 'Bug', sections: ['Symptôme', 'Cause', 'Correction', 'Comment éviter'] },
  idee: { dir: 'Idées', label: 'Idée', sections: ['Idée', 'Pourquoi c\'est fun', 'Effort estimé'] },
  systeme: { dir: 'Systèmes', label: 'Système', sections: ['Rôle', 'Fichiers', 'API (fonctions, RemoteEvents)', 'Dépendances', 'À savoir'] },
  asset: { dir: 'Assets 3D', label: 'Asset 3D', sections: ['Description', 'Fichier Blender', 'Export', 'Dans Studio', 'Notes'] },
  savoir: { dir: '', label: 'Savoir', sections: ['Résumé', 'Détails', 'Exemple'] },
};

function brainLog({ kind = 'journal', title = '', content = '', tags = [] }) {
  const journalDir = path.join(gameDir(), 'Journal');
  fs.mkdirSync(journalDir, { recursive: true });
  const journal = path.join(journalDir, `${today()}.md`);
  if (!fs.existsSync(journal)) {
    fs.writeFileSync(journal, frontmatter({ jeu: GAME, date: today(), tags: ['journal'] }) + `\n# Journal du ${today()}\n\n`);
  }
  if (kind === 'journal') {
    fs.appendFileSync(journal, `- **${now()}** ${title ? `**${title}** — ` : ''}${String(content).trim().replace(/\n+/g, ' ')}\n`);
    return { text: `Ajouté au journal du ${today()}.` };
  }
  const k = LOG_KINDS[kind];
  if (!k) throw new Error(`Type inconnu : ${kind}`);
  if (!title) throw new Error('Il faut un titre.');
  const base = kind === 'savoir' ? path.join(vaultRoot(), 'Savoir') : path.join(gameDir(), k.dir);
  fs.mkdirSync(base, { recursive: true });
  const f = inside(base, safeName(title) + '.md');
  const exists = fs.existsSync(f);
  let body = String(content).trim();
  if (!/^#+ /m.test(body)) body = k.sections.map((s, i) => `## ${s}\n${i === 0 ? body : ''}`).join('\n\n');
  if (exists) {
    fs.appendFileSync(f, `\n\n## Mise à jour du ${today()}\n${String(content).trim()}\n`);
    fs.writeFileSync(f, touchUpdated(fs.readFileSync(f, 'utf8')));
  } else {
    fs.writeFileSync(f, frontmatter({ type: k.label, jeu: kind === 'savoir' ? '' : GAME, statut: kind === 'bug' ? 'ouvert' : kind === 'idee' ? 'à trier' : '', créé: today(), maj: today(), tags: ['roblox', kind, ...tags] }) +
      `\n# ${title}\n\n${body}\n`);
  }
  const link = `[[${relVault(f).replace(/\.md$/, '')}|${title}]]`;
  fs.appendFileSync(journal, `- **${now()}** ${k.label} ${exists ? 'mis(e) à jour' : 'ajouté(e)'} : ${link}\n`);
  return { text: `${k.label} ${exists ? 'mis(e) à jour' : 'enregistré(e)'} : ${relVault(f)}` };
}

function brainOverview() {
  const g = gameDir();
  if (!fs.existsSync(g)) return { text: `Le cerveau de « ${GAME} » n'existe pas encore (${relVault(g)}). Crée-le avec brain_write.` };
  const notes = listNotes(g).map((f) => path.relative(g, f).replace(/\\/g, '/'));
  const groups = {};
  for (const n of notes) {
    const dir = n.includes('/') ? n.split('/')[0] : '(racine)';
    if (dir === 'Journal') continue;
    (groups[dir] = groups[dir] || []).push(n.replace(/^[^/]+\//, '').replace(/\.md$/, ''));
  }
  const journals = notes.filter((n) => n.startsWith('Journal/')).sort().slice(-2);
  let recent = '';
  for (const j of journals) {
    try { recent += fs.readFileSync(path.join(g, j), 'utf8').split('\n').filter((l) => l.startsWith('- ')).slice(-12).join('\n') + '\n'; } catch {}
  }
  const savoir = listNotes(path.join(vaultRoot(), 'Savoir')).map((f) => path.basename(f, '.md'));
  return {
    text: `# Cerveau de « ${GAME} » (${relVault(g)})\n\n` +
      Object.entries(groups).map(([d, list]) => `**${d}** : ${list.join(' · ')}`).join('\n') +
      `\n\n**Savoir partagé (tous les jeux)** : ${savoir.join(' · ') || '(vide)'}` +
      `\n\n## Dernières entrées du journal\n${recent.trim() || '(vide)'}`,
  };
}

// ------------------------------------------------------------------ Outil : état de l'équipe

async function teamStatus() {
  const c = config();
  let llm = 'désactivé';
  if (c.llm.enabled) {
    try {
      const r = await fetch(String(c.llm.url).replace(/\/+$/, '') + '/models', {
        headers: c.llm.key ? { Authorization: `Bearer ${c.llm.key}` } : {}, signal: AbortSignal.timeout(2500),
      });
      llm = r.ok ? `prêt (${c.llm.model || 'aucun modèle choisi'})` : `erreur ${r.status}`;
    } catch { llm = 'injoignable (serveur éteint ?)'; }
  }
  return {
    text: [
      `Jeu : ${GAME} — dossier ${PROJECT_DIR}`,
      `Codex (second) : ${c.codex.enabled ? `activé (sandbox ${c.codex.sandbox})` : 'désactivé'}`,
      `LLM local (petites tâches) : ${llm}`,
      `Cerveau Obsidian : ${relVault(gameDir())} dans ${vaultRoot()}`,
      '',
      'Rappel : tu es le chef d\'orchestre. Délègue le gros code bien spécifié à Codex, les petites tâches',
      '(résumés, noms, données, textes, code simple) au LLM local, et écris les décisions dans le cerveau.',
    ].join('\n'),
  };
}

// ------------------------------------------------------------------ Déclaration des outils

const TOOLS = [
  {
    name: 'codex_delegate',
    description: 'Délègue une tâche de code à Codex (ton second). À utiliser pour du code bien spécifié et assez gros : ' +
      'écrire un module Luau complet, refactoriser, écrire des tests, corriger un bug localisé, ou une 2e opinion (mode "read"). ' +
      'Donne une spécification précise (fichiers, API attendue, contraintes). Codex travaille dans le dossier du projet et ' +
      'renvoie un résumé + la liste des fichiers modifiés. Relis toujours son travail.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'La tâche, précise et autonome (Codex ne voit pas ta conversation).' },
        files: { type: 'array', items: { type: 'string' }, description: 'Fichiers concernés (chemins relatifs au projet).' },
        mode: { type: 'string', enum: ['write', 'read'], description: '"write" (défaut) modifie des fichiers ; "read" = analyse / relecture sans modifier.' },
        context: { type: 'string', description: 'Contexte utile : décisions, conventions, API voisines.' },
      },
      required: ['task'],
    },
    run: codexDelegate,
  },
  {
    name: 'llm_quick',
    description: 'Confie une PETITE tâche au LLM local gratuit pour économiser tes tokens et aller plus vite : résumer des fichiers ' +
      '(il les lit lui-même via "files"), trouver des noms, générer des données (tables d\'objets, prix, niveaux), écrire des textes ' +
      'de jeu, du Luau simple et répétitif, traduire, mettre en forme une note. Avec "write_to", le résultat est écrit directement ' +
      'dans un fichier sans repasser par toi. Pas pour l\'architecture ni le code délicat.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Ce qu\'il faut faire, clairement.' },
        input: { type: 'string', description: 'Texte d\'entrée éventuel.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Fichiers à lui faire lire (relatifs au projet, ou "cerveau:chemin/note.md").' },
        style: { type: 'string', enum: Object.keys(LLM_STYLES), description: 'Type de tâche (règle le prompt système).' },
        write_to: { type: 'string', description: 'Écrire le résultat dans ce fichier (relatif au projet, ou "cerveau:…") au lieu de te le renvoyer.' },
      },
      required: ['task'],
    },
    run: llmQuick,
  },
  {
    name: 'brain_overview',
    description: 'Carte du cerveau Obsidian du jeu : toutes les notes (game design, systèmes, assets, décisions, bugs, idées), le savoir partagé, et les dernières entrées du journal. À appeler en début de session.',
    inputSchema: { type: 'object', properties: {} },
    run: brainOverview,
  },
  {
    name: 'brain_search',
    description: 'Cherche dans le cerveau Obsidian (plein texte). scope "jeu" (défaut) = ce jeu, "savoir" = savoir partagé entre tous les jeux, "tout" = tout le coffre.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['jeu', 'savoir', 'tout'] }, max: { type: 'number' } },
      required: ['query'],
    },
    run: brainSearch,
  },
  {
    name: 'brain_read',
    description: 'Lit une note du cerveau (chemin relatif au dossier du jeu, au coffre, ou simplement son titre).',
    inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
    run: brainRead,
  },
  {
    name: 'brain_write',
    description: 'Écrit une note markdown dans le cerveau. scope "jeu" (défaut) = dans Jeux/<jeu>/, "vault" = depuis la racine du coffre. ' +
      'mode "replace" (défaut), "append" ou "create". Utilise des liens [[Titre]] entre notes. Pour les décisions/bugs/idées/systèmes, préfère brain_log.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Ex. "Game Design/Boucle de jeu"' },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append', 'create'] },
        scope: { type: 'string', enum: ['jeu', 'vault'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['note', 'content'],
    },
    run: brainWrite,
  },
  {
    name: 'brain_log',
    description: 'Range une information au bon endroit du cerveau, avec le bon modèle, et l\'ajoute au journal du jour. ' +
      'kind : "decision" (choix d\'architecture/design), "bug" (problème + cause + correction), "idee", "systeme" (doc d\'un système du jeu : rôle, fichiers, API), ' +
      '"asset" (modèle 3D Blender → Studio), "savoir" (leçon réutilisable pour tous les jeux), "journal" (une ligne de progression).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['journal', ...Object.keys(LOG_KINDS)] },
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind', 'content'],
    },
    run: brainLog,
  },
  {
    name: 'team_status',
    description: 'Qui est disponible dans l\'équipe (Codex, LLM local, cerveau) et les règles de délégation.',
    inputSchema: { type: 'object', properties: {} },
    run: teamStatus,
  },
];

// ------------------------------------------------------------------ Protocole MCP (JSON-RPC sur stdin/stdout)

const INSTRUCTIONS = `Équipe Cube Hub pour le jeu Roblox « ${GAME} ». Tu es le chef d'orchestre : tu planifies, tu découpes, tu vérifies.
Délègue à Codex (codex_delegate) le code gros et bien spécifié, au LLM local (llm_quick) les petites tâches, et garde le cerveau Obsidian à jour (brain_log, brain_write).`;

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'cube-equipe', version: VERSION },
        instructions: INSTRUCTIONS,
      } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    }
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Outil inconnu : ${params?.name}` } });
      try {
        const args = params.arguments || {};
        const r = tool.name.startsWith('brain_')
          ? await tracked('brain', tool.name.replace('brain_', ''), args.title || args.note || args.query || args.content || '', async () => tool.run(args))
          : await tool.run(args);
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Erreur : ${e.message}` }], isError: true } });
      }
    }
    if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
    if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Méthode inconnue : ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
}

if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }); continue; }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

module.exports = { TOOLS, handle };
