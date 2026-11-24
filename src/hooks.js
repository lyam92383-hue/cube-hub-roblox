// Branche / débranche Cube Hub dans ~/.claude/settings.json (hooks de Claude Code).
// Port de Sources/CubeWidget/App/ClaudeHooks.swift.
const fs = require('fs');
const path = require('path');
const { claudeSettings, hookExe } = require('./paths');

const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'TaskCreated', 'TaskCompleted', 'SessionEnd',
];
const NOTIFICATION_MATCHER = 'permission_prompt|idle_prompt|elicitation_dialog';

// Chemin avec des / et entre guillemets : marche dans Git Bash comme dans cmd.
const command = () => `"${hookExe.replace(/\\/g, '/')}"`;
const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes('cube-hook');

function block() {
  const hooks = {};
  for (const ev of EVENTS) {
    const entry = { hooks: [{ type: 'command', command: command() }] };
    if (ev === 'Notification') entry.matcher = NOTIFICATION_MATCHER;
    hooks[ev] = [entry];
  }
  return { hooks };
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`~/.claude/settings.json est illisible (${e.message}). Corrige-le à la main avant de brancher Cube Hub.`);
  }
}

function status() {
  let settings;
  try {
    settings = read();
  } catch {
    return 'unreadable';
  }
  const hooks = settings.hooks || {};
  const present = EVENTS.filter((ev) => (hooks[ev] || []).some((e) => (e.hooks || []).some(isOurs)));
  if (present.length === EVENTS.length) return 'installed';
  return present.length ? 'partial' : 'missing';
}

function backup() {
  if (!fs.existsSync(claudeSettings)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const copy = `${claudeSettings}.cubehub-backup-${stamp}`;
  fs.copyFileSync(claudeSettings, copy);
  return copy;
}

function write(settings) {
  fs.mkdirSync(path.dirname(claudeSettings), { recursive: true });
  const tmp = claudeSettings + '.cubehub-tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, claudeSettings);
}

function install() {
  const settings = read();
  const copy = backup();
  settings.hooks = settings.hooks || {};
  for (const ev of EVENTS) {
    const list = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    // Retire nos anciennes lignes (chemin changé), garde celles des autres.
    const others = list
      .map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((e) => e.hooks.length);
    settings.hooks[ev] = [...others, ...block().hooks[ev]];
  }
  write(settings);
  return copy;
}

function uninstall() {
  const settings = read();
  if (!settings.hooks) return null;
  const copy = backup();
  for (const ev of Object.keys(settings.hooks)) {
    if (!Array.isArray(settings.hooks[ev])) continue;
    const kept = settings.hooks[ev]
      .map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((e) => e.hooks.length);
    if (kept.length) settings.hooks[ev] = kept;
    else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  write(settings);
  return copy;
}

module.exports = { status, install, uninstall, preview: () => JSON.stringify(block(), null, 2), EVENTS };
