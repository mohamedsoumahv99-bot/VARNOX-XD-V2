const { channelInfo } = require('./messageConfig');

function sendAntiMessage(sock, chatId, content, options) {
    const forwarded = content && (content.text || content.caption || content.image || content.video || content.audio || content.sticker || content.document)
        ? { ...content, ...channelInfo }
        : content;
    return sock.sendMessage(chatId, forwarded, options);
}

const { setAntiBadword, getAntiBadword, removeAntiBadword, incrementWarningCount, resetWarningCount } = require('../lib/index');
const fs = require('fs');
const path = require('path');

// Load antibadword config
function loadAntibadwordConfig(groupId) {
    try {
        const configPath = path.join(__dirname, '../data/userGroupData.json');
        if (!fs.existsSync(configPath)) {
            return {};
        }
        const data = JSON.parse(fs.readFileSync(configPath));
        return data.antibadword?.[groupId] || {};
    } catch (error) {
        console.error('❌ Error loading antibadword config:', error.message);
        return {};
    }
}

async function handleAntiBadwordCommand(sock, chatId, message, match) {
    if (!match) {
        return sendAntiMessage(sock, chatId, {
            text: `╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗⟫──╮\n┃⌬┃ .antibadword on\n┃⌬┃ .antibadword set delete | kick | warn\n┃⌬┃ .antibadword off\n╰━━━━━━━━━━━━❍`
        }, { quoted: message });
    }

    if (match === 'on') {
        const existingConfig = await getAntiBadword(chatId, 'on');
        if (existingConfig?.enabled) {
            return sendAntiMessage(sock, chatId, { text: '⚠️ VARNOX antibadword est déjà activé.' }, { quoted: message });
        }
        await setAntiBadword(chatId, 'on', 'delete');
        return sendAntiMessage(sock, chatId, { text: '✅ VARNOX antibadword activé. Action actuelle : suppression.' }, { quoted: message });
    }

    if (match === 'off') {
        const config = await getAntiBadword(chatId, 'on');
        if (!config?.enabled) {
            return sendAntiMessage(sock, chatId, { text: '⚠️ VARNOX antibadword est déjà désactivé.' }, { quoted: message } );
        }
        await removeAntiBadword(chatId);
        return sendAntiMessage(sock, chatId, { text: '🔕 VARNOX antibadword désactivé.' }, { quoted: message } );
    }

    if (match.startsWith('set')) {
        const action = match.split(' ')[1];
        if (!action || !['delete', 'kick', 'warn'].includes(action)) {
            return sendAntiMessage(sock, chatId, { text: '❌ Action invalide. Choisis delete, kick ou warn.' }, { quoted: message } );
        }
        await setAntiBadword(chatId, 'on', action);
        return sendAntiMessage(sock, chatId, { text: `✅ VARNOX antibadword configuré sur : ${action}.` }, { quoted: message } );
    }

    return sendAntiMessage(sock, chatId, { text: '❌ Option invalide. Utilise .antibadword pour l’aide.' }, { quoted: message } );
}

