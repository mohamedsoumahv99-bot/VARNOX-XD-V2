'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const CHANNEL_JID = '120363424782348922@newsletter';
const CHANNEL_NAME = '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2';

function channelInfo() {
    return {
        contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: CHANNEL_JID,
                newsletterName: CHANNEL_NAME,
                serverMessageId: -1
            }
        }
    };
}

function normalizeJid(value) {
    return String(value || '').split(':')[0].split('@')[0];
}

function participantJid(participant) {
    return typeof participant === 'string'
        ? participant
        : (participant?.id || String(participant));
}

function ordinal(number) {
    const value = Number(number) || 0;
    const lastTwo = value % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
    switch (value % 10) {
        case 1: return `${value}st`;
        case 2: return `${value}nd`;
        case 3: return `${value}rd`;
        default: return `${value}th`;
    }
}

function memberCountAfterLeave(participants, leavingJid) {
    const list = Array.isArray(participants) ? participants : [];
    const stillListed = list.some((participant) => (
        normalizeJid(participant?.id || participant) === normalizeJid(leavingJid)
    ));
    return Math.max(0, list.length - (stillListed ? 1 : 0));
}

async function profilePhotoBuffer(sock, jid) {
    try {
        const url = await sock.profilePictureUrl(jid, 'image');
        const response = await fetch(url, { timeout: 10000 });
        if (response.ok) return response.buffer();
    } catch (error) {
        console.warn(`[member-event] profile photo unavailable: ${error.message}`);
    }

    // Utiliser l'image du menu comme fallback demandé par la configuration
    // visuelle du bot, puis l'image historique si elle existe.
    for (const file of ['../assets/menu-style.jpg', '../assets/bot_image.jpg']) {
        try {
            return fs.readFileSync(path.join(__dirname, file));
        } catch {
            // essayer le fallback suivant
        }
    }
    return null;
}

async function sendMemberEvent(sock, groupId, jid, caption) {
    const media = await profilePhotoBuffer(sock, jid);
    const payload = {
        caption,
        mentions: [jid],
        ...channelInfo()
    };

    if (media) {
        await sock.sendMessage(groupId, { image: media, ...payload });
        return;
    }

    await sock.sendMessage(groupId, {
        text: caption,
        mentions: [jid],
        ...channelInfo()
    });
}

module.exports = {
    channelInfo,
    memberCountAfterLeave,
    ordinal,
    participantJid,
    sendMemberEvent
};