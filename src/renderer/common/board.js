// Ordre des sessions du widget et événements (sons, sauts, état vert).
// Port de Sources/CubeWidget/Sessions/SessionBoard.swift.

const CELEBRATION_MS = 3000;

export class Board {
  constructor(events) {
    this.events = events; // { onWaiting(session, isActive), onWorking(session), onCelebrate(), onChange() }
    this.sessions = [];
    this.seenPrompts = new Map();
    this.seenCompletions = new Map();
    this.loaded = false;
    this.celebration = null; // { sessionId, title, until }
    this.celebrationTimer = null;
  }

  get active() {
    return this.sessions[0] || null;
  }

  get others() {
    return this.sessions.slice(1, 3);
  }

  get activeCelebration() {
    const a = this.active;
    const c = this.celebration;
    if (!a || a.status === 'waiting' || !c || c.sessionId !== a.id || Date.now() > c.until) return null;
    return c;
  }

  get mood() {
    const a = this.active;
    if (!a) return 'sleeping';
    if (a.status === 'waiting') return 'waiting';
    if (this.activeCelebration) return 'celebrating';
    return a.status === 'done' ? 'done' : 'working';
  }

  static isBefore(a, b) {
    if ((a.status === 'waiting') !== (b.status === 'waiting')) return a.status === 'waiting' ? -1 : 1;
    return Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt);
  }

  apply(list) {
    const first = !this.loaded;
    this.loaded = true;
    const ids = new Set(list.map((s) => s.id));
    let activeId = this.sessions[0]?.id;
    if (activeId && !ids.has(activeId)) {
      activeId = this.sessions.slice(1).find((s) => ids.has(s.id))?.id;
    }
    // Tu viens d'écrire à une session : elle passe devant.
    let prompted = null;
    for (const s of list) {
      if (!s.lastPromptAt) continue;
      const isNew = this.seenPrompts.get(s.id) !== s.lastPromptAt;
      this.seenPrompts.set(s.id, s.lastPromptAt);
      if (isNew && !first && (!prompted || s.lastPromptAt > prompted.at)) prompted = { id: s.id, at: s.lastPromptAt };
    }
    if (prompted) activeId = prompted.id;
    if (!activeId && list.length) {
      activeId = [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0].id;
    }
    const others = list.filter((s) => s.id !== activeId).sort(Board.isBefore);
    const ordered = [...list.filter((s) => s.id === activeId), ...others];
    const previous = this.sessions;
    this.sessions = ordered;

    if (!first) {
      this.playWaiting(previous);
      this.celebrateFinishedAnswer(previous);
      this.playWorking(previous, prompted?.id);
    }

    // Une tâche vient d'être terminée dans la session active : état vert.
    for (const s of list) {
      const done = s.lastCompletedTask;
      if (!done) continue;
      const isNew = this.seenCompletions.get(s.id) !== done.at;
      this.seenCompletions.set(s.id, done.at);
      if (isNew && !first && s.id === this.active?.id && Date.now() - Date.parse(done.at) < CELEBRATION_MS) {
        this.taskCompleted(s.id, done.subject || '');
      }
    }
    this.events.onChange();
  }

  activate(id) {
    const i = this.sessions.findIndex((s) => s.id === id);
    if (i <= 0) return;
    const chosen = this.sessions[i];
    this.sessions = [chosen, ...this.sessions.filter((s) => s.id !== id).sort(Board.isBefore)];
    this.events.onChange();
  }

  taskCompleted(sessionId, title) {
    this.celebration = { sessionId, title, until: Date.now() + CELEBRATION_MS };
    if (this.activeCelebration) this.events.onCelebrate();
    clearTimeout(this.celebrationTimer);
    this.celebrationTimer = setTimeout(() => {
      this.celebration = null;
      this.events.onChange();
    }, CELEBRATION_MS);
    this.events.onChange();
  }

  playWaiting(previous) {
    const was = new Map(previous.map((s) => [s.id, s.status === 'waiting']));
    const started = this.sessions.filter((s) => s.status === 'waiting' && was.get(s.id) === false);
    if (!started.length) return;
    for (const s of started) this.events.onWaiting(s, s.id === this.active?.id);
  }

  celebrateFinishedAnswer(previous) {
    const a = this.active;
    const before = previous[0];
    if (!a || a.status !== 'done' || !before || before.id !== a.id || before.status !== 'working' || this.activeCelebration) return;
    this.taskCompleted(a.id, '');
  }

  playWorking(previous, promptedId) {
    const a = this.active;
    if (!a || a.status !== 'working') return;
    const before = previous[0];
    if (!before || (before.id === a.id && before.status !== 'working') || (before.id !== a.id && a.id === promptedId)) {
      this.events.onWorking(a);
    }
  }
}