async function handleBadwordDetection(sock, chatId, message, userMessage, senderId) {
    const config = loadAntibadwordConfig(chatId);
    if (!config.enabled) return;

    // Skip if not group
    if (!chatId.endsWith('@g.us')) return;

    // Skip if message is from bot
    if (message.key.fromMe) return;

    // Get antibadword config first
    const antiBadwordConfig = await getAntiBadword(chatId, 'on');
    if (!antiBadwordConfig?.enabled) {
        console.log('Antibadword not enabled for this group');
        return;
    }

    // Convert message to lowercase and clean it
    const cleanMessage = userMessage.toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/(.)\1{2,}/g, '$1$1')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')      // Replace multiple spaces with single space
        .trim();

    // List of bad words
    const badWords = [
        'gandu', 'madarchod', 'bhosdike', 'bsdk', 'fucker', 'bhosda', 
        'lauda', 'laude', 'betichod', 'chutiya', 'maa ki chut', 'behenchod', 
        'behen ki chut', 'tatto ke saudagar', 'machar ki jhant', 'jhant ka baal', 
        'randi', 'chuchi', 'boobs', 'boobies', 'tits', 'idiot', 'nigga', 'fuck', 
        'dick', 'bitch', 'bastard', 'asshole', 'asu', 'awyu', 'teri ma ki chut', 
        'teri maa ki', 'lund', 'lund ke baal', 'mc', 'lodu', 'benchod',
    
        // Additional offensive words
        'shit', 'damn', 'hell', 'piss', 'crap', 'bastard', 'slut', 'whore', 'prick',
        'motherfucker', 'cock', 'cunt', 'pussy', 'twat', 'wanker', 'douchebag', 'jackass', 
        'moron', 'retard', 'scumbag', 'skank', 'slutty', 'arse', 'bugger', 'sod off',
    
        'chut', 'laude ka baal', 'madar', 'behen ke lode', 'chodne', 'sala kutta',
        'harami', 'randi ki aulad', 'gaand mara', 'chodu', 'lund le', 'gandu saala',
        'kameena', 'haramzada', 'chamiya', 'chodne wala', 'chudai', 'chutiye ke baap',
    
        'fck', 'fckr', 'fcker', 'fuk', 'fukk', 'fcuk', 'btch', 'bch', 'bsdk', 'f*ck','assclown',
        'a**hole', 'f@ck', 'b!tch', 'd!ck', 'n!gga', 'f***er', 's***head', 'a$$', 'l0du', 'lund69',
    
        'spic', 'chink', 'cracker', 'towelhead', 'gook', 'kike', 'paki', 'honky', 
        'wetback', 'raghead', 'jungle bunny', 'sand nigger', 'beaner',
    
        'blowjob', 'handjob', 'cum', 'cumshot', 'jizz', 'deepthroat', 'fap', 
        'hentai', 'MILF', 'anal', 'orgasm', 'dildo', 'vibrator', 'gangbang', 
        'threesome', 'porn', 'sex', 'xxx',
    
        'fag', 'faggot', 'dyke', 'tranny', 'homo', 'sissy', 'fairy', 'lesbo',
    
        'weed', 'pot', 'coke', 'heroin', 'meth', 'crack', 'dope', 'bong', 'kush', 
        'hash', 'trip', 'rolling'
    ];
    
    // Split message into words
    const messageWords = cleanMessage.split(' ');
    let containsBadWord = false;

    // Check for exact word matches only
    for (const word of messageWords) {
        // Skip empty words or very short words
        if (word.length < 2) continue;

        // Check if this word exactly matches any bad word
        if (badWords.includes(word)) {
            containsBadWord = true;
            break;
        }

        // Also check for multi-word bad words
        for (const badWord of badWords) {
            if (badWord.includes(' ')) {  // Multi-word bad phrase
                if (cleanMessage.includes(badWord)) {
                    containsBadWord = true;
                    break;
                }
            }
        }
        if (containsBadWord) break;
    }

    if (!containsBadWord) return;

   // console.log('Bad word detected in:', userMessage);

    // Check if bot is admin before taking action
    const groupMetadata = await sock.groupMetadata(chatId);
    const participants = groupMetadata?.participants || [];
    const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    const bot = participants.find(p =>
        p.id === botId ||
        p.jid === botId ||
        p.phoneNumber === botId ||
        p.phone === botId ||
        p.userJid === botId
    );
    if (!bot?.admin) {
        return;
    }

    // Check if sender is admin
    const senderNumber = String(senderId || '').split(':')[0].split('@')[0];
    const participant = participants.find(p =>
        [p.id, p.jid, p.lid, p.phoneNumber, p.phone, p.userJid]
            .some(value => String(value || '').split(':')[0].split('@')[0] === senderNumber)
    );
    if (participant?.admin) {
        //console.log('Sender is admin, skipping action');
        return;
    }

    // Delete message immediately
    try {
        await sendAntiMessage(sock, chatId, { 
            delete: message.key
        });
        //console.log('Message deleted successfully');
    } catch (err) {
        console.error('Error deleting message:', err);
        return;
    }

    // Take action based on config
    switch (antiBadwordConfig.action) {
        case 'delete':
            await sendAntiMessage(sock, chatId, {
                text: `╭──⟪𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗⟫──╮\n┃⌬┃ @${senderId.split('@')[0]} : langage interdit.\n┃⌬┃ Action : message supprimé.\n╰━━━━━━━━━━━━❍`,
                mentions: [senderId]
            });
            break;

        case 'kick':
            try {
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                await sendAntiMessage(sock, chatId, {
                    text: `╭──⟪𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗⟫──╮\n┃⌬┃ @${senderId.split('@')[0]} a été retiré pour langage interdit.\n╰━━━━━━━━━━━━❍`,
                    mentions: [senderId]
                });
            } catch (error) {
                console.error('Error kicking user:', error);
            }
            break;

        case 'warn':
            const warningCount = await incrementWarningCount(chatId, senderId);
            if (warningCount >= 3) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    await resetWarningCount(chatId, senderId);
                    await sendAntiMessage(sock, chatId, {
                        text: `╭──⟪𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗⟫──╮\n┃⌬┃ @${senderId.split('@')[0]} a été retiré après 3 avertissements.\n╰━━━━━━━━━━━━❍`,
                        mentions: [senderId]
                    });
                } catch (error) {
                    console.error('Error kicking user after warnings:', error);
                }
            } else {
                await sendAntiMessage(sock, chatId, {
                    text: `🛡️ @${senderId.split('@')[0]} : langage interdit. Avertissement ${warningCount}/3.`,
                    mentions: [senderId]
                });
            }
            break;
    }
}

module.exports = {
    handleAntiBadwordCommand,
    handleBadwordDetection
}; 
