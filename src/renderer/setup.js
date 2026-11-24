// Cube Hub V2 : écran « Connexion » du premier lancement.
// Claude Code et Codex se connectent chacun avec son propre compte, dans le navigateur, par
// l'utilisateur. Cube Hub ouvre seulement les bonnes commandes et vérifie que c'est fait.
import { detectTeam } from './team.js';

const $ = (id) => document.getElementById(id);

const TOOLS = [
  { id: 'claude', icon: '👑', name: 'Claude Code', role: "le chef d'orchestre", who: 'ton compte Claude (abonnement ou console Anthropic)', loginHint: 'Choisis ton compte dans le navigateur, puis tape /exit.' },
  { id: 'codex', icon: '🤝', name: 'Codex', role: 'le second', who: 'ton compte ChatGPT / OpenAI', loginHint: 'Valide dans le navigateur.' },
];

let timer = null;

function close() {
  clearInterval(timer);
  timer = null;
  $('wizard').hidden = true;
}

const ready = (d) => TOOLS.every((t) => d[t.id].found && d[t.id].loggedIn);

function card(t, d) {
  const x = d[t.id];
  const state = !x.found ? 'install' : !x.loggedIn ? 'login' : 'ok';
  const label = { ok: 'Connecté', login: 'À connecter', install: 'À installer' }[state];
  const action = state === 'install'
    ? `<button class="btn primary" data-run="${t.id}-install">1. Installer ${t.name}</button><span class="note">Une fenêtre PowerShell s'ouvre.</span>`
    : state === 'login'
      ? `<button class="btn primary" data-run="${t.id}-login">2. Se connecter à ${t.name}</button><span class="note">${t.loginHint}</span>`
      : '';
  return `<div class="setup-card ${state}">
    <div class="setup-head"><span class="setup-ico">${t.icon}</span>
      <div style="flex:1"><div class="setup-name">${t.name} <span class="note">· ${t.role}</span></div><div class="note">Compte : ${t.who}</div></div>
      <span class="badge ${state === 'ok' ? 'ok' : 'no'}">${label}</span></div>
    ${action ? `<div class="setup-actions">${action}</div>` : ''}
  </div>`;
}

export function initSetup(ctx) {
  const done = () => {
    window.cube.invoke('state:update', { team: { setupDone: true } });
    ctx.settings().team.setupDone = true;
  };

  const paint = (d) => {
    const ok = ready(d);
    $('wizardBody').innerHTML = `<div class="w-title">🔑 Connexion de l'équipe</div>
      <div class="w-sub">La première fois, connecte-toi à tes deux comptes. Cube Hub ne voit jamais tes mots de passe : la connexion se fait dans ton navigateur, avec les outils officiels.</div>
      ${TOOLS.map((t) => card(t, d)).join('')}
      <div class="w-msg">${ok ? '✓ Tout est connecté.' : "Cet écran se met à jour tout seul dès que c'est fait."}</div>
      <div class="ask-buttons">
        <button class="btn" id="sLater">Plus tard</button>
        <button class="btn primary" id="sOk" ${ok ? '' : 'disabled'}>Continuer</button>
      </div>`;
    $('wizardBody').querySelectorAll('[data-run]').forEach((b) => {
      b.onclick = () => window.cube.invoke('team:setup-run', b.dataset.run);
    });
    $('sLater').onclick = close;
    $('sOk').onclick = () => { done(); close(); ctx.toast('Équipe connectée'); };
  };

  async function open() {
    $('wizard').hidden = false;
    paint(await detectTeam(true));
    clearInterval(timer);
    timer = setInterval(async () => {
      if ($('wizard').hidden) return close();
      paint(await detectTeam(true));
    }, 3000);
  }

  /** Au démarrage : tant que Claude Code ou Codex n'est pas prêt, l'écran s'ouvre. */
  async function check() {
    if (ctx.settings().team.setupDone) return;
    const d = await detectTeam(true);
    if (ready(d)) { done(); return; }
    open();
  }

  /** Vérification de l'affichage : montre l'écran avec un état imaginaire. */
  const preview = (d) => { $('wizard').hidden = false; paint(d); };

  return { open, check, preview };
}
