// Cube Hub V2 : trouve les outils de l'équipe sur ce PC (Claude Code, Codex, Node, Blender,
// Roblox Studio, Obsidian, Rojo, LLM local).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const PF = process.env.ProgramFiles || 'C:\\Program Files';

function where(cmd) {
  return new Promise((resolve) => {
    execFile('where.exe', [cmd], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve(null);
      const lines = String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Préfère .exe / .cmd (spawn sans shell ne lance pas un script sans extension).
      resolve(lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) || lines[0] || null);
    });
  });
}

const firstExisting = (list) => list.find((p) => p && fs.existsSync(p)) || null;

// Où Claude Code et Codex s'installent : ces dossiers ne sont pas toujours dans le PATH
// de l'app tant qu'elle n'a pas été relancée.
const CLAUDE_BIN = path.join(os.homedir(), '.local', 'bin');
const NPM_BIN = path.join(ROAMING, 'npm');
const extraPath = () => [CLAUDE_BIN, NPM_BIN].filter((d) => fs.existsSync(d));

// Connecté = les identifiants existent (jamais lus ni envoyés : on vérifie seulement leur présence).
function claudeLoggedIn() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'))) return true;
  try { return !!JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).oauthAccount; } catch { return false; }
}
function codexLoggedIn() {
  if (process.env.OPENAI_API_KEY) return true;
  try { return fs.statSync(path.join(os.homedir(), '.codex', 'auth.json')).size > 2; } catch { return false; }
}

function blenderExe() {
  const base = path.join(PF, 'Blender Foundation');
  try {
    const dirs = fs.readdirSync(base).filter((d) => /^Blender/i.test(d)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of dirs) {
      const exe = path.join(base, d, 'blender.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return null;
}

function studioExe() {
  const versions = path.join(LOCAL, 'Roblox', 'Versions');
  try {
    for (const d of fs.readdirSync(versions)) {
      const exe = path.join(versions, d, 'RobloxStudioBeta.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return null;
}

function obsidianInfo(vault) {
  const exe = firstExisting([path.join(LOCAL, 'Programs', 'Obsidian', 'Obsidian.exe'), path.join(LOCAL, 'Obsidian', 'Obsidian.exe')]);
  let registered = false;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROAMING, 'obsidian', 'obsidian.json'), 'utf8'));
    const want = path.resolve(vault).toLowerCase();
    registered = Object.values(j.vaults || {}).some((v) => v.path && path.resolve(v.path).toLowerCase() === want);
  } catch {}
  return { exe, registered };
}

async function llmCheck(llm) {
  if (!llm || !llm.url) return { ok: false, error: 'Adresse non réglée', models: [] };
  try {
    const r = await fetch(String(llm.url).replace(/\/+$/, '') + '/models', {
      headers: llm.key ? { Authorization: `Bearer ${llm.key}` } : {}, signal: AbortSignal.timeout(3500),
    });
    if (!r.ok) return { ok: false, error: `Erreur ${r.status}${r.status === 401 ? ' (clé API ?)' : ''}`, models: [] };
    const j = await r.json();
    const models = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'Pas de réponse (serveur éteint ?)' : e.message, models: [] };
  }
}

async function detectAll(team) {
  let [claude, codex, node, rojo, uvx] = await Promise.all(['claude', 'codex', 'node', 'rojo', 'uvx'].map(where));
  claude = claude || firstExisting([path.join(CLAUDE_BIN, 'claude.exe')]);
  codex = codex || firstExisting([path.join(NPM_BIN, 'codex.cmd')]);
  const robloxMcp = firstExisting([path.join(LOCAL, 'Roblox', 'mcp.bat')]);
  const ob = obsidianInfo(team.vault);
  const llm = team.llm?.enabled ? await llmCheck(team.llm) : { ok: false, error: 'désactivé', models: [] };
  return {
    claude: { found: !!claude, path: claude, loggedIn: claudeLoggedIn() },
    codex: { found: !!codex, path: codex, loggedIn: codexLoggedIn() },
    node: { found: !!node, path: node },
    rojo: { found: !!rojo, path: rojo },
    uvx: { found: !!uvx, path: uvx },
    blender: { found: !!blenderExe(), path: blenderExe() },
    studio: { found: !!studioExe(), path: studioExe(), mcp: robloxMcp },
    obsidian: { found: !!ob.exe, path: ob.exe, registered: ob.registered, vaultExists: fs.existsSync(team.vault) },
    llm,
  };
}

module.exports = { extraPath, detectAll, llmCheck, where, blenderExe, studioExe, obsidianInfo, LOCAL };
