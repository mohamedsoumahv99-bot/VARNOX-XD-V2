'use strict';

const { handleWelcome } = require('../lib/welcome');
const { isWelcomeOn, getWelcome } = require('../lib/index');
const fetch = require('node-fetch');

// Newsletter forward info - chaîne VARNOX XD V2
const NEWSLETTER_JID  = '120363424782348922@newsletter';
const NEWSLETTER_NAME = '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2';

const newsletterForward = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: NEWSLETTER_JID,
            newsletterName: NEWSLETTER_NAME,
            serverMessageId: -1
        }
    }
};

// ─── Commande .welcome ───────────────────────────────────────────────────────
async function welcomeCommand(sock, chatId, message, match) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...newsletterForward
        }, { quoted: message });
        return;
    }

    const text = message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');

    await handleWelcome(sock, chatId, message, matchText);
}

// ─── Événement d'arrivée d'un nouveau membre ─────────────────────────────────
async function handleJoinEvent(sock, id, participants) {
    // Vérifier si le welcome est activé
    const isWelcomeEnabled = await isWelcomeOn(id);
    if (!isWelcomeEnabled) return;

    // Message personnalisé configuré par l'admin
    const customMessage = await getWelcome(id);

    // Métadonnées du groupe
    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch {
        return; // Impossible de récupérer le groupe
    }
    const groupName  = groupMetadata.subject || 'Groupe';
    const groupDesc  = groupMetadata.desc   || '';
    const memberCount = groupMetadata.participants.length;

    for (const participant of participants) {
        try {
            // ── Numéro réel du nouveau membre ──────────────────────────────
            const participantJid = typeof participant === 'string'
                ? participant
                : (participant.id || String(participant));

            const senderNum = participantJid.split('@')[0]; // ex: 224XXXXXXXXX

            // ── Construction du message final ─────────────────────────────
            // Le bot affiche toujours : Bienvenue @<numéro réel>
            // puis le message configuré par l'admin (ou le message par défaut)

            let adminMessage;
            if (customMessage) {
                // Variables disponibles pour l'admin : {user}, {group}, {description}
                adminMessage = customMessage
                    .replace(/{user}/gi,        `@${senderNum}`)
                    .replace(/{group}/gi,        groupName)
                    .replace(/{description}/gi,  groupDesc);
            }

            // Horodatage
            const now = new Date();
            const timeStr = now.toLocaleString('fr-FR', {
                day:    '2-digit',
                month:  '2-digit',
                year:   'numeric',
                hour:   '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // En-tête toujours affiché
            const header =
                `╭━━━━⌜ 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2 ⌟━━━━╮\n` +
                `┃  🎉 𝗡𝗢𝗨𝗩𝗘𝗔𝗨 𝗠𝗘𝗠𝗕𝗥𝗘 🎉\n` +
                `┃\n` +
                `┃  👤 *Bienvenue* @${senderNum}\n` +
                `┃  🏷️ Groupe : *${groupName}*\n` +
                `┃  👥 Membres : *${memberCount}*\n` +
                `┃  ⏰ Heure   : *${timeStr}*\n` +
                `┃\n`;

            const footer =
                `\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n` +
                `> ©2026 ᴠᴀʀɴᴏx xᴅ ᴠ2 ᴅᴇᴠ ʙʏ ᴠᴀʀɴᴏx ᴛᴇᴄʜ`;

            const body = adminMessage
                ? `${header}┃  💬 *Message :*\n┃  ${adminMessage}${footer}`
                : `${header}┃  ${groupDesc ? `📋 *Description :*\n┃  ${groupDesc}\n┃` : ''}${footer}`;

            // ── Tentative d'envoi avec image de profil ────────────────────
            try {
                let profilePicUrl = 'https://img.pyrocdn.com/dbKUgahg.png';
                try {
                    const pic = await sock.profilePictureUrl(participantJid, 'image');
                    if (pic) profilePicUrl = pic;
                } catch { /* photo privée → avatar par défaut */ }

                // Image de bienvenue via API
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
                        caption:  body,
                        mentions: [participantJid],
                        ...newsletterForward
                    });
                    continue;
                }
            } catch { /* fallback texte */ }

            // ── Fallback texte ────────────────────────────────────────────
            await sock.sendMessage(id, {
                text:     body,
                mentions: [participantJid],
                ...newsletterForward
            });

        } catch (err) {
            console.error('[welcome] Erreur pour', participant, ':', err.message);
            // Fallback minimal garanti
            try {
                const jid = typeof participant === 'string'
                    ? participant
                    : (participant.id || String(participant));
                const num = jid.split('@')[0];
                await sock.sendMessage(id, {
                    text:     `🎉 *Bienvenue* @${num} dans *${groupMetadata?.subject || 'ce groupe'}* ! 👋`,
                    mentions: [jid],
                    ...newsletterForward
                });
            } catch { /* rien à faire */ }
        }
    }
}

module.exports = { welcomeCommand, handleJoinEvent };
