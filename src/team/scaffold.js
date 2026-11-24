// Cube Hub V2 : crée un projet de jeu Roblox prêt pour l'équipe IA, et son cerveau Obsidian.
// Ne remplace jamais un fichier existant (sauf les fichiers de branchement .mcp.json et
// .claude/settings.json, qui sont fusionnés).
const fs = require('fs');
const path = require('path');

const today = () => new Date().toISOString().slice(0, 10);
const safeName = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Sans titre';
const slashes = (p) => String(p).replace(/\\/g, '/');

const GENRES = {
  obby: { label: 'Obby (parcours)', loop: 'Avancer de checkpoint en checkpoint → débloquer des étapes → skins / trails en récompense.', systems: ['Checkpoints', 'Étapes', 'Récompenses'] },
  tycoon: { label: 'Tycoon', loop: 'Gagner de l\'argent automatiquement → acheter des améliorations → gagner plus vite → rebirth.', systems: ['Argent', 'Boutons d\'achat', 'Rebirth', 'Sauvegarde'] },
  simulateur: { label: 'Simulateur', loop: 'Cliquer / récolter → vendre → améliorer l\'outil et le sac → nouvelles zones → pets.', systems: ['Récolte', 'Vente', 'Améliorations', 'Zones', 'Pets'] },
  combat: { label: 'Combat / PvP', loop: 'Affronter → gagner de l\'XP et des armes → monter de niveau → classement.', systems: ['Armes', 'Dégâts', 'Niveaux', 'Classement'] },
  horreur: { label: 'Horreur / histoire', loop: 'Explorer → résoudre des énigmes → fuir le monstre → fin de chapitre.', systems: ['Monstre (IA)', 'Énigmes', 'Chapitres', 'Ambiance'] },
  autre: { label: 'Autre', loop: 'À définir avec Claude.', systems: [] },
};

