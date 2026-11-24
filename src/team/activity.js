// Cube Hub V2 : lit le journal de l'équipe (~/.cube-widget/equipe/<projet>.jsonl), écrit par le
// serveur MCP cube-equipe et par le hook Blender/Studio, et prévient le Hub de chaque nouvelle ligne.
const fs = require('fs');
const path = require('path');

const MAX_EVENTS = 300;

class Activity {
  constructor(dir, onEvents) {
    this.dir = dir;
    this.onEvents = onEvents; // (projectId, events[]) => void
    this.offsets = new Map(); // fichier → octets déjà lus
    this.timer = null;
  }

  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    // On ne renvoie pas l'historique au démarrage : il est lu à la demande (history()).
    for (const f of this.files()) try { this.offsets.set(f, fs.statSync(f).size); } catch {}
    this.timer = setInterval(() => this.poll(), 700);
    try {
      this.watcher = fs.watch(this.dir, () => this.poll());
      this.watcher.on('error', () => {});
    } catch {}
  }

  files() {
    try { return fs.readdirSync(this.dir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(this.dir, n)); } catch { return []; }
  }

  poll() {
    for (const f of this.files()) {
      let size;
      try { size = fs.statSync(f).size; } catch { continue; }
      const from = this.offsets.get(f) ?? 0;
      if (size <= from) { if (size < from) this.offsets.set(f, size); continue; }
      let text = '';
      try {
        const fd = fs.openSync(f, 'r');
        const buf = Buffer.alloc(size - from);
        fs.readSync(fd, buf, 0, buf.length, from);
        fs.closeSync(fd);
        text = buf.toString('utf8');
      } catch { continue; }
      const end = text.lastIndexOf('\n');
      if (end < 0) continue;
      this.offsets.set(f, from + Buffer.byteLength(text.slice(0, end + 1)));
      const events = parse(text.slice(0, end));
      if (events.length) this.onEvents(path.basename(f, '.jsonl'), events);
    }
  }

  history(projectId) {
    const f = path.join(this.dir, `${projectId}.jsonl`);
    let text = '';
    try {
      const size = fs.statSync(f).size;
      const start = Math.max(0, size - 400_000);
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } catch { return { events: [], stats: emptyStats() }; }
    const all = parse(text);
    return { events: all.slice(-MAX_EVENTS), stats: stats(all) };
  }

  clear(projectId) {
    const f = path.join(this.dir, `${projectId}.jsonl`);
    try { fs.unlinkSync(f); } catch {}
    this.offsets.delete(f);
  }
}

function parse(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

const emptyStats = () => ({ codex: 0, llm: 0, brain: 0, blender: 0, studio: 0, savedTokens: 0, codexFiles: 0, errors: 0 });

function stats(events) {
  const s = emptyStats();
  for (const e of events) {
    if (e.status === 'error') s.errors++;
    if (e.status !== 'ok') continue;
    if (e.agent in s) s[e.agent]++;
    if (e.agent === 'llm' || e.agent === 'codex') s.savedTokens += Number(e.tokens) || 0;
    if (e.agent === 'codex') s.codexFiles += Number(e.files) || 0;
  }
  return s;
}

module.exports = { Activity, stats };
