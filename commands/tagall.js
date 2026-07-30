async function tagAllCommand(sock, chatId, senderId, message) {
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants;

        if (!participants || participants.length === 0) {
            await sock.sendMessage(chatId, { text: '❌ Aucun participant trouvé dans le groupe.' });
            return;
        }

        const groupName = groupMetadata.subject || 'Groupe';
        const count = participants.length;

        let memberList = '';
        participants.forEach((p, i) => {
            memberList += `│ ${i + 1}. @${p.id.split('@')[0]}\n`;
        });

        const tagMessage = `

╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟
┃⌬╭━━━━━━━━━━━━━≽
┃⌬┃@${m.sender.split('@')[0]} 
╰━━━━━━━━━━━━❍
    📢𝗔𝗡𝗡𝗢𝗡𝗖𝗘 ❍𝗙𝗙𝗜𝗖𝗜𝗔𝗟
┃⌬┃🏷️ *${groupName}*
┃⌬┃👥 *Membres tagués : ${count}*

⌬${memberList}
┃⌬┃
┃⌬┃ 🔔 ᴀᴛᴛᴇɴᴛɪᴏɴ ᴛᴏᴜᴛ 
┃⌬┃  ʟᴇ ᴍᴏɴᴅᴇ ! 
╰━━━━━━━━━━━━❍

>  ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`.trim();

        await sock.sendMessage(chatId, {
            text: tagMessage,
            mentions: participants.map(p => p.id)
        }, { quoted: message });

    } catch (error) {
        console.error('Erreur dans tagall:', error);
        await sock.sendMessage(chatId, { text: '❌ Échec du tag de tous les membres.' });
    }
}

module.exports = tagAllCommand;
