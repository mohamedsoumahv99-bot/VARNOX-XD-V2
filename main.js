// 🧹 Fix for ENOSPC / temp overflow in hosted panels
const fs = require('fs');
const path = require('path');

// Redirect temp storage away from system /tmp
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Auto-cleaner every 3 hours
setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => { });
                }
            });
        }
    });
    console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);

const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer } = require('./lib/myfunc');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { isSudo } = require('./lib/index');
const isOwnerOrSudo = require('./lib/isOwner');
const { autotypingCommand, isAutotypingEnabled, handleAutotypingForMessage, handleAutotypingForCommand, showTypingAfterCommand } = require('./commands/autotyping');
const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./commands/autoread');

// Command imports
const tagAllCommand = require('./commands/tagall');
const helpCommand = require('./commands/help');
const banCommand = require('./commands/ban');
const { promoteCommand } = require('./commands/promote');
const { demoteCommand } = require('./commands/demote');
const muteCommand = require('./commands/mute');
const { isMuted } = muteCommand;
const unmuteCommand = require('./commands/unmute');
const stickerCommand = require('./commands/sticker');
const isAdmin = require('./lib/isAdmin');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const ttsCommand = require('./commands/tts');
const { tictactoeCommand, handleTicTacToeMove } = require('./commands/tictactoe');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const ownerCommand = require('./commands/owner');
const deleteCommand = require('./commands/delete');
const { handleAntilinkCommand, handleLinkDetection } = require('./commands/antilink');
const { handleAntitagCommand, handleTagDetection } = require('./commands/antitag');
const { Antilink } = require('./lib/antilink');
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = require('./commands/mention');
const memeCommand = require('./commands/meme');
const tagCommand = require('./commands/tag');
const tagNotAdminCommand = require('./commands/tagnotadmin');
const hideTagCommand = require('./commands/hidetag');
const jokeCommand = require('./commands/joke');
const quoteCommand = require('./commands/quote');
const factCommand = require('./commands/fact');
const weatherCommand = require('./commands/weather');
const newsCommand = require('./commands/news');
const kickCommand = require('./commands/kick');
const simageCommand = require('./commands/simage');
const attpCommand = require('./commands/attp');
const { startHangman, guessLetter } = require('./commands/hangman');
const { startTrivia, answerTrivia } = require('./commands/trivia');
const { complimentCommand } = require('./commands/compliment');
const { insultCommand } = require('./commands/insult');
const { eightBallCommand } = require('./commands/eightball');
const { lyricsCommand } = require('./commands/lyrics');
const { dareCommand } = require('./commands/dare');
const { truthCommand } = require('./commands/truth');
const { clearCommand } = require('./commands/clear');
const pingCommand = require('./commands/ping');
const aliveCommand = require('./commands/alive');
const blurCommand = require('./commands/img-blur');
const { welcomeCommand, handleJoinEvent } = require('./commands/welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./commands/goodbye');
const githubCommand = require('./commands/github');
const repoCommand   = require('./commands/repo');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('./lib/antibadword');
const antibadwordCommand = require('./commands/antibadword');
const { handleChatbotCommand, handleChatbotResponse } = require('./commands/chatbot');
const takeCommand = require('./commands/take');
const { flirtCommand } = require('./commands/flirt');
const characterCommand = require('./commands/character');
const wastedCommand = require('./commands/wasted');
const shipCommand = require('./commands/ship');
const groupInfoCommand = require('./commands/groupinfo');
const profileCommand = require('./commands/profile');
const { handleHijackCommand, restoreHijackTimers } = require('./commands/hijack');
const resetlinkCommand = require('./commands/resetlink');
const staffCommand = require('./commands/staff');
const unbanCommand = require('./commands/unban');
const emojimixCommand = require('./commands/emojimix');
const { handlePromotionEvent } = require('./commands/promote');
const { handleDemotionEvent } = require('./commands/demote');
// viewOnceCommand remplacé par vvCommand (voir import ci-dessous)
const clearSessionCommand = require('./commands/clearsession');
const { autoStatusCommand, handleStatusUpdate } = require('./commands/autostatus');
const { simpCommand } = require('./commands/simp');
const { stupidCommand } = require('./commands/stupid');
const stickerTelegramCommand = require('./commands/stickertelegram');
const textmakerCommand = require('./commands/textmaker');
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const clearTmpCommand = require('./commands/cleartmp');
const setProfilePicture = require('./commands/setpp');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./commands/groupmanage');
const instagramCommand = require('./commands/instagram');
const facebookCommand = require('./commands/facebook');
const spotifyCommand = require('./commands/spotify');
const playCommand = require('./commands/play');
const tiktokCommand = require('./commands/tiktok');
const songCommand = require('./commands/song');
const aiCommand = require('./commands/ai');
const urlCommand = require('./commands/url');
const { handleTranslateCommand } = require('./commands/translate');
const { handleSsCommand } = require('./commands/ss');
const { addCommandReaction, addAllMessageReaction, handleAreactCommand } = require('./lib/reactions');
const { goodnightCommand } = require('./commands/goodnight');
const { shayariCommand } = require('./commands/shayari');
const { rosedayCommand } = require('./commands/roseday');
const imagineCommand = require('./commands/imagine');
const videoCommand = require('./commands/video');
const sudoCommand = require('./commands/sudo');
const { miscCommand, handleHeart } = require('./commands/misc');
const { animeCommand } = require('./commands/anime');
const { piesCommand, piesAlias } = require('./commands/pies');
const stickercropCommand = require('./commands/stickercrop');
const updateCommand = require('./commands/update');
const removebgCommand = require('./commands/removebg');
const { reminiCommand } = require('./commands/remini');
const { igsCommand } = require('./commands/igs');
const { anticallCommand, readState: readAnticallState } = require('./commands/anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./commands/pmblocker');
const settingsCommand = require('./commands/settings');
const statsCommand = require('./commands/stats');
const { isCommandEnabled } = require('./lib/sessionSettings');
const soraCommand = require('./commands/sora');
const { antibotCommand, isAntibotEnabled } = require('./commands/antibot');
const { promoteTimeCommand } = require('./commands/promotetime');
const { kickTimeCommand } = require('./commands/kicktime');
const { deleteAllCommand } = require('./commands/deleteall');
const { openGroupCommand, closeGroupCommand } = require('./commands/openclose');
const { kickAllCommand } = require('./commands/kickall');
const { kickAll2Command } = require('./commands/kickall2');
const { groupAntiCommand, handleGroupAnti } = require('./commands/groupanti');
const vvCommand = require('./commands/viewonce');
const { antiPromoteCommand, handleAntiPromoteEvent } = require('./commands/antipromote');
const { antiMentionGcCommand, handleAntiMentionGc } = require('./commands/antimentiongc');
const { getPrefix, normalizeCommandText, setPrefix } = require('./lib/prefix');
const { setCmdCommand, dispatchCustomCommand } = require('./commands/customcmd');
const { GROUP_COMMANDS, handleGroupExtraCommand } = require('./commands/groupExtras');
const fakeReactCommand = require('./commands/fakeract');

