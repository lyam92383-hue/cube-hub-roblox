// Lit les fichiers de session écrits par cube-hook dans ~/.cube-widget/sessions et
// signale chaque changement. Port de Sources/CubeWidget/Sessions/SessionStore.swift.
const fs = require('fs');
const path = require('path');
const { sessionsDir } = require('./paths');

const REFRESH_MS = 2000;
const FORGET_SILENT_MS = 6 * 3600 * 1000;
const TAIL_BYTES = 2_000_000;

class SessionStore {
  constructor(onChange) {
    this.onChange = onChange;
    this.last = '';
    this.sessions = [];
    this.tokenCache = new Map();
    this.watcher = null;
    this.pending = null;
  }

  start() {
    fs.mkdirSync(sessionsDir, { recursive: true });
    this.reload();
    this.timer = setInterval(() => {
      if (!this.watcher) this.watch();
      this.reload();
    }, REFRESH_MS);
    this.watch();
  }

  watch() {
    try {
      this.watcher = fs.watch(sessionsDir, () => this.reloadSoon());
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      this.watcher = null;
    }
  }

  reloadSoon() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.reload();
    }, 40);
  }

  reload() {
    let names = [];
    try {
      names = fs.readdirSync(sessionsDir).filter((n) => n.endsWith('.json'));
    } catch {
      return;
    }
    const list = [];
    for (const name of names) {
      const file = path.join(sessionsDir, name);
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      } catch {
        continue;
      }
      if (!data || !data.sessionID) continue;
      if (!this.isAlive(data)) {
        // Claude Code est parti sans prévenir : on oublie cette session.
        try { fs.unlinkSync(file); } catch {}
        continue;
      }
      list.push(this.toSession(data));
    }
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const key = JSON.stringify(list);
    if (key !== this.last) {
      this.last = key;
      this.sessions = list;
      this.onChange(list);
    }
  }

  isAlive(data) {
    if (!data.pid) return Date.now() - Date.parse(data.updatedAt) < FORGET_SILENT_MS;
    try {
      process.kill(data.pid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM';
    }
  }

  toSession(file) {
    const tasks = Array.isArray(file.tasks) ? file.tasks : [];
    const task = [...tasks].reverse().find((t) => t.status === 'in_progress') || tasks[tasks.length - 1];
    const cwd = file.cwd || '';
    return {
      id: file.sessionID,
      projectName: path.win32.basename(cwd.replace(/[\\/]+$/, '')) || cwd || 'session',
      cwd,
      status: ['working', 'waiting', 'done'].includes(file.status) ? file.status : 'done',
      startedAt: file.startedAt,
      updatedAt: file.updatedAt,
      statusChangedAt: file.statusChangedAt,
      lastPromptAt: file.lastPromptAt || null,
      lastCompletedTask: file.lastCompletedTask || null,
      currentTask: task && task.subject ? task.subject : null,
      contextTokens: this.contextTokens(file.transcriptPath) || 0,
      pid: file.pid || null,
      hubProject: file.hubProject || null,
      transcriptPath: file.transcriptPath || null,
      lastAnswer: file.lastAnswer ? { excerpt: String(file.lastAnswer.excerpt || '').slice(0, 600), at: file.lastAnswer.at } : null,
      pendingPermission: file.pendingPermission || null,
      pendingQuestion: file.pendingQuestion || null,
    };
  }

  // Taille du contexte, relue seulement quand le fichier de conversation change.
  contextTokens(transcript) {
    if (!transcript) return null;
    let stat;
    try {
      stat = fs.statSync(transcript);
    } catch {
      return null;
    }
    const cached = this.tokenCache.get(transcript);
    if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) return cached.tokens;
    const tokens = readContextTokens(transcript, stat.size) ?? cached?.tokens ?? null;
    this.tokenCache.set(transcript, { size: stat.size, mtime: stat.mtimeMs, tokens });
    return tokens;
  }
}

// Lit la fin du fichier de conversation et trouve la dernière réponse de Claude (pas d'un
// sous-agent). Son `usage` donne la taille du contexte envoyé à Claude.
function readContextTokens(file, size) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.length < 20 || !line.includes('"assistant"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== 'assistant' || entry.isSidechain === true) continue;
      const usage = entry.message && entry.message.usage;
      if (!usage) continue;
      return (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
  return null;
}

module.exports = { SessionStore };