function writeIfMissing(file, content, report) {
  if (fs.existsSync(file)) { report.skipped.push(file); return false; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  report.created.push(file);
  return true;
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

// ------------------------------------------------------------------ Cerveau Obsidian

function vaultHome() {
  return `# 🧠 Cerveau Roblox

Le cerveau partagé de tous tes jeux. Claude Code y range ce qu'il apprend et décide,
pour ne jamais repartir de zéro (et dépenser moins de tokens à relire le code).

## Jeux
Chaque jeu a son dossier dans **Jeux/** avec un tableau de bord.

## Savoir partagé
Les leçons valables pour tous les jeux : [[Savoir/Luau - Bonnes pratiques]], [[Savoir/Roblox - Pièges connus]], [[Savoir/Pipeline Blender vers Studio]].

## Modèles
Les modèles de notes sont dans **Modèles/** (Réglages d'Obsidian → Modèles → dossier « Modèles »).
`;
}

const SAVOIR = {
  'Luau - Bonnes pratiques': `# Luau - Bonnes pratiques

- \`--!strict\` en haut des modules, types sur les fonctions publiques.
- Services : \`local Players = game:GetService("Players")\` en haut du fichier.
- \`task.wait\`, \`task.spawn\`, \`task.delay\` (jamais \`wait\`, \`spawn\`, \`delay\`).
- Le serveur décide : jamais de confiance dans le client (argent, dégâts, achats).
- Chaque \`RemoteEvent\` côté serveur vérifie ses arguments (type, distance, cooldown).
- DataStore : toujours dans \`pcall\`, avec réessais, et \`UpdateAsync\` plutôt que \`SetAsync\`.
- Déconnecter les \`Connection\` qui ne servent plus (fuites mémoire).
- Modules partagés dans ReplicatedStorage/Shared, logique serveur dans ServerScriptService.
`,
  'Roblox - Pièges connus': `# Roblox - Pièges connus

- \`PlayerAdded\` peut rater les joueurs déjà là en Studio : boucler aussi sur \`Players:GetPlayers()\`.
- \`WaitForChild\` sans délai bloque pour toujours si le nom est faux.
- Les \`Part\` non ancrées tombent : \`Anchored = true\` pour le décor.
- Le client ne voit pas ServerStorage / ServerScriptService.
- \`BindToClose\` pour sauvegarder les données à la fermeture du serveur.
`,
  'Pipeline Blender vers Studio': `# Pipeline Blender vers Studio

1. Modéliser dans Blender (Claude peut le piloter via le MCP Blender). Échelle : 1 unité Blender ≈ 1 stud… vérifier sur un objet témoin.
2. Garder peu de polygones (mobile !) et des noms d'objets clairs.
3. Exporter en **FBX** dans \`assets/export/\` du projet (Appliquer les transformations, +Y en haut).
4. Dans Studio : Avatar → **Importer 3D** (ou via le MCP Studio), ranger le modèle dans le bon dossier.
5. Noter l'asset dans le cerveau : \`brain_log\` kind "asset".
`,
};

const MODELES = {
  'Décision': '---\ntype: Décision\njeu: \ncréé: {{date}}\ntags: [roblox, decision]\n---\n# {{title}}\n\n## Contexte\n\n## Décision\n\n## Pourquoi\n\n## Conséquences\n',
  'Bug': '---\ntype: Bug\nstatut: ouvert\ncréé: {{date}}\ntags: [roblox, bug]\n---\n# {{title}}\n\n## Symptôme\n\n## Cause\n\n## Correction\n\n## Comment éviter\n',
  'Idée': '---\ntype: Idée\nstatut: à trier\ncréé: {{date}}\ntags: [roblox, idee]\n---\n# {{title}}\n\n## Idée\n\n## Pourquoi c\'est fun\n\n## Effort estimé\n',
  'Système': '---\ntype: Système\ncréé: {{date}}\ntags: [roblox, systeme]\n---\n# {{title}}\n\n## Rôle\n\n## Fichiers\n\n## API (fonctions, RemoteEvents)\n\n## Dépendances\n\n## À savoir\n',
  'Asset 3D': '---\ntype: Asset 3D\ncréé: {{date}}\ntags: [roblox, asset]\n---\n# {{title}}\n\n## Description\n\n## Fichier Blender\n\n## Export\n\n## Dans Studio\n',
};

function ensureVault(vault, report = { created: [], skipped: [] }) {
  fs.mkdirSync(path.join(vault, 'Jeux'), { recursive: true });
  writeIfMissing(path.join(vault, '00 Accueil.md'), vaultHome(), report);
  for (const [name, body] of Object.entries(SAVOIR)) {
    writeIfMissing(path.join(vault, 'Savoir', `${name}.md`), `---\ntype: Savoir\ncréé: "${today()}"\ntags: [roblox, savoir]\n---\n${body}`, report);
  }
  for (const [name, body] of Object.entries(MODELES)) writeIfMissing(path.join(vault, 'Modèles', `${name}.md`), body, report);
  // Réglage Obsidian minimal : dossier des modèles, nouvelles notes dans le dossier courant.
  writeIfMissing(path.join(vault, '.obsidian', 'templates.json'), JSON.stringify({ folder: 'Modèles', dateFormat: 'YYYY-MM-DD' }, null, 2), report);
  writeIfMissing(path.join(vault, '.obsidian', 'core-plugins.json'), JSON.stringify(['file-explorer', 'global-search', 'switcher', 'graph', 'backlink', 'outgoing-link', 'tag-pane', 'page-preview', 'templates', 'outline', 'daily-notes'], null, 2), report);
  return report;
}

function ensureGameBrain(vault, { name, genre = 'autre', pitch = '', folder = '' }, report = { created: [], skipped: [] }) {
  ensureVault(vault, report);
  const g = GENRES[genre] || GENRES.autre;
  const dir = path.join(vault, 'Jeux', safeName(name));
  const fm = (type, extra = '') => `---\ntype: ${type}\njeu: "${name}"\ncréé: "${today()}"\nmaj: "${today()}"\ntags: [roblox]${extra}\n---\n`;
  for (const sub of ['Game Design', 'Systèmes', 'Assets 3D', 'Décisions', 'Bugs', 'Idées', 'Journal']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  writeIfMissing(path.join(dir, `00 ${safeName(name)} - Tableau de bord.md`), `${fm('Tableau de bord')}
# 🎮 ${name}

**Genre :** ${g.label}
**Dossier du projet :** \`${folder}\`

## Le pitch
${pitch || '_À écrire avec Claude._'}

## Game design
- [[Game Design/Concept]]
- [[Game Design/Boucle de jeu]]
- [[Game Design/Économie et progression]]

## Où on en est
- [ ] Concept validé
- [ ] Boucle de jeu jouable (prototype)
- [ ] Systèmes principaux
- [ ] Assets 3D
- [ ] UI
- [ ] Sauvegarde des données
- [ ] Tests avec des amis
- [ ] Publication

## Dossiers
Systèmes · Assets 3D · Décisions · Bugs · Idées · Journal
`, report);
  writeIfMissing(path.join(dir, 'Game Design', 'Concept.md'), `${fm('Game Design')}
# Concept

## En une phrase
${pitch || ''}

## Public visé

## Ce qui rend le jeu unique

## Jeux qui inspirent (mécaniques, pas copie)
`, report);
  writeIfMissing(path.join(dir, 'Game Design', 'Boucle de jeu.md'), `${fm('Game Design')}
# Boucle de jeu

## Boucle principale
${g.loop}

## Systèmes nécessaires
${g.systems.map((s) => `- [[Systèmes/${s}|${s}]]`).join('\n') || '- '}

## Session type (5 premières minutes)
`, report);
  writeIfMissing(path.join(dir, 'Game Design', 'Économie et progression.md'), `${fm('Game Design')}
# Économie et progression

## Monnaies

## Ce qu'on achète

## Courbe de progression (niveaux, prix)
_Astuce : demande au LLM local de générer les tables de prix avec llm_quick (style "donnees")._
`, report);
  return { dir, report };
}

// ------------------------------------------------------------------ Projet Roblox

function claudeMd({ name, genre, team }) {
  const g = GENRES[genre] || GENRES.autre;
  const has = (k) => team[k] !== false;
  return `# ${name} — jeu Roblox (${g.label})

Ce projet est piloté depuis **Cube Hub V2**. Tu es **Claude Code, le chef d'orchestre** :
tu comprends ce que veut le joueur-créateur, tu découpes, tu délègues, tu vérifies, tu documentes.

## L'équipe

| Qui | Rôle | Comment |
|---|---|---|
| 🎼 **Toi (Claude Code)** | Chef d'orchestre : architecture, plan, code délicat, relecture finale | — |
${has('codex') ? '| 🤝 **Codex** | Le second : écrit le gros code bien spécifié, refactorise, écrit des tests, 2e avis | `codex_delegate` |\n' : ''}${has('llm') ? '| ⚡ **LLM local** | Petites tâches gratuites et rapides : résumés, noms, données, textes, Luau simple | `llm_quick` |\n' : ''}${has('blender') ? '| 🎨 **Blender** | Modèles 3D (piloté par toi via le MCP Blender) | outils `mcp__blender__*` |\n' : ''}${has('studio') ? '| 🎮 **Roblox Studio** | Voir et modifier la place ouverte, tester | outils `mcp__roblox-studio__*` |\n' : ''}| 🧠 **Cerveau Obsidian** | La mémoire structurée du jeu et le savoir partagé | \`brain_*\` |

## Règles de délégation (pour économiser tes tokens et aller vite)

1. **Début de session** : appelle \`brain_overview\` (et \`brain_search\` au besoin) AVANT de relire du code.
${has('llm') ? `2. **Petite tâche ?** → \`llm_quick\`. Exemples : résumer des fichiers (passe-les dans \`files\`, ne les lis pas toi-même),
   générer une table d'objets/prix/niveaux (\`style: "donnees"\`, \`write_to\` pour l'écrire directement), textes de quêtes/dialogues,
   noms d'objets, un petit module Luau répétitif. S'il est injoignable, fais-le toi-même.\n` : ''}${has('codex') ? `3. **Gros code bien défini ?** → \`codex_delegate\` avec une spécification complète (fichiers, API, contraintes) : Codex ne voit pas ta conversation.
   Lance-le en \`mode: "read"\` pour une relecture ou un 2e avis sur un bug. **Relis toujours** ce qu'il a fait.\n` : ''}4. **Garde pour toi** : l'architecture, les choix de game design avec le créateur, le code de sécurité (RemoteEvents, achats, données), la vérification finale.
5. **Fin de chaque étape** : \`brain_log\` (decision / systeme / bug / asset / idee / journal). Une leçon utile pour tous les jeux → kind "savoir".

## Conventions Roblox

- Source de vérité = les fichiers. Synchronisation avec **Rojo** (\`default.project.json\`) :
  - \`src/server\` → ServerScriptService/Server · \`src/client\` → StarterPlayerScripts/Client · \`src/shared\` → ReplicatedStorage/Shared
  - Ne crée pas de scripts directement dans Studio : écris les fichiers \`.luau\`.
- Luau \`--!strict\`, \`task.wait\`/\`task.spawn\`, services via \`game:GetService\`.
- Le serveur a toujours raison : valider chaque RemoteEvent (types, distance, cooldown).
- DataStore dans \`pcall\` avec réessais, \`UpdateAsync\`, sauvegarde à \`PlayerRemoving\` et \`BindToClose\`.
- Réglages du jeu (prix, vitesses, textes) dans \`src/shared/Config.luau\`, pas en dur dans le code.
- Commentaires et textes en français.

## 3D (Blender → Studio)
Modèles dans \`assets/blender/\`, exports FBX dans \`assets/export/\`. Peu de polygones (mobile). Voir la note « Pipeline Blender vers Studio » du cerveau.
`;
}

function agentsMd({ name }) {
  return `# AGENTS.md — consignes pour Codex

Tu es **Codex, le second** sur le jeu Roblox « ${name} ». Claude Code est le chef d'orchestre :
il t'envoie des tâches précises via Cube Hub. Fais exactement la tâche demandée, rien de plus.

## Règles
- Luau \`--!strict\`, \`task.*\`, services via \`game:GetService\`.
- Structure Rojo : \`src/server\` (serveur), \`src/client\` (client), \`src/shared\` (modules partagés).
- Fichiers \`.luau\` : \`*.server.luau\` = Script, \`*.client.luau\` = LocalScript, sinon ModuleScript.
- Le serveur valide tout ce qui vient du client. Jamais d'argent ni de dégâts décidés côté client.
- Réglages dans \`src/shared/Config.luau\`.
- Ne touche pas à \`default.project.json\`, \`.mcp.json\`, \`.claude/\`, \`CLAUDE.md\`, \`AGENTS.md\` sauf demande explicite.
- Commentaires en français, noms de variables en anglais.
- Termine par un résumé court : ce que tu as fait, fichiers touchés, points à vérifier.
`;
}

const LUAU = {
  'src/server/init.server.luau': (name) => `--!strict
-- Point d'entrée serveur de « ${name} » (ServerScriptService/Server).
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local function onPlayerAdded(player: Player)
\tprint(\`[\${Config.GameName}] \${player.Name} a rejoint la partie\`)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
\tonPlayerAdded(player)
end
`,
  'src/client/init.client.luau': (name) => `--!strict
-- Point d'entrée client de « ${name} » (StarterPlayerScripts/Client).
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

print(\`[\${Config.GameName}] client prêt\`)
`,
  'src/shared/Config.luau': (name) => `--!strict
-- Réglages du jeu, partagés serveur + client. Tout ce qui s'équilibre se règle ici.
local Config = {
\tGameName = "${name.replace(/"/g, '')}",
\tVersion = "0.1.0",
}

return Config
`,
};

function projectJson(name) {
  return JSON.stringify({
    name: name.replace(/[^\w -]/g, '').trim() || 'Jeu',
    tree: {
      $className: 'DataModel',
      ReplicatedStorage: { Shared: { $path: 'src/shared' } },
      ServerScriptService: { Server: { $path: 'src/server' } },
      StarterPlayer: { StarterPlayerScripts: { Client: { $path: 'src/client' } } },
    },
  }, null, 2) + '\n';
}

/**
 * Écrit (ou met à jour) .mcp.json et .claude/settings.json pour brancher l'équipe.
 * runtime = { node, electron, mcpScript, hookScript }, tools = réglages team (blender, studio…).
 */
function writeWiring({ folder, projectId, name, team, runtime }) {
  const mcpFile = path.join(folder, '.mcp.json');
  const mcp = readJSON(mcpFile) || {};
  mcp.mcpServers = mcp.mcpServers || {};
  const env = { CUBE_HUB_PROJECT: projectId, CUBE_PROJECT_DIR: folder, CUBE_GAME_NAME: name };
  if (runtime.node) {
    mcp.mcpServers['cube-equipe'] = { command: slashes(runtime.node), args: [slashes(runtime.mcpScript)], env };
  } else {
    mcp.mcpServers['cube-equipe'] = { command: slashes(runtime.electron), args: [slashes(runtime.mcpScript)], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
  }
  const cmdEntry = (c) => {
    const parts = splitArgs(c.args || '');
    if (/\.(bat|cmd)$/i.test(c.command)) return { command: 'cmd.exe', args: ['/c', c.command, ...parts] };
    return { command: c.command, args: parts };
  };
  if (team.studio?.enabled && team.studio.command) mcp.mcpServers['roblox-studio'] = cmdEntry(team.studio);
  else delete mcp.mcpServers['roblox-studio'];
  if (team.blender?.enabled && team.blender.command) mcp.mcpServers.blender = cmdEntry(team.blender);
  else delete mcp.mcpServers.blender;
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + '\n');

  // Réglages de projet de Claude Code : outils du cerveau autorisés, témoin Blender/Studio.
  const setFile = path.join(folder, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(setFile), { recursive: true });
  const s = readJSON(setFile) || {};
  s.permissions = s.permissions || {};
  const allow = new Set(s.permissions.allow || []);
  for (const t of ['brain_overview', 'brain_search', 'brain_read', 'brain_write', 'brain_log', 'team_status', 'llm_quick']) allow.add(`mcp__cube-equipe__${t}`);
  s.permissions.allow = [...allow];
  s.enabledMcpjsonServers = [...new Set([...(s.enabledMcpjsonServers || []).filter((k) => k in mcp.mcpServers), ...Object.keys(mcp.mcpServers)])];
  s.hooks = s.hooks || {};
  const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes('cube-equipe-hook');
  for (const ev of ['PreToolUse', 'PostToolUse']) {
    const list = (Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [])
      .map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((e) => e.hooks.length);
    if (runtime.node) list.push({ matcher: 'mcp__.*', hooks: [{ type: 'command', command: `"${slashes(runtime.node)}" "${slashes(runtime.hookScript)}" ${projectId}` }] });
    if (list.length) s.hooks[ev] = list; else delete s.hooks[ev];
  }
  fs.writeFileSync(setFile, JSON.stringify(s, null, 2) + '\n');
  return [mcpFile, setFile];
}

function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(str)))) out.push(m[1] ?? m[2]);
  return out;
}

