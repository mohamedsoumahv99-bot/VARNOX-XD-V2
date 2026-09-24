'use strict';
const settings = require('../settings');
const { getAllInstances } = require('../lib/botInstance');
function numberOf(value) { return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, ''); }
async function statsCommand(sock, chatId, message) {
    const owner = numberOf(settings.ownerNumber);
    const candidates = [message.key.participant, message.key.participantAlt, message.key.remoteJid].filter(Boolean).map(numberOf);
    const botNumber = numberOf(sock.user?.id);
    if (!candidates.includes(owner) && !(message.key.fromMe && botNumber === owner)) {
        await sock.sendMessage(chatId, { text: 'Seul le numéro propriétaire configuré peut utiliser cette commande.' }, { quoted: message });
        return;
    }
    const instances = getAllInstances();
    const connected = instances.filter(instance => instance.connected);
    const lines = ['📊 *VARNOX — STATS DES SESSIONS*', '', '• Sessions connectées : *' + connected.length + '*', '• Sessions détectées : *' + instances.length + '*', ''];
    for (const instance of instances) lines.push((instance.connected ? '✅ ' : '⚪ ') + instance.number + (instance.connected ? ' — connecté' : ' — hors ligne'));
    await sock.sendMessage(chatId, { text: lines.join('\n') }, { quoted: message });
}
module.exports = statsCommand;
