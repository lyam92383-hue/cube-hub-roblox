// Cube Hub : widget iPhone (appli gratuite « Scriptable »).
// Montre l'état de tes sessions Claude Code : bosse (bleu), attend ta réponse (orange), terminé (vert).
// Première fois : lance ce script DANS Scriptable (bouton ▶) et colle le lien affiché dans
// Cube Hub → Réglages → Téléphone. Ensuite, ajoute le widget sur l'écran d'accueil ou l'écran verrouillé.

const CLE = "cube-hub-lien";
const COULEURS = { working: "#6EB4F5", waiting: "#E5671A", done: "#3FBF6E", idle: "#8E8E93" };
const LONG = { working: "bosse", waiting: "attend ta réponse", done: "terminé" };
const COURT = { working: "bosse", waiting: "attend", done: "terminé" };
const SYMBOLES = { working: "bolt.fill", waiting: "bell.fill", done: "checkmark", idle: "moon.zzz.fill" };
const FOND = new Color("#0a0c0b");
const PRIORITE = { waiting: 0, working: 1, done: 2 };

// ---------------------------------------------------------------- outils

function duree(depuis, maintenant) {
  const t = Date.parse(depuis);
  if (!t) return "";
  const min = Math.max(0, Math.floor((maintenant - t) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return h + " h " + String(min % 60).padStart(2, "0");
  return Math.floor(h / 24) + " j";
}

function jetons(n) {
  if (!n) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + "M tokens";
  if (n >= 1000) return Math.round(n / 1000) + "k tokens";
  return n + " tokens";
}

// La session qui compte le plus : celle qui attend, puis celle qui bosse, puis la plus récente.
function ordonner(sessions) {
  return [...sessions].sort((a, b) => {
    const d = (PRIORITE[a.status] ?? 3) - (PRIORITE[b.status] ?? 3);
    return d || Date.parse(b.since || 0) - Date.parse(a.since || 0);
  });
}

// ---------------------------------------------------------------- données

async function lien() {
  if (Keychain.contains(CLE)) return Keychain.get(CLE);
  if (config.runsInWidget) return null;
  const a = new Alert();
  a.title = "Lien du widget";
  a.message = "Dans Cube Hub : Réglages → Téléphone → Copier le lien. Colle-le ici.";
  a.addTextField("http://100.x.x.x:47821/?t=…", "");
  a.addAction("Enregistrer");
  a.addCancelAction("Annuler");
  if ((await a.presentAlert()) !== 0) return null;
  const v = a.textFieldValue(0).trim();
  if (!/^https?:\/\/.+[?&]t=[0-9a-f]+/i.test(v)) return null;
  Keychain.set(CLE, v);
  return v;
}

async function charger() {
  const fm = FileManager.local();
  const copie = fm.joinPath(fm.documentsDirectory(), "cube-hub-etat.json");
  const url = await lien();
  if (!url) return { erreur: "pas-de-lien" };
  try {
    const r = new Request(url);
    r.timeoutInterval = 8;
    const j = await r.loadJSON();
    const code = r.response && r.response.statusCode;
    if (code === 401) return { erreur: "code" };
    if (code === 429) return { erreur: "pause" };
    if (!j || !Array.isArray(j.sessions)) throw new Error("réponse inattendue");
    const data = { ...j, recuLe: new Date().toISOString() };
    fm.writeString(copie, JSON.stringify(data));
    return { data };
  } catch (e) {
    try { return { data: JSON.parse(fm.readString(copie)), horsLigne: true }; } catch (e2) { return { erreur: "injoignable" }; }
  }
}

// ---------------------------------------------------------------- dessin

// Le cube : carré de la couleur de l'état, avec ses deux yeux.
function cube(etat, mono) {
  const d = new DrawContext();
  d.size = new Size(120, 120);
  d.opaque = false;
  d.respectScreenScale = true;
  const p = new Path();
  p.addRoundedRect(new Rect(0, 0, 120, 120), 30, 30);
  d.addPath(p);
  // Écran verrouillé : iOS n'affiche qu'une teinte, le cube est donc blanc.
  d.setFillColor(mono ? Color.white() : new Color(COULEURS[etat] || COULEURS.idle, 0.92));
  d.fillPath();
  d.setFillColor(FOND);
  for (const x of [41, 69]) {
    const o = new Path();
    o.addRoundedRect(new Rect(x, 38, 11, 30), 5.5, 5.5);
    d.addPath(o);
    d.fillPath();
  }
  return d.getImage();
}

function message(w, titre, detail) {
  const t = w.addText(titre);
  t.textColor = Color.white();
  t.font = Font.boldSystemFont(14);
  if (detail) {
    const s = w.addText(detail);
    s.textColor = new Color("#ffffff", 0.7);
    s.font = Font.systemFont(11);
  }
  return w;
}

const MESSAGES = {
  "pas-de-lien": ["Widget à configurer", "Lance le script dans Scriptable et colle le lien de Cube Hub."],
  code: ["Code refusé", "Recopie le lien dans Cube Hub → Réglages → Téléphone."],
  pause: ["Trop d'essais", "Réessaie dans une minute."],
  injoignable: ["PC injoignable", "Cube Hub est-il ouvert ? Tailscale est-il actif ?"],
};

function ecranVerrouille(w, taille, haut, sessions, maintenant, horsLigne) {
  const etat = haut ? haut.status : "idle";
  if (taille === "accessoryInline") {
    w.addText(haut ? haut.name + " · " + COURT[etat] : "Cube Hub · repos");
  } else if (taille === "accessoryCircular") {
    const img = w.addImage(SFSymbol.named(SYMBOLES[etat]).image);
    img.imageSize = new Size(26, 26);
    img.centerAlignImage();
  } else {
    // Comme le panneau de Cube Hub sur le PC : le cube à gauche, puis le nom, l'état et les tokens.
    const ligne = w.addStack();
    ligne.centerAlignContent();
    const ic = ligne.addImage(cube(etat, true));
    ic.imageSize = new Size(38, 38);
    ligne.addSpacer(8);
    const col = ligne.addStack();
    col.layoutVertically();
    const a = col.addText(haut ? haut.name : "Cube Hub");
    a.font = Font.boldSystemFont(14);
    a.lineLimit = 1;
    const b = col.addText(haut ? LONG[etat] + " · " + duree(haut.since, maintenant) : "aucune session");
    b.font = Font.systemFont(12);
    b.lineLimit = 1;
    const reste = [haut ? jetons(haut.tokens) : "", sessions.length > 1 ? sessions.length + " sessions" : "", horsLigne ? "hors ligne" : ""].filter(Boolean);
    if (reste.length) { const c = col.addText(reste.join(" · ")); c.font = Font.systemFont(11); c.lineLimit = 1; c.textOpacity = 0.7; }
  }
}

function accueil(w, taille, haut, sessions, maintenant, horsLigne) {
  const etat = haut ? haut.status : "idle";
  const couleur = new Color(COULEURS[etat]);
  w.backgroundColor = FOND;
  w.setPadding(10, 10, 10, 10);

  const carte = w.addStack();
  carte.layoutVertically();
  carte.borderColor = new Color(COULEURS[etat], 0.85);
  carte.borderWidth = 1.5;
  carte.cornerRadius = 18;
  carte.setPadding(10, 12, 10, 12);

  const tete = carte.addStack();
  tete.centerAlignContent();
  const ic = tete.addImage(cube(etat));
  ic.imageSize = new Size(taille === "small" ? 34 : 44, taille === "small" ? 34 : 44);
  tete.addSpacer(10);
  const txt = tete.addStack();
  txt.layoutVertically();
  const nom = txt.addText(haut ? haut.name : "Cube Hub");
  nom.textColor = Color.white();
  nom.font = Font.boldSystemFont(taille === "small" ? 14 : 17);
  nom.lineLimit = 1;
  const ligne = txt.addStack();
  const st = ligne.addText(haut ? (taille === "small" ? COURT[etat] : LONG[etat]) : "au repos");
  st.textColor = couleur;
  st.font = Font.semiboldSystemFont(taille === "small" ? 11 : 13);
  if (haut && taille !== "small") {
    const suite = ligne.addText(" · " + duree(haut.since, maintenant) + (haut.tokens ? " · " + jetons(haut.tokens) : ""));
    suite.textColor = new Color("#ffffff", 0.65);
    suite.font = Font.systemFont(13);
    suite.lineLimit = 1;
  }
  if (haut && taille === "small") {
    const s = txt.addText(duree(haut.since, maintenant));
    s.textColor = new Color("#ffffff", 0.65);
    s.font = Font.systemFont(11);
  }

  if (taille !== "small") {
    const max = taille === "large" ? 7 : 3;
    const liste = carte.addStack();
    liste.layoutVertically();
    liste.addSpacer(8);
    for (const s of sessions.slice(0, max)) {
      const l = liste.addStack();
      l.centerAlignContent();
      const p = l.addText("● ");
      p.textColor = new Color(COULEURS[s.status] || COULEURS.idle);
      p.font = Font.systemFont(9);
      const n = l.addText(s.name);
      n.textColor = Color.white();
      n.font = Font.systemFont(13);
      n.lineLimit = 1;
      l.addSpacer();
      const e = l.addText(COURT[s.status] || "");
      e.textColor = new Color(COULEURS[s.status] || COULEURS.idle);
      e.font = Font.systemFont(12);
      liste.addSpacer(3);
    }
    if (sessions.length > max) {
      const plus = liste.addText("+ " + (sessions.length - max) + " autres");
      plus.textColor = new Color("#ffffff", 0.5);
      plus.font = Font.systemFont(11);
    }
  }
  if (horsLigne) {
    const h = carte.addText("hors ligne : dernier état connu");
    h.textColor = new Color("#ffffff", 0.45);
    h.font = Font.systemFont(10);
  }
}

// ---------------------------------------------------------------- widget

async function construire() {
  const taille = config.widgetFamily || "medium";
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 5 * 60000); // iOS décide du vrai rythme
  // Toucher le widget ouvre l'appli web de Cube Hub (pour voir en détail et répondre).
  if (Keychain.contains(CLE)) {
    const u = /^(https?:\/\/[^/]+)\/.*[?&]t=([0-9a-f]+)/i.exec(Keychain.get(CLE));
    if (u) w.url = u[1] + "/app#t=" + u[2];
  }
  const { data, erreur, horsLigne } = await charger();

  if (erreur) {
    const [t, d] = MESSAGES[erreur];
    w.backgroundColor = FOND;
    return message(w, t, d);
  }
  const maintenant = Date.now();
  const sessions = ordonner(data.sessions);
  const haut = sessions[0] || null;
  if (String(taille).startsWith("accessory")) ecranVerrouille(w, taille, haut, sessions, maintenant, horsLigne);
  else accueil(w, taille, haut, sessions, maintenant, horsLigne);
  return w;
}

const widget = await construire();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
