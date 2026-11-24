// Les petits sons du cube. Sur Mac, l'original joue des sons de macOS (Pop, Glass, Purr,
// Bottle) ; ici ils sont synthétisés. Des fichiers bosse / fini / attente / dodo dans
// %USERPROFILE%\.cube-widget\Sons les remplacent.

let ctx = null;
let settings = { master: 1, bosse: 0.4, fini: 1, attente: 1, dodo: 0.4 };
let custom = {};

export function configureSounds(s, customFiles) {
  if (s) settings = { ...settings, ...s };
  if (customFiles) custom = customFiles;
}

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(a, { type = 'sine', from, to = from, start = 0, attack = 0.005, decay = 0.3, gain = 0.5, out }) {
  const o = a.createOscillator();
  const g = a.createGain();
  const t = a.currentTime + start;
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + Math.max(0.02, decay * 0.6));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

const synth = {
  // "Pop" : Claude se met au travail.
  bosse(a, out) {
    tone(a, { from: 880, to: 330, decay: 0.09, gain: 0.7, out });
  },
  // "Glass" : tâche terminée.
  fini(a, out) {
    tone(a, { from: 1568, decay: 1.1, gain: 0.35, out });
    tone(a, { from: 3136, decay: 0.6, gain: 0.12, out });
    tone(a, { from: 2093, start: 0.09, decay: 1.0, gain: 0.25, out });
  },
  // "Purr" : Claude attend ta réponse.
  attente(a, out) {
    const lfo = a.createOscillator();
    const lfoGain = a.createGain();
    const g = a.createGain();
    const o = a.createOscillator();
    const t = a.currentTime;
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.linearRampToValueAtTime(260, t + 0.35);
    lfo.frequency.value = 28;
    lfoGain.gain.value = 0.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    lfo.connect(lfoGain).connect(g.gain);
    o.connect(g).connect(out);
    o.start(t); lfo.start(t);
    o.stop(t + 0.5); lfo.stop(t + 0.5);
    tone(a, { from: 660, start: 0.18, decay: 0.25, gain: 0.25, out });
  },
  // "Bottle" : le cube s'endort.
  dodo(a, out) {
    tone(a, { from: 392, to: 370, attack: 0.04, decay: 0.5, gain: 0.45, out });
    tone(a, { from: 784, attack: 0.04, decay: 0.25, gain: 0.08, out });
  },
};

export function play(name, { force = false } = {}) {
  const volume = (settings[name] ?? 1) * (settings.master ?? 1);
  if (!force && volume <= 0) return;
  if (custom[name]) {
    const el = new Audio(custom[name]);
    el.volume = Math.min(1, volume);
    el.play().catch(() => {});
    return;
  }
  const a = audio();
  const out = a.createGain();
  out.gain.value = Math.max(0, volume);
  out.connect(a.destination);
  synth[name]?.(a, out);
}
