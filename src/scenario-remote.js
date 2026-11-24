// Vérification automatique des commandes Telegram, contre un faux serveur Telegram
// (CUBE_TELEGRAM_API) : CUBE_SCENARIO_REMOTE=1. Le terminal du projet est simulé.
const { execFileSync } = require('child_process');
const paths = require('./paths');
const totp = require('./totp');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function scenarioRemote({ notifier, remote, state, captureTelegramPage }, log) {
  const api = process.env.CUBE_TELEGRAM_API;
  const push = (u) => fetch(`${api}/push`, { method: 'POST', body: JSON.stringify(u) });
  const now = () => Math.floor(Date.now() / 1000);
  const msg = (text, extra = {}) => push({ message: { message_id: 1, date: now(), chat: { id: 4242, type: 'private' }, from: { id: 4242 }, text, ...extra } });

  // Bot relié, conversation trouvée, envoi même quand on est là.
  log('bot :', await notifier.connect('123456789:' + 'A'.repeat(35)));
  await new Promise((resolve) => notifier.detectChat((chat) => {
    Object.assign(state.telegram, { chatId: chat.id, enabled: true, always: true });
    resolve();
  }));

  // Code de déverrouillage.
  await remote.beginSetup();
  const secret = remote.pendingSecret;
  log('mauvais code de config refusé :', !remote.confirmSetup('000000').ok);
  log('code de config accepté :', remote.confirmSetup(totp.code(secret, totp.counterAt(Date.now()))).ok);
  state.telegram.commands.enabled = true;
  state.telegram.commands.allowed.P1 = true;

  // Terminal simulé du projet P1, qui affiche le menu de permission de Claude.
  const writes = [];
  remote.terminal = (id) => (id === 'P1' ? { write: (s) => writes.push(s), tail: () => 'Bash(npm test)\n Do you want to proceed?\n ❯ 1. Yes\n   2. No' } : null);
  remote.sync();

  // Une session du Hub (projet P1) qui demande une permission ; une autre, externe.
  const hook = (ev, project) => execFileSync(paths.hookExe, [], {
    input: JSON.stringify(ev), env: { ...process.env, CUBE_WIDGET_DIR: paths.baseDir, CUBE_HUB_PROJECT: project || '' },
  });
  hook({ session_id: 'hubsess', hook_event_name: 'SessionStart', cwd: 'C:\\dev\\alpha' }, 'P1');
  hook({ session_id: 'extsess', hook_event_name: 'SessionStart', cwd: 'C:\\dev\\beta' });
  await wait(1500);
  hook({ session_id: 'hubsess', hook_event_name: 'UserPromptSubmit', cwd: 'C:\\dev\\alpha' }, 'P1');
  await wait(800);
  hook({ session_id: 'hubsess', hook_event_name: 'PermissionRequest', cwd: 'C:\\dev\\alpha', tool_name: 'Bash', tool_input: { command: 'npm test' } }, 'P1');
  await wait(2500); // notification « attend » avec boutons

  await msg('fais les tests'); // verrouillé
  await wait(1200);
  await msg('/unlock 000000'); // mauvais code
  await wait(1200);
  await msg('/unlock ' + totp.code(secret, totp.counterAt(Date.now())));
  await wait(1200);
  await msg('fais les tests stp'); // une seule session joignable : P1
  await wait(1500);
  await push({ callback_query: { id: 'cb1', from: { id: 4242 }, data: 'p|hubsess|yes', message: { message_id: 100, date: now(), chat: { id: 4242 } } } });
  await wait(1500);
  await msg('/sessions');
  await wait(1500);
  await msg('a'.repeat(2100), { reply_to_message: { message_id: 999 } }); // trop long
  await wait(1200);
  await push({ message: { message_id: 2, date: now(), chat: { id: 666, type: 'private' }, from: { id: 666 }, text: '/unlock 123456' } }); // autre conversation
  await wait(1200);
  await msg('/lock');
  await wait(1200);
  log('écrit dans le terminal :', JSON.stringify(writes));
  if (process.env.CUBE_SHOT) await captureTelegramPage(process.env.CUBE_SHOT);
  remote.stop();
};
