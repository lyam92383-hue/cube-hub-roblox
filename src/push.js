// Cube Hub V2 : notifications sur le téléphone quand une session attend ta réponse ou termine.
// Deux services au choix :
//  - Discord (recommandé) : un « webhook » dans un salon privé ; l'appli Discord de l'iPhone affiche
//    une vraie notification, avec un lien qui ouvre l'appli web de Cube Hub.
//  - ntfy : appli gratuite, mais ses notifications sont peu fiables sur iPhone.
// Par défaut, seul le nom du projet part : ni question, ni réponse de Claude (option « extrait »).
const crypto = require('crypto');

const TYPES = {
  waiting: { title: (n) => `⏳ ${n} attend ta réponse`, plain: 'Une réponse ou une autorisation est attendue.', tags: ['hourglass_flowing_sand'], priority: 4 },
  done: { title: (n) => `✅ ${n} a terminé`, plain: 'La session a fini son travail.', tags: ['white_check_mark'], priority: 3 },
};
const DEDUPE_MS = 20_000;
const DISCORD_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

class Push {
  constructor({ settings, save, appUrl = () => '', log = () => {} }) {
    this.settings = settings;
    this.save = save;
    this.appUrl = appUrl;
    this.log = log;
    this.last = new Map();
    this.lastError = '';
  }

  cfg() { return this.settings().phone.push; }

  ready() {
    const c = this.cfg();
    if (!c.enabled) return false;
    return c.provider === 'ntfy' ? !!(c.topic && c.server) : DISCORD_RE.test(c.webhook || '');
  }

  newTopic() {
    this.cfg().topic = 'cubehub-' + crypto.randomBytes(12).toString('hex');
    this.save();
  }

  static validWebhook(v) { return DISCORD_RE.test(String(v || '').trim()); }

  async post(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status === 404 ? "ce webhook n'existe plus" : `le serveur répond ${r.status}`);
      this.lastError = '';
      return { ok: true };
    } catch (e) {
      this.lastError = e.name === 'TimeoutError' ? 'Pas de réponse du serveur' : e.message;
      this.log('push', this.lastError);
      return { ok: false, error: this.lastError };
    }
  }

  // title / message / priorité / tags, quel que soit le service.
  async publish({ title, message, tags = [], priority = 3 }) {
    const c = this.cfg();
    if (c.provider === 'ntfy') {
      return this.post(String(c.server).replace(/\/+$/, '') + '/', { topic: c.topic, title, message, tags, priority });
    }
    const link = this.appUrl();
    return this.post(c.webhook, {
      username: 'Cube Hub',
      allowed_mentions: { parse: [] }, // jamais de @everyone, même si un nom de projet en contient
      content: `**${title}**\n${message}${link ? `\n${link}` : ''}`,
    });
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
    const c = this.cfg();
    if (c.provider === 'ntfy' && !c.topic) this.newTopic();
    if (c.provider !== 'ntfy' && !DISCORD_RE.test(c.webhook || '')) return { ok: false, error: "colle d'abord l'adresse du webhook Discord" };
    return this.publish({ title: '🧊 Cube Hub', message: 'Ça marche : tu recevras ici les sessions qui attendent ou qui terminent.', tags: ['cube'], priority: 3 });
  }

  info() {
    const c = this.cfg();
    return {
      enabled: !!c.enabled, provider: c.provider, server: c.server, topic: c.topic, details: !!c.details,
      webhookSet: DISCORD_RE.test(c.webhook || ''), error: this.lastError,
    };
  }
}

module.exports = { Push };
