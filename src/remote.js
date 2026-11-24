// Commandes depuis Telegram : écrire à une session, répondre Oui / Non à une permission,
// choisir une réponse à une question. Port de Sources/CubeWidget/Telegram/TelegramRemote.swift,
// RemoteLock.swift et RemoteLog.swift.
//
// Sur Windows, seules les sessions lancées dans un terminal du Cube Hub peuvent recevoir du
// texte (l'app écrit directement dans leur terminal).
//
// Sécurité (tout est refusé par défaut) :
// - seule ta conversation avec le bot compte ;
// - il faut d'abord déverrouiller avec /unlock et le code à 6 chiffres de ton app
//   d'authentification (30 minutes) ; 5 mauvais codes de suite coupent les commandes ;
// - chaque projet doit être autorisé un par un ;
// - messages trop vieux, trop longs, trop nombreux ou en double refusés ;
// - tout est noté dans ~/.cube-widget/remote.log.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const paths = require('./paths');
const totp = require('./totp');

const C = {
  maxAgeSec: 60,
  maxLength: 2000,
  maxPerMinute: 5,
  duplicateWindowMs: 30_000,
  maxRefusals: 10,
  refusalWindowMs: 10 * 60_000,
  unlockMs: 30 * 60_000,
  maxFailedCodes: 5,
  codeWaitMs: 60_000,
  buttonsMaxAgeSec: 15 * 60,
  submitDelayMs: 150,
  rememberedMessages: 300,
  logExcerpt: 200,
  logMaxSize: 1_000_000,
  pollTimeoutSec: 25,
  retryDelayMs: 5000,
  permissionMarkers: ['Do you want to', '1. Yes'],
  questionMarker: 'Enter to select',
  questionMatchLength: 20,
};

