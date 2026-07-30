async function groupInfoCommand(sock, chatId, msg) {
    try {
        const groupMetadata = await sock.groupMetadata(chatId);

        let pp;
        try {
            pp = await sock.profilePictureUrl(chatId, 'image');
        } catch {
            pp ='https://ganga--link--ghhzdp9sv8hk.code.run/i/l4u2g5vt.jpg';
        }

        const participants = groupMetadata.participants;
        const groupAdmins = participants.filter(p => p.admin);
        const owner = groupMetadata.owner || groupAdmins.find(p => p.admin === 'superadmin')?.id || chatId.split('-')[0] + '@s.whatsapp.net';
        const listAdmin = groupAdmins.map((v, i) => `║  ${i + 1}. @${v.id.split('@')[0]}`).join('\n');
        const createdAt = groupMetadata.creation ? new Date(groupMetadata.creation * 1000).toLocaleDateString('fr-FR') : 'Inconnu';

        const text = `
╭━━━━ ⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟
┃⌬╭━━━━━━━━━━━━━━≽
┃⌬┃📋 *𝗜𝗡𝗙𝗢 𝗚𝗥𝗢𝗨𝗣𝗘*     
╭━━━━━━━━━━━━━━━≽
┃⌬┃🏷️*ɴᴏᴍ* : ${groupMetadata.subject}
┃⌬┃👥*ᴍᴇᴍʙʀᴇs* : ${participants.length}
┃⌬┃👑*ᴏᴡɴᴇʀ* : @${owner.split('@')[0]}
┃⌬┃➰️*ᴄʀᴇᴇ ʟᴇ* : ${createdAt}
╰━━━━━━━━━━━━❍
╭━━━━━━━━━━━━━━━≽
┃⌬┃🛡️*ᴀᴅᴍɪɴs* : ${listAdmin}
┃⌬┃📌*ᴅᴇsᴄʀɪᴘᴛɪᴏɴ* : ${groupMetadata.desc?.toString()?.slice(0, 40) || 'Aucune description'}
╰━━━━━━━━━━━━❍

> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`.trim();

        await sock.sendMessage(chatId, {
            image: { url: pp },
            caption: text,
            mentions: [...groupAdmins.map(v => v.id), owner],
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363424782348922@newsletter',
                    newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                    serverMessageId: -1
                }
            }
        });

    } catch (error) {
        console.error('Error in groupinfo command:', error);
        await sock.sendMessage(chatId, { text: '❌ Impossible de récupérer les infos du groupe.' });
    }
}

module.exports = groupInfoCommand;
