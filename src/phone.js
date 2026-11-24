// Cube Hub V2 : état des sessions pour le widget du téléphone.
// Petit serveur HTTP, désactivé par défaut. Il ne sait faire qu'une chose : répondre à
// GET /api/status avec l'état des sessions (nom, état, durée, tokens), à condition de
// présenter le code secret. Rien ne peut être modifié ni lancé par ce serveur.
const http = require('http');
const os = require('os');
const crypto = require('crypto');

const MAX_FAILS = 10; // essais ratés par adresse et par minute
const WINDOW_MS = 60_000;

const isTailscale = (ip) => {
  const m = /^100\.(\d+)\./.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127; // 100.64.0.0/10
};

class PhoneServer {
  constructor({ sessions, settings, save, log = () => {} }) {
    this.sessions = sessions;
    this.settings = settings;
    this.save = save;
    this.log = log;
    this.server = null;
    this.listening = null; // { host, port }
    this.error = '';
    this.fails = new Map();
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
    const t = this.addresses().find((a) => a.tailscale);
    return t ? t.ip : '0.0.0.0';
  }

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
    const srv = http.createServer((req, res) => this.handle(req, res));
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

  handle(req, res) {
    const ip = req.socket.remoteAddress || '?';
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(400, { error: 'requête invalide' }); }
    if (req.method !== 'GET' || (url.pathname !== '/api/status' && url.pathname !== '/')) return send(404, { error: 'introuvable' });
    if (this.limited(ip)) return send(429, { error: 'trop d\'essais, réessaie dans une minute' });
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!this.tokenOk(bearer ? bearer[1] : url.searchParams.get('t'))) {
      this.fails.get(ip).push(Date.now());
      return send(401, { error: 'code invalide' });
    }
    send(200, this.payload());
  }

  // Le strict nécessaire : ni dossiers, ni conversations, ni autorisations en attente.
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

  info() {
    const c = this.cfg();
    const port = Number(c.port) || 47821;
    const addrs = this.addresses();
    const best = addrs.find((a) => a.tailscale) || addrs[0];
    return {
      enabled: !!c.enabled,
      running: !!this.listening,
      error: this.error,
      port,
      bindHost: this.listening ? this.listening.host : null,
      tailscale: addrs.some((a) => a.tailscale),
      addresses: addrs,
      link: c.enabled && c.token && best ? `http://${best.ip}:${port}/?t=${c.token}` : '',
    };
  }
}

module.exports = { PhoneServer, isTailscale };
