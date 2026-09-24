'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../data/sessionSettings.json');
function normalize(value) { return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, ''); }
function commandName(value) { return String(value || '').replace(/^\./, '').trim().toLowerCase(); }
function readAll() { try { const value = JSON.parse(fs.readFileSync(FILE, 'utf8')); return value && typeof value === 'object' ? value : {}; } catch (_) { return {}; } }
function writeAll(value) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const temp = FILE + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, FILE); }
function getSessionSettings(sessionNumber) { const key = normalize(sessionNumber) || 'default'; const all = readAll(); const value = all[key] && typeof all[key] === 'object' ? all[key] : {}; return { disabledCommands: Array.isArray(value.disabledCommands) ? value.disabledCommands.map(commandName).filter(Boolean) : [] }; }
function setCommandEnabled(sessionNumber, command, enabled) { const key = normalize(sessionNumber) || 'default'; const all = readAll(); const current = getSessionSettings(key); const name = commandName(command); current.disabledCommands = current.disabledCommands.filter(item => item !== name); if (!enabled && name) current.disabledCommands.push(name); all[key] = current; writeAll(all); return current; }
function isCommandEnabled(sessionNumber, command) { return !getSessionSettings(sessionNumber).disabledCommands.includes(commandName(command)); }
module.exports = { normalize, getSessionSettings, setCommandEnabled, isCommandEnabled };
