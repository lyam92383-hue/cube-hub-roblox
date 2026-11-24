// Cube Hub V2 : serveur du téléphone (widget iPhone + petite appli web pour voir et répondre).
// Désactivé par défaut. Tout est protégé par un code secret.
//  - GET  /api/status : état minimal des sessions (widget) : nom, état, durée, tokens.
//  - GET  /app        : la page de l'appli web (aucune donnée dedans), à ajouter à l'écran d'accueil.
//  - GET  /api/app    : le détail des sessions pour l'appli (si « appli web » est activée).
//  - POST /api/reply, /api/answer : répondre à Claude (si autorisé, projet par projet, et seulement
//    quand le serveur n'écoute pas sur tout le réseau : il faut Tailscale ou l'ordinateur lui-même).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_FAILS = 10; // essais de code ratés par adresse et par minute
const WINDOW_MS = 60_000;
const MAX_BODY = 8 * 1024;
const MAX_TEXT = 1000;
const MAX_REPLIES_PER_MIN = 5;
const DUPLICATE_MS = 30_000;
const SUBMIT_DELAY_MS = 150;
const PERMISSION_MARKERS = ['Do you want to', '1. Yes']; // le menu de permission de Claude Code
const QUESTION_MARKER = 'Enter to select';
const MATCH_LEN = 20;

