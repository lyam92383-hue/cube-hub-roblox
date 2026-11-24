// Où vivent les fichiers de Cube Hub.
const os = require('os');
const path = require('path');

const baseDir = process.env.CUBE_WIDGET_DIR || path.join(os.homedir(), '.cube-widget');

module.exports = {
  baseDir,
  sessionsDir: path.join(baseDir, 'sessions'),
  binDir: path.join(baseDir, 'bin'),
  hookExe: path.join(baseDir, 'bin', 'cube-hook.exe'),
  soundsDir: path.join(baseDir, 'Sons'),
  stateFile: path.join(baseDir, 'windows-hub.json'),
  // V2 : équipe IA.
  teamConfig: path.join(baseDir, 'equipe.json'),
  teamLogDir: path.join(baseDir, 'equipe'),
  teamMcp: path.join(baseDir, 'bin', 'cube-equipe-mcp.js'),
  teamHook: path.join(baseDir, 'bin', 'cube-equipe-hook.js'),
  claudeSettings: path.join(os.homedir(), '.claude', 'settings.json'),
};
