'use strict';

const { handleWelcome } = require('../lib/welcome');
const { isWelcomeOn } = require('../lib/index');
const { channelInfo, ordinal, participantJid, sendMemberEvent } = require('../lib/memberEvent');

function commandArgs(text, command) {
    return text.replace(new RegExp('^\\s*\\.' + command + '\\b', 'i'), '').trim();
}

async function welcomeCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Cette commande ne fonctionne que dans les groupes.' });
        return;
    }
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    await handleWelcome(sock, chatId, message, commandArgs(text, 'welcome'));
}

async function handleJoinEvent(sock, id, participants) {
    if (!(await isWelcomeOn(id))) return;

    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch {
        return;
    }

    const groupName = groupMetadata.subject || 'Groupe';
    const memberCount = Array.isArray(groupMetadata.participants) ? groupMetadata.participants.length : 0;

    for (const participant of participants || []) {
        try {
            const jid = participantJid(participant);
            const senderNum = jid.split('@')[0];
            const now = new Date();
            const timeStr = now.toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            const welcomeMsg =
                '╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮 〕─╮\n' +
                '│ 👋 Welcome @' + senderNum + '\n' +
                '│\n' +
                '│ You are the *' + ordinal(memberCount) + '* member to join\n' +
                '│ *' + groupName + '*\n' +
                '│\n' +
                '│ 📜 *Rules:*\n' +
                '│ • Be respectful\n' +
                '│ • No spam\n' +
                '│ • Follow admin instructions\n' +
                '╰──────────────────╯\n' +
                '> POWERED BY VARNOX\n' +
                '> ' + timeStr;

            await sendMemberEvent(sock, id, jid, welcomeMsg);
        } catch (err) {
            console.error('[welcome] Erreur :', err.message);
            try {
                const jid = participantJid(participant);
                const num = jid.split('@')[0];
                await sock.sendMessage(id, {
                    text: '🎉 Bienvenue @' + num + ' dans *' + (groupMetadata.subject || 'ce groupe') + '* ! 👋',
                    mentions: [jid],
                    ...channelInfo()
                });
            } catch { /* rien */ }
        }
    }
}

module.exports = { welcomeCommand, handleJoinEvent };
