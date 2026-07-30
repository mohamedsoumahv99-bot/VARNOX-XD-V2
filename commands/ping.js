const os = require('os');
const settings = require('../settings.js');

function formatTime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let time = '';
    if (days > 0) time += `${days}j `;
    if (hours > 0) time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;
    return time.trim();
}

async function pingCommand(sock, chatId, message) {
    try {
        const start = Date.now();
        const sent = await sock.sendMessage(chatId, { text: '🏓' }, { quoted: message });
        const ping = Math.round(Date.now() - start);
        const uptime = formatTime(Math.floor(process.uptime()));
        const memUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
        const memTotal = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
        const cpuModel = os.cpus()[0]?.model?.split(' ')[0] || 'Unknown';

        const botInfo = `
╔══════════════════════╗
║   🥷 *NOM_DE_TON_BOT* 🥷   ║
╠══════════════════════╣
║                      ║
║  🏓 *Ping*    :  ${String(ping + ' ms').padEnd(8)}║
║  ⏱️  *Uptime*  :  ${String(uptime).padEnd(8)}║
║  🔖 *Version* :  v${String(settings.version).padEnd(6)}║
║  💾 *RAM*     :  ${String(memUsed + ' MB').padEnd(8)}║
║  🖥️  *CPU*    :  ${String(cpuModel).padEnd(8)}║
║                      ║
╠══════════════════════╣
║  ✅ *Statut*  :  En ligne  ║
║  🌍 *Mode*    :  Public   ║
╚══════════════════════╝

> _Propulsé par 🥷 TON_NOM_ICI™_`.trim();

        await sock.sendMessage(chatId, {
            image: { url: 'https://i.ibb.co/zTpCpsDD/54c381553462489288313ec73a0bbfe8.jpg' },
            caption: botInfo,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363408304719268@newsletter',
                    newsletterName: 'ITACHI-XMD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });

    } catch (error) {
        console.error('Error in ping command:', error);
        await sock.sendMessage(chatId, { text: '❌ Impossible de récupérer le statut du bot.' });
    }
}

module.exports = pingCommand;
