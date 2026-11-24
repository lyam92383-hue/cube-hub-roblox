// Cube Hub pour Windows : processus principal.
// Portage de github.com/Harlo9/cube-hub (macOS, licence MIT).
const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen,
  protocol, net, dialog, shell,
} = require('electron');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const paths = require('./paths');
const stateStore = require('./state');
const hooks = require('./hooks');
const { SessionStore } = require('./sessions');
const { Notifier } = require('./notify');
const { Remote, LOG_FILE } = require('./remote');
const scaffold = require('./team/scaffold');
const detect = require('./team/detect');
const { Activity } = require('./team/activity');
let notifier = null;
let remote = null;
let activity = null;
let nodePath = null; // Node.js du PC, pour le serveur MCP de l'équipe (sinon Electron en mode Node)

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', 'icon.ico');
const HOTKEY = 'Control+Alt+W';
const HOTKEY_LABEL = 'Ctrl+Alt+W';
const HALO_MARGIN = 20;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('com.cubehub.windows');

// Les pages sont servies par app://local/… (même origine : les images du cube peuvent être
// recolorées dans un canvas) ; app://sons/… sert les sons perso de ~/.cube-widget/Sons.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const state = () => stateStore.get();
let widget = null;
let hub = null;
let welcome = null;
let tray = null;
let sessions = [];
let quitting = false;
let trayMood = 'sleeping';

// ---------------------------------------------------------------- Démarrage

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const u = new URL(request.url);
    let file;
    if (u.host === 'sons') file = path.join(paths.soundsDir, decodeURIComponent(u.pathname));
    else file = path.join(ROOT, decodeURIComponent(u.pathname));
    const base = u.host === 'sons' ? paths.soundsDir : ROOT;
    if (!path.resolve(file).startsWith(path.resolve(base))) return new Response('interdit', { status: 403 });
    return net.fetch(url.pathToFileURL(file).toString());
  });

  if (process.env.CUBE_SNAPSHOT || process.env.CUBE_SCENARIO || process.env.CUBE_SCENARIO_REMOTE) {
    // Vérifications automatiques : pas de vraies notifications.
    state().notifications.windows = !!process.env.CUBE_TEST_TOASTS;
    state().telegram.enabled = !!process.env.CUBE_TELEGRAM_API;
  }
  installHookProgram();
  installTeamPrograms();
  writeTeamConfig();
  detect.where('node').then((p) => { nodePath = p; });
  activity = new Activity(paths.teamLogDir, (projectId, events) => {
    if (hub && !hub.isDestroyed()) hub.webContents.send('team:events', { projectId, events });
  });
  activity.start();
  ensureStartMenuShortcut();
  createTray();
  createWidget();

  notifier = new Notifier({
    getSettings: state,
    onClick: (s) => openHub({ selectSession: s.id }),
    log: console.error,
  });
  remote = new Remote({
    notifier,
    getSettings: state,
    save: () => stateStore.save(),
    sessions: () => sessions,
    terminal: (projectId) => {
      const t = terminals.get(projectId);
      if (!t || !t.running) return null;
      return { write: (s) => t.pty.write(s), tail: () => t.buffer.slice(-6000) };
    },
    changed: () => broadcast('remote:status', remote.status()),
  });
  remote.sync();
  const store = new SessionStore((list) => {
    sessions = list;
    broadcast('sessions', list);
    updateTrayMenu();
    notifier.update(list);
  });
  store.start();

  globalShortcut.register(HOTKEY, toggleWidget);
  screen.on('display-removed', keepWidgetOnScreen);
  screen.on('display-metrics-changed', keepWidgetOnScreen);

  if (process.env.CUBE_SNAPSHOT) {
    // Ne garde rien de la vérification : réglages en mémoire seulement.
    stateStore.save = () => {};
    stateStore.saveNow = () => {};
    return snapshots(process.env.CUBE_SNAPSHOT);
  }
  if (process.env.CUBE_SCENARIO_REMOTE) {
    stateStore.save = () => {};
    stateStore.saveNow = () => {};
    const captureTelegramPage = async (file) => {
      state().hub.projects.push({ id: 'P1', folder: 'C:\\dev\\alpha', name: 'alpha' });
      openHub({ settings: true, settingsPage: 'telegram' });
      await new Promise((r) => setTimeout(r, 3500));
      hub.webContents.executeJavaScript("document.querySelector('.modal-page').scrollTop = 9999");
      hub.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 1200));
      fs.writeFileSync(file, (await hub.webContents.capturePage()).toPNG());
    };
    require('./scenario-remote')({ notifier, remote, state: state(), captureTelegramPage }, console.log)
      .catch((e) => console.error(e))
      .finally(() => { quitting = true; app.exit(0); });
    return;
  }
  if (process.env.CUBE_SCENARIO) {
    stateStore.save = () => {};
    stateStore.saveNow = () => {};
    require('./scenario')(process.env.CUBE_SCENARIO, { widget, notifier, state: state() }, console.log)
      .catch((e) => console.error(e))
      .finally(() => { quitting = true; app.exit(0); });
    return;
  }
  if (!state().welcomeDone && hooks.status() !== 'installed') openWelcome();
});