const isTailscale = (ip) => {
  const m = /^100\.(\d+)\./.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127; // 100.64.0.0/10
};
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class PhoneServer {
  constructor({ sessions, terminal = () => null, settings, save, log = () => {}, bindOverride = null }) {
    this.sessions = sessions;
    this.terminal = terminal;
    this.settings = settings;
    this.save = save;
    this.log = log;
    this.bindOverride = bindOverride; // pour les tests
    this.server = null;
    this.listening = null; // { host, port }
    this.error = '';
    this.fails = new Map();
    this.recent = []; // réponses récentes : { at, id, text }
  }

  cfg() { return this.settings().phone; }

  addresses() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        out.push({ name, ip: a.address, tailscale: isTailscale(a.address) });
      }
    }
    return out.sort((a, b) => Number(b.tailscale) - Number(a.tailscale));
  }

  // Tailscale présent : on n'écoute que sur lui (rien n'est visible sur le Wi-Fi).
  bindHost() {
    if (this.bindOverride) return this.bindOverride;
    const t = this.addresses().find((a) => a.tailscale);
    return t ? t.ip : '0.0.0.0';
  }

  // Répondre n'est permis que si le serveur n'est pas ouvert à tout le réseau local.
  replySafe() { return !!this.listening && this.listening.host !== '0.0.0.0'; }

  newToken() {
    this.cfg().token = crypto.randomBytes(24).toString('hex');
    this.save();
  }

  sync() {
    const c = this.cfg();
    const want = c.enabled ? { host: this.bindHost(), port: Number(c.port) || 47821 } : null;
    const same = want && this.listening && want.host === this.listening.host && want.port === this.listening.port;
    if (same || (!want && !this.server)) return;
    this.stop();
    if (want) this.start(want);
  }

  start({ host, port }) {
    if (!this.cfg().token) this.newToken();
    this.error = '';
    const srv = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      this.log('phone', e.message);
      try { res.writeHead(500); res.end(); } catch {}
    }));
    srv.on('error', (e) => {
      this.error = e.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé.` : e.message;
      this.log('phone', this.error);
      this.server = null;
      this.listening = null;
    });
    srv.listen(port, host, () => { this.listening = { host, port }; });
    this.server = srv;
  }

  stop() {
    if (!this.server) return;
    try { this.server.closeAllConnections?.(); this.server.close(); } catch {}
    this.server = null;
    this.listening = null;
  }

  tokenOk(given) {
    const want = Buffer.from(String(this.cfg().token || ''));
    const got = Buffer.from(String(given || ''));
    return want.length > 0 && want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  limited(ip) {
    const now = Date.now();
    const f = (this.fails.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    this.fails.set(ip, f);
    return f.length >= MAX_FAILS;
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (d) => {
        size += d.length;
        if (size > MAX_BODY) { reject(new Error('trop gros')); req.destroy(); return; }
        chunks.push(d);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('JSON invalide')); }
      });
      req.on('error', reject);
    });
  }

  async handle(req, res) {
    const ip = req.socket.remoteAddress || '?';
    const send = (code, body, type = 'application/json; charset=utf-8', cache = 'no-store') => {
      res.writeHead(code, {
        'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(400, { error: 'requête invalide' }); }
    const p = url.pathname;

    // Les fichiers de la page (sans aucune donnée) : pas de code demandé.
    if (req.method === 'GET' && (p === '/app' || p === '/manifest.webmanifest' || p === '/icon.png' || p.startsWith('/frames/'))) return this.serveStatic(p, send);

    const api = (req.method === 'GET' && (p === '/api/status' || p === '/api/app' || p === '/'))
      || (req.method === 'POST' && (p === '/api/reply' || p === '/api/answer'));
    if (!api) return send(404, { error: 'introuvable' });
    if (this.limited(ip)) return send(429, { error: "trop d'essais, réessaie dans une minute" });

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    // Le code dans l'adresse n'est accepté que pour la lecture (widget) : jamais pour écrire.
    const given = bearer ? bearer[1] : (req.method === 'GET' ? url.searchParams.get('t') : null);
    if (!this.tokenOk(given)) {
      this.fails.get(ip).push(Date.now());
      return send(401, { error: 'code invalide' });
    }

    if (p === '/api/status' || p === '/') return send(200, this.payload());
    const c = this.cfg();
    if (!c.app || !c.app.enabled) return send(403, { error: "l'appli web est désactivée (Cube Hub → Réglages → Téléphone)" });
    if (p === '/api/app') return send(200, this.appPayload());

    let body;
    try { body = await this.readBody(req); } catch (e) { return send(400, { error: e.message }); }
    const r = p === '/api/reply' ? await this.reply(body) : await this.answer(body);
    return send(r.ok ? 200 : r.code || 400, r.ok ? { ok: true, label: r.label } : { error: r.error });
  }

  serveStatic(p, send) {
    try {
      // Les images du cube (comme le widget du PC) : seulement /frames/index.json et /frames/card/<dossier>/<image>.png
      if (p.startsWith('/frames/')) {
        const base = path.join(__dirname, '..', 'assets', 'frames');
        if (p === '/frames/index.json') return send(200, fs.readFileSync(path.join(base, 'index.json')), 'application/json', 'private, max-age=86400');
        const m = /^\/frames\/card\/(Travail|Sommeil)\/([\w.-]+\.png)$/.exec(p);
        if (!m) return send(404, { error: 'introuvable' });
        return send(200, fs.readFileSync(path.join(base, 'card', m[1], m[2])), 'image/png', 'private, max-age=86400');
      }
      if (p === '/app') return send(200, fs.readFileSync(path.join(__dirname, 'phone-app.html')), 'text/html; charset=utf-8');
      if (p === '/icon.png') return send(200, fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.png')), 'image/png');
      return send(200, JSON.stringify({
        name: 'Cube Hub', short_name: 'Cube', start_url: '/app', scope: '/', display: 'standalone',
        background_color: '#0a0c0b', theme_color: '#0a0c0b', icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
      }), 'application/manifest+json');
    } catch { return send(404, { error: 'introuvable' }); }
  }

  // Le strict nécessaire pour le widget : ni dossiers, ni conversations, ni autorisations en attente.
  payload() {
    const list = (this.sessions() || []).map((s) => ({
      name: s.projectName,
      status: s.status,
      since: s.statusChangedAt || s.updatedAt || null,
      startedAt: s.startedAt || null,
      tokens: s.contextTokens || 0,
      task: s.currentTask ? String(s.currentTask).slice(0, 80) : null,
    }));
    return { pc: os.hostname(), at: new Date().toISOString(), sessions: list };
  }

  // Une session peut recevoir une réponse : lancée dans le Hub, terminal ouvert, projet autorisé.
  reachable(s) {
    if (!this.replySafe()) return { ok: false, why: 'Tailscale est nécessaire pour répondre (le serveur est ouvert à tout ton réseau local)' };
    if (!s || !s.hubProject) return { ok: false, why: 'elle tourne dans un terminal externe (seules les sessions lancées dans Cube Hub peuvent recevoir une réponse)' };
    if (!this.cfg().app.allowed?.[s.hubProject]) return { ok: false, why: "ce projet n'est pas autorisé (Cube Hub → Réglages → Téléphone)" };
    const term = this.terminal(s.hubProject);
    if (!term) return { ok: false, why: 'son terminal est fermé' };
    return { ok: true, term };
  }

  appPayload() {
    const list = (this.sessions() || []).map((s) => {
      const r = this.reachable(s);
      return {
        id: s.id,
        name: s.projectName,
        status: s.status,
        since: s.statusChangedAt || s.updatedAt || null,
        tokens: s.contextTokens || 0,
        task: s.currentTask ? String(s.currentTask).slice(0, 120) : null,
        canReply: r.ok,
        whyNot: r.ok ? null : r.why,
        permission: s.status === 'waiting' && s.pendingPermission
          ? { tool: String(s.pendingPermission.tool || '').slice(0, 60), detail: String(s.pendingPermission.detail || '').slice(0, 300) } : null,
        question: s.status === 'waiting' && s.pendingQuestion && Array.isArray(s.pendingQuestion.items) && s.pendingQuestion.items.length === 1
          ? { question: String(s.pendingQuestion.items[0].question || '').slice(0, 300), options: (s.pendingQuestion.items[0].options || []).slice(0, 8).map((o) => String(o).slice(0, 120)) } : null,
        answer: s.lastAnswer && s.lastAnswer.excerpt ? String(s.lastAnswer.excerpt).slice(0, 500) : null,
      };
    });
    return { pc: os.hostname(), at: new Date().toISOString(), replyReady: this.replySafe(), sessions: list };
  }

  // Un message libre : une seule ligne, sans aucune touche spéciale.
  async reply(body) {
    const s = (this.sessions() || []).find((x) => x.id === body.id);
    if (!s) return { ok: false, code: 404, error: 'session introuvable' };
    const r = this.reachable(s);
    if (!r.ok) return { ok: false, code: 403, error: r.why };
    const text = String(body.text || '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
    if (!text) return { ok: false, error: 'message vide' };
    // « ! » lance une commande Windows et « / » une commande de Claude Code : pas depuis un téléphone.
    if (/^[!/#]/.test(text)) return { ok: false, error: 'un message ne peut pas commencer par ! / ou # (ce seraient des commandes)' };
    if (text.length > MAX_TEXT) return { ok: false, error: `message trop long (${MAX_TEXT} caractères au plus)` };
    const now = Date.now();
    this.recent = this.recent.filter((x) => now - x.at < WINDOW_MS);
    if (this.recent.length >= MAX_REPLIES_PER_MIN) return { ok: false, code: 429, error: 'trop de messages en une minute' };
    if (this.recent.some((x) => x.id === s.id && x.text === text && now - x.at < DUPLICATE_MS)) return { ok: false, error: 'même message déjà envoyé à l\'instant' };
    this.recent.push({ at: now, id: s.id, text });
    r.term.write(text);
    await wait(SUBMIT_DELAY_MS);
    r.term.write('\r');
    this.log('phone', `réponse à ${s.projectName} : ${text.slice(0, 120)}`);
    return { ok: true, label: 'Envoyé' };
  }

  // Une réponse au menu de Claude : oui / non à une permission, ou une option d'une question.
  async answer(body) {
    const s = (this.sessions() || []).find((x) => x.id === body.id);
    if (!s) return { ok: false, code: 404, error: 'session introuvable' };
    if (s.status !== 'waiting') return { ok: false, error: "Claude n'attend plus de réponse" };
    const r = this.reachable(s);
    if (!r.ok) return { ok: false, code: 403, error: r.why };
    const screen = stripAnsi(r.term.tail());
    let keys;
    let label;
    if (body.kind === 'p' && s.pendingPermission) {
      if (body.value !== 'yes' && body.value !== 'no') return { ok: false, error: 'choix inconnu' };
      if (!PERMISSION_MARKERS.every((m) => screen.includes(m))) return { ok: false, error: 'le terminal ne montre pas la demande : réponds depuis le PC' };
      keys = body.value === 'yes' ? '1' : '\x1b';
      label = body.value === 'yes' ? 'Oui' : 'Non';
    } else if (body.kind === 'q' && s.pendingQuestion && s.pendingQuestion.items && s.pendingQuestion.items.length === 1) {
      const item = s.pendingQuestion.items[0];
      const i = Number(body.value);
      const option = Number.isInteger(i) ? (item.options || [])[i] : null;
      if (option == null) return { ok: false, error: 'choix inconnu' };
      const flat = screen.replace(/\s+/g, ' ');
      const head = (t) => String(t).replace(/\s+/g, ' ').slice(0, MATCH_LEN);
      if (!flat.includes(QUESTION_MARKER) || !flat.includes(head(item.question)) || !flat.includes(head(option))) {
        return { ok: false, error: 'le terminal ne montre pas la question : réponds depuis le PC' };
      }
      keys = String(i + 1);
      label = `${i + 1}. ${option}`;
    } else {
      return { ok: false, error: "Claude n'attend plus cette réponse" };
    }
    const now = Date.now();
    this.recent = this.recent.filter((x) => now - x.at < WINDOW_MS);
    if (this.recent.length >= MAX_REPLIES_PER_MIN) return { ok: false, code: 429, error: 'trop de réponses en une minute' };
    this.recent.push({ at: now, id: s.id, text: '\0' + keys });
    r.term.write(keys);
    this.log('phone', `réponse à ${s.projectName} : ${label}`);
    return { ok: true, label };
  }

  info() {
    const c = this.cfg();
    const port = Number(c.port) || 47821;
    const addrs = this.addresses();
    const best = addrs.find((a) => a.tailscale) || addrs[0];
    const base = best ? `http://${best.ip}:${port}` : '';
    return {
      enabled: !!c.enabled,
      running: !!this.listening,
      error: this.error,
      port,
      bindHost: this.listening ? this.listening.host : null,
      tailscale: addrs.some((a) => a.tailscale),
      replySafe: this.replySafe(),
      addresses: addrs,
      link: c.enabled && c.token && best ? `${base}/?t=${c.token}` : '',
      appLink: c.enabled && c.token && best ? `${base}/app#t=${c.token}` : '',
      appUrl: c.enabled && best ? `${base}/app` : '',
    };
  }
}

module.exports = { PhoneServer, isTailscale };
