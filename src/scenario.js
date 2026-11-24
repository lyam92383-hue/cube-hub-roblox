// Vérification automatique : CUBE_SCENARIO=<dossier> joue une suite d'événements de Claude Code
// à travers le vrai cube-hook.exe, et enregistre une capture du widget après chaque étape.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const paths = require('./paths');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function hook(event) {
  execFileSync(paths.hookExe, [], { input: JSON.stringify(event), env: { ...process.env, CUBE_WIDGET_DIR: paths.baseDir } });
}

module.exports = async function scenario(dir, { widget, notifier, state }, log) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.env.CUBE_TELEGRAM_API) {
    // Avec un faux serveur Telegram : connexion, détection de la conversation, envoi toujours.
    log('bot :', await notifier.connect('123456789:' + 'A'.repeat(35)));
    await new Promise((resolve) => notifier.detectChat((chat) => {
      log('conversation :', JSON.stringify(chat));
      Object.assign(state.telegram, { chatId: chat?.id, enabled: true, always: true });
      resolve();
    }));
  }
  const shot = async (name, delay = 900) => {
    await wait(delay);
    const img = await widget.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
    log(`capture ${name}`);
  };
  const ev = (session, name, extra = {}) => hook({ session_id: session, hook_event_name: name, cwd: `C:\\dev\\${session}`, ...extra });

  await shot('01-vide', 2500);
  ev('alpha', 'SessionStart');
  await shot('02-alpha-ouverte');
  ev('alpha', 'UserPromptSubmit');
  await shot('03-alpha-bosse', 600);
  ev('alpha', 'PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Écrire les tests du panier' }, tool_response: { task: { id: '1' } } });
  ev('alpha', 'PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'in_progress' }, tool_response: {} });
  await shot('04-alpha-tache');
  ev('alpha', 'TaskCompleted', { task_id: '1', task_subject: 'Écrire les tests du panier' });
  await shot('05-alpha-tache-finie', 500);
  ev('beta', 'SessionStart');
  ev('beta', 'UserPromptSubmit');
  await shot('06-beta-devant');
  ev('alpha', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await shot('07-alpha-attend-derriere', 300);
  ev('beta', 'Stop', { last_assistant_message: 'Fini.' });
  await shot('08-beta-fini', 500);
  ev('beta', 'SessionEnd');
  await shot('09-alpha-revient-devant');
  ev('alpha', 'SessionEnd');
  await shot('10-plus-rien', 2500);
};
