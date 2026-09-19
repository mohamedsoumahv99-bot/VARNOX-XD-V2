'use strict';
const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');
const {channelInfo} = require('../lib/messageConfig');
const STATE_FILE = path.join(__dirname, '../data/groupAnti.json');
const defaults = {antiflood:{enabled:false,limit:5,windowMs:10000},antispam:{enabled:false,repeatLimit:3,windowMs:20000},antimedia:{enabled:false},antisticker:{enabled:false},antivoice:{enabled:false}};
const recentFlood = new Map();
const recentSpam = new Map();
const warningCooldown = new Map();

function readState() {
    try { if (!fs.existsSync(STATE_FILE)) return {}; return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; }
    catch (error) { console.error('[group-anti] lecture impossible:', error.message); return {}; }
}
function writeState(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), {recursive:true});
    const temp = STATE_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, STATE_FILE);
}
function getText(message) {
    return (message?.message?.conversation || message?.message?.extendedTextMessage?.text || message?.message?.imageMessage?.caption || message?.message?.videoMessage?.caption || '').trim().toLowerCase();
}
function getFeature(state, feature, chatId) {
    return Object.assign({}, defaults[feature] || {}, state[feature]?.[chatId] || {});
}
async function send(sock, chatId, message, text, mentions = []) {
    await sock.sendMessage(chatId, Object.assign({text}, channelInfo, mentions.length ? {mentions} : {}), {quoted:message});
}
async function groupAntiCommand(sock, chatId, message, args = [], feature, senderIsAdmin) {
    if (!chatId.endsWith('@g.us')) return send(sock, chatId, message, '❌ Cette commande fonctionne uniquement dans les groupes.');
    if (!senderIsAdmin) return send(sock, chatId, message, '❌ Seuls les administrateurs peuvent configurer cette protection.');
    const state = readState();
    if (!state[feature]) state[feature] = {};
    const current = getFeature(state, feature, chatId);
    const action = String(args[0] || 'status').toLowerCase();
    if (action === 'on' || action === 'off') {
        current.enabled = action === 'on';
        if (feature === 'antiflood' && /^\d+$/.test(args[1] || '')) current.limit = Math.max(2, Math.min(30, Number(args[1])));
        state[feature][chatId] = current; writeState(state);
        return send(sock, chatId, message, `╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗡𝗧𝗜⟫──╮\n┃⌬┃ ${current.enabled ? '✅' : '❌'} ${feature} ${current.enabled ? 'activé' : 'désactivé'}.\n┃⌬┃ Configuration enregistrée pour ce groupe.\n╰━━━━━━━━━━━━❍`);
    }
    if (action === 'limit' && feature === 'antiflood' && /^\d+$/.test(args[1] || '')) {
        current.limit = Math.max(2, Math.min(30, Number(args[1]))); state[feature][chatId] = current; writeState(state);
        return send(sock, chatId, message, '✅ VARNOX antiflood : ' + current.limit + ' messages sur 10 secondes.');
    }
    const extra = feature === 'antiflood' ? '\n┃⌬┃ .antiflood limit 8' : '';
    return send(sock, chatId, message, '╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 ' + feature.toUpperCase() + '⟫──╮\n┃⌬┃ Statut : ' + (current.enabled ? '✅ Activé' : '❌ Désactivé') + '\n┃⌬┃ .' + feature + ' on\n┃⌬┃ .' + feature + ' off\n┃⌬┃ .' + feature + ' status' + extra + '\n╰━━━━━━━━━━━━❍');
}
async function warnAndDelete(sock, chatId, message, senderId, rule) {
    try { await sock.sendMessage(chatId, {delete:message.key}); } catch (error) { console.error('[group-anti] suppression:', error.message); }
    const key = chatId + ':' + senderId + ':' + rule; const now = Date.now();
    if ((warningCooldown.get(key) || 0) > now) return true;
    warningCooldown.set(key, now + 15000);
    try { await send(sock, chatId, message, '🛡️ @' + senderId.split('@')[0] + ' : message bloqué par ' + rule + '.', [senderId]); } catch (error) {}
    return true;
}
function mediaKind(message) {
    const m = message?.message || {};
    if (m.stickerMessage) return 'sticker';
    if (m.audioMessage?.ptt) return 'voice';
    if (m.audioMessage) return 'audio';
    if (m.imageMessage || m.videoMessage || m.documentMessage) return 'media';
    return '';
}
async function handleGroupAnti(sock, chatId, message, senderId) {
    if (!chatId.endsWith('@g.us') || message.key.fromMe) return false;
    const state = readState();
    const active = Object.keys(defaults).filter(feature => getFeature(state, feature, chatId).enabled);
    if (!active.length) return false;
    let admin = false;
    try { admin = Boolean((await isAdmin(sock, chatId, senderId))?.isSenderAdmin); } catch (error) {}
    if (admin) return false;
    const kind = mediaKind(message);
    if (active.includes('antimedia') && kind) return warnAndDelete(sock, chatId, message, senderId, 'antimedia');
    if (kind === 'sticker' && active.includes('antisticker')) return warnAndDelete(sock, chatId, message, senderId, 'antisticker');
    if (kind === 'voice' && active.includes('antivoice')) return warnAndDelete(sock, chatId, message, senderId, 'antivoice');
    const now = Date.now();
    const floodConfig = getFeature(state, 'antiflood', chatId);
    if (active.includes('antiflood')) {
        const key = chatId + ':' + senderId;
        const entries = (recentFlood.get(key) || []).filter(time => now - time < floodConfig.windowMs);
        entries.push(now); recentFlood.set(key, entries);
        if (entries.length > floodConfig.limit) return warnAndDelete(sock, chatId, message, senderId, 'antiflood');
    }
    const spamConfig = getFeature(state, 'antispam', chatId);
    const text = getText(message);
    if (active.includes('antispam') && text) {
        const key = chatId + ':' + senderId;
        const entries = (recentSpam.get(key) || []).filter(item => now - item.time < spamConfig.windowMs);
        entries.push({text, time:now}); recentSpam.set(key, entries);
        if (entries.filter(item => item.text === text).length >= spamConfig.repeatLimit) return warnAndDelete(sock, chatId, message, senderId, 'antispam');
    }
    return false;
}
module.exports = {groupAntiCommand, handleGroupAnti};
