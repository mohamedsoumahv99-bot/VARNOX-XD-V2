'use strict';
const settings = require('../settings');
const os       = require('os');

async function helpCommand(sock, chatId, message) {
  // Extract sender number from message
  const senderId  = message.key.participant || message.key.remoteJid || '';
  const senderNum = senderId.split('@')[0] || '?';
  const runtime   = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Africa/Conakry' });
  const ram       = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
  const upSec     = Math.floor(process.uptime());
  const upH       = Math.floor(upSec / 3600);
  const upM       = Math.floor((upSec % 3600) / 60);
  const uptime    = upH > 0 ? `${upH}h ${upM}m` : `${upM}m`;

  const helpMessage =
`╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟
┃❍╭━━━━━━━━━━━━━━≽
┃❍┃ 👤 ᴜsᴇʀ : @${senderNum}
┃❍┃ 👑 ᴏᴡɴᴇʀ : ʋαɾɳσx ❍ϝϝιƈια𝚕
┃❍┃ ♻️ ᴠᴇʀsɪᴏɴ : ${settings.version || '2.0.0'}
┃❍┃ ⚙️ ᴍᴏᴅᴇ : ᴘᴜʙʟɪᴄ
┃❍┃ ⏰ ʜᴇᴜʀᴇ : ${runtime}
┃❍┃ ⏱️ ᴜᴘᴛɪᴍᴇ : ${uptime}
┃❍┃ 💾 ʀᴀᴍ : ${ram} MB
┃❍┃ 🔆 ᴘʀᴇғɪxᴇ : [.]
╰━━━━━━━━━━━━━━━❐

➥❐ ⌜📦 𝗚𝗘𝗡𝗘𝗥𝗔𝗟 𝗠𝗘𝗡𝗨⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ ᴘɪɴɢ
│⌬┃ ᴀʟɪᴠᴇ
│⌬┃ ᴏᴡɴᴇʀ
│⌬┃ ᴛᴛs
│⌬┃ ᴊᴏᴋᴇ
│⌬┃ ǫᴜᴏᴛᴇ
│⌬┃ ғᴀᴄᴛ
│⌬┃ ᴡᴇᴀᴛʜᴇʀ
│⌬┃ ɴᴇᴡs
│⌬┃ ᴀᴛᴛᴘ
│⌬┃ ʟʏʀɪᴄs
│⌬┃ 8ʙᴀʟʟ
│⌬┃ ᴛʀᴛ / ᴛʀᴀɴsʟᴀᴛᴇ
│⌬┃ ss / sᴄʀᴇᴇɴsʜᴏᴛ
│⌬┃ ᴜʀʟ
│⌬┃ ᴊɪᴅ
╰━━━━━━━━━━━━❍

➥❐ ⌜🛠 𝗔𝗗𝗠𝗜𝗡 𝗠𝗘𝗡𝗨⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ ᴛᴀɢᴀʟʟ
│⌬┃ ᴛᴀɢ
│⌬┃ ʜɪᴅᴇᴛᴀɢ
│⌬┃ ᴛᴀɢɴᴏᴛᴀᴅᴍɪɴ
│⌬┃ ʙᴀɴ / ᴜɴʙᴀɴ
│⌬┃ ᴋɪᴄᴋ
│⌬┃ ᴡᴀʀɴ / ᴡᴀʀɴɪɴɢs
│⌬┃ ᴘʀᴏᴍᴏᴛᴇ / ᴅᴇᴍᴏᴛᴇ
│⌬┃ ᴍᴜᴛᴇ / ᴜɴᴍᴜᴛᴇ
│⌬┃ ᴅᴇʟᴇᴛᴇ
│⌬┃ ᴄʟᴇᴀʀ
│⌬┃ ʜɪᴅᴇᴛᴀɢ
│⌬┃ ᴀɴᴛɪʟɪɴᴋ
│⌬┃ ᴀɴᴛɪʙᴀᴅᴡᴏʀᴅ
│⌬┃ ᴀɴᴛɪʙᴏᴛ
│⌬┃ ᴡᴇʟᴄᴏᴍᴇ / ɢᴏᴏᴅʙʏᴇ
│⌬┃ sᴛᴀғғ
│⌬┃ ɢʀᴏᴜᴘɪɴғᴏ
│⌬┃ sᴇᴛɢɴᴀᴍᴇ / sᴇᴛɢᴘᴘ
│⌬┃ ʀᴇsᴇᴛʟɪɴᴋ
╰━━━━━━━━━━━━❍

➥❐ ⌜👑 𝗢𝗪𝗡𝗘𝗥 𝗠𝗘𝗡𝗨⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ ᴍᴏᴅᴇ
│⌬┃ ᴄʟᴇᴀʀsᴇssɪᴏɴ
│⌬┃ ᴄʟᴇᴀʀᴛᴍᴘ
│⌬┃ ᴜᴘᴅᴀᴛᴇ
│⌬┃ sᴇᴛᴛɪɴɢs
│⌬┃ ᴀᴜᴛᴏsᴛᴀᴛᴜs
│⌬┃ ᴀᴜᴛᴏʀᴇᴀᴅ
│⌬┃ ᴀᴜᴛᴏᴛʏᴘɪɴɢ
│⌬┃ ᴀɴᴛɪᴄᴀʟʟ
│⌬┃ ᴘᴍʙʟᴏᴄᴋᴇʀ
│⌬┃ sᴇᴛᴘᴘ
│⌬┃ ᴀʀᴇᴀᴄᴛ ᴏɴ/ᴏFF
│⌬┃ sᴜᴅᴏ
╰━━━━━━━━━━━━❍

➥❐ ⌜🎨 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 & 𝗠𝗘𝗗𝗜𝗔⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ sᴛɪᴄᴋᴇʀ
│⌬┃ sɪᴍᴀɢᴇ
│⌬┃ ʀᴇᴍɪɴɪ
│⌬┃ ʀᴇᴍᴏᴠᴇʙɢ
│⌬┃ ʙʟᴜʀ
│⌬┃ ᴄʀᴏᴘ
│⌬┃ ᴍᴇᴍᴇ
│⌬┃ ᴛᴀᴋᴇ
│⌬┃ ᴇᴍᴏᴊɪᴍɪx
│⌬┃ ɪɢs / ɪɢsᴄ
│⌬┃ ᴡᴀsᴛᴇᴅ
╰━━━━━━━━━━━━❍

➥❐ ⌜📌 𝗔𝗜 & 𝗝𝗘𝗨𝗫⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ ɢᴘᴛ / ɢᴇᴍɪɴɪ
│⌬┃ ɪᴍᴀɢɪɴᴇ / ғʟᴜx
│⌬┃ sᴏʀᴀ
│⌬┃ ᴛɪᴄᴛᴀᴄᴛᴏᴇ
│⌬┃ ʜᴀɴɢᴍᴀɴ
│⌬┃ ᴛʀɪᴠɪᴀ
│⌬┃ ᴛʀᴜᴛʜ / ᴅᴀʀᴇ
│⌬┃ ғʟɪʀᴛ
│⌬┃ sʜɪᴘ
│⌬┃ 8ʙᴀʟʟ
│⌬┃ ᴄᴏᴍᴘʟɪᴍᴇɴᴛ / ɪɴsᴜʟᴛ
╰━━━━━━━━━━━━❍

➥❐ ⌜📥 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ ᴘʟᴀʏ / sᴏɴɢ / ᴍᴘ3
│⌬┃ ᴠɪᴅᴇᴏ / ʏᴛᴍᴘ4
│⌬┃ sᴘᴏᴛɪғʏ
│⌬┃ ɪɴsᴛᴀɢʀᴀᴍ
│⌬┃ ғᴀᴄᴇʙᴏᴏᴋ
│⌬┃ ᴛɪᴋᴛᴏᴋ
╰━━━━━━━━━━━━❍

➥❐ ⌜🔷 𝗧𝗘𝗫𝗧 𝗠𝗔𝗞𝗘𝗥⌟
╭━━━━━━━━━━━━━━━≽
│⌬┃ ɴᴇᴏɴ  ɢʟɪᴛᴄʜ  ғɪʀᴇ
│⌬┃ ɪᴄᴇ  sɴᴏᴡ  ᴍᴀᴛʀɪx
│⌬┃ ʜᴀᴄᴋᴇʀ  ᴅᴇᴠɪʟ  sᴀɴᴅ
│⌬┃ ʙʟᴀᴄᴋᴘɪɴᴋ  ᴛʜᴜɴᴅᴇʀ  ᴀʀᴇɴᴀ
╰━━━━━━━━━━━━❍

> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`;

  try {
    await sock.sendMessage(chatId, {
      image   : { url: 'https://files.catbox.moe/24ugxs.jpg' },
      caption : helpMessage,
      mentions: [senderId],
      contextInfo: {
        forwardingScore: 1,
        isForwarded    : true,
        forwardedNewsletterMessageInfo: {
          newsletterJid  : '120363424782348922@newsletter',
          newsletterName : '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
          serverMessageId: -1,
        },
      },
    }, { quoted: message });
  } catch (err) {
    console.error('[help] image failed, sending text:', err.message);
    await sock.sendMessage(chatId, {
      text    : helpMessage,
      mentions: [senderId],
    }, { quoted: message });
  }
}

module.exports = helpCommand;
