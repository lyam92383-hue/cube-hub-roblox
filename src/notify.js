// Notifications : bulles Windows et messages Telegram quand une session attend, finit sa
// réponse ou termine une tâche. Port simplifié de Sources/CubeWidget/Telegram (envoi seulement :
// répondre depuis Telegram n'est pas encore là).
const fs = require('fs');
const path = require('path');
const { Notification, powerMonitor, safeStorage } = require('electron');
const paths = require('./paths');

const API = process.env.CUBE_TELEGRAM_API || 'https://api.telegram.org';
const TOKEN_FILE = path.join(paths.baseDir, 'telegram-token.bin');
const MIN_INTERVAL_MS = 120_000; // au plus un message par session et par type dans ce délai
const CHECK_MS = 10_000; // un événement en attente que tu sois absent est revu à ce rythme
const PENDING_MAX_MS = 6 * 3600_000;

const EVENTS = {
  waiting: { emoji: '⏳', title: (n) => `${n} attend ta réponse` },
  done: { emoji: '💬', title: (n) => `${n} : réponse terminée` },
  task: { emoji: '✅', title: (n) => `${n} : tâche terminée` },
};

class Notifier {
  constructor({ getSettings, onClick, push = null, log = () => {} }) {
    this.push = push; // notifications du téléphone (ntfy)
    this.getSettings = getSettings;
    this.onClick = onClick;
    this.log = log;
    this.previous = new Map(); // id → { status, taskAt }
    this.loaded = false;
    this.lastSent = new Map(); // "tg|id|type" → date
    this.pending = []; // événements Telegram qui attendent ton absence
    this.sessions = [];
    this.botName = null;
    this.detecting = null;
    setInterval(() => this.flushPending(), CHECK_MS);
  }

  // ------------------------------------------------ Détection des événements

  update(list) {
    this.sessions = list;
    const first = !this.loaded;
    this.loaded = true;
    for (const s of list) {
      const before = this.previous.get(s.id);
      const taskAt = s.lastCompletedTask?.at || null;
      this.previous.set(s.id, { status: s.status, taskAt });
      if (first || !before) continue;
      if (s.status === 'waiting' && before.status !== 'waiting') this.fire('waiting', s);
      if (s.status === 'done' && before.status === 'working') this.fire('done', s);
      if (taskAt && taskAt !== before.taskAt) this.fire('task', s);
    }
    const ids = new Set(list.map((s) => s.id));
    for (const id of [...this.previous.keys()]) if (!ids.has(id)) this.previous.delete(id);
    this.pending = this.pending.filter((p) => ids.has(p.session.id));
  }