// Pour vérifier l'affichage : CUBE_SNAPSHOT=<dossier> enregistre des captures puis quitte.
async function snapshots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name), img.toPNG());
  };
  await wait(2500);
  await shot(widget, 'widget.png');
  openHub();
  await wait(3500);
  await shot(hub, 'hub.png');
  hub.webContents.send('hub:command', { settings: true });
  await wait(800);
  await shot(hub, 'settings.png');
  for (const p of ['notifications', 'telegram']) {
    hub.webContents.send('hub:command', { settings: true, settingsPage: p });
    await wait(800);
    await shot(hub, `settings-${p}.png`);
  }
  hub.webContents.send('hub:command', { closeSettings: true, debugTheme: 'Freelance' });
  await wait(300);
  hub.webContents.send('hub:command', { debugProject: dir });
  await wait(4000);
  await shot(hub, 'terminal.png');
  // V2 : un jeu Roblox avec son équipe.
  fs.mkdirSync(paths.teamLogDir, { recursive: true });
  const t0 = Date.now();
  const ev = (s, id, agent, action, detail, status, extra = {}) => JSON.stringify({ t: new Date(t0 - s * 1000).toISOString(), project: 'demo-roblox', id, agent, action, detail, status, ...extra });
  fs.writeFileSync(path.join(paths.teamLogDir, 'demo-roblox.jsonl'), [
    ev(900, 'a', 'llm', 'resumer', 'Résume les modules existants', 'start'), ev(890, 'a', 'llm', 'resumer', 'Résume les modules existants', 'ok', { ms: 9000, tokens: 5200 }),
    ev(800, 'b', 'codex', 'code', 'Écrire MoneyService', 'start'), ev(700, 'b', 'codex', 'code', 'Écrire MoneyService', 'ok', { ms: 100000, files: 2 }),
    ev(600, 'c', 'brain', 'log', 'Argent géré par le serveur', 'start'), ev(600, 'c', 'brain', 'log', 'Argent géré par le serveur', 'ok', { ms: 8 }),
    ev(30, 'd', 'codex', 'code', 'Boutons d\'achat du tycoon', 'start'),
  ].join('\n') + '\n');
  hub.webContents.send('hub:command', { debugRoblox: { id: 'demo-roblox', folder: dir, name: 'Pizza Tycoon', tab: 'equipe' } });
  await wait(3000);
  await shot(hub, 'v2-equipe.png');
  hub.webContents.send('hub:command', { debugTab: { id: 'demo-roblox', tab: 'codex' } });
  await wait(800);
  await shot(hub, 'v2-codex.png');
  hub.webContents.send('hub:command', { debugWizard: true });
  await wait(2500);
  await shot(hub, 'v2-assistant.png');
  hub.webContents.send('hub:command', { debugSetup: true });
  await wait(800);
  await shot(hub, 'v2-connexion.png');
  hub.webContents.send('hub:command', { debugCloseWizard: true, settings: true, settingsPage: 'team' });
  await wait(3000);
  await shot(hub, 'v2-reglages-equipe.png');
  openWelcome();
  await wait(1500);
  await shot(welcome, 'welcome.png');
  quitting = true;
  app.exit(0);
}

app.on('second-instance', () => openHub());
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('before-quit', () => {
  quitting = true;
  stateStore.saveNow();
  for (const t of terminals.values()) try { t.pty.kill(); } catch {}
});
app.on('will-quit', () => globalShortcut.unregisterAll());

function broadcast(channel, data) {
  for (const w of [widget, hub, welcome]) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
}

// cube-hook.exe est livré avec l'app et copié dans ~/.cube-widget/bin au lancement.
function installHookProgram() {
  const src = app.isPackaged ? path.join(process.resourcesPath, 'cube-hook.exe') : path.join(ROOT, 'hook', 'cube-hook.exe');
  try {
    fs.mkdirSync(paths.binDir, { recursive: true });
    const a = fs.readFileSync(src);
    let same = false;
    try { same = Buffer.compare(a, fs.readFileSync(paths.hookExe)) === 0; } catch {}
    if (!same) fs.writeFileSync(paths.hookExe, a);
  } catch (e) {
    console.error('Copie de cube-hook impossible', e.message);
  }
}