function scaffoldGame({ folder, projectId, name, genre = 'autre', pitch = '', team, runtime, vault }) {
  const report = { created: [], skipped: [] };
  fs.mkdirSync(folder, { recursive: true });
  const w = (rel, content) => writeIfMissing(path.join(folder, rel), content, report);
  w('default.project.json', projectJson(name));
  for (const [rel, fn] of Object.entries(LUAU)) w(rel, fn(name));
  w('CLAUDE.md', claudeMd({ name, genre, team: { codex: team.codex?.enabled, llm: team.llm?.enabled, blender: team.blender?.enabled, studio: team.studio?.enabled } }));
  w('AGENTS.md', agentsMd({ name }));
  w('assets/blender/LISEZMOI.md', '# Fichiers Blender\n\nLes `.blend` du jeu. Exporte les modèles en FBX dans `../export/`.\n');
  w('assets/export/LISEZMOI.md', '# Exports\n\nLes FBX prêts à importer dans Roblox Studio (Importer 3D).\n');
  w('.gitignore', '*.rbxl.lock\n*.rbxlx.lock\n*.blend1\nsourcemap.json\n.claude/settings.local.json\n');
  w('README.md', `# ${name}\n\nJeu Roblox créé avec Cube Hub V2.\n\n## Lancer\n1. \`rojo serve\` dans ce dossier.\n2. Dans Roblox Studio, plugin Rojo → **Connect**.\n3. Les fichiers de \`src/\` arrivent dans la place.\n\nLe cerveau du jeu est dans le coffre Obsidian, dossier \`Jeux/${safeName(name)}\`.\n`);
  report.created.push(...writeWiring({ folder, projectId, name, team, runtime }));
  let brainDir = null;
  if (vault) brainDir = ensureGameBrain(vault, { name, genre, pitch, folder }, report).dir;
  return { report, brainDir };
}

module.exports = { scaffoldGame, writeWiring, ensureVault, ensureGameBrain, GENRES, safeName };
