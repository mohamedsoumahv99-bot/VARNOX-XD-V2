const fetch = require('node-fetch');

async function flirtCommand(sock, chatId, message) {
    try {
        const shizokeys = process.env.SHIZO_API_KEY;
        const res = shizokeys
            ? await fetch(`https://shizoapi.onrender.com/api/texts/flirt?apikey=${encodeURIComponent(shizokeys)}`)
            : null;
        
        if (res && !res.ok) {
            throw await res.text();
        }
        
        const json = res ? await res.json() : null;
        const flirtMessage = json?.result || '✨ Ton sourire pourrait améliorer la journée de n’importe qui.';

        // Send the flirt message
        await sock.sendMessage(chatId, { text: flirtMessage }, { quoted: message });
    } catch (error) {
        console.error('Error in flirt command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get flirt message. Réessayez plus tard!' }, { quoted: message });
    }
}

module.exports = { flirtCommand }; 