const SECRET_FILE = path.join(paths.baseDir, 'telegram-totp.bin');
const LOG_FILE = path.join(paths.baseDir, 'remote.log');

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Remote {
  /**
   * @param {object} o
   * @param {import('./notify').Notifier} o.notifier
   * @param {() => object} o.getSettings  état complet de l'app
   * @param {() => void} o.save
   * @param {() => object[]} o.sessions  sessions actuelles
   * @param {(projectId:string) => ({write:(s:string)=>void, tail:()=>string} | null)} o.terminal
   * @param {() => void} o.changed  l'état (verrou…) a changé : rafraîchir les réglages
   */
  constructor(o) {
    Object.assign(this, o);
    this.unlockedUntil = 0;
    this.failedCodes = 0;
    this.awaitingCodeUntil = 0;
    this.refusals = [];
    this.recentSends = []; // { at, sessionId, text }
    this.messageMap = new Map(); // message_id → session id
    this.offset = 0;
    this.running = false;
    this.pendingSecret = null;

    // Les notifications portent les boutons et sont retenues pour pouvoir y répondre.
    this.notifier.decorate = (type, s) => this.decorate(type, s);
    this.notifier.onSent = (message, s) => this.remember(message, s);
  }

  get tg() {
    return this.getSettings().telegram;
  }

  get enabled() {
    const tg = this.tg;
    return !!(tg.commands?.enabled && tg.chatId && this.hasSecret() && this.notifier.hasToken());
  }

  get unlocked() {
    return Date.now() < this.unlockedUntil;
  }

  status() {
    return {
      configured: this.hasSecret(),
      enabled: this.enabled,
      unlockedUntil: this.unlocked ? this.unlockedUntil : null,
      polling: this.running,
    };
  }

  // ------------------------------------------------ Code de déverrouillage

  hasSecret() {
    return fs.existsSync(SECRET_FILE);
  }

  readSecret() {
    try {
      return safeStorage.decryptString(fs.readFileSync(SECRET_FILE));
    } catch {
      return null;
    }
  }

  /** Nouvelle clé, gardée en mémoire jusqu'à ce qu'un premier code la confirme. */
  async beginSetup() {
    this.pendingSecret = totp.newSecret();
    const url = totp.otpauthURL(this.pendingSecret, 'Telegram');
    const qr = await require('qrcode').toDataURL(url, { margin: 1, width: 320, color: { dark: '#000000', light: '#ffffff' } });
    return { secret: this.pendingSecret.match(/.{1,4}/g).join(' '), qr };
  }

  confirmSetup(code) {
    if (!this.pendingSecret) return { ok: false, error: 'Recommence la configuration.' };
    if (!totp.verify(this.pendingSecret, code)) return { ok: false, error: 'Code incorrect. Vérifie l\'heure du téléphone et réessaie.' };
    fs.mkdirSync(paths.baseDir, { recursive: true });
    fs.writeFileSync(SECRET_FILE, safeStorage.encryptString(this.pendingSecret));
    this.pendingSecret = null;
    this.log('code configuré');
    return { ok: true };
  }

  removeSecret() {
    try { fs.unlinkSync(SECRET_FILE); } catch {}
    this.lock('code supprimé');
    this.tg.commands.enabled = false;
    this.save();
    this.sync();
  }

  lock(reason) {
    this.unlockedUntil = 0;
    this.awaitingCodeUntil = 0;
    if (reason) this.log(`verrouillé (${reason})`);
    this.changed();
  }

  // ------------------------------------------------ Écoute de Telegram

  /** Démarre ou arrête l'écoute selon les réglages. */
  sync() {
    if (this.enabled && !this.running) this.loop();
    if (!this.enabled) this.running = false;
    this.changed();
  }

  async loop() {
    this.running = true;
    // Les messages envoyés pendant que l'app était fermée sont ignorés : ils ne correspondent
    // sans doute plus à ce que fait Claude.
    try {
      const last = await this.notifier.call('getUpdates', { offset: -1, timeout: 0 });
      if (last.length) this.offset = Math.max(this.offset, last[last.length - 1].update_id + 1);
    } catch {}
    this.offset = Math.max(this.offset, this.notifier.updateOffset || 0);
    while (this.running && this.enabled) {
      if (this.notifier.detecting) {
        // La recherche de ta conversation lit aussi les messages : on attend qu'elle finisse.
        await wait(1000);
        continue;
      }
      try {
        const updates = await this.notifier.call('getUpdates', {
          offset: this.offset, timeout: C.pollTimeoutSec, allowed_updates: ['message', 'callback_query'],
        }, undefined, (C.pollTimeoutSec + 10) * 1000);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          try {
            if (u.message) await this.onMessage(u.message);
            else if (u.callback_query) await this.onButton(u.callback_query);
          } catch (e) {
            this.log(`erreur : ${e.message}`);
          }
        }
      } catch (e) {
        if (!this.running) break;
        await wait(C.retryDelayMs);
      }
    }
    this.running = false;
  }

  stop() {
    this.running = false;
  }

  reply(text, extra = {}) {
    return this.notifier.send(text, extra).catch((e) => this.log(`envoi impossible : ${e.message}`));
  }

  refuse(text, why) {
    this.log(`refusé : ${why}`);
    const now = Date.now();
    this.refusals = this.refusals.filter((t) => now - t < C.refusalWindowMs);
    this.refusals.push(now);
    if (this.refusals.length >= C.maxRefusals && this.unlocked) {
      this.lock('trop de refus');
      return this.reply('🔒 Trop de messages refusés : les commandes sont verrouillées. Renvoie /unlock avec ton code.');
    }
    return text ? this.reply(text) : null;
  }

  // ------------------------------------------------ Messages

  async onMessage(m) {
    if (!m.chat || m.chat.id !== this.tg.chatId) {
      this.log(`ignoré : message d'une autre conversation (${m.chat?.id})`);
      return;
    }
    const text = String(m.text || '').trim();
    // Le code de déverrouillage n'est jamais écrit dans le journal.
    const shown = /^\/unlock\b/i.test(text) || (Date.now() < this.awaitingCodeUntil && /^\d{3}\s?\d{3}$/.test(text))
      ? text.replace(/\d/g, '•') : text;
    this.log(`reçu : ${shown.slice(0, C.logExcerpt)}`);
    if (Date.now() / 1000 - m.date > C.maxAgeSec) {
      return this.refuse('⌛ Message arrivé en retard, ignoré (il ne correspond peut-être plus à ce que fait Claude). Renvoie-le.', 'trop ancien');
    }
    if (!text) return this.refuse('Je ne comprends que le texte.', 'pas de texte');

    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd.toLowerCase().replace(/@\w+$/, '')) {
      case '/start':
      case '/aide':
      case '/help':
        return this.reply(this.helpText());
      case '/lock':
        this.lock('/lock');
        return this.reply('🔒 Verrouillé.');
      case '/unlock':
        if (arg) return this.tryCode(arg);
        this.awaitingCodeUntil = Date.now() + C.codeWaitMs;
        return this.reply('🔑 Envoie le code à 6 chiffres de ton app d\'authentification.');
      case '/sessions':
        return this.listSessions();
      default:
        break;
    }
    if (Date.now() < this.awaitingCodeUntil && /^\d{3}\s?\d{3}$/.test(text)) return this.tryCode(text);
    if (text.startsWith('/')) return this.refuse('Commande inconnue. /aide pour la liste.', 'commande inconnue');
    return this.sendToSession(text, m);
  }

  helpText() {
    return [
      '🧊 <b>Cube Hub</b> — commandes',
      '/unlock <i>code</i> : déverrouiller 30 min avec ton app d\'authentification',
      '/lock : verrouiller',
      '/sessions : tes sessions (réponds à l\'une pour lui écrire)',
      '',
      'Pour écrire à Claude, <b>réponds</b> (glisser vers la gauche) à un message d\'une session.',
      'Les boutons ✅ Oui / ❌ Non répondent aux permissions.',
      'Seules les sessions lancées dans le Cube Hub et autorisées dans Réglages → Telegram peuvent recevoir des messages.',
    ].join('\n');
  }

  async tryCode(input) {
    this.awaitingCodeUntil = 0;
    const secret = this.readSecret();
    if (secret && totp.verify(secret, input)) {
      this.failedCodes = 0;
      this.unlockedUntil = Date.now() + C.unlockMs;
      this.log('déverrouillé');
      this.changed();
      const until = new Date(this.unlockedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return this.reply(`🔓 Déverrouillé jusqu'à ${until}.`);
    }
    this.failedCodes++;
    this.log(`mauvais code (${this.failedCodes})`);
    if (this.failedCodes >= C.maxFailedCodes) {
      this.failedCodes = 0;
      this.tg.commands.enabled = false;
      this.save();
      this.lock('trop de mauvais codes');
      this.sync();
      return this.reply('⛔ Trop de mauvais codes : les commandes sont coupées. Rallume-les sur le PC (Réglages → Telegram).');
    }
    return this.reply('❌ Code incorrect.');
  }

  /** Une session peut recevoir des messages : lancée dans le Hub, terminal ouvert, projet autorisé. */
  reachable(s) {
    if (!s?.hubProject) return { ok: false, why: 'elle tourne dans un terminal externe (seules les sessions lancées dans le Cube Hub peuvent recevoir des messages)' };
    if (!this.tg.commands?.allowed?.[s.hubProject]) return { ok: false, why: 'ce projet n\'est pas autorisé (Réglages → Telegram sur le PC)' };
    const term = this.terminal(s.hubProject);
    if (!term) return { ok: false, why: 'son terminal est fermé' };
    return { ok: true, term };
  }

  async listSessions() {
    const list = this.sessions();
    if (!list.length) return this.reply('😴 Aucune session ouverte.');
    const label = { working: '🔵 bosse', waiting: '🟠 attend ta réponse', done: '🟢 terminé' };
    for (const s of list.slice(0, 10)) {
      const r = this.reachable(s);
      const msg = await this.reply(`<b>${esc(s.projectName)}</b> — ${label[s.status]}` +
        (s.currentTask ? `\n${esc(s.currentTask)}` : '') +
        (r.ok ? '\n✍️ Réponds à ce message pour lui écrire.' : ''));
      if (msg) this.remember(msg, s);
    }
    return null;
  }

  async sendToSession(text, m) {
    if (!this.unlocked) return this.refuse('🔒 Verrouillé. Envoie /unlock suivi du code de ton app d\'authentification.', 'verrouillé');
    let session = null;
    const replyTo = m.reply_to_message?.message_id;
    if (replyTo && this.messageMap.has(replyTo)) {
      session = this.sessions().find((s) => s.id === this.messageMap.get(replyTo));
      if (!session) return this.refuse('Cette session est fermée.', 'session fermée');
    } else {
      const reachable = this.sessions().filter((s) => this.reachable(s).ok);
      if (reachable.length === 1) session = reachable[0];
      else return this.refuse(reachable.length
        ? '↩️ Plusieurs sessions possibles : réponds au message de celle à qui tu écris (/sessions pour la liste).'
        : 'Aucune session ne peut recevoir de messages (lancée dans le Cube Hub et autorisée).', 'session inconnue');
    }
    const r = this.reachable(session);
    if (!r.ok) return this.refuse(`Impossible d'écrire à ${esc(session.projectName)} : ${r.why}.`, `injoignable : ${r.why}`);
    if (text.length > C.maxLength) return this.refuse(`Message trop long (${C.maxLength} caractères au plus).`, 'trop long');
    const now = Date.now();
    this.recentSends = this.recentSends.filter((x) => now - x.at < 60_000);
    if (this.recentSends.length >= C.maxPerMinute) return this.refuse('⏱️ Trop de messages en une minute, attends un peu.', 'trop de messages');
    if (this.recentSends.some((x) => x.sessionId === session.id && x.text === text && now - x.at < C.duplicateWindowMs)) {
      return this.refuse('Même message déjà envoyé à l\'instant, ignoré.', 'doublon');
    }
    this.recentSends.push({ at: now, sessionId: session.id, text });
    // Une ligne : les retours à la ligne valideraient le message en plusieurs fois.
    r.term.write(text.replace(/\r?\n/g, ' '));
    await wait(C.submitDelayMs);
    r.term.write('\r');
    this.log(`écrit à ${session.projectName} : ${text.slice(0, C.logExcerpt)}`);
    return this.reply(`✍️ Envoyé à <b>${esc(session.projectName)}</b>.`);
  }

  // ------------------------------------------------ Boutons

  /** Boutons ajoutés à la notification « attend ta réponse » d'une session joignable. */
  decorate(type, s) {
    if (!this.enabled || type !== 'waiting' || !this.reachable(s).ok) return {};
    if (s.pendingQuestion?.items?.length === 1 && !s.pendingQuestion.items[0].multiSelect) {
      const q = s.pendingQuestion.items[0];
      const rows = q.options.slice(0, 8).map((o, i) => [{ text: `${i + 1}. ${o.slice(0, 40)}`, callback_data: `q|${s.id}|${i}` }]);
      return rows.length ? { reply_markup: { inline_keyboard: rows } } : {};
    }
    if (s.pendingPermission) {
      return { reply_markup: { inline_keyboard: [[
        { text: '✅ Oui', callback_data: `p|${s.id}|yes` },
        { text: '❌ Non', callback_data: `p|${s.id}|no` },
      ]] } };
    }
    return {};
  }

  remember(message, s) {
    if (!message?.message_id) return;
    this.messageMap.set(message.message_id, s.id);
    while (this.messageMap.size > C.rememberedMessages) this.messageMap.delete(this.messageMap.keys().next().value);
  }

  async onButton(q) {
    const answer = (text) => this.notifier.call('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {});
    const msg = q.message;
    if (!msg || msg.chat?.id !== this.tg.chatId || q.from?.id !== this.tg.chatId) {
      this.log('ignoré : bouton d\'une autre conversation');
      return answer('Refusé.');
    }
    const [kind, sessionId, value] = String(q.data || '').split('|');
    this.log(`bouton : ${kind} ${value}`);
    if (!this.unlocked) {
      await this.refuse(null, 'bouton verrouillé');
      return answer('🔒 Verrouillé : envoie /unlock avec ton code.');
    }
    if (Date.now() / 1000 - msg.date > C.buttonsMaxAgeSec) {
      await this.refuse(null, 'bouton trop ancien');
      return answer('⌛ Ce bouton est trop ancien.');
    }
    const s = this.sessions().find((x) => x.id === sessionId);
    if (!s || s.status !== 'waiting') return answer('Claude n\'attend plus cette réponse.');
    const r = this.reachable(s);
    if (!r.ok) return answer(`Impossible : ${r.why}.`);
    const screen = stripAnsi(r.term.tail());

    let keys;
    let label;
    if (kind === 'p' && s.pendingPermission) {
      // Le terminal doit vraiment montrer le menu de permission de Claude.
      if (!C.permissionMarkers.every((mk) => screen.includes(mk))) return answer('Le terminal ne montre pas la demande : réponds depuis le PC.');
      keys = value === 'yes' ? '1' : '\x1b';
      label = value === 'yes' ? '✅ Oui' : '❌ Non';
    } else if (kind === 'q' && s.pendingQuestion?.items?.length === 1) {
      const item = s.pendingQuestion.items[0];
      const i = Number(value);
      const option = item.options[i];
      if (option == null) return answer('Choix inconnu.');
      const flat = screen.replace(/\s+/g, ' ');
      const head = (t) => t.replace(/\s+/g, ' ').slice(0, C.questionMatchLength);
      if (!flat.includes(C.questionMarker) || !flat.includes(head(item.question)) || !flat.includes(head(option))) {
        return answer('Le terminal ne montre pas la question : réponds depuis le PC.');
      }
      keys = String(i + 1);
      label = `${i + 1}. ${option}`;
    } else {
      return answer('Claude n\'attend plus cette réponse.');
    }
    r.term.write(keys);
    this.log(`répondu à ${s.projectName} : ${label}`);
    await answer(label);
    await this.notifier.call('editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    return this.reply(`${label} → <b>${esc(s.projectName)}</b>`);
  }

  // ------------------------------------------------ Journal

  log(line) {
    try {
      fs.mkdirSync(paths.baseDir, { recursive: true });
      try {
        if (fs.statSync(LOG_FILE).size > C.logMaxSize) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      } catch {}
      fs.appendFileSync(LOG_FILE, `${new Date().toISOString()}  ${line.replace(/\s+/g, ' ')}\n`);
    } catch {}
  }
}

module.exports = { Remote, LOG_FILE };
