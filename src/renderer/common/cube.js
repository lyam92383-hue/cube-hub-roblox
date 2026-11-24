// Le cube animé. Port de Sources/CubeWidget/Mascot (CubeAnimator, CubeRecolor, FrameLibrary).
// Les images sont celles du projet original ; les versions orange et verte sont calculées ici.

export const C = {
  workingFrameMs: 90,
  workingLongFramesMs: { 1: 1000, 11: 1000, 21: 1000, 4: 500, 14: 500 },
  workingBlinkFrames: new Set([7, 8, 9, 10, 17, 18, 19, 20]),
  blinkFrameMs: 60,
  fallAsleepFrameMs: 180,
  fallAsleepLongFramesMs: { 3: 250, 6: 250, 8: 250, 9: 250, 10: 400 },
  wakeUpSleepFrames: [9, 8, 7, 6, 5, 4, 1],
  wakeUpFrameMs: 100,
  wakeUpBlinkFrames: [7, 9, 7, 1],
  jumpDuration: 400,
  jumpHeight: 8,
  smallJumpHeight: 5,
  initialJumpCount: 2,
  reminderJumpInterval: 4000,
  landingSquash: 0.12,
  celebrationJumpHeight: 14,
  doneEyeFollowDuration: 60000,
  eyeFollowDistance: 300,
  eyeFollowSmoothing: 0.08,
  gradients: {
    orange: [0x2a1a10, 0xe5671a, 0xffe2c8],
    green: [0x0e2416, 0x3fbf6e, 0xddf7e6],
  },
  // Positions des yeux dans les images "card" (186 × 180), calculées depuis Constants.swift
  // (coordonnées des images d'origine, recadrées à 236,160 900×870 puis réduites).
  img: { w: 186, h: 180 },
  leftEye: { x: (467 - 236) * (186 / 900), y: (490 - 160) * (186 / 900) },
  rightEye: { x: (801 - 236) * (186 / 900), y: (489 - 160) * (186 / 900) },
  eye: { w: 100 * (186 / 900), h: 258 * (186 / 900) },
  eyeMaxOffset: 60 * (186 / 900),
};

export const COLORS = { working: '#6EB4F5', waiting: '#E5671A', done: '#3FBF6E', celebrating: '#3FBF6E', sleeping: '#8E8E93' };

// ------------------------------------------------------------ Images

let index = null;
const loaded = new Map(); // "card/Travail/3" → HTMLImageElement
const tinted = new Map(); // "card/Travail/3/orange" → URL

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Charge toutes les images (à appeler une fois avant de créer des cubes). */
export async function loadFrames() {
  if (index) return;
  index = await (await fetch('app://local/assets/frames/index.json')).json();
  const jobs = [];
  for (const size of ['card', 'menubar']) {
    for (const folder of ['Travail', 'Sommeil', 'Regard']) {
      index[size][folder].forEach((file, i) => {
        const key = folder === 'Regard' ? `${size}/Regard/${file.replace('.png', '')}` : `${size}/${folder}/${i + 1}`;
        jobs.push(loadImage(`app://local/assets/frames/${size}/${folder}/${file}`).then((img) => loaded.set(key, img)));
      });
    }
  }
  await Promise.all(jobs);
}

function gradientTable(stops) {
  const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const [d, m, l] = stops.map(rgb);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const table = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    table.push(t < 0.5 ? mix(d, m, t * 2) : mix(m, l, (t - 0.5) * 2));
  }
  return table;
}
const tables = { orange: gradientTable(C.gradients.orange), green: gradientTable(C.gradients.green) };

/** URL de l'image `key` dans la teinte voulue (blue = image d'origine). */
export function frameURL(key, tint = 'blue') {
  const img = loaded.get(key);
  if (!img) return '';
  if (tint === 'blue') return img.src;
  const k = `${key}/${tint}`;
  if (tinted.has(k)) return tinted.get(k);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const table = tables[tint];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const gray = Math.min(1, Math.max(0, (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255));
    const c = table[Math.round(gray * 255)];
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
  }
  ctx.putImageData(data, 0, 0);
  const url = canvas.toDataURL('image/png');
  tinted.set(k, url);
  return url;
}

