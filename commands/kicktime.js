'use strict';

const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');

/**
 * .kicktime @user <minutes>
 * Expulse un utilisateur pendant X minutes puis le réintègre automatiquement.
 * Réservé aux utilisateurs premium (sudo/owner).
 */
async function kickTimeCommand(sock, chatId, senderId, message) {
    // Groupe uniquement
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...channelInfo
        }, { quoted: message });
    }

    // Réservé aux premium / owner
    const isPremium = message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);
    if (!isPremium) {
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗣𝗥𝗘𝗠𝗜𝗨𝗠⌟\n` +
                `┃⌬┃ ⭐ Cette commande est réservée\n` +
                `┃⌬┃    aux utilisateurs *premium*.\n` +
                `╰━━━━━━━━━━━━━━━━❍`,
            ...channelInfo
        }, { quoted: message });
    }

    // Extraire le JID cible et la durée
    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const parts = rawText.trim().split(/\s+/);
    const durationStr = parts[parts.length - 1];
    const durationMin = parseInt(durationStr, 10);

    const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        || message.message?.extendedTextMessage?.contextInfo?.participant;

    if (!mentionedJid) {
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗞𝗜𝗖𝗞𝗧𝗜𝗠𝗘⌟\n` +
                `┃⌬┃ 📌 Usage : *.kicktime @user <minutes>*\n` +
                `┃⌬┃ Ex : .kicktime @user 10\n` +
                `╰━━━━━━━━━━━━━━━━❍`,
            ...channelInfo
        }, { quoted: message });
    }

    if (isNaN(durationMin) || durationMin <= 0) {
        return sock.sendMessage(chatId, {
            text: '⚠️ Donne une durée valide en minutes. Ex: `.kicktime @user 10`',
            ...channelInfo
        }, { quoted: message });
    }

    const targetNum = mentionedJid.split('@')[0];
    const durationMs = durationMin * 60 * 1000;

    try {
        // Récupérer le lien d'invitation du groupe AVANT d'expulser
        let inviteLink = null;
        try {
            const code = await sock.groupInviteCode(chatId);
            inviteLink = `https://chat.whatsapp.com/${code}`;
        } catch (e) {
            console.error('[kicktime] Could not get invite link:', e.message);
        }

        // Expulser
        await sock.groupParticipantsUpdate(chatId, [mentionedJid], 'remove');

        // Notifier dans le groupe
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗞𝗜𝗖𝗞𝗧𝗜𝗠𝗘⌟\n` +
                `┃⌬┃ 🚫 *Expulsion temporaire*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ 👤 @${targetNum}\n` +
                `┃⌬┃ ⏱️ Durée : *${durationMin} minute(s)*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ ✅ Utilisateur expulsé.\n` +
                `┃⌬┃ ⏳ Réintégration automatique dans\n` +
                `┃⌬┃    *${durationMin} min*.\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            mentions: [mentionedJid],
            ...channelInfo
        }, { quoted: message });

        // Message privé à l'utilisateur expulsé
        if (inviteLink) {
            try {
                await sock.sendMessage(mentionedJid, {
                    text:
                        `╭━━━━⌜𝗞𝗜𝗖𝗞𝗧𝗜𝗠𝗘⌟\n` +
                        `┃⌬┃ 🚫 Tu as été expulsé(e) temporairement.\n` +
                        `┃⌬┃ ⏳ Attends *${durationMin} min*, tu seras réintégré(e).\n` +
                        `┃⌬┃\n` +
                        `┃⌬┃ 🔗 Lien de réintégration :\n` +
                        `┃⌬┃ ${inviteLink}\n` +
                        `╰━━━━━━━━━━━━━━━━❍`,
                    ...channelInfo
                });
            } catch {}
        }

        // Réintégrer automatiquement après la durée
        setTimeout(async () => {
            try {
                await sock.groupParticipantsUpdate(chatId, [mentionedJid], 'add');
                await sock.sendMessage(chatId, {
                    text:
                        `╭━━━━⌜𝗞𝗜𝗖𝗞𝗧𝗜𝗠𝗘⌟\n` +
                        `┃⌬┃ ✅ *Réintégration automatique*\n` +
                        `┃⌬┃\n` +
                        `┃⌬┃ 👤 @${targetNum}\n` +
                        `┃⌬┃ a été réintégré(e) dans le groupe.\n` +
                        `╰━━━━━━━━━━━━━━━━❍`,
                    mentions: [mentionedJid],
                    ...channelInfo
                });
            } catch (e) {
                console.error('[kicktime] auto-readd error:', e.message);
                // Si on ne peut pas re-ajouter, envoyer le lien d'invitation
                if (inviteLink) {
                    try {
                        await sock.sendMessage(mentionedJid, {
                            text:
                                `✅ Ta période d'expulsion est terminée.\n` +
                                `Rejoins le groupe ici :\n${inviteLink}`,
                            ...channelInfo
                        });
                    } catch {}
                }
            }
        }, durationMs);

    } catch (err) {
        console.error('[kicktime] error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible d\'expulser cet utilisateur.',
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = { kickTimeCommand };
