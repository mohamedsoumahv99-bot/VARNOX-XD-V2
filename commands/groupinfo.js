'use strict';

const { channelInfo } = require('../lib/messageConfig');

function getParticipantNumber(jid) {
    return String(jid || '')
        .split('@')[0]
        .split(':')[0];
}

function getCreationDate(creation) {
    if (!creation) return 'Inconnue';

    const rawTimestamp = Number(creation);
    if (!Number.isFinite(rawTimestamp)) return 'Inconnue';

    // Baileys normally provides seconds, but accept milliseconds as well.
    const timestamp = rawTimestamp < 1e12
        ? rawTimestamp * 1000
        : rawTimestamp;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'Inconnue';

    return new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Africa/Conakry',
        dateStyle: 'long',
        timeStyle: 'short',
    }).format(date);
}

async function getParticipantName(sock, participant) {
    const jid = participant?.id || participant?.jid || participant?.lid;
    if (!jid) return 'Nom inconnu';

    try {
        if (typeof sock.getName === 'function') {
            const name = await sock.getName(jid);
            if (name && !String(name).startsWith('+')) return String(name);
        }
    } catch (error) {
        console.warn('[groupinfo] impossible de lire le nom du participant:', error.message);
    }

    return participant.notify || participant.name || `+${getParticipantNumber(jid)}`;
}

async function groupInfoCommand(sock, chatId, msg) {
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = Array.isArray(groupMetadata?.participants)
            ? groupMetadata.participants
            : [];
        const groupAdmins = participants.filter(participant =>
            participant.admin === 'admin' || participant.admin === 'superadmin'
        );

        const ownerJid = groupMetadata.owner
            || groupMetadata.subjectOwner
            || groupAdmins.find(participant => participant.admin === 'superadmin')?.id;

        const adminEntries = await Promise.all(groupAdmins.map(async participant => ({
            jid: participant.id || participant.jid || participant.lid,
            name: await getParticipantName(sock, participant),
        })));
        const adminLines = adminEntries.length
            ? adminEntries.map((admin, index) =>
                `┃⌬┃ ${index + 1}. @${getParticipantNumber(admin.jid)}`
            ).join('\n')
            : '┃⌬┃ Aucun administrateur trouvé';

        let ownerLine = 'Inconnu';
        let ownerMention;
        if (ownerJid) {
            ownerLine = `@${getParticipantNumber(ownerJid)}`;
            ownerMention = ownerJid;
        }

        const text = `
╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⟫──╮
┃⌬┃🏷️ Nom : ${groupMetadata.subject || 'Sans nom'}
┃⌬┃🆔 ID : ${chatId}
┃⌬┃👥 Membres : ${participants.length}
┃⌬┃🛡️ Administrateurs :
${adminLines}
┃⌬┃👑 Propriétaire : ${ownerLine}
┃⌬┃📜 Créer le : ${getCreationDate(groupMetadata.creation)}
╰━━━━━━━━━━━━❍`.trim();

        const mentions = [
            ...adminEntries.map(admin => admin.jid),
            ownerMention,
        ].filter(Boolean);

        let profilePicture;
        try {
            profilePicture = await sock.profilePictureUrl(chatId, 'image');
        } catch (error) {
            console.warn('[groupinfo] photo de profil indisponible:', error.message);
        }

        const messageContent = {
            ...(profilePicture ? { image: { url: profilePicture } } : { text }),
            ...(profilePicture ? { caption: text } : {}),
            mentions,
            ...channelInfo,
        };

        try {
            await sock.sendMessage(chatId, messageContent, { quoted: msg });
        } catch (sendError) {
            // Une URL de photo peut expirer entre sa récupération et son envoi.
            // Le texte reste utile et évite que la commande échoue entièrement.
            if (!profilePicture) throw sendError;
            console.warn('[groupinfo] envoi de la photo impossible, envoi du texte:', sendError.message);
            await sock.sendMessage(chatId, {
                text,
                mentions,
                ...channelInfo,
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Error in groupinfo command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible de récupérer les informations réelles de ce groupe.',
            ...channelInfo,
        }, { quoted: msg });
    }
}

module.exports = groupInfoCommand;
