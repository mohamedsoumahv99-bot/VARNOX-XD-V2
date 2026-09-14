'use strict';

const muteCommand = require('./mute');

async function unmuteCommand(sock, chatId, senderId, message, mentionedJids = []) {
    try {
        const targets = muteCommand.getTargetJids(message, mentionedJids);
        if (targets.length > 0) {
            const removed = muteCommand.clearMuted(chatId, targets);
            const names = targets.map(jid => '@' + jid.split('@')[0]).join(', ');
            const verb = targets.length > 1 ? 'ne sont' : "n'est";
            const text = removed ? '🔊 ' + names + ' ' + verb + ' plus muet(s).' : 'ℹ️ ' + names + ' ' + verb + ' pas dans la liste des utilisateurs muets.';
            await sock.sendMessage(chatId, {text, mentions: targets}, {quoted: message});
            return;
        }

        // Compatibilité conservée : sans cible, .unmute rouvre le groupe entier.
        await sock.groupSettingUpdate(chatId, 'not_announcement');
        await sock.sendMessage(chatId, {text: '🔊 Le groupe est de nouveau ouvert.'}, {quoted: message});
    } catch (error) {
        console.error('[unmute] erreur:', error);
        await sock.sendMessage(chatId, {text: '❌ Impossible d\'appliquer le unmute. Vérifie que le bot est administrateur.'}, {quoted: message});
    }
}

module.exports = unmuteCommand;
