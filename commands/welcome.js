'use strict';

const { handleWelcome } = require('../lib/welcome');
const { isWelcomeOn, getWelcome } = require('../lib/index');
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

// ─── Commande .welcome ───────────────────────────────────────────────────────
async function welcomeCommand(sock, chatId, message, match) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Cette commande ne fonctionne que dans les groupes.' });
        return;
    }
    const text      = message.message?.conversation ||
                      message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');
    await handleWelcome(sock, chatId, message, matchText);
}

// ─── Événement nouveau membre ────────────────────────────────────────────────
async function handleJoinEvent(sock, id, participants) {
    const isWelcomeEnabled = await isWelcomeOn(id);
    if (!isWelcomeEnabled) return;

    const customMessage = await getWelcome(id);

    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch { return; }

    const groupName   = groupMetadata.subject || 'Groupe';
    const groupDesc   = groupMetadata.desc    || '';
    const memberCount = groupMetadata.participants.length;

    for (const participant of participants) {
        try {
            const participantJid = typeof participant === 'string'
                ? participant
                : (participant.id || String(participant));

            // Vrai numéro WhatsApp du nouveau membre
            const senderNum = participantJid.split('@')[0];

            // Message configuré par l'admin (variables supportées : {user}, {group}, {description})
            let adminMsg = customMessage
                ? customMessage
                    .replace(/{user}/gi,        `@${senderNum}`)
                    .replace(/{group}/gi,        groupName)
                    .replace(/{description}/gi,  groupDesc)
                : null;

            const now     = new Date();
            const timeStr = now.toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const welcomeMsg =
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬╭━━━━━━━━━━━━━≽\n` +
                `┃⌬┃ 🎉 *NOUVEAU MEMBRE*\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `┃⌬┃ 👤 Bienvenue @${senderNum}\n` +
                `┃⌬┃ 🏷️ *${groupName}*\n` +
                `┃⌬┃ 👥 Membres : *${memberCount}*\n` +
                `┃⌬┃ ⏰ *${timeStr}*\n` +
                (adminMsg ? `┃⌬┃\n┃⌬┃ 💬 ${adminMsg}\n` : '') +
                `┃⌬┃\n` +
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
                    `https://api.some-random-api.com/welcome/img/2/gaming3` +
                    `?type=join&textcolor=green` +
                    `&username=${encodeURIComponent(senderNum)}` +
                    `&guildName=${encodeURIComponent(groupName)}` +
                    `&memberCount=${memberCount}` +
                    `&avatar=${encodeURIComponent(profilePicUrl)}`;

                const imgRes = await fetch(apiUrl, { timeout: 8000 });
                if (imgRes.ok) {
                    const imgBuf = await imgRes.buffer();
                    await sock.sendMessage(id, {
                        image:    imgBuf,
                        caption:  welcomeMsg,
                        mentions: [participantJid],
                        ...channelInfo
                    });
                    continue;
                }
            } catch { /* fallback texte */ }

            await sock.sendMessage(id, {
                text:     welcomeMsg,
                mentions: [participantJid],
                ...channelInfo
            });

        } catch (err) {
            console.error('[welcome] Erreur :', err.message);
            try {
                const jid = typeof participant === 'string'
                    ? participant : (participant.id || String(participant));
                const num = jid.split('@')[0];
                await sock.sendMessage(id, {
                    text:     `🎉 Bienvenue @${num} dans *${groupMetadata?.subject || 'ce groupe'}* ! 👋`,
                    mentions: [jid],
                    ...channelInfo
                });
            } catch { /* rien */ }
        }
    }
}

module.exports = { welcomeCommand, handleJoinEvent };
