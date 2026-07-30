const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');

async function ibCommand(sock, chatId, message) {
    const ownerJid = settings.ownerNumber + '@s.whatsapp.net';

    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    if (!quotedImage && !quotedVideo) {
        await sock.sendMessage(chatId, { text: '❌ Réponds à un média vue unique (image ou vidéo).' }, { quoted: message });
        return;
    }

    try {
        if (quotedImage) {
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            // Envoyer uniquement en PV du propriétaire
            await sock.sendMessage(ownerJid, { 
                image: buffer, 
                caption: `📩 *Vue unique reçue*\n👤 De: @${message.key.participant?.split('@')[0] || message.key.remoteJid?.split('@')[0]}\n💬 Groupe: ${chatId.endsWith('@g.us') ? chatId : 'Privé'}`
            });
        } else if (quotedVideo) {
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            // Envoyer uniquement en PV du propriétaire
            await sock.sendMessage(ownerJid, { 
                video: buffer, 
                caption: `📩 *Vue unique reçue*\n👤 De: @${message.key.participant?.split('@')[0] || message.key.remoteJid?.split('@')[0]}\n💬 Groupe: ${chatId.endsWith('@g.us') ? chatId : 'Privé'}`
            });
        }
        // Pas de réponse dans le groupe ou en privé — silence total
    } catch (error) {
        console.error('Erreur commande .ib:', error);
    }
}

module.exports = ibCommand;
