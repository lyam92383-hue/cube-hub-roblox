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

- **🔔 Notifications** : quand une session **attend ta réponse** ou **termine**, ton iPhone reçoit une notification, même loin du PC. Elles passent par **ntfy** (appli gratuite, serveur ntfy.sh ou le tien) : installe ntfy, abonne-toi au sujet secret affiché dans Cube Hub. Par défaut seul le nom du projet part, jamais le contenu.
- **🧊 Widget des sessions** (écran d'accueil ou verrouillé) avec l'appli **Scriptable** : `phone/cube-widget-iphone.js` montre l'état de chaque session (bleu : bosse, orange : attend ta réponse, vert : terminé), la durée et les tokens. Cube Hub ouvre pour cela un petit serveur en lecture seule, **désactivé par défaut** et protégé par un code secret. Avec **Tailscale** (gratuit), il marche partout et n'est pas visible sur ton Wi-Fi. iOS rafraîchit les widgets à son rythme : ce n'est pas en direct à la seconde.

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
- `src/phone.js`, `src/push.js`, `src/renderer/phone.js`, `phone/cube-widget-iphone.js` — serveur du widget, notifications ntfy, page Téléphone et widget iPhone
- `src/renderer/team.js`, `team.css` — onglets, panneau Équipe, assistant, réglages

## Inspiration et crédits

Ce projet s'inspire de **[Cube Hub](https://github.com/Harlo9/cube-hub)** de [Harlo9](https://github.com/Harlo9) (app macOS, licence MIT). L'idée du cube, du widget et du Hub vient de son dépôt ; cette version est une adaptation Windows réalisée par mes soins. Merci à Harlo9 !