// Windows n'affiche les bulles de notification que pour une app qui a un raccourci dans le
// menu Démarrer portant son identifiant (AppUserModelID).
function ensureStartMenuShortcut() {
  if (!app.isPackaged) return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Cube Hub.lnk');
    const wanted = {
      target: process.execPath, cwd: path.dirname(process.execPath), appUserModelId: 'com.cubehub.windows',
      icon: process.execPath, iconIndex: 0, description: 'Cube Hub',
    };
    let current = null;
    try { current = shell.readShortcutLink(lnk); } catch {}
    if (!current || current.target !== wanted.target || current.appUserModelId !== wanted.appUserModelId) {
      shell.writeShortcutLink(lnk, current ? 'replace' : 'create', wanted);
    }
  } catch (e) {
    console.error('Raccourci du menu Démarrer :', e.message);
  }
}

const pageURL = (name) => `app://local/src/renderer/${name}.html`;
const preload = path.join(__dirname, 'preload.js');

// ---------------------------------------------------------------- Widget

function createWidget() {
  const s = state().widget;
  widget = new BrowserWindow({
    width: 400, height: 140, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false, maximizable: false,
    minimizable: false, fullscreenable: false, backgroundColor: '#00000000', icon: ICON,
    webPreferences: { preload, backgroundThrottling: false },
  });
  widget.setAlwaysOnTop(true, 'screen-saver');
  widget.setVisibleOnAllWorkspaces(true);
  widget.loadURL(pageURL('widget'));
  widget.webContents.on('did-finish-load', () => {
    widget.webContents.setZoomFactor(s.scale || 1);
    widget.webContents.send('init', initData());
  });
  widget.on('close', (e) => {
    if (!quitting) { e.preventDefault(); setWidgetVisible(false); }
  });
}

function initData() {
  return {
    sessions,
    settings: state(),
    hotkey: HOTKEY_LABEL,
    customSounds: listCustomSounds(),
  };
}

function widgetPosition(width, height) {
  const s = state().widget;
  const area = screen.getPrimaryDisplay().workArea;
  if (s.x == null || s.y == null) {
    // Par défaut : en haut à droite de l'écran (bord droit du widget mémorisé).
    s.x = area.x + area.width - 24 + HALO_MARGIN;
    s.y = area.y + 24 - HALO_MARGIN;
  }
  // x mémorisé = bord droit (le widget grandit vers la gauche quand on change sa taille).
  return { x: Math.round(s.x - width), y: Math.round(s.y), width, height };
}

ipcMain.on('widget:size', (_e, { width, height }) => {
  if (!widget) return;
  const b = widgetPosition(Math.ceil(width), Math.ceil(height));
  widget.setBounds(b);
  if (!widget.isVisible() && state().widget.visible) widget.showInactive();
});

let drag = null;
ipcMain.on('widget:drag', (_e, { phase }) => {
  if (!widget) return;
  const { x, y } = screen.getCursorScreenPoint();
  if (phase === 'start') {
    const b = widget.getBounds();
    drag = { x, y, bx: b.x, by: b.y, w: b.width, h: b.height };
  } else if (phase === 'move' && drag) {
    widget.setBounds({ x: drag.bx + (x - drag.x), y: drag.by + (y - drag.y), width: drag.w, height: drag.h });
  } else if (phase === 'end' && drag) {
    const b = widget.getBounds();
    state().widget.x = b.x + b.width;
    state().widget.y = b.y;
    stateStore.save();
    drag = null;
  }
});

ipcMain.on('widget:ignore-mouse', (_e, ignore) => {
  if (widget && !widget.isDestroyed()) widget.setIgnoreMouseEvents(ignore, { forward: true });
});

function keepWidgetOnScreen() {
  if (!widget) return;
  const b = widget.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + b.width > a.x + 40 && b.x < a.x + a.width - 40 && b.y + 40 < a.y + a.height && b.y + b.height > a.y;
  });
  if (!visible) {
    state().widget.x = area.x + area.width - 24 + HALO_MARGIN;
    state().widget.y = area.y + 24 - HALO_MARGIN;
    widget.setBounds(widgetPosition(b.width, b.height));
    stateStore.save();
  }
}

function setWidgetVisible(visible) {
  state().widget.visible = visible;
  stateStore.save();
  if (!widget) return;
  if (visible) widget.showInactive();
  else widget.hide();
  broadcast('settings', state());
  updateTrayMenu();
}
const toggleWidget = () => setWidgetVisible(!(widget && widget.isVisible()));

function setWidgetScale(scale) {
  state().widget.scale = scale;
  stateStore.save();
  if (widget) {
    widget.webContents.setZoomFactor(scale);
    widget.webContents.send('settings', state());
  }
  broadcast('settings', state());
}

