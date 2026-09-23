'use strict';

const fs = require('fs');
const path = require('path');
const { channelInfo } = require('../lib/messageConfig');

const STATE_FILE = path.join(__dirname, '../data/fakeract.json');
const REACTIONS = ['❤️', '👍', '🔥', '😂', '😮', '👏', '🎉', '💯', '😍', '🤯', '🙏', '✨'];
const CHANNEL_LINK = /^(?:https?:\/\/)?(?:www\.)?(?:whatsapp\.com|wa\.me)\/channel\/([^/?#\s]+)\/(\d+)(?:[/?#].*)?$/i;
const pendingReactions = new Set();

function parseChannelLink(value) {
    const match = String(value || '').trim().match(CHANNEL_LINK);
    if (!match) return null;
    return { inviteCode: match[1], serverMessageId: match[2] };
}

function readState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return {};
        const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function writeState(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const temp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, STATE_FILE);
}

function botKey(sock) {
    return String(sock.user?.id || sock.user?.jid || 'default')
        .split(':')[0]
        .split('@')[0];
}

async function send(sock, chatId, message, text) {
    return sock.sendMessage(chatId, { text, ...channelInfo }, message ? { quoted: message } : undefined);
}

async function fakeReactCommand(sock, chatId, message, rawArgs = '') {
    const value = String(rawArgs || '').trim();
    const command = value.toLowerCase();
    const key = botKey(sock);
    const state = readState();

    if (command === 'off') {
        delete state[key];
        writeState(state);
        await send(sock, chatId, message, '✅ Fakeract temps réel désactivé pour ce bot.');
        return;
    }

    if (command === 'status') {
        const current = state[key];
        await send(
            sock,
            chatId,
            message,
            current?.enabled
                ? `📡 Fakeract actif sur ${current.channelJid}.\n🎯 Une réaction par nouvelle publication, avec rotation d’emojis.`
                : 'ℹ️ Fakeract temps réel est désactivé.'
        );
        return;
    }

    const link = value.split(/\s+/)[0];
    const target = parseChannelLink(link);
    if (!target) {
        await sock.sendMessage(chatId, {
            text: '❌ Utilise .fakeract avec un lien de publication de chaîne WhatsApp.\nExemple : .fakeract https://whatsapp.com/channel/XXXX/123\n\nAjoute .fakeract off pour arrêter le suivi.',
            ...channelInfo
        }, { quoted: message });
        return;
    }

    if (typeof sock.newsletterMetadata !== 'function' ||
        typeof sock.newsletterReactMessage !== 'function') {
        await send(sock, chatId, message, '❌ Cette version de Baileys ne prend pas en charge les réactions de chaîne.');
        return;
    }

    try {
        const metadata = await sock.newsletterMetadata('invite', target.inviteCode);
        const newsletterJid = metadata?.id || metadata?.jid;
        if (!newsletterJid) throw new Error('Chaîne introuvable');

        if (typeof sock.subscribeNewsletterUpdates === 'function') {
            try {
                await sock.subscribeNewsletterUpdates(newsletterJid);
            } catch (error) {
                console.warn('[fakeract] abonnement aux mises à jour impossible :', error.message);
            }
        } else if (typeof sock.newsletterFollow === 'function') {
            try {
                await sock.newsletterFollow(newsletterJid);
            } catch (error) {
                console.warn('[fakeract] abonnement à la chaîne impossible :', error.message);
            }
        }

        state[key] = {
            enabled: true,
            inviteCode: target.inviteCode,
            channelJid: newsletterJid,
            nextEmoji: 0,
            configuredAt: Date.now()
        };
        writeState(state);
        await send(
            sock,
            chatId,
            message,
            `✅ Fakeract temps réel activé sur ${newsletterJid}.\n📡 Les nouvelles publications recevront une réaction rotative.\n⚠️ Une seule réaction réelle est envoyée par publication.`
        );
    } catch (error) {
        console.error('[fakeract] réaction impossible :', error.message);
        await send(sock, chatId, message, `❌ Impossible de configurer cette chaîne : ${error.message}`);
    }
}

async function handleChannelPost(sock, message) {
    const remoteJid = message?.key?.remoteJid;
    if (!remoteJid?.endsWith('@newsletter')) return false;

    const key = botKey(sock);
    const state = readState();
    const config = state[key];
    if (!config?.enabled || config.channelJid !== remoteJid) return false;
    if (typeof sock.newsletterReactMessage !== 'function') return false;

    const serverMessageId = String(
        message.key.serverMessageId ||
        message.key.serverId ||
        message.key.server_id ||
        message.message?.messageContextInfo?.serverMessageId ||
        message.message?.messageContextInfo?.serverId ||
        message.message?.newsletterMessage?.serverMessageId ||
        ''
    );
    if (!/^\d+$/.test(serverMessageId)) {
        console.warn('[fakeract] publication reçue sans serverMessageId exploitable');
        return false;
    }

    const eventKey = `${key}:${remoteJid}:${serverMessageId}`;
    if (pendingReactions.has(eventKey) || config.lastMessageId === serverMessageId) return false;
    pendingReactions.add(eventKey);
    try {
        const emoji = REACTIONS[Number(config.nextEmoji || 0) % REACTIONS.length];
        await sock.newsletterReactMessage(remoteJid, serverMessageId, emoji);
        config.lastMessageId = serverMessageId;
        config.nextEmoji = (Number(config.nextEmoji || 0) + 1) % REACTIONS.length;
        state[key] = config;
        writeState(state);
        return true;
    } catch (error) {
        console.error('[fakeract] réaction temps réel impossible :', error.message);
        return false;
    } finally {
        pendingReactions.delete(eventKey);
    }
}

module.exports = fakeReactCommand;
module.exports.handleChannelPost = handleChannelPost;
module.exports.parseChannelLink = parseChannelLink;