// Cube Hub V2 : page Réglages → Téléphone (widget iPhone des sessions Claude Code).
import { escapeHTML } from './common/format.js';

export async function pagePhone(el, rerender, toast) {
  const info = await window.cube.invoke('phone:info');
  const push = await window.cube.invoke('push:info');
  if (!el.isConnected) return;
  const badge = (ok, yes, no) => `<span class="badge ${ok ? 'ok' : 'no'}">${ok ? yes : no}</span>`;
  const tog = `<label class="switch"><input type="checkbox" id="pEnable" ${info.enabled ? 'checked' : ''}><span></span></label>`;
  const best = info.addresses.find((a) => a.tailscale) || info.addresses[0];
  const where = info.running ? `${info.bindHost === '0.0.0.0' ? 'ton réseau local' : 'Tailscale'} · port ${info.port}` : '';

  const pTog = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
  el.innerHTML = `<h2>Téléphone</h2>
    <h3>🔔 Notifications sur l'iPhone</h3>
    <p class="note">Quand une session <b style="color:#E5671A">attend ta réponse</b> ou <b style="color:#3FBF6E">termine</b>, ton iPhone reçoit une notification, même loin du PC.
      Ça passe par <b>ntfy</b> (appli gratuite). Ça ne demande ni Tailscale ni le widget.</p>
    <div class="group">
      <div class="line"><div class="l-label">Envoyer les notifications<div class="l-sub">Par défaut seul le nom du projet part (« Claude code attend ta réponse »), jamais le contenu.</div></div>${pTog('nEnable', push.enabled)}</div>
      ${push.enabled ? `
      <div class="line"><div class="l-label">Sujet secret<div class="l-sub num">${escapeHTML(push.topic)}<br>Quiconque connaît ce nom peut lire les notifications : ne le partage pas.</div></div>
        <button class="btn" id="nCopy">Copier</button><button class="btn" id="nRegen">Changer</button></div>
      <div class="line"><div class="l-label">Serveur ntfy<div class="l-sub">ntfy.sh (public, gratuit) ou ton propre serveur.</div></div><input type="text" id="nServer" value="${escapeHTML(push.server)}" style="width:200px" spellcheck="false"></div>
      <div class="line"><div class="l-label">Inclure un extrait<div class="l-sub">Ajoute la question ou le début de la réponse de Claude. Ça passe alors par le serveur ntfy.</div></div>${pTog('nDetails', push.details)}</div>
      <div class="line"><div class="l-label">Tester<div class="l-sub" id="nMsg">${push.error ? '🔴 ' + escapeHTML(push.error) : "Envoie une notification d'essai."}</div></div><button class="btn" id="nTest">Envoyer un test</button></div>` : ''}
    </div>
    ${push.enabled ? `<div class="group">
      <div class="line"><div class="l-label">1. Installe ntfy<div class="l-sub">Appli gratuite de l'App Store (autorise les notifications).</div></div></div>
      <div class="line"><div class="l-label">2. Abonne-toi<div class="l-sub">Dans ntfy : + puis colle le sujet secret ci-dessus. Si tu as changé de serveur, choisis-le aussi dans ntfy.</div></div></div>
    </div>` : ''}

    <h3>🧊 Widget des sessions</h3>
    <p class="note">Un widget pour ton iPhone (écran d'accueil ou écran verrouillé) qui montre tes sessions Claude Code :
      <b style="color:#6EB4F5">bosse</b>, <b style="color:#E5671A">attend ta réponse</b> ou <b style="color:#3FBF6E">terminé</b>, avec la durée et les tokens.</p>

    <div class="group">
      <div class="line"><div class="l-label">Activer le widget du téléphone
        <div class="l-sub">Ouvre un petit serveur sur ce PC, en lecture seule, protégé par un code secret. Désactivé par défaut.</div></div>${tog}</div>
      ${info.enabled ? `<div class="line"><div class="l-label">État
        <div class="l-sub">${info.error ? escapeHTML(info.error) : info.running ? `Actif : ${where}` : 'Démarrage…'}</div></div>${badge(info.running, 'Actif', info.error ? 'Erreur' : '…')}</div>` : ''}
    </div>

    ${info.enabled && info.running ? `
    <div class="group">
      <div class="line"><div class="l-label">Réseau
        <div class="l-sub">${info.tailscale
          ? `✓ Tailscale détecté (${escapeHTML(best.ip)}) : le widget marche partout, et rien n'est visible sur ton Wi-Fi.`
          : `⚠ Tailscale n'est pas installé : le widget marche seulement quand ton iPhone est sur le même Wi-Fi que ce PC (connexion non chiffrée). Pour l'utiliser dehors, installe Tailscale (gratuit, tailscale.com) sur le PC et sur l'iPhone, avec le même compte.`}
          <br>Windows peut demander d'autoriser Cube Hub dans le pare-feu : accepte pour les réseaux privés.</div></div></div>
      <div class="line"><div class="l-label">Lien du widget<div class="l-sub">Contient ton code secret : ne le partage pas.</div></div>
        <button class="btn" id="pCopyLink">Copier le lien</button><button class="btn" id="pRegen">Nouveau code</button></div>
    </div>

    <h3>Installer sur l'iPhone</h3>
    <div class="group">
      <div class="line"><div class="l-label">1. Installe Scriptable<div class="l-sub">Appli gratuite de l'App Store.</div></div></div>
      <div class="line"><div class="l-label">2. Copie le script<div class="l-sub">Dans Scriptable : + puis colle. Nomme-le « Cube ».</div></div><button class="btn" id="pCopyScript">Copier le script</button></div>
      <div class="line"><div class="l-label">3. Colle le lien<div class="l-sub">Lance le script avec ▶ dans Scriptable : il demande le lien. Copie-le ici, envoie-le-toi (message, notes), puis colle-le.</div></div></div>
      <div class="line"><div class="l-label">4. Ajoute le widget<div class="l-sub">Appui long sur l'écran d'accueil ou verrouillé, + , Scriptable, puis Edit Widget → Script « Cube ».</div></div></div>
    </div>
    <p class="note">iOS rafraîchit les widgets à son rythme (quelques minutes) : ce n'est pas en direct à la seconde.</p>` : ''}`;


  const $ = (id) => document.getElementById(id);
  $('nEnable').onchange = async (e) => { await window.cube.invoke('push:set', { enabled: e.target.checked }); rerender(); };
  $('nDetails')?.addEventListener('change', (e) => window.cube.invoke('push:set', { details: e.target.checked }));
  $('nServer')?.addEventListener('change', async (e) => { await window.cube.invoke('push:set', { server: e.target.value }); rerender(); });
  $('nRegen')?.addEventListener('click', async () => { await window.cube.invoke('push:regen'); toast('Nouveau sujet : abonne-toi de nouveau dans ntfy'); rerender(); });
  $('nCopy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(push.topic); toast('Sujet copié'); } catch { toast('Copie impossible'); } });
  $('nTest')?.addEventListener('click', async () => {
    $('nMsg').textContent = 'Envoi…';
    const r = await window.cube.invoke('push:test');
    $('nMsg').textContent = r.ok ? '🟢 Envoyé : regarde ton iPhone.' : '🔴 ' + r.error;
  });
  document.getElementById('pEnable').onchange = async (e) => { await window.cube.invoke('phone:toggle', e.target.checked); rerender(); };
  const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Copie impossible'); } };
  document.getElementById('pCopyLink')?.addEventListener('click', async () => {
    const i = await window.cube.invoke('phone:info');
    if (i.link) copy(i.link, 'Lien copié');
  });
  document.getElementById('pRegen')?.addEventListener('click', async () => {
    await window.cube.invoke('phone:regen');
    toast('Nouveau code : recopie le lien dans le widget');
    rerender();
  });
  document.getElementById('pCopyScript')?.addEventListener('click', async () => {
    const s = await window.cube.invoke('phone:script');
    if (s) copy(s, 'Script copié'); else toast('Script introuvable');
  });
}