// Position de la souris, pour les yeux du cube vert (seulement quand on la demande).
let mouseTimer = null;
ipcMain.on('widget:follow-mouse', (_e, on) => {
  clearInterval(mouseTimer);
  mouseTimer = null;
  if (!on) return;
  mouseTimer = setInterval(() => {
    if (!widget || widget.isDestroyed() || !widget.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = widget.getContentBounds();
    widget.webContents.send('mouse', { x: p.x - b.x, y: p.y - b.y });
  }, 1000 / 30);
});

ipcMain.on('widget:menu', () => {
  const scale = state().widget.scale || 1;
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir Cube Hub', click: () => openHub() },
    { label: `Masquer le widget (${HOTKEY_LABEL})`, click: () => setWidgetVisible(false) },
    { type: 'separator' },
    {
      label: 'Taille du widget',
      submenu: [1, 0.9, 0.8, 0.7, 0.6].map((v) => ({
        label: `${Math.round(v * 100)} %`, type: 'radio', checked: Math.abs(v - scale) < 0.01, click: () => setWidgetScale(v),
      })),
    },
    { label: 'Réglages…', click: () => openHub({ settings: true }) },
    { type: 'separator' },
    { label: 'Quitter Cube Hub', click: () => app.quit() },
  ]);
  menu.popup({ window: widget });
});

ipcMain.on('widget:collapsed', (_e, collapsed) => {
  state().widget.collapsed = collapsed;
  stateStore.save();
});

// Le widget calcule l'image de la zone de notification (cube bleu / orange / vert / endormi).
ipcMain.on('tray:image', (_e, { dataURL, mood }) => {
  if (!tray) return;
  trayMood = mood;
  const img = nativeImage.createFromDataURL(dataURL);
  if (!img.isEmpty()) tray.setImage(img);
  tray.setToolTip(`Cube Hub — ${moodLabel(mood)}`);
});

const moodLabel = (m) => ({
  working: 'Claude bosse', waiting: 'Claude attend ta réponse', done: 'terminé',
  celebrating: 'tâche terminée', sleeping: 'aucune session',
})[m] || '';

// ---------------------------------------------------------------- Zone de notification

function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'frames', 'menubar', 'Sommeil', '10_dort.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON) : img.resize({ width: 20, height: 20 }));
  tray.setToolTip('Cube Hub');
  tray.on('click', () => tray.popUpContextMenu());
  tray.on('double-click', () => openHub());
  updateTrayMenu();
}

const statusLabel = { working: 'bosse', waiting: 'attend ta réponse', done: 'terminé' };
const statusEmoji = { working: '🔵', waiting: '🟠', done: '🟢' };

function updateTrayMenu() {
  if (!tray) return;
  const items = sessions.length
    ? sessions.map((s) => ({
      label: `${statusEmoji[s.status]}  ${s.projectName} — ${statusLabel[s.status]}`,
      click: () => openHub({ select: rowKeyForSession(s) }),
    }))
    : [{ label: 'Aucune session Claude Code', enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    ...items,
    { type: 'separator' },
    { label: 'Ouvrir Cube Hub', click: () => openHub() },
    { label: `${widget && widget.isVisible() ? 'Masquer' : 'Afficher'} le widget (${HOTKEY_LABEL})`, click: toggleWidget },
    { label: 'Réglages…', click: () => openHub({ settings: true }) },
    { type: 'separator' },
    { label: 'Quitter Cube Hub', click: () => app.quit() },
  ]));
}

function rowKeyForSession(s) {
  if (s.hubProject && state().hub.projects.some((p) => p.id === s.hubProject)) return 'p:' + s.hubProject;
  return 's:' + s.id;
}

// ---------------------------------------------------------------- Cube Hub

function openHub(opts = {}) {
  if (hub && !hub.isDestroyed()) {
    if (hub.isMinimized()) hub.restore();
    hub.show();
    hub.focus();
    if (opts.select || opts.settings || opts.selectSession) hub.webContents.send('hub:command', opts);
    return;
  }
  const b = state().hub.bounds || {};
  hub = new BrowserWindow({
    width: b.width || 1100, height: b.height || 700, x: b.x, y: b.y, minWidth: 760, minHeight: 480,
    backgroundColor: '#000000', title: 'Cube Hub', icon: ICON, show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0a0b', symbolColor: '#e0e0e0', height: 44 },
    webPreferences: { preload, backgroundThrottling: false },
  });
  hub.loadURL(pageURL('hub'));
  hub.once('ready-to-show', () => hub.show());
  hub.webContents.on('did-finish-load', () => {
    hub.webContents.send('init', initData());
    if (opts.select || opts.settings || opts.selectSession) hub.webContents.send('hub:command', opts);
  });
  hub.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('[hub]', message); });
  const saveBounds = () => {
    if (!hub.isMaximized() && !hub.isMinimized()) { state().hub.bounds = hub.getBounds(); stateStore.save(); }
  };
  hub.on('resize', saveBounds);
  hub.on('move', saveBounds);
  hub.on('closed', () => { hub = null; });
}

