#!/usr/bin/env node
// Cube Hub V2 : hook de projet (PreToolUse / PostToolUse sur les outils MCP).
// Note dans le journal de l'équipe quand Claude utilise Blender ou Roblox Studio,
// pour que le Hub montre qui travaille. Ne bloque jamais Claude (sortie 0, rien sur stdout).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.CUBE_WIDGET_DIR || path.join(os.homedir(), '.cube-widget');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(input || '{}');
    const tool = String(ev.tool_name || '');
    const parts = tool.split('__');
    if (parts[0] !== 'mcp' || parts.length < 3) return;
    const m = [tool, parts[1], parts.slice(2).join('__')];
    const server = m[1].toLowerCase();
    if (server.startsWith('cube-equipe') || server.startsWith('cube_equipe')) return; // déjà noté par le serveur
    const agent = server.includes('blender') ? 'blender' : /roblox|studio/.test(server) ? 'studio' : 'mcp';
    const project = process.argv[2] || process.env.CUBE_HUB_PROJECT || 'sans-projet';
    const input2 = ev.tool_input || {};
    const detail = String(input2.code || input2.command || input2.name || input2.query || input2.path || '').replace(/\s+/g, ' ').slice(0, 140);
    const failed = ev.hook_event_name === 'PostToolUse' && ev.tool_response && (ev.tool_response.isError || ev.tool_response.is_error);
    const status = ev.hook_event_name === 'PreToolUse' ? 'start' : failed ? 'error' : 'ok';
    const id = 'h' + String(ev.tool_use_id || '').slice(-10);
    fs.mkdirSync(path.join(BASE, 'equipe'), { recursive: true });
    fs.appendFileSync(path.join(BASE, 'equipe', `${project}.jsonl`), JSON.stringify({
      t: new Date().toISOString(), project, id, agent, action: m[2], detail, status,
    }) + '\n');
  } catch {
    // Jamais d'erreur visible : c'est un simple témoin.
  }
});
