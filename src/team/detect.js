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
  const [claude, codex, node, rojo, uvx] = await Promise.all(['claude', 'codex', 'node', 'rojo', 'uvx'].map(where));
  const robloxMcp = firstExisting([path.join(LOCAL, 'Roblox', 'mcp.bat')]);
  const ob = obsidianInfo(team.vault);
  const llm = team.llm?.enabled ? await llmCheck(team.llm) : { ok: false, error: 'désactivé', models: [] };
  return {
    claude: { found: !!claude, path: claude },
    codex: { found: !!codex, path: codex },
    node: { found: !!node, path: node },
    rojo: { found: !!rojo, path: rojo },
    uvx: { found: !!uvx, path: uvx },
    blender: { found: !!blenderExe(), path: blenderExe() },
    studio: { found: !!studioExe(), path: studioExe(), mcp: robloxMcp },
    obsidian: { found: !!ob.exe, path: ob.exe, registered: ob.registered, vaultExists: fs.existsSync(team.vault) },
    llm,
  };
}

module.exports = { detectAll, llmCheck, where, blenderExe, studioExe, obsidianInfo, LOCAL };
