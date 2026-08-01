'use strict';

const { handleGoodbye } = require('../lib/welcome');
const { isGoodByeOn, getGoodbye } = require('../lib/index');
const fetch = require('node-fetch');

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid:   '120363424782348922@newsletter',
            newsletterName:  '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
            serverMessageId: -1
        }
    }
};

// ─── Commande .goodbye ───────────────────────────────────────────────────────
async function goodbyeCommand(sock, chatId, message, match) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Cette commande ne fonctionne que dans les groupes.' });
        return;
    }
    const text      = message.message?.conversation ||
                      message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');
    await handleGoodbye(sock, chatId, message, matchText);
}

// ─── Événement départ d'un membre ────────────────────────────────────────────
async function handleLeaveEvent(sock, id, participants) {
    const isGoodbyeEnabled = await isGoodByeOn(id);
    if (!isGoodbyeEnabled) return;

    const customMessage = await getGoodbye(id);

    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch { return; }

    const groupName   = groupMetadata.subject || 'Groupe';
    const memberCount = groupMetadata.participants.length;

    for (const participant of participants) {
        try {
            const participantJid = typeof participant === 'string'
                ? participant
                : (participant.id || String(participant));

            // Vrai numéro WhatsApp du membre qui part
            const senderNum = participantJid.split('@')[0];

            let adminMsg = customMessage
                ? customMessage
                    .replace(/{user}/gi,  `@${senderNum}`)
                    .replace(/{group}/gi, groupName)
                : null;

            const now     = new Date();
            const timeStr = now.toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const goodbyeMsg =
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬╭━━━━━━━━━━━━━≽\n` +
                `┃⌬┃ 👋 *AU REVOIR*\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `┃⌬┃ 👤 @${senderNum}\n` +
                `┃⌬┃ 🏷️ *${groupName}*\n` +
                `┃⌬┃ 👥 Membres : *${memberCount}*\n` +
                `┃⌬┃ ⏰ *${timeStr}*\n` +
                (adminMsg ? `┃⌬┃\n┃⌬┃ 💬 ${adminMsg}\n` : '') +
                `┃⌬┃\n` +
                `┃⌬┃ 😢 ɪʟ/ᴇʟʟᴇ ᴀ ǫᴜɪᴛᴛé ʟᴇ ɢʀᴏᴜᴘᴇ...\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `\n` +
                `> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`;

            // Tentative image de profil
            try {
                let profilePicUrl = 'https://img.pyrocdn.com/dbKUgahg.png';
                try {
                    const pic = await sock.profilePictureUrl(participantJid, 'image');
                    if (pic) profilePicUrl = pic;
                } catch { /* photo privée */ }

                const apiUrl =
                    `https://api.some-random-api.com/welcome/img/2/gaming1` +
                    `?type=leave&textcolor=red` +
                    `&username=${encodeURIComponent(senderNum)}` +
                    `&guildName=${encodeURIComponent(groupName)}` +
                    `&memberCount=${memberCount}` +
                    `&avatar=${encodeURIComponent(profilePicUrl)}`;

                const imgRes = await fetch(apiUrl, { timeout: 8000 });
                if (imgRes.ok) {
                    const imgBuf = await imgRes.buffer();
                    await sock.sendMessage(id, {
                        image:    imgBuf,
                        caption:  goodbyeMsg,
                        mentions: [participantJid],
                        ...channelInfo
                    });
                    continue;
                }
            } catch { /* fallback texte */ }

            await sock.sendMessage(id, {
                text:     goodbyeMsg,
                mentions: [participantJid],
                ...channelInfo
            });

        } catch (err) {
            console.error('[goodbye] Erreur :', err.message);
            try {
                const jid = typeof participant === 'string'
                    ? participant : (participant.id || String(participant));
                const num = jid.split('@')[0];
                await sock.sendMessage(id, {
                    text:     `👋 Au revoir @${num} ! Tu vas nous manquer...`,
                    mentions: [jid],
                    ...channelInfo
                });
            } catch { /* rien */ }
        }
    }
}

module.exports = { goodbyeCommand, handleLeaveEvent };
