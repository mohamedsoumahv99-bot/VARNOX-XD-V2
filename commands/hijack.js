'use strict';

const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');
const { channelInfo } = require('../lib/messageConfig');

const STATE_FILE = path.join(__dirname, '../data/hijack.json');
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MESSAGE = '🛑 𝗛𝗜𝗝𝗔𝗖𝗞 𝗔𝗖𝗧𝗜𝗩𝗘\n🔐 Groupe temporairement verrouillé.\n⚡ Contrôle : 𝗩꯭𝗔꯭𝗥꯭𝗡꯭𝗢꯭𝗫꯭͡ 𝗫꯭𝗧꯭𝗘꯭𝗖꯭𝗛꯭͡\n🛡️ Mode sécurité activé.';
const expiryTimers = new Map();

function ensureStateFile() {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '{}');
}

function readState() {
    ensureStateFile();
    try {
        const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return value && typeof value === 'object' ? value : {};
    } catch (error) {
        console.error('[hijack] lecture impossible :', error.message);
        return {};
    }
}

function writeState(state) {
    ensureStateFile();
    const temp = STATE_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, STATE_FILE);
}

function getRecord(state, chatId) {
    const existing = state[chatId] && typeof state[chatId] === 'object' ? state[chatId] : {};
    return {
        enabled: Boolean(existing.enabled),
        until: Number.isFinite(existing.until) && existing.until > 0 ? existing.until : null,
        message: typeof existing.message === 'string' && existing.message.trim() ? existing.message : DEFAULT_MESSAGE
    };
}

async function send(sock, chatId, message, text) {
    return sock.sendMessage(chatId, { text, ...channelInfo }, message ? { quoted: message } : undefined);
}

function clearExpiry(chatId) {
    const timer = expiryTimers.get(chatId);
    if (timer) clearTimeout(timer);
    expiryTimers.delete(chatId);
}

function scheduleExpiry(sock, chatId, until) {
    clearExpiry(chatId);
    if (!until) return;
    const wait = Math.max(0, Math.min(until - Date.now(), 2147483647));
    const timer = setTimeout(async () => {
        expiryTimers.delete(chatId);
        if (Date.now() < until) return scheduleExpiry(sock, chatId, until);
        await expireHijack(sock, chatId);
    }, wait);
    expiryTimers.set(chatId, timer);
}

async function expireHijack(sock, chatId) {
    const state = readState();
    const record = getRecord(state, chatId);
    if (!record.enabled || !record.until || record.until > Date.now()) {
        if (record.enabled && record.until) scheduleExpiry(sock, chatId, record.until);
        return;
    }
    try {
        await sock.groupSettingUpdate(chatId, 'not_announcement');
    } catch (error) {
        console.error('[hijack] déverrouillage automatique impossible :', error.message);
        scheduleExpiry(sock, chatId, Date.now() + 10000);
        return;
    }
    record.enabled = false;
    record.until = null;
    state[chatId] = record;
    writeState(state);
    await send(sock, chatId, null, '🔓 HIJACK terminé. Le groupe est de nouveau ouvert.');
}

function parseDuration(value) {
    const match = String(value || '').trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;
    const amount = Number(match[1]);
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const duration = amount * multipliers[match[2]];
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > MAX_DURATION_MS) return null;
    return duration;
}

function formatDuration(ms) {
    const seconds = Math.ceil(ms / 1000);
    if (seconds % 86400 === 0) return Math.round(seconds / 86400) + 'j';
    if (seconds % 3600 === 0) return Math.round(seconds / 3600) + 'h';
    if (seconds % 60 === 0) return Math.round(seconds / 60) + 'min';
    return seconds + 's';
}

async function requirePermissions(sock, chatId, message, owner) {
    const senderId = message.key.participant || message.key.remoteJid;
    const status = await isAdmin(sock, chatId, senderId);
    if (!owner && !status.isSenderAdmin) {
        await send(sock, chatId, message, '❌ Cette commande est réservée aux admins.');
        return null;
    }
    if (!status.isBotAdmin) {
        await send(sock, chatId, message, '❌ Le bot doit être admin avant d’utiliser HIJACK.');
        return null;
    }
    return status;
}

