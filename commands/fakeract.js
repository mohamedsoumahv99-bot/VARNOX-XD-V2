'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_DIR = path.resolve(process.env.SESSION_DIR || path.join(__dirname, '../sessions'));
const STATE_DIR = path.join(SESSION_DIR, 'channel-alerts');
const CHANNEL_LINK = /^(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([^/?#\s]+)(?:\/(\d+))?(?:[/?#].*)?$/i;
const pendingNotifications = new Set();

function parseChannelLink(value) {
    const match = String(value || '').trim().match(CHANNEL_LINK);
    if (!match) return null;
    return { inviteCode: match[1] };
}

function accountNumber(sock) {
    return String(sock?.user?.id || sock?.user?.jid || '')
        .split(':')[0]
        .split('@')[0]
        .replace(/\D/g, '');
}

function accountStatePath(sock) {
    const number = accountNumber(sock);
    if (!number) return null;
    const key = crypto.createHash('sha256').update(number).digest('hex');
    return path.join(STATE_DIR, `${key}.json`);
}

function readState(sock) {
    const file = accountStatePath(sock);
    if (!file) return {};
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) {
        return {};
    }
}

function writeState(sock, state) {
    const file = accountStatePath(sock);
    if (!file) throw new Error('Compte WhatsApp connecté introuvable');
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
}

function ownerJid(sock) {
    const id = String(sock?.user?.id || sock?.user?.jid || '').split(':')[0];
    if (!id) return null;
    return id.includes('@') ? id : `${id.replace(/\D/g, '')}@s.whatsapp.net`;
}

async function replyPrivately(sock, text) {
    const jid = ownerJid(sock);
    if (!jid) throw new Error('Chat privé du compte connecté introuvable');
    return sock.sendMessage(jid, { text });
}

async function fakeReactCommand(sock, _chatId, _message, rawArgs = '') {
    const owner = ownerJid(sock);
    if (!owner) {
        await replyPrivately(sock, '❌ Compte WhatsApp connecté introuvable.');
        return;
    }

    const value = String(rawArgs || '').trim();
    const command = value.toLowerCase();
    const state = readState(sock);

    if (command === 'off') {
        state.enabled = false;
        writeState(sock, state);
        await replyPrivately(sock, '✅ Les notifications de chaîne sont désactivées pour ce compte.');
        return;
    }

    if (command === 'status') {
        await replyPrivately(sock, state.enabled
            ? '📡 Notifications actives pour la chaîne configurée sur ce compte.'
            : 'ℹ️ Aucune notification de chaîne active sur ce compte.');
        return;
    }

    const target = parseChannelLink(value.split(/\s+/)[0]);
    if (!target) {
        await replyPrivately(
            sock,
            'Utilise .channelalert <lien de chaîne WhatsApp> pour activer les notifications privées sur ce compte.\n' +
            'Alias : .fakeract <lien>\n' +
            'Commandes : .channelalert status | .channelalert off'
        );
        return;
    }

    if (typeof sock.newsletterMetadata !== 'function') {
        await replyPrivately(sock, '❌ Cette version de Baileys ne permet pas de vérifier les chaînes WhatsApp.');
        return;
    }

    try {
        const metadata = await sock.newsletterMetadata('invite', target.inviteCode);
        const newsletterJid = metadata?.id || metadata?.jid;
        if (!newsletterJid || !newsletterJid.endsWith('@newsletter')) throw new Error('Chaîne introuvable');
        if (typeof sock.newsletterFollow === 'function') {
            await sock.newsletterFollow(newsletterJid);
        } else if (typeof sock.subscribeNewsletterUpdates === 'function') {
            await sock.subscribeNewsletterUpdates(newsletterJid);
        } else {
            throw new Error('L’abonnement aux chaînes n’est pas pris en charge par cette version de Baileys');
        }

        writeState(sock, {
            enabled: true,
            inviteCode: target.inviteCode,
            channelJid: newsletterJid,
            sentPosts: [],
            configuredAt: Date.now(),
        });
        await replyPrivately(sock, '✅ Notifications activées pour cette chaîne sur ce compte. Chaque nouvelle publication sera signalée dans le privé de ce compte; aucune réaction automatique ne sera envoyée.');
    } catch (error) {
        console.error('[channel-alert] activation impossible :', error.message);
        await replyPrivately(sock, `❌ Impossible d’activer les notifications : ${error.message}`);
    }
}

async function handleChannelPost(sock, message) {
    const remoteJid = message?.key?.remoteJid;
    if (!remoteJid?.endsWith('@newsletter')) return false;

    const config = readState(sock);
    if (!config.enabled || config.channelJid !== remoteJid) return false;

    const serverMessageId = String(
        message.key.serverMessageId ||
        message.key.serverId ||
        message.key.server_id ||
        message.message?.messageContextInfo?.serverMessageId ||
        message.message?.messageContextInfo?.serverId ||
        message.message?.newsletterMessage?.serverMessageId ||
        (/^\d+$/.test(String(message.key.id || '')) ? message.key.id : '') ||
        ''
    );
    const postKey = serverMessageId || String(message.key.id || '');
    if (!postKey) return false;

    const account = accountNumber(sock);
    const eventKey = `${account}:${remoteJid}:${postKey}`;
    if (pendingNotifications.has(eventKey) || (config.sentPosts || []).includes(postKey)) return false;
    pendingNotifications.add(eventKey);
    try {
        const postUrl = `https://whatsapp.com/channel/${config.inviteCode}${/^\d+$/.test(serverMessageId) ? `/${serverMessageId}` : ''}`;
        await replyPrivately(sock, `📢 Nouvelle publication sur la chaîne suivie.\n\nOuvrir : ${postUrl}`);
        config.sentPosts = [...(config.sentPosts || []), postKey].slice(-100);
        writeState(sock, config);
        return true;
    } finally {
        pendingNotifications.delete(eventKey);
    }
}

module.exports = fakeReactCommand;
module.exports.handleChannelPost = handleChannelPost;
module.exports.parseChannelLink = parseChannelLink;