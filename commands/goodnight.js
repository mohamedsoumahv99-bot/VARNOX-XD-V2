const fetch = require('node-fetch');

async function goodnightCommand(sock, chatId, message) {
    try {
        const shizokeys = process.env.SHIZO_API_KEY;
        const res = shizokeys
            ? await fetch(`https://shizoapi.onrender.com/api/texts/lovenight?apikey=${encodeURIComponent(shizokeys)}`)
            : null;
        
        if (res && !res.ok) {
            throw await res.text();
        }
        
        const json = res ? await res.json() : null;
        const goodnightMessage = json?.result || '🌙 Bonne nuit. Repose-toi bien et prends soin de toi.';

        // Send the goodnight message
        await sock.sendMessage(chatId, { text: goodnightMessage }, { quoted: message });
    } catch (error) {
        console.error('Error in goodnight command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get goodnight message. Réessayez plus tard!' }, { quoted: message });
    }
}

module.exports = { goodnightCommand }; 