/** Image de la zone de notification pour une humeur (32 × 32, en data URL). */
export function trayImage(mood) {
  const tint = mood === 'waiting' ? 'orange' : mood === 'done' || mood === 'celebrating' ? 'green' : 'blue';
  const key = mood === 'sleeping' ? 'menubar/Sommeil/10' : 'menubar/Travail/1';
  const src = loaded.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  if (!src) return canvas.toDataURL();
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.src = frameURL(key, tint);
  const scale = 32 / Math.max(src.naturalWidth, src.naturalHeight);
  const w = src.naturalWidth * scale;
  const h = src.naturalHeight * scale;
  return new Promise((resolve) => {
    img.onload = () => {
      if (mood === 'sleeping') ctx.globalAlpha = 0.75;
      ctx.drawImage(img, (32 - w) / 2, (32 - h) / 2, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
  });
}

// ------------------------------------------------------------ Cube animé

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cube {
  /**
   * @param {HTMLElement} host élément qui reçoit le cube
   * @param {{height:number, followMouse?:boolean}} opts
   */
  constructor(host, opts) {
    this.opts = opts;
    this.mood = null;
    this.token = 0;
    this.eyeTarget = { x: 0, y: 0 };
    this.eyeNow = { x: 0, y: 0 };
    this.followUntil = 0;
    this.el = document.createElement('div');
    this.el.className = 'cube';
    const h = opts.height;
    const w = (h * C.img.w) / C.img.h;
    this.size = { w, h };
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    this.el.innerHTML = `
      <div class="cube-mover"><div class="cube-breath">
        <img class="cube-frame" draggable="false" alt="">
        <img class="cube-frame cube-frame-b" draggable="false" alt="">
        <div class="cube-eyes">
          <img class="cube-eyeless" draggable="false" alt="">
          <img class="cube-eye cube-eye-l" draggable="false" alt="">
          <img class="cube-eye cube-eye-r" draggable="false" alt="">
        </div>
      </div></div>`;
    host.appendChild(this.el);
    this.mover = this.el.querySelector('.cube-mover');
    this.breath = this.el.querySelector('.cube-breath');
    this.frameA = this.el.querySelector('.cube-frame');
    this.frameB = this.el.querySelector('.cube-frame-b');
    this.eyes = this.el.querySelector('.cube-eyes');
    this.eyeless = this.el.querySelector('.cube-eyeless');
    this.eyeL = this.el.querySelector('.cube-eye-l');
    this.eyeR = this.el.querySelector('.cube-eye-r');
    const pct = (v, total) => `${(v / total) * 100}%`;
    for (const [img, pos] of [[this.eyeL, C.leftEye], [this.eyeR, C.rightEye]]) {
      img.style.left = pct(pos.x, C.img.w);
      img.style.top = pct(pos.y, C.img.h);
      img.style.width = pct(C.eye.w, C.img.w);
      img.style.height = pct(C.eye.h, C.img.h);
    }
    this.tint = 'blue';
    this.current = { key: 'card/Travail/1' };
    this.show('card/Travail/1', 'blue');
  }

  destroy() {
    this.token++;
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }

  /** Affiche une image, avec un fondu quand la couleur change. */
  show(key, tint) {
    const url = frameURL(key, tint);
    this.eyes.style.display = 'none';
    if (tint !== this.tint) {
      // Fondu bleu ↔ orange / vert.
      this.frameB.src = this.frameA.src;
      this.frameB.style.transition = 'none';
      this.frameB.style.opacity = '1';
      this.frameA.src = url;
      requestAnimationFrame(() => {
        this.frameB.style.transition = 'opacity 0.3s ease';
        this.frameB.style.opacity = '0';
      });
    } else {
      this.frameA.src = url;
    }
    this.frameA.style.display = '';
    this.tint = tint;
  }

  showEyes(tint) {
    this.eyeless.src = frameURL('card/Regard/cube_sans_yeux', tint);
    this.eyeL.src = this.eyeR.src = frameURL('card/Regard/oeil', tint);
    if (this.tint !== tint) {
      this.frameB.src = this.frameA.src;
      this.frameB.style.transition = 'none';
      this.frameB.style.opacity = '1';
      requestAnimationFrame(() => {
        this.frameB.style.transition = 'opacity 0.3s ease';
        this.frameB.style.opacity = '0';
      });
    }
    this.frameA.style.display = 'none';
    this.eyes.style.display = 'block';
    this.tint = tint;
  }

  /** working | waiting | celebrating | done | sleeping */
  setMood(mood) {
    if (mood === this.mood) return;
    const previous = this.mood;
    this.mood = mood;
    const token = ++this.token;
    this.breath.classList.remove('breathing');
    this.run(previous, mood, token);
  }

  alive(token) {
    return token === this.token;
  }

  async run(previous, mood, token) {
    if (previous === 'sleeping' && mood !== 'sleeping') {
      await this.wakeUp(token);
      if (!this.alive(token)) return;
    }
    switch (mood) {
      case 'working':
        this.workLoop(token);
        break;
      case 'waiting':
        this.waitLoop(token);
        break;
      case 'celebrating':
        this.showEyes('green');
        this.startFollow(C.doneEyeFollowDuration);
        this.jump(C.celebrationJumpHeight);
        break;
      case 'done':
        this.showEyes('green');
        if (previous !== 'celebrating') this.startFollow(C.doneEyeFollowDuration);
        break;
      case 'sleeping':
        await this.fallAsleep(token, previous == null);
        break;
    }
  }

  async workLoop(token) {
    let i = 1;
    while (this.alive(token)) {
      this.show(`card/Travail/${i}`, 'blue');
      const ms = C.workingLongFramesMs[i] ?? (C.workingBlinkFrames.has(i) ? C.blinkFrameMs : C.workingFrameMs);
      await sleep(ms);
      i = i >= 21 ? 1 : i + 1;
    }
  }

  async waitLoop(token) {
    this.show('card/Travail/1', 'orange');
    for (let n = 0; n < C.initialJumpCount && this.alive(token); n++) {
      await this.jump(C.jumpHeight);
    }
    let last = Date.now();
    while (this.alive(token)) {
      await sleep(250);
      if (!this.alive(token)) return;
      if (Date.now() - last >= C.reminderJumpInterval) {
        last = Date.now();
        await this.jump(C.smallJumpHeight);
        // Un clignement entre deux sauts.
        for (const f of [7, 9, 7, 1]) {
          if (!this.alive(token)) return;
          this.show(`card/Travail/${f}`, 'orange');
          await sleep(C.blinkFrameMs);
        }
      }
    }
  }

  async fallAsleep(token, immediately) {
    if (immediately) {
      this.show('card/Sommeil/10', 'blue');
      this.breath.classList.add('breathing');
      return;
    }
    this.opts.onCue?.('dodo');
    for (let i = 1; i <= 10; i++) {
      if (!this.alive(token)) return;
      this.show(`card/Sommeil/${i}`, 'blue');
      await sleep(C.fallAsleepLongFramesMs[i] ?? C.fallAsleepFrameMs);
    }
    if (this.alive(token)) this.breath.classList.add('breathing');
  }

  async wakeUp(token) {
    for (const f of C.wakeUpSleepFrames) {
      if (!this.alive(token)) return;
      this.show(`card/Sommeil/${f}`, 'blue');
      await sleep(C.wakeUpFrameMs);
    }
    for (const f of C.wakeUpBlinkFrames) {
      if (!this.alive(token)) return;
      this.show(`card/Travail/${f}`, 'blue');
      await sleep(C.blinkFrameMs);
    }
  }

  /** Saut : décollage, atterrissage, écrasement, retour. Hauteur en px pour un cube de 64 px. */
  jump(height) {
    const h = height * (this.size.h / 64);
    const s = C.landingSquash;
    const anim = this.mover.animate([
      { transform: 'translateY(0) scale(1,1)', easing: 'cubic-bezier(.2,.7,.4,1)' },
      { transform: `translateY(${-h}px) scale(0.97,1.03)`, offset: 0.4, easing: 'cubic-bezier(.6,0,.8,.3)' },
      { transform: 'translateY(0) scale(1,1)', offset: 0.72 },
      { transform: `translateY(0) scale(${1 + s / 2},${1 - s})`, offset: 0.84 },
      { transform: 'translateY(0) scale(1,1)' },
    ], { duration: C.jumpDuration });
    return anim.finished.catch(() => {});
  }

  /** Petit "pop" (entrée du halo bleu). */
  pop() {
    this.mover.animate([
      { transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.35 }, { transform: 'scale(1)' },
    ], { duration: 350, easing: 'ease-out' });
  }

  // ---------------- Yeux qui suivent la souris

  startFollow(ms) {
    this.followUntil = Date.now() + ms;
    this.opts.onFollow?.(!!this.opts.followMouse);
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const step = (t) => {
      const dt = (t - last) / 1000;
      last = t;
      const following = this.opts.followMouse && Date.now() < this.followUntil && (this.mood === 'done' || this.mood === 'celebrating');
      const target = following ? this.eyeTarget : { x: 0, y: 0 };
      const k = 1 - Math.exp(-dt / C.eyeFollowSmoothing);
      this.eyeNow.x += (target.x - this.eyeNow.x) * k;
      this.eyeNow.y += (target.y - this.eyeNow.y) * k;
      const tx = `translate(${(this.eyeNow.x / C.eye.w) * 100}%, ${(this.eyeNow.y / C.eye.h) * 100}%)`;
      this.eyeL.style.transform = tx;
      this.eyeR.style.transform = tx;
      const settled = Math.abs(this.eyeNow.x) < 0.05 && Math.abs(this.eyeNow.y) < 0.05;
      if (following || !settled) this.raf = requestAnimationFrame(step);
      else this.opts.onFollow?.(false);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Position de la souris dans la page (px CSS). */
  lookAt(x, y) {
    const r = this.el.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      this.eyeTarget = { x: 0, y: 0 };
      return;
    }
    // À eyeFollowDistance, les yeux ont fait 3/4 du chemin vers le maximum.
    const f = dist / (dist + C.eyeFollowDistance / 3);
    this.eyeTarget = { x: (dx / dist) * f * C.eyeMaxOffset, y: (dy / dist) * f * C.eyeMaxOffset };
  }
}

export const CUBE_CSS = `
.cube { position: relative; flex: none; }
.cube-mover, .cube-breath { position: absolute; inset: 0; transform-origin: 50% 100%; }
.cube-breath.breathing { animation: cube-breathe 3s ease-in-out infinite; transform-origin: 50% 85%; }
@keyframes cube-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
.cube-frame { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.cube-frame-b { opacity: 0; }
.cube-eyes { position: absolute; inset: 0; display: none; }
.cube-eyeless { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.cube-eye { position: absolute; pointer-events: none; }
`;