ipcMain.on('open-hub', (_e, opts) => openHub(opts || {}));
ipcMain.on('widget:toggle', toggleWidget);
ipcMain.on('widget:set-scale', (_e, v) => setWidgetScale(v));

ipcMain.handle('state:update', (_e, patch) => {
  // Le Hub envoie ses changements (thèmes, ordre, projets, sons…).
  const s = state();
  for (const [k, v] of Object.entries(patch)) {
    if (['hub', 'sounds', 'widget', 'notifications', 'telegram', 'team'].includes(k)) Object.assign(s[k], v);
  }
  if (patch.team) writeTeamConfig();
  stateStore.save();
  broadcast('settings', s);
  return s;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(hub || undefined, {
    title: 'Choisir le dossier du projet', properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.on('open-folder', (_e, folder) => { if (folder) shell.openPath(folder); });

// Ouvre un terminal Windows dans le dossier (Windows Terminal s'il est là, sinon PowerShell).
ipcMain.on('open-terminal', (_e, folder) => {
  if (!folder || !fs.existsSync(folder)) return;
  const wt = spawn('wt.exe', ['-d', folder], { detached: true, stdio: 'ignore', shell: false });
  wt.on('error', () => {
    spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit'], { cwd: folder, detached: true, stdio: 'ignore' });
  });
  wt.unref();
});

ipcMain.handle('confirm', async (_e, { message, detail, ok }) => {
  const r = await dialog.showMessageBox(hub || widget, {
    type: 'question', buttons: [ok || 'OK', 'Annuler'], defaultId: 0, cancelId: 1, message, detail,
  });
  return r.response === 0;
});

ipcMain.handle('kill-process', (_e, pid) => {
  try { process.kill(pid); return true; } catch { return false; }
});

// Menu contextuel d'une ligne du Hub : la page envoie la liste, on renvoie le choix.
ipcMain.handle('popup-menu', (_e, items) => new Promise((resolve) => {
  let chosen = null;
  const build = (list) => list.map((it) => {
    if (it.type === 'separator') return { type: 'separator' };
    if (it.submenu) return { label: it.label, submenu: build(it.submenu) };
    return { label: it.label, enabled: it.enabled !== false, type: it.checked != null ? 'checkbox' : 'normal', checked: !!it.checked, click: () => { chosen = it.id; } };
  });
  const menu = Menu.buildFromTemplate(build(items));
  menu.popup({ window: hub || widget, callback: () => setTimeout(() => resolve(chosen), 0) });
}));

// ---------------------------------------------------------------- Réglages

ipcMain.handle('hooks:status', () => ({ status: hooks.status(), preview: hooks.preview(), path: paths.claudeSettings }));
ipcMain.handle('hooks:install', () => {
  try {
    installHookProgram();
    const backup = hooks.install();
    return { ok: true, backup, status: hooks.status() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('hooks:uninstall', () => {
  try {
    const backup = hooks.uninstall();
    return { ok: true, backup, status: hooks.status() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('login-item:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('login-item:set', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('sounds:list', () => listCustomSounds());
ipcMain.on('sounds:open-folder', () => {
  fs.mkdirSync(paths.soundsDir, { recursive: true });
  shell.openPath(paths.soundsDir);
});
ipcMain.on('open-url', (_e, link) => {
  if (/^https:\/\//.test(link)) shell.openExternal(link);
});

function listCustomSounds() {
  const out = {};
  try {
    for (const f of fs.readdirSync(paths.soundsDir)) {
      const m = /^(bosse|fini|attente|dodo)\.(wav|mp3|m4a|ogg|aiff?)$/i.exec(f);
      if (m) out[m[1].toLowerCase()] = 'app://sons/' + encodeURIComponent(f);
    }
  } catch {}
  return out;
}

// ---------------------------------------------------------------- Telegram

ipcMain.handle('telegram:status', () => notifier.status());
ipcMain.handle('telegram:connect', async (_e, token) => {
  try {
    const botName = await notifier.connect(token);
    startChatDetection();
    return { ok: true, botName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('telegram:detect', () => { startChatDetection(); return true; });
ipcMain.handle('telegram:disconnect', () => {
  notifier.disconnect();
  Object.assign(state().telegram, { enabled: false, chatId: null, chatName: '' });
  state().telegram.commands.enabled = false;
  stateStore.save();
  remote.sync();
  broadcast('settings', state());
  return true;
});

// Commandes depuis Telegram.
ipcMain.handle('remote:status', () => remote.status());
ipcMain.handle('remote:setup-begin', () => remote.beginSetup());
ipcMain.handle('remote:setup-confirm', (_e, code) => {
  const r = remote.confirmSetup(code);
  if (r.ok) {
    state().telegram.commands.enabled = true;
    stateStore.save();
    remote.sync();
    broadcast('settings', state());
  }
  return r;
});
ipcMain.handle('remote:remove-code', () => {
  remote.removeSecret();
  broadcast('settings', state());
  return remote.status();
});
ipcMain.handle('remote:set', (_e, { enabled, allowed }) => {
  const c = state().telegram.commands;
  if (enabled != null) c.enabled = !!enabled;
  if (allowed) Object.assign(c.allowed, allowed);
  stateStore.save();
  remote.sync();
  broadcast('settings', state());
  return remote.status();
});
ipcMain.handle('remote:lock', () => { remote.lock('depuis le PC'); return remote.status(); });
ipcMain.on('remote:open-log', () => {
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');
  shell.openPath(LOG_FILE);
});
ipcMain.handle('telegram:test', async () => {
  try {
    await notifier.send('🧊 <b>Cube Hub</b> est bien relié à Telegram. Tu recevras ici les nouvelles de tes sessions quand tu n\'es pas devant ton PC.');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function startChatDetection() {
  notifier.detectChat((chat) => {
    if (chat) {
      Object.assign(state().telegram, { chatId: chat.id, chatName: chat.name, enabled: true });
      stateStore.save();
      notifier.send('🧊 <b>Cube Hub</b> : c\'est relié ! Tu recevras ici les nouvelles de tes sessions Claude Code.').catch(() => {});
      remote.sync();
    }
    broadcast('settings', state());
    broadcast('telegram:detected', chat);
  });
}

// ---------------------------------------------------------------- Bienvenue

function openWelcome() {
  if (welcome && !welcome.isDestroyed()) { welcome.focus(); return; }
  welcome = new BrowserWindow({
    width: 580, height: 720, resizable: false, maximizable: false, minimizable: false,
    title: 'Bienvenue dans Cube Hub', icon: ICON, backgroundColor: '#0a0a0b', autoHideMenuBar: true,
    webPreferences: { preload },
  });
  welcome.setMenu(null);
  welcome.loadURL(pageURL('welcome'));
  welcome.webContents.on('did-finish-load', () => welcome.webContents.send('init', initData()));
  welcome.on('closed', () => {
    welcome = null;
    state().welcomeDone = true;
    stateStore.save();
  });
}
ipcMain.on('welcome:close', () => welcome && welcome.close());
ipcMain.on('welcome:open', () => openWelcome());

// ---------------------------------------------------------------- V2 : équipe IA (Roblox)

// Le serveur MCP et le hook de l'équipe sont copiés dans ~/.cube-widget/bin (hors de l'archive
// de l'app), pour que Claude Code puisse les lancer avec Node.
function installTeamPrograms() {
  for (const [src, dst] of [['mcp-server.js', paths.teamMcp], ['equipe-hook.js', paths.teamHook]]) {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const a = fs.readFileSync(path.join(__dirname, 'team', src));
      let same = false;
      try { same = Buffer.compare(a, fs.readFileSync(dst)) === 0; } catch {}
      if (!same) fs.writeFileSync(dst, a);
    } catch (e) {
      console.error('Copie du programme de l\'équipe impossible', e.message);
    }
  }
}

// Réglages lus par le serveur MCP à chaque appel (pas besoin de relancer Claude Code).
function writeTeamConfig() {
  const t = state().team;
  try {
    fs.mkdirSync(path.dirname(paths.teamConfig), { recursive: true });
    fs.writeFileSync(paths.teamConfig, JSON.stringify({ vault: t.vault, llm: t.llm, codex: t.codex }, null, 2));
  } catch (e) {
    console.error('Réglages de l\'équipe :', e.message);
  }
}

const teamRuntime = () => ({
  node: nodePath,
  electron: process.execPath,
  mcpScript: paths.teamMcp,
  hookScript: paths.teamHook,
});

ipcMain.handle('team:detect', async () => {
  if (!nodePath) nodePath = await detect.where('node');
  return detect.detectAll(state().team);
});
// Écran « Connexion » : ouvre une vraie fenêtre PowerShell pour installer ou se connecter.
// Seules ces quatre commandes sont possibles ; la connexion se fait dans le navigateur, par l'utilisateur.
const SETUP_SCRIPTS = {
  'claude-install': ['Installation de Claude Code', 'irm https://claude.ai/install.ps1 | iex'],
  'claude-login': ['Connexion a Claude Code : choisis ton compte dans le navigateur, puis tape /exit', 'claude'],
  'codex-install': ['Installation de Codex', 'npm i -g @openai/codex'],
  'codex-login': ['Connexion a Codex : valide dans le navigateur', 'codex login'],
};
ipcMain.handle('team:setup-run', (_e, what) => {
  const s = SETUP_SCRIPTS[what];
  if (!s) return false;
  const extra = detect.extraPath().map((d) => "'" + d + "'").join(',');
  const script = "$env:Path += ';' + (@(" + extra + ") -join ';'); Write-Host '" + s[0] + "' -ForegroundColor Cyan; Write-Host ''; " + s[1] + "; Write-Host ''; Write-Host 'Termine. Tu peux fermer cette fenetre et revenir dans Cube Hub.' -ForegroundColor Green";
  spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', script], { detached: true, stdio: 'ignore' }).unref();
  return true;
});

ipcMain.handle('team:llm-test', (_e, llm) => detect.llmCheck(llm || state().team.llm));

ipcMain.handle('team:pick-parent', async () => {
  const r = await dialog.showOpenDialog(hub || undefined, {
    title: 'Où créer le dossier du jeu ?', properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('team:pick-vault', async () => {
  const r = await dialog.showOpenDialog(hub || undefined, {
    title: 'Dossier du cerveau Obsidian (coffre)', properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

// Crée un jeu (dossier neuf ou existant) : projet Rojo + consignes + branchements + cerveau.
ipcMain.handle('team:create-game', async (_e, { projectId, folder, parent, name, genre, pitch }) => {
  try {
    if (!nodePath) nodePath = await detect.where('node');
    const target = folder || path.join(parent, scaffold.safeName(name));
    const r = scaffold.scaffoldGame({
      folder: target, projectId, name, genre, pitch, team: state().team, runtime: teamRuntime(), vault: state().team.vault,
    });
    return { ok: true, folder: target, created: r.report.created.length, skipped: r.report.skipped.length, brainDir: r.brainDir };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Après un changement de réglages : réécrit .mcp.json et .claude/settings.json de chaque jeu.
ipcMain.handle('team:rewire', async () => {
  if (!nodePath) nodePath = await detect.where('node');
  const done = [];
  for (const p of state().hub.projects.filter((x) => x.kind === 'roblox')) {
    try {
      if (!fs.existsSync(p.folder)) continue;
      scaffold.writeWiring({ folder: p.folder, projectId: p.id, name: p.name, team: state().team, runtime: teamRuntime() });
      done.push(p.name);
    } catch (e) {
      console.error('Branchement de', p.name, e.message);
    }
  }
  return done;
});

ipcMain.handle('team:history', (_e, projectId) => activity.history(projectId));
ipcMain.handle('team:clear', (_e, projectId) => { activity.clear(projectId); return true; });

function brainFolder(name) {
  const vault = state().team.vault;
  return name ? path.join(vault, 'Jeux', scaffold.safeName(name)) : vault;
}

// Ouvre le cerveau : dans Obsidian si le coffre y est déjà enregistré, sinon dans l'Explorateur.
ipcMain.handle('team:open-brain', (_e, { name } = {}) => {
  const vault = state().team.vault;
  scaffold.ensureVault(vault);
  const info = detect.obsidianInfo(vault);
  const target = brainFolder(name);
  fs.mkdirSync(target, { recursive: true });
  if (info.exe && info.registered) {
    const dash = path.join(target, `00 ${scaffold.safeName(name)} - Tableau de bord.md`);
    const file = name && fs.existsSync(dash) ? dash : path.join(vault, '00 Accueil.md');
    shell.openExternal('obsidian://open?path=' + encodeURIComponent(file));
    return { how: 'obsidian' };
  }
  shell.openPath(target);
  return { how: 'explorer', obsidian: !!info.exe };
});

ipcMain.handle('team:open-app', (_e, which) => {
  const exe = which === 'blender' ? detect.blenderExe() : which === 'studio' ? detect.studioExe() : which === 'obsidian' ? detect.obsidianInfo(state().team.vault).exe : null;
  if (!exe) return false;
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  return true;
});

// ---------------------------------------------------------------- Terminaux du Hub

const terminals = new Map(); // id du projet (+ ":codex" / ":rojo") → { pty, buffer, running }

// Ce qui est lancé dans chaque sorte de terminal (PowerShell reste ouvert après).
function agentScript(agent, { resume, prompt }) {
  const missing = (what, how) => `Write-Host ''; Write-Host '${what} n est pas installe sur ce PC.' -ForegroundColor Yellow; ` +
    how.map((l) => `Write-Host '${l}' -ForegroundColor Yellow`).join('; ');
  if (agent === 'codex') {
    return `if (Get-Command codex -ErrorAction SilentlyContinue) { codex } else { ${missing('Codex (OpenAI)', ['Pour l installer :  npm i -g @openai/codex', 'puis :  codex login', 'et rouvre cet onglet.'])} }`;
  }
  if (agent === 'rojo') {
    return `if (Get-Command rojo -ErrorAction SilentlyContinue) { rojo serve } else { ${missing('Rojo', ['Installe Rojo (https://rojo.space) et son plugin dans Roblox Studio,', 'puis rouvre cet onglet.'])} }`;
  }
  let claudeCmd = resume === 'continue' ? 'claude --continue'
    : resume ? `claude --resume ${String(resume).replace(/[^A-Za-z0-9_-]/g, '')}` : 'claude';
  // Guillemets doubles remplacés : PowerShell 5.1 les passe mal aux programmes.
  if (prompt && !resume) claudeCmd += ` '${String(prompt).replace(/"/g, '»').replace(/'/g, "''").replace(/[\r\n]+/g, ' ').slice(0, 1500)}'`;
  return `if (Get-Command claude -ErrorAction SilentlyContinue) { ${claudeCmd} } else { ` +
    `Write-Host ''; Write-Host 'Claude Code (en ligne de commande) n est pas installe sur ce PC.' -ForegroundColor Yellow; ` +
    `Write-Host 'Pour l installer, tape :  irm https://claude.ai/install.ps1 | iex' -ForegroundColor Yellow; ` +
    `Write-Host 'puis relance ce cube.' -ForegroundColor Yellow }`;
}
const MAX_BUFFER = 400_000;
let ptyModule = null;
function pty() {
  if (!ptyModule) ptyModule = require('@lydell/node-pty');
  return ptyModule;
}

// Lance Claude Code dans le dossier du projet, dans PowerShell (qui reste ouvert après).
// termId = id du projet (Claude), ou "<id>:codex" / "<id>:rojo" pour les onglets de la V2.
ipcMain.handle('term:start', (_e, { projectId, folder, cols, rows, resume, agent = 'claude', prompt }) => {
  const termId = projectId;
  const baseId = String(projectId).split(':')[0];
  const existing = terminals.get(termId);
  if (existing && existing.running) return { ok: true, already: true };
  if (!fs.existsSync(folder)) return { ok: false, error: `Le dossier n'existe plus : ${folder}` };
  // Sans l'outil en ligne de commande, on explique comment l'installer.
  const script = agentScript(agent, { resume, prompt });
  let p;
  try {
    p = pty().spawn('powershell.exe', ['-NoLogo', '-NoExit', '-Command', script], {
      name: 'xterm-256color', cols: cols || 100, rows: rows || 30, cwd: folder,
      env: { ...process.env, PATH: [process.env.PATH, ...detect.extraPath()].join(';'), CUBE_HUB_PROJECT: baseId, FORCE_COLOR: '1' },
      useConpty: true,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const t = { pty: p, buffer: existing ? existing.buffer : '', running: true, agent };
  terminals.set(termId, t);
  p.onData((data) => {
    t.buffer += data;
    if (t.buffer.length > MAX_BUFFER) t.buffer = t.buffer.slice(-MAX_BUFFER * 0.8);
    if (hub && !hub.isDestroyed()) hub.webContents.send('term:data', { projectId: termId, data });
  });
  p.onExit(({ exitCode }) => {
    t.running = false;
    if (hub && !hub.isDestroyed()) hub.webContents.send('term:exit', { projectId: termId, exitCode });
  });
  return { ok: true };
});

ipcMain.handle('term:buffer', (_e, projectId) => {
  const t = terminals.get(projectId);
  return t ? { buffer: t.buffer, running: t.running } : { buffer: '', running: false };
});
ipcMain.handle('term:running', () => [...terminals.entries()].filter(([, t]) => t.running).map(([id]) => id));
ipcMain.on('term:input', (_e, { projectId, data }) => {
  const t = terminals.get(projectId);
  if (t && t.running) t.pty.write(data);
});
ipcMain.on('term:resize', (_e, { projectId, cols, rows }) => {
  const t = terminals.get(projectId);
  if (t && t.running && cols > 0 && rows > 0) try { t.pty.resize(cols, rows); } catch {}
});
ipcMain.handle('term:kill', (_e, projectId) => {
  const t = terminals.get(projectId);
  if (t && t.running) try { t.pty.kill(); } catch {}
  return true;
});
ipcMain.handle('term:forget', (_e, projectId) => {
  // Le projet et ses onglets Codex / Rojo.
  for (const id of [projectId, `${projectId}:codex`, `${projectId}:rojo`]) {
    const t = terminals.get(id);
    if (t && t.running) try { t.pty.kill(); } catch {}
    terminals.delete(id);
  }
  return true;
});
