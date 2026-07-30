const settings = require('../settings');

async function ownerCommand(sock, chatId, message) {
    const ownerMsg = `
╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟
┃⌬╭━━━━━━━━━━━━━━━≽
┃⌬┃                      
┃⌬┃ 👑 *𝗢𝗪𝗡𝗘𝗥*    
┃⌬┃ ⬡ ${settings.botOwner}  
┃⌬┃                      
┃⌬┃ 📞 *𝗖𝗢𝗡𝗧𝗔𝗖𝗧*         
┃⌬┃ ⬡ +${settings.ownerNumber}
┃⌬┃                      
╰━━━━━━━━━━━━❍

>  ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`.trim();

    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${settings.botOwner}\nTEL;waid=${settings.ownerNumber}:${settings.ownerNumber}\nEND:VCARD`;

    try {
        await sock.sendMessage(chatId, {
            image: { url: 'https://files.catbox.moe/jieuny.jpg' },
            caption: ownerMsg,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363424782348922@newsletter',
                    newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });

        // Envoyer aussi la carte de contact
        await sock.sendMessage(chatId, {
            contacts: { displayName: settings.botOwner, contacts: [{ vcard }] }
        });
    } catch (error) {
        console.error('Error in owner command:', error);
    }
}

module.exports = ownerCommand;