// Global settings
global.packname = settings.packname;
global.author = settings.author;
global.ytch = "";

// Add this near the top of main.js with other global configurations
const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363424782348922@newsletter',
            newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
            serverMessageId: -1
        }
    }
};

function readBotMode() {
    try {
        const data = JSON.parse(fs.readFileSync('./data/messageCount.json', 'utf8'));
        return data.isPublic !== false;
    } catch (error) {
        console.error('Error checking access mode:', error);
        return true;
    }
}

async function handleMessages(sock, messageUpdate, printLog) {
    let chatId = '';
    try {
        const { messages, type } = messageUpdate;
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message?.message) return;

        // Handle autoread functionality
        await handleAutoread(sock, message);

        // Store message for antidelete feature
        if (message.message) {
            storeMessage(sock, message);
        }

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }

        chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);
        const senderIsPrimaryOwner = typeof isOwnerOrSudo.isPrimaryOwner === 'function'
            ? await isOwnerOrSudo.isPrimaryOwner(senderId, sock, chatId)
            : false;
        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);
        const configuredOwner = String(settings.ownerNumber || '').replace(/\D/g, '');
        const senderNumbers = [senderId, message.key.participantAlt, message.key.remoteJid].filter(Boolean).map(value => String(value).split('@')[0].split(':')[0].replace(/\D/g, ''));
        const botNumberForOwner = String(sock.user?.id || '').split(':')[0].split('@')[0].replace(/\D/g, '');
        const isConfiguredOwner = senderNumbers.includes(configuredOwner) || (message.key.fromMe && botNumberForOwner === configuredOwner);

        // Suppression des messages des utilisateurs ciblés par .mute @user.
        if (isGroup && !message.key.fromMe && isMuted(chatId, senderId)) {
            try {
                await sock.sendMessage(chatId, {delete: message.key});
            } catch (error) {
                console.error('[mute] impossible de supprimer le message:', error.message);
            }
            return;
        }


        // Vérification antibot : bloquer les autres bots dans le groupe
        if (isGroup && isAntibotEnabled(chatId)) {
            const isBot = senderId.includes(':') && senderId.includes('@s.whatsapp.net') && !message.key.fromMe && !senderIsOwnerOrSudo;
            if (isBot) return; // Ignorer silencieusement les messages des autres bots
        }

        // Handle button responses
        if (message.message?.buttonsResponseMessage) {
            // Private mode also blocks interactive menu actions for non-owners.
            if (!readBotMode() && !senderIsOwnerOrSudo) return;
            const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
            const chatId = message.key.remoteJid;

            if (buttonId === 'channel' || buttonId === 'support') {
                await sock.sendMessage(chatId, {
                    text: '✅ Le compte connecté est automatiquement ajouté aux espaces officiels VARNOX.'
                }, { quoted: message });
                return;
            } else if (buttonId === 'owner') {
                const ownerCommand = require('./commands/owner');
                await ownerCommand(sock, chatId);
                return;
            }
        }

        const rawText = (
            message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            message.message?.buttonsResponseMessage?.selectedButtonId?.trim() ||
            ''
        );
        // Owner-friendly diagnostic alias. It reports only the active scope
        // (this private chat or this group), never another user's chat data.
        if (/^>\s+prefixe?\s*$/i.test(rawText) && senderIsPrimaryOwner) {
            await sock.sendMessage(chatId, {
                text: `🔑 Préfixe actif pour cette discussion : ${getPrefix(chatId)}`,
                ...channelInfo
            }, { quoted: message });
            return;
        }
        // Internally, commands use "." only after the active prefix has been
        // matched. A configured prefix fully replaces the default ".".
        const activePrefix = getPrefix(chatId);
        const userMessage = normalizeCommandText(rawText, activePrefix);

        if (rawText.startsWith(activePrefix) && (userMessage === '.prefix' || userMessage === '.prefixe')) {
            await sock.sendMessage(chatId, {
                text: `🔑 Préfixe actif pour cette discussion : ${getPrefix(chatId)}`,
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // Only log command usage
        if (rawText.startsWith(activePrefix) && userMessage.startsWith('.')) {
            console.log(`📝 Command used in ${isGroup ? 'group' : 'private'}: ${userMessage}`);
        }
        // Read bot mode once. Private mode is a hard owner/sudo lock.
        const isPublic = readBotMode();
        const isOwnerOrSudoCheck = message.key.fromMe || senderIsOwnerOrSudo;
        // Check if user is banned (skip ban check for unban command)
        if (isBanned(senderId) && !userMessage.startsWith('.unban')) {
            // Only respond occasionally to avoid spam
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, {
                    text: '❌ You are banned from using the bot. Contact an admin to get unbanned.',
                    ...channelInfo
                });
            }
            return;
        }

        // Private mode must block every bot feature for everyone else:
        // commands, games, chatbot responses and plain-text menu aliases.
        if (!isPublic && !isOwnerOrSudoCheck) return;

        // Accept "menu 5", "menu groupe", "help outils" and "allmenu".
        if (userMessage === 'allmenu') {
            await helpCommand(sock, chatId, message, 'allmenu');
            return;
        }
        const plainMenuMatch = userMessage.match(/^(?:menu|help)(?:\s+(.+))?$/);
        if (plainMenuMatch) {
            await helpCommand(sock, chatId, message, plainMenuMatch[1] || '');
            return;
        }

        // First check if it's a game move
        if (/^[1-9]$/.test(userMessage) || userMessage.toLowerCase() === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            return;
        }

        /*  // Basic message response in private chat
          if (!isGroup && (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'bot' || userMessage === 'hlo' || userMessage === 'hey' || userMessage === 'bro')) {
              await sock.sendMessage(chatId, {
                  text: 'Hi, How can I help you?\nYou can use .menu for more info and commands.',
                  ...channelInfo
              });
              return;
          } */

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // Check for bad words and antilink FIRST, before ANY other processing
        // Always run moderation in groups, regardless of mode
        if (isGroup) {
            if (userMessage) {
                await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
            }
            // Antilink checks message text internally, so run it even if userMessage is empty
            await Antilink(message, sock);
            // Anti-mention-gc : supprime les messages mentionnant le groupe
            if (await handleAntiMentionGc(sock, chatId, message, senderId)) return;
            if (await handleGroupAnti(sock, chatId, message, senderId)) return;
        }

        // PM blocker: block non-owner DMs when activé (do not ban)
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            try {
                const pmState = readPmBlockerState();
                if (pmState.activé) {
                    // Inform user, delay, then block without banning globally
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    await new Promise(r => setTimeout(r, 1500));
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) { }
        }

        // Then check for command prefix
        if (!rawText.startsWith(activePrefix)) {
            // Show typing indicator if autotyping is activé
            await handleAutotypingForMessage(sock, chatId, userMessage);

            // ── Autoreact sur TOUS les messages (groupes + PV) quand activé ──
            // Indépendant des commandes — réagit à chaque message entrant
            if (!message.key.fromMe) {
                addAllMessageReaction(sock, message).catch(() => {});
            }

            if (isGroup) {
                // Always run moderation features (antitag) regardless of mode
                await handleTagDetection(sock, chatId, message, senderId);
                await handleMentionDetection(sock, chatId, message);

                // Only run chatbot in public mode or for owner/sudo
                if (isPublic || isOwnerOrSudoCheck) {
                    await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                }
            }
            return;
        }
        const sessionNumber = String(sock.user?.id || '').split(':')[0].split('@')[0].replace(/\D/g, '');
        const commandToken = userMessage.split(/\s+/)[0].toLowerCase();
        const sessionExempt = ['.settings', '.stats', '.menu', '.help', '.allmenu'];
        if (!sessionExempt.includes(commandToken) && !isCommandEnabled(sessionNumber, commandToken)) {
            await sock.sendMessage(chatId, { text: '⛔ La commande ' + commandToken + ' est désactivée pour cette session.' }, { quoted: message });
            return;
        }

        // List of admin commands
        const commandMatches = cmd => userMessage === cmd || userMessage.startsWith(`${cmd} `);
        const adminCommands = ['.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.demoteadmin', '.kick', '.kicktime', '.kickall', '.kickall2', '.tagnotadmin', '.hidetag', '.antilink', '.antitag', '.antibot', '.antibadword', '.antipromote', '.antimentiongc', '.antiflood', '.antispam', '.antimedia', '.antisticker', '.antivoice', '.setgdesc', '.setgname', '.setgpp', '.deleteall', '.open', '.close'];
        // Seules les opérations qui modifient réellement WhatsApp exigent que
        // le compte connecté soit admin. Les commandes de mention et de
        // configuration locale continuent de fonctionner sans ce droit.
        const botAdminCommands = ['.mute', '.ban', '.promote', '.demote', '.demoteadmin', '.kick', '.kicktime', '.kickall', '.kickall2', '.antilink', '.antitag', '.antibot', '.antibadword', '.antipromote', '.antimentiongc', '.antiflood', '.antispam', '.antimedia', '.antisticker', '.antivoice', '.setgdesc', '.setgname', '.setgpp', '.deleteall', '.open', '.close'];
        const isAdminCommand = adminCommands.some(commandMatches);
        const isBotAdminRequired = botAdminCommands.some(commandMatches);

        // List of owner commands
        const ownerCommands = ['.mode', '.autostatus', '.antidelete', '.cleartmp', '.setpp', '.clearsession', '.areact', '.autoreact', '.autotyping', '.autoread', '.pmblocker', '.update', '.fakeract'];
        const isOwnerCommand = ownerCommands.some(commandMatches);

        let isSenderAdmin = false;
        let isBotAdmin = false;

        // Check admin status only for admin commands in groups
        if (isGroup && isAdminCommand) {
            // Si c'est le propriétaire (fromMe ou ownerOrSudo), on bypass toutes les vérifications
            if (message.key.fromMe || senderIsOwnerOrSudo) {
                isSenderAdmin = true;
                isBotAdmin = true;
            } else {
                const adminStatus = await isAdmin(sock, chatId, senderId);
                isSenderAdmin = adminStatus.isSenderAdmin;
                isBotAdmin = adminStatus.isBotAdmin;

                if (isBotAdminRequired && !isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: '⚠️ Cette action WhatsApp nécessite que le compte connecté soit administrateur du groupe.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                if (
                    commandMatches('.mute') ||
                    commandMatches('.unmute') ||
                    commandMatches('.ban') ||
                    commandMatches('.unban') ||
                    commandMatches('.promote') ||
                    commandMatches('.demote') ||
                    commandMatches('.demoteadmin') ||
                    commandMatches('.kickall') || commandMatches('.kickall2')
                ) {
                    if (!isSenderAdmin) {
                        await sock.sendMessage(chatId, {
                            text: 'Seuls les admins peuvent utiliser cette commande.',
                            ...channelInfo
                        }, { quoted: message });
                        return;
                    }
                }
            }
        }

        // Check owner status for owner commands
        if (isOwnerCommand) {
            const ownerAllowed = userMessage.startsWith('.fakeract') ? isConfiguredOwner : (message.key.fromMe || senderIsOwnerOrSudo);
            if (!ownerAllowed) {
                await sock.sendMessage(chatId, { text: '❌ Cette commande est réservée au numéro propriétaire configuré.' }, { quoted: message });
                return;
            }
        }

        // Command handlers - Execute commands immediately without waiting for typing indicator
        // We'll show typing indicator after command execution if needed
        let commandExecuted = false;

        // Réagir dès qu'une commande est reconnue, y compris pour les
        // commandes custom et les protections qui sortent plus tôt.
        const _cmdKey = userMessage.split(/\s+/)[0];
        addCommandReaction(sock, message, _cmdKey).catch(() => {});

        // Custom sticker commands are checked before the large legacy switch.
        // This keeps setcmd extensible without adding generated case labels.
        const customCommandName = userMessage.match(/^\.([a-z0-9_-]+)/)?.[1] || '';
        if (isGroup && customCommandName === 'hijack') {
            await handleHijackCommand(
                sock,
                chatId,
                message,
                userMessage.slice('.hijack'.length).trim().split(/\s+/).filter(Boolean),
                senderIsOwnerOrSudo
            );
            commandExecuted = true;
            sock.sendPresenceUpdate('paused', chatId).catch(() => {});
            return;
        }

        if (customCommandName && customCommandName !== 'setcmd') {
            if (await dispatchCustomCommand(sock, chatId, message, customCommandName)) {
                commandExecuted = true;
                sock.sendPresenceUpdate('paused', chatId).catch(() => {});
                return;
            }
        }

        if (userMessage === '.setprefix' || userMessage.startsWith('.setprefix ')) {
            const requestedPrefix = userMessage.slice('.setprefix'.length).trim();
            if (isGroup) {
                const prefixStatus = await isAdmin(sock, chatId, senderId);
                if (!prefixStatus.isSenderAdmin && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, { text: '❌ Seuls les admins peuvent changer le préfixe.', ...channelInfo }, { quoted: message });
                    return;
                }
            } else if (!senderIsOwnerOrSudo) {
                await sock.sendMessage(chatId, { text: '❌ Cette commande est réservée au propriétaire en privé.', ...channelInfo }, { quoted: message });
                return;
            }
            if (!requestedPrefix) {
                await sock.sendMessage(chatId, { text: `ℹ️ Préfixe actuel : ${getPrefix(chatId)}\nUtilise .setprefix ! ou .setprefix 🔥`, ...channelInfo }, { quoted: message });
                return;
            }
            try {
                const prefix = setPrefix(chatId, requestedPrefix);
                await sock.sendMessage(chatId, { text: `✅ Préfixe configuré : ${prefix}\nExemple : ${prefix}menu`, ...channelInfo }, { quoted: message });
            } catch (error) {
                await sock.sendMessage(chatId, { text: `❌ ${error.message}`, ...channelInfo }, { quoted: message });
            }
            return;
        }

        if (userMessage === '.setcmd' || userMessage.startsWith('.setcmd ')) {
            if (isGroup) {
                const setcmdStatus = await isAdmin(sock, chatId, senderId);
                if (!setcmdStatus.isSenderAdmin && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, { text: '❌ Seuls les admins peuvent créer une commande sticker.', ...channelInfo }, { quoted: message });
                    return;
                }
            } else if (!senderIsOwnerOrSudo) {
                await sock.sendMessage(chatId, { text: '❌ Cette commande est réservée au propriétaire en privé.', ...channelInfo }, { quoted: message });
                return;
            }
            try {
                await setCmdCommand(sock, chatId, message, userMessage.slice('.setcmd'.length).trim().split(/\s+/).filter(Boolean));
            } catch (error) {
                await sock.sendMessage(chatId, { text: `❌ Impossible de créer la commande : ${error.message}`, ...channelInfo }, { quoted: message });
            }
            return;
        }

        if (isGroup && GROUP_COMMANDS.includes(customCommandName)) {
            await handleGroupExtraCommand(
                sock,
                chatId,
                message,
                customCommandName,
                userMessage.slice(`.${customCommandName}`.length).trim().split(/\s+/).filter(Boolean),
                senderIsOwnerOrSudo
            );
            commandExecuted = true;
            sock.sendPresenceUpdate('paused', chatId).catch(() => {});
            return;
        }

        // ── Typing presence: "En train d'écrire…" while processing ──────────
        sock.sendPresenceUpdate('composing', chatId).catch(() => {});

        switch (true) {
            case userMessage === '.simage': {
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMessage?.stickerMessage) {
                    await simageCommand(sock, quotedMessage, chatId);
                } else {
                    await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the .simage command to convert it.', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            }
            // ── .kickall doit être AVANT .kick pour éviter le court-circuit ──
            case userMessage === '.kickall2':
                await kickAll2Command(sock, chatId, senderId, message);
                break;
            case userMessage === '.kickall':
                await kickAllCommand(sock, chatId, senderId, message);
                break;
            // ── .kicktime doit être AVANT .kick ──
            case userMessage.startsWith('.kicktime'):
                await kickTimeCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.kick'):
                const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
                break;
            case commandMatches('.mute'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const mentionedJidListMute = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const extraArgs = parts.slice(1).filter(arg => !arg.startsWith('@'));
                    const durationArg = extraArgs.find(arg => /^\d+$/.test(arg));
                    const hasInvalidArg = extraArgs.some(arg => !/^\d+$/.test(arg));
                    const muteDuration = durationArg ? parseInt(durationArg, 10) : undefined;
                    if (hasInvalidArg || (durationArg && muteDuration <= 0)) {
                        await sock.sendMessage(chatId, { text: '❌ Utilise .mute @user [minutes] ou réponds à son message avec .mute.', ...channelInfo }, { quoted: message });
                    } else {
                        await muteCommand(sock, chatId, senderId, message, muteDuration, mentionedJidListMute);
                    }
                }
                break;
            case commandMatches('.unmute'):
                {
                    const mentionedJidListUnmute = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await unmuteCommand(sock, chatId, senderId, message, mentionedJidListUnmute);
                }
                break;
            case userMessage.startsWith('.ban'):
                if (!isGroup) {
                    if (!message.key.fromMe && !senderIsSudo) {
                        await sock.sendMessage(chatId, { text: 'Only owner/sudo can use .ban in private chat.' }, { quoted: message });
                        break;
                    }
                }
                await banCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.unban'):
                if (!isGroup) {
                    if (!message.key.fromMe && !senderIsSudo) {
                        await sock.sendMessage(chatId, { text: 'Only owner/sudo can use .unban in private chat.' }, { quoted: message });
                        break;
                    }
                }
                await unbanCommand(sock, chatId, message);
                break;
            case userMessage === '.allmenu':
            case userMessage === '.help':
            case userMessage === '.menu':
            case userMessage === '.bot':
            case userMessage === '.list':
            case userMessage.startsWith('.menu '):
            case userMessage.startsWith('.help '): {
                const menuQuery = userMessage === '.allmenu' || userMessage === '.list'
                    ? 'allmenu'
                    : userMessage.split(/\s+/).slice(1).join(' ');
                await helpCommand(sock, chatId, message, menuQuery);
                commandExecuted = true;
                break;
            }
            case userMessage === '.sticker' || userMessage === '.s':
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.warnings'):
                const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warningsCommand(sock, chatId, mentionedJidListWarnings);
                break;
            case userMessage.startsWith('.warn'):
                const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
                break;
            case userMessage.startsWith('.tts'):
                const text = userMessage.slice(4).trim();
                await ttsCommand(sock, chatId, text, message);
                break;
            // ── .deleteall doit être AVANT .delete ──
            case userMessage === '.deleteall':
                await deleteAllCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.delete') || userMessage.startsWith('.del'):
                await deleteCommand(sock, chatId, message, senderId);
                break;
            case userMessage.startsWith('.attp'):
                await attpCommand(sock, chatId, message);
                break;

            case userMessage === '.settings':
            case userMessage.startsWith('.settings '):
                await settingsCommand(sock, chatId, message, userMessage.slice('.settings'.length).trim());
                break;
            case userMessage === '.stats':
                await statsCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.mode'):
                // Check if sender is the owner
                if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, {
                        text:
                            `╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗖𝗖𝗘𝗦𝗦 〕─╮\n` +
                            `│ ❌ *ACCESS DENIED*\n` +
                            `│ Cette commande est réservée\n` +
                            `│ au propriétaire ou aux sudo.\n` +
                            `╰──────────────────╯`,
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                // Read current data first
                let data;
                try {
                    data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
                } catch (error) {
                    console.error('Error reading access mode:', error);
                    await sock.sendMessage(chatId, {
                        text: '╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗖𝗖𝗘𝗦𝗦 〕─╮\n│ ❌ Impossible de lire le mode.\n╰──────────────────╯',
                        ...channelInfo
                    });
                    return;
                }

                const action = userMessage.split(' ')[1]?.toLowerCase();
                // If no argument provided, show current status
                if (!action) {
                    const currentMode = data.isPublic ? 'PUBLIC' : 'PRIVATE';
                    const accessInfo = data.isPublic
                        ? '🌐 Tout le monde peut utiliser le bot.'
                        : '🔒 Accès réservé au propriétaire et aux sudo autorisés.';
                    await sock.sendMessage(chatId, {
                        text:
                            `╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗖𝗖𝗘𝗦𝗦 〕─╮\n` +
                            `│ 🔐 Mode actuel : *${currentMode}*\n` +
                            `│ ${accessInfo}\n` +
                            `│\n` +
                            `│ Utilisation : *.mode public* ou *.mode private*\n` +
                            `╰──────────────────╯`,
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                if (action !== 'public' && action !== 'private') {
                    await sock.sendMessage(chatId, {
                        text:
                            `╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗖𝗖𝗘𝗦𝗦 〕─╮\n` +
                            `│ ⚠️ Option invalide.\n` +
                            `│ Utilise *.mode public* ou *.mode private*.\n` +
                            `╰──────────────────╯`,
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                try {
                    // Update access mode
                    data.isPublic = action === 'public';

                    // Save updated data
                    fs.writeFileSync('./data/messageCount.json', JSON.stringify(data, null, 2));

                    const modeName = action.toUpperCase();
                    const modeInfo = action === 'public'
                        ? '🌐 Le bot est ouvert à tous.'
                        : '🔒 Le bot est verrouillé pour les membres et admins.';
                    await sock.sendMessage(chatId, {
                        text:
                            `╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗖𝗖𝗘𝗦𝗦 〕─╮\n` +
                            `│ ✅ Mode activé : *${modeName}*\n` +
                            `│ ${modeInfo}\n` +
                            `╰──────────────────╯`,
                        ...channelInfo
                    });
                } catch (error) {
                    console.error('Error updating access mode:', error);
                    await sock.sendMessage(chatId, {
                        text: '╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗖𝗖𝗘𝗦𝗦 〕─╮\n│ ❌ Échec de la mise à jour du mode.\n╰──────────────────╯',
                        ...channelInfo
                    });
                }
                break;
            case userMessage.startsWith('.anticall'):
                if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, {
                        text: 'Only owner/sudo can use anticall.',
                        ...channelInfo
                    }, { quoted: message });
                    break;
                }
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await anticallCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.fakeract'):
                await fakeReactCommand(sock, chatId, message, userMessage.slice('.fakeract'.length).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pmblocker'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await pmblockerCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage === '.owner':
                await ownerCommand(sock, chatId);
                break;
            case userMessage === '.tagall':
                await tagAllCommand(sock, chatId, senderId, message);
                break;
            case userMessage === '.tagnotadmin':
                await tagNotAdminCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.hidetag'):
                {
                    const messageText = rawText.slice(8).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                break;
            case userMessage.startsWith('.tag'):
                const messageText = rawText.slice(4).trim();  // use rawText here, not userMessage
                const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                break;
            case userMessage.startsWith('.antilink'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;
            case userMessage.startsWith('.antitag'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;
            case userMessage === '.meme':
                await memeCommand(sock, chatId, message);
                break;
            case userMessage === '.joke':
                await jokeCommand(sock, chatId, message);
                break;
            case userMessage === '.quote':
                await quoteCommand(sock, chatId, message);
                break;
            case userMessage === '.fact':
                await factCommand(sock, chatId, message, message);
                break;
            case userMessage.startsWith('.weather'):
                const city = userMessage.slice(9).trim();
                if (city) {
                    await weatherCommand(sock, chatId, message, city);
                } else {
                    await sock.sendMessage(chatId, { text: 'Please specify a city, e.g., .weather London', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage === '.news':
                await newsCommand(sock, chatId);
                break;
            case userMessage.startsWith('.ttt') || userMessage.startsWith('.tictactoe'):
                const tttText = userMessage.split(' ').slice(1).join(' ');
                await tictactoeCommand(sock, chatId, senderId, tttText);
                break;
            case userMessage.startsWith('.move'):
                const position = parseInt(userMessage.split(' ')[1]);
                if (isNaN(position)) {
                    await sock.sendMessage(chatId, { text: 'Please provide a valid position number for Tic-Tac-Toe move.', ...channelInfo }, { quoted: message });
                } else {
                    tictactoeMove(sock, chatId, senderId, position);
                }
                break;
            case userMessage === '.topmembers':
                topMembers(sock, chatId, isGroup);
                break;
            case userMessage.startsWith('.hangman'):
                startHangman(sock, chatId);
                break;
            case userMessage.startsWith('.guess'):
                const guessedLetter = userMessage.split(' ')[1];
                if (guessedLetter) {
                    guessLetter(sock, chatId, guessedLetter);
                } else {
                    sock.sendMessage(chatId, { text: 'Please guess a letter using .guess <letter>', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.trivia'):
                startTrivia(sock, chatId);
                break;
            case userMessage.startsWith('.answer'):
                const answer = userMessage.split(' ').slice(1).join(' ');
                if (answer) {
                    answerTrivia(sock, chatId, answer);
                } else {
                    sock.sendMessage(chatId, { text: 'Please provide an answer using .answer <answer>', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.compliment'):
                await complimentCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.insult'):
                await insultCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.8ball'):
                const question = userMessage.split(' ').slice(1).join(' ');
                await eightBallCommand(sock, chatId, question);
                break;
            case userMessage.startsWith('.lyrics'):
                const songTitle = userMessage.split(' ').slice(1).join(' ');
                await lyricsCommand(sock, chatId, songTitle, message);
                break;
            case userMessage.startsWith('.simp'):
                const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await simpCommand(sock, chatId, quotedMsg, mentionedJid, senderId);
                break;
            case userMessage.startsWith('.stupid') || userMessage.startsWith('.itssostupid') || userMessage.startsWith('.iss'):
                const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const stupidArgs = userMessage.split(' ').slice(1);
                await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, stupidArgs);
                break;
            case userMessage === '.dare':
                await dareCommand(sock, chatId, message);
                break;
            case userMessage === '.truth':
                await truthCommand(sock, chatId, message);
                break;
            case userMessage === '.clear':
                if (isGroup) await clearCommand(sock, chatId);
                break;
            // ── .promotetime doit être AVANT .promote ──
            case userMessage.startsWith('.promotetime'):
                await promoteTimeCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.promote'):
                const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await promoteCommand(sock, chatId, mentionedJidListPromote, message);
                break;
            case userMessage.startsWith('.demoteadmin'):
                {
                    const mentionedJidListDemoteAdmin = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await demoteCommand(sock, chatId, mentionedJidListDemoteAdmin, message);
                }
                break;
            case userMessage.startsWith('.demote'):
                const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await demoteCommand(sock, chatId, mentionedJidListDemote, message);
                break;
            case userMessage === '.ping':
                await pingCommand(sock, chatId, message);
                break;
            case userMessage === '.alive':
                await aliveCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.mention '):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await mentionToggleCommand(sock, chatId, message, args, isOwner);
                }
                break;
            case userMessage === '.setmention':
                {
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await setMentionCommand(sock, chatId, message, isOwner);
                }
                break;
            case userMessage.startsWith('.blur'):
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                await blurCommand(sock, chatId, message, quotedMessage);
                break;
            case userMessage.startsWith('.welcome'):
                if (isGroup) {
                    // Check admin status if not already checked
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await welcomeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Seuls les admins peuvent utiliser cette commande.', ...channelInfo }, { quoted: message });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.goodbye'):
                if (isGroup) {
                    // Check admin status if not already checked
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await goodbyeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Seuls les admins peuvent utiliser cette commande.', ...channelInfo }, { quoted: message });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage === '.git':
            case userMessage === '.github':
            case userMessage === '.sc':
            case userMessage === '.script':
                await githubCommand(sock, chatId, message);
                break;
            case userMessage === '.repo':
                await repoCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.antibot'): {
                const antibotArgs = userMessage.split(' ').slice(1);
                const adminStatus2 = await isAdmin(sock, chatId, senderId);
                await antibotCommand(sock, chatId, message, antibotArgs, adminStatus2.isSenderAdmin || message.key.fromMe || senderIsOwnerOrSudo);
                break;
            }
            case userMessage.startsWith('.antibadword'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }

                const adminStatus = await isAdmin(sock, chatId, senderId);
                isSenderAdmin = adminStatus.isSenderAdmin;
                isBotAdmin = adminStatus.isBotAdmin;

                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*', ...channelInfo }, { quoted: message });
                    return;
                }

                await antibadwordCommand(sock, chatId, message, senderId, isSenderAdmin);
                break;
            case userMessage.startsWith('.chatbot'):
                {
                    const chatbotAdminStatus = isGroup
                        ? await isAdmin(sock, chatId, senderId)
                        : { isSenderAdmin: false };
                    const canConfigureChatbot = message.key.fromMe || senderIsOwnerOrSudo || chatbotAdminStatus.isSenderAdmin;
                    if (!canConfigureChatbot) {
                        await sock.sendMessage(chatId, {
                            text: isGroup
                                ? '*Only admins or bot owner can use this command*'
                                : '*Only the bot owner can configure chatbot in private chat*',
                            ...channelInfo
                        }, { quoted: message });
                        break;
                    }
                    const match = userMessage.slice('.chatbot'.length).trim();
                    await handleChatbotCommand(sock, chatId, message, match, {
                        isOwner: message.key.fromMe || senderIsOwnerOrSudo,
                        isAdmin: chatbotAdminStatus.isSenderAdmin
                    });
                }
                break;
            case userMessage.startsWith('.take') || userMessage.startsWith('.steal'):
                {
                    const isSteal = userMessage.startsWith('.steal');
                    const sliceLen = isSteal ? 6 : 5; // '.steal' vs '.take'
                    const takeArgs = rawText.slice(sliceLen).trim().split(' ');
                    await takeCommand(sock, chatId, message, takeArgs);
                }
                break;
            case userMessage === '.flirt':
                await flirtCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.character'):
                await characterCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.waste'):
                await wastedCommand(sock, chatId, message);
                break;
            case userMessage === '.ship':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await shipCommand(sock, chatId, message);
                break;
            case userMessage === '.groupinfo' || userMessage === '.infogp' || userMessage === '.infogrupo':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await groupInfoCommand(sock, chatId, message);
                break;
            case userMessage === '.profile' || userMessage === '.profil':
                await profileCommand(sock, chatId, message);
                break;
            case userMessage === '.resetlink' || userMessage === '.revoke' || userMessage === '.anularlink':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await resetlinkCommand(sock, chatId, senderId);
                break;
            case userMessage === '.staff' || userMessage === '.admins' || userMessage === '.listadmin':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await staffCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tourl') || userMessage.startsWith('.url'):
                await urlCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.emojimix') || userMessage.startsWith('.emix'):
                await emojimixCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tg') || userMessage.startsWith('.stickertelegram') || userMessage.startsWith('.tgsticker') || userMessage.startsWith('.telesticker'):
                await stickerTelegramCommand(sock, chatId, message);
                break;

            // .vv → renvoie le média dans la discussion actuelle
            case userMessage === '.vv':
            case userMessage === '.🥷':
                await vvCommand(sock, chatId, message, false);
                commandExecuted = true;
                break;
            // .vv2 → envoie le média directement en PV de l'expéditeur
            case userMessage === '.vv2':
                await vvCommand(sock, chatId, message, true);
                commandExecuted = true;
                break;
            case userMessage === '.clearsession' || userMessage === '.clearsesi':
                await clearSessionCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.autostatus'):
                const autoStatusArgs = userMessage.split(' ').slice(1);
                await autoStatusCommand(sock, chatId, message, autoStatusArgs);
                break;
            case userMessage.startsWith('.simp'):
                await simpCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.metallic'):
                await textmakerCommand(sock, chatId, message, userMessage, 'metallic');
                break;
            case userMessage.startsWith('.ice'):
                await textmakerCommand(sock, chatId, message, userMessage, 'ice');
                break;
            case userMessage.startsWith('.snow'):
                await textmakerCommand(sock, chatId, message, userMessage, 'snow');
                break;
            case userMessage.startsWith('.impressive'):
                await textmakerCommand(sock, chatId, message, userMessage, 'impressive');
                break;
            case userMessage.startsWith('.matrix'):
                await textmakerCommand(sock, chatId, message, userMessage, 'matrix');
                break;
            case userMessage.startsWith('.light'):
                await textmakerCommand(sock, chatId, message, userMessage, 'light');
                break;
            case userMessage.startsWith('.neon'):
                await textmakerCommand(sock, chatId, message, userMessage, 'neon');
                break;
            case userMessage.startsWith('.devil'):
                await textmakerCommand(sock, chatId, message, userMessage, 'devil');
                break;
            case userMessage.startsWith('.purple'):
                await textmakerCommand(sock, chatId, message, userMessage, 'purple');
                break;
            case userMessage.startsWith('.thunder'):
                await textmakerCommand(sock, chatId, message, userMessage, 'thunder');
                break;
            case userMessage.startsWith('.leaves'):
                await textmakerCommand(sock, chatId, message, userMessage, 'leaves');
                break;
            case userMessage.startsWith('.1917'):
                await textmakerCommand(sock, chatId, message, userMessage, '1917');
                break;
            case userMessage.startsWith('.arena'):
                await textmakerCommand(sock, chatId, message, userMessage, 'arena');
                break;
            case userMessage.startsWith('.hacker'):
                await textmakerCommand(sock, chatId, message, userMessage, 'hacker');
                break;
            case userMessage.startsWith('.sand'):
                await textmakerCommand(sock, chatId, message, userMessage, 'sand');
                break;
            case userMessage.startsWith('.blackpink'):
                await textmakerCommand(sock, chatId, message, userMessage, 'blackpink');
                break;
            case userMessage.startsWith('.glitch'):
                await textmakerCommand(sock, chatId, message, userMessage, 'glitch');
                break;
            case userMessage.startsWith('.fire'):
                await textmakerCommand(sock, chatId, message, userMessage, 'fire');
                break;
            case userMessage.startsWith('.antidelete'):
                const antideleteMatch = userMessage.slice(11).trim();
                await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
                break;
            case userMessage === '.surrender':
                // Handle surrender command for tictactoe game
                await handleTicTacToeMove(sock, chatId, senderId, 'surrender');
                break;
            case userMessage === '.cleartmp':
                await clearTmpCommand(sock, chatId, message);
                break;
            case userMessage === '.setpp':
                await setProfilePicture(sock, chatId, message);
                break;
            case userMessage.startsWith('.setgdesc'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupDescription(sock, chatId, senderId, text, message);
                }
                break;
            case userMessage.startsWith('.setgname'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupName(sock, chatId, senderId, text, message);
                }
                break;
            case userMessage.startsWith('.setgpp'):
                await setGroupPhoto(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.instagram') || userMessage.startsWith('.insta') || (userMessage === '.ig' || userMessage.startsWith('.ig ')):
                await instagramCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.igsc'):
                await igsCommand(sock, chatId, message, true);
                break;
            case userMessage.startsWith('.igs'):
                await igsCommand(sock, chatId, message, false);
                break;
            case userMessage.startsWith('.fb') || userMessage.startsWith('.facebook'):
                await facebookCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.music'):
                await playCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.spotify'):
                await spotifyCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.play') || userMessage.startsWith('.mp3') || userMessage.startsWith('.ytmp3') || userMessage.startsWith('.song'):
                await songCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.video') || userMessage.startsWith('.ytmp4'):
                await videoCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tiktok') || userMessage.startsWith('.tt'):
                await tiktokCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.gpt') || userMessage.startsWith('.gemini'):
                await aiCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.translate') || userMessage.startsWith('.trt'):
                const commandLength = userMessage.startsWith('.translate') ? 10 : 4;
                await handleTranslateCommand(sock, chatId, message, userMessage.slice(commandLength));
                return;
            case userMessage.startsWith('.ss') || userMessage.startsWith('.ssweb') || userMessage.startsWith('.screenshot'):
                const ssCommandLength = userMessage.startsWith('.screenshot') ? 11 : (userMessage.startsWith('.ssweb') ? 6 : 3);
                await handleSsCommand(sock, chatId, message, userMessage.slice(ssCommandLength).trim());
                break;
            case userMessage.startsWith('.areact') || userMessage.startsWith('.autoreact') || userMessage.startsWith('.autoreaction'):
                await handleAreactCommand(sock, chatId, message, isOwnerOrSudoCheck);
                break;
            case userMessage.startsWith('.sudo'):
                await sudoCommand(sock, chatId, message);
                break;
            case userMessage === '.goodnight' || userMessage === '.lovenight' || userMessage === '.gn':
                await goodnightCommand(sock, chatId, message);
                break;
            case userMessage === '.shayari' || userMessage === '.shayri':
                await shayariCommand(sock, chatId, message);
                break;
            case userMessage === '.roseday':
                await rosedayCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.imagine') || userMessage.startsWith('.flux') || userMessage.startsWith('.dalle'): await imagineCommand(sock, chatId, message);
                break;
            case userMessage === '.jid': await groupJidCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.autotyping'):
                await autotypingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoread'):
                await autoreadCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.heart'):
                await handleHeart(sock, chatId, message);
                break;
            case userMessage.startsWith('.horny'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['horny', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.circle'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['circle', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.lgbt'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lgbt', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.lolice'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lolice', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.simpcard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['simpcard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.tonikawa'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tonikawa', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.its-so-stupid'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['its-so-stupid', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.namecard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['namecard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;

            case userMessage.startsWith('.oogway2'):
            case userMessage.startsWith('.oogway'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.startsWith('.oogway2') ? 'oogway2' : 'oogway';
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.tweet'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tweet', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.ytcomment'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['youtube-comment', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.comrade'):
            case userMessage.startsWith('.gay'):
            case userMessage.startsWith('.glass'):
            case userMessage.startsWith('.jail'):
            case userMessage.startsWith('.passed'):
            case userMessage.startsWith('.triggered'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.slice(1).split(/\s+/)[0];
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.animu'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await animeCommand(sock, chatId, message, args);
                }
                break;
            // animu aliases
            case userMessage.startsWith('.nom'):
            case userMessage.startsWith('.poke'):
            case userMessage.startsWith('.cry'):
            case userMessage.startsWith('.kiss'):
            case userMessage.startsWith('.pat'):
            case userMessage.startsWith('.hug'):
            case userMessage.startsWith('.wink'):
            case userMessage.startsWith('.facepalm'):
            case userMessage.startsWith('.face-palm'):
            case userMessage.startsWith('.animuquote'):
            case userMessage.startsWith('.quote'):
            case userMessage.startsWith('.loli'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    let sub = parts[0].slice(1);
                    if (sub === 'facepalm') sub = 'face-palm';
                    if (sub === 'quote' || sub === 'animuquote') sub = 'quote';
                    await animeCommand(sock, chatId, message, [sub]);
                }
                break;
            case userMessage === '.crop':
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pies'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await piesCommand(sock, chatId, message, args);
                    commandExecuted = true;
                }
                break;
            case userMessage === '.china':
                await piesAlias(sock, chatId, message, 'china');
                commandExecuted = true;
                break;
            case userMessage === '.indonesia':
                await piesAlias(sock, chatId, message, 'indonesia');
                commandExecuted = true;
                break;
            case userMessage === '.japan':
                await piesAlias(sock, chatId, message, 'japan');
                commandExecuted = true;
                break;
            case userMessage === '.korea':
                await piesAlias(sock, chatId, message, 'korea');
                commandExecuted = true;
                break;
            case userMessage === '.india':
                await piesAlias(sock, chatId, message, 'india');
                commandExecuted = true;
                break;
            case userMessage === '.malaysia':
                await piesAlias(sock, chatId, message, 'malaysia');
                commandExecuted = true;
                break;
            case userMessage === '.thailand':
                await piesAlias(sock, chatId, message, 'thailand');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.update'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                    await updateCommand(sock, chatId, message, zipArg);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.removebg') || userMessage.startsWith('.rmbg') || userMessage.startsWith('.nobg'):
                await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.remini') || userMessage.startsWith('.enhance') || userMessage.startsWith('.upscale'):
                await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.sora'):
                await soraCommand(sock, chatId, message);
                break;

            // ── Open / Close groupe ──────────────────────────────────────────
            case userMessage === '.open':
                await openGroupCommand(sock, chatId, message);
                break;
            case userMessage === '.close':
                await closeGroupCommand(sock, chatId, message);
                break;

            // ── NOUVELLES PROTECTIONS GROUPE ───────────────────────────────
            case userMessage.startsWith('.antiflood') || userMessage.startsWith('.antispam') || userMessage.startsWith('.antimedia') || userMessage.startsWith('.antisticker') || userMessage.startsWith('.antivoice'):
                {
                    const antiFeature = userMessage.split(/\s+/)[0].slice(1);
                    await groupAntiCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1), antiFeature, isSenderAdmin);
                }
                break;

            // ── ANTIPROMOTE ──────────────────────────────────────────────────
            case userMessage.startsWith('.antipromote'):
                {
                    const apArgs = userMessage.split(' ').slice(1).join(' ');
                    await antiPromoteCommand(sock, chatId, senderId, message, apArgs);
                }
                break;

            // ── ANTIMENTIONGC ────────────────────────────────────────────────
            case userMessage.startsWith('.antimentiongc'):
                {
                    const amgcArgs = userMessage.split(' ').slice(1).join(' ');
                    await antiMentionGcCommand(sock, chatId, senderId, message, amgcArgs);
                }
                break;


            default:
                if (isGroup) {
                    // Handle non-command group messages
                    if (userMessage) {  // Make sure there's a message
                        await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                    }
                    await handleTagDetection(sock, chatId, message, senderId);
                    await handleMentionDetection(sock, chatId, message);
                }
                commandExecuted = false;
                break;
        }

        // ── Clear typing presence after command completes ───────────────────
        sock.sendPresenceUpdate('paused', chatId).catch(() => {});

        // If a command was executed, show typing status after command execution
        if (commandExecuted !== false) {
            await showTypingAfterCommand(sock, chatId);
        }

        // Function to handle .groupjid command
        async function groupJidCommand(sock, chatId, message) {
            const groupJid = message.key.remoteJid;

            if (!groupJid.endsWith('@g.us')) {
                return await sock.sendMessage(chatId, {
                    text: "❌ This command can only be used in a group."
                });
            }

            await sock.sendMessage(chatId, {
                text: `✅ Group JID: ${groupJid}`
            }, {
                quoted: message
            });
        }

    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        // Only try to send error message if we have a valid chatId
        if (chatId) {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to process command!',
                ...channelInfo
            });
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;

        // Check if it's a group
        if (!id.endsWith('@g.us')) return;

        // Respect bot mode: only announce promote/demote in public mode
        let isPublic = true;
        try {
            const modeData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
        } catch (e) {
            // If reading fails, default to public behavior
        }

        // Handle promotion events
        if (action === 'promote') {
            // Antipromote : démis automatiquement même en mode privé
            const wasBlocked = await handleAntiPromoteEvent(sock, id, participants);
            if (wasBlocked) return; // déjà géré, pas d'annonce normale
            if (!isPublic) return;
            await handlePromotionEvent(sock, id, participants, author);
            return;
        }

        // Handle demotion events
        if (action === 'demote') {
            if (!isPublic) return;
            await handleDemotionEvent(sock, id, participants, author);
            return;
        }

        // Handle join events
        if (action === 'add') {
            await handleJoinEvent(sock, id, participants);
        }

        // Handle leave events
        if (action === 'remove') {
            await handleLeaveEvent(sock, id, participants);
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

// Instead, export the handlers along with handleMessages
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    restoreHijackTimers,
    handleStatus: async (sock, status) => {
        await handleStatusUpdate(sock, status);
    }
};
