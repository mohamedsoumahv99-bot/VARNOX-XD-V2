const settings = require('../settings');
const fs = require('fs');
const path = require('path');

async function helpCommand(sock, chatId, message, channelLink) {
    const sender = message.key.participant || message.key.remoteJid;
    const senderNumber = sender ? sender.split('@')[0] : 'User';
    
    const helpMessage = `
╭━━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟
┃❍╭━━━━━━━━━━━━━━≽
┃❍┃👤ᴜsᴇʀ : @${senderNumber}
┃❍┃👑ᴏᴡɴᴇʀ : ʋαɾɳσx ❍ϝϝιƈια𝚕
┃❍┃♻️ᴠᴇʀsɪᴏɴ : ${settings.version || '2.0.0'} 
┃❍┃⚙️ᴍᴏᴅᴇ : ᴘᴜʙʟɪᴄ
┃❍┃⏰️ʀᴜɴᴛɪᴍᴇ : ${new Date().toLocaleTimeString("fr-FR", { timeZone: "Africa/Conakry" })}
┃❍┃🔆ᴘʀᴇғɪxᴇ : [.]
╰━━━━━━━━━━━━━━━❐
➥❐ ⌜📦𝗚𝗘𝗡𝗘𝗥𝗔𝗟 𝗠𝗘𝗡𝗨⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ʜᴇʟᴘ │ ᴍᴇɴᴜ │ ᴘɪɴɢ
│⌬┃ᴀʟɪᴠᴇ │ ᴛᴛs │ ᴏᴡɴᴇʀ
│⌬┃ᴊᴏᴋᴇ │ ǫᴜᴏᴛᴇ │ ғᴀᴄᴛ
│⌬┃ᴡᴇᴀᴛʜᴇʀ │ ɴᴇᴡs │ ᴀᴛᴛᴘ
│⌬┃ʟʏʀɪᴄs │ 8ʙᴀʟʟ │ ss
│⌬┃ᴊɪᴅ │ ᴜʀʟ │ ɢɪᴛʜᴜʙ
╰━━━━━━━━━━━━❍
➥❐  ⌜🛠𝗔𝗗𝗠𝗜𝗡 𝗠𝗘𝗡𝗨⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ʙᴀɴ │ ᴋɪᴄᴋ │ ᴡᴀʀɴ
│⌬┃ᴘʀᴏᴍᴏᴛᴇ │ ᴅᴇᴍᴏᴛᴇ │ ᴍᴜᴛᴇ
│⌬┃ᴅᴇʟᴇᴛᴇ │ ᴄʟᴇᴀʀ │ ᴛᴀɢᴀʟʟ
│⌬┃ʜɪᴅᴇᴛᴀɢ │ ᴀɴᴛɪʟɪɴᴋ │ ᴡᴇʟᴄᴏᴍᴇ
│⌬┃ᴀɴᴛɪʙᴀᴅᴡᴏʀᴅ │ ᴀɴᴛɪʙᴏᴛ │ ɢᴏᴏᴅʙʏᴇ
│⌬┃sᴇᴛɢɴᴀᴍᴇ │ sᴇᴛɢᴘᴘ
╰━━━━━━━━━━━━❍
➥❐  ⌜👑𝗢𝗪𝗡𝗘𝗥 𝗠𝗘𝗡𝗨⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ᴍᴏᴅᴇ │ ᴄʟᴇᴀʀsᴇssɪᴏɴ │ ᴄʟᴇᴀʀᴛᴍᴘ
│⌬┃ᴜᴘᴅᴀᴛᴇ │ sᴇᴛᴛɪɴɢs │ ᴀᴜᴛᴏsᴛᴀᴛᴜs
│⌬┃ᴀᴜᴛᴏʀᴇᴀᴅ │ ᴀɴᴛɪᴄᴀʟʟ │ ᴘᴍʙʟᴏᴄᴋᴇʀ
│⌬┃sᴇᴛᴘᴘ │ sᴇᴛᴍᴇɴᴛɪᴏɴ
╰━━━━━━━━━━━━❍
➥❐  ⌜🎨𝗦𝗧𝗜𝗖𝗞 𝗠𝗘𝗡𝗨⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃sᴛɪᴄᴋᴇʀ │ sɪᴍᴀɢᴇ │ ʀᴇᴍɪɴɪ
│⌬┃ʀᴇᴍᴏᴠᴇʙɢ │ ʙʟᴜʀ │ ᴄʀᴏᴘ
│⌬┃ᴍᴇᴍᴇ │ ᴛᴀᴋᴇ │ ᴇᴍᴏᴊɪᴍɪx │ ɪɢs
╰━━━━━━━━━━━━❍
➥❐  ⌜📌𝗔𝗜 & 𝗚𝗔𝗠𝗘𝗦⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ɢᴘᴛ │ ɢᴇᴍɪɴɪ │ ɪᴍᴀɢɪɴᴇ
│⌬┃sᴏʀᴀ │ ᴛɪᴄᴛᴀᴄᴛᴏᴇ │ ʜᴀɴɢᴍᴀɴ
│⌬┃ᴛʀɪᴠɪᴀ │ ᴛʀᴜᴛʜ │ ᴅᴀʀᴇ
╰━━━━━━━━━━━━❍
➥❐  ⌜📥𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ᴘʟᴀʏ │ sᴏɴɢ │ ᴠɪᴅᴇᴏ
│⌬┃sᴘᴏᴛɪғʏ │ ɪɴsᴛᴀɢʀᴀᴍ
│⌬┃ғᴀᴄᴇʙᴏᴏᴋ │ ᴛɪᴋᴛᴏᴋ
╰━━━━━━━━━━━━❍

> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`;

    const contextInfo = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363424782348922@newsletter',
            newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
            serverMessageId: -1
        }
    };

    try {
        await sock.sendMessage(chatId, {
            image: { url: 'https://files.catbox.moe/24ugxs.jpg' },
            caption: helpMessage,
            contextInfo
        }, { quoted: message });
    } catch (error) {
        console.error('Error in help command:', error);
        await sock.sendMessage(chatId, { text: helpMessage });
    }
}

module.exports = helpCommand;
