import { Cube, CUBE_CSS, COLORS, loadFrames, trayImage } from './common/cube.js';
import { Board } from './common/board.js';
import { play, configureSounds } from './common/sounds.js';
import { LONG, SHORT, duration, tokens, escapeHTML } from './common/format.js';

const $ = (id) => document.getElementById(id);
const style = document.createElement('style');
style.textContent = CUBE_CSS;
document.head.appendChild(style);

let scale = 1;
let collapsed = false;
let cube = null;
let lastMood = null;
const jumpsPending = new Set();

const board = new Board({
  onChange: render,
  onWaiting(session, isActive) {
    play('attente');
    if (!isActive) jumpsPending.add(session.id);
  },
  onWorking() {
    play('bosse');
    entrance();
  },
  onCelebrate() {
    play('fini');
  },
});

// ------------------------------------------------------------ Démarrage

window.cube.on('init', async (data) => {
  await loadFrames();
  applySettings(data.settings);
  configureSounds(data.settings.sounds, data.customSounds);
  collapsed = !!data.settings.widget.collapsed;
  cube = new Cube($('cubeSlot'), {
    height: 64,
    followMouse: true,
    onFollow: (on) => window.cube.send('widget:follow-mouse', on),
    onCue: (name) => play(name),
  });
  board.apply(data.sessions);
  render();
  setInterval(render, 30_000);
});

window.cube.on('sessions', (list) => board.apply(list));
window.cube.on('settings', (s) => {
  applySettings(s);
  configureSounds(s.sounds);
});
window.cube.on('mouse', ({ x, y }) => cube?.lookAt(x / scale, y / scale));

function applySettings(s) {
  scale = s.widget.scale || 1;
  reportSize();
}

// ------------------------------------------------------------ Affichage

function render() {
  if (!cube) return;
  const a = board.active;
  const mood = board.mood;
  const stack = $('stack');
  stack.classList.toggle('collapsed', collapsed);
  $('front').className = `front mood-${mood}`;

  if (!a) {
    $('name').textContent = 'Cube Hub';
    $('task').textContent = 'Aucune session Claude Code';
    $('task').className = 'task';
    $('status').innerHTML = '<span>en veille</span>';
  } else {
    $('name').textContent = a.projectName;
    const c = board.activeCelebration;
    if (c) {
      $('task').textContent = `✓ ${c.title || 'Terminé'}`;
      $('task').className = 'task completed';
    } else {
      $('task').textContent = a.currentTask || '';
      $('task').className = 'task';
    }
    const parts = [`<span class="st-${a.status}">${LONG[a.status]}</span>`, escapeHTML(duration(a.startedAt))];
    if (a.contextTokens) parts.push(escapeHTML(tokens(a.contextTokens)));
    $('status').innerHTML = parts.join('<span class="sep">·</span>');
  }

  if (mood !== lastMood) {
    cube.setMood(mood);
    lastMood = mood;
    Promise.resolve(trayImage(mood)).then((dataURL) => window.cube.send('tray:image', { dataURL, mood }));
  }

  const backs = $('backs');
  backs.innerHTML = '';
  board.others.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'back';
    el.style.zIndex = String(9 - i);
    el.dataset.id = s.id;
    el.innerHTML = `<span class="dot" style="background:${COLORS[s.status]}"></span>
      <span class="bname">${escapeHTML(s.projectName)}</span>
      <span class="bstatus st-${s.status}">${SHORT[s.status]}</span>`;
    if (jumpsPending.has(s.id)) {
      jumpsPending.delete(s.id);
      requestAnimationFrame(() => el.classList.add('jump'));
    }
    backs.appendChild(el);
  });
  jumpsPending.clear();
  reportSize();
}

// Le halo bleu entre : un anneau se resserre sur la carte, puis la lumière se met à tourner.
function entrance() {
  const el = $('entrance');
  const w = 360;
  const h = 84;
  const inflate = 16;
  el.animate([
    { opacity: 0, transform: `scale(${(w + 2 * inflate) / w}, ${(h + 2 * inflate) / h})`, easing: 'cubic-bezier(.5,0,1,.6)' },
    { opacity: 0.95, transform: 'scale(1,1)', offset: 0.36 },
    { opacity: 0.95, transform: 'scale(1,1)', offset: 0.45 },
    { opacity: 0, transform: 'scale(1,1)' },
  ], { duration: 1250 });
  setTimeout(() => cube?.pop(), 450);
}

let lastSize = '';
function reportSize() {
  requestAnimationFrame(() => {
    const r = $('root').getBoundingClientRect();
    // La carte repliée garde la largeur dépliée pendant l'animation : on mesure la cible.
    const width = (collapsed ? 84 : 360) + 40;
    const height = Math.max(r.height, 124);
    const key = `${width}x${height}x${scale}`;
    if (key === lastSize) return;
    lastSize = key;
    window.cube.send('widget:size', { width: width * scale, height: height * scale });
  });
}

// ------------------------------------------------------------ Souris

// Les zones transparentes autour des cartes laissent passer les clics.
let ignoring = null;
function setIgnore(v) {
  if (v === ignoring) return;
  ignoring = v;
  window.cube.send('widget:ignore-mouse', v);
}
document.addEventListener('mousemove', (e) => {
  if (dragging) return;
  setIgnore(!e.target.closest('.front, .back'));
});
document.addEventListener('mouseleave', () => { if (!dragging) setIgnore(true); });

let down = null;
let dragging = false;
let clickTimer = null;

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const target = e.target.closest('.front, .back');
  if (!target) return;
  down = { x: e.screenX, y: e.screenY, target };
});
document.addEventListener('mousemove', (e) => {
  if (!down) return;
  if (!dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 3) {
    dragging = true;
    window.cube.send('widget:drag', { phase: 'start' });
  }
  if (dragging) window.cube.send('widget:drag', { phase: 'move' });
});
document.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  const d = down;
  down = null;
  if (dragging) {
    dragging = false;
    window.cube.send('widget:drag', { phase: 'end' });
    return;
  }
  if (!d) return;
  if (d.target.classList.contains('back')) {
    board.activate(d.target.dataset.id);
    return;
  }
  // Un clic replie / déplie (après le délai du double-clic), un double-clic ouvre le Hub.
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    const a = board.active;
    window.cube.send('open-hub', a ? { selectSession: a.id } : {});
    return;
  }
  clickTimer = setTimeout(() => {
    clickTimer = null;
    collapsed = !collapsed;
    window.cube.send('widget:collapsed', collapsed);
    render();
  }, 250);
});
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.cube.send('widget:menu');
});