function usage() {
    return '🛡️ *HIJACK*\n' +
        '• .hijack — verrouiller le groupe\n' +
        '• .hijack 10m / 1h — verrouiller temporairement\n' +
        '• .hijack status — voir l’état\n' +
        '• .hijack set message — définir le message du groupe\n' +
        '• .hijack reset — remettre le message par défaut\n' +
        '• .hijack off — désactiver et déverrouiller';
}

async function handleHijackCommand(sock, chatId, message, args = [], owner = false) {
    if (!chatId.endsWith('@g.us')) {
        await send(sock, chatId, message, '❌ Cette commande fonctionne uniquement dans les groupes.');
        return true;
    }
    if (!await requirePermissions(sock, chatId, message, owner)) return true;

    const state = readState();
    const record = getRecord(state, chatId);
    const action = String(args[0] || '').trim().toLowerCase();

    if (record.enabled && record.until && record.until <= Date.now()) {
        await expireHijack(sock, chatId);
    } else if (record.enabled && record.until) {
        scheduleExpiry(sock, chatId, record.until);
    }

    if (action === 'status') {
        const current = getRecord(readState(), chatId);
        const remaining = current.enabled && current.until ? '\n⏱️ Temps restant : ' + formatDuration(current.until - Date.now()) : '';
        await send(sock, chatId, message, current.enabled
            ? '🛡️ HIJACK : *ACTIF*\n🔐 Groupe verrouillé.' + remaining
            : '🛡️ HIJACK : *INACTIF*\n🔓 Groupe ouvert.');
        return true;
    }

    if (action === 'off') {
        try {
            await sock.groupSettingUpdate(chatId, 'not_announcement');
        } catch (error) {
            console.error('[hijack] déverrouillage impossible :', error.message);
            await send(sock, chatId, message, '❌ Impossible de déverrouiller le groupe.');
            return true;
        }
        clearExpiry(chatId);
        record.enabled = false;
        record.until = null;
        state[chatId] = record;
        writeState(state);
        await send(sock, chatId, message, '✅ HIJACK désactivé. Le groupe est de nouveau ouvert.');
        return true;
    }

    if (action === 'set') {
        const customMessage = args.slice(1).join(' ').trim();
        if (!customMessage) {
            await send(sock, chatId, message, '❌ Utilise : .hijack set Ton message personnalisé');
            return true;
        }
        record.message = customMessage;
        state[chatId] = record;
        writeState(state);
        await send(sock, chatId, message, '✅ Message HIJACK enregistré pour ce groupe.');
        return true;
    }

    if (action === 'reset') {
        record.message = DEFAULT_MESSAGE;
        state[chatId] = record;
        writeState(state);
        await send(sock, chatId, message, '✅ Message HIJACK remis par défaut.');
        return true;
    }

    const duration = action ? parseDuration(action) : null;
    if (action && !duration) {
        await send(sock, chatId, message, usage());
        return true;
    }

    try {
        await sock.groupSettingUpdate(chatId, 'announcement');
    } catch (error) {
        console.error('[hijack] verrouillage impossible :', error.message);
        await send(sock, chatId, message, '❌ Impossible de verrouiller le groupe.');
        return true;
    }

    clearExpiry(chatId);
    record.enabled = true;
    record.until = duration ? Date.now() + duration : null;
    state[chatId] = record;
    writeState(state);
    if (record.until) scheduleExpiry(sock, chatId, record.until);

    await send(sock, chatId, message, record.message);
    if (duration) await send(sock, chatId, message, '⏱️ HIJACK actif pendant *' + formatDuration(duration) + '*.');
    return true;
}

function restoreHijackTimers(sock) {
    const state = readState();
    for (const chatId of Object.keys(state)) {
        const record = getRecord(state, chatId);
        if (!record.enabled || !record.until) continue;
        if (record.until <= Date.now()) expireHijack(sock, chatId).catch(error => console.error('[hijack] restauration impossible :', error.message));
        else scheduleExpiry(sock, chatId, record.until);
    }
}

module.exports = { DEFAULT_MESSAGE, handleHijackCommand, restoreHijackTimers };
