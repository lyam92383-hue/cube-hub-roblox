// Cube Hub V2 : page Réglages → Téléphone.
// 🔔 notifications (Discord ou ntfy), 📱 appli web pour voir et répondre, 🧊 widget iPhone.
import { escapeHTML } from './common/format.js';

export async function pagePhone(el, rerender, toast, settings) {
  const info = await window.cube.invoke('phone:info');
  const push = await window.cube.invoke('push:info');
  if (!el.isConnected) return;
  const cfg = settings().phone;
  const projects = (settings().hub.projects || []).filter((p) => p.kind === 'roblox' || p.kind === 'project' || p.folder);
  const badge = (ok, yes, no) => `<span class="badge ${ok ? 'ok' : 'no'}">${ok ? yes : no}</span>`;
  const tog = (id, on, extra = '') => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${extra}><span></span></label>`;
  const best = info.addresses.find((a) => a.tailscale) || info.addresses[0];
  const isDiscord = push.provider !== 'ntfy';

  el.innerHTML = `<h2>Téléphone</h2>

    <h3>🔔 Notifications</h3>
    <p class="note">Quand une session <b style="color:#E5671A">attend ta réponse</b> ou <b style="color:#3FBF6E">termine</b>, ton téléphone reçoit une notification.
      Par défaut seul le nom du projet part (jamais le contenu).</p>
    <div class="group">
      <div class="line"><div class="l-label">Envoyer les notifications</div>${tog('nEnable', push.enabled)}</div>
      ${push.enabled ? `
      <div class="line"><div class="l-label">Service<div class="l-sub">Discord est fiable sur iPhone. ntfy est gratuit mais ses notifications arrivent souvent mal sur iOS.</div></div>
        <select id="nProvider"><option value="discord" ${isDiscord ? 'selected' : ''}>Discord (recommandé)</option><option value="ntfy" ${isDiscord ? '' : 'selected'}>ntfy</option></select></div>
      ${isDiscord ? `
      <div class="line"><div class="l-label">Webhook Discord<div class="l-sub">${push.webhookSet ? '✓ Enregistré. Colle une autre adresse pour le remplacer.' : 'À coller ici (étapes plus bas). Il se garde sur ce PC.'}</div></div>
        <input type="password" id="nWebhook" placeholder="${push.webhookSet ? '••••••••' : 'https://discord.com/api/webhooks/…'}" style="width:230px" spellcheck="false"></div>` : `
      <div class="line"><div class="l-label">Sujet secret<div class="l-sub num">${escapeHTML(push.topic)}<br>Quiconque connaît ce nom peut lire les notifications.</div></div>
        <button class="btn" id="nCopy">Copier</button><button class="btn" id="nRegen">Changer</button></div>
      <div class="line"><div class="l-label">Serveur ntfy</div><input type="text" id="nServer" value="${escapeHTML(push.server)}" style="width:200px" spellcheck="false"></div>`}
      <div class="line"><div class="l-label">Inclure un extrait<div class="l-sub">Ajoute la question ou le début de la réponse de Claude. Ça passe alors par ${isDiscord ? 'Discord' : 'le serveur ntfy'}.</div></div>${tog('nDetails', push.details)}</div>
      <div class="line"><div class="l-label">Tester<div class="l-sub" id="nMsg">${push.error ? '🔴 ' + escapeHTML(push.error) : "Envoie une notification d'essai."}</div></div><button class="btn" id="nTest">Envoyer un test</button></div>` : ''}
    </div>
    ${push.enabled && isDiscord ? `<div class="group">
      <div class="line"><div class="l-label">1. Installe Discord<div class="l-sub">Appli gratuite (App Store), avec un compte. Autorise les notifications.</div></div></div>
      <div class="line"><div class="l-label">2. Crée un salon privé<div class="l-sub">+ « Créer un serveur » (pour toi seul), puis un salon texte.</div></div></div>
      <div class="line"><div class="l-label">3. Crée le webhook<div class="l-sub">Sur ordinateur (discord.com) : paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL.</div></div></div>
      <div class="line"><div class="l-label">4. Colle l'adresse ci-dessus<div class="l-sub">Puis « Envoyer un test ». Dans Discord, règle le serveur sur « Tous les messages » pour être prévenu à chaque fois.</div></div></div>
    </div>` : ''}

    <h3>📱 Voir et répondre depuis le téléphone</h3>
    <p class="note">Une petite appli web privée servie par ce PC : tu vois tes sessions, tu réponds à Claude, tu valides une permission. Tu l'ajoutes à l'écran d'accueil. Elle sert aussi au widget.</p>
    <div class="group">
      <div class="line"><div class="l-label">Activer le serveur du téléphone<div class="l-sub">Petit serveur sur ce PC, protégé par un code secret. Désactivé par défaut.</div></div>${tog('pEnable', info.enabled)}</div>
      ${info.enabled ? `<div class="line"><div class="l-label">État<div class="l-sub">${info.error ? escapeHTML(info.error) : info.running ? `Actif · port ${info.port} · ${info.tailscale ? 'via Tailscale' : 'réseau local'}` : 'Démarrage…'}</div></div>${badge(info.running, 'Actif', info.error ? 'Erreur' : '…')}</div>
      <div class="line"><div class="l-label">Réseau<div class="l-sub">${info.tailscale
        ? `✓ Tailscale détecté (${escapeHTML(best.ip)}) : ça marche partout et rien n'est visible sur ton Wi-Fi.`
        : "⚠ Tailscale n'est pas installé : ça ne marche que sur le même Wi-Fi que ce PC, en lecture seule. Pour répondre depuis le téléphone, installe Tailscale (gratuit) sur le PC et l'iPhone, avec le même compte."}
        <br>Windows peut demander d'autoriser Cube Hub dans le pare-feu : accepte pour les réseaux privés.</div></div></div>
      <div class="line"><div class="l-label">Activer l'appli web<div class="l-sub">Montre le détail des sessions (nom, état, dernière réponse, permission demandée).</div></div>${tog('aEnable', cfg.app.enabled)}</div>` : ''}
    </div>
    ${info.enabled && cfg.app.enabled ? `
    <h3>Projets où tu peux répondre</h3>
    <div class="group">
      ${projects.length ? projects.map((p) => `<div class="line"><div class="l-label">${escapeHTML(p.name)}<div class="l-sub">${escapeHTML(p.folder || '')}</div></div>${tog('aP-' + p.id, !!cfg.app.allowed[p.id], `data-project="${escapeHTML(p.id)}"`)}</div>`).join('') : '<div class="line"><div class="l-label">Aucun projet<div class="l-sub">Ajoute un projet dans Cube Hub, puis autorise-le ici.</div></div></div>'}
    </div>
    <p class="note">Seules les sessions lancées dans Cube Hub (terminal ouvert) et autorisées ici peuvent recevoir une réponse. Les messages commençant par <b>!</b>, <b>/</b> ou <b>#</b> sont refusés, et il y a une limite de 5 réponses par minute.${info.replySafe ? '' : ' <b>Répondre reste bloqué tant que Tailscale n\'est pas actif.</b>'}</p>
    <div class="group">
      <div class="line"><div class="l-label">Lien de l'appli<div class="l-sub">Contient ton code secret : ne le partage pas. Ouvre-le dans Safari sur l'iPhone, puis Partager → « Sur l'écran d'accueil ».</div></div>
        <button class="btn" id="pCopyApp">Copier le lien de l'appli</button><button class="btn" id="pRegen">Nouveau code</button></div>
    </div>` : ''}

    ${info.enabled ? `
    <h3>🧊 Widget (écran d'accueil ou verrouillé)</h3>
    <div class="group">
      <div class="line"><div class="l-label">1. Installe Scriptable<div class="l-sub">Appli gratuite de l'App Store.</div></div></div>
      <div class="line"><div class="l-label">2. Copie le script<div class="l-sub">Dans Scriptable : + puis colle. Nomme-le « Cube ».</div></div><button class="btn" id="pCopyScript">Copier le script</button></div>
      <div class="line"><div class="l-label">3. Colle le lien du widget<div class="l-sub">Lance le script avec ▶ : il demande le lien.</div></div><button class="btn" id="pCopyLink">Copier le lien du widget</button></div>
      <div class="line"><div class="l-label">4. Ajoute le widget<div class="l-sub">Appui long sur l'écran d'accueil ou verrouillé, + , Scriptable, puis Edit Widget → Script « Cube ». Toucher le widget ouvre l'appli.</div></div></div>
    </div>
    <p class="note">iOS rafraîchit les widgets à son rythme (quelques minutes) : ce n'est pas en direct à la seconde. La grande carte lumineuse n'existe pas sur l'écran verrouillé d'iOS : seul un petit widget y est possible.</p>` : ''}`;

  const $ = (id) => document.getElementById(id);
  const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Copie impossible'); } };

  // Notifications
  $('nEnable').onchange = async (e) => { await window.cube.invoke('push:set', { enabled: e.target.checked }); rerender(); };
  $('nProvider')?.addEventListener('change', async (e) => { await window.cube.invoke('push:set', { provider: e.target.value }); rerender(); });
  $('nDetails')?.addEventListener('change', (e) => window.cube.invoke('push:set', { details: e.target.checked }));
  $('nWebhook')?.addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (!v) return;
    const r = await window.cube.invoke('push:set', { webhook: v });
    if (r.error) { $('nMsg').textContent = '🔴 ' + r.error; e.target.value = ''; return; }
    toast('Webhook enregistré');
    rerender();
  });
  $('nServer')?.addEventListener('change', async (e) => { await window.cube.invoke('push:set', { server: e.target.value }); rerender(); });
  $('nRegen')?.addEventListener('click', async () => { await window.cube.invoke('push:regen'); toast('Nouveau sujet : abonne-toi de nouveau dans ntfy'); rerender(); });
  $('nCopy')?.addEventListener('click', () => copy(push.topic, 'Sujet copié'));
  $('nTest')?.addEventListener('click', async () => {
    $('nMsg').textContent = 'Envoi…';
    const r = await window.cube.invoke('push:test');
    $('nMsg').textContent = r.ok ? '🟢 Envoyé : regarde ton téléphone.' : '🔴 ' + r.error;
  });

  // Serveur, appli web, widget
  $('pEnable').onchange = async (e) => { await window.cube.invoke('phone:toggle', e.target.checked); rerender(); };
  $('aEnable')?.addEventListener('change', async (e) => { await window.cube.invoke('phone:app-set', { enabled: e.target.checked }); rerender(); });
  el.querySelectorAll('[data-project]').forEach((inp) => {
    inp.onchange = async () => { await window.cube.invoke('phone:app-set', { allow: { id: inp.dataset.project, on: inp.checked } }); };
  });
  $('pCopyApp')?.addEventListener('click', async () => { const i = await window.cube.invoke('phone:info'); if (i.appLink) copy(i.appLink, "Lien de l'appli copié"); });
  $('pCopyLink')?.addEventListener('click', async () => { const i = await window.cube.invoke('phone:info'); if (i.link) copy(i.link, 'Lien du widget copié'); });
  $('pRegen')?.addEventListener('click', async () => {
    await window.cube.invoke('phone:regen');
    toast('Nouveau code : recopie les liens dans l\'appli et le widget');
    rerender();
  });
  $('pCopyScript')?.addEventListener('click', async () => {
    const s = await window.cube.invoke('phone:script');
    if (s) copy(s, 'Script copié'); else toast('Script introuvable');
  });
}
