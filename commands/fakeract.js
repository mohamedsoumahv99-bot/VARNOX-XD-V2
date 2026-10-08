'use strict';

const fs = require('fs');
const path = require('path');
const { channelInfo } = require('../lib/messageConfig');

const STATE_FILE = process.env.FAKERACT_STATE_FILE ||
    path.join(process.env.SESSION_DIR || path.join(__dirname, '../sessions'), 'fakeract.json');
const REACTIONS = ['❤️', '👍', '🔥', '😂', '😮', '👏', '🎉', '💯', '😍', '🤯', '🙏', '✨'];
const CHANNEL_LINK = /^(?:https?:\/\/)?(?:www\.)?(?:whatsapp\.com|wa\.me)\/channel\/([^/?#\s]+)\/(\d+)(?:[/?#].*)?$/i;
const pendingReactions = new Set();
const subscriptionTimers = new Map();

function subscriptionKey(accountNumber, newsletterJid) {
    return `${accountNumber}:${newsletterJid}`;
}

function scheduleSubscriptionRenewal(sock, accountNumber, newsletterJid, durationSeconds) {
    const key = subscriptionKey(accountNumber, newsletterJid);
    const previous = subscriptionTimers.get(key);
    if (previous) clearTimeout(previous);

    const delay = Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.max(60_000, Math.floor(durationSeconds * 1000 * 0.8))
        : 10 * 60_000;
    const timer = setTimeout(async () => {
        subscriptionTimers.delete(key);
        const config = readState().global;
        if (!config?.enabled ||
            config.channelJid !== newsletterJid ||
            String(config.accountNumber) !== String(accountNumber)) return;
        try {
            await followChannel(sock, newsletterJid, accountNumber);
        } catch (error) {
            console.warn('[fakeract] renouvellement de l’abonnement impossible :', error.message);
            scheduleSubscriptionRenewal(sock, accountNumber, newsletterJid, 60);
        }
    }, delay);
    timer.unref?.();
    subscriptionTimers.set(key, timer);
}

async function followChannel(sock, newsletterJid, accountNumber = botKey(sock)) {
    if (!sock || !newsletterJid) throw new Error('Socket ou identifiant de chaîne absent.');
    if (typeof sock.newsletterFollow !== 'function' ||
        typeof sock.subscribeNewsletterUpdates !== 'function') {
        throw new Error('Cette version de Baileys ne sait pas suivre les mises à jour en direct des chaînes.');
    }
    await sock.newsletterFollow(newsletterJid);
    const result = await sock.subscribeNewsletterUpdates(newsletterJid);
    const durationSeconds = Number(result?.duration);
    scheduleSubscriptionRenewal(sock, accountNumber, newsletterJid, durationSeconds);
}

function clearSubscriptionTimers() {
    for (const timer of subscriptionTimers.values()) clearTimeout(timer);
    subscriptionTimers.clear();
}

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

async function resumeChannelSubscription(sock, accountNumber = botKey(sock)) {
    const config = readState().global;
    if (!config?.enabled || !config.channelJid || String(config.accountNumber) !== String(accountNumber)) return false;
    try {
        await followChannel(sock, config.channelJid);
        return true;
    } catch (error) {
        console.warn('[fakeract] reprise de l’abonnement impossible :', error.message);
        return false;
    }
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
    const state = readState();

    if (command === 'off') {
        state.global = { enabled: false, disabledAll: true };
        clearSubscriptionTimers();
        writeState(state);
        await send(sock, chatId, message, '✅ Fakeract désactivé.');
        return;
    }

    if (command === 'status') {
        const current = state.global?.enabled ? state.global : null;
        await send(
            sock,
            chatId,
            message,
            current?.enabled
                ? `📡 Fakeract actif sur ${current.channelJid}.\n🤖 Compte configuré : ${current.accountNumber}.\n✅ Une réaction par nouvelle publication.`
                : 'ℹ️ Fakeract temps réel est désactivé.'
        );
        return;
    }

    const pieces = value.split(/\s+/).filter(Boolean);
    const link = pieces.find(piece => parseChannelLink(piece));
    const target = parseChannelLink(link);
    if (!target) {
        await sock.sendMessage(chatId, {
            text: '❌ Utilise .fakeract avec un lien de publication de chaîne WhatsApp.\nExemple : .fakeract https://whatsapp.com/channel/XXXX/123\n\nUne seule réaction est envoyée par publication. Ajoute .fakeract off pour arrêter le suivi.',
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

        clearSubscriptionTimers();
        await followChannel(sock, newsletterJid, botKey(sock));

        state.global = {
            enabled: true,
            inviteCode: target.inviteCode,
            channelJid: newsletterJid,
            accountNumber: botKey(sock),
            nextEmoji: 0,
            reactedPosts: {},
            configuredAt: Date.now()
        };
        writeState(state);
        await send(
            sock,
            chatId,
            message,
            `✅ Fakeract activé sur ${newsletterJid}.\n📡 Le compte ${botKey(sock)} suivra les nouvelles publications en temps réel.\n✅ Une réaction avec un emoji varié par publication.`
        );
    } catch (error) {
        console.error('[fakeract] réaction impossible :', error.message);
        await send(sock, chatId, message, `❌ Impossible de configurer cette chaîne : ${error.message}`);
    }
}

async function handleChannelPost(sock, message) {
    const remoteJid = message?.key?.remoteJid;
    if (!remoteJid?.endsWith('@newsletter')) return false;

    const state = readState();
    const config = state.global;
    if (!config?.enabled || config.channelJid !== remoteJid || String(config.accountNumber) !== botKey(sock)) return false;
    if (typeof sock.newsletterReactMessage !== 'function') return false;

    const serverMessageId = String(
        message.key.server_id ||
        message.key.serverMessageId ||
        message.key.serverId ||
        message.key.id ||
        message.message?.messageContextInfo?.serverMessageId ||
        message.message?.messageContextInfo?.serverId ||
        message.message?.newsletterMessage?.serverMessageId ||
        ''
    );
    if (!/^\d+$/.test(serverMessageId)) {
        console.warn('[fakeract] publication reçue sans serverMessageId exploitable');
        return false;
    }

    const eventKey = `${remoteJid}:${serverMessageId}`;
    if (pendingReactions.has(eventKey) || config.lastMessageId === serverMessageId) return false;
    pendingReactions.add(eventKey);
    try {
        if (!config.reactedPosts || typeof config.reactedPosts !== 'object') config.reactedPosts = {};
        if (config.reactedPosts[serverMessageId]) return false;
        const emoji = REACTIONS[Number(config.nextEmoji || 0) % REACTIONS.length];
        await sock.newsletterReactMessage(remoteJid, serverMessageId, emoji);
        config.reactedPosts[serverMessageId] = { emoji, accountNumber: botKey(sock), reactedAt: Date.now() };
        config.nextEmoji = (Number(config.nextEmoji || 0) + 1) % REACTIONS.length;
        const postIds = Object.keys(config.reactedPosts);
        for (const oldId of postIds.slice(0, -50)) delete config.reactedPosts[oldId];
        state.global = config;
        writeState(state);
        return true;
    } catch (error) {
        console.error('[fakeract] réaction impossible :', error.message);
        return false;
    } finally {
        pendingReactions.delete(eventKey);
    }
}

module.exports = fakeReactCommand;
module.exports.handleChannelPost = handleChannelPost;
module.exports.parseChannelLink = parseChannelLink;
module.exports.resumeChannelSubscription = resumeChannelSubscription;