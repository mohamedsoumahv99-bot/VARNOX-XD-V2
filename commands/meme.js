const fetch = require('node-fetch');

async function memeCommand(sock, chatId, message) {
    try {
        let response = await fetch('https://shizoapi.onrender.com/api/memes/cheems?apikey=shizo');
        if (!response.ok || !(response.headers.get('content-type') || '').includes('image')) {
            response = await fetch('https://meme-api.com/gimme');
            const data = await response.json();
            if (!data.url) throw new Error('Meme fallback returned no image');
            response = await fetch(data.url);
        }
        
        // Check if response is an image
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('image')) {
            const imageBuffer = await response.buffer();
            
            const buttons = [
                { buttonId: '.meme', buttonText: { displayText: '🎭 Another Meme' }, type: 1 },
                { buttonId: '.joke', buttonText: { displayText: '😄 Joke' }, type: 1 }
            ];

            await sock.sendMessage(chatId, { 
                image: imageBuffer,
                caption: "> Here's your cheems meme! 🐕",
                buttons: buttons,
                headerType: 1
            },{ quoted: message});
        } else {
            throw new Error('Invalid response type from API');
        }
    } catch (error) {
        console.error('Error in meme command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to fetch meme. Réessayez plus tard.'
        },{ quoted: message });
    }
}

module.exports = memeCommand;
