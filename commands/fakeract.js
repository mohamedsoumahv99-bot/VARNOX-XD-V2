'use strict';

const { channelInfo } = require('../lib/messageConfig');

// Réaction de test bornée : une commande ne doit pas générer une rafale
// de centaines de requêtes vers WhatsApp.
const MAX_REACTIONS = 12;
const REACTIONS = ['❤️', '👍', '🔥', '😂', '😮', '👏', '🎉', '💯', '😍', '🤯', '🙏', '✨'];
const CHANNEL_LINK = /^(?:https?:\/\/)?(?:www\.)?(?:whatsapp\.com|wa\.me)\/channel\/([^/?#\s]+)\/(\d+)(?:[/?#].*)?$/i;

function parseChannelLink(value) {
    const match = String(value || '').trim().match(CHANNEL_LINK);
    if (!match) return null;
    return { inviteCode: match[1], serverMessageId: Number(match[2]) };
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fakeReactCommand(sock, chatId, message, rawArgs = '') {
    const link = String(rawArgs || '').trim().split(/\s+/)[0];
    const target = parseChannelLink(link);
    if (!target) {
        await sock.sendMessage(chatId, {
            text: '❌ Utilise .fakeract avec un lien de publication de chaîne WhatsApp.\nExemple : .fakeract https://whatsapp.com/channel/XXXX/123',
            ...channelInfo
        }, { quoted: message });
        return;
    }

    if (typeof sock.newsletterMetadata !== 'function' ||
        typeof sock.newsletterReactMessage !== 'function') {
        await sock.sendMessage(chatId, {
            text: '❌ Cette version de Baileys ne prend pas en charge les réactions de chaîne.',
            ...channelInfo
        }, { quoted: message });
        return;
    }

    try {
        const metadata = await sock.newsletterMetadata('invite', target.inviteCode);
        const newsletterJid = metadata?.id || metadata?.jid;
        if (!newsletterJid) throw new Error('Chaîne introuvable');

        let sent = 0;
        for (const emoji of REACTIONS.slice(0, MAX_REACTIONS)) {
            await sock.newsletterReactMessage(newsletterJid, target.serverMessageId, emoji);
            sent += 1;
            await wait(350);
        }

        await sock.sendMessage(chatId, {
            text: `✅ Test fakeract terminé : ${sent} réaction(s) envoyée(s) avec des emojis différents.\n⚠️ Limite de sécurité : ${MAX_REACTIONS}, pas de rafale de 1 000 requêtes.`,
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

module.exports = fakeReactCommand;