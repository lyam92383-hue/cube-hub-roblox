// Cube Hub V2 : notifications sur le téléphone, via ntfy (appli gratuite, serveur ntfy.sh ou le tien).
// Quand une session attend ta réponse ou termine, Cube Hub envoie une notification à un « sujet »
// secret auquel ton iPhone est abonné. Par défaut, seul le nom du projet part : ni question, ni
// réponse de Claude (option « inclure un extrait » pour les ajouter).
const crypto = require('crypto');

const TYPES = {
  waiting: { title: (n) => `⏳ ${n} attend ta réponse`, plain: 'Une réponse ou une autorisation est attendue.', tags: ['hourglass_flowing_sand'], priority: 4 },
  done: { title: (n) => `✅ ${n} a terminé`, plain: 'La session a fini son travail.', tags: ['white_check_mark'], priority: 3 },
};
const DEDUPE_MS = 20_000;

class Push {
  constructor({ settings, save, log = () => {} }) {
    this.settings = settings;
    this.save = save;
    this.log = log;
    this.last = new Map();
    this.lastError = '';
  }

  cfg() { return this.settings().phone.push; }
  ready() { const c = this.cfg(); return !!(c.enabled && c.topic && c.server); }

  newTopic() {
    this.cfg().topic = 'cubehub-' + crypto.randomBytes(12).toString('hex');
    this.save();
  }

  async publish(body) {
    const c = this.cfg();
    try {
      const r = await fetch(String(c.server).replace(/\/+$/, '') + '/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: c.topic, ...body }), signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`le serveur répond ${r.status}`);
      this.lastError = '';
      return { ok: true };
    } catch (e) {
      this.lastError = e.name === 'TimeoutError' ? 'Pas de réponse du serveur' : e.message;
      this.log('push', this.lastError);
      return { ok: false, error: this.lastError };
    }
  }

  // Appelé par le Notifier à chaque événement.
  async send(type, session, detail) {
    const t = TYPES[type];
    if (!t || !this.ready()) return;
    const key = `${session.id}|${type}`;
    const now = Date.now();
    if (now - (this.last.get(key) || 0) < DEDUPE_MS) return;
    this.last.set(key, now);
    const message = this.cfg().details && detail ? String(detail).slice(0, 300) : t.plain;
    await this.publish({ title: t.title(session.projectName || 'Session'), message, tags: t.tags, priority: t.priority });
  }

  async test() {
    if (!this.cfg().topic) this.newTopic();
    return this.publish({ title: '🧊 Cube Hub', message: 'Ça marche : tu recevras ici les sessions qui attendent ou qui terminent.', tags: ['cube'], priority: 3 });
  }

  info() {
    const c = this.cfg();
    return { enabled: !!c.enabled, server: c.server, topic: c.topic, details: !!c.details, error: this.lastError };
  }
}

module.exports = { Push };
