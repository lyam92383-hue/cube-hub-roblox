// Réglages et contenu du Hub, gardés dans ~/.cube-widget/windows-hub.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stateFile } = require('./paths');

const defaults = () => ({
  welcomeDone: false,
  widget: { visible: true, scale: 1, collapsed: false, x: null, y: null },
  sounds: { master: 1, bosse: 0.4, fini: 1, attente: 1, dodo: 0.4 },
  notifications: { windows: true, windowsEvents: { waiting: true, done: false, task: false } },
  telegram: {
    enabled: false, chatId: null, chatName: '', always: false, awayDelay: 180,
    events: { waiting: true, done: true, task: true },
    commands: { enabled: false, allowed: {} },
  },
  // V2 : l'équipe IA des projets Roblox.
  team: {
    vault: path.join(os.homedir(), 'Documents', 'Cerveau Roblox'),
    setupDone: false, // l'écran « Connexion » (Claude Code + Codex) a été fait ou passé
    gamesDir: path.join(os.homedir(), 'Documents', 'Jeux Roblox'),
    llm: { enabled: false, url: 'http://localhost:11434/v1', key: '', model: '', maxTokens: 2048 },
    codex: { enabled: true, command: 'codex', sandbox: 'workspace-write', model: '', timeoutMin: 15 },
    blender: { enabled: true, command: 'uvx', args: 'blender-mcp' },
    studio: { enabled: true, command: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Roblox', 'mcp.bat'), args: '' },
  },
  hub: {
    projects: [], // { id, folder, name, kind?: 'roblox', genre? }
    themes: [], // { id, name, color, collapsed }
    assign: {}, // clé de ligne → id du thème
    order: [], // clés de lignes, dans l'ordre choisi
    selected: null,
    bounds: null,
  },
});

function merge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      merge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

let state = defaults();
try {
  state = merge(defaults(), JSON.parse(fs.readFileSync(stateFile, 'utf8')));
} catch {
  // Premier lancement, ou fichier illisible : réglages par défaut.
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const tmp = stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, stateFile);
  } catch (e) {
    console.error('Sauvegarde impossible', e);
  }
}

module.exports = { get: () => state, save, saveNow };
