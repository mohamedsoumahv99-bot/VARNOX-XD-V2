'use strict';

const fs = require('fs');
const path = require('path');
const { channelInfo } = require('../lib/messageConfig');

const CONFIG_FILE = path.join(__dirname, '../data/fakeract.json');
const DEFAULT_REACTIONS = 30;
const MAX_REACTIONS = 50;
const MIN_REACTIONS = 30;
const REACTION_DELAY_MS = 180;

// WhatsApp remplace généralement la réaction d'un même compte sur une
// publication. Cette liste reste néanmoins sans doublon afin de ne jamais
// envoyer deux fois le même emoji dans une série configurée.
const REACTIONS = [
    '❤️', '👍', '🔥', '😂', '😮', '👏', '🎉', '💯', '😍', '🤯',
    '🙏', '✨', '🥳', '😎', '🤩', '💪', '🙌', '🫶', '🚀', '✅',
    '🌟', '🎯', '💎', '👑', '⚡', '🌈', '🍀', '😇', '🤝', '🫡',
    '🥰', '😘', '🤗', '😱', '🤔', '😢', '😡', '🤭', '😴', '🤤',
    '🆒', '💥', '🌹', '🎊', '🏆', '🛡️', '📌', '🔔', '🧡', '💚'
];
const CHANNEL_LINK = /^(?:https?:\/\/)?(?:www\.)?(?:whatsapp\.com|wa\.me)\/channel\/([^/?#\s]+)(?:\/(\d+))?(?:[/?#].*)?$/i;
const NEWSLETTER_JID = /^\d+@newsletter$/i;
const seenMessages = new Set();
const channelQueues = new Map();

function parseChannelLink(value) {
    const input = String(value || '').trim();
    if (NEWSLETTER_JID.test(input)) {
        return { newsletterJid: input, inviteCode: null, serverMessageId: null };
    }
    const match = input.match(CHANNEL_LINK);
    if (!match) return null;
    return {
        inviteCode: match[1],
        serverMessageId: match[2] || null
    };
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readConfig() {
    try {
        const value = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return value && typeof value === 'object' && value.channels && typeof value.channels === 'object'
            ? value
            : { channels: {} };
    } catch {
        return { channels: {} };
    }
}

function writeConfig(value) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    const tempFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(value, null, 2));
    fs.renameSync(tempFile, CONFIG_FILE);
}

function clampReactionCount(value) {
    const count = Number(value);
    if (!Number.isInteger(count)) return DEFAULT_REACTIONS;
    return Math.min(MAX_REACTIONS, Math.max(MIN_REACTIONS, count));
}

function normalizeServerMessageId(value) {
    const stringValue = String(value || '').trim();
    if (!stringValue) return null;
    // Baileys v7 types server_id as a string. Ne pas convertir les IDs
    // numériques en Number pour éviter un attribut XML mal sérialisé.
    return stringValue;
}

async function resolveNewsletter(sock, inviteCode) {
    if (!inviteCode) throw new Error('Lien ou identifiant de chaîne invalide');
    if (typeof sock.newsletterMetadata !== 'function') {
        throw new Error('Cette version de Baileys ne prend pas en charge les chaînes.');
    }
    const metadata = await sock.newsletterMetadata('invite', inviteCode);
    const rawJid = metadata?.id || metadata?.jid;
    const newsletterJid = rawJid && String(rawJid).endsWith('@newsletter')
        ? String(rawJid)
        : rawJid && /^\d+$/.test(String(rawJid))
            ? `${rawJid}@newsletter`
            : null;
    if (!newsletterJid) {
        throw new Error('Chaîne introuvable');
    }
    return newsletterJid;
}

async function reactToPublication(sock, newsletterJid, serverMessageId, count) {
    if (typeof sock.newsletterReactMessage !== 'function') {
        throw new Error('Cette version de Baileys ne prend pas en charge les réactions de chaîne.');
    }

    const messageId = normalizeServerMessageId(serverMessageId);
    if (!messageId) return 0;

    let sent = 0;
    let failed = 0;
    let lastError = null;
    for (const emoji of REACTIONS.slice(0, count)) {
        try {
            await sock.newsletterReactMessage(newsletterJid, messageId, emoji);
            sent += 1;
        } catch (error) {
            // Une réaction refusée ne doit pas empêcher les autres emojis.
            failed += 1;
            lastError = error;
        }
        await wait(REACTION_DELAY_MS);
    }
    if (failed) {
        console.error(`[fakeract] ${newsletterJid}/${messageId}: ${sent}/${count} réactions acceptées`, lastError?.message || '');
    }
    return sent;
}

async function prepareLiveUpdates(sock, newsletterJid) {
    // Ces appels sont idempotents dans WhatsApp. Ils sont best-effort :
    // l'activation locale doit rester disponible même si une session déjà
    // suivie refuse l'une des requêtes GraphQL.
    const operations = [];
    if (typeof sock.newsletterFollow === 'function') {
        operations.push(Promise.resolve().then(() => sock.newsletterFollow(newsletterJid)));
    }
    if (typeof sock.subscribeNewsletterUpdates === 'function') {
        operations.push(Promise.resolve().then(() => sock.subscribeNewsletterUpdates(newsletterJid)));
    }
    await Promise.allSettled(operations);
}

function queueChannelReaction(sock, newsletterJid, messageId, count) {
    const key = `${newsletterJid}:${messageId}`;
    if (seenMessages.has(key)) return Promise.resolve(0);
    seenMessages.add(key);
    if (seenMessages.size > 1000) {
        seenMessages.delete(seenMessages.values().next().value);
    }

    const previous = channelQueues.get(newsletterJid) || Promise.resolve();
    const task = previous
        .catch(() => {})
        .then(() => reactToPublication(sock, newsletterJid, messageId, count));
    const queuedTask = task.finally(() => {
        if (channelQueues.get(newsletterJid) === queuedTask) channelQueues.delete(newsletterJid);
    });
    channelQueues.set(newsletterJid, queuedTask);
    return task;
}

async function fakeReactCommand(sock, chatId, message, rawArgs = '') {
    const args = String(rawArgs || '').trim().split(/\s+/).filter(Boolean);
    const firstArg = args[0]?.toLowerCase();
    const config = readConfig();

    if (firstArg === 'off' || firstArg === 'on' || firstArg === 'status') {
        const configured = Object.entries(config.channels);
        if (firstArg === 'status') {
            const text = configured.length
                ? configured.map(([jid, value]) => `• ${jid} : ${value.enabled === false ? 'OFF' : 'ON'} (${value.count || DEFAULT_REACTIONS} emojis)`).join('\n')
                : 'Aucune chaîne configurée.';
            await sock.sendMessage(chatId, { text: `📡 *Fakeract*\n${text}`, ...channelInfo }, { quoted: message });
            return;
        }
        const enabled = firstArg === 'on';
        if (!configured.length) {
            await sock.sendMessage(chatId, { text: '❌ Aucune chaîne fakeract à modifier.', ...channelInfo }, { quoted: message });
            return;
        }
        for (const value of Object.values(config.channels)) value.enabled = enabled;
        writeConfig(config);
        await sock.sendMessage(chatId, {
            text: `${enabled ? '✅' : '🔕'} Fakeract ${enabled ? 'activé' : 'désactivé'} sur ${configured.length} chaîne(s).`,
            ...channelInfo
        }, { quoted: message });
        return;
    }

    const link = args[0] || '';
    const target = parseChannelLink(link);
    if (!target) {
        await sock.sendMessage(chatId, {
            text: '❌ Utilise .fakeract avec un lien de chaîne WhatsApp.\nExemple : .fakeract https://whatsapp.com/channel/XXXX 30\nOptions : 30 ou 50 emojis, puis .fakeract off/status.',
            ...channelInfo
        }, { quoted: message });
        return;
    }

    try {
        const newsletterJid = target.newsletterJid || await resolveNewsletter(sock, target.inviteCode);
        const count = clampReactionCount(args[1]);
        config.channels[newsletterJid] = {
            inviteCode: target.inviteCode,
            count,
            enabled: true,
            configuredBy: message.key.participant || message.key.remoteJid,
            updatedAt: new Date().toISOString()
        };
        writeConfig(config);

        await prepareLiveUpdates(sock, newsletterJid);
        const initialText = `✅ Fakeract activé sur ${newsletterJid} avec ${count} emojis différents.\nLes prochaines publications seront traitées automatiquement.\n📡 Suivi temps réel demandé.`;

        await sock.sendMessage(chatId, {
            text: `${initialText}\n⚠️ Plafond de sécurité : ${MAX_REACTIONS} par publication.`,
            ...channelInfo
        }, { quoted: message });
    } catch (error) {
        console.error('[fakeract] réaction impossible :', error.message);
        await sock.sendMessage(chatId, {
            text: `❌ Impossible de réagir à cette publication : ${error.message}`,
            ...channelInfo
        }, { quoted: message });
    }
}

async function handleFakeractChannelMessage(sock, message) {
    const newsletterJid = message?.key?.remoteJid;
    if (!newsletterJid?.endsWith('@newsletter')) return false;

    const config = readConfig();
    const channelConfig = config.channels[newsletterJid];
    if (!channelConfig || channelConfig.enabled === false) return false;

    // Baileys expose l'identifiant serveur des publications de chaîne sur
    // WAMessage.newsletterServerId. key.id est seulement un repli pour les
    // versions/forks qui ne recopient pas ce champ.
    const messageId = message.newsletterServerId ||
        message.message?.newsletterServerId ||
        message.key?.newsletterServerId ||
        message.message?.extendedTextMessage?.contextInfo?.stanzaId ||
        message.message?.conversation?.contextInfo?.stanzaId ||
        message.key.id;
    if (!messageId) return false;

    queueChannelReaction(
        sock,
        newsletterJid,
        messageId,
        clampReactionCount(channelConfig.count)
    ).catch(error => console.error('[fakeract] traitement publication:', error.message));
    return true;
}

module.exports = fakeReactCommand;
module.exports.handleFakeractChannelMessage = handleFakeractChannelMessage;