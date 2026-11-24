# Cube Hub V2 — édition Roblox Studio

Application Electron pour Windows, **inspirée de [Cube Hub](https://github.com/Harlo9/cube-hub) de [Harlo9](https://github.com/Harlo9)** (app macOS, licence MIT). La V1 suivait tes sessions Claude Code (widget, terminaux, Telegram).
La V2 ajoute un **orchestre d'IA pour créer des jeux Roblox** :

| Qui | Rôle | Branché par |
|---|---|---|
| 🎼 **Claude Code** | Chef d'orchestre : plan, architecture, code délicat, vérification | terminal du Hub |
| 🤝 **Codex** | Le second : gros code bien spécifié, refactorisation, tests, 2e avis | outil `codex_delegate` (lance `codex exec`) + onglet Codex |
| ⚡ **LLM local** (optionnel) | Petites tâches gratuites : résumés, noms, données, textes, Luau simple | outil `llm_quick` (Ollama, LM Studio, Open WebUI…) |
| 🎨 **Blender** | Modèles 3D | serveur MCP Blender |
| 🎮 **Roblox Studio** | La place du jeu | serveur MCP de Studio (`%LOCALAPPDATA%\Roblox\mcp.bat`) |
| 🧠 **Cerveau Obsidian** | Mémoire structurée du jeu + savoir partagé entre tous les jeux | outils `brain_*` |

## Lancer

```powershell
npm install
npx electron .
```

## Premier lancement : connexion

Au premier lancement, Cube Hub ouvre l'écran **Connexion de l'équipe** : tu te connectes à **ton compte Claude Code** et à **ton compte Codex** (ChatGPT / OpenAI). Chaque bouton ouvre la commande officielle (installation, puis connexion dans ton navigateur) ; Cube Hub ne voit jamais tes mots de passe et vérifie seulement que c'est fait. Tu peux y revenir dans Réglages → Équipe IA.

## Sur ton téléphone (Réglages → Téléphone)

Tout est désactivé par défaut et protégé par un code secret.

- **🔔 Notifications** : quand une session **attend ta réponse** ou **termine**, ton téléphone reçoit une notification. Au choix **Discord** (un webhook dans un salon privé, fiable sur iPhone) ou **ntfy**. Par défaut seul le nom du projet part, jamais le contenu.
- **📱 Appli web** : une petite appli privée servie par ton PC, avec le même look que le widget de Cube Hub (carte noire, vrai cube, halo, cartes empilées). Tu y vois tes sessions, tu réponds à Claude et tu valides une permission. Ajoute-la à l'écran d'accueil (Safari → Partager → Sur l'écran d'accueil). Répondre est **autorisé projet par projet**, seulement pour les sessions lancées dans Cube Hub, **seulement avec Tailscale** (sinon lecture seule), limité à 5 réponses par minute, et les messages commençant par `!`, `/` ou `#` sont refusés.
- **🧊 Widget iPhone** (écran d'accueil ou verrouillé) avec l'appli **Scriptable** : `phone/cube-widget-iphone.js` montre l'état de chaque session (bleu : bosse, orange : attend ta réponse, vert : terminé), la durée et les tokens. Toucher le widget ouvre l'appli web. iOS rafraîchit les widgets à son rythme : ce n'est pas en direct à la seconde. Sur l'écran verrouillé d'iOS, seuls de petits widgets sont possibles (pas la grande carte).

Avec **Tailscale** (gratuit), l'appli et le widget marchent partout et ne sont pas visibles sur ton Wi-Fi.

## Créer un jeu

Bouton **Nouveau jeu Roblox** (ou Ctrl+N) : nom, genre, pitch. Cube Hub crée :

- le projet **Rojo** (`default.project.json`, `src/server`, `src/client`, `src/shared/Config.luau`) ;
- `CLAUDE.md` (les règles du chef d'orchestre et de délégation) et `AGENTS.md` (les consignes de Codex) ;
- `.mcp.json` (cube-equipe, Blender, Roblox Studio) et `.claude/settings.json` (outils du cerveau autorisés, témoin Blender/Studio) ;
- le cerveau du jeu dans le coffre Obsidian : `Jeux/<jeu>/` (tableau de bord, Game Design, Systèmes, Assets 3D, Décisions, Bugs, Idées, Journal).

Puis Claude démarre avec un brief : il lit le cerveau, te pose ses questions et range les décisions.

Un projet existant peut aussi être transformé (clic droit → **Transformer en jeu Roblox**) : aucun fichier n'est remplacé.

## Les onglets d'un jeu

- **Claude** : la session Claude Code.
- **Codex** : Codex en direct dans le dossier du jeu.
- **Rojo** : `rojo serve` pour synchroniser le code avec Studio.
- **Équipe** : l'orchestre en direct — qui travaille, ce qui a été délégué, les tokens que Claude n'a pas dépensés.

## Réglages → Équipe IA

Coffre Obsidian, droits et modèle de Codex, serveur et modèle du LLM local (bouton Tester), commandes des MCP Blender et Studio.
Les réglages de Codex et du LLM s'appliquent tout de suite (le serveur MCP relit `~/.cube-widget/equipe.json` à chaque appel).

## À installer selon ce que tu veux utiliser

- Claude Code : `irm https://claude.ai/install.ps1 | iex`
- Codex : `npm i -g @openai/codex` puis `codex login`
- LLM local : [Ollama](https://ollama.com) (`ollama pull qwen2.5-coder:7b`) ou LM Studio, ou ton Open WebUI
- Obsidian : [obsidian.md](https://obsidian.md), puis « Ouvrir un dossier comme coffre » → `Documents\Cerveau Roblox`
- Rojo : [rojo.space](https://rojo.space) + son plugin dans Studio
- Blender : un addon serveur MCP (par défaut la commande `uvx blender-mcp`, modifiable)

## Fichiers de la V2

- `src/team/mcp-server.js` — serveur MCP « cube-equipe » (Node seul, sans dépendance), copié dans `~/.cube-widget/bin`
- `src/team/equipe-hook.js` — hook de projet qui note l'activité Blender / Studio
- `src/team/scaffold.js` — création du projet Roblox et du cerveau
- `src/team/detect.js` — détection des outils
- `src/team/activity.js` — lecture du journal de l'équipe (`~/.cube-widget/equipe/<projet>.jsonl`)
- `src/phone.js`, `src/phone-app.html`, `src/push.js`, `src/renderer/phone.js`, `phone/cube-widget-iphone.js` — serveur du téléphone, appli web, notifications Discord / ntfy, page Téléphone et widget iPhone
- `src/renderer/team.js`, `team.css` — onglets, panneau Équipe, assistant, réglages

## Inspiration et crédits

Ce projet s'inspire de **[Cube Hub](https://github.com/Harlo9/cube-hub)** de [Harlo9](https://github.com/Harlo9) (app macOS, licence MIT). L'idée du cube, du widget et du Hub vient de son dépôt ; cette version est une adaptation Windows réalisée par mes soins. Merci à Harlo9 !