  detail(type, s) {
    if (type === 'waiting') {
      if (s.pendingQuestion?.items?.length) {
        const q = s.pendingQuestion.items[0];
        return `❓ ${q.question}` + (q.options?.length ? `\n${q.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` : '');
      }
      if (s.pendingPermission) {
        const p = s.pendingPermission;
        return `🔐 ${p.tool} : ${String(p.detail || '').slice(0, 200)}`;
      }
      return s.currentTask ? `Tâche : ${s.currentTask}` : 'Une permission, une question ou un plan à valider.';
    }
    if (type === 'done') {
      const text = (s.lastAnswer?.excerpt || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      const first = text.match(/^.{20,}?[.!?](\s|$)/)?.[0] || text;
      return first.length > 220 ? first.slice(0, 219) + '…' : first;
    }
    return s.lastCompletedTask?.subject || '';
  }

  fire(type, s) {
    if (this.push && (type === 'waiting' || type === 'done')) this.push.send(type, s, this.detail(type, s));
    const settings = this.getSettings();
    const n = settings.notifications || {};
    if (n.windows && n.windowsEvents?.[type]) this.toast(type, s);
    const tg = settings.telegram || {};
    if (tg.enabled && tg.chatId && tg.events?.[type] && this.hasToken()) {
      this.pending.push({ type, session: s, at: Date.now(), status: s.status });
      this.flushPending();
    }
  }

  // ------------------------------------------------ Bulles Windows

  toast(type, s) {
    if (!Notification.isSupported()) return;
    const ev = EVENTS[type];
    const note = new Notification({
      title: `${ev.emoji} ${ev.title(s.projectName)}`,
      body: this.detail(type, s) || ' ',
      silent: true, // le cube fait déjà son petit son
    });
    note.on('click', () => this.onClick(s));
    note.show();
  }

  // ------------------------------------------------ Telegram

  away() {
    const tg = this.getSettings().telegram || {};
    if (tg.always) return true;
    return powerMonitor.getSystemIdleTime() >= (tg.awayDelay ?? 180);
  }

  async flushPending() {
    if (!this.pending.length || !this.away()) return;
    const now = Date.now();
    const list = this.pending;
    this.pending = [];
    for (const p of list) {
      const current = this.sessions.find((s) => s.id === p.session.id);
      // La session a changé depuis (tu as répondu sur le PC) : plus la peine.
      if (!current || (p.type !== 'task' && current.status !== p.status)) continue;
      if (now - p.at > PENDING_MAX_MS) continue;
      const key = `${p.session.id}|${p.type}`;
      if (now - (this.lastSent.get(key) || 0) < MIN_INTERVAL_MS) continue;
      this.lastSent.set(key, now);
      const ev = EVENTS[p.type];
      const detail = this.detail(p.type, current);
      const text = `${ev.emoji} <b>${esc(ev.title(current.projectName))}</b>` + (detail ? `\n${esc(detail)}` : '');
      try {
        // Les commandes depuis Telegram ajoutent leurs boutons et retiennent à quelle session
        // appartient le message (pour y répondre).
        const extra = this.decorate ? this.decorate(p.type, current) : {};
        const message = await this.send(text, extra);
        this.onSent?.(message, current, p.type);
      } catch (e) {
        this.log('Telegram :', e.message);
      }
    }
  }

  hasToken() {
    return fs.existsSync(TOKEN_FILE);
  }

  readToken() {
    try {
      const data = fs.readFileSync(TOKEN_FILE);
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : null;
    } catch {
      return null;
    }
  }

  async call(method, params = {}, token = this.readToken(), timeoutMs = 10_000) {
    if (!token) throw new Error('Pas de token Telegram.');
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw new Error(json.description || `Erreur ${res.status}`);
    return json.result;
  }

  send(text, extra = {}) {
    const chatId = this.getSettings().telegram?.chatId;
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  }

  /** Vérifie le token avec getMe puis le range chiffré (DPAPI de Windows, via safeStorage). */
  async connect(token) {
    token = String(token || '').trim();
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Ce token ne ressemble pas à celui donné par @BotFather.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Le chiffrement de Windows n\'est pas disponible.');
    const me = await this.call('getMe', {}, token);
    fs.mkdirSync(paths.baseDir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, safeStorage.encryptString(token));
    this.botName = me.username;
    return me.username;
  }

  disconnect() {
    this.stopDetect();
    try { fs.unlinkSync(TOKEN_FILE); } catch {}
    this.botName = null;
  }

  async status() {
    if (!this.hasToken()) return { connected: false };
    if (!this.botName) {
      try { this.botName = (await this.call('getMe')).username; } catch (e) { return { connected: true, error: e.message }; }
    }
    return { connected: true, botName: this.botName, detecting: !!this.detecting };
  }

  /** Attend ton premier message au bot pour connaître ta conversation (2 minutes au plus). */
  detectChat(onFound) {
    this.stopDetect();
    const end = Date.now() + 120_000;
    let offset = 0;
    const tick = async () => {
      if (!this.detecting) return;
      if (Date.now() > end) { this.stopDetect(); onFound(null); return; }
      try {
        const updates = await this.call('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          const chat = u.message?.chat;
          if (chat && chat.type === 'private') {
            this.stopDetect();
            this.updateOffset = offset;
            await this.call('getUpdates', { offset }); // marque le message comme lu
            onFound({ id: chat.id, name: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '' });
            return;
          }
        }
      } catch (e) {
        this.log('Telegram :', e.message);
      }
      this.detecting = setTimeout(tick, 3000);
    };
    this.detecting = setTimeout(tick, 0);
  }

  stopDetect() {
    clearTimeout(this.detecting);
    this.detecting = null;
  }
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

module.exports = { Notifier };
