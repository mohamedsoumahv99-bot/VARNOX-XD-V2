// commands/autotyping.js
let autotypingEnabled = new Map(); // Stocke l'état par chat

async function autotypingCommand(sock, chatId, message) {
    const args = message.message?.conversation?.split(' ') || [];
    const action = args[1]?.toLowerCase();

    if (!action) {
        const status = autotypingEnabled.get(chatId) ? 'activé' : 'désactivé';
        await sock.sendMessage(chatId, {
            text: `⚙️ *Auto-Typing*\n\nStatut: ${status}\n\nUtilisation:\n.autotyping on - Activer\n.autotyping off - Désactiver`
        }, { quoted: message });
        return;
    }

    if (action === 'on' || action === 'enable') {
        autotypingEnabled.set(chatId, true);
        await sock.sendMessage(chatId, { text: '✅ Auto-typing activé dans ce chat.' }, { quoted: message });
    } else if (action === 'off' || action === 'disable') {
        autotypingEnabled.set(chatId, false);
        await sock.sendMessage(chatId, { text: '✅ Auto-typing désactivé dans ce chat.' }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { text: '❌ Utilise .autotyping on ou .autotyping off' }, { quoted: message });
    }
}

function isAutotypingEnabled(chatId) {
    return autotypingEnabled.get(chatId) || false;
}

async function handleAutotypingForMessage(sock, chatId, messageText) {
    if (!isAutotypingEnabled(chatId)) return;
    
    await sock.sendPresenceUpdate('composing', chatId);
    setTimeout(() => {
        sock.sendPresenceUpdate('available', chatId);
    }, 1000);
}

async function handleAutotypingForCommand(sock, chatId) {
    if (!isAutotypingEnabled(chatId)) return;
    await sock.sendPresenceUpdate('composing', chatId);
}

async function showTypingAfterCommand(sock, chatId) {
    if (!isAutotypingEnabled(chatId)) return;
    await sock.sendPresenceUpdate('composing', chatId);
    setTimeout(() => {
        sock.sendPresenceUpdate('available', chatId);
    }, 500);
}

module.exports = {
    autotypingCommand,
    isAutotypingEnabled,
    handleAutotypingForMessage,
    handleAutotypingForCommand,
    showTypingAfterCommand
};
